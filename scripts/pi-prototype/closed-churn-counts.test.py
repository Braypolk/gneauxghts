import importlib.util
from contextlib import closing
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('closed_churn_counts', Path(__file__).with_name('closed-churn-counts.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ClosedChurnCounts(unittest.TestCase):
    def test_retained_wal_is_observed_on_copies_with_original_bytes_and_metadata_sealed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            producer = root / 'producer.sqlite'
            closed = root / 'closed'
            closed.mkdir()
            with closing(sqlite3.connect(producer)) as writer:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('PRAGMA wal_autocheckpoint=0')
                for table in ('conversations', 'entries', 'tasks', 'submissions'):
                    writer.execute(f'CREATE TABLE {table}(id INTEGER)')
                writer.execute('CREATE TABLE documents(id INTEGER,kind TEXT,family INTEGER,retired_at INTEGER)')
                writer.execute('CREATE TABLE document_revisions(document_id INTEGER,seq INTEGER)')
                writer.commit()
                writer.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                writer.execute("INSERT INTO documents VALUES(1,'pending-review',1,NULL)")
                writer.execute('INSERT INTO document_revisions VALUES(1,1)')
                writer.commit()
                for suffix in ('', '-wal', '-shm'):
                    shutil.copy2(Path(str(producer) + suffix), closed / ('pi.sqlite' + suffix))
            before = {path.name:path.read_bytes() for path in closed.iterdir()}
            result = module.count_closed_churn(closed / 'pi.sqlite', caller_closed=True)
            self.assertEqual(result['totals']['documents'], 1)
            self.assertEqual(result['documentFamilies'][0]['kind'], 'pending-review')
            self.assertTrue(result['copiedFamilyRead'])
            self.assertTrue(result['originalFamilyUnchanged'])
            self.assertEqual({path.name:path.read_bytes() for path in closed.iterdir()}, before)

    def test_counts_families_without_multiplying_documents_by_revisions(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'pi.sqlite'
            with sqlite3.connect(path) as db:
                for table in ('conversations', 'entries', 'tasks', 'submissions'):
                    db.execute(f'CREATE TABLE {table}(id INTEGER)')
                db.execute('CREATE TABLE documents(id INTEGER,kind TEXT,family INTEGER,retired_at INTEGER)')
                db.execute('CREATE TABLE document_revisions(document_id INTEGER,seq INTEGER)')
                db.executemany('INSERT INTO documents VALUES (?,?,?,?)', [(1,'current',0,None),(2,'evidence-run',1,None),(3,'evidence-run',1,10)])
                db.executemany('INSERT INTO document_revisions VALUES (?,?)', [(1,1),(2,2),(2,3)])
            before = path.read_bytes()
            result = module.count_closed_churn(path, caller_closed=True)
            self.assertEqual(result['documentFamilies'], [
                {'kind':'current','family':0,'current':1,'retired':0,'revisions':1},
                {'kind':'evidence-run','family':1,'current':1,'retired':1,'revisions':2}])
            self.assertEqual(result['totals']['documents'], 3)
            self.assertIsNone(result['collectedDocuments'])
            self.assertEqual(path.read_bytes(), before)
            with self.assertRaises(AssertionError):
                module.count_closed_churn(path, caller_closed=False)


if __name__ == '__main__':
    unittest.main()
