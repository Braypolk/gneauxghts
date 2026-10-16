"""Read-only paired canonical effect proof; no apps, mutation or native build."""
import hashlib
import json
import sys
from pathlib import Path
from closed_sqlite_read import closed_sqlite_read


def snapshot(root, expected):
    root = Path(root).resolve(strict=True)
    histories = list(root.rglob('history.sqlite3'))
    assert len(histories) == 1, 'Expected one generated NoteTimeline database'
    history = histories[0]
    assert not history.is_symlink() and history.is_relative_to(root)
    with closed_sqlite_read(history, caller_closed=True) as connection:
        proof = {}
        for identity, count in sorted(expected.items()):
            assert isinstance(count, int) and count > 0
            rows = connection.execute(
                'SELECT COUNT(*) FROM publication_receipts WHERE note_id=?',
                (identity,)).fetchone()[0]
            assert rows == count, f'{identity}: expected {count} canonical publications, observed {rows}'
            proof[identity] = {'publicationReceipts': rows}
        return proof


if __name__ == '__main__':
    request = json.load(sys.stdin)
    print(json.dumps(snapshot(request['root'], request['expected']), sort_keys=True))
