"""Synthetic unit fixtures; these are not native acceptance observations."""
import importlib.util
import copy
from contextlib import closing
import json
import sqlite3
import subprocess
import sys
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
        (self.root / 'vault/.gneauxghts/vault.json').write_text(json.dumps({'vaultId': 'owned-vault'}))
        with closing(sqlite3.connect(self.root / 'locations.sqlite')) as db, db:
            db.execute('CREATE TABLE pi_vault_owner(id INTEGER PRIMARY KEY,vault_id TEXT NOT NULL)')
            db.execute('INSERT INTO pi_vault_owner VALUES(1,?)', ('owned-vault',))
            db.execute('CREATE TABLE vault_locations(vault_id TEXT PRIMARY KEY,roots_json TEXT NOT NULL)')
            db.execute('INSERT INTO vault_locations VALUES(?,?)', ('owned-vault', json.dumps([str(self.root / 'vault')])))
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
        return module.prove(self.root, self.report, self.root / 'retained', self.root)

    def roots(self, values):
        with closing(sqlite3.connect(self.root / 'locations.sqlite')) as db, db:
            db.execute('UPDATE vault_locations SET roots_json=?', (json.dumps([str(value) for value in values]),))

    def move_vault(self):
        old, moved = self.root / 'vault', self.root / 'Documents/PROTOTYPE-wipe-me'
        moved.parent.mkdir()
        old.rename(moved)
        receipts = self.report['receipts']
        for role in ('kept', 'saved', 'appended'):
            plan = receipts['publicationPlans'][role]
            path = str(moved / Path(plan['expectedKeepDraft']['path']).name)
            plan['reviewedDraft']['path'] = plan['expectedKeepDraft']['path'] = path
            plan['expectedDraftSha256'] = module.digest(json.dumps(plan['expectedKeepDraft'], separators=(',', ':')))
            receipts['publicationReadBacks'][role]['settledDraft']['path'] = path
            receipts['publicationReadBacks'][role]['canonical']['path'] = path
            receipts[role]['applied']['path'] = path
            with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
                db.execute('UPDATE effects SET target_path=?,receipt=? WHERE id=?', (path, json.dumps(receipts[role]), f"{role}:{plan['expectedKeepDraft']['version']}"))
        self.roots([old, moved])
        return moved

    def test_registered_ios_documents_root_preserves_all_exact_publication_proofs(self):
        moved = self.move_vault()
        self.assertFalse((self.root / 'vault').exists())
        proofs = self.prove()
        self.assertEqual([value['effectRows'] for value in proofs], [1, 2])
        self.assertEqual([value['timelinePublications'] for value in proofs], [1, 2])
        self.assertEqual(proofs[0]['vaultScope']['vaultId'], 'owned-vault')
        self.assertEqual(proofs[0]['vaultScope']['configuredPath'], str(moved))
        self.assertEqual((moved / 'saved.md').read_bytes(), (self.root / 'retained/saved.md').read_bytes())
        with closing(sqlite3.connect(self.root / 'retained/locations.sqlite')) as db:
            self.assertEqual(db.execute('SELECT vault_id FROM pi_vault_owner').fetchone()[0], 'owned-vault')

    def test_missing_registered_vault_has_no_filesystem_fallback(self):
        # A valid-looking desktop vault still exists, but native registration
        # does not authorize it. Neither directory search nor a guessed path
        # may replace the missing native location proof.
        self.roots([self.root / 'missing-vault'])
        with self.assertRaisesRegex(AssertionError, 'Missing or ambiguous registered vault'):
            self.prove()

    def test_missing_registered_directory_fails_even_with_original_valid_vault(self):
        missing = self.root / 'missing-vault'
        self.roots([missing])
        shared = copy.deepcopy(self.report)
        for role in ('kept', 'saved', 'appended'):
            shared['receipts']['publicationPlans'][role]['expectedKeepDraft']['path'] = str(missing / f'{role}.md')
        with self.assertRaises(FileNotFoundError):
            module.resolve_vault(self.root, shared, self.root)

    def test_duplicate_or_overlapping_registered_roots_are_ambiguous(self):
        for values in ([self.root / 'vault', self.root / 'vault'], [self.root, self.root / 'vault']):
            with self.subTest(values=values):
                self.roots(values)
                with self.assertRaisesRegex(AssertionError, 'ambiguous registered vault'):
                    self.prove()

    def test_foreign_registered_ancestor_cannot_escape_owned_container(self):
        self.roots([self.root.parent])
        with self.assertRaisesRegex(AssertionError, 'outside the owned container'):
            self.prove()

    def test_foreign_manifest_identity_cannot_supply_history_or_canonical_bytes(self):
        (self.root / 'vault/.gneauxghts/vault.json').write_text(json.dumps({'vaultId': 'foreign-vault'}))
        with self.assertRaisesRegex(AssertionError, 'manifest differs from native vault owner'):
            self.prove()

    def test_missing_or_foreign_owner_registration_fails(self):
        with closing(sqlite3.connect(self.root / 'locations.sqlite')) as db, db:
            db.execute("UPDATE pi_vault_owner SET vault_id='foreign-vault'")
        with self.assertRaisesRegex(AssertionError, 'Missing or ambiguous registered native vault locations'):
            self.prove()
        with closing(sqlite3.connect(self.root / 'locations.sqlite')) as db, db:
            db.execute('DELETE FROM pi_vault_owner')
        with self.assertRaisesRegex(AssertionError, 'Missing or ambiguous native vault owner'):
            self.prove()

    def test_invalid_or_empty_native_roots_are_rejected(self):
        for values in ([], ['relative/vault'], [str(self.root / 'vault/../vault')]):
            with self.subTest(values=values):
                self.roots(values)
                with self.assertRaisesRegex(AssertionError, 'Missing registered native vault roots|Invalid absolute native vault location'):
                    self.prove()

    def test_publication_targets_cannot_mix_registered_vaults(self):
        foreign = self.root / 'foreign-vault'
        foreign.mkdir()
        self.roots([self.root / 'vault', foreign])
        shared = copy.deepcopy(self.report)
        shared['receipts']['publicationPlans']['saved']['expectedKeepDraft']['path'] = str(foreign / 'saved.md')
        with self.assertRaisesRegex(AssertionError, 'Missing or ambiguous registered vault'):
            module.resolve_vault(self.root, shared, self.root)

    def test_moved_root_still_rejects_wrong_canonical_bytes_and_exact_receipt(self):
        moved = self.move_vault()
        canonical = moved / 'saved.md'
        original = canonical.read_text()
        canonical.write_text(original.replace('Echo phrase.', 'Forged phrase.'))
        with self.assertRaisesRegex(AssertionError, 'canonical authored bytes differ'):
            self.prove()
        canonical.write_text(original)
        with closing(sqlite3.connect(self.root / 'publication-receipts.sqlite')) as db, db:
            db.execute("UPDATE effects SET target_path='/foreign/saved.md' WHERE note_id='saved'")
        with self.assertRaisesRegex(AssertionError, 'effect target or identity differs'):
            self.prove()

    def test_cli_uses_owned_report_container_and_native_registration_for_ios_documents(self):
        moved = self.move_vault()
        report = {'data': str(self.root), 'phases': [{'phase': 'relaunch', 'shared': [{'phase': 'relaunch', **self.report}]}]}
        report_path = self.root / 'gate.json'
        report_path.write_text(json.dumps(report))
        result = subprocess.run([sys.executable, '-B', str(Path(module.__file__)), str(report_path), str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['nativePublicationProofs'], 2)
        self.assertEqual(json.loads(report_path.read_text())['publicationProof'][0]['vaultScope']['configuredPath'], str(moved))

    def test_vault_symlink_cannot_open_a_foreign_configured_root(self):
        with tempfile.TemporaryDirectory() as foreign:
            target = Path(foreign) / 'foreign-vault'
            (self.root / 'vault').rename(target)
            (self.root / 'vault').symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(AssertionError, 'outside the owned container'):
                self.prove()

    def test_expected_publication_target_symlink_cannot_escape_registered_vault(self):
        with tempfile.TemporaryDirectory() as foreign:
            target = Path(foreign) / 'foreign.md'
            target.write_text('Foreign note')
            path = self.root / 'vault/kept.md'
            path.unlink()
            path.symlink_to(target)
            with self.assertRaisesRegex(AssertionError, 'Publication target escapes'):
                self.prove()

    def test_history_or_publication_database_symlink_cannot_supply_foreign_proof(self):
        for relative, message in [('vault/.gneauxghts/history.sqlite3', 'History database escapes'), ('publication-receipts.sqlite', 'Publication ledger escapes'), ('locations.sqlite', 'Native location database escapes')]:
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as foreign:
                path = self.root / relative
                target = Path(foreign) / path.name
                path.rename(target)
                path.symlink_to(target)
                try:
                    with self.assertRaisesRegex(AssertionError, message):
                        self.prove()
                finally:
                    path.unlink()
                    target.rename(path)

    def test_manifest_or_metadata_directory_symlink_cannot_open_foreign_metadata(self):
        for relative in ('vault/.gneauxghts/vault.json', 'vault/.gneauxghts'):
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as foreign:
                path = self.root / relative
                target = Path(foreign) / path.name
                path.rename(target)
                path.symlink_to(target, target_is_directory=target.is_dir())
                try:
                    with self.assertRaisesRegex(AssertionError, 'Vault manifest escapes'):
                        self.prove()
                finally:
                    path.unlink()
                    target.rename(path)

    def test_extra_canonical_symlink_is_rejected_before_foreign_identity_scan(self):
        with tempfile.TemporaryDirectory() as foreign:
            target = Path(foreign) / 'foreign.md'
            target.write_text('---\ngneauxghts:\n  id: kept\n---\nForeign canonical owner\n')
            (self.root / 'vault/extra.md').symlink_to(target)
            with self.assertRaisesRegex(AssertionError, 'Canonical file escapes'):
                self.prove()

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
