"""Verify single native publication after the disposable desktop fault gate."""
import json
import sys
from pathlib import Path
from closed_sqlite_read import closed_sqlite_read

root = Path(sys.argv[1])
path = root / 'fault-gate.json'
report = json.loads(path.read_text())
for event in report['evidence']:
    if event['fault'] == 'during-model':
        assert event['nativeRequests'] == 2
        continue
    data = root / event['fault']
    ui = event['second']['ui']
    note_id = ui['keepNoteId']
    with closed_sqlite_read(data / 'PROTOTYPE-wipe-me/publication-receipts.sqlite', caller_closed=True) as db:
        effects = db.execute('SELECT note_id,receipt FROM effects WHERE id LIKE ?',
                             (ui['keepId'] + ':%',)).fetchall()
    with closed_sqlite_read(data / 'PROTOTYPE-wipe-me/vault/.gneauxghts/history.sqlite3', caller_closed=True) as db:
        publications = db.execute('SELECT COUNT(*) FROM publication_receipts WHERE note_id=?',
                                  (note_id,)).fetchone()[0]
    files = [p for p in (data / 'PROTOTYPE-wipe-me/vault').glob('*.md') if note_id in p.read_text()]
    assert len(effects) == 1 and effects[0][0] == note_id and effects[0][1]
    assert len(files) == 1 and publications == 1, (event['fault'], files, publications)
    event['singlePublicationProof'] = {'effectRows': 1, 'canonicalFilesWithIdentity': 1,
        'noteTimelinePublicationReceipts': publications, 'noteId': note_id}
path.write_text(json.dumps(report, indent=2) + '\n')
