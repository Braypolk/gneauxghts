"""Synthetic unit fixtures; these are not native acceptance observations."""
import importlib.util
from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('workspace_effects', Path(__file__).with_name('verify-workspace-effects.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicationProofTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'vault/.gneauxghts').mkdir(parents=True)
        with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
            db.execute('CREATE TABLE effects(id TEXT,note_id TEXT,target_path TEXT,receipt TEXT,proof TEXT)')
            for name, count in [('kept', 1), ('saved', 2)]:
                path = self.root / 'vault' / f'{name}.md'
                path.write_text(f'---\ngneauxghts:\n  id: {name}\n---\nSynthetic canonical bytes\n')
                for index in range(count):
                    db.execute('INSERT INTO effects VALUES(?,?,?,?,?)', (f'{name}-{index}', name, str(path), json.dumps({'noteId': name}), '{}'))
        with closing(sqlite3.connect(self.root / 'vault/.gneauxghts/history.sqlite3')) as db, db:
            db.execute('CREATE TABLE publication_receipts(note_id TEXT)')
            db.executemany('INSERT INTO publication_receipts VALUES(?)', [('kept',), ('saved',), ('saved',)])
        self.report = {'receipts': {'kept': {'noteId': 'kept'}, 'saved': {'noteId': 'saved'}}}

    def prove(self):
        return module.prove(self.root, self.report, self.root / 'retained')

    def test_retains_exact_canonical_bytes_and_consistent_databases(self):
        (self.root / 'vault/reference.md').write_text('Authored reference to kept and saved is not canonical identity ownership.')
        proofs = self.prove()
        self.assertEqual([value['effectRows'] for value in proofs], [1, 2])
        self.assertEqual((self.root / 'vault/kept.md').read_bytes(), (self.root / 'retained/kept.md').read_bytes())
        with closing(sqlite3.connect(self.root / 'retained/publication-receipts.sqlite')) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM effects').fetchone()[0], 3)

    def test_missing_receipt_or_duplicate_publication_fails(self):
        with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
            db.execute("UPDATE effects SET proof=NULL WHERE note_id='kept'")
        with self.assertRaisesRegex(AssertionError, 'missing durable receipt'):
            self.prove()

        with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
            db.execute("UPDATE effects SET proof='{}' WHERE note_id='kept'")
        with closing(sqlite3.connect(self.root / 'vault/.gneauxghts/history.sqlite3')) as db, db:
            db.execute("INSERT INTO publication_receipts VALUES('kept')")
        with self.assertRaisesRegex(AssertionError, 'duplicate or missing timeline publication'):
            self.prove()

    def test_duplicate_canonical_identity_fails(self):
        (self.root / 'vault/duplicate.md').write_text('---\ngneauxghts:\n  id: kept\n---\nDuplicate owner\n')
        with self.assertRaisesRegex(AssertionError, 'canonical identity is not unique'):
            self.prove()


if __name__ == '__main__':
    unittest.main()
