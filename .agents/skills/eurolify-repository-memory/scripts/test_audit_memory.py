import tempfile
import unittest
from pathlib import Path

from audit_memory import audit


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        (self.repo / "memoria").mkdir()
        (self.repo / "docs").mkdir()
        (self.repo / "memoria/a.md").write_text("# A\nsame\n", encoding="utf-8")
        (self.repo / "docs/b.md").write_text("# A\nsame\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_duplicates_and_metadata_only(self):
        report = audit(self.repo, ["memoria", "docs"])
        self.assertEqual(report["markdownFiles"], 2)
        self.assertEqual(report["exactDuplicateGroupsTotal"], 1)
        self.assertFalse(report["tokenCountMeasured"])
        self.assertTrue(report["readOnly"])
        self.assertNotIn("content", report["largest"][0])

    def test_no_duplicate_count_for_overlapping_roots(self):
        (self.repo / "docs/sub").mkdir()
        (self.repo / "docs/sub/c.md").write_text("unique", encoding="utf-8")
        report = audit(self.repo, ["docs", "docs/sub"])
        self.assertEqual(report["markdownFiles"], 2)

    def test_sensitive_files_and_other_extensions_skipped(self):
        (self.repo / "docs/passwords.md").write_text("not output", encoding="utf-8")
        (self.repo / "docs/x.txt").write_text("not read", encoding="utf-8")
        (self.repo / "docs/.env").write_text("not read", encoding="utf-8")
        (self.repo / "docs/secrets").mkdir()
        (self.repo / "docs/secrets/x.md").write_text("not read", encoding="utf-8")
        self.assertEqual(audit(self.repo, ["docs"])["markdownFiles"], 1)

    def test_sensitive_name_is_reported_not_silent(self):
        (self.repo / "docs/chave-privada-vps.md").write_text("x", encoding="utf-8")
        (self.repo / "docs/Credenciais.md").write_text("x", encoding="utf-8")
        report = audit(self.repo, ["docs"])
        self.assertEqual(report["markdownFiles"], 1)
        reasons = {w["reason"] for w in report["warnings"]}
        self.assertEqual(reasons, {"sensitive_name_skipped"})
        self.assertEqual(len(report["warnings"]), 2)

    def test_ordinary_names_with_key_words_are_read(self):
        (self.repo / "docs/0029-chave-do-age-tambem-na-vps.md").write_text("x", encoding="utf-8")
        (self.repo / "docs/design-token.md").write_text("y", encoding="utf-8")
        report = audit(self.repo, ["docs"])
        self.assertEqual(report["markdownFiles"], 3)
        self.assertEqual(report["warnings"], [])

    def test_root_under_symlinked_parent_rejected(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        Path(outside.name, "sub").mkdir()
        Path(outside.name, "sub/x.md").write_text("fora", encoding="utf-8")
        (self.repo / "link").symlink_to(outside.name)
        with self.assertRaisesRegex(ValueError, "escapes"):
            audit(self.repo, ["link/sub"])

    def test_symlink_not_followed(self):
        (self.repo / "docs/link.md").symlink_to(self.repo / "memoria/a.md")
        (self.repo / "docs/linked").symlink_to(self.repo / "memoria")
        self.assertEqual(audit(self.repo, ["docs"])["markdownFiles"], 1)

    def test_escape_rejected(self):
        with self.assertRaises(ValueError):
            audit(self.repo, ["../outside"])
        with self.assertRaises(ValueError):
            audit(self.repo, [str(self.repo / "docs")])
        with self.assertRaises(ValueError):
            audit(self.repo, [".git"])

    def test_missing_root_is_warning(self):
        report = audit(self.repo, ["missing"])
        self.assertEqual(report["markdownFiles"], 0)
        self.assertEqual(report["warnings"][0]["reason"], "not_a_directory")

    def test_audit_does_not_change_documents(self):
        before = (self.repo / "docs/b.md").read_bytes()
        audit(self.repo, ["docs"])
        self.assertEqual((self.repo / "docs/b.md").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
