"""Unit tests for sync_agent_runs.py:  python3 -m unittest scripts/hermes/test_sync_agent_runs.py"""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import sync_agent_runs as s  # noqa: E402

DOC = """# Cron Job: insight-mingguan-keuangan

**Job ID:** 210fb7f35b3d
**Run Time:** 2026-10-11 12:01:13
**Schedule:** 0 12 * * 0

## Prompt

[IMPORTANT: The user has invoked the "insight-mingguan-keuangan" skill, indicating they want you to follow its instructions.]

## Kredensial & lokasi sheet

- Spreadsheet ID: `10IQCxWYW1UNqbCX9ClPYsGJCQVcrVga1YSByybOWSNE`
- Service account JSON: `~/.hermes/credentials/catat-money-keuangan/service-account.json`

## Response

Insights Mingguan

## Isi laporan
Total: Rp1.615.465
"""


class SkillTests(unittest.TestCase):
    def test_front_matter(self):
        meta, body = s.split_front_matter("---\nname: my-skill\ndescription: Does a thing.\nversion: 1.2.0\nmetadata:\n  x: 1\n---\n\n# Title\ntext")
        self.assertEqual(meta, {"name": "my-skill", "description": "Does a thing.", "version": "1.2.0"})
        self.assertTrue(body.lstrip().startswith("# Title"))

    def test_no_front_matter(self):
        meta, body = s.split_front_matter("# Just text")
        self.assertEqual(meta, {})
        self.assertEqual(body, "# Just text")

    def test_long_opaque_ids_are_hidden_but_words_are_not(self):
        sheet = "10IQCxWYW1UNqbCX9ClPYsGJCQVcrVga1YSByybOWSNE"
        text = "Spreadsheet ID: `%s` and slug sejarah-persib-feature-delivery-workflow-notes-here" % sheet
        out = s.hide_opaque_ids(text)
        self.assertNotIn(sheet, out)
        self.assertIn("[id hidden]", out)
        self.assertIn("sejarah-persib-feature-delivery-workflow-notes-here", out)
        self.assertEqual(s.hide_opaque_ids("short abc123 token"), "short abc123 token")

    def test_collect_skills_classifies_source_and_masks(self):
        import tempfile

        with tempfile.TemporaryDirectory() as home:
            skills = os.path.join(home, "skills")
            for rel, text in {
                "productivity/mine/SKILL.md": "---\nname: mine\ndescription: My own.\n---\nSheet 10IQCxWYW1UNqbCX9ClPYsGJCQVcrVga1YSByybOWSNE\nsee ~/.hermes/credentials/x/service-account.json\n",
                "productivity/stock/SKILL.md": "---\nname: stock\ndescription: Bundled.\n---\nhello",
                ".archive/old/SKILL.md": "---\nname: old\n---\nx",
            }.items():
                path = os.path.join(skills, rel)
                os.makedirs(os.path.dirname(path))
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
            with open(os.path.join(skills, ".bundled_manifest"), "w", encoding="utf-8") as fh:
                fh.write("stock:abc123\n")
            old_home, old_dir = s.HOME, s.SKILLS_DIR
            s.HOME, s.SKILLS_DIR = home, skills
            try:
                rows = {r["name"]: r for r in s.collect_skills(s.hide_credential_paths)}
            finally:
                s.HOME, s.SKILLS_DIR = old_home, old_dir
            self.assertEqual(set(rows), {"mine", "stock"})  # hidden dirs (.archive) are skipped
            self.assertEqual(rows["mine"]["source"], "local")
            self.assertEqual(rows["stock"]["source"], "builtin")
            self.assertEqual(rows["mine"]["category"], "productivity")
            self.assertNotIn("10IQCxWYW1U", rows["mine"]["content_md"])
            self.assertIn("credentials/[hidden]", rows["mine"]["content_md"])
            self.assertTrue(rows["mine"]["enabled"])


class GroupTests(unittest.TestCase):
    def test_rules(self):
        self.assertEqual(s.group_for({"name": "monitoring-jadwal-persib", "skills": ["monitoring-jadwal-persib"]}), "Sejarah Persib")
        self.assertEqual(s.group_for({"name": "update-klasemen-berjalan"}), "Sejarah Persib")
        self.assertEqual(s.group_for({"name": "x", "workdir": "/home/syafwan/sejarah-persib"}), "Sejarah Persib")
        self.assertEqual(s.group_for({"name": "insight-mingguan-keuangan", "skills": ["insight-mingguan-keuangan"]}), "Keuangan")
        self.assertEqual(s.group_for({"name": "log-token-harian", "skills": ["log-token-usage"]}), "Hermes & sistem")
        self.assertEqual(s.group_for({"name": "backup-hermes-config"}), "Hermes & sistem")

    def test_overrides_for_jobs_without_a_hint(self):
        self.assertEqual(s.group_for({"name": "ux-scan-mingguan"}), "Sejarah Persib")
        self.assertEqual(s.group_for({"name": "post-rekap-logo"}), "Sejarah Persib")

    def test_job_rows_carry_the_group(self):
        rows = s.job_rows({"a": {"id": "a", "name": "ide-konten-persib", "enabled": True}}, {})
        self.assertEqual(rows[0]["agent_group"], "Sejarah Persib")


class CompareTests(unittest.TestCase):
    def test_timestamps_compare_by_instant(self):
        self.assertTrue(s.same_value("2026-10-15T04:00:00", "2026-10-15T04:00:00+00:00"))
        self.assertFalse(s.same_value("2026-10-15T04:00:00", "2026-10-15T05:00:00+00:00"))

    def test_millisecond_storage_matches_microsecond_source(self):
        self.assertTrue(s.same_value("2026-10-15T00:03:26.509Z", "2026-10-15T00:03:26.509840+00:00"))

    def test_plain_values(self):
        self.assertTrue(s.same_value(["a"], ["a"]))
        self.assertFalse(s.same_value("scheduled", "paused"))
        self.assertTrue(s.same_value(None, None))


class RedactTests(unittest.TestCase):
    def test_credential_paths_are_hidden(self):
        out = s.hide_credential_paths("cat ~/.hermes/credentials/catat-money/service-account.json then")
        self.assertEqual(out, "cat ~/.hermes/credentials/[hidden] then")
        self.assertEqual(s.hide_credential_paths("ls ~/.hermes/credentials/ 2>/dev/null"), "ls ~/.hermes/credentials/ 2>/dev/null")


class ParseTests(unittest.TestCase):
    def test_response_only_and_prompt_dropped(self):
        meta = s.split_run_document(DOC)
        self.assertEqual(meta["name"], "insight-mingguan-keuangan")
        self.assertTrue(meta["response"].startswith("Insights Mingguan"))
        self.assertIn("Rp1.615.465", meta["response"])
        for secret in ("10IQCxWYW1U", "service-account", "credentials/", "## Prompt"):
            self.assertNotIn(secret, meta["response"])

    def test_skill_name_taken_from_prompt_header_only(self):
        self.assertEqual(s.split_run_document(DOC)["skills"], ["insight-mingguan-keuangan"])

    def test_silent_tick_has_no_response(self):
        silent = "# Cron Job: x\n\n**Job ID:** a\n**Mode:** no_agent (script)\n**Status:** silent (empty output)\n"
        meta = s.split_run_document(silent)
        self.assertIsNone(meta["response"])
        self.assertIn("no_agent", meta["mode"])

    def test_response_marker_inside_prompt_is_ignored(self):
        doc = "# Cron Job: j\n\n## Prompt\n\ntext\n## Response\nfake inside prompt\n\n## Response\n\nreal answer\n"
        self.assertEqual(s.split_run_document(doc)["response"], "real answer")

    def test_md_time(self):
        self.assertEqual(s.md_time("2026-10-11_12-01-13.md"), dt.datetime(2026, 10, 11, 12, 1, 13, tzinfo=dt.timezone.utc))
        self.assertIsNone(s.md_time("notes.md"))

    def test_summary_is_flat_and_short(self):
        out = s.summarize("# Title\n\n**bold** line\nsecond | cell\n" + "x" * 500)
        self.assertNotIn("\n", out)
        self.assertNotIn("**", out)
        self.assertLessEqual(len(out), s.SUMMARY_CAP)

    def test_match_execution_window(self):
        ex = {"id": "e1", "started_at": "2026-10-11T12:00:46+00:00", "finished_at": "2026-10-11T12:01:16+00:00"}
        near = dt.datetime(2026, 10, 11, 12, 1, 13, tzinfo=dt.timezone.utc)
        far = dt.datetime(2026, 10, 11, 14, 0, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(s.match_execution([ex], near)["id"], "e1")
        self.assertIsNone(s.match_execution([ex], far))

    def test_deliver_labels_use_directory_names(self):
        directory = {"platforms": {"discord": [{"id": "1", "name": "agent-ui-ux"}]}}
        self.assertEqual(s.deliver_labels("discord:1,telegram:9,local", directory), ["discord #agent-ui-ux", "telegram:9", "local"])

    def test_kind(self):
        self.assertEqual(s.kind_of({"no_agent": True}, None), "script")
        self.assertEqual(s.kind_of({"no_agent": False}, None), "agent")
        self.assertEqual(s.kind_of(None, "no_agent (script)"), "script")


if __name__ == "__main__":
    unittest.main()
