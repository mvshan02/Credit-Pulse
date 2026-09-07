# Credit Pulse

A Codex skill plugin with a local, animated blue-to-red usage dashboard.
Requires Python 3.10+ and a signed-in Codex CLI or Windows VS Code Codex extension.
No third-party Python packages, API keys, external fonts or analytics.

## Run

```powershell
python .\scripts\pulse.py --open
python .\scripts\pulse.py --status
python .\scripts\pulse.py --snapshot-only --open
```

Run these commands from the `credit-pulse` directory. The dashboard is served at
http://127.0.0.1:8765. Use `--port 8766` if that port is busy. Ctrl+C stops it.
After installing the plugin, ask Codex: "Open Credit Pulse" or "Check my usage".

## Features and limits

- Primary and secondary quota windows, reset countdowns, reported credit balance.
- Animated ring and bars, responsive layout, reduced-motion support, compact mode.
- Configurable 50-95% early warning threshold saved in this browser.
- Opt-in browser notifications while the dashboard tab remains open; browsers may throttle background tabs.
- Read-only JSON export and automatic checks every 60 seconds (55-second server cache).
- No account spending enforcement or modifications to the Codex application's UI.

Live data comes from the official Codex app-server `account/rateLimits/read`
method using the existing Codex login. This starts no model turns and never buys
credits, redeems resets or sends messages. It only displays the main Codex bucket.
Credit balances are displayed exactly as reported, without currency conversion.

If live lookup fails, a bounded scan of the latest 30 local session logs reads
only usage event data from their last 2 MB. This is a best-effort compatibility
fallback, not a stable API or complete history. Local snapshots may be stale or
belong to a previous login. Their age and source remain visible; they never
trigger desktop alerts. Unknown values are never replaced with fabricated usage.
No conversation text or authentication data is served to the browser.

The server binds only to loopback, checks Host, and serves an explicit route list.
Anyone with access to this machine can view the local usage page while it runs.
Warning preferences live in localStorage; usage is not persisted by this plugin.

## Validate

```powershell
python -m unittest discover -s tests -v
```

Official protocol: https://learn.chatgpt.com/docs/app-server
