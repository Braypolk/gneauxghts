"""Synthetic unit fixtures; these are not native acceptance observations."""
import importlib.util
import copy
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
        self.report = {'receipts': {'publicationPlans': {}, 'publicationReadBacks': {}}}
        receipts = self.report['receipts']
        for role, identity, version, body in [('kept', 'kept', 3, 'Edited exact body\n'), ('saved', 'saved', 5, 'Answer.\n\n## Selected addition\n'), ('appended', 'saved', 8, 'Answer.\n\n## Selected addition\nEcho phrase.\n')]:
            path = str(self.root / 'vault' / f'{identity}.md')
            reviewed = {'version': version, 'markdown': body, 'title': identity, 'path': path, 'decisions': [{'id': role, 'status': 'modified', 'from': 0, 'to': len(body)}]}
            expected = copy.deepcopy(reviewed)
            expected['version'] += 1
            expected['decisions'][0]['status'] = 'kept'
            serialized = json.dumps(expected, ensure_ascii=False, separators=(',', ':'))
            receipts['publicationPlans'][role] = {'proposalId': role, 'reviewId': f'review-{role}', 'expectedNoteId': identity if role == 'appended' else None,
                'reviewedDraft': reviewed, 'expectedKeepDraft': expected, 'expectedEditorMarkdown': body,
                'expectedDraftSha256': module.digest(serialized), 'expectedEditorSha256': module.digest(body)}
            receipts[role] = {'status': 'committed', 'noteId': identity, 'committedMarkdown': body, 'message': None,
                'applied': {'kind': 'updateNote' if role == 'appended' else 'createNote', 'path': path, 'previousPath': None}}
            receipts['publicationReadBacks'][role] = {'settledDraft': copy.deepcopy(expected), 'editorSha256': module.digest(body),
                'canonical': {'noteId': identity, 'path': path, 'title': identity, 'markdown': body}}
            Path(path).write_text(f'---\ngneauxghts:\n  id: {identity}\n  created_at: 2026-10-15T00:00:00Z\n  updated_at: 2026-10-15T00:00:00Z\n  trashed_at: null\n  kind: note\n---\n\n{body}')
        with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
            db.execute('CREATE TABLE effects(id TEXT,note_id TEXT,target_path TEXT,receipt TEXT,proof TEXT)')
            for role in ('kept', 'saved', 'appended'):
                plan, receipt = receipts['publicationPlans'][role], receipts[role]
                db.execute('INSERT INTO effects VALUES(?,?,?,?,?)', (f"{role}:{plan['expectedKeepDraft']['version']}", receipt['noteId'], receipt['applied']['path'], json.dumps(receipt), None))
        with closing(sqlite3.connect(self.root / 'vault/.gneauxghts/history.sqlite3')) as db, db:
            db.execute('CREATE TABLE publication_receipts(intent_id TEXT,note_id TEXT,sequence INTEGER,kind TEXT,status TEXT,live INTEGER)')
            db.executemany('INSERT INTO publication_receipts VALUES(?,?,?,?,?,?)', [('keep-token', 'kept', 1, 'point', 'finalized', 0), ('save-token', 'saved', 1, 'point', 'finalized', 0), ('append-token', 'saved', 2, 'point', 'finalized', 0)])

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
            db.execute("UPDATE effects SET receipt=NULL WHERE note_id='kept'")
        with self.assertRaisesRegex(AssertionError, 'missing durable receipt'):
            self.prove()

        with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
            db.execute("UPDATE effects SET receipt=? WHERE note_id='kept'", (json.dumps(self.report['receipts']['kept']),))
        with closing(sqlite3.connect(self.root / 'vault/.gneauxghts/history.sqlite3')) as db, db:
            db.execute("INSERT INTO publication_receipts VALUES('duplicate-token','kept',2,'point','finalized',0)")
        with self.assertRaisesRegex(AssertionError, 'duplicate or missing timeline publication'):
            self.prove()

    def test_duplicate_canonical_identity_fails(self):
        (self.root / 'vault/duplicate.md').write_text('---\ngneauxghts:\n  id: kept\n---\nDuplicate owner\n')
        with self.assertRaisesRegex(AssertionError, 'canonical identity is not unique'):
            self.prove()

    def test_wrong_full_settled_draft_fields_fail(self):
        for field, wrong in [('version', 55), ('markdown', 'wrong body'), ('title', 'wrong title'), ('path', '/wrong.md'), ('decisions', [])]:
            with self.subTest(field=field):
                original = self.report['receipts']['publicationReadBacks']['kept']['settledDraft']
                self.report['receipts']['publicationReadBacks']['kept']['settledDraft'] = {**original, field: wrong}
                with self.assertRaisesRegex(AssertionError, 'predicted full draft'):
                    self.prove()
                self.report['receipts']['publicationReadBacks']['kept']['settledDraft'] = original

    def test_self_consistent_wrong_decisions_or_version_cannot_become_expectation(self):
        for field, wrong in [('version', 99), ('decisions', [])]:
            with self.subTest(field=field):
                original = copy.deepcopy(self.report)
                plan = self.report['receipts']['publicationPlans']['kept']
                plan['expectedKeepDraft'][field] = wrong
                plan['expectedDraftSha256'] = module.digest(json.dumps(plan['expectedKeepDraft'], separators=(',', ':')))
                self.report['receipts']['publicationReadBacks']['kept']['settledDraft'] = copy.deepcopy(plan['expectedKeepDraft'])
                with self.assertRaisesRegex(AssertionError, 'independently predicted full draft'):
                    self.prove()
                self.report = original

    def test_effect_identity_version_target_and_exact_receipt_are_checked(self):
        for column, value in [('id', 'wrong:4'), ('target_path', '/wrong.md'), ('receipt', json.dumps({**self.report['receipts']['kept'], 'committedMarkdown': 'wrong body'})), ('receipt', json.dumps({**self.report['receipts']['kept'], 'noteId': 'wrong'})), ('proof', '{}')]:
            with self.subTest(column=column, value=value):
                with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
                    original = db.execute(f'SELECT {column} FROM effects WHERE note_id=?', ('kept',)).fetchone()[0]
                    db.execute(f'UPDATE effects SET {column}=? WHERE note_id=?', (value, 'kept'))
                with self.assertRaises(AssertionError):
                    self.prove()
                with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
                    db.execute(f'UPDATE effects SET {column}=? WHERE note_id=?', (original, 'kept'))

    def test_final_saved_bytes_must_match_append_plan_not_the_earlier_save(self):
        path = self.root / 'vault/saved.md'
        raw = path.read_text()
        path.write_text(raw.replace('Echo phrase.\n', ''))
        with self.assertRaisesRegex(AssertionError, 'canonical authored bytes differ'):
            self.prove()

    def test_canonical_edit_is_rejected_even_if_receipt_hashes_are_unchanged(self):
        path = self.root / 'vault/kept.md'
        path.write_text(path.read_text().replace('Edited exact body', 'Edited forged body'))
        with self.assertRaisesRegex(AssertionError, 'canonical authored bytes differ'):
            self.prove()

    def test_report_receipt_and_readback_cannot_substitute_wrong_body_title_path_or_identity(self):
        for role, field, wrong in [('receipt', 'committedMarkdown', 'prefix Edited exact body\n suffix'), ('receipt', 'noteId', 'wrong'), ('canonical', 'markdown', 'wrong'), ('canonical', 'title', 'wrong'), ('canonical', 'path', '/wrong.md'), ('canonical', 'noteId', 'wrong')]:
            with self.subTest(role=role, field=field):
                original = copy.deepcopy(self.report)
                target = self.report['receipts']['kept'] if role == 'receipt' else self.report['receipts']['publicationReadBacks']['kept']['canonical']
                target[field] = wrong
                with self.assertRaises(AssertionError):
                    self.prove()
                self.report = original

    def test_unfinalized_timeline_publication_is_not_accepted_as_proof(self):
        with closing(sqlite3.connect(self.root / 'vault/.gneauxghts/history.sqlite3')) as db, db:
            db.execute("UPDATE publication_receipts SET status='prepared' WHERE note_id='kept'")
        with self.assertRaisesRegex(AssertionError, 'not finalized'):
            self.prove()

    def test_finalized_but_unreleased_timeline_publication_is_rejected(self):
        with closing(sqlite3.connect(self.root / 'vault/.gneauxghts/history.sqlite3')) as db, db:
            db.execute("UPDATE publication_receipts SET live=1 WHERE note_id='kept'")
        with self.assertRaisesRegex(AssertionError, 'not finalized and released'):
            self.prove()


if __name__ == '__main__':
    unittest.main()
