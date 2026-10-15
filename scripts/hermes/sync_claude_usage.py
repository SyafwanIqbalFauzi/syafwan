#!/usr/bin/env python3
"""Mirror how much of the Claude plan's limits Hermes has used into Directus (`claude_usage`).

Runs on the VPS as a Hermes no-agent cron job (every ~5 minutes), next to sync_agent_runs.py:
  hermes cron create "every 5m" --no-agent --script sync_claude_usage.py --name sync-claude-usage --deliver local

What it does
  - reads the Claude Code login that Hermes itself uses (~/.claude/.credentials.json), read-only:
    it never refreshes or rewrites the token, so Claude Code / Hermes keep working as before
  - asks Anthropic for the plan's usage windows (5 hours, weekly) with that token
  - uploads ONLY percentages and reset times. The token never leaves this machine.

The endpoint is not part of Anthropic's documented API and may change. If it does, or the token
has expired, this exits quietly and the website shows the last numbers as "stale".

Needs: HERMES_SYNC_TOKEN (env or ~/.hermes/.env)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

HOME = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
DIRECTUS = os.environ.get("HERMES_SYNC_URL", "https://syafwan.com/panel").rstrip("/")
CREDENTIALS = os.environ.get("CLAUDE_CREDENTIALS") or os.path.expanduser("~/.claude/.credentials.json")
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"

# Anthropic field -> the name used on the website
WINDOWS = {
    "five_hour": "session",
    "seven_day": "weekly",
    "seven_day_opus": "weekly_opus",
    "seven_day_sonnet": "weekly_sonnet",
}


def severity_for(percent: float) -> str:
    if percent >= 90:
        return "critical"
    if percent >= 75:
        return "warning"
    return "normal"


def parse_usage(payload: dict, now: dt.datetime | None = None) -> list[dict]:
    """Rows to store, one per usage window that exists on this plan. Pure: no I/O."""
    stamp = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    rows = []
    for source, name in WINDOWS.items():
        window = payload.get(source) if isinstance(payload, dict) else None
        if not isinstance(window, dict):
            continue
        percent = window.get("utilization")
        if isinstance(percent, bool) or not isinstance(percent, (int, float)):
            continue
        percent = max(0.0, min(100.0, float(percent)))
        rows.append(
            {
                "window": name,
                "percent": round(percent, 1),
                "severity": severity_for(percent),
                "resets_at": _iso(window.get("resets_at")),
                "checked_at": stamp,
            }
        )
    return rows


def _iso(value) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class TokenUnavailable(Exception):
    """No usable login on this machine (missing, unreadable or expired)."""


def read_access_token(path: str = CREDENTIALS, now_ms: float | None = None) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        raise TokenUnavailable("credentials file not readable") from None
    oauth = data.get("claudeAiOauth", data) if isinstance(data, dict) else {}
    token = oauth.get("accessToken")
    if not isinstance(token, str) or not token:
        raise TokenUnavailable("no access token")
    expires = oauth.get("expiresAt")
    now = now_ms if now_ms is not None else dt.datetime.now(dt.timezone.utc).timestamp() * 1000
    if isinstance(expires, (int, float)) and expires <= now + 30_000:
        raise TokenUnavailable("access token expired (Hermes refreshes it on its next Claude call)")
    return token


def fetch_usage(token: str) -> dict:
    req = urllib.request.Request(
        USAGE_URL,
        headers={"Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.0"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read())


class Directus:
    def __init__(self, token: str):
        self.token = token

    def call(self, method: str, path: str, body=None):
        req = urllib.request.Request(
            DIRECTUS + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "User-Agent": "hermes-sync/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Directus {method} {path} -> {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}") from None
        return json.loads(raw)["data"] if raw else None

    def save(self, rows: list[dict]) -> None:
        existing = {r["window"]: r["id"] for r in self.call("GET", "/items/claude_usage?fields=id,window&limit=-1") or []}
        for row in rows:
            if row["window"] in existing:
                self.call("PATCH", f"/items/claude_usage/{existing[row['window']]}", row)
            else:
                self.call("POST", "/items/claude_usage", row)
        # A window that no longer exists on the plan should not linger with old numbers.
        gone = [i for w, i in existing.items() if w not in {r["window"] for r in rows}]
        if gone:
            self.call("DELETE", "/items/claude_usage", gone)


def read_sync_token() -> str:
    token = os.environ.get("HERMES_SYNC_TOKEN")
    if token:
        return token
    try:
        with open(os.path.join(HOME, ".env"), encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("HERMES_SYNC_TOKEN="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    raise SystemExit("HERMES_SYNC_TOKEN is not set")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="fetch and print the rows, upload nothing")
    args = ap.parse_args()

    try:
        token = read_access_token()
    except TokenUnavailable:
        return 0  # quiet: the website will show the numbers as stale
    try:
        payload = fetch_usage(token)
    except (urllib.error.URLError, ValueError, TimeoutError):
        return 0  # Anthropic unreachable or the endpoint changed: keep the last numbers
    rows = parse_usage(payload)
    if not rows:
        print("sync_claude_usage: the usage response had no recognisable windows (endpoint changed?)")
        return 1
    if args.dry_run:
        print(json.dumps(rows, indent=1))
        return 0
    Directus(read_sync_token()).save(rows)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - failures must reach the alert channel
        print(f"sync_claude_usage failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
