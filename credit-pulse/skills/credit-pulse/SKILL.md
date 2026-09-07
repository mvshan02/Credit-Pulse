---
name: credit-pulse
description: Check Codex credit balances, quota usage, reset times and warnings, or open the Credit Pulse usage dashboard.
---

# Credit Pulse

Resolve the plugin root two directories above this SKILL.md. Quote all paths.

For a usage check, run `python "<plugin-root>/scripts/pulse.py" --status`.
Report both quota windows, observed credit balance (if available), reset times,
source and observation time. Never equate tokens, quota percentages and credits.
If source is a local snapshot, explicitly say it is historical and may belong to
a previously signed-in account. Missing values mean unknown, not zero.

For a dashboard request, run `python "<plugin-root>/scripts/pulse.py" --open`.
On Windows launch it with Start-Process -WindowStyle Hidden and a quoted
ArgumentList containing the script path and --open, so it survives the command.
The default address is http://127.0.0.1:8765. Check it responds before sharing it.
If the port is occupied by another application, select another --port.

The dashboard refreshes every 60 seconds while open. Its warning threshold,
compact layout and notification preferences are stored in browser localStorage.
Notifications require permission and an open dashboard tab. It cannot enforce
account spending limits or place persistent indicators inside the Codex UI.
Do not change authentication, buy credits, consume resets or send emails.

Use --snapshot-only if the user requests offline mode. No API key is needed;
live checks delegate to the installed Codex app server using its existing login.
