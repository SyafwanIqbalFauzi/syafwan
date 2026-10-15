"""Unit tests for sync_claude_usage.py:  python3 -m unittest test_sync_claude_usage"""
import datetime as dt
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import sync_claude_usage as u  # noqa: E402

NOW = dt.datetime(2026, 10, 15, 8, 0, tzinfo=dt.timezone.utc)
PAYLOAD = {
    "five_hour": {"utilization": 80.0, "resets_at": "2026-10-15T10:00:00.004002+00:00", "limit_dollars": None},
    "seven_day": {"utilization": 54, "resets_at": "2026-10-18T08:00:01+00:00"},
    "seven_day_opus": None,
    "seven_day_sonnet": {"utilization": 12.34, "resets_at": "2026-10-18T08:00:01Z"},
    "extra_usage": {"is_enabled": False},
    "something_new": {"utilization": 99},
}


class Parse(unittest.TestCase):
    def test_known_windows_become_rows(self):
        rows = {r["window"]: r for r in u.parse_usage(PAYLOAD, NOW)}
        self.assertEqual(set(rows), {"session", "weekly", "weekly_sonnet"})
        self.assertEqual(rows["session"]["percent"], 80.0)
        self.assertEqual(rows["session"]["severity"], "warning")
        self.assertEqual(rows["session"]["resets_at"], "2026-10-15T10:00:00.000Z")
        self.assertEqual(rows["weekly"]["severity"], "normal")
        self.assertEqual(rows["weekly_sonnet"]["percent"], 12.3)
        self.assertEqual(rows["weekly_sonnet"]["resets_at"], "2026-10-18T08:00:01.000Z")
        self.assertEqual(rows["session"]["checked_at"], "2026-10-15T08:00:00.000Z")

    def test_only_numbers_and_times_are_uploaded(self):
        for row in u.parse_usage(PAYLOAD, NOW):
            self.assertEqual(set(row), {"window", "percent", "severity", "resets_at", "checked_at"})

    def test_severity_thresholds(self):
        self.assertEqual([u.severity_for(p) for p in (0, 74.9, 75, 89.9, 90, 100)], ["normal", "normal", "warning", "warning", "critical", "critical"])

    def test_percent_is_clamped_and_junk_is_skipped(self):
        rows = u.parse_usage({"five_hour": {"utilization": 140}, "seven_day": {"utilization": "lots"}, "seven_day_opus": {"utilization": True}}, NOW)
        self.assertEqual([(r["window"], r["percent"]) for r in rows], [("session", 100.0)])

    def test_bad_times_become_none(self):
        rows = u.parse_usage({"five_hour": {"utilization": 5, "resets_at": "tomorrow"}}, NOW)
        self.assertIsNone(rows[0]["resets_at"])

    def test_unrecognised_payloads_give_no_rows(self):
        self.assertEqual(u.parse_usage({}, NOW), [])
        self.assertEqual(u.parse_usage([], NOW), [])
        self.assertEqual(u.parse_usage({"error": "x"}, NOW), [])


class Token(unittest.TestCase):
    def write(self, data):
        fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, fh)
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        return fh.name

    def test_valid_token(self):
        path = self.write({"claudeAiOauth": {"accessToken": "abc", "expiresAt": 2_000_000}})
        self.assertEqual(u.read_access_token(path, now_ms=1_000_000), "abc")

    def test_expired_token_is_unavailable(self):
        path = self.write({"claudeAiOauth": {"accessToken": "abc", "expiresAt": 1_010_000}})
        with self.assertRaises(u.TokenUnavailable):
            u.read_access_token(path, now_ms=1_000_000)  # less than 30 s left counts as expired

    def test_missing_or_broken_file(self):
        with self.assertRaises(u.TokenUnavailable):
            u.read_access_token("/nonexistent/credentials.json")
        with self.assertRaises(u.TokenUnavailable):
            u.read_access_token(self.write({"claudeAiOauth": {}}))
        with self.assertRaises(u.TokenUnavailable):
            u.read_access_token(self.write([1, 2]))

    def test_error_text_never_contains_the_token(self):
        path = self.write({"claudeAiOauth": {"accessToken": "sk-secret-value", "expiresAt": 1}})
        try:
            u.read_access_token(path, now_ms=1_000_000)
        except u.TokenUnavailable as exc:
            self.assertNotIn("sk-secret-value", str(exc))


if __name__ == "__main__":
    unittest.main()
