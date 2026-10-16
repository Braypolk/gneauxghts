"""Metadata counts from an explicitly closed generated Pi database; no row payloads."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from closed_sqlite_read import closed_sqlite_read


def count_closed_churn(database, *, caller_closed):
    assert caller_closed is True, 'Stop all owning processes before copying SQLite proof'
    database = Path(database)
    assert not database.is_symlink(), 'SQLite database symlink refused'
    database = database.resolve(strict=True)
    def family():
        return [database] + [Path(str(database) + suffix) for suffix in ('-wal', '-shm', '-journal')
                             if Path(str(database) + suffix).exists() or Path(str(database) + suffix).is_symlink()]
    def seal():
        result = []
        for path in family():
            assert path.is_file() and not path.is_symlink(), 'Regular closed SQLite family required'
            stat = path.stat()
            result.append((path.name, stat.st_size, stat.st_mtime_ns, stat.st_mode,
                           hashlib.sha256(path.read_bytes()).hexdigest()))
        return result
    before = seal()
    with tempfile.TemporaryDirectory(prefix='pi-churn-proof-') as temporary:
        copied = Path(temporary) / database.name
        for path in family():
            shutil.copy2(path, Path(temporary) / path.name)
        with closed_sqlite_read(copied, caller_closed=True) as db:
            result = count_metadata(db)
    assert seal() == before, 'Original closed SQLite family changed during copied proof'
    result['originalFamilyUnchanged'] = True
    result['copiedFamilyRead'] = True
    result['originalFamilySealSha256'] = hashlib.sha256(json.dumps(before).encode()).hexdigest()
    result['originalSealFields'] = ['bytes', 'size', 'mtime_ns', 'mode']
    result['originalAccessTimeUnchanged'] = None
    return result


def count_metadata(db):
    families = [dict(zip(('kind', 'family', 'current', 'retired', 'revisions'), row)) for row in db.execute('''
            SELECT d.kind, d.family,
                count(DISTINCT CASE WHEN d.retired_at IS NULL THEN d.id END),
                count(DISTINCT CASE WHEN d.retired_at IS NOT NULL THEN d.id END),
                count(r.seq)
            FROM documents d LEFT JOIN document_revisions r ON r.document_id=d.id
            GROUP BY d.kind,d.family ORDER BY d.kind,d.family''')]
    totals = {table: db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
              for table in ('conversations', 'entries', 'tasks', 'submissions', 'documents', 'document_revisions')}
    return {'coverage': 'closed-database-metadata-only', 'callerClosed': True,
            'totals': totals, 'documentFamilies': families, 'collectedDocuments': None,
            'applicationRetirementPolicy': 'absent; archive hides and restores retained conversations',
            'physicalCollection': 'not performed; latest-history replacement may reclaim prior revision rows',
            'upstreamDocumentCache': 'unobserved; private cache is not persistent document count',
            'checkpointPerformed': False, 'payloadsRead': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--closed-process-confirmed', required=True, choices=['yes'])
    args = parser.parse_args()
    print(json.dumps(count_closed_churn(Path(args.database), caller_closed=args.closed_process_confirmed == 'yes')))
