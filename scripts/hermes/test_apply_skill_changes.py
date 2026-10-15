"""Unit tests for apply_skill_changes.py:  python3 -m unittest test_apply_skill_changes"""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import apply_skill_changes as a  # noqa: E402
import sync_agent_runs as s  # noqa: E402

SHEET = "10IQCxWYW1UNqbCX9ClPYsGJCQVcrVga1YSByybOWSNE"
BODY = (
    "# Skill\n\n"
    f"- Spreadsheet ID: `{SHEET}`\n"
    "- Credentials: ~/.hermes/credentials/finance/service-account.json\n"
    "\nSteps:\n1. read the sheet\n2. write the report\n"
)
SKILL_MD = "---\nname: demo-skill\ndescription: Demo.\nversion: 1.0.0\n---\n" + BODY


def redact(text):
    return s.hide_credential_paths(text)


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.shown = s.redacted_body(BODY, redact)

    def test_untouched_hidden_lines_survive_an_edit_elsewhere(self):
        edited = self.shown.replace("2. write the report", "2. write the report\n3. send it")
        merged = a.merge_edit(BODY, self.shown, edited)
        self.assertIn(SHEET, merged)  # the real id is still there
        self.assertIn("credentials/finance/service-account.json", merged)  # and the real path
        self.assertIn("3. send it", merged)

    def test_editing_a_hidden_line_is_refused(self):
        edited = self.shown.replace("[id hidden]", "somethingelse")
        with self.assertRaises(a.Rejected) as ctx:
            a.merge_edit(BODY, self.shown, edited)
        self.assertIn("hidden value", str(ctx.exception))

    def test_removing_a_hidden_line_is_refused(self):
        edited = "\n".join(line for line in self.shown.split("\n") if "Spreadsheet" not in line)
        with self.assertRaises(a.Rejected):
            a.merge_edit(BODY, self.shown, edited)

    def test_a_new_line_may_not_carry_a_placeholder(self):
        edited = self.shown + "\nuse [id hidden] here"
        with self.assertRaises(a.Rejected):
            a.merge_edit(BODY, self.shown, edited)

    def test_unchanged_text_is_identical(self):
        self.assertEqual(a.merge_edit(BODY, self.shown, self.shown), BODY)

    def test_windows_line_endings_are_normalised(self):
        edited = self.shown.replace("\n", "\r\n")
        self.assertEqual(a.merge_edit(BODY, self.shown, edited), BODY)

    def test_deleting_and_inserting_plain_lines(self):
        edited = self.shown.replace("1. read the sheet\n", "")
        self.assertNotIn("1. read the sheet", a.merge_edit(BODY, self.shown, edited))

    def test_line_count_mismatch_means_not_editable(self):
        with self.assertRaises(a.Rejected):
            a.merge_edit("a\nb", "only one line", "x")


class FileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.skills = os.path.join(self.tmp.name, "skills")
        self.dir = os.path.join(self.skills, "productivity", "demo-skill")
        os.makedirs(self.dir)
        self.path = os.path.join(self.dir, "SKILL.md")
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(SKILL_MD)
        self._saved = (s.SKILLS_DIR, a.SKILLS_DIR, a.BACKUP_DIR)
        s.SKILLS_DIR = a.SKILLS_DIR = self.skills
        a.BACKUP_DIR = os.path.join(self.skills, ".web-backups")
        self.shown = s.redacted_body(BODY, redact)
        self.base = s.body_hash_of(self.shown)

    def tearDown(self):
        s.SKILLS_DIR, a.SKILLS_DIR, a.BACKUP_DIR = self._saved
        self.tmp.cleanup()

    def read(self):
        with open(self.path, encoding="utf-8") as fh:
            return fh.read()

    def test_edit_is_applied_backed_up_and_keeps_hidden_values(self):
        new = self.shown.replace("2. write the report", "2. write the report\n3. send it")
        message = a.apply_content("demo-skill", new, self.base, redact)
        text = self.read()
        self.assertIn("Saved", message)
        self.assertIn("3. send it", text)
        self.assertIn(SHEET, text)
        self.assertTrue(text.startswith("---\nname: demo-skill\ndescription: Demo.\nversion: 1.0.0\n---\n"))
        backups = os.listdir(os.path.join(a.BACKUP_DIR, "demo-skill"))
        self.assertEqual(len(backups), 1)
        with open(os.path.join(a.BACKUP_DIR, "demo-skill", backups[0]), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), SKILL_MD)  # the backup is the original, untouched

    def test_stale_base_hash_is_rejected_and_nothing_is_written(self):
        with self.assertRaises(a.Rejected) as ctx:
            a.apply_content("demo-skill", self.shown + "\nx", "0" * 64, redact)
        self.assertIn("changed after you opened it", str(ctx.exception))
        self.assertEqual(self.read(), SKILL_MD)

    def test_identical_text_changes_nothing(self):
        self.assertIn("No change", a.apply_content("demo-skill", self.shown, self.base, redact))
        self.assertFalse(os.path.exists(a.BACKUP_DIR))

    def test_builtin_skills_are_read_only(self):
        with open(os.path.join(self.skills, ".bundled_manifest"), "w", encoding="utf-8") as fh:
            fh.write("demo-skill:abc\n")
        with self.assertRaises(a.Rejected) as ctx:
            a.apply_content("demo-skill", self.shown + "\nx", self.base, redact)
        self.assertIn("read-only", str(ctx.exception))

    def test_unknown_skill(self):
        with self.assertRaises(a.Rejected):
            a.apply_content("nope", "x", self.base, redact)

    def test_name_in_front_matter_cannot_change_through_the_body(self):
        # the body can contain a front-matter-looking block, but the header (and name) stay as they were
        new = self.shown + "\n---\nname: other\n---\n"
        a.apply_content("demo-skill", new, self.base, redact)
        self.assertTrue(self.read().startswith("---\nname: demo-skill\n"))

    def test_only_the_last_backups_are_kept(self):
        for i in range(a.MAX_BACKUPS + 5):
            shown = s.redacted_body(BODY if i == 0 else self.read().split("---\n", 2)[2], redact)
            a.apply_content("demo-skill", shown + f"\nline {i}", s.body_hash_of(shown), redact)
        self.assertEqual(len(os.listdir(os.path.join(a.BACKUP_DIR, "demo-skill"))), a.MAX_BACKUPS)


class HandleTests(unittest.TestCase):
    def row(self, **over):
        base = {"id": 1, "skill": "demo-skill", "action": "set_enabled", "payload": {"enabled": False}, "base_hash": None,
                "requested_at": s.iso(dt.datetime.now(dt.timezone.utc))}
        base.update(over)
        return base

    def test_expired_requests_are_not_applied(self):
        old = s.iso(dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1))
        status, message = a.handle(self.row(requested_at=old), redact)
        self.assertEqual(status, "rejected")
        self.assertIn("waited too long", message)

    def test_bad_names_and_actions(self):
        self.assertEqual(a.handle(self.row(skill="../etc/passwd"), redact)[0], "rejected")
        self.assertEqual(a.handle(self.row(skill=""), redact)[0], "rejected")
        self.assertEqual(a.handle(self.row(action="rm -rf"), redact)[0], "rejected")
        self.assertEqual(a.handle(self.row(action="set_content", payload={}), redact)[0], "rejected")

    def test_essential_skill_cannot_be_disabled(self):
        status, message = a.handle(self.row(skill="hermes-agent"), redact)
        self.assertEqual(status, "rejected")
        self.assertIn("essential", message)

    def test_enabled_flag_must_be_a_real_boolean(self):
        self.assertEqual(a.handle(self.row(payload={"enabled": "yes"}), redact)[0], "rejected")


class EditableTests(unittest.TestCase):
    def test_rules(self):
        shown = s.redacted_body(BODY, redact)
        self.assertTrue(s.is_editable("local", True, BODY, shown))
        self.assertFalse(s.is_editable("builtin", True, BODY, shown))
        self.assertFalse(s.is_editable("local", False, BODY, shown))
        self.assertFalse(s.is_editable("local", True, BODY + "\x00", shown))
        self.assertFalse(s.is_editable("local", True, "a\nb", "a"))  # redaction changed the line count
        self.assertFalse(s.is_editable("local", True, "x" * 70_000, "x" * 70_000))


if __name__ == "__main__":
    unittest.main()
