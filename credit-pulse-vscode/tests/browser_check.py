"""Real Edge UI regressions and browser-enforced webview security checks."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class Handler(BaseHTTPRequestHandler):
    requests = []

    def do_GET(self):
        self.requests.append(self.path)
        if self.path == "/":
            content = (ROOT / "media/widget.html").read_text(encoding="utf-8")
            content = content.replace("{{CSP}}", "'self'").replace("{{NONCE}}", "testnonce")
            body = content.replace("{{STYLE}}", "/widget.css").replace("{{SCRIPT}}", "/widget.js").encode()
            mime = "text/html"
        elif self.path in ("/widget.css", "/widget.js"):
            body = (ROOT / "media" / self.path[1:]).read_bytes()
            mime = "text/css" if self.path.endswith("css") else "application/javascript"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 410, "height": 1050})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("""window.sent = []; window.acquireVsCodeApi = () => ({
              getState: () => JSON.parse(localStorage.getItem('state') || '{}'),
              setState: s => localStorage.setItem('state', JSON.stringify(s)),
              postMessage: m => window.sent.push(m)
            });""")
            page.goto(f"http://127.0.0.1:{server.server_port}")
            now = time.time()
            data = {"source": "live", "observedAt": now, "windows": [
                {"id": "primary", "used": 18, "minutes": 300, "resetsAt": now + 3600},
                {"id": "secondary", "used": 12, "minutes": 10080, "resetsAt": now + 86400}]}
            chats = [{"id": "opaque-id", "title": "Build a usage dashboard", "updatedAt": now*1000,
                      "requestCount": 2, "usage": {"input_tokens": 180000, "cached_input_tokens": 120000,
                      "output_tokens": 12000, "reasoning_output_tokens": 5000, "total_tokens": 192000},
                      "requests": [{"startedAt": now*1000, "preview": "Add chat analytics",
                                    "usage": {"input_tokens": 75000, "output_tokens": 7000, "total_tokens": 82000}}]}]
            matrix = {"safeColor": "#6dff8b", "warningColor": "#ffd166", "dangerColor": "#ff4d6d",
                      "panelBackground": "#050a07", "panelSurface": "#0a1710", "glowIntensity": 90}
            settings = {"threshold": 80, "notifications": True, "emojiAnimations": True,
                        "historyEnabled": True, "showRequestText": True, "themePreset": "matrix", "appearance": matrix}
            advice = ["The 5-hour window is 18% used with 82% headroom and resets in 1h."]
            metrics = {"sessionRemaining": 82, "cacheRatio": 67, "averageRequestTokens": 96000,
                       "requestCount": 2, "efficiencyScore": 79}

            def send(**overrides):
                page.evaluate("m => window.postMessage(m, '*')", {"type": "usage", "data": data,
                              "busy": False, "settings": settings, "chats": chats, "advice": advice,
                              "metrics": metrics, "desktopSupported": True, "desktopActive": False, **overrides})

            expect(page.locator("#history-enabled")).not_to_be_checked()
            settings["historyEnabled"] = False
            settings["showRequestText"] = False
            send()
            expect(page.locator("#history-state")).to_contain_text("off")
            expect(page.locator("#show-request-text")).to_be_disabled()
            page.locator("#history-enabled").check()
            expect(page.locator("#history-state")).to_contain_text("Reading numeric history")
            assert page.evaluate("window.sent.at(-1)") == {"type": "historyEnabled", "value": True}
            settings["historyEnabled"] = True
            anonymous = [{**chats[0], "title": "Chat 1", "requests": [{**chats[0]["requests"][0], "preview": "Request 2"}]}]
            page.evaluate("m => window.postMessage(m, '*')", {"type": "usage", "data": data, "busy": False,
                          "historyBusy": True, "historyError": "", "settings": settings, "chats": [],
                          "advice": [], "metrics": {}, "desktopSupported": True, "desktopActive": False})
            expect(page.locator("#chats")).to_contain_text("ANALYZING LOCAL HISTORY")
            page.evaluate("m => window.postMessage(m, '*')", {"type": "usage", "data": data, "busy": False,
                          "historyBusy": False, "historyError": "", "settings": settings, "chats": anonymous,
                          "advice": advice, "metrics": metrics, "desktopSupported": True, "desktopActive": False})
            expect(page.locator("#history-state")).to_contain_text("Prompt excerpts remain hidden")
            expect(page.locator("#chats")).to_contain_text("Chat 1")
            page.locator("#show-request-text").check()
            expect(page.locator("#history-state")).to_contain_text("Reading and masking")
            assert page.evaluate("window.sent.at(-1)") == {"type": "showRequestText", "value": True}
            settings["showRequestText"] = True
            send(historyBusy=False, historyError="")
            expect(page.locator("#history-state")).to_contain_text("Prompt excerpts are visible")
            expect(page.locator("#chats")).to_contain_text("Build a usage dashboard")
            expect(page.locator("#usage")).to_have_text("18%")
            expect(page.locator("#mascot-face svg")).to_be_visible()
            expect(page.locator(".logo svg")).to_be_visible()
            assert page.locator(".desktop-action").count() == 1
            assert page.locator("#float-toggle,#bubble-toggle,#desktop-overlay,#view-float,#view-bubble,#bubble").count() == 0
            page.locator("#desktop-toggle").click()
            assert page.evaluate("window.sent.at(-1)") == {"type": "desktop", "mode": "bubble"}
            send(desktopStarting=True)
            expect(page.locator("#desktop-toggle")).to_be_disabled()
            send(desktopActive=True)
            expect(page.locator("#desktop-toggle")).to_have_attribute("aria-pressed", "true")
            page.locator("#desktop-toggle").click()
            assert page.evaluate("window.sent.at(-1)") == {"type": "closeDesktop"}
            send(desktopError="Cannot start the desktop overlay.")
            expect(page.locator("#desktop-note")).to_have_text("Cannot start the desktop overlay.")
            send(desktopSupported=False)
            expect(page.locator("#desktop-toggle")).to_be_disabled()
            send()
            expect(page.locator("#metric-cache")).to_have_text("67%")
            expect(page.locator("#metric-average")).to_have_text("96k")
            toggle = page.locator(".chat-toggle").first
            toggle.click()
            send()
            expect(toggle).to_have_attribute("aria-expanded", "false")
            toggle.click()
            expect(page.locator("#chats")).to_contain_text("82k TOTAL")
            page.locator("#chat-filter").fill("analytics")
            expect(page.locator("#chat-count")).to_have_text("1/1")
            assert "analytics" not in page.evaluate("localStorage.getItem('state')")
            page.locator("#chat-filter").fill("missing")
            expect(page.locator("#chats")).to_contain_text("NO MATCHING")
            page.locator("#chat-filter").fill("")
            assert page.locator("#console").evaluate("el => el.scrollLeft") == 0
            page.screenshot(path=str(ROOT / "tests/clean-dashboard.png"), full_page=True)
            page.locator("#settings-panel summary").click()
            for theme in ("cyberpunk", "operator", "ice", "glass", "matrix"):
                page.locator(f"button[data-theme='{theme}']").click()
                expect(page.locator("body")).to_have_attribute("data-theme", theme)
            page.locator("button[data-theme='glass']").click()
            page.screenshot(path=str(ROOT / "tests/glass.png"), full_page=True)
            page.locator("#safe-color").fill("#00ffcc")
            page.locator("#safe-color").dispatch_event("change")
            expect(page.locator("body")).to_have_attribute("data-theme", "custom")
            for swatch in page.locator(".colors input[type=color]").all():
                assert swatch.evaluate("el => [el.offsetWidth,el.offsetHeight,getComputedStyle(el).borderRadius]") == [38, 38, "50%"]
            page.locator("#emoji-animations").uncheck()
            assert page.locator(".robot-art .bubble-eye").first.evaluate("el => getComputedStyle(el).animationName") == "none"
            page.locator("#emoji-animations").check()
            page.locator("#refresh").click()
            page.locator("#copy-snapshot").click()
            for action in ("refresh", "copySnapshot", "themePreset", "appearance", "emojiAnimations"):
                assert any(m.get("type") == action for m in page.evaluate("window.sent"))
            send()
            page.locator("#show-request-text").uncheck()
            expect(page.locator("#chats")).not_to_contain_text("Build a usage dashboard")
            assert page.evaluate("window.sent.at(-1)") == {"type": "showRequestText", "value": False}
            send()
            page.locator("#history-enabled").uncheck()
            expect(page.locator("#chats")).to_contain_text("HISTORY DISABLED")
            expect(page.locator("#show-request-text")).to_be_disabled()

            # Host content stays text; CSP must block actual script/network injection.
            attack = '<img src="/leak" onerror="window.injected=true"><script>window.injected=true</script>'
            chats[0]["title"] = attack
            chats[0]["requests"][0]["preview"] = attack
            advice[:] = [attack]
            send()
            expect(page.locator("#chats")).to_contain_text(attack)
            assert page.locator("#chats img,#chats script,#advice img,#advice script").count() == 0
            page.evaluate("() => {const s=document.createElement('script');s.textContent='window.injected=true';document.body.append(s);}")
            assert page.evaluate("window.injected") is None
            assert page.evaluate("async () => {try{await fetch('/blocked');return 'allowed';}catch{return 'blocked';}}") == "blocked"
            page.evaluate("() => {const img=document.createElement('img');img.src='/image-leak';document.body.append(img);}")
            page.wait_for_timeout(200)
            assert not any(item in Handler.requests for item in ("/leak", "/blocked", "/image-leak"))
            data["windows"][0].update({"used": 0, "estimated": True})
            data["windows"][1]["used"] = 94
            send()
            expect(page.locator("#usage")).to_have_text("0%")
            expect(page.locator("#estimate-badge")).to_be_visible()
            expect(page.locator("#mascot-face")).to_have_attribute("aria-label", "QUOTA RUNNING HOT")
            page.emulate_media(reduced_motion="reduce")
            assert page.locator("#cheer span").first.evaluate("el => getComputedStyle(el).animationName") == "none"
            for width in (230, 300, 600, 1000):
                page.set_viewport_size({"width": width, "height": 900})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert page.locator(".hero").evaluate("el => {const a=el.getBoundingClientRect(),b=document.querySelector('#console').getBoundingClientRect();return a.left>b.left&&a.right<b.right;}")
            page.evaluate("localStorage.setItem('state',JSON.stringify({bubble:true,floating:true,chatFilter:'private-old-search'}))")
            page.reload()
            expect(page.locator("#desktop-toggle")).to_be_visible()
            expect(page.locator("#chat-filter")).to_have_value("")
            assert "private-old-search" not in page.evaluate("localStorage.getItem('state')")
            assert not errors, errors
            browser.close()
            print("UI/security browser tests passed: single desktop control, privacy clearing, no persisted search, CSP script/network/image blocks, XSS text rendering, themes, colors, quotas, history, reduced motion and responsive layouts.")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
