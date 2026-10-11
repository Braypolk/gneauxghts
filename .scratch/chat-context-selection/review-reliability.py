"""Build trace-bound claim review material offline; semantic judgments stay manual."""
import hashlib
import json
import re
import sys
from pathlib import Path

trace = Path(sys.argv[1])
report = json.loads(trace.read_text())
results = []
for case in report['cases']:
    sources = {s['passage']['id']: s for s in case['sources'] if s.get('passage')}
    claims = []
    for line in case['answer'].splitlines():
        if not line.strip():
            continue
        citations = re.findall(r'\]\(passage:([^\)]+)\)', line)
        claims.append({'text': line, 'citations': citations, 'supportingSources': [
            {'title': sources[c]['title'], 'excerpt': sources[c]['excerpt']}
            for c in citations if c in sources
        ]})
    canonical = []
    reads = []
    for event in case['toolLifecycle']:
        if event['type'] != 'toolresult' or event.get('name') != 'read_notes':
            continue
        part = event['content'][0]
        try:
            value = part.get('value') or json.loads(part['text'])
        except (KeyError, ValueError):
            continue
        if not isinstance(value, dict):
            continue
        coverage = value.get('coverage', {})
        reads.append({'coverage': coverage, 'items': [
            {'title': i.get('title'), 'location': i.get('location'), 'alreadyRead': i.get('alreadyRead'), 'evidenceId': i.get('evidenceId')}
            for i in value.get('items', [])
        ]})
        if coverage.get('scope') == 'canonical_note' and coverage.get('complete'):
            canonical.append(coverage.get('noteId'))
    results.append({
        'name': case['name'], 'variant': case['variant'], 'repeat': case['repeat'],
        'passed': None, 'answerIntentPassed': None, 'factualClaimsSupported': None,
        'completeCanonicalCoverageBeforeAbsence': None,
        'explicitProseRelatedAttribution': None, 'userVisibleRelatedAttribution': None,
        'note': 'PENDING MANUAL REVIEW', 'claims': claims,
        'completeCanonicalNoteIds': canonical, 'reads': reads,
    })
output = Path(sys.argv[2])
assert not output.exists(), 'Do not overwrite completed manual judgments'
output.write_text(json.dumps({'traceSha256': hashlib.sha256(trace.read_bytes()).hexdigest(),
    'rubric': report['semanticReview'], 'results': results}, indent=2) + '\n')
