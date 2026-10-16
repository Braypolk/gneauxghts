"""Read one closed synthetic native effect and timeline proof. Never mutates DBs."""
import hashlib
import argparse
import json
import sqlite3
import sys
from pathlib import Path
from closed_sqlite_read import closed_sqlite_read


def snapshot(root, proposal_id, explicit_ios_vault=None):
    root = Path(root).resolve()
    vault = root / 'PROTOTYPE-wipe-me/vault'
    if explicit_ios_vault is not None:
        vault = Path(explicit_ios_vault).resolve()
        assert root.name == 'com.braypolkinghorne.gneauxghts.pi-prototype'
        assert root.parent.name == 'Application Support' and root.parent.parent.name == 'Library'
        expected = root.parents[2] / 'Documents/PROTOTYPE-wipe-me'
        assert vault == expected.resolve(), 'Explicit vault must be the same owned iOS sandbox synthetic Documents vault'
        assert vault.is_relative_to(root.parents[2]), 'Explicit iOS vault escaped the owned app data sandbox'
    ledger = root / 'PROTOTYPE-wipe-me/publication-receipts.sqlite'
    with closed_sqlite_read(ledger, caller_closed=True) as db:
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
        with closed_sqlite_read(history, caller_closed=True) as db:
            effect['publications'] = db.execute(
                'SELECT COUNT(*) FROM publication_receipts WHERE note_id=?', (effect['note_id'],)
            ).fetchone()[0]
    return effect


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root')
    parser.add_argument('proposal_id')
    parser.add_argument('--ios-vault')
    args = parser.parse_args()
    print(json.dumps(snapshot(args.root, args.proposal_id, args.ios_vault)))
