import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).parents[1] / 'timeline_fixture.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class FixtureTests(unittest.TestCase):
    def test_compact_receipt_validation_rejects_terminal_preparations_and_receipt_damage(self):
        window = {'kind': fixture.SCALE_KIND, 'notes': [
            {'noteId': 'a', 'windows': 1, 'revisions': 2},
            {'noteId': 'b', 'windows': 1, 'revisions': 2},
        ]}
        corruptions = [
            "DELETE FROM publication_receipts WHERE rowid=1",
            "UPDATE publication_receipts SET note_id='outside-manifest' WHERE rowid=1",
            "UPDATE publication_receipts SET live=1 WHERE rowid=1",
            "UPDATE publication_receipts SET outcome=NULL WHERE rowid=1",
            "UPDATE publication_receipts SET intent_id='publication-v1:full-token' WHERE rowid=1",
            "INSERT INTO prepared_intents VALUES ('a',x'01')",
            "INSERT INTO pending_window_preparations VALUES ('unresolved')",
        ]
        for corruption in corruptions:
            with sqlite3.connect(':memory:') as db:
                db.executescript('CREATE TABLE prepared_intents(note_id TEXT,authored_payload BLOB); CREATE TABLE pending_window_preparations(intent_id TEXT); CREATE TABLE publication_receipts(intent_id TEXT,note_id TEXT,status TEXT,live INTEGER,outcome TEXT);')
                db.executemany("INSERT INTO publication_receipts VALUES (?,?,'finalized',0,'{}')", [(f'{note}-{i}',note) for note in ['a','b'] for i in range(66)])
                fixture.validate_prepared_intents(db,window)
                db.execute(corruption)
                with self.assertRaises(ValueError):
                    fixture.validate_prepared_intents(db,window)

    def test_outer_kind_cannot_relabel_a_different_validated_workload(self):
        from unittest.mock import patch
        for outer, inner in [(fixture.KIND, fixture.SCALE_KIND), (fixture.SCALE_KIND, fixture.KIND)]:
            with tempfile.TemporaryDirectory() as root:
                path = Path(root)
                (path / 'fixture.json').write_text(json.dumps({'kind': outer, 'files': {}}))
                with patch.object(fixture, 'validate', return_value={'kind': inner}):
                    with self.assertRaisesRegex(ValueError, 'metadata mismatch'):
                        fixture.require_kind(path, outer)

    def test_create_cannot_relabel_the_other_policy_fixture(self):
        from unittest.mock import patch
        for actual, requested in [('gneauxghts-production-scale-v1', fixture.KIND), ('gneauxghts-editing-window-v1', fixture.KIND), ('gneauxghts-editing-window-v2', fixture.KIND), ('gneauxghts-current-scale-v1', fixture.SCALE_KIND)]:
            with tempfile.TemporaryDirectory() as root:
                path = Path(root)
                (path / 'preserve').write_text('sealed master')
                before = fixture.digest_files(path)
                with patch.object(fixture, 'check', return_value={'kind': actual}):
                    with self.assertRaisesRegex(ValueError, 'policy does not match'):
                        fixture.require_kind(path, requested)
                self.assertEqual(fixture.digest_files(path), before)

    def test_reset_refuses_an_unmarked_directory(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            (path / 'keep').write_text('unrelated work')
            with self.assertRaises(FileNotFoundError):
                fixture.reset(path)
            self.assertEqual((path / 'keep').read_text(), 'unrelated work')

    def test_manifest_detects_tampering_before_any_database_access(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            (path / 'payload').write_text('original')
            (path / 'fixture.json').write_text(json.dumps({'kind': fixture.KIND, 'files': fixture.digest_files(path)}))
            (path / 'payload').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'content changed'):
                fixture.clone(path)

    def test_symlinks_cannot_expand_the_fixture_boundary(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            (path / 'link').symlink_to('/tmp', target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlinks'):
                fixture.digest_files(path)

    def test_validate_rejects_wrong_revision_counts(self):
        with tempfile.TemporaryDirectory() as root:
            vault = Path(root)
            (vault / fixture.DB.parent).mkdir()
            with sqlite3.connect(vault / fixture.DB) as db:
                db.execute('CREATE TABLE revisions(note_id TEXT)')
                db.execute("INSERT INTO revisions VALUES ('release-seed-0')")
            with self.assertRaisesRegex(ValueError, 'revision counts'):
                fixture.validate(vault, vault)

    def test_disposable_clone_relocates_paths_without_changing_revision_evidence(self):
        # Tiny storage substitute isolates clone behavior; geometry validation has
        # its own real current-window geometry assertion in every fixture invocation.
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as root:
            cache = Path(root)
            (cache / 'vault' / fixture.DB.parent).mkdir(parents=True)
            (cache / 'data').mkdir()
            original = '/old/test-vault'
            with sqlite3.connect(cache / 'vault' / fixture.DB) as db:
                db.executescript('CREATE TABLE timeline_heads(current_path TEXT); CREATE TABLE prepared_intents(target_path TEXT); CREATE TABLE lifecycle_events(path TEXT, previous_path TEXT); CREATE TABLE revisions(payload BLOB, result_hash TEXT);')
                db.execute('INSERT INTO timeline_heads VALUES (?)', (original + '/Seed 0.md',))
                db.execute('INSERT INTO revisions VALUES (?, ?)', (b'authored prose /old/test-vault', 'retained-hash'))
            before = fixture.digest_files(cache)
            with patch.object(fixture, 'check', return_value={'original_vault': original}), patch.object(fixture, 'validate'):
                run = fixture.clone(cache)
            try:
                with sqlite3.connect(run / 'vault' / fixture.DB) as db:
                    self.assertEqual(db.execute('SELECT current_path FROM timeline_heads').fetchone()[0], str(run / 'vault' / 'Seed 0.md'))
                    self.assertEqual(db.execute('SELECT * FROM revisions').fetchone(), (b'authored prose /old/test-vault', 'retained-hash'))
                    db.execute('DELETE FROM revisions')
                self.assertEqual(fixture.digest_files(cache), before)
            finally:
                fixture.shutil.rmtree(run)


if __name__ == '__main__':
    unittest.main()
