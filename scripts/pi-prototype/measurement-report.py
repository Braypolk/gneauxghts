#!/usr/bin/env python3
"""Generated comparison fixtures, read-only counters and offline timing analysis.

Never builds, launches, drives, terminates or requests inference from an app.
Reports accept a closed counter-only schema; no prose, SQL or identifiers.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys

SCHEMA = 'gneauxghts-pi-measurement-v1'
FIXTURE = 'gneauxghts-pi-measurement-fixture-v1'
HASH_KEYS = ['revision', 'trackedDiffSha256', 'binarySha256', 'frontendSha256',
             'lockfileSha256', 'fixtureSha256', 'environmentSha256']
ENUMS = {'lane': ['old', 'pi'], 'protocol': ['compatible', 'responses', 'unknown'],
         'case': ['startup', 'short', 'long', 'cancel'],
         'cache': ['cold-process', 'warm-process', 'unknown'],
         'provider': ['fixture', 'live-warm', 'live-cold', 'unknown'],
         'profile': ['debug', 'release', 'unknown']}
EVENTS = {
    'launch': [], 'workspace_visible': [], 'send': [], 'first_visible': [],
    'terminal': [], 'cancel_request': [], 'cancel_settled': [],
    'provider_start': ['dispatch'], 'provider_end': ['dispatch'],
    'ipc': ['category', 'requestBytes', 'responseBytes'],
    'rss': ['bytes'], 'storage': ['bytes'], 'listeners': ['count'],
    'documents': ['count'], 'document_families': ['count'],
    'retired_documents': ['count'], 'collected_documents': ['count'],
    'retained_messages': ['count'],
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def hash_file(path):
    # Stream binaries rather than duplicate large artifacts in this process RSS.
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def write_new(path, value):
    with Path(path).open('x', encoding='utf8') as stream:
        stream.write(json.dumps(value, indent=2, sort_keys=True) + '\n')


def fixtures(root):
    root = Path(root).absolute()
    require(not root.exists(), 'Fixture root must be fresh; existing data is never reset')
    require(all(not path.is_symlink() for path in [root, *root.parents]),
            'Fixture root must not traverse a symlink')
    # No canonical identities or synthetic timeline database are invented here.
    # The native harness must seed these authored bytes through normal note APIs.
    notes = [f'# Synthetic comparison {i:02d}\n\nGenerated comparison evidence item {i:02d}.\n'
             for i in range(8)]
    turns = [{'user': f'Synthetic turn {i:04d}. Reply briefly without tools.',
              'assistant': f'Synthetic reply {i:04d}.'} for i in range(1005)]
    payload = {'kind': FIXTURE, 'notes': notes, 'shortHistory': turns[:2],
               'longHistory': turns, 'expectedLongMessages': 2010,
               'expectedLongSubmissions': 1005,
               'prompt': 'Reply briefly without tools.', 'cancelPrompt': 'SLOW_CANCEL'}
    seal = digest(encoded(payload))
    root.mkdir(parents=True, mode=0o700)
    for lane in ['old', 'pi']:
        folder = root / lane
        folder.mkdir(mode=0o700)
        (folder / 'data').mkdir(mode=0o700)
        write_new(folder / 'fixture.json', payload)
    manifest = {'kind': FIXTURE, 'fixtureSha256': seal, 'lanes': ['old', 'pi'],
                'notes': len(notes), 'longMessages': 2010, 'longSubmissions': 1005,
                'seededNativeHistory': False}
    write_new(root / 'manifest.json', manifest)
    return manifest


def safe_tree(root):
    root = Path(root).absolute()
    require(root.is_dir(), 'Counter root must exist')
    require(all(not path.is_symlink() for path in [root, *root.parents]),
            'Counter root must not traverse a symlink')
    for base, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(base) / name
            require(not path.is_symlink(), 'Counter tree must not contain symlinks')
            require(path.is_file() or path.is_dir(), 'Counter tree contains a special file')
            if path.is_file():
                yield path


def storage(root):
    groups = {kind: {'files': 0, 'logicalBytes': 0} for kind in
              ['sqlite', 'wal', 'shm', 'markdown', 'other']}
    for path in safe_tree(root):
        name = path.name.lower()
        kind = ('wal' if name.endswith('-wal') else 'shm' if name.endswith('-shm')
                else 'sqlite' if name.endswith(('.sqlite', '.sqlite3', '.db'))
                else 'markdown' if name.endswith('.md') else 'other')
        groups[kind]['files'] += 1
        groups[kind]['logicalBytes'] += path.stat().st_size
    return {'groups': groups, 'logicalBytes': sum(row['logicalBytes'] for row in groups.values()),
            'databaseRows': None, 'allocatedBytes': None,
            'consistency': 'non-atomic-file-size-snapshot'}


def command(argv):
    result = subprocess.run(argv, capture_output=True, check=True)
    return result.stdout


def provenance(binary, frontend=None):
    # No environment variables, user paths, git diffs or status lines are emitted.
    repo = Path(__file__).resolve().parents[2]
    git = lambda *args: command(['git', '-C', str(repo), *args])
    environment = {'system': platform.system(), 'release': platform.release(),
                   'machine': platform.machine(), 'python': platform.python_version()}
    for name, argv in [('macOS', ['sw_vers', '-productVersion']),
                       ('node', ['node', '--version'])]:
        try:
            environment[name] = command(argv).decode().strip()
        except (OSError, subprocess.CalledProcessError):
            environment[name] = None
    untracked = git('ls-files', '--others', '--exclude-standard', '-z')
    result = {'revision': git('rev-parse', 'HEAD').decode().strip(),
              'trackedDiffSha256': digest(git('diff', 'HEAD', '--binary')),
              'untrackedInventorySha256': digest(untracked),
              'untrackedFileCount': len([name for name in untracked.split(b'\0') if name]),
              'binarySha256': hash_file(binary),
              'lockfileSha256': hash_file(repo / 'pnpm-lock.yaml'),
              'environment': environment, 'environmentSha256': digest(encoded(environment)),
              'buildRevisionVerified': False,
              'helperSha256': hash_file(__file__), 'frontendSha256': None}
    if frontend:
        # Aggregate relative names and contents without retaining either in output.
        folder = Path(frontend).absolute()
        tree = hashlib.sha256()
        for path in sorted(safe_tree(folder)):
            tree.update(encoded([str(path.relative_to(folder)), hash_file(path)]))
        result['frontendSha256'] = tree.hexdigest()
    return result


def number(value):
    return type(value) in [int, float] and math.isfinite(value) and value >= 0


def validate(value):
    require(type(value) is dict, 'Measurement must be an object')
    allowed = set(ENUMS) | set(HASH_KEYS) | {'schema', 'events', 'providerCoverage', 'ipcCoverage'}
    require(not set(value) - allowed, 'Unrecognized measurement fields (prose is not accepted)')
    require(value.get('schema') == SCHEMA, 'Unsupported measurement schema')
    for key, choices in ENUMS.items():
        require(value.get(key) in choices, f'Invalid {key}')
    for key in HASH_KEYS:
        item = value.get(key)
        require(item is None or (type(item) is str and len(item) in ([40] if key == 'revision' else [64])
                and all(c in '0123456789abcdef' for c in item)), f'Invalid {key}')
    for key in ['providerCoverage', 'ipcCoverage']:
        require(value.get(key, 'unknown') in ['complete', 'partial', 'unknown'], f'Invalid {key}')
    require(type(value.get('events')) is list, 'Events must be an array')
    previous = -1
    singletons = set()
    dispatches = {'provider_start': set(), 'provider_end': set()}
    for row in value['events']:
        require(type(row) is dict and row.get('kind') in EVENTS, 'Unsupported event')
        kind = row['kind']
        require(set(row) <= {'kind', 'atMs'} | set(EVENTS[kind]), 'Unrecognized event fields')
        require(number(row.get('atMs')) and row['atMs'] >= previous,
                'Events must share one monotonic clock in chronological order')
        previous = row['atMs']
        if kind in ['launch', 'workspace_visible', 'send', 'first_visible', 'terminal',
                    'cancel_request', 'cancel_settled']:
            require(kind not in singletons, 'One journey per measurement; duplicate boundary')
            singletons.add(kind)
        for key in EVENTS[kind]:
            if key == 'category':
                require(row.get(key) in ['sqlite', 'provider', 'domain', 'other'], 'Invalid IPC category')
            elif key in ['requestBytes', 'responseBytes']:
                require(row.get(key) is None or (type(row[key]) is int and row[key] >= 0), 'Invalid byte count')
            else:
                require(type(row.get(key)) is int and row[key] >= 0, 'Invalid event counter')
        if kind in dispatches:
            require(row['dispatch'] not in dispatches[kind], 'Duplicate provider boundary')
            dispatches[kind].add(row['dispatch'])
    return value


def union(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return sum(end - start for start, end in merged)


def summarize(value):
    value = validate(value)
    events = value['events']
    boundary = {row['kind']: row['atMs'] for row in events if row['kind'] in
                ['launch', 'workspace_visible', 'send', 'first_visible', 'terminal',
                 'cancel_request', 'cancel_settled']}
    def span(start, end):
        if start not in boundary or end not in boundary:
            return None
        require(boundary[end] >= boundary[start], 'Reversed journey boundaries')
        return boundary[end] - boundary[start]
    metrics = {'startupMs': span('launch', 'workspace_visible'),
               'firstVisibleMs': span('send', 'first_visible'),
               'completionMs': span('send', 'terminal'),
               'cancellationMs': span('cancel_request', 'cancel_settled'),
               'providerTransportMs': None, 'outsideProviderMs': None,
               'postProviderCompletionMs': None,
               'sampledProcessPeakRssBytes': None, 'storageGrowthBytes': None}
    starts = {row['dispatch']: row['atMs'] for row in events if row['kind'] == 'provider_start'}
    ends = {row['dispatch']: row['atMs'] for row in events if row['kind'] == 'provider_end'}
    require(all(ends[key] >= starts[key] for key in starts.keys() & ends.keys()),
            'Provider ended before it started')
    if (value.get('providerCoverage') == 'complete' and starts.keys() == ends.keys()
            and metrics['completionMs'] is not None):
        start, end = boundary['send'], boundary['terminal']
        require(all(start <= starts[key] <= ends[key] <= end for key in starts),
                'Complete provider capture must lie inside the send/terminal interval')
        metrics['providerTransportMs'] = union([(starts[key], ends[key]) for key in starts])
        metrics['outsideProviderMs'] = metrics['completionMs'] - metrics['providerTransportMs']
        if ends:
            metrics['postProviderCompletionMs'] = end - max(ends.values())
    rss = [row['bytes'] for row in events if row['kind'] == 'rss']
    if rss:
        metrics['sampledProcessPeakRssBytes'] = max(rss)
    snapshots = [row['bytes'] for row in events if row['kind'] == 'storage']
    if len(snapshots) >= 2:
        metrics['storageGrowthBytes'] = snapshots[-1] - snapshots[0]
    for kind in ['listeners', 'documents', 'document_families', 'retired_documents',
                 'collected_documents', 'retained_messages']:
        observed = [row['count'] for row in events if row['kind'] == kind]
        metrics[kind] = observed[-1] if observed else None
    ipc = [row for row in events if row['kind'] == 'ipc']
    for category in ['all', 'sqlite', 'provider', 'domain', 'other']:
        rows = [row for row in ipc if category == 'all' or row['category'] == category]
        complete = value.get('ipcCoverage') == 'complete'
        metrics[f'{category}IpcCalls'] = len(rows) if complete else None
        metrics[f'{category}IpcObservedCalls'] = len(rows) if ipc else None
        for field in ['requestBytes', 'responseBytes']:
            metrics[f'{category}Ipc{field[0].upper() + field[1:]}'] = (
                sum(row[field] for row in rows) if complete and all(row.get(field) is not None for row in rows) else None)
    return {'schema': SCHEMA, 'identity': {key: value.get(key) for key in [*ENUMS, *HASH_KEYS]},
            'coverage': {key: value.get(key, 'unknown') for key in ['providerCoverage', 'ipcCoverage']},
            'metrics': metrics, 'unknownMetrics': [key for key, item in metrics.items() if item is None],
            'inputSha256': digest(encoded(value))}


def template(args):
    manifest = json.loads((args.fixture_root / 'manifest.json').read_text())
    require(manifest.get('kind') == FIXTURE, 'Expected a generated comparison fixture')
    payloads = [json.loads((args.fixture_root / lane / 'fixture.json').read_text())
                for lane in ['old', 'pi']]
    require(all(digest(encoded(value)) == manifest.get('fixtureSha256') for value in payloads),
            'Generated fixtures differ from their seal')
    captured = json.loads(args.snapshot.read_text())
    require(captured.get('schema') == SCHEMA, 'Expected a measurement snapshot')
    identity = captured['provenance']
    result = {'schema': SCHEMA, **{key: identity.get(key) for key in HASH_KEYS},
              **{key: getattr(args, key) for key in ENUMS},
              'fixtureSha256': manifest['fixtureSha256'],
              'events': [], 'providerCoverage': 'unknown', 'ipcCoverage': 'unknown'}
    return validate(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    fixture = commands.add_parser('fixtures')
    fixture.add_argument('--root', type=Path, required=True)
    capture = commands.add_parser('snapshot')
    capture.add_argument('--binary', type=Path, required=True)
    capture.add_argument('--frontend', type=Path)
    capture.add_argument('--data-root', type=Path, required=True)
    capture.add_argument('--output', type=Path, required=True)
    blank = commands.add_parser('template')
    blank.add_argument('--fixture-root', type=Path, required=True)
    blank.add_argument('--snapshot', type=Path, required=True)
    blank.add_argument('--output', type=Path, required=True)
    for key, choices in ENUMS.items():
        blank.add_argument('--' + key, choices=choices, required=True)
    report = commands.add_parser('summarize')
    report.add_argument('--input', type=Path, required=True)
    report.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'fixtures':
        print(json.dumps(fixtures(args.root), sort_keys=True))
    else:
        if args.action == 'snapshot':
            result = {'schema': SCHEMA, 'capturedAtUtc': datetime.now(timezone.utc).isoformat(),
                      'provenance': provenance(args.binary, args.frontend),
                      'storage': storage(args.data_root), 'processRssBytes': None,
                      'listeners': None, 'documents': None, 'documentFamilies': None}
        elif args.action == 'template':
            result = template(args)
        else:
            result = summarize(json.loads(args.input.read_text()))
        write_new(args.output, result)
        print(json.dumps({'schema': SCHEMA, 'written': True}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # Do not echo OS exception paths or private input values.
        print(f'Measurement refused ({type(error).__name__})', file=sys.stderr)
        raise SystemExit(1)
