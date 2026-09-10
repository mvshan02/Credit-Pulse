"""Synthetic package tests. No real credentials or session logs are used."""
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from tools.release_check import ROOT, check_archive, secret_findings, validate_manifest, has_authenticode
from tools.release_files import RELEASE_FILES


class ReleaseSecurityTests(unittest.TestCase):
    def test_secret_detection_does_not_echo_values(self):
        samples = [b"sk-proj-" + b"X"*45, b"ghp_" + b"X"*36,
                   b"AKIA" + b"A"*16, b"-----BEGIN " + b"PRIVATE KEY-----"]
        for sample in samples:
            result = secret_findings(sample, "fixture.txt")
            self.assertTrue(result)
            self.assertNotIn(sample.decode(), str(result))

    def test_public_release_rejects_placeholder_publisher(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        package["publisher"] = "local-credit-pulse"
        self.assertTrue(any("publisher ID" in issue for issue in validate_manifest(package, True)))
        package["publisher"] = "registered-test-publisher"
        self.assertEqual(validate_manifest(package, True), [])

    def test_vscodeignore_matches_exact_allowlist(self):
        lines = (ROOT / ".vscodeignore").read_text().splitlines()
        self.assertEqual(lines[0], "**")
        self.assertEqual({line[1:] for line in lines if line.startswith("!")}, set(RELEASE_FILES))
        self.assertFalse(any(name.endswith((".log", ".jsonl", ".vsix")) for name in RELEASE_FILES))

    def test_archive_rejects_extra_private_file_and_changed_source(self):
        with tempfile.TemporaryDirectory(prefix="pulse-release-security-") as directory:
            target = Path(directory) / "bad.vsix"
            with ZipFile(target, "w") as archive:
                archive.writestr("extension/media/session.jsonl", b"sk-proj-" + b"X"*45)
                archive.writestr("extension/package.json", b"{}")
            issues = check_archive(target)
            self.assertTrue(any("Unexpected package file" in issue for issue in issues))
            self.assertTrue(any("OpenAI-style credential" in issue for issue in issues))
            self.assertTrue(any("differs from current source" in issue for issue in issues))
            self.assertNotIn("X"*45, str(issues))

    def test_authenticode_table_detection(self):
        unsigned = bytearray(512)
        unsigned[:2] = b"MZ"
        unsigned[0x3C:0x40] = (128).to_bytes(4, "little")
        unsigned[128:132] = b"PE\0\0"
        unsigned[152:154] = (0x10B).to_bytes(2, "little")
        self.assertFalse(has_authenticode(unsigned))
        signed = unsigned + bytearray(32)
        directory = 152 + 96 + 8*4
        signed[directory:directory+8] = (512).to_bytes(4, "little") + (32).to_bytes(4, "little")
        self.assertTrue(has_authenticode(signed))


if __name__ == "__main__":
    unittest.main()
