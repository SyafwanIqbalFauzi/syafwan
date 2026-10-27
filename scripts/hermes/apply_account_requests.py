#!/usr/bin/env python3
"""apply_account_requests.py -- connect / reconnect a Google account from the website (syafwan.com/accounts).

Runs as a no-agent cron job (and is started on demand by the website's Connect button). The website
never touches this machine or any token: it only adds requests to Directus (`account_requests`). This
script PULLS pending requests, re-validates each one here, does the OAuth work, and writes the outcome
back. Tokens are written to ~/.hermes/credentials/google/<name>.json (mode 600) and never leave this machine.

Two steps per account (the OAuth "manual copy" flow, same as the google-workspace skill's setup):
  start   -> builds the Google consent link (PKCE; the verifier stays in a private file here) and
             returns it as `result`. Unknown address + label = a new account.
  finish  -> the person pastes the address bar of the page Google ends on (http://localhost:1/?code=...).
             The code is exchanged here; the token is only saved when Gmail confirms it belongs to the
             requested address and all required permissions were granted. Then the account check runs.

Usage:  apply_account_requests.py [--dry-run]
Needs:  HERMES_SYNC_TOKEN (env or ~/.hermes/.env), ~/.hermes/google_client_secret.json
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_accounts as sa  # noqa: E402  (registry, Directus client, timestamps)

HOME = sa.HOME
REGISTRY = sa.REGISTRY
CLIENT_SECRET = os.path.join(HOME, "google_client_secret.json")
TOKEN_DIR = os.path.join(HOME, "credentials", "google")
PENDING_DIR = os.path.join(TOKEN_DIR, ".pending")
LOCK = os.path.join(HOME, "cron", ".account_requests.lock")
REDIRECT_URI = "http://localhost:1"
AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
MAX_PENDING_AGE_S = 15 * 60
SYNC_JOB_NAME = "sync-accounts"
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]
EMAIL = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}$")


class Rejected(Exception):
    """The request cannot be done (the person sees this message)."""


# --------------------------------------------------------------------------- pure logic
def valid_email(value: object) -> str:
    if not isinstance(value, str) or not EMAIL.match(value.strip()) or len(value) > 254:
        raise Rejected("That is not a valid email address.")
    return value.strip().lower()


def valid_label(value: object) -> str:
    label = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(label) <= 40 or any(ord(c) < 32 for c in label):
        raise Rejected("Give the account a short name (1 to 40 characters).")
    return label


def slugify(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return slug or "account"


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def build_auth_url(client_id: str, state: str, challenge: str, login_hint: str) -> str:
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "scope": " ".join(SCOPES),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
            "login_hint": login_hint,
        }
    )
    return f"{AUTH_URL}?{query}"


def parse_redirect(text: str) -> tuple[str, str | None]:
    """(code, state) from the pasted address-bar URL; a bare code is accepted too. Raises Rejected."""
    text = (text or "").strip()
    if not text or len(text) > 4000:
        raise Rejected("Paste the full address of the page Google ended on (it starts with http://localhost:1/).")
    if "code=" in text:
        query = urllib.parse.urlparse(text).query if "?" in text else text
        params = urllib.parse.parse_qs(query.lstrip("?"))
        if params.get("error"):
            raise Rejected(f"Google reported: {params['error'][0]}. Start again.")
        code = (params.get("code") or [""])[0]
        if code:
            return code, (params.get("state") or [None])[0]
    if "://" in text or " " in text or "=" in text:
        raise Rejected("No authorisation code found in what you pasted. Paste the whole address, starting with http://localhost:1/")
    return text, None


def missing_scopes(granted: list[str]) -> list[str]:
    return [s for s in SCOPES if s not in granted]


def token_payload(response: dict, client: dict, now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    expiry = now + dt.timedelta(seconds=int(response.get("expires_in", 3600)))
    return {
        "token": response["access_token"],
        "refresh_token": response["refresh_token"],
        "token_uri": client.get("token_uri", "https://oauth2.googleapis.com/token"),
        "client_id": client["client_id"],
        "client_secret": client["client_secret"],
        "scopes": sorted(str(response.get("scope", "")).split()),
        "universe_domain": "googleapis.com",
        "account": "",
        "expiry": expiry.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "type": "authorized_user",
    }


def register(accounts: list[dict], identifier: str, label: str, token_path: str) -> list[dict]:
    """Registry with the account added (or its label/token kept when it already exists). Pure."""
    out = [dict(a) for a in accounts]
    if not any(str(a.get("identifier", "")).lower() == identifier for a in out):
        out.append({"provider": "google", "label": label, "identifier": identifier, "token": token_path})
    return out


def free_token_path(accounts: list[dict], label: str, directory: str | None = None) -> str:
    directory = directory or TOKEN_DIR  # looked up at call time so tests can point it elsewhere
    taken = {os.path.expanduser(str(a.get("token", ""))) for a in accounts}
    base = slugify(label)
    n = 1
    while True:
        path = os.path.join(directory, f"{base}{'' if n == 1 else f'-{n}'}.json")
        if path not in taken and not os.path.exists(path):
            return path
        n += 1


# --------------------------------------------------------------------------- I/O
def read_registry_raw() -> list[dict]:
    try:
        with open(REGISTRY, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return []
    return [a for a in data.get("accounts", []) if isinstance(a, dict)] if isinstance(data, dict) else []


def write_atomic(path: str, text: str, mode: int = 0o600) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
    os.chmod(path, mode)


def pending_path(identifier: str) -> str:
    return os.path.join(PENDING_DIR, hashlib.sha256(identifier.encode()).hexdigest()[:24] + ".json")


def load_client() -> dict:
    try:
        with open(CLIENT_SECRET, encoding="utf-8") as fh:
            data = json.load(fh)
        client = data.get("installed") or data.get("web")
        if client and client.get("client_id") and client.get("client_secret"):
            return client
    except (OSError, ValueError):
        pass
    raise Rejected("The Google client secret is missing on the server.")


def http_json(url: str, *, form: dict | None = None, bearer: str | None = None) -> tuple[int, dict]:
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if form is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except ValueError:
            return exc.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise Rejected("Could not reach Google. Try again in a minute.") from None


# --------------------------------------------------------------------------- the two steps
def do_start(req: dict) -> str:
    identifier = valid_email(req.get("identifier"))
    accounts = read_registry_raw()
    known = next((a for a in accounts if str(a.get("identifier", "")).lower() == identifier), None)
    label = (known or {}).get("label") or valid_label(req.get("label"))
    if known is None and any(str(a.get("label", "")).lower() == label.lower() for a in accounts):
        raise Rejected("Another account already uses that name.")
    token_path = os.path.expanduser(known["token"]) if known and known.get("token") else free_token_path(accounts, label)
    client = load_client()
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(24)
    write_atomic(
        pending_path(identifier),
        json.dumps({"state": state, "verifier": verifier, "identifier": identifier, "label": label, "token_path": token_path, "created": dt.datetime.now(dt.timezone.utc).timestamp()}),
    )
    return build_auth_url(client["client_id"], state, challenge, identifier)


def do_finish(req: dict) -> str:
    identifier = valid_email(req.get("identifier"))
    try:
        with open(pending_path(identifier), encoding="utf-8") as fh:
            pending = json.load(fh)
    except (OSError, ValueError):
        raise Rejected("No connection is in progress for this account. Start again.") from None
    if dt.datetime.now(dt.timezone.utc).timestamp() - float(pending.get("created", 0)) > MAX_PENDING_AGE_S:
        os.unlink(pending_path(identifier))
        raise Rejected("The link expired. Start again.")
    code, state = parse_redirect(str(req.get("payload") or ""))
    if state is not None and not secrets.compare_digest(state, pending["state"]):
        raise Rejected("This address belongs to a different attempt. Start again and use the newest link.")
    client = load_client()
    status, body = http_json(
        client.get("token_uri", "https://oauth2.googleapis.com/token"),
        form={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "redirect_uri": REDIRECT_URI,
            "code_verifier": pending["verifier"],
        },
    )
    if status != 200 or not body.get("access_token"):
        raise Rejected(f"Google did not accept the code ({body.get('error', status)}). The code works once and only for a few minutes: start again.")
    if not body.get("refresh_token"):
        raise Rejected("Google gave no long-lived token. Remove the app at myaccount.google.com/permissions, then start again.")
    missing = missing_scopes(str(body.get("scope", "")).split())
    if missing:
        raise Rejected("Not every permission was allowed (missing: " + ", ".join(m.rsplit("/", 1)[-1] for m in missing) + "). Allow all of them and start again.")
    code2, profile = http_json("https://gmail.googleapis.com/gmail/v1/users/me/profile", bearer=body["access_token"])
    address = str(profile.get("emailAddress", "")).lower()
    if code2 != 200 or not address:
        raise Rejected("Could not confirm which account this is. Start again.")
    if address != identifier:
        raise Rejected(f"You signed in as {address}, but this connection is for {identifier}. Nothing was saved. Start again and choose {identifier}.")

    write_atomic(pending["token_path"], json.dumps(token_payload(body, client), indent=2))
    write_atomic(REGISTRY, json.dumps({"accounts": register(read_registry_raw(), identifier, pending["label"], pending["token_path"])}, indent=1))
    os.unlink(pending_path(identifier))
    return f"Connected {identifier}."


def run_account_check() -> None:
    """Run the account check job now so the page and the 'recovered' alert update immediately."""
    try:
        with open(os.path.join(HOME, "cron", "jobs.json"), encoding="utf-8") as fh:
            jobs = json.load(fh).get("jobs", [])
        job = next(j["id"] for j in jobs if j.get("name") == SYNC_JOB_NAME)
        subprocess.run(["hermes", "cron", "run", job], capture_output=True, timeout=60, check=False)
    except (OSError, ValueError, StopIteration, subprocess.SubprocessError):
        pass  # the next scheduled check picks it up


# --------------------------------------------------------------------------- main
def process(directus: sa.Directus, dry_run: bool = False) -> int:
    rows = directus.call("GET", "/items/account_requests?filter[status][_eq]=pending&sort=requested_at&limit=20&fields=id,action,identifier,label,payload,requested_at") or []
    connected = False
    for req in rows:
        outcome, message = "done", ""
        try:
            requested = dt.datetime.fromisoformat(str(req.get("requested_at", "")).replace("Z", "+00:00"))
            if (dt.datetime.now(dt.timezone.utc) - requested).total_seconds() > MAX_PENDING_AGE_S:
                raise Rejected("This request expired. Start again.")
            if req.get("action") == "start":
                message = do_start(req) if not dry_run else "(dry run)"
            elif req.get("action") == "finish":
                message = do_finish(req) if not dry_run else "(dry run)"
                connected = connected or not dry_run
            else:
                raise Rejected("Unknown request.")
        except Rejected as exc:
            outcome, message = "failed", str(exc)
        except Exception as exc:  # noqa: BLE001 - never leave a request pending forever
            outcome, message = "failed", "Something went wrong on the server. Try again."
            print(f"apply_account_requests: request {req.get('id')} crashed: {type(exc).__name__}: {exc}")
        if not dry_run:
            directus.call("PATCH", f"/items/account_requests/{req['id']}", {"status": outcome, "result": message, "payload": None, "applied_at": sa.now_iso()})
    if connected:
        run_account_check()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="read requests, change nothing")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    with open(LOCK, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 0  # another run is working
        return process(sa.Directus(sa.read_sync_token()), args.dry_run)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"apply_account_requests failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
