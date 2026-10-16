"""Read-only native receipts/bytes snapshot, called only after the gate app closes."""
import hashlib
import json
import re
import sqlite3
import sys
from contextlib import closing
from pathlib import Path


def readonly(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)


def identity(raw):
    if not raw.startswith('---\n'):
        return None
    frontmatter = raw[4:].split('\n---', 1)[0]
    block = re.search(r'(?m)^gneauxghts:\n((?:[ \t].*(?:\n|$))*)', frontmatter + '\n')
    match = re.search(r'(?m)^  id: ([^\n]+)$', block[1]) if block else None
    return match[1].strip() if match else None


def snapshot(data):
    native = Path(data) / 'PROTOTYPE-wipe-me'
    vault = native / 'vault'
    manifest = json.loads((vault / '.gneauxghts/vault.json').read_text())
    files = {}
    for path in vault.rglob('*.md'):
        note_id = identity(path.read_text())
        if note_id:
            files.setdefault(note_id, []).append(path)
    effects = []
    with closing(readonly(native / 'publication-receipts.sqlite')) as ledger, closing(readonly(vault / '.gneauxghts/history.sqlite3')) as history:
        ledger.row_factory = sqlite3.Row
        for row in ledger.execute('SELECT id,payload_hash,note_id,target_path,intended_hash,receipt,proof FROM effects ORDER BY id'):
            item = dict(row)
            paths = files.get(item['note_id'], [])
            assert len(paths) == 1, ('Canonical Note Identity is not unique', item['id'], paths)
            item['canonicalSha256'] = hashlib.sha256(paths[0].read_bytes()).hexdigest()
            item['canonicalRelativePath'] = str(paths[0].relative_to(vault))
            item['publications'] = history.execute('SELECT COUNT(*) FROM publication_receipts WHERE note_id=?', [item['note_id']]).fetchone()[0]
            effects.append(item)
    with closing(readonly(native / 'locations.sqlite')) as locations:
        owner = locations.execute('SELECT vault_id FROM pi_vault_owner WHERE id=1').fetchone()[0]
        roots = json.loads(locations.execute('SELECT roots_json FROM vault_locations WHERE vault_id=?', [manifest['vaultId']]).fetchone()[0])
    with closing(readonly(vault / '.gneauxghts/pi-transcripts.sqlite')) as projections:
        projections.row_factory = sqlite3.Row
        transcripts = [dict(row) for row in projections.execute('SELECT conversation_id,receipt_hash,intent_hash,detached,warning FROM projections ORDER BY conversation_id')]
    assert owner == manifest['vaultId'], 'Pi root ownership differs from current vault identity'
    return {'vaultId': manifest['vaultId'], 'owner': owner, 'locations': roots, 'effects': effects, 'transcripts': transcripts}


if __name__ == '__main__':
    print(json.dumps(snapshot(Path(sys.argv[1]))))
