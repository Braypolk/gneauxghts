"""Reproduce paired accounting and package the self-contained demo. No inference."""
import hashlib
import json
from pathlib import Path
import statistics

here = Path(__file__).resolve().parent
runtime = json.loads((here/'runtime.json').read_text())
review = json.loads((here/'review.json').read_text())
rows = runtime['results']
assert len(rows) == 12 and all(row['status'] == 'complete' for row in rows)
reviews = {}
for case in runtime['corpusSnapshot']['cases']:
    pair = [row for row in rows if row['caseId'] == case['id']]
    assert len(pair) == 2 and pair[0]['input'] == pair[1]['input']
    assert pair[0]['citationSources'] == pair[1]['citationSources']
    reviews[case['id']] = {'summary': review['cases'][case['id']]['summary']}
    for row in pair:
        judgment = review['cases'][case['id']][row['variant']]
        assert judgment['rawAnswerSha256'] == hashlib.sha256(row['rawAnswer'].encode()).hexdigest()
        for observation in judgment['observations']:
            assert observation['quote'] in row['rawAnswer'] or observation['quote'] in row.get('answer', '')
        if row['variant'] == 'structured':
            assert row['formatValid'] and json.loads(row['rawAnswer'])['segments']
            admitted = {item['id'] for item in row['input']['evidence']['items'] if item['citation']}
            assert all(set(segment['passageIds']) <= admitted for segment in row['associations'])
provenance = json.loads((here/'run-provenance.json').read_text())
assert provenance['hostBeforeSha256'] == provenance['hostRestoredSha256']
root = here.parents[2]
assert provenance['hostBeforeSha256'] == hashlib.sha256((root/'src-tauri/src/chat/citation_evaluation.rs').read_bytes()).hexdigest()
for name in ['runtime.rs', 'fixtures.json', 'settings.json', 'baseline-preamble.txt']:
    assert provenance[name] == hashlib.sha256((here/name).read_bytes()).hexdigest()
assert provenance['run.py'] == hashlib.sha256((here/'run-at-execution.py').read_bytes()).hexdigest()
summary = {}
for arm in ['markdown', 'structured']:
    selected = [row for row in rows if row['variant'] == arm]
    summary[arm] = {
        'answers': len(selected), 'modelCalls': sum(row['modelCalls'] for row in selected),
        'usage': {key: sum(row['usage'][key] for row in selected) for key in selected[0]['usage']},
        'medianLatencyMillis': statistics.median(row['latencyMillis'] for row in selected),
        'textDeltaAnswers': sum(any(e['type']=='textDelta' for e in row['events']) for row in selected),
        'manualCitationCoveragePasses': sum(review['cases'][row['caseId']][arm]['citationCoveragePass'] for row in selected),
        'manualFactAndScopePasses': sum(review['cases'][row['caseId']][arm]['factAndScopePass'] for row in selected),
        'preambleBytes': len(selected[0]['preamble'].encode()),
    }
summary['totalReportedTokens'] = sum(row['usage']['total_tokens'] for row in rows)
summary['totalTokenIncreasePercent'] = (summary['structured']['usage']['total_tokens']/summary['markdown']['usage']['total_tokens']-1)*100
summary['method'] = 'Six reused fixed-evidence cases, one sample per arm; manual answer-level review, not automated entailment or native/E2E evaluation.'
(here/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
verdict = 'Six paired cases · gpt-6-luna / medium / Flex · one model call per answer. Structured: 6/6 source-coverage reviews pass; Markdown: 5/6. Structured uses 15.3% more reported tokens and emits no answer-text deltas through the existing formatter. Small exploratory sample; not a production reliability estimate.'
data = json.dumps({'runtime':runtime,'reviews':reviews,'verdict':verdict},ensure_ascii=False).replace('</','<\\/')
template = (here/'demo.template.html').read_text()
assert template.count('/*DATA*/') == 1
(here/'demo.html').write_text(template.replace('/*DATA*/',data))
print(json.dumps(summary,indent=2))
