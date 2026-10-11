"""Recompute the completed Rig 0.41 comparison. No inference or host mutation."""
import hashlib
import json
from pathlib import Path
import statistics

here = Path(__file__).resolve().parent
base = here.parent
root = base.parents[2]
read = lambda p: json.loads(p.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
original, continuation = read(base/'runtime.json'), read(here/'runtime.json')
review = read(here/'review.json')['answers']
provenance = read(here/'run-provenance.json')
assert provenance['hostBeforeSha256'] == provenance['hostRestoredSha256']
assert read(here/'host-restoration-verification.json')['currentHosts'] == provenance['hostBeforeSha256']
# Production hosts/manifest intentionally change after this historical comparison.
for path, digest in provenance['sourceHashes'].items():
    if path.startswith('.scratch/'):
        assert sha((root/path).read_bytes()) == digest, path
assert original['settings'] == continuation['settings']
assert original['corpusSnapshot'] == continuation['corpusSnapshot']
rows = [r for run in [original,continuation] for r in run['results'] if r['status']=='complete']
assert len(rows)==8 and len(continuation['results'])==7
assert len({(r['caseId'],r['variant']) for r in rows})==8
for case in original['corpusSnapshot']['cases']:
    pair=[r for r in rows if r['caseId']==case['id']]
    assert pair[0]['input']==pair[1]['input'] and pair[0]['citationSources']==pair[1]['citationSources']
for row in rows:
    judgment=review[row['caseId']+'/'+row['variant']]
    assert judgment['rawAnswerSha256']==sha(row['rawAnswer'].encode())
    assert all(o['quote'] in row['rawAnswer'] for o in judgment['observations'])
    assert row['modelCalls']==1
    events=row['stream']['events']
    assert all(not e.get('links') for e in events)
    wire=''.join(e['delta'] for e in events if e['type']=='formatterDelta')
    assert json.loads(wire)==json.loads(row['rawAnswer'])
    if row['formatValid']:
        assert row['streamMatchesFinal']
    else:
        assert row['stream']['terminal']['type']=='rejectedFinal'
        assert not row['stream']['terminal']['text'] and not row['stream']['terminal']['links']
summary={'rigVersion':'0.41.0','method':'Four fresh fixed-evidence pairs, one answer per arm/case; manual review. Original complete answer reused, original Flex failure retained; seven unfinished answers completed on explicit user authorization. No native UI/retrieval or causal latency estimate.','variants':{}}
for arm in ['verbose','compact']:
    selected=[r for r in rows if r['variant']==arm]
    judgments=[review[r['caseId']+'/'+arm] for r in selected]
    summary['variants'][arm]={
        'completedAnswers':len(selected),'modelCalls':sum(r['modelCalls'] for r in selected),
        'usage':{k:sum(r['usage'][k] for r in selected) for k in selected[0]['usage']},
        'formatValidAnswers':sum(r['formatValid'] for r in selected),
        'manualFactAndScopePasses':sum(j['factAndScopePass'] for j in judgments),
        'manualCitationCoveragePasses':sum(j['citationCoveragePass'] for j in judgments),
        'manualPresentationPasses':sum(j['presentationPass'] for j in judgments),
        'medianLatencyMillis':statistics.median(r['latencyMillis'] for r in selected),
        'firstDraftMillis':[next(e['millis'] for e in r['stream']['events'] if e['type']=='draftText') for r in selected],
        'previewMatchesValidatedFinal':sum(bool(r.get('streamMatchesFinal')) for r in selected),
    }
v,c=[summary['variants'][a] for a in ['verbose','compact']]
summary['inputTokensSaved']=v['usage']['input_tokens']-c['usage']['input_tokens']
summary['inputTokensReductionPercent']=100*summary['inputTokensSaved']/v['usage']['input_tokens']
summary['totalReportedTokens']=sum(r['usage']['total_tokens'] for r in rows)
summary['totalTokensReductionPercent']=100*(1-c['usage']['total_tokens']/v['usage']['total_tokens'])
summary['failedAttemptUsage']=None
summary['verdict']='Do not promote compact formatting. Input reduced, but compact source-ID validation fails in two of four answers. Both formats fail excerpt-only scope; verbose also leaks formatting commentary. All eight emit decoded provisional drafts; six valid results match final text and two invalid results are rejected without links.'
(here/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
