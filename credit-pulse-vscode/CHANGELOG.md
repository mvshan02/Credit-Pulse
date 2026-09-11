# Changelog

## 0.9.3

- Mark the generated VSIX as public through `GalleryFlags`, as required by
  Visual Studio Marketplace for public listing availability.

## 0.9.2

- Parse current Codex `response_item` user messages so chat titles and request
  excerpts show content instead of opaque IDs.
- Coalesce multiple user records within one task to avoid inflated request counts.

## 0.9.1

- Fixed history and prompt-excerpt toggles when a quota refresh is already running.
- Added immediate scanning, empty-state, and read-error feedback to the history panel.
- Clarified that prompt excerpts remain dashboard-only and are never copied or sent
  to desktop and status-bar previews.

## 0.9.0

- One Desktop toggle instead of duplicated float, bubble, and dock controls.
- Removed simulated floating inside the webview; retained real native desktop dragging.
- Opt-in history and separately opt-in prompt text; anonymous external previews.
- Privacy cache invalidation, bounded history reads, hardened executable discovery
  and IPC validation, and browser-tested CSP/XSS protections.
- Explicit release file allowlist, package scanner, MIT license, privacy/security
  documentation, and Marketplace release checks.

## 0.8.0

- Fixed native bubble fast dragging and removed forced edge snapping.
- Added a packaged extension logo and font-independent robot graphics.
