"""Read one closed synthetic native effect and timeline proof. Never mutates DBs."""
from contextlib import closing
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def snapshot(root, proposal_id):
    root = Path(root).resolve()
    vault = root / 'PROTOTYPE-wipe-me/vault'
    ledger = root / 'PROTOTYPE-wipe-me/publication-receipts.sqlite'
    with closing(sqlite3.connect(ledger.as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute('SELECT * FROM effects WHERE id LIKE ?', (proposal_id + ':%',)).fetchall()
    assert len(rows) == 1, 'Expected exactly one accepted native effect'
    effect = dict(rows[0])
    target = Path(effect['target_path']).resolve()
    assert target.is_relative_to(vault), 'Canonical receipt escaped generated synthetic vault'
    effect['canonicalSha256'] = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    history = vault / '.gneauxghts/history.sqlite3'
    effect['publications'] = 0
    if history.exists():
        with closing(sqlite3.connect(history.as_uri() + '?mode=ro', uri=True)) as db:
            effect['publications'] = db.execute(
                'SELECT COUNT(*) FROM publication_receipts WHERE note_id=?', (effect['note_id'],)
            ).fetchone()[0]
    return effect


if __name__ == '__main__':
    print(json.dumps(snapshot(sys.argv[1], sys.argv[2])))
