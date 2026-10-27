import datetime as dt
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import apply_account_requests as a  # noqa: E402

def dump(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh)


def load(path):
    with open(path) as fh:
        return json.load(fh)


CLIENT = {"client_id": "cid", "client_secret": "sec", "token_uri": "https://oauth2.googleapis.com/token"}


class Validation(unittest.TestCase):
    def test_email(self):
        self.assertEqual(a.valid_email("  Me@Braga.co.id "), "me@braga.co.id")
        for bad in ["", "x", "a@b", "a b@c.com", None, 5, "a@" + "b" * 300 + ".com"]:
            with self.assertRaises(a.Rejected):
                a.valid_email(bad)

    def test_label(self):
        self.assertEqual(a.valid_label(" Work "), "Work")
        for bad in ["", "   ", "x" * 41, "a\nb", None]:
            with self.assertRaises(a.Rejected):
                a.valid_label(bad)

    def test_slug(self):
        self.assertEqual(a.slugify("Sejarah Persib!"), "sejarah-persib")
        self.assertEqual(a.slugify("!!!"), "account")


class Oauth(unittest.TestCase):
    def test_pkce_challenge_matches_verifier(self):
        import base64, hashlib

        verifier, challenge = a.pkce_pair()
        self.assertEqual(challenge, base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode())

    def test_auth_url(self):
        url = a.build_auth_url("cid", "st", "ch", "me@x.id")
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        self.assertTrue(url.startswith("https://accounts.google.com/o/oauth2/auth?"))
        self.assertEqual(q["login_hint"], ["me@x.id"])
        self.assertEqual(q["access_type"], ["offline"])
        self.assertEqual(q["scope"][0].split(), a.SCOPES)

    def test_parse_redirect(self):
        url = "http://localhost:1/?state=abc&iss=https://accounts.google.com&code=4/0AXl_q-9&scope=https://www.googleapis.com/auth/drive%20x"
        self.assertEqual(a.parse_redirect(url), ("4/0AXl_q-9", "abc"))
        self.assertEqual(a.parse_redirect("4/0AXl_q-9"), ("4/0AXl_q-9", None))
        self.assertEqual(a.parse_redirect("code=abc&state=s"), ("abc", "s"))
        for bad in ["", "   ", "http://localhost:1/?foo=bar", "hello world", "x" * 5000, "http://localhost:1/?error=access_denied"]:
            with self.assertRaises(a.Rejected):
                a.parse_redirect(bad)

    def test_missing_scopes(self):
        self.assertEqual(a.missing_scopes(list(a.SCOPES)), [])
        self.assertEqual(a.missing_scopes(a.SCOPES[1:]), [a.SCOPES[0]])

    def test_token_payload_shape_matches_existing_tokens(self):
        now = dt.datetime(2026, 10, 27, 7, 0, tzinfo=dt.timezone.utc)
        p = a.token_payload({"access_token": "at", "refresh_token": "rt", "expires_in": 3599, "scope": " ".join(a.SCOPES)}, CLIENT, now)
        self.assertEqual(p["type"], "authorized_user")
        self.assertEqual(p["expiry"], "2026-10-27T07:59:59.000000Z")
        self.assertEqual(sorted(p["scopes"]), sorted(a.SCOPES))
        self.assertEqual({"token", "refresh_token", "token_uri", "client_id", "client_secret", "scopes", "type"} - set(p), set())


class Registry(unittest.TestCase):
    def test_register_adds_once(self):
        accounts = [{"provider": "google", "label": "Main", "identifier": "m@x.id", "token": "/t/m.json"}]
        out = a.register(accounts, "w@x.id", "Work", "/t/work.json")
        self.assertEqual([x["identifier"] for x in out], ["m@x.id", "w@x.id"])
        self.assertEqual(a.register(out, "W@x.id".lower(), "Other", "/t/o.json"), out)

    def test_free_token_path_avoids_collisions(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "work.json"), "w").close()
            self.assertEqual(a.free_token_path([], "Work", d), os.path.join(d, "work-2.json"))
            self.assertEqual(a.free_token_path([{"token": os.path.join(d, "work-2.json")}], "Work", d), os.path.join(d, "work-3.json"))


class Flow(unittest.TestCase):
    """start + finish against a temp HOME, with Google faked."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(dir=os.environ.get("TMPDIR"))
        for name, value in {
            "PENDING_DIR": os.path.join(self.tmp, "pending"),
            "TOKEN_DIR": os.path.join(self.tmp, "tokens"),
            "REGISTRY": os.path.join(self.tmp, "accounts.json"),
            "CLIENT_SECRET": os.path.join(self.tmp, "client.json"),
        }.items():
            p = mock.patch.object(a, name, value)
            p.start()
            self.addCleanup(p.stop)
        for path in (a.PENDING_DIR, a.TOKEN_DIR, a.REGISTRY, a.CLIENT_SECRET):
            assert path.startswith(self.tmp), f"test would touch the real home: {path}"
        dump(a.CLIENT_SECRET, {"installed": CLIENT})
        dump(a.REGISTRY, {"accounts": [{"provider": "google", "label": "Main", "identifier": "m@x.id", "token": os.path.join(self.tmp, "main.json")}]})

    def google(self, email="w@x.id", scopes=None, refresh: str | None = "rt", code=200):
        def fake(url, form=None, bearer=None):
            if "gmail" in url:
                return 200, {"emailAddress": email}
            if code != 200:
                return code, {"error": "invalid_grant"}
            body = {"access_token": "at", "expires_in": 3600, "scope": " ".join(a.SCOPES if scopes is None else scopes)}
            if refresh:
                body["refresh_token"] = refresh
            return 200, body

        return mock.patch.object(a, "http_json", fake)

    def start(self, identifier="w@x.id", label="Work"):
        url = a.do_start({"identifier": identifier, "label": label})
        return urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["state"][0]

    def test_full_flow_saves_token_and_registers(self):
        state = self.start()
        with self.google():
            msg = a.do_finish({"identifier": "w@x.id", "payload": f"http://localhost:1/?state={state}&code=c0de"})
        self.assertIn("Connected", msg)
        token_file = os.path.join(self.tmp, "tokens", "work.json")
        self.assertEqual(load(token_file)["refresh_token"], "rt")
        self.assertEqual(oct(os.stat(token_file).st_mode & 0o777), "0o600")
        reg = load(a.REGISTRY)["accounts"]
        self.assertEqual([x["identifier"] for x in reg], ["m@x.id", "w@x.id"])
        self.assertFalse(os.listdir(a.PENDING_DIR))

    def test_wrong_google_account_saves_nothing(self):
        state = self.start()
        with self.google(email="someone.else@x.id"):
            with self.assertRaises(a.Rejected) as cm:
                a.do_finish({"identifier": "w@x.id", "payload": f"?state={state}&code=c"})
        self.assertIn("someone.else@x.id", str(cm.exception))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "tokens", "work.json")))
        self.assertEqual(len(load(a.REGISTRY)["accounts"]), 1)

    def test_state_mismatch_missing_scope_no_refresh_token_and_google_error(self):
        state = self.start()
        with self.google():
            with self.assertRaises(a.Rejected):
                a.do_finish({"identifier": "w@x.id", "payload": "?state=other&code=c"})
        with self.google(scopes=a.SCOPES[:-1]):
            with self.assertRaises(a.Rejected) as cm:
                a.do_finish({"identifier": "w@x.id", "payload": f"?state={state}&code=c"})
        self.assertIn("documents", str(cm.exception))
        with self.google(refresh=None):
            with self.assertRaises(a.Rejected):
                a.do_finish({"identifier": "w@x.id", "payload": f"?state={state}&code=c"})
        with self.google(code=400):
            with self.assertRaises(a.Rejected):
                a.do_finish({"identifier": "w@x.id", "payload": f"?state={state}&code=c"})
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "tokens", "work.json")))

    def test_finish_without_start_and_expired(self):
        with self.assertRaises(a.Rejected):
            a.do_finish({"identifier": "w@x.id", "payload": "code=c"})
        self.start()
        with mock.patch.object(a, "MAX_PENDING_AGE_S", -1):
            with self.assertRaises(a.Rejected):
                a.do_finish({"identifier": "w@x.id", "payload": "code=c"})

    def test_start_rules_for_new_and_existing(self):
        with self.assertRaises(a.Rejected):
            a.do_start({"identifier": "new@x.id", "label": ""})  # a new account needs a name
        with self.assertRaises(a.Rejected):
            a.do_start({"identifier": "new@x.id", "label": "main"})  # name already used
        url = a.do_start({"identifier": "M@x.id"})  # existing account: reconnect, no label needed
        self.assertIn("login_hint=m%40x.id", url)

    def test_reconnect_overwrites_the_existing_token_file(self):
        main_token = os.path.join(self.tmp, "main.json")
        dump(main_token, {"old": True})
        state = self.start(identifier="m@x.id", label="ignored")
        with self.google(email="m@x.id"):
            a.do_finish({"identifier": "m@x.id", "payload": f"?state={state}&code=c"})
        self.assertEqual(load(main_token)["refresh_token"], "rt")
        self.assertEqual(len(load(a.REGISTRY)["accounts"]), 1)


class Process(unittest.TestCase):
    def test_outcomes_written_back_and_payload_cleared(self):
        calls = []

        class Fake:
            def call(self, method, path, body=None):
                calls.append((method, path, body))
                if method == "GET":
                    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
                    return [{"id": 1, "action": "start", "identifier": "bad", "requested_at": a.sa.now_iso()}, {"id": 2, "action": "start", "identifier": "x@y.id", "requested_at": old}]

        a.process(Fake())
        patches = [c for c in calls if c[0] == "PATCH"]
        self.assertEqual([p[2]["status"] for p in patches], ["failed", "failed"])
        self.assertTrue(all(p[2]["payload"] is None for p in patches))
        self.assertIn("valid email", patches[0][2]["result"])
        self.assertIn("expired", patches[1][2]["result"])


if __name__ == "__main__":
    unittest.main()
