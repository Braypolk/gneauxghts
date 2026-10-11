"""Summarize a synthetic trace offline. Never makes provider requests."""
import hashlib
import collections
import json
import statistics
import sys
from pathlib import Path

source = Path(sys.argv[1])
report = json.loads(source.read_text())
manual = {}
if len(sys.argv) > 3:
    review = json.loads(Path(sys.argv[3]).read_text())
    assert review['traceSha256'] == hashlib.sha256(source.read_bytes()).hexdigest(), 'Manual review belongs to another trace'
    manual = {(r['name'], r['variant'], r['repeat']): r for r in review['results']}
rates = report['costRates']['usdPerMillion']
fields = ['inputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens']


def cost(usage):
    if not usage or not (usage.get('inputTokens') or usage.get('outputTokens')):
        return None
    cached = usage.get('cachedInputTokens', 0)
    written = usage.get('cacheCreationInputTokens', 0)
    assert cached + written <= usage['inputTokens']
    return ((usage['inputTokens'] - cached - written) * rates['input'] + cached * rates['cachedInput'] + written * rates['cacheWrite'] + usage['outputTokens'] * rates['output']) / 1_000_000


def envelope(event):
    if event['type'] != 'toolresult':
        return None
    part = event['content'][0]
    if 'value' in part:
        return part['value'] if isinstance(part['value'], dict) else None
    try:
        return json.loads(part['text'])
    except (KeyError, ValueError):
        return None


runs = []
for case in report['cases']:
    calls = case['perCallUsage']
    per_call = [{'index': e['index'], 'usage': e['usage'], 'estimatedUsd': cost(e['usage'])} for e in calls]
    sums = {field: sum(e['usage'].get(field, 0) for e in calls) for field in fields}
    usage = case['usage'] or sums
    if case['usage']:
        assert all(sums[field] == case['usage'].get(field, 0) for field in fields), 'Per-call usage does not reconcile'
    chosen = [e for e in case['toolLifecycle'] if e['type'] == 'toolcall']
    signatures = [e['name'] + ':' + json.dumps(json.loads(e['arguments']), sort_keys=True) for e in chosen]
    fully_repeated = []
    for event in case['toolLifecycle']:
        result = envelope(event)
        if result and event['name'] == 'read_notes':
            bodies = [i for i in result.get('items', []) if i.get('location') == 'body']
            if bodies and all(i.get('alreadyRead') == 'full' for i in bodies):
                fully_repeated.append(event['id'])
    requests = case['requests']
    runs.append({
        'name': case['name'], 'variant': case['variant'], 'repeat': case['repeat'],
        'checks': case['checks'], 'manualReview': manual.get((case['name'], case['variant'], case['repeat'])), 'runtimeError': case['runtimeError'], 'usage': usage,
        'estimatedUsd': cost(usage), 'perCall': per_call, 'stats': case['stats'],
        'admittedProviderCalls': len(requests), 'reportedUsageCalls': len(calls),
        'toolSequence': [e['name'] for e in chosen],
        'exactRepeatedCalls': sum(n-1 for n in collections.Counter(signatures).values()),
        'readsWhoseBodyTextWasAlreadyFullyDelivered': fully_repeated,
        'requestInputBytes': [r['measurement']['inputBytes'] for r in requests],
        'requestComponentBytes': [r['measurement']['componentBytes'] for r in requests],
    })

aggregates = []
for name in [*dict.fromkeys(r['name'] for r in runs), 'all']:
    for variant in dict.fromkeys(r['variant'] for r in runs):
        rows = [r for r in runs if r['variant'] == variant and (name == 'all' or r['name'] == name)]
        if not rows:
            continue
        costs = [r['estimatedUsd'] for r in rows if r['estimatedUsd'] is not None]
        aggregates.append({
            'name': name, 'variant': variant, 'runs': len(rows),
            'smokePassed': sum(r['checks']['passed'] for r in rows),
            'manualPassed': sum(r['manualReview']['passed'] for r in rows) if all(r['manualReview'] for r in rows) else None,
            'usage': {f: sum(r['usage'].get(f, 0) for r in rows) for f in fields},
            'estimatedUsd': sum(costs) if len(costs) == len(rows) else None,
            'costPerRun': {'min': min(costs), 'median': statistics.median(costs), 'max': max(costs)} if costs else None,
            'modelCallAttempts': [r['stats']['modelCalls'] for r in rows],
            'admittedProviderCalls': [r['admittedProviderCalls'] for r in rows],
            'toolCalls': [r['stats']['toolCalls'] for r in rows],
            'exactRepeatedCalls': sum(r['exactRepeatedCalls'] for r in rows),
            'readsWhoseBodyTextWasAlreadyFullyDelivered': sum(len(r['readsWhoseBodyTextWasAlreadyFullyDelivered']) for r in rows),
        })

summary = {
    'basis': report['method'] + ' Small synthetic sample; not a significance test, invoice, or proof of causality. Manual answer entailment review required.',
    'source': source.name, 'model': report['model'], 'costRates': report['costRates'],
    'costLimitation': 'Rig reports no OpenAI cache-write category (maps it to zero); reported-cost estimate excludes any unexposed cache-write charge. All-zero usage is unknown. Output already includes reasoning; do not add reasoning tokens again.',
    'reuseLimitation': 'Repeated body overlap is a diagnostic, not proof the read was unnecessary; provenance/coverage may differ. Exact repeated calls include only identical arguments.',
    'runs': runs, 'aggregates': aggregates,
}
Path(sys.argv[2]).write_text(json.dumps(summary, indent=2) + '\n')
for row in aggregates:
    print(row['name'], row['variant'], f"{row['smokePassed']}/{row['runs']}", row['usage'], row['estimatedUsd'], 'tools=', row['toolCalls'])
