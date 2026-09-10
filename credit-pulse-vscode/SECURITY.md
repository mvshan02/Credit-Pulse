# Security

## Reporting

Do not attach real tokens, session logs, screenshots containing prompts, or
credentials to public issues. Use a minimal synthetic reproduction. If GitHub
private vulnerability reporting is enabled for the repository, use that channel
for exploitable findings. A private reporting channel must be verified by the
publisher before public release; do not assume it is already configured.

## Controls In 0.9

- Opt-in session-log reading, prompt-free default displays, explicit excerpt consent.
- Anonymized desktop, hover, clipboard, and recommendation inputs.
- Whitelisted transport fields; bounded cached logs and IPC response sizes.
- Immediate cache invalidation and discarded late reads after privacy changes.
- No extension-owned telemetry service or webview network access.
- Nonce-based scripts, text-only rendering of untrusted chat/advice data, restricted
  webview resources, fixed message actions, and validated settings.
- Shell-free subprocesses; absolute resolved Codex paths; workspace/relative PATH
  entries are not automatically used. Explicit Codex Path is a user trust decision.
- The extension is disabled in untrusted workspaces. The desktop is a normal
  non-elevated Windows process and terminates when the parent disconnects.
- Public packaging uses an exact file allowlist and rejects credential-pattern
  matches, unexpected files, symlinks, changed source files, and malformed metadata.

## Validation

Run `node --test tests/*.test.js`, `python tests/browser_check.py`, and
`python tests/desktop_check.py`. The security tests include extension-host privacy
boundaries, history revocation races, unsafe executable discovery, malformed IPC,
XSS rendering, and real browser-enforced CSP blocking. Run
`python -m unittest discover -s tests -p "test_release*.py"` for the release scanner.
Run `python tools/release_check.py` on the built VSIX before sharing it.

There are no third-party npm runtime dependencies to audit. Public release also
requires an embedded Authenticode signature; `sign_desktop.ps1` performs trust
verification and timestamping before packaging. These checks are
targeted automated tests, not an independent penetration test, a complete secret
detector, or a security certification. The native companion remains unsigned
until a maintainer runs the certificate-backed signing step after the final build.
Only release when the current build passes its checks. Never publish test logs,
credentials, private screenshots, `.codex`, `.env` files, or the repository's
unrelated staged files.
