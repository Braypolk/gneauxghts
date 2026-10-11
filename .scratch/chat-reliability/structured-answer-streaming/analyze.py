"""Recompute the partial pilot and package its offline walkthrough. No inference."""
import hashlib
import json
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[2]
runtime = json.loads((here / 'runtime.json').read_text())
review = json.loads((here / 'review.json').read_text())
provenance = json.loads((here / 'run-provenance.json').read_text())
sha = lambda value: hashlib.sha256(value).hexdigest()
assert provenance['hostBeforeSha256'] == provenance['hostRestoredSha256']
# Production hosts intentionally changed during the subsequent Rig migration.
# Verify their recorded pre-upgrade restoration, not today's runtime bytes.
restoration = json.loads((here / 'completion/host-restoration-verification.json').read_text())
assert restoration['verifiedBeforeRigUpgrade']
assert restoration['currentHosts'] == provenance['hostBeforeSha256']
assert restoration['restoredHosts'] == provenance['hostRestoredSha256']
for path, digest in provenance['sourceHashes'].items():
    assert sha((root / path).read_bytes()) == digest, path
rows = runtime['results']
assert len(rows) == 2 and [r['status'] for r in rows] == ['complete', 'failed']
assert rows[0]['input'] == rows[1]['input']
assert rows[0]['citationSources'] == rows[1]['citationSources']
assert 'flex_unavailable' in rows[1]['error']
summary = {'plannedAnswers': 8, 'attemptedAnswers': len(rows), 'completedAnswers': 1,
           'reasonStopped': 'Flex unavailable on second request; no retry or tier fallback.',
           'failedAttemptUsage': None, 'settings': runtime['settings'], 'variants': {}}
for row in rows:
    arm = row['variant']
    summary['variants'][arm] = {
        'preambleBytes': len(row['preamble'].encode()),
        'schemaBytes': len(json.dumps(row['schema'], separators=(',', ':'), ensure_ascii=False).encode()),
        'completedAnswers': int(row['status'] == 'complete'),
    }
    if row['status'] != 'complete':
        continue
    judgment = review['answers'][row['caseId'] + '/' + arm]
    assert judgment['rawAnswerSha256'] == sha(row['rawAnswer'].encode())
    for observation in judgment['observations']:
        assert observation['quote'] in row['rawAnswer'], observation
    assert row['formatValid'] and row['streamMatchesFinal'] and row['modelCalls'] == 1
    stream = row['stream']
    assert all(not e.get('links') for e in stream['events'])
    assert stream['terminal']['linksReleasedAfterValidation']
    # The formatter serializes the final value again; wire key order can differ.
    wire = ''.join(e['delta'] for e in stream['events'] if e['type'] == 'formatterDelta')
    assert json.loads(wire) == json.loads(row['rawAnswer'])
    draft = [e for e in stream['events'] if e['type'] == 'draftText']
    assert draft and all(e['provisional'] for e in draft)
    assert draft[-1]['text'] == '\n\n'.join(s['text'] for s in row['associations'])
    admitted = {item['id'] for item in row['input']['evidence']['items'] if item['citation']}
    assert all(set(s['passageIds']) <= admitted for s in row['associations'])
    summary['liveStream'] = {
        'caseId': row['caseId'], 'variant': arm, 'usage': row['usage'],
        'modelCalls': row['modelCalls'], 'firstDraftMillis': draft[0]['millis'],
        'finalMillis': stream['terminal']['millis'],
        'previewLeadMillis': stream['terminal']['millis'] - draft[0]['millis'],
        'formatterDeltas': sum(e['type'] == 'formatterDelta' for e in stream['events']),
        'draftUpdates': len(draft), 'previewMatchesFinal': True, 'earlySourceLinks': 0,
        'ordinaryTextDeltaEvents': sum(e['type'] == 'ordinaryTextDelta' for e in row['events']),
        'manualCitationCoveragePass': judgment['citationCoveragePass'],
        'manualFactAndScopePass': judgment['factAndScopePass'],
    }
v, c = [summary['variants'][a] for a in ['verbose', 'compact']]
summary['formatBytesSaved'] = v['preambleBytes'] + v['schemaBytes'] - c['preambleBytes'] - c['schemaBytes']
summary['formatBytesReductionPercent'] = 100 * summary['formatBytesSaved'] / (v['preambleBytes'] + v['schemaBytes'])
summary['totalReportedTokens'] = sum(r.get('usage', {}).get('total_tokens', 0) for r in rows)
summary['tokenReductionMeasured'] = False
summary['limits'] = 'One completed verbose answer is streaming evidence only. No completed compact answer, paired quality/cost comparison, native UI delivery, local model evaluation, or strict-schema guarantee.'
(here / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
data = json.dumps({'runtime': runtime, 'review': review, 'summary': summary}, ensure_ascii=False).replace('</', '<\\/')
template = (here / 'demo.template.html').read_text()
assert template.count('/*DATA*/') == 1
(here / 'demo.html').write_text(template.replace('/*DATA*/', data))
print(json.dumps(summary, indent=2))
