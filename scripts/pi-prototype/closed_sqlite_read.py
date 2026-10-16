"""Inspect quiescent gate databases without letting SQLite write their originals.

The caller must have stopped the owning app and all other writers. This is not
an online backup API: copying separate database/WAL files needs that boundary.
"""
from contextlib import closing, contextmanager
from pathlib import Path
import shutil
import sqlite3
import tempfile


@contextmanager
def closed_sqlite_read(path, *, caller_closed):
    assert caller_closed is True, 'Stop all database owners before reading gate proof'
    path = Path(path).resolve(strict=True)
    sidecars = [Path(str(path) + suffix) for suffix in ('-wal', '-shm', '-journal')]
    present = [sidecar for sidecar in sidecars if sidecar.exists()]
    if not present:
        # A cleanly closed WAL database can retain its WAL header without any
        # sidecars. immutable prevents SQLite trying to create those sidecars.
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
            db.execute('PRAGMA query_only=ON')
            yield db
        return
    # immutable would ignore committed WAL frames. Recover a complete CLOSED
    # file set instead, with all SQLite writes confined to this disposable copy.
    with tempfile.TemporaryDirectory(prefix='pi-closed-sqlite-') as temporary:
        copied = Path(temporary) / path.name
        shutil.copyfile(path, copied)
        for sidecar in present:
            shutil.copyfile(sidecar, Path(str(copied) + str(sidecar)[len(str(path)):]))
        with closing(sqlite3.connect(copied.as_uri() + '?mode=rw', uri=True)) as db:
            db.execute('PRAGMA query_only=ON')
            yield db
