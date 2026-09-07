"""Dependency-free, read-only Codex usage adapter and loopback dashboard."""
import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
import webbrowser

ROOT = Path(__file__).resolve().parents[1]


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalize(raw):
    if not isinstance(raw, dict):
        return None
    result = {"plan": raw.get("planType", raw.get("plan_type")), "windows": [], "credits": None}
    for key in ("primary", "secondary"):
        window = raw.get(key)
        if not isinstance(window, dict):
            continue
        used = window.get("usedPercent", window.get("used_percent"))
        if not numeric(used) or used < 0:
            continue
        duration = window.get("windowDurationMins", window.get("window_minutes"))
        reset = window.get("resetsAt", window.get("resets_at"))
        result["windows"].append({"id": key, "used": used,
                                  "minutes": duration if numeric(duration) and duration > 0 else None,
                                  "resetsAt": reset if numeric(reset) and reset > 0 else None})
    credits = raw.get("credits")
    if isinstance(credits, dict):
        balance = credits.get("balance")
        result["credits"] = {"balance": str(balance) if isinstance(balance, (str, int, float)) else None,
                             "unlimited": credits.get("unlimited") is True,
                             "hasCredits": credits.get("hasCredits", credits.get("has_credits")) is True}
    return result if result["windows"] or result["credits"] is not None else None


def codex_binary():
    found = shutil.which("codex")
    if found:
        return found
    candidates = list((Path.home() / ".vscode/extensions").glob("openai.chatgpt-*/bin/windows-x86_64/codex.exe"))
    if candidates:
        return str(max(candidates, key=lambda path: path.stat().st_mtime))
    raise RuntimeError("Codex executable not found. Install Codex or use snapshot mode.")


def live_usage(timeout=15):
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen([codex_binary(), "app-server"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, encoding="utf-8", creationflags=flags)
    messages = queue.Queue()

    def reader():
        for line in proc.stdout:
            try:
                messages.put(json.loads(line))
            except ValueError:
                continue
        messages.put(None)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    deadline = time.monotonic() + timeout

    def send(message):
        proc.stdin.write(json.dumps(message) + "\n")
        proc.stdin.flush()

    def receive(identifier):
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("Codex usage request timed out.")
            try:
                message = messages.get(timeout=remaining)
            except queue.Empty as exc:
                raise RuntimeError("Codex usage request timed out.") from exc
            if message is None:
                raise RuntimeError("Codex app server exited before returning usage.")
            if message.get("id") == identifier:
                if "error" in message:
                    raise RuntimeError("Codex could not return usage. Check your Codex sign-in and connection.")
                return message.get("result", {})

    try:
        send({"id": 1, "method": "initialize", "params": {"clientInfo": {
            "name": "credit_pulse", "title": "Credit Pulse", "version": "0.1.0"}}})
        receive(1)
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "account/rateLimits/read", "params": {}})
        response = receive(2)
        buckets = response.get("rateLimitsByLimitId") or {}
        raw = buckets.get("codex") or response.get("rateLimits")
        result = normalize(raw)
        if result is None:
            raise RuntimeError("Codex returned no quota or credit data for this account.")
        return dict(result, source="live", observedAt=time.time(), notice=None)
    finally:
        if proc.poll() is None:
            proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        thread.join(timeout=2)
        proc.stdin.close()
        proc.stdout.close()


def snapshot_usage(home):
    # Read only bounded tails; never return conversation text or auth material.
    candidates = []
    for path in (home / "sessions").rglob("*.jsonl"):
        try:
            candidates.append((path.stat().st_mtime, path))
        except OSError:
            continue
    latest = None
    for _, path in sorted(candidates, reverse=True)[:30]:
        try:
            with path.open("rb") as handle:
                handle.seek(max(0, path.stat().st_size - 2_000_000))
                lines = handle.read().splitlines()
            for line in reversed(lines):
                try:
                    event = json.loads(line)
                    payload = event.get("payload") or {}
                    if event.get("type") != "event_msg" or payload.get("type") != "token_count":
                        continue
                    raw = payload.get("rate_limits")
                    if not isinstance(raw, dict) or raw.get("limit_id") not in (None, "codex"):
                        continue
                    result = normalize(raw)
                    if result is None:
                        continue
                    observed = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
                    stamp = observed.replace(tzinfo=observed.tzinfo or timezone.utc).timestamp()
                    if latest is None or stamp > latest["observedAt"]:
                        latest = dict(result, source="snapshot", observedAt=stamp)
                except (ValueError, KeyError, TypeError, AttributeError, OverflowError):
                    continue
        except OSError:
            continue
    return latest


class UsageStore:
    def __init__(self, home, offline=False):
        self.home, self.offline = home, offline
        self.lock = threading.Lock()
        self.cached, self.checked = None, 0

    def get(self):
        with self.lock:
            if self.cached is not None and time.monotonic() - self.checked < 55:
                return self.cached
            notice = "Offline snapshot mode."
            data = None
            if not self.offline:
                try:
                    data = live_usage()
                except (OSError, RuntimeError, ValueError) as exc:
                    notice = str(exc)
            if data is None:
                data = snapshot_usage(self.home)
                if data:
                    data["notice"] = notice + " Showing a historical local snapshot; it may belong to a previous account."
                else:
                    data = {"source": "unavailable", "observedAt": None, "windows": [],
                            "credits": None, "plan": None, "notice": notice + " No local usage snapshot found."}
            self.cached, self.checked = data, time.monotonic()
            return data


def handler_for(store):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get("Host") not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                self.send_error(403)
                return
            routes = {"/": ("index.html", "text/html; charset=utf-8"),
                      "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                      "/style.css": ("style.css", "text/css; charset=utf-8")}
            if self.path == "/api/usage":
                body, mime = json.dumps(store.get(), allow_nan=False).encode(), "application/json"
            elif self.path in routes:
                filename, mime = routes[self.path]
                body = (ROOT / "assets" / filename).read_bytes()
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true", help="Print a usage snapshot as JSON and exit")
    parser.add_argument("--open", action="store_true", help="Open the dashboard in your browser")
    parser.add_argument("--snapshot-only", action="store_true", help="Read local logs without contacting Codex services")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    store = UsageStore(Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")), args.snapshot_only)
    if args.status:
        print(json.dumps(store.get(), indent=2, allow_nan=False))
        return
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(store))
    except OSError as exc:
        parser.exit(1, f"Cannot start dashboard: {exc}. Try a different --port.\n")
    address = f"http://127.0.0.1:{server.server_port}"
    print(f"Credit Pulse: {address}", flush=True)
    if args.open:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
