# Public Release Checklist

## Publisher Identity

The package currently uses publisher ID `Vathushan`. Confirm that this exact,
case-sensitive ID belongs to your Marketplace account. If it does not, create or select a publisher in the
[Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage).
Set `publisher` in `package.json` to the exact registered ID. Never put account
passwords, publishing tokens, `.env` files, or login caches in this repository.

The MIT license is approved. Repository metadata currently points to the
configured `Credit-Pulse` Git remote. Verify that the intended repository and
issue tracker are publicly accessible and that a private vulnerability-reporting
channel is configured before publishing. Do not push this workspace's unrelated
staged files or `debug.log` as part of the extension release.

## Validate The Exact Build

Use a Windows development machine with Node, Python, Edge/Playwright, and Pillow.
Builds include the native executable; do not publish a source-only VSIX.

```text
node --test tests/*.test.js
python tests/browser_check.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/build_desktop.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/sign_desktop.ps1 -CertificateThumbprint YOUR_40_HEX_THUMBPRINT
python tests/desktop_check.py
python -m unittest discover -s tests -p "test_release*.py"
python tools/package_vsix.py
python tools/release_check.py --public
```

Also run `tests/integration.js` in an isolated VS Code Extension Development Host
and test installing the VSIX in a clean profile with history off by default.
The public gate rejects the known local placeholder but cannot authenticate
ownership of a publisher ID; the Marketplace performs that check. Rebuild and
rerun the gate after changing any packaged file. Keep test screenshots
synthetic; do not use real chat text in listing images.

The native executable must be signed after every build and before packaging.
`build_desktop.ps1` replaces the executable and removes any prior signature.
`sign_desktop.ps1` accepts a code-signing certificate with an accessible private
key from `Cert:\CurrentUser\My`. It uses SHA-256, requests an RFC 3161 timestamp,
then requires SignTool and Windows Authenticode verification to pass. The public
package gate checks for an embedded signature, but SignTool verifies its trust chain.

For public trust, obtain a publicly trusted Authenticode code-signing identity.
Microsoft currently recommends Artifact Signing (formerly Trusted Signing), or
you can purchase a certificate from a trusted certificate authority and install
it in the current user's certificate store. A self-signed test certificate does
not establish trust on other users' PCs. Keep private keys in the certificate
store, hardware token, or signing service; do not commit a PFX or put its password
on a command line. Pass your CA's RFC 3161 URL with `-TimestampUrl` if necessary.

`tools/release_files.py` is the exact package allowlist, mirrored by
`.vscodeignore`. New runtime files must be deliberately added to both. The scanner
checks the built archive's contents and source equality, rejects common credential
patterns, and prints rule/file names rather than matched secret values. This is
not a full secret-detection or penetration-testing service. Have another maintainer
review the release. Public release requires the companion signature gate to pass.

## Publish

Sign in to the publisher portal locally, create a new VS Code extension (or
update its existing listing), and upload the validated VSIX. This avoids placing
credentials in scripts or this chat. Check publisher ID, license, privacy policy,
Windows-only overlay limitations, and the listing preview before confirming.
The portal may perform additional validation or reject a conflicting identity.

Alternatively use Microsoft's `@vscode/vsce` tooling with the authentication
method in the current official guide. Do not bypass packaging/security checks
to suppress a warning, and never supply a token on a recorded command line.

Official instructions: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
The package is not public until the portal confirms publication.
