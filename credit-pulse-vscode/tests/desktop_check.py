"""Exercise the real Windows overlay through its private parent-process pipe."""
import ctypes
import json
from pathlib import Path
import queue
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    ctypes.windll.user32.SetProcessDPIAware()
    process = subprocess.Popen([str(ROOT / "desktop/bin/CreditPulse.Desktop.exe")],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
    messages = queue.Queue()

    def read():
        for line in process.stdout:
            messages.put(json.loads(line))

    threading.Thread(target=read, daemon=True).start()

    def send(message):
        process.stdin.write(json.dumps(message) + "\n")
        process.stdin.flush()

    def receive(kind):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            message = messages.get(timeout=max(.1, deadline - time.monotonic()))
            assert message["type"] != "error", message
            if message["type"] == kind:
                return message
        raise AssertionError(f"Missing native message: {kind}")

    def inspect():
        send({"type": "inspect"})
        return receive("inspection")

    try:
        receive("ready")
        send({"type": "initialize", "mode": "bubble", "position": {"x": -100000, "y": -100000}})
        now = time.time()
        usage = {"type": "usage", "data": {"source": "live", "observedAt": now,
                  "windows": [{"id": "primary", "used": 18, "resetsAt": now + 3600},
                              {"id": "secondary", "used": 35, "resetsAt": now + 86400}]},
                 "settings": {"threshold": 80, "emojiAnimations": True,
                              "appearance": {"safeColor": "#7ff7df", "warningColor": "#ffd27d",
                                             "dangerColor": "#ff6685", "panelBackground": "#0a1220",
                                             "panelSurface": "#20344c"}},
                 "advice": ["Session has 82% headroom and resets in one hour.",
                            "Keep related edits and tests together in this request."],
                 "chats": [{"title": "Desktop overlay", "requestCount": 3,
                            "usage": {"total_tokens": 56000}, "requests": []}]}
        send(usage)
        time.sleep(.5)
        first = inspect()
        assert first["bubble"] and first["topmost"] and first["nativeTopmost"]
        assert not first["showInTaskbar"]
        assert first["session"] == "18%" and first["longWindow"] == "35%"
        assert first["adviceCount"] == 2
        assert first["x"] > -100000 and first["y"] > -100000
        assert first["width"] == first["height"]
        from PIL import ImageGrab
        ImageGrab.grab(bbox=(first["x"], first["y"], first["x"] + first["width"], first["y"] + first["height"]), all_screens=True).save(ROOT / "tests/desktop-bubble.png")

        # WPF hit testing uses the real cursor. Restore it after this targeted click.
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        class Point(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
        cursor = Point()
        user32.GetCursorPos(ctypes.byref(cursor))
        try:
            start_x = first["x"] + first["width"] // 2
            start_y = first["y"] + first["height"] // 2
            user32.SetCursorPos(start_x, start_y)
            time.sleep(.1)
            user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(.1)
            # One fast move leaves the bubble before its next hit test.
            user32.SetCursorPos(start_x + 280, start_y + 180)
            time.sleep(.15)
            user32.mouse_event(0x0004, 0, 0, 0, 0)
            time.sleep(.3)
        finally:
            user32.mouse_event(0x0004, 0, 0, 0, 0)
            user32.SetCursorPos(cursor.x, cursor.y)
        dragged = inspect()
        assert dragged["bubble"], "Dragging must not expand the bubble"
        assert abs(dragged["x"] - first["x"] - 280) < 4, ("Bubble must stay where released, not at a screen edge", first, dragged)
        assert abs(dragged["y"] - first["y"] - 180) < 4
        first = dragged
        try:
            user32.SetCursorPos(first["x"] + first["width"] // 2, first["y"] + first["height"] // 2)
            time.sleep(.1)
            user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(.05)
            user32.mouse_event(0x0004, 0, 0, 0, 0)
            time.sleep(.2)
        finally:
            user32.SetCursorPos(cursor.x, cursor.y)
        time.sleep(.5)
        expanded = inspect()
        assert not expanded["bubble"], "Clicking the desktop robot must open the card"
        assert expanded["width"] > first["width"] * 3
        assert expanded["nativeTopmost"]
        ImageGrab.grab(bbox=(expanded["x"], expanded["y"], expanded["x"] + expanded["width"], expanded["y"] + expanded["height"]), all_screens=True).save(ROOT / "tests/desktop-card.png")
        try:
            start_x, start_y = expanded["x"] + 75, expanded["y"] + 45
            user32.SetCursorPos(start_x, start_y)
            time.sleep(.1)
            user32.mouse_event(0x0002, 0, 0, 0, 0)
            for step in range(1, 7):
                user32.SetCursorPos(start_x + 30 * step, start_y + 10 * step)
                time.sleep(.04)
            user32.mouse_event(0x0004, 0, 0, 0, 0)
            time.sleep(.2)
        finally:
            user32.mouse_event(0x0004, 0, 0, 0, 0)
            user32.SetCursorPos(cursor.x, cursor.y)
        moved = inspect()
        assert moved["x"] > expanded["x"] + 100, "Dragging the native header must move the desktop window"

        usage["data"]["windows"][0]["used"] = 94
        send(usage)
        updated = inspect()
        assert updated["session"] == "94%"
        assert updated["accent"] != first["accent"]
        send({"type": "mode", "mode": "bubble"})
        assert inspect()["bubble"]
        process.stdin.close()
        process.wait(timeout=8)
        assert process.returncode == 0
        print("Native desktop tests passed: actual topmost window, desktop dragging, off-screen recovery, click-to-expand, private live updates, theme colors, bubble/card modes, and automatic shutdown on parent disconnect.")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=8)


if __name__ == "__main__":
    main()
