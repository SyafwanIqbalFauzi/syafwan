#!/usr/bin/env python3
"""Check every connected account and mirror its status into Directus (`connected_accounts`).

Runs on the VPS as a Hermes no-agent cron job, next to sync_claude_usage.py:
  hermes cron create "every 30m" --no-agent --script sync_accounts.py --name sync-accounts --deliver local

Accounts are listed in a registry on the VPS (default ~/.hermes/credentials/accounts.json):
  {"accounts": [{"provider": "google", "label": "Main", "identifier": "me@gmail.com",
                 "token": "~/.hermes/google_token.json"}]}
`token` is the authorized-user file of that account (client id / secret / refresh token inside).

What it does, per account
  - google: refreshes the access token (proves the refresh token still works), then asks Gmail for the
    profile (proves the token really belongs to the expected address). Nothing is written back to the
    token file, so the Google Workspace skill keeps working as before.
  - uploads ONLY provider, identifier, label, status, granted scopes, a short detail and timestamps.
    Tokens never leave this machine.

Status: connected | revoked (refresh token rejected, reauth needed) | mismatch (token belongs to another
address) | not_connected (no token file) | error (could not tell: network / Google outage; the last
good time is kept).  New providers (social media, ...) add a `check_<provider>` function.

Needs: HERMES_SYNC_TOKEN (env or ~/.hermes/.env)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HOME = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
DIRECTUS = os.environ.get("HERMES_SYNC_URL", "https://syafwan.com/panel").rstrip("/")
REGISTRY = os.environ.get("HERMES_ACCOUNTS") or os.path.join(HOME, "credentials", "accounts.json")
PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
COLLECTION = "connected_accounts"


def now_iso(now: dt.datetime | None = None) -> str:
    return (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def classify_refresh(http_status: int, body: dict) -> tuple[str, str]:
    """(status, detail) from Google's token endpoint answer. Pure."""
    if http_status == 200 and isinstance(body, dict) and body.get("access_token"):
        return "connected", ""
    error = str(body.get("error", "")) if isinstance(body, dict) else ""
    if error in ("invalid_grant", "unauthorized_client", "invalid_client"):
        # invalid_grant = revoked, expired (testing-mode apps: 7 days) or password changed
        return "revoked", f"Google rejected the refresh token ({error})"
    return "error", f"Google answered {http_status} {error}".strip()


def build_row(entry: dict, status: str, detail: str, scopes: list[str], existing: dict | None, now: str) -> dict:
    """The Directus row for one account. Keeps the old `last_ok_at` unless the check just succeeded. Pure."""
    last_ok = now if status == "connected" else (existing or {}).get("last_ok_at")
    return {
        "provider": entry["provider"],
        "identifier": entry["identifier"],
        "label": entry.get("label") or entry["identifier"],
        "status": status,
        "scopes": sorted(scopes),
        "detail": detail[:300] or None,
        "checked_at": now,
        "last_ok_at": last_ok,
    }


def load_registry(path: str = REGISTRY) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    out = []
    for item in data.get("accounts", []):
        if not (isinstance(item, dict) and item.get("provider") and item.get("identifier")):
            continue
        out.append({**item, "token": os.path.expanduser(item["token"]) if item.get("token") else None})
    return out


def _post_form(url: str, form: dict) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except ValueError:
            return exc.code, {}


def _get_json(url: str, token: str) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except ValueError:
            return exc.code, {}


def check_google(entry: dict) -> tuple[str, str, list[str]]:
    path = entry.get("token")
    if not path or not os.path.exists(path):
        return "not_connected", "No token file yet: connect this account", []
    try:
        with open(path, encoding="utf-8") as fh:
            creds = json.load(fh)
    except (OSError, ValueError):
        return "error", "Token file is not readable", []
    scopes = list(creds.get("scopes") or [])
    if not creds.get("refresh_token"):
        return "revoked", "Token file has no refresh token", scopes
    try:
        code, body = _post_form(
            creds.get("token_uri") or "https://oauth2.googleapis.com/token",
            {
                "grant_type": "refresh_token",
                "refresh_token": creds["refresh_token"],
                "client_id": creds.get("client_id", ""),
                "client_secret": creds.get("client_secret", ""),
            },
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return "error", f"Could not reach Google ({type(exc).__name__})", scopes
    status, detail = classify_refresh(code, body)
    if status != "connected":
        return status, detail, scopes
    granted = str(body.get("scope", "")).split()
    scopes = granted or scopes
    try:
        code, profile = _get_json(PROFILE_URL, body["access_token"])
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return "error", f"Token works but Gmail did not answer ({type(exc).__name__})", scopes
    address = str(profile.get("emailAddress", "")).lower()
    if code == 200 and address and address != entry["identifier"].lower():
        return "mismatch", f"Token belongs to {address}, expected {entry['identifier']}", scopes
    if code == 200:
        return "connected", "", scopes
    # Token refreshed fine; Gmail itself may be off for this account (no gmail scope granted, API disabled).
    return "connected", f"Gmail profile check skipped ({code})", scopes


CHECKS = {"google": check_google}

STATE_PATH = os.environ.get("HERMES_ACCOUNTS_STATE") or os.path.join(HOME, "cache", "sync_accounts_state.json")
SITE = "https://syafwan.com/accounts"
# A failed check (network, Google outage) is only worth a message after this many runs in a row (30 min each).
ERRORS_BEFORE_ALERT = 3
# Statuses where a person has to act. `error` is handled separately (needs to repeat first).
ACTION_REASONS = {
    "revoked": "token ditolak Google, perlu dihubungkan ulang",
    "mismatch": "token milik akun lain",
    "not_connected": "belum ada token",
}


def _span(start_iso: str | None, end_iso: str) -> str:
    try:
        a = dt.datetime.fromisoformat((start_iso or "").replace("Z", "+00:00"))
        b = dt.datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    except ValueError:
        return ""
    minutes = max(0, int((b - a).total_seconds() // 60))
    if minutes < 60:
        return f"{minutes} menit"
    hours, rest = divmod(minutes, 60)
    if hours < 48:
        return f"{hours} jam {rest} menit" if rest else f"{hours} jam"
    return f"{hours // 24} hari"


def plan_alerts(rows: list[dict], state: dict, now: str) -> tuple[list[str], dict]:
    """Messages to send now and the new state. Alert once when an account breaks, once when it recovers. Pure.

    state = {"accounts": {"google|me@x": {"status": "ok"|"problem", "reason": str, "since": iso, "errors": int}}}
    """
    old = state.get("accounts") if isinstance(state, dict) else None
    if not isinstance(old, dict):
        old = {}
    state = state if isinstance(state, dict) else {}
    new: dict[str, dict] = {}
    messages: list[str] = []
    for row in rows:
        key = f"{row['provider']}|{row['identifier'].lower()}"
        prev = old.get(key) or {"status": "ok", "errors": 0}
        who = f"{row['label']} ({row['identifier']})"
        status = row["status"]
        entry = {"status": "ok", "errors": 0}
        if status == "connected":
            if prev.get("status") == "problem":
                messages.append(f"✅ Akun {who} kembali terhubung" + (f" (putus ±{_span(prev.get('since'), now)})." if prev.get("since") else "."))
        elif status == "error":
            errors = int(prev.get("errors", 0)) + 1
            if prev.get("status") == "problem":
                entry = {**prev, "errors": errors}
            elif errors >= ERRORS_BEFORE_ALERT:
                messages.append(f"⚠️ Akun {who} tidak bisa dicek {errors}x berturut-turut: {row.get('detail') or 'tidak ada detail'}. Cek {SITE}")
                entry = {"status": "problem", "reason": "error", "since": now, "errors": errors}
            else:
                entry = {"status": "ok", "errors": errors}
        else:
            reason = status
            if prev.get("status") == "problem" and prev.get("reason") == reason:
                entry = prev  # same problem as last time: stay silent
            else:
                text = ACTION_REASONS.get(status, status)
                messages.append(f"⚠️ Akun {who} terputus: {text}. Hubungkan ulang, status di {SITE}")
                entry = {"status": "problem", "reason": reason, "since": prev.get("since") if prev.get("status") == "problem" else now, "errors": 0}
        new[key] = entry
    return messages, {**{k: v for k, v in state.items() if k != "accounts"}, "accounts": new}


def load_state(path: str = STATE_PATH) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state: dict, path: str = STATE_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=1)
    os.replace(tmp, path)


def check_account(entry: dict) -> tuple[str, str, list[str]]:
    check = CHECKS.get(entry["provider"])
    if check is None:
        return "error", f"No checker for provider {entry['provider']}", []
    return check(entry)


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

    def existing(self) -> dict[tuple[str, str], dict]:
        rows = self.call("GET", f"/items/{COLLECTION}?fields=id,provider,identifier,last_ok_at&limit=-1") or []
        return {(r["provider"], r["identifier"].lower()): r for r in rows}

    def save(self, rows: list[dict], existing: dict[tuple[str, str], dict]) -> None:
        seen = set()
        for row in rows:
            key = (row["provider"], row["identifier"].lower())
            seen.add(key)
            if key in existing:
                self.call("PATCH", f"/items/{COLLECTION}/{existing[key]['id']}", row)
            else:
                self.call("POST", f"/items/{COLLECTION}", row)
        gone = [r["id"] for k, r in existing.items() if k not in seen]
        if gone:  # removed from the registry: do not leave a stale card behind
            self.call("DELETE", f"/items/{COLLECTION}", gone)


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
    ap.add_argument("--dry-run", action="store_true", help="check and print the rows, upload nothing")
    args = ap.parse_args()

    entries = load_registry()
    directus = None if args.dry_run else Directus(read_sync_token())
    existing = directus.existing() if directus else {}
    now = now_iso()
    rows = []
    for entry in entries:
        status, detail, scopes = check_account(entry)
        rows.append(build_row(entry, status, detail, scopes, existing.get((entry["provider"], entry["identifier"].lower())), now))
    if args.dry_run:
        messages, _ = plan_alerts(rows, load_state(), now)
        print(json.dumps(rows, indent=1))
        for line in messages:
            print("[would alert]", line)
        return 0
    assert directus is not None
    state = load_state()
    messages, new_state = plan_alerts(rows, state, now)
    # Saving to Directus failing (Directus down) must not hide an account alert, and is itself reported once.
    try:
        directus.save(rows, existing)
        if state.get("upload_failing"):
            messages.append("✅ sync-accounts bisa menyimpan ke Directus lagi.")
        new_state["upload_failing"] = False
    except Exception as exc:  # noqa: BLE001
        if not state.get("upload_failing"):
            messages.append(f"⚠️ sync-accounts gagal menyimpan ke Directus: {type(exc).__name__}: {str(exc)[:200]}")
        new_state["upload_failing"] = True
    save_state(new_state)
    for line in messages:
        print(line)  # stdout is what the cron job delivers; empty output = silent
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - failures must reach the alert channel
        print(f"sync_accounts failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
