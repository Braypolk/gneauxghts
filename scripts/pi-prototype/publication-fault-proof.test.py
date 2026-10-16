from contextlib import closing
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('publication-fault-proof.py'))
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class PublicationProofTests(unittest.TestCase):
    def test_after_intent_does_not_create_missing_history_or_canonical_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            vault = root / 'PROTOTYPE-wipe-me/vault'
            vault.mkdir(parents=True)
            ledger = root / 'PROTOTYPE-wipe-me/publication-receipts.sqlite'
            target = vault / 'Reviewed.md'
            with closing(sqlite3.connect(ledger)) as db, db:
                db.execute('CREATE TABLE effects(id TEXT,note_id TEXT,target_path TEXT,receipt TEXT,proof TEXT)')
                db.execute('INSERT INTO effects VALUES(?,?,?,?,?)', ('pi-review-2:3', 'identity', str(target), None, None))
            before = proof.snapshot(root, 'pi-review-2')
            self.assertEqual(before['publications'], 0)
            self.assertIsNone(before['canonicalSha256'])
            self.assertFalse((vault / '.gneauxghts/history.sqlite3').exists())
            self.assertFalse(target.exists())
            target.write_text('Canonical exact bytes')
            history = vault / '.gneauxghts/history.sqlite3'
            history.parent.mkdir()
            with closing(sqlite3.connect(history)) as db, db:
                db.execute('CREATE TABLE publication_receipts(note_id TEXT)')
                db.execute('INSERT INTO publication_receipts VALUES(?)', ('identity',))
            after = proof.snapshot(root, 'pi-review-2')
            self.assertEqual(after['publications'], 1)
            self.assertEqual(len(after['canonicalSha256']), 64)
            with closing(sqlite3.connect(ledger)) as db, db:
                db.execute('INSERT INTO effects VALUES(?,?,?,?,?)', ('pi-review-2:4', 'duplicate', str(target), None, None))
            with self.assertRaises(AssertionError):
                proof.snapshot(root, 'pi-review-2')

    def test_external_receipt_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / 'PROTOTYPE-wipe-me'
            data.mkdir()
            with closing(sqlite3.connect(data / 'publication-receipts.sqlite')) as db, db:
                db.execute('CREATE TABLE effects(id TEXT,note_id TEXT,target_path TEXT)')
                db.execute('INSERT INTO effects VALUES(?,?,?)', ('pi-review-2:1', 'id', str(root / 'Outside.md')))
            with self.assertRaises(AssertionError):
                proof.snapshot(root, 'pi-review-2')

    def test_explicit_ios_vault_keeps_native_ledger_and_documents_vault_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary)
            root = data / 'Library/Application Support/com.braypolkinghorne.gneauxghts.pi-prototype'
            native = root / 'PROTOTYPE-wipe-me'
            native.mkdir(parents=True)
            vault = data / 'Documents/PROTOTYPE-wipe-me'
            vault.mkdir(parents=True)
            target = vault / 'Reviewed.md'
            target.write_text('Exact iOS authored bytes')
            with closing(sqlite3.connect(native / 'publication-receipts.sqlite')) as db, db:
                db.execute('CREATE TABLE effects(id TEXT,note_id TEXT,target_path TEXT)')
                db.execute('INSERT INTO effects VALUES(?,?,?)', ('pi-review-2:1', 'id', str(target)))
            result = proof.snapshot(root, 'pi-review-2', vault)
            self.assertEqual(len(result['canonicalSha256']), 64)
            self.assertEqual(result['publications'], 0)
            for wrong in [data / 'Outside', data / 'Documents/private-vault', native / 'vault']:
                with self.assertRaises(AssertionError):
                    proof.snapshot(root, 'pi-review-2', wrong)
            with self.assertRaises(AssertionError):
                proof.snapshot(data, 'pi-review-2', vault)


if __name__ == '__main__':
    unittest.main()
