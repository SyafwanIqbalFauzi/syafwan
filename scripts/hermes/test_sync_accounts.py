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


def row(status, detail=None, label="Work", ident="w@x.id"):
    return {"provider": "google", "identifier": ident, "label": label, "status": status, "detail": detail}


T0 = "2026-10-27T07:00:00.000Z"
T1 = "2026-10-27T09:10:00.000Z"


class Alerts(unittest.TestCase):
    def run_seq(self, statuses, start=None):
        state, out = start or {}, []
        for st in statuses:
            msgs, state = s.plan_alerts([row(*st) if isinstance(st, tuple) else row(st)], state, T0)
            out.append(msgs)
        return out, state

    def test_healthy_is_silent(self):
        out, _ = self.run_seq(["connected", "connected"])
        self.assertEqual(out, [[], []])

    def test_revoked_alerts_once_then_silent_then_recovers_once(self):
        out, state = self.run_seq([("revoked", "invalid_grant"), "revoked", "revoked"])
        self.assertEqual(len(out[0]), 1)
        self.assertIn("Work (w@x.id) terputus", out[0][0])
        self.assertIn("https://syafwan.com/accounts", out[0][0])
        self.assertEqual(out[1:], [[], []])
        msgs, state = s.plan_alerts([row("connected")], state, T1)
        self.assertEqual(len(msgs), 1)
        self.assertIn("kembali terhubung", msgs[0])
        self.assertIn("2 jam 10 menit", msgs[0])
        self.assertEqual(s.plan_alerts([row("connected")], state, T1)[0], [])

    def test_changed_reason_alerts_again(self):
        out, _ = self.run_seq(["revoked", "mismatch"])
        self.assertEqual([len(m) for m in out], [1, 1])
        self.assertIn("akun lain", out[1][0])

    def test_one_off_error_is_silent_and_resets(self):
        out, state = self.run_seq(["error", "error", "connected", "error", "error"])
        self.assertEqual(out, [[], [], [], [], []])
        self.assertEqual(state["accounts"]["google|w@x.id"]["errors"], 2)

    def test_repeated_error_alerts_once_and_recovers(self):
        out, state = self.run_seq([("error", "Could not reach Google")] * 4)
        self.assertEqual([len(m) for m in out], [0, 0, 1, 0])
        msgs, _ = s.plan_alerts([row("connected")], state, T1)
        self.assertEqual(len(msgs), 1)

    def test_accounts_are_independent_and_removed_ones_drop_out(self):
        rows = [row("revoked", ident="a@x.id", label="A"), row("connected", ident="b@x.id", label="B")]
        msgs, state = s.plan_alerts(rows, {}, T0)
        self.assertEqual(len(msgs), 1)
        self.assertIn("A (a@x.id)", msgs[0])
        _, state = s.plan_alerts(rows[1:], state, T0)
        self.assertEqual(list(state["accounts"]), ["google|b@x.id"])

    def test_other_state_keys_survive_and_bad_state_is_tolerated(self):
        _, state = s.plan_alerts([row("connected")], {"upload_failing": True}, T0)
        self.assertTrue(state["upload_failing"])
        self.assertEqual(len(s.plan_alerts([row("revoked")], {"accounts": "junk"}, T0)[0]), 1)
        self.assertEqual(len(s.plan_alerts([row("revoked")], "junk", T0)[0]), 1)

    def test_state_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "sub", "state.json")
            self.assertEqual(s.load_state(path), {})
            s.save_state({"a": 1}, path)
            self.assertEqual(s.load_state(path), {"a": 1})


class Checks(unittest.TestCase):
    def test_missing_token_file(self):
        self.assertEqual(s.check_google({**ENTRY, "token": "/nonexistent.json"})[0], "not_connected")

    def test_unknown_provider(self):
        self.assertEqual(s.check_account({"provider": "tiktok", "identifier": "x"})[0], "error")


if __name__ == "__main__":
    unittest.main()
