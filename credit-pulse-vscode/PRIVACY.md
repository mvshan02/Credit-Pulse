# Privacy

Credit Pulse is an independent, local-first usage monitor, not an OpenAI product.
It does not operate a telemetry server, collect analytics, or upload your chats.

## Data Access

- Live quotas: starts the installed Codex executable with `app-server`, performs
  initialization and `account/rateLimits/read`, then closes it. Codex handles its
  own authentication and any network communication with OpenAI. Credit Pulse
  does not read `auth.json`, request your password/API key, or copy access tokens.
- History: OFF by default. **Analyze Local History** opts into reading recent
  JSONL files under `CODEX_HOME/sessions` or `~/.codex/sessions`, across workspaces.
  It extracts token counts, request counts, and times. Large files over 8 MiB are
  skipped, so analytics may be incomplete. Historical quota fallback is also
  disabled unless you opt into history; snapshots may belong to a previous account.
- Prompt text: separately OFF by default. **Reveal Prompt Excerpts** enables short
  excerpts inside the VS Code dashboard only. Common credential patterns are
  masked, but this is best-effort detection, not a guarantee. Keep it off when
  screen-sharing or handling sensitive projects. Project paths are not displayed.
- Desktop, hover preview, and copied stats always use anonymous chat/request
  labels and numeric usage, even when dashboard excerpts are enabled.

## Storage And Transport

History results are cached in extension-host memory, not written to new files.
Disabling history clears cached results and rejects outstanding read results.
Toggling prompt visibility also clears and reloads history. This is logical
clearing, not guaranteed secure erasure from OS memory or swap.

The webview receives only display fields. Its policy blocks network requests,
images, frames, forms, and unapproved scripts. The Windows desktop companion
receives private stdin/stdout messages; it has no HTTP listener or temporary
telemetry file. It closes when its parent VS Code extension host closes.

Settings, desktop coordinates, and numeric warning-deduplication keys use VS
Code storage. Settings may participate in your VS Code Settings Sync. Search
text, prompts, and chat expansion state are not persisted by the webview.
**Copy Stats** writes numeric usage and anonymous labels to the clipboard only
on request; your operating system or clipboard manager may retain that text.

## Limits

Anyone able to view your screen can see the usage you display. Other processes
running as your OS user may access your files or memory. This extension cannot
protect against a compromised OS, VS Code, Codex installation, or other extension.
Uninstalling Credit Pulse does not remove Codex's original session logs or the
clipboard history. Manage those through Codex and your operating system.

Existing users who explicitly enabled history keep that preference. The new
prompt-text setting defaults to off for everyone until explicitly enabled.
