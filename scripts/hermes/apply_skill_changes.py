#!/usr/bin/env python3
"""apply_skill_changes.py -- apply skill change requests made on the website (syafwan.com/hermes/skills).

Runs as a no-agent cron job every minute. The website never touches this machine: it only adds
requests to Directus (`skill_changes`). This script PULLS pending requests, re-validates each one
here (the website's checks are a convenience, these are the real ones), applies it, and writes the
outcome back.

Two kinds of request:
  set_enabled  enable/disable a skill, through Hermes' own config helpers (essential skills refused)
  set_content  replace the instructions (the body of SKILL.md) of one of YOUR skills

Editing is line-based and safe by construction. The website only ever sees a redacted copy of a
skill (secrets, credential paths and long ids hidden). So an edit is applied as a diff against that
copy: lines the user did not touch are taken from the REAL file, and a change that would touch a
line containing a hidden value is refused. Hidden values can therefore never be overwritten with
their redacted placeholders. Also: the request must start from the text currently on disk (hash
check), built-in skills are never edited, the old file is backed up, and the write is atomic.

Usage:  apply_skill_changes.py [--dry-run]
Exit:   0 normally (stdout empty); non-zero with a message on a failure that needs attention.
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import fcntl
import json
import os
import re
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_agent_runs as s  # noqa: E402  (shared helpers: redaction, front matter, Directus client)

HOME = s.HOME
SKILLS_DIR = s.SKILLS_DIR
BACKUP_DIR = os.path.join(SKILLS_DIR, ".web-backups")  # hidden: never scanned as a skill
LOG = os.path.join(HOME, "cron", "skill_changes.log")
LOCK = os.path.join(HOME, "cron", ".skill_changes.lock")
MAX_PENDING_AGE_S = 15 * 60
MAX_BACKUPS = 20
PLACEHOLDER = re.compile(r"\[id hidden\]|credentials/\[hidden\]|\*\*\*")

APPLIED, REJECTED = "applied", "rejected"


class Rejected(Exception):
    """The request is not acceptable (the person gets this message)."""


# --------------------------------------------------------------------------- pure logic
def merge_edit(original_body: str, shown: str, edited: str) -> str:
    """Apply an edit made on the redacted copy `shown` to the real `original_body`."""
    orig = original_body.split("\n")
    shown_lines = shown.split("\n")
    if len(orig) != len(shown_lines):
        raise Rejected("This skill cannot be edited safely from the website.")
    new = edited.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    out: list[str] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, shown_lines, new, autojunk=False).get_opcodes():
        if tag == "equal":
            out.extend(orig[i1:i2])  # untouched lines come from the real file
            continue
        for k in range(i1, i2):
            if orig[k] != shown_lines[k]:
                raise Rejected(f"Line {k + 1} contains a hidden value (a secret, id or credential path), so it cannot be changed or removed here.")
        for line in new[j1:j2]:
            if PLACEHOLDER.search(line):
                raise Rejected("The new text contains a hidden-value marker such as [id hidden]. Remove it and try again.")
        out.extend(new[j1:j2])
    return "\n".join(out)


def parse_iso(value: str | None) -> dt.datetime | None:
    return s.parse_dt(value)


# --------------------------------------------------------------------------- skills on disk
def find_skill(name: str) -> str:
    """Absolute path of the skill's SKILL.md, confined to the skills directory."""
    root = os.path.realpath(SKILLS_DIR)
    for base, dirs, files in os.walk(SKILLS_DIR):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        if "SKILL.md" not in files:
            continue
        path = os.path.join(base, "SKILL.md")
        with open(path, encoding="utf-8", errors="replace") as fh:
            meta, _ = s.split_front_matter(fh.read())
        if (meta.get("name") or os.path.basename(base)) == name:
            real = os.path.realpath(path)
            if not real.startswith(root + os.sep):
                raise Rejected("That skill is outside the skills folder.")
            return real
    raise Rejected("That skill no longer exists.")


def is_local(name: str) -> bool:
    return name not in s._bundled_names() and name not in s._hub_names()


def backup(path: str, name: str) -> str:
    folder = os.path.join(BACKUP_DIR, name)
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".md")
    shutil.copy2(path, target)
    for old in sorted(os.listdir(folder))[:-MAX_BACKUPS]:
        os.remove(os.path.join(folder, old))
    return target


def apply_content(name: str, new_text: str, base_hash: str, redact) -> str:
    if not is_local(name):
        raise Rejected("Built-in and hub skills are read-only.")
    path = find_skill(name)
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    match = s.FRONT_MATTER.match(raw)
    if not match:
        raise Rejected("This skill has no front matter and cannot be edited from the website.")
    body = raw[match.end():]
    shown = s.redacted_body(body, redact)
    if s.body_hash_of(shown) != base_hash:
        raise Rejected("The skill changed after you opened it. Reload the page and edit the new version.")
    if not s.is_editable("local", True, body, shown):
        raise Rejected("This skill cannot be edited safely from the website.")
    if "\x00" in new_text or len(new_text) > s.SKILL_CAP:
        raise Rejected("The new text is too long (limit 60,000 characters) or contains invalid characters.")

    merged = merge_edit(body, shown, new_text)
    if merged == body:
        return "No change: the text is identical."
    new_raw = raw[: match.end()] + merged
    meta, _ = s.split_front_matter(new_raw)
    if (meta.get("name") or "") != (s.split_front_matter(raw)[0].get("name") or ""):
        raise Rejected("The skill name in the header must not change.")

    saved = backup(path, name)
    fd, tmp = tempfile.mkstemp(prefix=".SKILL.", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_raw)
        shutil.copymode(path, tmp)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return f"Saved. The previous version was kept as {os.path.relpath(saved, SKILLS_DIR)}."


def apply_enabled(name: str, enabled: bool) -> str:
    if enabled is not True and enabled is not False:
        raise Rejected("Invalid request.")
    if name in s.essential_skills():
        raise Rejected("This skill is essential for Hermes and cannot be disabled.")
    find_skill(name)  # must exist
    os.environ.setdefault("HERMES_HOME", HOME)
    sys.path.insert(0, os.path.join(HOME, "hermes-agent"))
    from hermes_cli.config import load_config  # noqa: WPS433
    from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills  # noqa: WPS433

    config = load_config()
    current = get_disabled_skills(config)
    wanted = current - {name} if enabled else current | {name}
    if wanted == current:
        return f"Already {'enabled' if enabled else 'disabled'}."
    save_disabled_skills(config, wanted)
    return f"Skill {'enabled' if enabled else 'disabled'}. Agents pick this up on their next run."


# --------------------------------------------------------------------------- requests
def handle(row: dict, redact) -> tuple[str, str]:
    requested = parse_iso(row.get("requested_at"))
    if requested and (dt.datetime.now(dt.timezone.utc) - requested).total_seconds() > MAX_PENDING_AGE_S:
        return REJECTED, "This request waited too long and was not applied. Please try again."
    name, action = str(row.get("skill") or ""), row.get("action")
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$", name):
        return REJECTED, "Invalid skill name."
    payload = row.get("payload") or {}
    try:
        if action == "set_enabled":
            return APPLIED, apply_enabled(name, payload.get("enabled"))
        if action == "set_content":
            content = payload.get("content_md")
            if not isinstance(content, str) or not isinstance(row.get("base_hash"), str):
                raise Rejected("Invalid request.")
            return APPLIED, apply_content(name, content, row["base_hash"], redact)
        raise Rejected("Unknown action.")
    except Rejected as why:
        return REJECTED, str(why)


def log(entry: dict) -> None:
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"ts": dt.datetime.now(dt.timezone.utc).isoformat(), **entry}, ensure_ascii=False) + "\n")


PENDING_QUERY = (
    "/items/skill_changes?filter[status][_eq]=pending&sort=requested_at&limit=10"
    "&fields=id,skill,action,payload,base_hash,requested_at,requested_by"
)


def process_pending(client, redact) -> int:
    """Apply every pending request once. Returns how many were handled."""
    pending = client.call("GET", PENDING_QUERY) or []
    if not pending:
        return 0

    outcomes = []
    for row in pending:
        try:
            status, message = handle(row, redact)
        except Exception as exc:  # noqa: BLE001 - one bad request must not block the rest
            status, message = "failed", f"Unexpected error: {type(exc).__name__}: {exc}"
        outcomes.append((row, status, message))

    # Refresh the website's copy of the catalogue BEFORE reporting "applied", so that the page that is
    # waiting for the result never sees stale text or a stale hash. A failure here must not hide the outcome.
    if any(status == APPLIED for _, status, _ in outcomes):
        try:
            client.sync_skills(s.collect_skills(redact))
        except Exception as exc:  # noqa: BLE001
            log({"event": "catalogue_sync_failed", "error": f"{type(exc).__name__}: {exc}"[:300]})

    for row, status, message in outcomes:
        client.call(
            "PATCH",
            f"/items/skill_changes/{row['id']}",
            {"status": status, "result": message[:1000], "applied_at": s.iso(dt.datetime.now(dt.timezone.utc))},
        )
        log({"id": row["id"], "skill": row.get("skill"), "action": row.get("action"), "by": row.get("requested_by"), "status": status, "result": message[:300]})
    return len(outcomes)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="list pending requests, change nothing")
    ap.add_argument("--watch", type=int, default=100, metavar="SECONDS", help="keep checking for this long (default 100; 0 = once)")
    ap.add_argument("--interval", type=int, default=8, metavar="SECONDS", help="pause between checks while watching")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    with open(LOCK, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 0  # the previous run is still going

        client = s.Directus(s.read_token())
        if args.dry_run:
            pending = client.call("GET", PENDING_QUERY) or []
            if pending:
                print(json.dumps([{k: r.get(k) for k in ("id", "skill", "action", "requested_by")} for r in pending]))
            return 0

        redact = s._redactor()
        # Hermes starts this job about every two minutes; staying alive and polling makes a request
        # from the website get picked up within seconds instead of waiting for the next start.
        deadline = time.monotonic() + max(0, args.watch)
        while True:
            process_pending(client, redact)
            if time.monotonic() + args.interval >= deadline:
                break
            time.sleep(args.interval)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - failures must reach the alert channel
        print(f"apply_skill_changes failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
