"""Synthetic unit fixtures; not native acceptance evidence."""
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('paired_effects', Path(__file__).with_name('paired-parity-effects.py'))
effects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(effects)


class EffectProof(unittest.TestCase):
    def test_counts_exact_effects_and_does_not_modify_sqlite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            database = root / 'history.sqlite3'
            with sqlite3.connect(database) as connection:
                connection.executescript('CREATE TABLE publication_receipts(note_id TEXT);'
                    "INSERT INTO publication_receipts VALUES('created'),('saved'),('saved');")
            before = database.read_bytes()
            self.assertEqual(effects.snapshot(root, {'created': 1, 'saved': 2}), {
                'created': {'publicationReceipts': 1}, 'saved': {'publicationReceipts': 2}})
            self.assertEqual(database.read_bytes(), before)
            with self.assertRaises(AssertionError):
                effects.snapshot(root, {'created': 2})
            with sqlite3.connect(database) as connection:
                connection.execute("INSERT INTO publication_receipts VALUES('created')")
            with self.assertRaises(AssertionError):
                effects.snapshot(root, {'created': 1})

    def test_missing_or_ambiguous_history_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(AssertionError):
                effects.snapshot(root, {'note': 1})
            (root / 'history.sqlite3').touch()
            (root / 'nested').mkdir()
            (root / 'nested/history.sqlite3').touch()
            with self.assertRaises(AssertionError):
                effects.snapshot(root, {'note': 1})


if __name__ == '__main__':
    unittest.main()
