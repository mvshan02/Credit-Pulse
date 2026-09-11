# Credit Pulse

A local-first Codex usage dashboard for VS Code, with an optional always-on-top
Windows robot. Independent community software; not affiliated with OpenAI.

## Quick Start

1. Install the extension and sign in through Codex. Trust your workspace before
   using Credit Pulse. It does not ask for an API key or account password.
2. Open **Credit Pulse: Open Usage Console** from the Command Palette, or click
   the **S % / L %** status-bar item. Hover there for a numeric usage preview.
3. The dashboard stays in VS Code. Click **Desktop** once to open the Windows
   robot above other apps; the same button becomes **Hide Overlay** to close it.
4. Drag the robot anywhere and release it to keep its position. Click to expand
   the card, drag the card's header, and use its compact button to shrink it.

There is only one desktop launcher. In-view float, dock, and duplicate bubble
controls have been removed. Use VS Code's own view-header controls to place the
dashboard in a sidebar or bottom panel. No second VS Code window is created.

After updating, run **Developer: Reload Window** once. The header should show
**V0.9**. Reloading or closing the owning VS Code window closes its desktop robot.

## What Each Section Does

- **Usage:** separate five-hour session and long-window quotas, reset countdowns,
  and configurable warnings. Temporarily missing session buckets after reset are
  explicitly marked as inferred rather than replaced by the long window.
- **Programmer HUD:** session headroom, cache reuse, average request size, chat
  depth, and a heuristic context-efficiency score when local history is enabled.
- **Tailored Advice:** recommendations based on actual quota headroom, reset
  times, cache ratio, request depth, and latest-versus-average token activity.
- **Chats & Requests:** opt-in, expandable local token analytics and search.
- **Console Config:** Matrix, Cyberpunk, Operator, Icecore, and Glass themes;
  circular color swatches, warning thresholds, glow, and reduced-motion-aware
  robot animations.
- **Copy Stats:** quota numbers and anonymous chat/request totals only.

Processed tokens are context telemetry, not billing or exact per-request quota
cost. Credit balance is separate from quota. A quota reset estimate is not a
guarantee of restored capacity; fresh Codex readings take precedence.

## Privacy By Default

History reading is off by default. **Analyze Local History** opts into local
session-log analytics across workspaces. Prompt excerpts are separately off by
default; **Reveal Prompt Excerpts** enables them only in the dashboard. Common
credential patterns are masked, but sensitive text detection is not complete.

Desktop, hover preview, copied stats, and their recommendations remain anonymous
even when dashboard excerpts are enabled. Project paths are not shown. Disabling
history clears results immediately, including outstanding reads. Search text is
not persisted. Existing explicit history preferences are respected on upgrade.

The extension has no analytics endpoint. Codex performs its own authentication
and quota requests. The desktop companion uses private process pipes, not a
network server. See [Privacy](PRIVACY.md) and [Security](SECURITY.md) for details
and limitations.

## Requirements And Limits

- VS Code 1.95 or newer and a locally installed, signed-in Codex executable.
- Windows desktop overlay requires .NET Framework/WPF. Windows x64 is tested;
  the dashboard is retained on other systems, but those systems are not yet part
  of this release's tested platform matrix.
- Desktop uses normal Windows topmost behavior, not secure-desktop or exclusive
  fullscreen overrides. The companion is currently unsigned.
- Local history scans are bounded and skip files over 8 MiB. Logs from earlier
  accounts may exist; historical fallback is labeled and never triggers alerts.
- If automatic Codex discovery fails, set **Credit Pulse: Codex Path** to an
  absolute executable path you trust. Workspace and relative PATH entries are
  not automatically launched.

## Development

There are no third-party npm runtime dependencies. Building the companion uses
the Windows .NET Framework compiler; browser tests additionally need Python,
Playwright, and Edge, and native screenshot tests need Pillow.

```text
node --test tests/*.test.js
python tests/browser_check.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/build_desktop.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/sign_desktop.ps1 -CertificateThumbprint YOUR_40_HEX_THUMBPRINT
python tests/desktop_check.py
python -m unittest discover -s tests -p "test_release*.py"
python tools/package_vsix.py
python tools/release_check.py
code --install-extension credit-pulse-0.9.3.vsix --force
```

Source maintainers: follow `RELEASING.md` before public publication. A local
VSIX is not a Marketplace publication. License: [MIT](LICENSE).

References: [VS Code publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
[webview security](https://code.visualstudio.com/api/extension-guides/webview#security),
[Windows topmost behavior](https://learn.microsoft.com/en-us/dotnet/api/system.windows.window.topmost).
