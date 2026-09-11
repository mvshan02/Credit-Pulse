"""Package this dependency-free extension as a local VSIX using an explicit file list."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from release_files import RELEASE_FILES
from release_check import check_archive, secret_findings

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text())
version = escape(package["version"])
publisher = escape(package["publisher"], {'"': '&quot;'})
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="credit-pulse" Version="{version}" Publisher="{publisher}"/>
<DisplayName>Credit Pulse - Codex Usage</DisplayName><Description xml:space="preserve">Floating Codex usage widget</Description>
<Tags>codex,usage,credits</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Icon>extension/media/icon.png</Icon><License>extension/LICENSE</License>
<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.95.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true"/></Assets></PackageManifest>'''
types = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="html" ContentType="text/html"/><Default Extension="css" ContentType="text/css"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="exe" ContentType="application/octet-stream"/><Default Extension="cs" ContentType="text/plain"/><Default Extension="manifest" ContentType="text/xml"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'''
target = root / f'credit-pulse-{package["version"]}.vsix'
types = types.replace('<Default Extension="svg"', '<Default Extension="png" ContentType="image/png"/><Default Extension="svg"')
types = types.replace('</Types>', '<Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>')
if not (root / package["icon"]).is_file():
    raise SystemExit("Build the extension icon first: powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/build_icon.ps1")
files = [root / name for name in RELEASE_FILES]
for file in files:
    if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
        raise SystemExit(f"Missing or unsafe release file: {file.relative_to(root)}")
    findings = secret_findings(file.read_bytes(), file.relative_to(root).as_posix())
    if findings:
        raise SystemExit("Credential-pattern scan failed: " + "; ".join(findings))
desktop_binary = root / "desktop/bin/CreditPulse.Desktop.exe"
desktop_source = root / "desktop/Overlay.cs"
if not desktop_binary.exists() or desktop_binary.stat().st_mtime < max(desktop_source.stat().st_mtime, (root / "desktop/app.manifest").stat().st_mtime):
    raise SystemExit("Build the Windows companion first: powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/build_desktop.ps1")
with ZipFile(target,"w",ZIP_DEFLATED) as archive:
    archive.writestr("extension.vsixmanifest",manifest)
    archive.writestr("[Content_Types].xml",types)
    for file in files:
        archive.write(file,"extension/"+file.relative_to(root).as_posix())
issues = check_archive(target)
if issues:
    raise SystemExit("Release verification failed: " + "; ".join(issues))
print(target)
