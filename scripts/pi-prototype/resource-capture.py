#!/usr/bin/env python3
"""Read-only owned-process/storage capture and offline paired comparisons.

Never builds, launches, drives, signals, checkpoints, opens SQLite, or invokes a
provider. Process membership is supplied by the native owner; ps reads only
PID/PPID/RSS/start time for those explicit PIDs. No process args/env are read.
The original measurement-report.py remains authoritative for its journey metrics.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('measurement_report', Path(__file__).with_name('measurement-report.py'))
measurement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measurement)
SCHEMA = 'gneauxghts-pi-resource-v1'
SCENARIOS = ['startup', 'short', 'long', 'cancel', 'reopen', 'source', 'review',
             'save', 'research', 'attachments', 'transcript', 'retention',
             'watchers', 'conversation-list']
OPERATIONS = ['reopen', 'source', 'review', 'save']
COUNTERS = ['listeners', 'watchers', 'documents', 'documentFamilies',
            'retiredDocuments', 'collectedDocuments', 'retainedMessages',
            'retainedSubmissions', 'retainedConversations']
TRANSPORT = ['chunks', 'bytes', 'frames', 'frameBytes']
CONDITION_ENUMS = {'semanticMode': ['enabled', 'disabled', 'unknown'],
                   'windowState': ['foreground', 'background', 'unknown'],
                   'rendererObservation': ['two-animation-frames', 'polling', 'unknown']}
CONDITION_COUNTS = ['seededSubmissions', 'seededConversations', 'operationCount', 'outputBudget']
CONDITION_HASHES = ['modelSha256', 'configurationSha256', 'retentionOperationSha256']


def require(condition, message):
    measurement.require(condition, message)


def closed(value, allowed, name):
    require(type(value) is dict and not set(value) - set(allowed), f'Invalid {name} fields')


def count(value):
    return type(value) is int and value >= 0


def sha(value):
    return type(value) is str and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def nullable_count(value):
    return value is None or count(value)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf8'))


def parse_ps(raw, expected):
    """Pure parsing: never expose ps text, including unexpected output."""
    rows = {}
    for line in raw.splitlines():
        fields = line.split(None, 3)
        require(len(fields) == 4, 'Invalid numeric process snapshot')
        pid, parent, rss = fields[:3]
        require(all(item.isdigit() for item in [pid, parent, rss]), 'Invalid process counters')
        pid = int(pid)
        require(pid in expected and pid not in rows, 'Unexpected or duplicate process')
        # lstart has second resolution. It detects ordinary PID reuse, not an
        # adversarial same-second replacement; that precision is recorded.
        require(len(fields[3].split()) == 5, 'Missing process start identity')
        rows[pid] = {'pid': pid, 'ppid': int(parent), 'rssBytes': int(rss) * 1024,
                     'startSha256': measurement.digest(fields[3].encode())}
    return rows


def owned_processes(value):
    closed(value, ['schema', 'processes', 'processCoverage', 'rendererCoverage',
                   'membershipEvidenceSha256'], 'owned-process manifest')
    require(value.get('schema') == SCHEMA, 'Unsupported resource schema')
    for key in ['processCoverage', 'rendererCoverage']:
        require(value.get(key) in ['attested-complete', 'partial', 'unknown'], 'Invalid process coverage')
    evidence = value.get('membershipEvidenceSha256')
    require(evidence is None or sha(evidence), 'Invalid membership evidence hash')
    if 'attested-complete' in [value['processCoverage'], value['rendererCoverage']]:
        require(sha(evidence), 'Complete coverage requires independent membership evidence')
    rows = value.get('processes')
    require(type(rows) is list and len(rows) > 0, 'Explicit owned processes required')
    seen, apps = set(), 0
    for row in rows:
        closed(row, ['pid', 'role', 'startSha256'], 'owned process')
        require(count(row.get('pid')) and row['pid'] > 0 and row['pid'] not in seen, 'Invalid owned PID')
        require(row.get('role') in ['app', 'renderer', 'helper'], 'Invalid process role')
        require(sha(row.get('startSha256')), 'Pin process start identity before sampling')
        seen.add(row['pid'])
        apps += row['role'] == 'app'
    require(apps == 1, 'Exactly one owned app PID required')
    return value


def ps_snapshot(pids):
    completed = subprocess.run(['/bin/ps', '-p', ','.join(str(pid) for pid in sorted(pids)),
                                '-o', 'pid=,ppid=,rss=,lstart='],
                               capture_output=True, env={'LC_ALL': 'C'}, timeout=5)
    # ps may return 1 when all selected processes have exited. Missing processes
    # invalidate coverage; they never become successful zero-RSS observations.
    require(completed.returncode in [0, 1], 'Process snapshot failed')
    return parse_ps(completed.stdout.decode('ascii'), pids)


def pin(processes, process_coverage='unknown', renderer_coverage='unknown', evidence=None, snapshot=ps_snapshot):
    pids = [row['pid'] for row in processes]
    require(len(set(pids)) == len(pids) and all(type(pid) is int and pid > 0 for pid in pids), 'Invalid PID list')
    rows = snapshot(set(pids))
    require(set(rows) == set(pids), 'Cannot pin missing process')
    return owned_processes({'schema': SCHEMA, 'processCoverage': process_coverage,
        'rendererCoverage': renderer_coverage, 'membershipEvidenceSha256': evidence,
        'processes': [{**row, 'startSha256': rows[row['pid']]['startSha256']} for row in processes]})


def resource_sample(manifest, observed, at_ms):
    manifest = owned_processes(manifest)
    require(measurement.number(at_ms), 'Invalid sample clock')
    rows, missing, reused = [], 0, 0
    for expected in manifest['processes']:
        row = observed.get(expected['pid'])
        if row is None:
            missing += 1
        elif row['startSha256'] != expected['startSha256']:
            reused += 1
        else:
            rows.append({**row, 'role': expected['role']})
    valid = not missing and not reused
    all_complete = valid and manifest['processCoverage'] == manifest['rendererCoverage'] == 'attested-complete'
    return {'atMs': at_ms, 'processes': rows, 'missingProcesses': missing,
            'reusedPids': reused, 'observedRssBytes': sum(row['rssBytes'] for row in rows) if rows else None,
            'appRssBytes': next((row['rssBytes'] for row in rows if row['role'] == 'app'), None),
            'allProcessRssBytes': sum(row['rssBytes'] for row in rows) if all_complete else None}


def sample(manifest, interval_ms, duration_ms, snapshot=ps_snapshot, now=time.monotonic, sleep=time.sleep):
    owned_processes(manifest)
    require(measurement.number(interval_ms) and 10 <= interval_ms <= 60000, 'Invalid sampling cadence')
    require(measurement.number(duration_ms) and 0 <= duration_ms <= 3600000, 'Invalid capture duration')
    start = now()
    samples = []
    while True:
        observed = snapshot({row['pid'] for row in manifest['processes']})
        at_ms = (now() - start) * 1000
        samples.append(resource_sample(manifest, observed, at_ms))
        if at_ms >= duration_ms:
            break
        sleep(min(interval_ms, duration_ms - at_ms) / 1000)
    return {'schema': SCHEMA, 'kind': 'rss', 'intervalMs': interval_ms,
            'startIdentityPrecision': 'ps-lstart-one-second',
            'clock': 'collector-monotonic-independent-of-journey',
            'processCoverage': manifest['processCoverage'], 'rendererCoverage': manifest['rendererCoverage'],
            'membershipEvidenceSha256': manifest.get('membershipEvidenceSha256'), 'samples': samples}


def rss_metrics(value):
    closed(value, ['schema', 'kind', 'intervalMs', 'startIdentityPrecision', 'clock',
                   'processCoverage', 'rendererCoverage', 'membershipEvidenceSha256', 'samples'], 'RSS capture')
    require(value.get('schema') == SCHEMA and value.get('kind') == 'rss', 'Expected RSS capture')
    require(measurement.number(value.get('intervalMs')) and value['intervalMs'] > 0, 'Invalid capture cadence')
    for key in ['processCoverage', 'rendererCoverage']:
        require(value.get(key) in ['attested-complete', 'partial', 'unknown'], 'Invalid RSS coverage')
    evidence = value.get('membershipEvidenceSha256')
    require(evidence is None or sha(evidence), 'Invalid RSS membership evidence')
    manifest_complete = value['processCoverage'] == value['rendererCoverage'] == 'attested-complete' and sha(evidence)
    complete = bool(manifest_complete)
    require(type(value.get('samples')) is list, 'Invalid RSS samples')
    previous = -1
    values = {'sampledAppPeakRssBytes': [], 'sampledObservedProcessesPeakRssBytes': [], 'sampledAllProcessesPeakRssBytes': []}
    for row in value['samples']:
        closed(row, ['atMs', 'processes', 'missingProcesses', 'reusedPids', 'observedRssBytes',
                     'appRssBytes', 'allProcessRssBytes'], 'RSS sample')
        require(measurement.number(row.get('atMs')) and row['atMs'] >= previous, 'Invalid sample clock')
        previous = row['atMs']
        require(count(row.get('missingProcesses')) and count(row.get('reusedPids')), 'Invalid process loss counters')
        require(type(row.get('processes')) is list, 'Invalid sampled process list')
        seen, totals, apps = set(), [], []
        for process in row['processes']:
            closed(process, ['pid', 'ppid', 'rssBytes', 'startSha256', 'role'], 'sampled process')
            require(count(process.get('pid')) and process['pid'] > 0 and process['pid'] not in seen, 'Invalid sampled PID')
            require(count(process.get('ppid')) and count(process.get('rssBytes')) and sha(process.get('startSha256')), 'Invalid sampled identity/counter')
            require(process.get('role') in ['app', 'renderer', 'helper'], 'Invalid sampled role')
            seen.add(process['pid']); totals.append(process['rssBytes'])
            if process['role'] == 'app':
                apps.append(process['rssBytes'])
        require(len(apps) <= 1, 'Duplicate app process')
        observed = sum(totals) if totals else None
        require(row.get('observedRssBytes') == observed and row.get('appRssBytes') == (apps[0] if apps else None), 'RSS sum mismatch')
        require(nullable_count(row.get('allProcessRssBytes')), 'Invalid all-process RSS')
        valid = manifest_complete and not row['missingProcesses'] and not row['reusedPids'] and len(apps) == 1
        require(row.get('allProcessRssBytes') == (observed if valid else None), 'Incomplete RSS must remain unknown')
        complete = complete and bool(valid)
        for key, field in [('sampledAppPeakRssBytes', 'appRssBytes'),
                           ('sampledObservedProcessesPeakRssBytes', 'observedRssBytes'),
                           ('sampledAllProcessesPeakRssBytes', 'allProcessRssBytes')]:
            if row.get(field) is not None:
                values[key].append(row[field])
    result = {key: max(items) if items else None for key, items in values.items()}
    if not complete:
        result['sampledAllProcessesPeakRssBytes'] = None
    return result


def storage_snapshot(root, state):
    require(state in ['live', 'closed', 'checkpointed', 'unknown'], 'Invalid storage state')
    # Metadata only; measurement.storage refuses symlinks/special files and emits
    # aggregate categories, never file names or contents. No DB connection opens.
    return {'schema': SCHEMA, 'kind': 'storage', 'state': state, 'storage': measurement.storage(root)}


def storage_metrics(before, after):
    for value in [before, after]:
        closed(value, ['schema', 'kind', 'state', 'storage'], 'storage capture')
        require(value.get('schema') == SCHEMA and value.get('kind') == 'storage', 'Expected storage capture')
        require(value.get('state') in ['live', 'closed', 'checkpointed', 'unknown'], 'Invalid storage state')
        data = value.get('storage')
        closed(data, ['groups', 'logicalBytes', 'databaseRows', 'allocatedBytes', 'consistency'], 'storage counters')
        require(count(data.get('logicalBytes')), 'Invalid storage total')
        require(data.get('consistency') == 'non-atomic-file-size-snapshot', 'Invalid storage consistency')
        groups = data.get('groups')
        closed(groups, ['sqlite', 'wal', 'shm', 'markdown', 'other'], 'storage groups')
        require(len(groups) == 5, 'Missing storage group')
        for group in groups.values():
            closed(group, ['files', 'logicalBytes'], 'storage group')
            require(count(group.get('files')) and count(group.get('logicalBytes')), 'Invalid storage group count')
        require(sum(group['logicalBytes'] for group in groups.values()) == data['logicalBytes'], 'Storage sum mismatch')
    states_match = before['state'] == after['state'] and before['state'] in ['closed', 'checkpointed']
    result = {'observedLogicalStorageGrowthBytes': after['storage']['logicalBytes'] - before['storage']['logicalBytes'],
              'retainedLogicalStorageGrowthBytes': None}
    for kind in ['sqlite', 'wal', 'shm', 'markdown', 'other']:
        result[kind + 'LogicalGrowthBytes'] = after['storage']['groups'][kind]['logicalBytes'] - before['storage']['groups'][kind]['logicalBytes']
    if states_match:
        result['retainedLogicalStorageGrowthBytes'] = result['observedLogicalStorageGrowthBytes']
    return result


def observer_metrics(value):
    closed(value, ['schema', 'operations', 'transport', 'counters'], 'native observer')
    require(value.get('schema') == SCHEMA, 'Expected observer schema')
    result = {kind + 'Ms': None for kind in OPERATIONS}
    for kind in OPERATIONS:
        result[kind + 'ObservationUncertaintyMs'] = None
    operations = value.get('operations', {})
    closed(operations, OPERATIONS, 'operations')
    for kind, row in operations.items():
        closed(row, ['startMs', 'settledMs', 'observation', 'uncertaintyMs'], 'operation')
        start, end = row.get('startMs'), row.get('settledMs')
        require(start is None or measurement.number(start), 'Invalid operation start')
        require(end is None or measurement.number(end), 'Invalid operation settlement')
        require(row.get('observation') in ['two-animation-frames', 'polling', 'unknown'], 'Invalid operation observation')
        require(row.get('uncertaintyMs') is None or measurement.number(row['uncertaintyMs']), 'Invalid observation uncertainty')
        if start is not None and end is not None:
            require(end >= start, 'Operation settled before start')
            result[kind + 'Ms'] = end - start
            result[kind + 'ObservationUncertaintyMs'] = row.get('uncertaintyMs')
    transport = value.get('transport', {})
    closed(transport, ['coverage', 'before', 'after'], 'transport')
    require(transport.get('coverage', 'unknown') in ['complete', 'partial', 'unknown'], 'Invalid transport coverage')
    for key in ['before', 'after']:
        closed(transport.get(key, {}), TRANSPORT, 'transport counters')
        require(all(nullable_count(item) for item in transport.get(key, {}).values()), 'Invalid transport counter')
    for key in TRANSPORT:
        start, end = transport.get('before', {}).get(key), transport.get('after', {}).get(key)
        result['transport' + key[0].upper() + key[1:]] = None
        if start is not None and end is not None:
            require(end >= start, 'Transport counters reset during a journey')
            if transport.get('coverage') == 'complete':
                result['transport' + key[0].upper() + key[1:]] = end - start
    counters = value.get('counters', {})
    closed(counters, COUNTERS, 'retention/listener counters')
    for key in COUNTERS:
        row = counters.get(key, {})
        closed(row, ['before', 'after'], 'before/after counters')
        require(all(nullable_count(item) for item in row.values()), 'Invalid observer counter')
        start, end = row.get('before'), row.get('after')
        result[key + 'After'] = end
        result[key + 'Growth'] = end - start if start is not None and end is not None else None
    return result


def conditions(value):
    allowed = ['scenario', 'pairIndex', 'order', 'buildVerified', 'buildReceiptSha256',
               'samplingIntervalMs', *CONDITION_ENUMS, *CONDITION_COUNTS, *CONDITION_HASHES]
    closed(value, allowed, 'comparison conditions')
    require(value.get('scenario') in SCENARIOS, 'Invalid comparison scenario')
    require(count(value.get('pairIndex')) and value['pairIndex'] > 0, 'Invalid pair index')
    require(value.get('order') in [0, 1] and type(value['order']) is int, 'Invalid alternating order')
    require(type(value.get('buildVerified')) is bool, 'Explicit build verification required')
    require(value.get('buildReceiptSha256') is None or sha(value['buildReceiptSha256']), 'Invalid build receipt hash')
    for key, choices in CONDITION_ENUMS.items():
        require(value.get(key) in choices, f'Invalid {key}')
    for key in CONDITION_HASHES:
        require(value.get(key) is None or sha(value[key]), f'Invalid {key}')
    for key in CONDITION_COUNTS:
        require(nullable_count(value.get(key)), f'Invalid {key}')
    require(value.get('samplingIntervalMs') is None or (measurement.number(value['samplingIntervalMs']) and value['samplingIntervalMs'] > 0), 'Invalid sampling cadence')
    return value


def assemble(journey, condition, rss=None, before=None, after=None, observer=None):
    summary = measurement.summarize(journey)
    condition = conditions(condition)
    if observer:
        require(all(row.get('observation') == condition['rendererObservation'] for row in observer.get('operations', {}).values()),
                'Operation observation differs from comparison conditions')
    if rss is not None:
        require(rss.get('intervalMs') == condition.get('samplingIntervalMs'), 'Sampling cadence differs from conditions')
    metrics = dict(summary['metrics'])
    metrics.update(rss_metrics(rss) if rss is not None else {
        key: None for key in ['sampledAppPeakRssBytes', 'sampledObservedProcessesPeakRssBytes', 'sampledAllProcessesPeakRssBytes']})
    require((before is None) == (after is None), 'Both storage boundaries required')
    if before is not None:
        metrics.update(storage_metrics(before, after))
    metrics.update(observer_metrics(observer or {'schema': SCHEMA}))
    return {'schema': SCHEMA, 'kind': 'bundle', 'identity': summary['identity'],
            'conditions': condition, 'coverage': {**summary['coverage'],
                'process': rss.get('processCoverage', 'unknown') if rss else 'unknown',
                'renderer': rss.get('rendererCoverage', 'unknown') if rss else 'unknown',
                'storageBefore': before['state'] if before else 'unknown',
                'storageAfter': after['state'] if after else 'unknown',
                'transport': observer.get('transport', {}).get('coverage', 'unknown') if observer else 'unknown'},
            'metrics': metrics, 'unknownMetrics': [key for key, item in metrics.items() if item is None],
            'inputSha256': measurement.digest(measurement.encoded({'journey': journey, 'conditions': condition,
                'rss': rss, 'storageBefore': before, 'storageAfter': after, 'observer': observer}))}


def compare(old, pi):
    """Only pair equivalent complete identities; never make an adoption verdict."""
    reasons = []
    base = measurement.summarize({'schema': measurement.SCHEMA,
        **{key: choices[0] for key, choices in measurement.ENUMS.items()}, 'events': []})
    allowed_metrics = set(base['metrics']) | set(observer_metrics({'schema': SCHEMA})) | {
        'sampledAppPeakRssBytes', 'sampledObservedProcessesPeakRssBytes', 'sampledAllProcessesPeakRssBytes',
        'observedLogicalStorageGrowthBytes', 'retainedLogicalStorageGrowthBytes',
        *[kind + 'LogicalGrowthBytes' for kind in ['sqlite', 'wal', 'shm', 'markdown', 'other']]}
    for lane, value in [('old', old), ('pi', pi)]:
        closed(value, ['schema', 'kind', 'identity', 'conditions', 'coverage', 'metrics',
                       'unknownMetrics', 'inputSha256'], 'resource bundle')
        require(value.get('schema') == SCHEMA and value.get('kind') == 'bundle', 'Expected resource bundle')
        conditions(value.get('conditions'))
        closed(value.get('identity'), [*measurement.ENUMS, *measurement.HASH_KEYS], 'bundle identity')
        closed(value.get('coverage'), ['providerCoverage', 'ipcCoverage', 'process', 'renderer',
                                     'storageBefore', 'storageAfter', 'transport'], 'bundle coverage')
        closed(value.get('metrics'), allowed_metrics, 'bundle metrics')
        require(value.get('identity', {}).get('lane') == lane, 'Wrong comparison lane')
        require(type(value.get('metrics')) is dict and all(item is None or (type(item) in [int, float] and math.isfinite(item)) for item in value['metrics'].values()), 'Invalid bundle metrics')
        require(sha(value.get('inputSha256')), 'Missing bundle input seal')
        for key in ['revision', 'binarySha256', 'frontendSha256', 'lockfileSha256', 'fixtureSha256', 'environmentSha256']:
            item = value['identity'].get(key)
            if not item or not (sha(item) if key != 'revision' else type(item) is str and len(item) == 40 and all(c in '0123456789abcdef' for c in item)):
                reasons.append(lane + '.missing.' + key)
        if not value['conditions']['buildVerified'] or not sha(value['conditions'].get('buildReceiptSha256')):
            reasons.append(lane + '.unverified-build')
    for key in ['protocol', 'case', 'cache', 'provider', 'profile', 'fixtureSha256', 'environmentSha256', 'lockfileSha256']:
        left, right = old['identity'].get(key), pi['identity'].get(key)
        if left != right or left in [None, 'unknown']:
            reasons.append('identity.' + key)
    for key in ['scenario', 'pairIndex', 'samplingIntervalMs', *CONDITION_ENUMS, *CONDITION_COUNTS, *CONDITION_HASHES]:
        left, right = old['conditions'].get(key), pi['conditions'].get(key)
        # Retention operation matters only to a retention scenario. Other runs
        # may omit it rather than inventing a hash for a nonexistent operation.
        optional = key == 'retentionOperationSha256' and old['conditions']['scenario'] != 'retention'
        if left != right or (not optional and left in [None, 'unknown']):
            reasons.append('conditions.' + key)
    if old['conditions']['order'] == pi['conditions']['order']:
        reasons.append('conditions.order')
    metrics = {}
    for key in sorted(set(old['metrics']) | set(pi['metrics'])):
        left, right = old['metrics'].get(key), pi['metrics'].get(key)
        # Live file-size observations and incomplete-membership sums are useful
        # diagnostics, but not comparable retained/all-process measurements.
        blocked = (key.endswith('IpcObservedCalls') or key in ['sampledProcessPeakRssBytes',
            'sampledObservedProcessesPeakRssBytes', 'storageGrowthBytes', 'observedLogicalStorageGrowthBytes'])
        if key in ['retainedLogicalStorageGrowthBytes', *[kind + 'LogicalGrowthBytes' for kind in ['sqlite', 'wal', 'shm', 'markdown', 'other']]]:
            states = [value['coverage'].get(boundary) for value in [old, pi] for boundary in ['storageBefore', 'storageAfter']]
            blocked = blocked or len(set(states)) != 1 or states[0] not in ['closed', 'checkpointed']
        complete = not reasons and not blocked and left is not None and right is not None
        metrics[key] = {'old': left, 'pi': right, 'piMinusOld': right - left if complete else None}
    return {'schema': SCHEMA, 'kind': 'paired-comparison', 'pairIndex': old['conditions']['pairIndex'],
            'scenario': old['conditions']['scenario'], 'comparable': not reasons,
            'incomparableReasons': reasons, 'metrics': metrics,
            'inputSha256': measurement.digest(measurement.encoded([old, pi])),
            'verdict': 'unproven-pending-acceptance'}


def compare_runs(old_runs, pi_runs):
    require(len(old_runs) == len(pi_runs) and len(old_runs) > 0, 'Paired observations required')
    def indexed(runs):
        result = {}
        for value in runs:
            key = (value['conditions']['scenario'], value['conditions']['pairIndex'])
            require(key not in result, 'Duplicate comparison pair')
            result[key] = value
        return result
    old, pi = indexed(old_runs), indexed(pi_runs)
    require(old.keys() == pi.keys(), 'Missing paired scenario')
    pairs = [compare(old[key], pi[key]) for key in sorted(old)]
    aggregate = {}
    for scenario in sorted({pair['scenario'] for pair in pairs}):
        rows = [pair for pair in pairs if pair['scenario'] == scenario]
        for lane in [old, pi]:
            captures = [lane[(scenario, row['pairIndex'])] for row in rows]
            signatures = {measurement.digest(measurement.encoded({
                'identity': capture['identity'],
                'conditions': {key: item for key, item in capture['conditions'].items() if key not in ['pairIndex', 'order']}})) for capture in captures}
            require(len(signatures) == 1, 'Mixed comparison series conditions or builds')
        metrics = {}
        for key in sorted({key for row in rows for key in row['metrics']}):
            valid = [row['metrics'][key] for row in rows if row['metrics'].get(key, {}).get('piMinusOld') is not None]
            def distribution(field):
                values = [row[field] for row in valid]
                return {'median': statistics.median(values), 'min': min(values), 'max': max(values)} if values else None
            metrics[key] = {'knownPairs': len(valid), 'totalPairs': len(rows),
                            'old': distribution('old'), 'pi': distribution('pi'),
                            'pairedDifference': distribution('piMinusOld')}
        aggregate[scenario] = {'pairCount': len(rows), 'atLeastThreePairs': len(rows) >= 3,
                              'alternatingOrder': len({old[(scenario, row['pairIndex'])]['conditions']['order'] for row in rows}) > 1,
                              'metrics': metrics}
    return {'schema': SCHEMA, 'kind': 'comparison-series', 'pairs': pairs, 'aggregate': aggregate,
            'verdict': 'unproven-pending-acceptance'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    identity = commands.add_parser('pin', help='Read start identities for explicit already-owned PIDs')
    identity.add_argument('--app-pid', type=int, required=True)
    identity.add_argument('--renderer-pid', type=int, action='append', default=[])
    identity.add_argument('--helper-pid', type=int, action='append', default=[])
    for key in ['process', 'renderer']:
        identity.add_argument('--' + key + '-coverage', choices=['attested-complete', 'partial', 'unknown'], default='unknown')
    identity.add_argument('--membership-evidence-sha256')
    capture = commands.add_parser('sample', help='Sample only explicit manifest PIDs; no discovery')
    capture.add_argument('--owned-pids', type=Path, required=True)
    capture.add_argument('--interval-ms', type=float, default=100)
    capture.add_argument('--duration-ms', type=float, required=True)
    storage = commands.add_parser('storage', help='Read metadata only; do not open SQLite/checkpoint')
    storage.add_argument('--root', type=Path, required=True)
    storage.add_argument('--state', choices=['live', 'closed', 'checkpointed', 'unknown'], required=True)
    bundle = commands.add_parser('assemble', help='Validate closed native-counter inputs and combine offline')
    bundle.add_argument('--journey', type=Path, required=True)
    bundle.add_argument('--conditions', type=Path, required=True)
    for name in ['rss', 'storage-before', 'storage-after', 'observer']:
        bundle.add_argument('--' + name, type=Path)
    comparison = commands.add_parser('compare', help='Pair by scenario/index; preserve unknown coverage')
    comparison.add_argument('--old', type=Path, nargs='+', required=True)
    comparison.add_argument('--pi', type=Path, nargs='+', required=True)
    for command in [identity, capture, storage, bundle, comparison]:
        command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'pin':
        processes = [{'pid': args.app_pid, 'role': 'app'},
            *[{'pid': pid, 'role': 'renderer'} for pid in args.renderer_pid],
            *[{'pid': pid, 'role': 'helper'} for pid in args.helper_pid]]
        result = pin(processes, args.process_coverage, args.renderer_coverage, args.membership_evidence_sha256)
    elif args.action == 'sample':
        result = sample(read(args.owned_pids), args.interval_ms, args.duration_ms)
    elif args.action == 'storage':
        result = storage_snapshot(args.root, args.state)
    elif args.action == 'assemble':
        result = assemble(read(args.journey), read(args.conditions),
                          *[read(getattr(args, key)) if getattr(args, key) else None for key in ['rss', 'storage_before', 'storage_after', 'observer']])
    else:
        result = compare_runs([read(path) for path in args.old], [read(path) for path in args.pi])
    measurement.write_new(args.output, result)
    print(json.dumps({'schema': SCHEMA, 'written': True}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        # Never echo paths, native output, user data or private input values.
        print('Resource capture refused (invalid or unavailable evidence)', file=sys.stderr)
        raise SystemExit(1)
