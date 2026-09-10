"""Single explicit allowlist for public VSIX contents, with no directory globs."""
RELEASE_FILES = (
    "package.json", "README.md", "LICENSE", "PRIVACY.md", "SECURITY.md", "CHANGELOG.md",
    "src/extension.js", "src/usage.js", "src/chat-history.js", "src/desktop-overlay.js",
    "src/insights.js", "src/privacy.js", "media/icon.png", "media/pulse.svg",
    "media/widget.html", "media/widget.css", "media/widget.js",
    "desktop/bin/CreditPulse.Desktop.exe", "desktop/Overlay.cs", "desktop/app.manifest",
)
