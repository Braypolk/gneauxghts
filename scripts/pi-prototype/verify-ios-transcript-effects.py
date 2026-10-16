"""Read-only inspection of closed iOS app-owned native and vault roots."""
import hashlib
import json
import runpy
import sqlite3
import sys
from pathlib import Path
from closed_sqlite_read import closed_sqlite_read

identity = runpy.run_path(str(Path(__file__).with_name('verify-transcript-effects.py')))['identity']


def snapshot(native, vault):
    manifest = json.loads((vault / '.gneauxghts/vault.json').read_text())
    files = {}
    for path in vault.rglob('*.md'):
        note_id = identity(path.read_text())
        if note_id:
            files.setdefault(note_id, []).append(path)
    effects = []
    with closed_sqlite_read(native / 'publication-receipts.sqlite', caller_closed=True) as ledger, closed_sqlite_read(vault / '.gneauxghts/history.sqlite3', caller_closed=True) as history:
        ledger.row_factory = sqlite3.Row
        for row in ledger.execute('SELECT id,payload_hash,note_id,target_path,intended_hash,receipt,proof FROM effects ORDER BY id'):
            item = dict(row)
            paths = files.get(item['note_id'], [])
            assert len(paths) == 1, ('Canonical Note Identity is not unique', item['id'])
            item['canonicalSha256'] = hashlib.sha256(paths[0].read_bytes()).hexdigest()
            item['canonicalRelativePath'] = str(paths[0].relative_to(vault))
            item['publications'] = history.execute('SELECT COUNT(*) FROM publication_receipts WHERE note_id=?', [item['note_id']]).fetchone()[0]
            effects.append(item)
    with closed_sqlite_read(native / 'locations.sqlite', caller_closed=True) as locations:
        owner = locations.execute('SELECT vault_id FROM pi_vault_owner WHERE id=1').fetchone()[0]
        roots = json.loads(locations.execute('SELECT roots_json FROM vault_locations WHERE vault_id=?', [manifest['vaultId']]).fetchone()[0])
    with closed_sqlite_read(vault / '.gneauxghts/pi-transcripts.sqlite', caller_closed=True) as projections:
        projections.row_factory = sqlite3.Row
        transcripts = [dict(row) for row in projections.execute('SELECT conversation_id,receipt_hash,intent_hash,detached,warning FROM projections ORDER BY conversation_id')]
    assert owner == manifest['vaultId']
    return {'vaultId': manifest['vaultId'], 'owner': owner, 'locations': roots, 'effects': effects, 'transcripts': transcripts}


if __name__ == '__main__':
    print(json.dumps(snapshot(*map(Path, sys.argv[1:3]))))
