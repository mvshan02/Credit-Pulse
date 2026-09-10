# Security Review: 0.9.0

Validation date: 2026-09-09. Scope: the Credit Pulse VS Code extension and its
bundled Windows companion, tested locally on Windows x64. This is a targeted
engineering review, not an independent penetration test or certification.

## Addressed Findings

| Finding | Change |
| --- | --- |
| History was enabled by default and excerpts could appear on multiple surfaces | History is opt-in. Dashboard excerpts require a separate opt-in. Desktop, hover, clipboard, and their recommendations use anonymous labels and whitelisted numeric fields. |
| Privacy changes could leave cached or late-arriving chat data visible | Configuration changes clear caches and views immediately. Generation checks discard revoked reads, including reads completing after shutdown. |
| Search text and layout state persisted in the webview | Old state is cleared. Search and chat content/expansion state are no longer persisted. |
| Automatic executable discovery could use the workspace/current-directory search path | Use resolved absolute paths, avoid relative/workspace PATH entries and links resolving into the workspace, and spawn without a shell. Explicit configured paths remain a user trust decision. |
| Primitive IPC messages could crash object access | Validate message envelopes, action/mode allowlists, prototype-like theme keys, settings types, and response sizes. |
| Package globs could include later-added sensitive files | Both packaging routes now use the same 20-file allowlist; scanner tests reject extra private files and credential-pattern matches. |

## Results

- PASS: 29 Node tests, including 11 targeted security/host-privacy tests.
- PASS: four release-scanner tests using synthetic credentials and malformed packages.
- PASS: Edge UI/security tests: text-only XSS rendering, CSP-blocked script,
  fetch and image attempts, immediate privacy clearing, responsive layout,
  no duplicate desktop controls, and no persisted search text.
- PASS: native Windows tests: fast bubble drag, release position, topmost style,
  click-to-expand, card drag, quota updates, and exit on parent disconnect.
- PASS: isolated VS Code activation, private defaults, command discovery,
  native overlay launch and close.
- PASS: VSIX content scan: 20 expected files, matching source bytes and identity,
  privacy-safe defaults, no extra files or common credential-pattern matches.
- Windows Defender custom scan of `credit-pulse-0.9.0.vsix` completed without
  cancellation. Matching start/completion events were recorded on 2026-09-09
  at 05:40:18 local time; no matching threat-detection events were recorded.
- BLOCKED: the public package gate accepts publisher ID `Vathushan` but refuses
  the unsigned companion. Marketplace ownership of that exact ID must still be
  confirmed during authenticated upload.

## Remaining Release Decisions

- Supply the registered publisher ID and sign in locally to publish. No package
  was uploaded and no repository was pushed during this review.
- Verify public repository links and private vulnerability reporting. Do not
  include the workspace's unrelated staged files or `debug.log` in a source release;
  none are included in this VSIX.
- The companion is unsigned. Obtain a publicly trusted Authenticode identity,
  sign and timestamp the final build, then rerun the public gate. Additional
  platform, multi-monitor, and mixed-DPI testing is recommended before broad distribution.
- Redaction is best-effort. Leave dashboard excerpts off for sensitive work or
  screen sharing. Other same-user processes and a compromised host are outside
  this extension's protection boundary.
- There are no third-party npm runtime dependencies. This review did not audit
  VS Code, Codex, Windows/.NET, or the development toolchain for vulnerabilities.

Rerun checks after any change to a packaged file. The review itself and test
fixtures are not included in the public VSIX.
