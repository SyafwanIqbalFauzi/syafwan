import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import sync_accounts as s  # noqa: E402

NOW = s.now_iso(dt.datetime(2026, 10, 27, 7, 0, tzinfo=dt.timezone.utc))
ENTRY = {"provider": "google", "label": "Main", "identifier": "Me@Gmail.com", "token": "/x"}


class ClassifyRefresh(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(s.classify_refresh(200, {"access_token": "a"}), ("connected", ""))

    def test_revoked(self):
        status, detail = s.classify_refresh(400, {"error": "invalid_grant"})
        self.assertEqual(status, "revoked")
        self.assertIn("invalid_grant", detail)

    def test_outage_is_not_revoked(self):
        self.assertEqual(s.classify_refresh(503, {})[0], "error")
        self.assertEqual(s.classify_refresh(200, {})[0], "error")


class BuildRow(unittest.TestCase):
    def test_success_sets_last_ok(self):
        row = s.build_row(ENTRY, "connected", "", ["b", "a"], {"last_ok_at": "old"}, NOW)
        self.assertEqual(row["last_ok_at"], NOW)
        self.assertEqual(row["scopes"], ["a", "b"])
        self.assertIsNone(row["detail"])

    def test_failure_keeps_old_last_ok(self):
        row = s.build_row(ENTRY, "revoked", "nope", [], {"last_ok_at": "old"}, NOW)
        self.assertEqual(row["last_ok_at"], "old")
        self.assertEqual(row["checked_at"], NOW)

    def test_new_account_failing_has_no_last_ok(self):
        self.assertIsNone(s.build_row(ENTRY, "not_connected", "", [], None, NOW)["last_ok_at"])

    def test_label_falls_back_to_identifier(self):
        row = s.build_row({"provider": "google", "identifier": "a@b.c"}, "connected", "", [], None, NOW)
        self.assertEqual(row["label"], "a@b.c")


class Registry(unittest.TestCase):
    def test_skips_incomplete_and_expands_home(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"accounts": [{"provider": "google", "identifier": "a@b.c", "token": "~/t.json"}, {"provider": "google"}, "x"]}, fh)
        try:
            out = s.load_registry(fh.name)
        finally:
            os.unlink(fh.name)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["token"], os.path.expanduser("~/t.json"))


class Checks(unittest.TestCase):
    def test_missing_token_file(self):
        self.assertEqual(s.check_google({**ENTRY, "token": "/nonexistent.json"})[0], "not_connected")

    def test_unknown_provider(self):
        self.assertEqual(s.check_account({"provider": "tiktok", "identifier": "x"})[0], "error")


if __name__ == "__main__":
    unittest.main()
