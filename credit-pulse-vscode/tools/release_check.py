"""Offline VSIX checks. Reports rule/file names, never matched secret values."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import struct
from zipfile import ZipFile, BadZipFile
from xml.etree import ElementTree

if __package__:
    from .release_files import RELEASE_FILES
else:
    from release_files import RELEASE_FILES

ROOT = Path(__file__).resolve().parents[1]
SECRET_RULES = {
    "OpenAI-style credential": re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "GitHub credential": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "AWS access key": re.compile(rb"\bAKIA[A-Z0-9]{16}\b"),
    "Private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "JWT": re.compile(rb"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
}


def secret_findings(data, name):
    return [f"{name}: {rule}" for rule, pattern in SECRET_RULES.items() if pattern.search(data)]


def has_authenticode(data):
    """Check the PE certificate table exists; SignTool performs trust verification."""
    try:
        if data[:2] != b"MZ":
            return False
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        if data[pe:pe+4] != b"PE\0\0":
            return False
        optional = pe + 24
        magic = struct.unpack_from("<H", data, optional)[0]
        directory = optional + (112 if magic == 0x20B else 96)
        certificate_offset, certificate_size = struct.unpack_from("<II", data, directory + 8*4)
        return certificate_offset > 0 and certificate_size >= 8 and certificate_offset + certificate_size <= len(data)
    except (IndexError, struct.error):
        return False


def validate_manifest(package, public=False):
    issues = []
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", package.get("publisher", "")):
        issues.append("Invalid publisher ID")
    if public and package.get("publisher") == "local-credit-pulse":
        issues.append("Public release blocked: set your registered Marketplace publisher ID")
    if package.get("license") != "MIT":
        issues.append("Expected the approved MIT license")
    if not str(package.get("repository", {}).get("url", "")).startswith("https://github.com/"):
        issues.append("Repository metadata is missing")
    if package.get("dependencies") or package.get("optionalDependencies"):
        issues.append("Runtime dependencies added: perform a dependency audit before release")
    properties = package.get("contributes", {}).get("configuration", {}).get("properties", {})
    for setting in ("historyEnabled", "showRequestText"):
        if properties.get(f"creditPulse.{setting}", {}).get("default") is not False:
            issues.append(f"Unsafe privacy default: {setting}")
    return issues


def check_archive(target, root=ROOT, public=False):
    issues = []
    expected = {f"extension/{name}" for name in RELEASE_FILES} | {"extension.vsixmanifest", "[Content_Types].xml"}
    try:
        with ZipFile(target) as archive:
            names = archive.namelist()
            if len(names)>128 or sum(entry.file_size for entry in archive.infolist())>16*1024*1024:
                return ["Archive exceeds the release file-count or size limit"]
            issues += [f"Unexpected package file: {name}" for name in sorted(set(names)-expected)]
            issues += [f"Missing package file: {name}" for name in sorted(expected-set(names))]
            issues += [f"Duplicate archive entry: {name}" for name, count in Counter(names).items() if count > 1]
            contents = {}
            for entry in archive.infolist():
                if entry.file_size > 4*1024*1024:
                    issues.append(f"Oversized package file: {entry.filename}")
                    continue
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    issues.append(f"Symlink in package: {entry.filename}")
                data = archive.read(entry)
                contents[entry.filename] = data
                issues += secret_findings(data, entry.filename)
            package = json.loads(contents.get("extension/package.json", b"{}"))
            if not isinstance(package, dict):
                return issues + ["Invalid package.json object"]
            issues += validate_manifest(package, public)
            if public and not has_authenticode(contents.get("extension/desktop/bin/CreditPulse.Desktop.exe", b"")):
                issues.append("Public release blocked: Windows companion has no embedded Authenticode signature")
            manifest = ElementTree.fromstring(contents.get("extension.vsixmanifest", b"<missing/>"))
            namespace = {"m": "http://schemas.microsoft.com/developer/vsx-schema/2011"}
            identity = manifest.find("m:Metadata/m:Identity", namespace)
            if identity is None or any(identity.get(key) != package.get(field) for key, field in (("Publisher", "publisher"), ("Version", "version"), ("Id", "name"))):
                issues.append("VSIX identity differs from package.json")
            for name in RELEASE_FILES:
                file = root / name
                if not file.is_file() or not file.resolve().is_relative_to(root.resolve()) or file.is_symlink():
                    issues.append(f"Missing or unsafe source file: {name}")
                elif contents.get(f"extension/{name}") != file.read_bytes():
                    issues.append(f"Package differs from current source: {name}")
    except (OSError, BadZipFile, ValueError, ElementTree.ParseError) as error:
        issues.append(f"Cannot validate package ({type(error).__name__})")
    return issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="?", type=Path)
    parser.add_argument("--public", action="store_true", help="Also reject the local-only publisher identity")
    args = parser.parse_args()
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    target = args.archive or ROOT / f"credit-pulse-{package['version']}.vsix"
    issues = check_archive(target, public=args.public)
    for issue in issues:
        print(issue)
    if issues:
        raise SystemExit(1)
    print(f"PASS: {len(RELEASE_FILES)} allowlisted files; identity, privacy defaults, source equality and credential-pattern scan. No matched secrets printed.")


if __name__ == "__main__":
    main()
