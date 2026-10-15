from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('evaluation_data', Path(__file__).with_name('evaluation_data.py'))
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)


class EvaluationDataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pi-copy-test-', dir='/private/tmp')
        self.base = Path(self.temporary.name)
        self.source = self.base / 'source'
        self.root = self.base / 'evaluation'
        (self.source / '.gneauxghts').mkdir(parents=True)
        (self.source / 'Note.md').write_text('---\ngneauxghts:\n  id: note-one\n---\nPrivate ordinary note\n')
        (self.source / 'asset.bin').write_bytes(b'asset bytes')
        manifest = {'schemaVersion': 2, 'vaultId': 'vault-one', 'historyFormat': 'sqlite-v1', 'historyGeneration': 1}
        (self.source / '.gneauxghts/vault.json').write_text(json.dumps(manifest))
        with closing(sqlite3.connect(self.source / data.HISTORY)) as db, db:
            db.execute('CREATE TABLE history_metadata(singleton,vault_id,history_format,history_generation,schema_version,store_instance_id,clean_close_sequence,portability_state)')
            db.execute("INSERT INTO history_metadata VALUES(1,'vault-one','sqlite-v1',1,14,'store-one',2,'portable')")
            for table in data.PENDING:
                db.execute(f'CREATE TABLE {table}(id)')
            db.execute('CREATE TABLE publication_receipts(status,live,outcome)')
            db.execute("INSERT INTO publication_receipts VALUES('finalized',0,'revision-one')")
            db.execute('CREATE TABLE history_reset_rebuild(pending)')
            db.execute('INSERT INTO history_reset_rebuild VALUES(0)')
            db.execute('CREATE TABLE revisions(revision_id,payload,result_hash)')
            db.execute("INSERT INTO revisions VALUES('revision-one',X'010203','retained-hash')")
            for table, columns in data.PATH_COLUMNS.items():
                db.execute(f"CREATE TABLE {table}({','.join(columns)})")
                db.execute(f"INSERT INTO {table} VALUES({','.join(['?'] * len(columns))})", [str(self.source / 'Note.md')] * len(columns))

    def tearDown(self):
        self.temporary.cleanup()

    def mutate(self, sql):
        with closing(sqlite3.connect(self.source / data.HISTORY)) as db, db:
            db.execute(sql)

    def test_copy_isolated_identity_payloads_paths_and_no_legacy_import(self):
        (self.source / 'Chats').mkdir()
        (self.source / 'Chats/Old.md').write_text('old transcript')
        (self.source / 'Moved.md').write_text('---\ngneauxghts:\n  kind: chatTranscript\n---\nold answer')
        (self.source / '.gneauxghts/app.sqlite').write_bytes(b'not copied')
        (self.source / '.gneauxghts/credentials.json').write_text('not copied')
        before = data.inventory(self.source)
        result = data.create(self.root, self.source)
        self.assertTrue(result['copied'])
        self.assertEqual(data.inventory(self.source), before)
        copy = self.root / data.VAULT
        self.assertEqual((copy / 'Note.md').read_bytes(), (self.source / 'Note.md').read_bytes())
        self.assertEqual((copy / 'asset.bin').read_bytes(), b'asset bytes')
        self.assertFalse((copy / 'Chats').exists())
        self.assertFalse((copy / 'Moved.md').exists())
        self.assertEqual(sorted(p.name for p in (copy / '.gneauxghts').iterdir()), ['history.sqlite3', 'vault.json'])
        with closing(sqlite3.connect(copy / data.HISTORY)) as db, db:
            self.assertEqual(db.execute('SELECT * FROM revisions').fetchone(), ('revision-one', b'\x01\x02\x03', 'retained-hash'))
            self.assertEqual(db.execute('SELECT current_path FROM timeline_heads').fetchone()[0], str(copy / 'Note.md'))
        (copy / 'Note.md').write_text('changed copy')
        self.assertEqual(data.inventory(self.source), before)
        self.assertEqual(data.recognized(self.root)['history'], data.portable(copy))

    def recovery_observations(self):
        self.mutate("UPDATE history_metadata SET portability_state='open',clean_close_sequence=0")
        observation = self.base / 'original-observations.json'
        observation.write_text(json.dumps({'vaults': {
            'vault-one': {'historyFormat': 'sqlite-v1', 'generation': 1, 'storeInstanceId': 'store-one',
                          'cleanCloseSequence': 0, 'allowMissingStore': False, 'resetRebuildPending': False},
            'unrelated-vault': {'private': 'must not copy this entry'}
        }}))
        return observation

    def test_stopped_open_export_is_quarantined_with_only_exact_original_observation(self):
        observation = self.recovery_observations()
        before = data.inventory(self.source)
        original_observation = observation.read_bytes()
        report = data.export_stopped_recovery(self.root, self.source, observation)
        quarantine = data.recovery_root(self.root)
        self.assertFalse(self.root.exists())
        self.assertFalse((quarantine / data.MARKER).exists())
        self.assertEqual(report['kind'], data.RECOVERY_KIND)
        self.assertEqual(report['history']['portabilityState'], 'open')
        self.assertEqual(report['history']['cleanCloseSequence'], 0)
        copied = json.loads((quarantine / 'note-timeline-history-observations.json').read_text())
        self.assertEqual(copied, {'vaults': {'vault-one': json.loads(original_observation)['vaults']['vault-one']}})
        self.assertEqual(data.inventory(self.source), before)
        self.assertEqual(observation.read_bytes(), original_observation)
        with self.assertRaisesRegex(ValueError, 'pending'):
            data.create(self.root)
        with self.assertRaisesRegex(ValueError, 'portable'):
            data.adopt_recovered(self.root, quarantine)
        with self.assertRaisesRegex(ValueError, 'unrecognized'):
            data.recognized(quarantine)

    def test_recovery_observation_mismatch_refuses_export(self):
        observation = self.recovery_observations()
        value = json.loads(observation.read_text())
        value['vaults']['vault-one']['storeInstanceId'] = 'different-store'
        observation.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'does not exactly match'):
            data.export_stopped_recovery(self.root, self.source, observation)
        self.assertFalse(data.recovery_root(self.root).exists())
        self.assertFalse(self.root.exists())

    def test_recovery_observation_race_refuses_export(self):
        observation = self.recovery_observations()
        copy = data.copy_files
        def raced(source, destination):
            result = copy(source, destination)
            observation.write_text(observation.read_text() + ' ')
            return result
        with patch.object(data, 'copy_files', side_effect=raced):
            with self.assertRaisesRegex(ValueError, 'observation changed'):
                data.export_stopped_recovery(self.root, self.source, observation)
        self.assertFalse(data.recovery_root(self.root).exists())
        self.assertFalse(list(self.base.glob('evaluation.stopped-recovery.staging-*')))

    def test_recovery_still_rejects_pending_rows_and_nonempty_wal(self):
        observation = self.recovery_observations()
        self.mutate('INSERT INTO pending_editing_windows VALUES(1)')
        with self.assertRaisesRegex(ValueError, 'unsettled'):
            data.export_stopped_recovery(self.root, self.source, observation)
        self.mutate('DELETE FROM pending_editing_windows')
        Path(str(self.source / data.HISTORY) + '-wal').write_bytes(b'live bytes')
        with self.assertRaisesRegex(ValueError, 'Nonempty history WAL'):
            data.export_stopped_recovery(self.root, self.source, observation)
        self.assertFalse(self.root.exists())

    def test_adoption_requires_advanced_matching_clean_close_and_preserves_source(self):
        observation = self.recovery_observations()
        source_before = data.inventory(self.source)
        data.export_stopped_recovery(self.root, self.source, observation)
        quarantine = data.recovery_root(self.root)
        # Synthetic contract fixture only: these writes stand in for a native
        # close receipt. They do not establish real NoteTimeline recovery.
        with closing(sqlite3.connect(quarantine / data.VAULT / data.HISTORY)) as db, db:
            db.execute("UPDATE history_metadata SET portability_state='portable',clean_close_sequence=1")
        with self.assertRaisesRegex(ValueError, 'same clean-close watermark'):
            data.adopt_recovered(self.root, quarantine)
        observed_path = quarantine / 'note-timeline-history-observations.json'
        observed = json.loads(observed_path.read_text())
        observed['vaults']['vault-one']['cleanCloseSequence'] = 1
        observed_path.write_text(json.dumps(observed))
        adopted = data.adopt_recovered(self.root, quarantine)
        self.assertEqual(adopted['history']['cleanCloseSequence'], 1)
        self.assertEqual(data.inventory(self.source), source_before)
        self.assertEqual(data.recognized(self.root)['kind'], data.KIND)
        self.assertEqual(json.loads((quarantine / data.RECOVERY_MARKER).read_text())['state'], 'adopted')
        with closing(sqlite3.connect(self.root / data.VAULT / data.HISTORY)) as db:
            self.assertEqual(db.execute('SELECT current_path FROM timeline_heads').fetchone()[0], str(self.root / data.VAULT / 'Note.md'))

    def test_open_history_without_wal_is_rejected(self):
        self.mutate("UPDATE history_metadata SET portability_state='open',clean_close_sequence=0")
        with self.assertRaisesRegex(ValueError, 'portable'):
            data.create(self.root, self.source)
        self.assertFalse(self.root.exists())

    def test_nonempty_wal_is_rejected(self):
        Path(str(self.source / data.HISTORY) + '-wal').write_bytes(b'live bytes')
        with self.assertRaisesRegex(ValueError, 'Nonempty history WAL'):
            data.create(self.root, self.source)
        self.assertFalse(self.root.exists())

    def test_pending_work_rejected(self):
        self.mutate('INSERT INTO pending_editing_windows VALUES(1)')
        with self.assertRaisesRegex(ValueError, 'unsettled'):
            data.create(self.root, self.source)
        self.assertFalse(self.root.exists())

    def test_mismatched_manifest_rejected(self):
        self.mutate('UPDATE history_metadata SET history_generation=2')
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            data.create(self.root, self.source)

    def test_symlink_in_excluded_folder_rejected(self):
        (self.source / 'Chats').mkdir()
        (self.source / 'Chats/link').symlink_to(self.base)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            data.create(self.root, self.source)

    def test_source_change_during_copy_does_not_adopt_partial_root(self):
        copy = data.copy_files
        def changed(source, destination):
            result = copy(source, destination)
            (source / 'Note.md').write_text('a racing writer')
            return result
        with patch.object(data, 'copy_files', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'changed during copying'):
                data.create(self.root, self.source)
        self.assertFalse(self.root.exists())
        self.assertFalse(list(self.base.glob('evaluation.staging-*')))
        # A repeat after a failed setup publishes a complete copy.
        data.create(self.root, self.source)
        self.assertTrue((self.root / data.VAULT / 'Note.md').is_file())

    def test_live_source_handle_is_rejected(self):
        with (self.source / 'Note.md').open():
            with self.assertRaisesRegex(ValueError, 'Close the app'):
                data.create(self.root, self.source)

    def test_external_history_path_is_rejected_without_publication(self):
        self.mutate("UPDATE timeline_heads SET current_path='/outside/Note.md'")
        with self.assertRaisesRegex(ValueError, 'outside'):
            data.create(self.root, self.source)
        self.assertFalse(self.root.exists())
        self.assertFalse(list(self.base.glob('evaluation.staging-*')))

    def test_nested_roots_and_preexisting_data_rejected(self):
        before = data.inventory(self.source)
        with self.assertRaisesRegex(ValueError, 'non-nested'):
            data.create(self.source / 'evaluation', self.source)
        self.assertEqual(data.inventory(self.source), before)
        self.root.mkdir()
        (self.root / 'sentinel').write_text('retain me')
        with self.assertRaisesRegex(ValueError, 'already contains'):
            data.create(self.root, self.source)
        self.assertEqual((self.root / 'sentinel').read_text(), 'retain me')

    def test_root_symlink_and_unrecognized_reset_are_rejected(self):
        self.root.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            data.safe_path(self.root)
        with self.assertRaisesRegex(ValueError, 'unrecognized'):
            data.recognized(self.source)

    def test_init_reuse_and_launch_lock(self):
        first = data.create(self.root)
        self.assertEqual(data.recognized(self.root), first)
        self.assertTrue((self.root / data.VAULT).is_dir())
        with data.operation(self.root):
            with self.assertRaisesRegex(ValueError, 'owns this root'):
                with data.operation(self.root):
                    pass
        self.assertEqual(data.recognized(self.root), first)


if __name__ == '__main__':
    unittest.main()
