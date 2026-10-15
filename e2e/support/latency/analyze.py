"""Summarize native IPC and local transport timings without replaying inference."""
import argparse
import json
import math
from pathlib import Path
import statistics


def merged_duration(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(end - start for start, end in merged)


def summarize(native, transport):
    calls = [row for row in transport if row['phase'] == 'finished' and row['path'].endswith('/chat/completions')]
    summaries = []
    for result in native.get('results', []):
        start = result['startedAtMillis']
        observed = result.get('terminalObservedMillis', result.get('elapsedMillis'))
        if observed is None:
            continue
        end = start + observed
        selected = [row for row in calls if start <= row['startedAtMillis'] < end]
        intervals = [(max(start, row['startedAtMillis']), min(end, row['finishedAtMillis'])) for row in selected]
        model_wall = merged_duration(intervals)
        polls = sorted(row['elapsedMillis'] for row in result['polls'])
        answer = result.get('answer') or {}
        tools = [envelope['event'] for envelope in answer.get('agentEvents', [])
                 if envelope['event']['type'] == 'toolCallUpdated' and envelope['event'].get('durationMillis') is not None]
        summaries.append({
            'case': result['id'], 'status': answer.get('status'), 'terminalObservedMillis': observed,
            'providerTransportMillis': model_wall,
            'providerSharePercent': round(100 * model_wall / observed, 2),
            'outsideProviderMillis': observed - model_wall,
            'completionRequests': len(selected),
            'inputTokens': sum(row.get('usage', {}).get('prompt_tokens', 0) for row in selected),
            'outputTokens': sum(row.get('usage', {}).get('completion_tokens', 0) for row in selected),
            'reasoningTokens': sum(row.get('usage', {}).get('completion_tokens_details', {}).get('reasoning_tokens', 0) for row in selected),
            'polls': len(polls), 'pollMedianMillis': statistics.median(polls) if polls else None,
            'pollP95Millis': polls[max(0, math.ceil(len(polls) * .95) - 1)] if polls else None,
            'pollMaxMillis': max(polls, default=None),
            'completedConversationReadMillis': result.get('completedConversationReadMillis'),
            'citationResolutionMillis': result.get('citationResolutionMillis'),
            'tools': [{'name': tool['name'], 'status': tool['status'], 'durationMillis': tool['durationMillis']} for tool in tools],
            'requests': selected,
        })
    return {'method': 'Provider/transport wall time is the union of completion HTTP intervals within send-to-terminal observation. It includes inference, queueing and network. Polling overlaps inference and is not added to that partition. Tool durations may overlap/nest; research includes worker inference. No private reasoning text is saved.',
            'model': native.get('model'), 'cases': summaries}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--transport', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    summary = summarize(json.loads(args.native.read_text()), [json.loads(line) for line in args.transport.read_text().splitlines()])
    args.output.write_text(json.dumps(summary, indent=2) + '\n')
    for case in summary['cases']:
        print({key: value for key, value in case.items() if key not in ['requests', 'tools']})
        print('tools:', case['tools'])
