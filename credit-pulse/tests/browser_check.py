"""Optional development check: requires Playwright and installed Microsoft Edge."""
import json
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from pulse import ThreadingHTTPServer, UsageStore, handler_for
from playwright.sync_api import sync_playwright, expect


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(UsageStore(Path.home() / ".codex", True)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1100}, reduced_motion="reduce")
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            data = {"source": "live", "observedAt": time.time(), "plan": "plus", "notice": None,
                    "credits": {"balance": "125", "unlimited": False},
                    "windows": [{"id": "primary", "used": 85, "minutes": 300, "resetsAt": time.time()+3600},
                                {"id": "secondary", "used": 42, "minutes": 10080, "resetsAt": time.time()+86400}]}
            page.add_init_script("""window.alerts = []; window.Notification = class {
              static permission = 'granted'; static async requestPermission() {return 'granted';}
              constructor(title, options) {window.alerts.push({title, options});}
            };""")
            page.route("**/api/usage", lambda route: route.fulfill(json=data))
            page.goto(f"http://127.0.0.1:{server.server_port}")
            expect(page.locator("#pressure")).to_have_text("85%")
            assert page.locator("#health").inner_text() == "Approaching limit"
            page.locator("#notifications").click()
            assert page.evaluate("window.alerts.length") == 1
            page.locator("#refresh").click()
            expect(page.locator("#refresh")).to_be_enabled()
            assert page.evaluate("window.alerts.length") == 1
            page.locator("#threshold").fill("90")
            assert page.locator("#health").inner_text() == "Room to build"
            page.locator("#compact").click()
            page.reload()
            expect(page.locator("#pressure")).to_have_text("85%")
            assert page.locator("body").evaluate("el => el.classList.contains('compact')")
            assert page.locator("#threshold").input_value() == "90"
            page.locator("#compact").click()
            with page.expect_download() as download:
                page.locator("#export").click()
            assert download.value.suggested_filename == "credit-pulse-snapshot.json"
            data["source"] = "snapshot"
            data["windows"][0]["used"] = 100
            data["notice"] = "Historical local snapshot"
            page.locator("#refresh").click()
            expect(page.locator("#pressure")).to_have_text("100%")
            assert page.locator("#health").inner_text() == "Last observed"
            assert page.evaluate("window.alerts.length") == 0
            data["source"] = "live"
            data["windows"][0]["used"] = 65
            data["notice"] = None
            page.locator("#refresh").click()
            expect(page.locator("#pressure")).to_have_text("65%")
            page.screenshot(path=str(Path(__file__).parent / "desktop.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path=str(Path(__file__).parent / "mobile.png"), full_page=True)
            page.unroute("**/api/usage")
            page.route("**/api/usage", lambda route: route.abort())
            page.locator("#refresh").click()
            expect(page.locator("#connection")).to_have_text("Tracker disconnected")
            page.locator("#threshold").fill("50")
            assert page.locator("#health").inner_text() == "Last observed"
            assert page.evaluate("window.alerts.length") == 0
            assert not errors, errors
            browser.close()
            print("Browser checks passed: warnings, deduplication, stale data, settings, export, desktop, mobile, disconnect.")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
