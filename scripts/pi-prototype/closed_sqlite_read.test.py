from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

from closed_sqlite_read import closed_sqlite_read


def file_bytes(directory):
    return {path.name: path.read_bytes() for path in directory.iterdir() if path.is_file()}


class ClosedSqliteReadTests(unittest.TestCase):
    def test_closed_wal_header_without_sidecars_never_creates_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / 'history.sqlite3'
            with closing(sqlite3.connect(path)) as writer, writer:
                self.assertEqual(writer.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
                writer.execute('CREATE TABLE publication_receipts(note_id TEXT)')
                writer.execute("INSERT INTO publication_receipts VALUES('accepted')")
                writer.commit()
                writer.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchall()
            # Some SQLite builds retain empty sidecars after closing. Removing
            # this checkpointed, closed file set models the native failure case.
            wal = Path(str(path) + '-wal')
            if wal.exists():
                self.assertEqual(wal.stat().st_size, 0)
                wal.unlink()
            Path(str(path) + '-shm').unlink(missing_ok=True)
            self.assertEqual(path.read_bytes()[18:20], b'\x02\x02')
            before = file_bytes(directory)
            self.assertEqual(set(before), {'history.sqlite3'})
            with closed_sqlite_read(path, caller_closed=True) as db:
                self.assertEqual(db.execute('SELECT note_id FROM publication_receipts').fetchall(), [('accepted',)])
                with self.assertRaises(sqlite3.OperationalError):
                    db.execute("INSERT INTO publication_receipts VALUES('forbidden')")
            self.assertEqual(file_bytes(directory), before)

    def test_uncheckpointed_wal_commits_are_read_without_touching_originals(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            producer = directory / 'producer.sqlite'
            closed_root = directory / 'closed'
            closed_root.mkdir()
            with closing(sqlite3.connect(producer)) as writer:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('PRAGMA wal_autocheckpoint=0')
                writer.execute('CREATE TABLE receipts(id INTEGER)')
                writer.commit()
                writer.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                writer.executemany('INSERT INTO receipts VALUES(?)', [(1,), (2,)])
                writer.commit()
                # Copy a quiet producer to model files left by abrupt exit. No
                # connection ever owns the copied root used by the proof reader.
                for suffix in ('', '-wal', '-shm'):
                    shutil.copyfile(Path(str(producer) + suffix), closed_root / ('proof.sqlite' + suffix))
            path = closed_root / 'proof.sqlite'
            before = file_bytes(closed_root)
            self.assertGreater(len(before['proof.sqlite-wal']), 32)
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as main_only:
                self.assertEqual(main_only.execute('SELECT COUNT(*) FROM receipts').fetchone()[0], 0)
            with closed_sqlite_read(path, caller_closed=True) as db:
                self.assertEqual(db.execute('SELECT id FROM receipts ORDER BY id').fetchall(), [(1,), (2,)])
            self.assertEqual(file_bytes(closed_root), before)
            # A WAL without SHM must also recover exclusively on the copy.
            Path(str(path) + '-shm').unlink()
            before = file_bytes(closed_root)
            with closed_sqlite_read(path, caller_closed=True) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0], 2)
            self.assertEqual(file_bytes(closed_root), before)

    def test_requires_explicit_closed_caller_and_existing_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary) / 'missing.sqlite'
            with self.assertRaisesRegex(AssertionError, 'Stop all database owners'):
                with closed_sqlite_read(missing, caller_closed=False):
                    self.fail('unreachable')
            with self.assertRaises(FileNotFoundError):
                with closed_sqlite_read(missing, caller_closed=True):
                    self.fail('unreachable')
            self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
