import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import urlopen, Request
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("pulse", Path(__file__).resolve().parents[1] / "scripts/pulse.py")
pulse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pulse)


class UsageTests(unittest.TestCase):
    def test_missing_is_not_zero(self):
        self.assertIsNone(pulse.normalize({}))
        self.assertIsNone(pulse.normalize({"primary": {"usedPercent": None}}))
        self.assertEqual(pulse.normalize({"credits": {"balance": "0"}})["credits"]["balance"], "0")

    def test_schema_variants_and_invalid_values(self):
        for field in ("usedPercent", "used_percent"):
            self.assertEqual(pulse.normalize({"primary": {field: 0}})["windows"][0]["used"], 0)
            for value in (float("nan"), float("inf"), True, -1, "80"):
                self.assertIsNone(pulse.normalize({"primary": {field: value}}))

    def test_snapshot_selects_event_time_and_skips_partial_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / "sessions").mkdir()
            for name, timestamp, used in (("new", "2026-09-07T10:00:00Z", 70), ("old", "2026-09-06T10:00:00Z", 10)):
                event = {"timestamp": timestamp, "type": "event_msg", "payload": {"type": "token_count", "rate_limits": {"primary": {"used_percent": used}}}}
                (home / "sessions" / f"{name}.jsonl").write_text(json.dumps(event) + '\n{"partial":', encoding="utf-8")
            result = pulse.snapshot_usage(home)
            self.assertEqual(result["windows"][0]["used"], 70)
            self.assertEqual(result["source"], "snapshot")

    def test_failure_is_explicit_and_cached(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pulse, "live_usage", side_effect=RuntimeError("Offline")) as live:
            store = pulse.UsageStore(Path(directory))
            self.assertEqual(store.get()["source"], "unavailable")
            self.assertIn("Offline", store.get()["notice"])
            self.assertEqual(live.call_count, 1)

    def test_http_routes_and_host(self):
        with tempfile.TemporaryDirectory() as directory:
            server = pulse.ThreadingHTTPServer(("127.0.0.1", 0), pulse.handler_for(pulse.UsageStore(Path(directory), True)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(base + "/api/usage") as response:
                    self.assertEqual(json.load(response)["source"], "unavailable")
                for path in ("/", "/app.js", "/style.css"):
                    with urlopen(base + path) as response:
                        self.assertEqual(response.status, 200)
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base, headers={"Host": "evil.example"}))
                self.assertEqual(error.exception.code, 403)
                with self.assertRaises(HTTPError) as error:
                    urlopen(base + "/../scripts/pulse.py")
                self.assertEqual(error.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()
