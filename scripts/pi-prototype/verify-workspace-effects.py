"""Read-only proof for the shared workspace gate, after the app has terminated.

Keep and duplicate Keep produce one effect. Whole-answer Save plus the explicit
selected append produce two effects against one stable identity. Retained bytes
are synthetic fixture data; no user vault is accepted by the driver.
"""
import hashlib
from contextlib import closing
import json
import re
import sqlite3
import sys
from pathlib import Path
from closed_sqlite_read import closed_sqlite_read


def managed_identity(raw):
    # App-generated fixture metadata uses the canonical unquoted nested id.
    # A reference to an identity in ordinary authored text is not ownership.
    if not raw.startswith('---\n'):
        return None
    frontmatter = raw[4:].split('\n---', 1)[0]
    block = re.search(r'(?m)^gneauxghts:\n((?:[ \t].*(?:\n|$))*)', frontmatter + '\n')
    match = re.search(r'(?m)^  id: ([^\n]+)$', block[1]) if block else None
    return match[1].strip() if match else None


def prove(native_root, shared, retained):
    native_root, retained = Path(native_root), Path(retained)
    retained.mkdir(parents=True, exist_ok=True)
    ledger = native_root / 'publication-receipts.sqlite'
    history = native_root / 'vault/.gneauxghts/history.sqlite3'
    proof = []
    with closed_sqlite_read(ledger, caller_closed=True) as effects, closed_sqlite_read(history, caller_closed=True) as timeline:
        # SQLite backup captures a consistent database including any retained WAL.
        for source, name in [(effects, 'publication-receipts.sqlite'), (timeline, 'history.sqlite3')]:
            with closing(sqlite3.connect(retained / name)) as target:
                source.backup(target)
        for key, count in [('kept', 1), ('saved', 2)]:
            receipt = shared['receipts'][key]
            note_id = receipt['noteId']
            rows = effects.execute('SELECT id,note_id,target_path,receipt,proof FROM effects WHERE note_id=?', (note_id,)).fetchall()
            assert len(rows) == count, (key, 'unexpected native effects', len(rows), count)
            assert all(row[3] and row[4] for row in rows), (key, 'missing durable receipt or timeline proof')
            assert all(json.loads(row[3])['noteId'] == note_id for row in rows), 'Receipt identity changed'
            publications = timeline.execute('SELECT COUNT(*) FROM publication_receipts WHERE note_id=?', (note_id,)).fetchone()[0]
            assert publications == count, (key, 'duplicate or missing timeline publication', publications, count)
            paths = [path for path in (native_root / 'vault').rglob('*.md') if managed_identity(path.read_text()) == note_id]
            assert len(paths) == 1, (key, 'canonical identity is not unique', len(paths))
            path = paths[0]
            assert path.resolve() == Path(rows[-1][2]).resolve(), (key, 'effect target differs from canonical identity')
            data = path.read_bytes()
            (retained / f'{key}.md').write_bytes(data)
            proof.append({'role': key, 'noteId': note_id, 'effectRows': len(rows), 'timelinePublications': publications,
                          'canonicalFilesWithIdentity': len(paths), 'canonicalSha256': hashlib.sha256(data).hexdigest(),
                          'receipts': [json.loads(row[3]) for row in rows], 'timelineProofs': [json.loads(row[4]) for row in rows]})
    return proof


if __name__ == '__main__':
    report_path, native_root = map(Path, sys.argv[1:3])
    report = json.loads(report_path.read_text())
    relaunch = next(phase for phase in report['phases'] if phase['phase'] == 'relaunch')
    shared = next(phase for phase in relaunch['shared'] if phase['phase'] == 'relaunch')
    report['publicationProof'] = prove(native_root, shared, report_path.parent / 'retained-native')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'nativePublicationProofs': len(report['publicationProof'])}))
