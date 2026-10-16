"""Read-only proof for generated native crash roots; never opens a private vault."""
import json
import sqlite3
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
report = json.loads(report_path.read_text())
proofs = []
for case in report['cases']:
    assert case['status'] == 'passed'
    vault = Path(case['root']) / 'PROTOTYPE-wipe-me/vault'
    kept = case.get('kept')
    if kept:
        note_id = kept['noteId']
        with sqlite3.connect(f"file:{Path(case['root']) / 'PROTOTYPE-wipe-me/publication-receipts.sqlite'}?mode=ro", uri=True) as db:
            effects = db.execute('SELECT note_id,receipt FROM effects WHERE id LIKE ?', (kept['proposalId'] + ':%',)).fetchall()
        with sqlite3.connect(f"file:{vault / '.gneauxghts/history.sqlite3'}?mode=ro", uri=True) as db:
            publications = db.execute('SELECT count(*) FROM publication_receipts WHERE note_id=?', (note_id,)).fetchone()[0]
        # These create proposals target the vault root. Managed transcripts live
        # under Chats and may quote the synthetic scope; they are projections.
        files = [path for path in vault.glob('*.md') if note_id in path.read_text()]
        assert len(effects) == 1 and effects[0][0] == note_id and effects[0][1]
        assert publications == 1 and len(files) == 1
        assert f"PI_E2E_CRASH_{case['scope']}" in files[0].read_text()
        proofs.append({'boundary': case['boundary'], 'provider': case['provider'], 'noteId': note_id, 'effectRows': 1, 'canonicalFiles': 1, 'publicationReceipts': 1})
    else:
        files = [path for path in vault.glob('*.md') if f"PI_E2E_CRASH_{case['scope']}" in path.read_text()]
        assert not files
        proofs.append({'boundary': case['boundary'], 'provider': case['provider'], 'canonicalEffects': 0})
print(json.dumps(proofs))
