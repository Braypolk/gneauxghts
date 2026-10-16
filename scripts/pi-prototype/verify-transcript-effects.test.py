"""Pure synthetic SQLite fixtures; never launches a native app."""
import json
import runpy
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

snapshot = runpy.run_path(str(Path(__file__).with_name('verify-transcript-effects.py')))['snapshot']


class SnapshotTest(unittest.TestCase):
    def test_exact_authority_and_canonical_bytes_are_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            native = data / 'PROTOTYPE-wipe-me'
            vault = native / 'vault'
            metadata = vault / '.gneauxghts'
            metadata.mkdir(parents=True)
            (metadata / 'vault.json').write_text(json.dumps({'vaultId': 'synthetic-vault'}))
            (vault / 'Note.md').write_text('---\ngneauxghts:\n  id: synthetic-note\n---\n\nCanonical synthetic bytes.\n')
            with closing(sqlite3.connect(native / 'publication-receipts.sqlite')) as db, db:
                db.execute('CREATE TABLE effects(id,payload_hash,note_id,target_path,intended_hash,receipt,proof)')
                db.execute('INSERT INTO effects VALUES(?,?,?,?,?,?,?)', ['review:1','exact-accepted-hash','synthetic-note','/retained/old/Note.md','intent-hash',None,'exact-proof'])
            with closing(sqlite3.connect(metadata / 'history.sqlite3')) as db, db:
                db.execute('CREATE TABLE publication_receipts(note_id)')
                db.execute('INSERT INTO publication_receipts VALUES(?)', ['synthetic-note'])
            with closing(sqlite3.connect(native / 'locations.sqlite')) as db, db:
                db.execute('CREATE TABLE pi_vault_owner(id,vault_id)')
                db.execute('INSERT INTO pi_vault_owner VALUES(1,?)', ['synthetic-vault'])
                db.execute('CREATE TABLE vault_locations(vault_id,roots_json)')
                db.execute('INSERT INTO vault_locations VALUES(?,?)', ['synthetic-vault',json.dumps(['/retained/old',str(vault)])])
            with closing(sqlite3.connect(metadata / 'pi-transcripts.sqlite')) as db, db:
                db.execute('CREATE TABLE projections(conversation_id,receipt_hash,intent_hash,detached,warning)')
                db.execute('INSERT INTO projections VALUES(?,?,?,?,?)', ['pi-1','exact-receipt',None,1,None])
            value = snapshot(data)
            self.assertEqual(value['owner'], 'synthetic-vault')
            self.assertEqual(value['effects'][0]['payload_hash'], 'exact-accepted-hash')
            self.assertEqual(value['effects'][0]['proof'], 'exact-proof')
            self.assertEqual(value['effects'][0]['publications'], 1)
            self.assertEqual(value['effects'][0]['target_path'], '/retained/old/Note.md')
            self.assertEqual(value['transcripts'][0]['detached'], 1)
            (vault / 'Duplicate.md').write_bytes((vault / 'Note.md').read_bytes())
            with self.assertRaisesRegex(AssertionError, 'Identity is not unique'):
                snapshot(data)


if __name__ == '__main__':
    unittest.main()
