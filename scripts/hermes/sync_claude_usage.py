#!/usr/bin/env python3
"""Mirror how much of the Claude plan's limits Hermes has used into Directus (`claude_usage`).

Runs on the VPS as a Hermes no-agent cron job (every ~5 minutes), next to sync_agent_runs.py:
  hermes cron create "every 5m" --no-agent --script sync_claude_usage.py --name sync-claude-usage --deliver local

What it does
  - reads the Anthropic login from Hermes' credential pool (~/.hermes/auth.json), falling back to
    the Claude Code login (~/.claude/.credentials.json), both read-only:
    it reads tokens without touching them; only when the Hermes login has expired does it ask Hermes'
    own credential pool to refresh it (same code path Hermes uses), so Claude Code / Hermes keep working
  - asks Anthropic for the plan's usage windows (5 hours, weekly) with that token
  - uploads ONLY percentages and reset times. The token never leaves this machine.

The endpoint is not part of Anthropic's documented API and may change. If it does, or the token
has expired, this prints why and exits 1 (so the job shows as failed) and the website shows the last
numbers as "stale".

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
HERMES_AUTH = os.environ.get("HERMES_AUTH_FILE") or os.path.join(HOME, "auth.json")
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


def read_hermes_token(path: str = HERMES_AUTH, now_ms: float | None = None) -> str:
    """Live Anthropic login from Hermes' own credential pool (read-only), or TokenUnavailable.

    Hermes refreshes these itself; the ~/.claude login is a separate credential that Hermes does not
    refresh, so it goes stale (and its refresh token dies) while Hermes keeps working.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        raise TokenUnavailable("hermes auth file not readable") from None
    entries = ((data.get("credential_pool") or {}).get("anthropic") or []) if isinstance(data, dict) else []
    now = now_ms if now_ms is not None else dt.datetime.now(dt.timezone.utc).timestamp() * 1000
    for entry in sorted((e for e in entries if isinstance(e, dict)), key=lambda e: e.get("priority", 0)):
        token = entry.get("access_token")
        expires = entry.get("expires_at_ms")
        if not isinstance(token, str) or not token or entry.get("last_status") == "dead":
            continue
        if isinstance(expires, (int, float)) and expires <= now + 30_000:
            continue
        return token
    raise TokenUnavailable("no live Anthropic login in the Hermes credential pool")


HERMES_AGENT_DIR = os.environ.get("HERMES_AGENT_DIR") or os.path.join(HOME, "hermes-agent")
POOL_SNIPPET = (
    "from agent.credential_pool import load_pool\n"
    "e = load_pool('anthropic').select()\n"
    "print(e.access_token if e else '')\n"
)


def refresh_via_hermes_pool() -> str:
    """Ask Hermes' own credential pool for a token; it refreshes an expired one itself (with its
    locking and rotation bookkeeping). Needed because the login only gets refreshed when Hermes makes
    a Claude call, so a quiet stretch (e.g. overnight) leaves it expired and this job failing."""
    import subprocess

    python = os.path.join(HERMES_AGENT_DIR, "venv", "bin", "python")
    if not os.path.exists(python):
        raise TokenUnavailable("hermes venv not found")
    try:
        out = subprocess.run(
            [python, "-c", POOL_SNIPPET], cwd=HERMES_AGENT_DIR, capture_output=True, text=True, timeout=60
        )
    except (OSError, subprocess.TimeoutExpired):
        raise TokenUnavailable("hermes credential pool refresh did not run") from None
    token = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
    if out.returncode != 0 or not token:
        raise TokenUnavailable("hermes credential pool could not refresh the login")
    return token


def find_token() -> str:
    try:
        return read_hermes_token()
    except TokenUnavailable as hermes_error:
        try:
            return refresh_via_hermes_pool()
        except TokenUnavailable as pool_error:
            try:
                return read_access_token()
            except TokenUnavailable as claude_error:
                raise TokenUnavailable(f"{hermes_error}; {pool_error}; {claude_error}") from None


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
        token = find_token()
    except TokenUnavailable as exc:
        # Not quiet any more: a silent exit looked like a healthy job while the website went stale.
        print(f"sync_claude_usage: no usable Claude login ({exc}). Re-authenticate Anthropic in Hermes (`hermes auth add anthropic`).")
        return 1
    try:
        payload = fetch_usage(token)
    except (urllib.error.URLError, ValueError, TimeoutError) as exc:
        print(f"sync_claude_usage: could not read usage from Anthropic ({type(exc).__name__}: {exc}); keeping the last numbers")
        return 1
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
