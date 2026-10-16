"""Read-only proof for the shared workspace gate, after the app has terminated.

Keep and duplicate Keep produce one effect. Whole-answer Save plus the explicit
selected append produce two effects against one stable identity. Retained bytes
are synthetic fixture data; no user vault is accepted by the driver.
"""
import hashlib
import copy
from contextlib import closing
import json
import re
import sqlite3
import sys
from pathlib import Path
from closed_sqlite_read import closed_sqlite_read


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_body(value):
    return value.replace('\r\n', '\n').replace('!\\[\\[', '![[').replace('\\[\\[', '[[').replace('\\]\\]', ']]')


def editor_markdown(body, path):
    # note.rs::strip_leading_title_heading, including its trailing-newline rule.
    lines = body.split('\n')
    if lines[-1] == '':
        lines.pop()
    first = next((i for i, line in enumerate(lines) if line.strip()), None)
    key = lambda text: ''.join(char.lower() for char in text if char.isalnum())
    if first is None or not lines[first].strip().startswith('# '):
        return body
    heading = lines[first].strip()[2:].strip()
    if not heading or key(heading) != key(Path(path).stem):
        return body
    lines.pop(first)
    if first < len(lines) and not lines[first].strip():
        lines.pop(first)
    return '\n'.join(lines)


def validate_plan(plan, read_back, receipt):
    assert plan['proposalId'] and plan['reviewId'], 'Missing independent proposal/review identity'
    reviewed = plan['reviewedDraft']
    expected = copy.deepcopy(reviewed)
    for hunk in expected['decisions']:
        if hunk['status'] in ('pending', 'modified'):
            hunk['status'] = 'kept'
    expected['version'] += expected['decisions'] != reviewed['decisions']
    assert plan['expectedKeepDraft'] == expected, 'Expected Keep is not the independently predicted full draft'
    assert read_back['settledDraft'] == expected, 'Settled Keep differs from independently predicted full draft'
    serialized = json.dumps(plan['expectedKeepDraft'], ensure_ascii=False, separators=(',', ':'))
    assert digest(serialized) == plan['expectedDraftSha256'], 'Expected full draft hash differs'
    body = normalize_body(expected['markdown'])
    assert not body.startswith('---\n'), 'Shared synthetic draft unexpectedly contains frontmatter'
    editor = editor_markdown(body, expected['path'])
    assert plan['expectedEditorMarkdown'] == editor, 'Expected editor Markdown differs from authored draft'
    assert plan['expectedEditorSha256'] == digest(editor) == read_back['editorSha256'], 'Expected editor hash differs'
    assert receipt['status'] == 'committed' and receipt['noteId'], 'Missing committed receipt identity'
    assert plan['expectedNoteId'] is None or receipt['noteId'] == plan['expectedNoteId'], 'Existing Note Identity changed'
    assert receipt['applied']['path'] == expected['path'], 'Receipt target differs from expected Keep'
    assert receipt['committedMarkdown'] == editor, 'Receipt differs from exact expected editor Markdown'
    canonical = read_back['canonical']
    assert canonical['noteId'] == receipt['noteId'] and canonical['path'] == expected['path'] and canonical['title'] == expected['title'], 'Canonical read-back identity, title or path differs'
    assert canonical['markdown'] == editor, 'Canonical read-back differs from exact expected editor Markdown'
    return expected, body


def canonical_body(raw, note_id):
    # The shared gate authors no unmanaged metadata. Require the exact native
    # managed shape; only timestamps are assigned during publication.
    metadata = re.fullmatch(r'---\ngneauxghts:\n  id: ([^\n]+)\n  created_at: ([^\n]+)\n  updated_at: ([^\n]+)\n  trashed_at: null\n  kind: note\n---\n(?:\n([\s\S]*))?', raw)
    assert metadata and metadata[1] == note_id, 'Canonical managed metadata differs from expected Note Identity/contract'
    return metadata[4] or ''


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
    plans = shared['receipts']['publicationPlans']
    read_backs = shared['receipts']['publicationReadBacks']
    expectations = {role: validate_plan(plans[role], read_backs[role], shared['receipts'][role]) for role in ('kept', 'saved', 'appended')}
    assert shared['receipts']['saved']['noteId'] == shared['receipts']['appended']['noteId'], 'Append changed stable Note Identity'
    assert plans['appended']['expectedNoteId'] == shared['receipts']['saved']['noteId'], 'Append was not independently targeted at saved identity'
    with closed_sqlite_read(ledger, caller_closed=True) as effects, closed_sqlite_read(history, caller_closed=True) as timeline:
        # SQLite backup captures a consistent database including any retained WAL.
        for source, name in [(effects, 'publication-receipts.sqlite'), (timeline, 'history.sqlite3')]:
            with closing(sqlite3.connect(retained / name)) as target:
                source.backup(target)
        for key, roles in [('kept', ['kept']), ('saved', ['saved', 'appended'])]:
            count = len(roles)
            receipt = shared['receipts'][key]
            note_id = receipt['noteId']
            rows = effects.execute('SELECT id,note_id,target_path,receipt,proof FROM effects WHERE note_id=?', (note_id,)).fetchall()
            assert len(rows) == count, (key, 'unexpected native effects', len(rows), count)
            assert all(row[3] and row[4] is None for row in rows), (key, 'missing durable receipt or unsettled recovery proof')
            by_id = {row[0]: row for row in rows}
            expected_ids = {f"{plans[role]['proposalId']}:{expectations[role][0]['version']}" for role in roles}
            assert set(by_id) == expected_ids, (key, 'effect identity/version differs from independent Keep plan')
            for role in roles:
                expected = expectations[role][0]
                row = by_id[f"{plans[role]['proposalId']}:{expected['version']}"]
                assert row[1] == note_id and row[2] == expected['path'], (role, 'effect target or identity differs')
                assert json.loads(row[3]) == shared['receipts'][role], (role, 'durable receipt differs from exact observed receipt')
            publications = timeline.execute('SELECT intent_id,note_id,sequence,kind,status,live FROM publication_receipts WHERE note_id=? ORDER BY sequence', (note_id,)).fetchall()
            assert len(publications) == count, (key, 'duplicate or missing timeline publication', len(publications), count)
            # publish_authored releases both create and edit point receipts after
            # finalization. Their temporary effect->intent token is then cleared;
            # retain timeline identity/sequence scope, without inventing that join.
            assert all(row[1] == note_id and row[3:] == ('point', 'finalized', 0) for row in publications), (key, 'timeline publication is not finalized and released for exact identity')
            paths = [path for path in (native_root / 'vault').rglob('*.md') if managed_identity(path.read_text()) == note_id]
            assert len(paths) == 1, (key, 'canonical identity is not unique', len(paths))
            path = paths[0]
            final_role = roles[-1]
            expected, expected_body = expectations[final_role]
            assert path.resolve() == Path(expected['path']).resolve(), (key, 'effect target differs from canonical identity')
            assert path.stem == expected['title'], (key, 'canonical title differs from authored draft')
            data = path.read_bytes()
            body = canonical_body(data.decode(), note_id)
            assert body == expected_body, (key, 'canonical authored bytes differ from final Keep plan')
            assert digest(editor_markdown(body, path)) == plans[final_role]['expectedEditorSha256'], (key, 'canonical editor hash differs from final Keep plan')
            (retained / f'{key}.md').write_bytes(data)
            proof.append({'role': key, 'noteId': note_id, 'effectRows': len(rows), 'timelinePublications': len(publications),
                          'canonicalFilesWithIdentity': len(paths), 'canonicalSha256': hashlib.sha256(data).hexdigest(),
                          'expectedFinalRole': final_role, 'expectedEditorSha256': plans[final_role]['expectedEditorSha256'],
                          'expectedDraftSha256ByEffect': {f"{plans[role]['proposalId']}:{expectations[role][0]['version']}": plans[role]['expectedDraftSha256'] for role in roles},
                          'receipts': [json.loads(row[3]) for row in rows], 'timelineProofs': [dict(zip(['intentId', 'noteId', 'sequence', 'kind', 'status', 'live'], row)) for row in publications]})
    return proof


if __name__ == '__main__':
    report_path, native_root = map(Path, sys.argv[1:3])
    report = json.loads(report_path.read_text())
    relaunch = next(phase for phase in report['phases'] if phase['phase'] == 'relaunch')
    shared = next(phase for phase in relaunch['shared'] if phase['phase'] == 'relaunch')
    report['publicationProof'] = prove(native_root, shared, report_path.parent / 'retained-native')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'nativePublicationProofs': len(report['publicationProof'])}))
