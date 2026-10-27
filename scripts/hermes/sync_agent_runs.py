#!/usr/bin/env python3
"""sync_agent_runs.py -- mirror Hermes cron history to the Directus behind syafwan.com.

Runs as a no-agent cron job (no LLM, no tokens) every few minutes. For every cron run that
has a result (or failed) it stores one row in `agent_runs`, and it keeps `agent_jobs` in step
with ~/.hermes/cron/jobs.json, so https://syafwan.com/agent/agents can show agents, models,
skills and the history of their results. Discord/Telegram delivery is untouched.

Where the data comes from
  - cron/executions.db        status, times, error, delivery outcome (bounded to ~1000 rows)
  - cron/output/<job>/*.md    full run documents back to September: header + "## Prompt" + "## Response"
  - cron/output/<job>_<ts>.txt older single-file outputs
  - cron/jobs.json            names, skills, models, schedule, delivery targets
  - channel_directory.json    channel ids -> names

Safety
  - Only the "## Response" part of a run document is ever read for upload. The "## Prompt" part
    holds the full skill text (spreadsheet ids, credential paths) and never leaves this machine.
  - Everything uploaded goes through Hermes' own secret redactor (agent.redact.redact_for_egress).
    If the redactor cannot be imported the script stops instead of uploading unredacted text.
  - Silent script ticks ("silent (empty output)") are not stored; they are noise.

Idempotent: rows are keyed by execution_id and created once; re-running adds nothing.

Usage:  sync_agent_runs.py [--dry-run] [--verbose]
Needs:  HERMES_SYNC_TOKEN (env, declared in config.yaml terminal.env_passthrough, or ~/.hermes/.env)
Exit:   0 on success (stdout stays empty), non-zero on failure (stdout/stderr -> alert to Discord).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request

HOME = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
CRON = os.path.join(HOME, "cron")
OUTPUT = os.path.join(CRON, "output")
DIRECTUS = os.environ.get("HERMES_SYNC_URL", "https://syafwan.com/panel").rstrip("/")

RESPONSE_CAP = 100_000
ERROR_CAP = 4_000
SUMMARY_CAP = 280
BATCH_BYTES = 600_000  # Directus MAX_PAYLOAD_SIZE defaults to 1mb
DEFAULT_MODEL = "default"

MD_NAME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$")
TXT_NAME = re.compile(r"^([0-9a-f]{12})_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.txt$")
SKILL_INVOKED = re.compile(r'invoked the "([A-Za-z0-9_.\-]+)" skill')


CRED_PATH = re.compile(r"(\.hermes/credentials/)[^\s\"'`)]+")


def hide_credential_paths(text: str) -> str:
    return CRED_PATH.sub(r"\1[hidden]", text)


def _redactor():
    sys.path.insert(0, os.path.join(HOME, "hermes-agent"))
    from agent.redact import redact_for_egress  # noqa: WPS433  (fail closed on ImportError)

    def redact(text):
        if text is None:
            return None
        # Hermes' redactor masks credential *shapes*; also hide where credential files live.
        return hide_credential_paths(redact_for_egress(str(text)))

    return redact


# --------------------------------------------------------------------------- parsing
def parse_dt(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def iso(value: dt.datetime | None) -> str | None:
    return value.astimezone(dt.timezone.utc).isoformat() if value else None


def md_time(name: str) -> dt.datetime | None:
    m = MD_NAME.match(name)
    return dt.datetime(*map(int, m.groups()), tzinfo=dt.timezone.utc) if m else None


def split_run_document(text: str) -> dict:
    """Header fields plus the Response section. The Prompt section is deliberately discarded here."""
    head = text.split("\n## ", 1)[0]
    meta = {
        "name": (re.search(r"^# Cron Job: (.+)$", head, re.M) or [None, None])[1],
        "mode": (re.search(r"^\*\*Mode:\*\* (.+)$", head, re.M) or [None, None])[1],
        "status_line": (re.search(r"^\*\*Status:\*\* (.+)$", head, re.M) or [None, None])[1],
    }
    idx = text.rfind("\n## Response")
    response = None
    if idx != -1:
        response = text[idx + len("\n## Response") :].lstrip("\n").rstrip()
    meta["response"] = response
    skills = SKILL_INVOKED.findall(text[: idx if idx != -1 else len(text)])
    meta["skills"] = sorted(set(skills))
    return meta


def summarize(markdown: str | None) -> str | None:
    if not markdown:
        return None
    flat = re.sub(r"[#*_`>|]+", "", markdown)
    flat = re.sub(r"\s+", " ", flat).strip()
    return flat[:SUMMARY_CAP]


# An agent that needs the owner to look at its result ends the answer with a line such as
#   PERLU-CEK: 3 draft entries wait for approval
# (also "**PERLU-CEK:** ...", "> PERLU-CEK: ..." or the English NEEDS-CHECK:). The last such line wins.
CHECK_LINE = re.compile(r"^[\s>*_#\-]*(?:PERLU[-_ ]?CEK|NEEDS[-_ ]?CHECK)\s*[:：]\s*[*_]*\s*(.*?)\s*[*_]*\s*$", re.IGNORECASE | re.MULTILINE)
CHECK_CAP = 300


def check_marker(markdown: str | None) -> tuple[bool, str | None]:
    """(needs_check, reason). The reason may be empty text -> None; the flag is still set."""
    if not markdown:
        return False, None
    found = CHECK_LINE.findall(markdown)
    if not found:
        return False, None
    return True, (found[-1].strip()[:CHECK_CAP] or None)


def schedule_display(job: dict) -> str | None:
    sched = job.get("schedule") or {}
    return job.get("schedule_display") or sched.get("display") or sched.get("expr")


def kind_of(job: dict | None, mode: str | None) -> str:
    if job is not None:
        return "script" if job.get("no_agent") else "agent"
    return "script" if mode and "no_agent" in mode else "agent"


def deliver_labels(deliver: str | None, directory: dict) -> list[str]:
    names = {}
    for platform, channels in (directory.get("platforms") or {}).items():
        for ch in channels or []:
            names[f"{platform}:{ch.get('id')}"] = f"{platform} #{ch.get('name')}" if ch.get("name") else f"{platform}:{ch.get('id')}"
    out = []
    for target in (deliver or "local").split(","):
        target = target.strip()
        out.append(names.get(target, target))
    return out


def match_execution(executions: list[dict], when: dt.datetime) -> dict | None:
    """The execution whose [started-10s, finished+60s] window contains the run document time."""
    best = None
    for ex in executions:
        start = parse_dt(ex.get("started_at") or ex.get("claimed_at"))
        end = parse_dt(ex.get("finished_at")) or start
        if not start:
            continue
        if start - dt.timedelta(seconds=10) <= when <= end + dt.timedelta(seconds=60):
            if best is None or start > parse_dt(best.get("started_at") or best.get("claimed_at")):
                best = ex
    return best


# --------------------------------------------------------------------------- collection
def load_jobs() -> dict[str, dict]:
    with open(os.path.join(CRON, "jobs.json"), encoding="utf-8") as fh:
        raw = json.load(fh)
    jobs = raw.get("jobs", raw) if isinstance(raw, dict) else raw
    return {j["id"]: j for j in jobs}


def load_directory() -> dict:
    try:
        with open(os.path.join(HOME, "channel_directory.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def load_executions() -> dict[str, list[dict]]:
    path = os.path.join(CRON, "executions.db")
    by_job: dict[str, list[dict]] = {}
    if not os.path.exists(path):
        return by_job
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        for row in con.execute("SELECT * FROM executions WHERE status IN ('completed','failed','unknown')"):
            by_job.setdefault(row["job_id"], []).append(dict(row))
    finally:
        con.close()
    return by_job


def collect_runs(jobs: dict, executions: dict, directory: dict, redact, known: set[str]) -> list[dict]:
    rows: list[dict] = []
    used_exec: set[str] = set()

    def build(job_id, name_hint, when, doc, ex, source_id):
        job = jobs.get(job_id)
        response = doc.get("response") if doc else None
        failed = bool(ex and ex.get("status") == "failed")
        if not response and not failed:
            return  # silent tick
        exec_id = ex["id"] if ex else source_id
        if ex:
            used_exec.add(exec_id)
        if exec_id in known:
            return
        started = parse_dt(ex.get("started_at")) if ex else None
        finished = parse_dt(ex.get("finished_at")) if ex else None
        error = redact(ex.get("error"))[:ERROR_CAP] if ex and ex.get("error") else None
        text = redact(response)[:RESPONSE_CAP] if response else None
        needs_check, check_reason = check_marker(text)
        skills = (job or {}).get("skills") or (doc or {}).get("skills") or []
        rows.append(
            {
                "execution_id": exec_id,
                "job_id": job_id,
                "job_name": (job or {}).get("name") or name_hint or job_id,
                "kind": kind_of(job, (doc or {}).get("mode")),
                "skills": skills,
                "model": (job or {}).get("model") or DEFAULT_MODEL,
                "status": ex["status"] if ex else "completed",
                "scheduled_at": iso(parse_dt(ex.get("scheduled_instant"))) if ex else None,
                "started_at": iso(started or when),
                "finished_at": iso(finished or when),
                "duration_s": round((finished - started).total_seconds(), 1) if started and finished else None,
                "delivery": {
                    "targets": deliver_labels((job or {}).get("deliver"), directory),
                    "outcome": ex.get("delivery_outcome") if ex else None,
                },
                "summary": summarize(text),
                "response_md": text,
                "error": error,
                "needs_check": needs_check,
                "check_reason": check_reason,
            }
        )

    # 1. run documents (back to September)
    for job_id in sorted(os.listdir(OUTPUT)) if os.path.isdir(OUTPUT) else []:
        job_dir = os.path.join(OUTPUT, job_id)
        if not os.path.isdir(job_dir):
            continue
        for fname in sorted(os.listdir(job_dir)):
            when = md_time(fname)
            if not when:
                continue
            ex = match_execution(executions.get(job_id, []), when)
            source_id = f"file:{job_id}:{fname[:-3]}"
            if (source_id in known or (ex and ex["id"] in known)):
                continue
            with open(os.path.join(job_dir, fname), encoding="utf-8", errors="replace") as fh:
                doc = split_run_document(fh.read())
            build(job_id, doc.get("name"), when, doc, ex, source_id)

    # 2. older single-file outputs: the whole file is the response
    for fname in sorted(os.listdir(OUTPUT)) if os.path.isdir(OUTPUT) else []:
        m = TXT_NAME.match(fname)
        if not m:
            continue
        job_id = m.group(1)
        when = dt.datetime(*map(int, m.groups()[1:]), tzinfo=dt.timezone.utc)
        source_id = f"txt:{job_id}:{fname[13:-4]}"
        if source_id in known:
            continue
        with open(os.path.join(OUTPUT, fname), encoding="utf-8", errors="replace") as fh:
            body = fh.read().strip()
        build(job_id, None, when, {"response": body}, None, source_id)

    # 3. failed executions that never produced a document
    for job_id, items in executions.items():
        for ex in items:
            if ex["status"] == "failed" and ex["id"] not in used_exec:
                when = parse_dt(ex.get("finished_at") or ex.get("started_at") or ex.get("claimed_at"))
                build(job_id, None, when, None, ex, ex["id"])
    return rows


GROUP_PERSIB = "Sejarah Persib"
GROUP_MONEY = "Keuangan"
GROUP_SYSTEM = "Hermes & sistem"
# Jobs whose name/skill/workdir give no hint but belong to a group anyway.
GROUP_OVERRIDES = {"ux-scan-mingguan": GROUP_PERSIB, "post-rekap-logo": GROUP_PERSIB}


def group_for(job: dict) -> str:
    """First guess at an agent's group. It is only written once; after that the website owns it."""
    name = job.get("name") or ""
    if name in GROUP_OVERRIDES:
        return GROUP_OVERRIDES[name]
    text = " ".join([name, " ".join(job.get("skills") or []), job.get("workdir") or ""]).lower()
    if "persib" in text or "klasemen" in text:
        return GROUP_PERSIB
    if "keuangan" in text or "money" in text:
        return GROUP_MONEY
    return GROUP_SYSTEM


def job_rows(jobs: dict, directory: dict) -> list[dict]:
    now = iso(dt.datetime.now(dt.timezone.utc))
    out = []
    for job_id, job in jobs.items():
        out.append(
            {
                "job_id": job_id,
                "name": job.get("name"),
                "kind": kind_of(job, None),
                "skills": job.get("skills") or [],
                "model": job.get("model") or DEFAULT_MODEL,
                "schedule_display": schedule_display(job),
                "state": job.get("state") or ("scheduled" if job.get("enabled") else "paused"),
                "enabled": bool(job.get("enabled")),
                "deliver_labels": deliver_labels(job.get("deliver"), directory),
                "last_status": job.get("last_status"),
                "last_run_at": iso(parse_dt(job.get("last_run_at"))),
                "next_run_at": iso(parse_dt(job.get("next_run_at"))),
                "agent_group": group_for(job),
                "synced_at": now,
            }
        )
    return out



# --------------------------------------------------------------------------- skills
SKILLS_DIR = os.path.join(HOME, "skills")
SKILL_CAP = 60_000
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
OPAQUE_ID = re.compile(r"(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{33,}(?![A-Za-z0-9_-])")


def hide_opaque_ids(text: str) -> str:
    """Long mixed letter/digit tokens (spreadsheet ids, keys that slip past the redactor) are not shown."""
    return OPAQUE_ID.sub("[id hidden]", text)


def split_front_matter(text: str) -> tuple[dict, str]:
    """Tiny front-matter reader: top-level `key: value` lines only (enough for name/description/version)."""
    match = FRONT_MATTER.match(text)
    if not match:
        return {}, text
    meta: dict = {}
    for line in match.group(1).splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$", line)
        if m and m.group(2) and not m.group(2).startswith(("|", ">")):
            meta[m.group(1)] = m.group(2).strip().strip("\"'")
    return meta, text[match.end() :]


def redacted_body(body: str, redact) -> str:
    """What the website shows for a skill: the body with secrets, credential paths and long ids hidden.
    Not stripped and not capped, so it maps line-for-line onto the real file (see apply_skill_changes.py)."""
    return hide_opaque_ids(redact(body) or "")


def body_hash_of(shown: str) -> str:
    return hashlib.sha256(shown.encode("utf-8")).hexdigest()


def is_editable(source: str, has_front_matter: bool, body: str, shown: str) -> bool:
    """Only your own skills, whose redacted text is line-for-line the real text and fits the size cap."""
    return (
        source == "local"
        and has_front_matter
        and len(shown) <= SKILL_CAP
        and "\x00" not in body
        and len(body.split("\n")) == len(shown.split("\n"))
    )


def essential_skills() -> set[str]:
    try:
        sys.path.insert(0, os.path.join(HOME, "hermes-agent"))
        from agent.skill_utils import ESSENTIAL_SKILLS

        return set(ESSENTIAL_SKILLS)
    except Exception:  # noqa: BLE001
        return {"hermes-agent"}


def _bundled_names() -> set[str]:
    try:
        with open(os.path.join(SKILLS_DIR, ".bundled_manifest"), encoding="utf-8") as fh:
            return {line.split(":", 1)[0].strip() for line in fh if ":" in line}
    except OSError:
        return set()


def _hub_names() -> set[str]:
    try:
        with open(os.path.join(SKILLS_DIR, ".hub", "lock.json"), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return set()
    installed = data.get("installed", data) if isinstance(data, dict) else {}
    return set(installed) if isinstance(installed, dict) else set()


def _disabled_skills() -> set[str]:
    try:
        import yaml  # available in the Hermes venv

        with open(os.path.join(HOME, "config.yaml"), encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh) or {}
        names = (cfg.get("skills") or {}).get("disabled") or []
        return {str(n) for n in names}
    except Exception:  # noqa: BLE001 - unreadable config just means "none disabled"
        return set()


def collect_skills(redact) -> list[dict]:
    bundled, hub, disabled, essentials = _bundled_names(), _hub_names(), _disabled_skills(), essential_skills()
    now = iso(dt.datetime.now(dt.timezone.utc))
    rows: list[dict] = []
    if not os.path.isdir(SKILLS_DIR):
        return rows
    for root, dirs, files in os.walk(SKILLS_DIR):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        if "SKILL.md" not in files:
            continue
        rel = os.path.relpath(root, SKILLS_DIR).replace(os.sep, "/")
        category = rel.split("/")[0] if "/" in rel else "uncategorised"
        with open(os.path.join(root, "SKILL.md"), encoding="utf-8", errors="replace") as fh:
            meta, body = split_front_matter(fh.read())
        name = meta.get("name") or os.path.basename(root)
        source = "builtin" if name in bundled else "hub" if name in hub else "local"
        shown = redacted_body(body, redact)
        content = shown[:SKILL_CAP]
        description = hide_opaque_ids(redact(meta.get("description") or "") or "")
        n_files = sum(len(fs) for _, _, fs in os.walk(root))
        editable = is_editable(source, bool(meta), body, shown)
        essential = name in essentials
        parts = [name, category, source, description, str(name not in disabled), meta.get("version", ""), str(n_files), content, str(editable), str(essential)]
        fingerprint = hashlib.sha256("\x00".join(parts).encode()).hexdigest()[:20]
        rows.append(
            {
                "name": name,
                "category": category,
                "source": source,
                "description": description,
                "version": meta.get("version") or None,
                "enabled": name not in disabled,
                "modified": False,
                "files": n_files,
                "content_md": content,
                "body_hash": body_hash_of(shown),
                "editable": editable,
                "essential": essential,
                "content_hash": fingerprint,
                "synced_at": now,
            }
        )
    return rows


# --------------------------------------------------------------------------- Directus
class Directus:
    def __init__(self, token: str):
        self.token = token

    def call(self, method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            DIRECTUS + path,
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "User-Agent": "hermes-sync/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"Directus {method} {path} -> {exc.code}: {detail}") from None
        return json.loads(raw)["data"] if raw else None

    def known_execution_ids(self) -> set[str]:
        rows = self.call("GET", "/items/agent_runs?fields=execution_id&limit=-1") or []
        return {r["execution_id"] for r in rows}

    def create_runs(self, rows: list[dict]) -> int:
        sent, batch, size = 0, [], 0
        for row in rows:
            row_size = len(json.dumps(row))
            if batch and size + row_size > BATCH_BYTES:
                self.call("POST", "/items/agent_runs", batch)
                sent += len(batch)
                batch, size = [], 0
            batch.append(row)
            size += row_size
        if batch:
            self.call("POST", "/items/agent_runs", batch)
            sent += len(batch)
        return sent

    def sync_skills(self, rows: list[dict]) -> tuple[int, int, int]:
        existing = {r["name"]: r for r in self.call("GET", "/items/agent_skills?fields=id,name,content_hash,source&limit=-1") or []}
        new = [r for r in rows if r["name"] not in existing]
        created = 0
        batch, size = [], 0
        for row in new:
            row_size = len(json.dumps(row))
            if batch and size + row_size > BATCH_BYTES:
                self.call("POST", "/items/agent_skills", batch)
                created += len(batch)
                batch, size = [], 0
            batch.append(row)
            size += row_size
        if batch:
            self.call("POST", "/items/agent_skills", batch)
            created += len(batch)
        updated = 0
        for row in rows:
            current = existing.get(row["name"])
            if current is not None and current.get("content_hash") != row["content_hash"]:
                self.call("PATCH", f"/items/agent_skills/{current['id']}", row)
                updated += 1
        wanted = {r["name"] for r in rows}
        gone = 0
        for name, current in existing.items():
            if name not in wanted and current.get("source") != "removed":
                self.call("PATCH", f"/items/agent_skills/{current['id']}", {"source": "removed", "enabled": False})
                gone += 1
        return created, updated, gone

    def sync_jobs(self, rows: list[dict]) -> tuple[int, int]:
        existing = {r["job_id"]: r for r in self.call("GET", "/items/agent_jobs?limit=-1") or []}
        created = updated = 0
        new = [r for r in rows if r["job_id"] not in existing]
        if new:
            self.call("POST", "/items/agent_jobs", new)
            created = len(new)
        for r in rows:
            current = existing.get(r["job_id"])
            if current is None:
                continue
            # synced_at changes every run; only write when something real changed.
            # agent_group is set once: a group already stored (possibly edited on the website) is kept.
            changed = {
                k: v
                for k, v in r.items()
                if k != "synced_at" and not (k == "agent_group" and current.get(k)) and not same_value(current.get(k), v)
            }
            if changed:
                self.call("PATCH", f"/items/agent_jobs/{current['id']}", {**changed, "synced_at": r["synced_at"]})
                updated += 1
        wanted = {r["job_id"] for r in rows}
        for jid, current in existing.items():
            if jid not in wanted and current.get("state") != "removed":
                self.call("PATCH", f"/items/agent_jobs/{current['id']}", {"state": "removed", "enabled": False})
        return created, updated


def same_value(stored, new) -> bool:
    """Compare a Directus value with a freshly computed one (timestamps come back as naive/UTC strings)."""
    if isinstance(new, str) and isinstance(stored, str):
        a, b = parse_dt(stored), parse_dt(new)
        if a and b:
            # Directus keeps milliseconds; the source has microseconds.
            return a.replace(microsecond=a.microsecond // 1000 * 1000) == b.replace(microsecond=b.microsecond // 1000 * 1000)
    return stored == new


def read_token() -> str:
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
    ap.add_argument("--dry-run", action="store_true", help="collect and redact, print counts, upload nothing")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    redact = _redactor()
    jobs, directory, executions = load_jobs(), load_directory(), load_executions()
    client = None if args.dry_run else Directus(read_token())
    known = set() if args.dry_run else client.known_execution_ids()

    runs = collect_runs(jobs, executions, directory, redact, known)
    if args.dry_run:
        skills = collect_skills(redact)
        print(json.dumps({"would_create": len(runs), "jobs": len(jobs), "skills": len(skills)}))
        if args.verbose:
            for r in runs[:5]:
                print(json.dumps({k: (v[:80] if isinstance(v, str) else v) for k, v in r.items()}, ensure_ascii=False))
        return 0

    created = client.create_runs(runs) if runs else 0
    j_new, j_upd = client.sync_jobs(job_rows(jobs, directory))
    s_new, s_upd, s_gone = client.sync_skills(collect_skills(redact))
    if args.verbose:
        print(f"runs +{created}, jobs +{j_new} ~{j_upd}, skills +{s_new} ~{s_upd} -{s_gone}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - any failure must reach the alert channel
        print(f"sync_agent_runs failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
