#!/usr/bin/env python3
"""Test-only immutable scale fixture + disposable, path-relocated runs."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile

KIND = 'gneauxghts-production-scale-v1'
DB = Path('.gneauxghts/history.sqlite3')
DEFAULT = Path(tempfile.gettempdir()) / 'gneauxghts-timeline-fixture'


def digest_files(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Fixture must not contain symlinks')
        if path.is_file() and path != root / 'fixture.json':
            result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def require_valid(condition):
    if not condition:
        raise ValueError('Fixture integrity, identity, or revision counts do not match')


def validate(vault, data):
    with closing(sqlite3.connect((vault / DB).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        require_valid(db.execute('PRAGMA quick_check').fetchall() == [('ok',)])
        require_valid(not db.execute('PRAGMA foreign_key_check').fetchall())
        require_valid(db.execute('SELECT count(*) FROM revisions').fetchone()[0] == 100_000)
        require_valid(db.execute("SELECT count(*) FROM revisions WHERE note_id='release-seed-0'").fetchone()[0] == 10_000)
        require_valid(db.execute('SELECT count(*) FROM timeline_heads').fetchone()[0] == 1_000)
        require_valid(db.execute("SELECT count(*) FROM prepared_intents WHERE status='prepared'").fetchone()[0] == 0)
        for table in ['pending_observations', 'pending_deletions', 'deletion_markers']:
            require_valid(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0)
        identity = db.execute('SELECT vault_id, history_format, history_generation, store_instance_id, clean_close_sequence FROM history_metadata').fetchone()
        original = str(Path(db.execute("SELECT current_path FROM timeline_heads WHERE note_id='release-seed-0'").fetchone()[0]).parent)
    manifest = json.loads((vault / '.gneauxghts/vault.json').read_text())
    observations = json.loads((data / 'note-timeline-history-observations.json').read_text())['vaults'][identity[0]]
    require_valid([manifest['vaultId'], manifest['historyFormat'], manifest['historyGeneration']] == list(identity[:3]))
    require_valid([observations['historyFormat'], observations['generation'], observations['storeInstanceId'], observations['cleanCloseSequence']] == list(identity[1:]))
    for index in range(1000):
        require_valid(f'id: release-seed-{index}\n' in (vault / f'Seed {index}.md').read_text())
    return {'identity': list(identity), 'original_vault': original}


def seal(cache, vault, data, origin):
    if cache.exists():
        raise ValueError('Fixture already exists; validate/reuse it or explicitly reset')
    # Import only a stopped synthetic writer. Never snapshot a live application.
    for path in [vault / DB, Path(str(vault / DB) + '-wal')]:
        if path.exists():
            opened = subprocess.run(['lsof', '-t', str(path)], capture_output=True)
            if opened.returncode != 1:
                raise ValueError('Fixture database is open or could not be checked')
    digest_files(vault)
    digest_files(data)
    metadata = validate(vault, data)
    cache.mkdir(parents=True)
    try:
        shutil.copytree(vault, cache / 'vault')
        shutil.copytree(data, cache / 'data')
        # SQLite backup includes a stopped writer's WAL without modifying its source.
        for suffix in ['', '-wal', '-shm']:
            (cache / 'vault' / (str(DB) + suffix)).unlink(missing_ok=True)
        with closing(sqlite3.connect((vault / DB).resolve().as_uri() + '?mode=ro', uri=True)) as source:
            with closing(sqlite3.connect(cache / 'vault' / DB)) as target:
                source.backup(target)
                target.execute("PRAGMA journal_mode=DELETE")
        validate(cache / 'vault', cache / 'data')
        (cache / 'fixture.json').write_text(json.dumps({
            'kind': KIND, 'origin': origin, **metadata, 'files': digest_files(cache)
        }, indent=2) + '\n')
    except BaseException:
        shutil.rmtree(cache)
        raise


def check(cache):
    manifest = json.loads((cache / 'fixture.json').read_text())
    if manifest['kind'] != KIND or manifest['files'] != digest_files(cache):
        raise ValueError('Fixture identity or content changed; refusing reuse')
    metadata = validate(cache / 'vault', cache / 'data')
    if any(manifest[key] != value for key, value in metadata.items()):
        raise ValueError('Fixture metadata mismatch')
    return manifest


def clone(cache):
    manifest = check(cache)
    run = Path(tempfile.mkdtemp(prefix='gneauxghts-timeline-run-')).resolve()
    try:
        for name in ['vault', 'data']:
            shutil.copytree(cache / name, run / name)
        # Paths are test geometry, not authored payload. No revision bytes, identities,
        # hashes, generations, or app observation attestations are rewritten.
        with sqlite3.connect(run / 'vault' / DB) as db:
            for table, columns in {
                'timeline_heads': ['current_path'],
                'prepared_intents': ['target_path'],
                'lifecycle_events': ['path', 'previous_path'],
            }.items():
                for column in columns:
                    db.execute(f'UPDATE {table} SET {column} = ? || substr({column}, ?) WHERE substr({column}, 1, ?) = ?',
                               (str(run / 'vault'), len(manifest['original_vault']) + 1,
                                len(manifest['original_vault']) + 1, manifest['original_vault'] + '/'))
        validate(run / 'vault', run / 'data')
        (run / 'run.json').write_text(json.dumps({'kind': KIND, 'master': str(cache.resolve())}))
        return run
    except BaseException:
        shutil.rmtree(run)
        raise


def reset(cache):
    # A damaged recognized master can be reset, but an arbitrary directory cannot.
    manifest = json.loads((cache / 'fixture.json').read_text())
    if cache.is_symlink() or manifest.get('kind') != KIND or not manifest.get('identity'):
        raise ValueError('Refusing to reset an unrecognized fixture')
    shutil.rmtree(cache)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'import', 'check', 'clone', 'run', 'native', 'reset'])
    parser.add_argument('--cache', type=Path, default=DEFAULT)
    parser.add_argument('--vault', type=Path)
    parser.add_argument('--data', type=Path)
    args = parser.parse_args()
    if args.cache.is_symlink():
        raise ValueError('Fixture root must not be a symlink')
    cache = args.cache.resolve()
    if args.action == 'create':
        if cache.exists():
            check(cache)
            print(cache)
            return
        with tempfile.TemporaryDirectory(prefix='gneauxghts-fixture-create-') as staging:
            env = {**os.environ, 'GNEAUXGHTS_RELEASE_FIXTURE_EXPORT': staging}
            subprocess.run(['cargo', 'test', '--release', '--manifest-path', 'src-tauri/Cargo.toml',
                            'release_scale_and_availability', '--', '--ignored', '--nocapture'], env=env, check=True)
            seal(cache, Path(staging) / 'vault', Path(staging) / 'data', 'production save command; clean close')
        print(cache)
    elif args.action == 'import':
        if not args.vault or not args.data:
            parser.error('import requires --vault and --data from the stopped issue 23 synthetic writer')
        for path, prefix in [(args.vault, 'gneauxghts-release-scale-vault-'), (args.data, 'gneauxghts-release-scale-data-')]:
            if path.resolve().parent != Path(tempfile.gettempdir()).resolve() or not path.name.startswith(prefix):
                raise ValueError('Only the retained temporary issue 23 fixture may be imported')
        seal(cache, args.vault.resolve(), args.data.resolve(), 'retained issue 23 production-command fixture; stopped writer SQLite backup')
        print(cache)
    elif args.action == 'check':
        print(json.dumps(check(cache), indent=2))
    elif args.action == 'reset':
        reset(cache)
    else:
        if args.action == 'native':
            for port in [1430, 4445]:
                with socket.socket() as probe:
                    if probe.connect_ex(('127.0.0.1', port)) == 0:
                        raise ValueError(f'Test port {port} is already in use; stop the previous test before retrying')
        run = clone(cache)
        print(run, flush=True)
        if args.action in ['run', 'native']:
            try:
                command = (['pnpm', 'exec', 'wdio', 'run', 'e2e/wdio.native.conf.ts', '--spec',
                            'e2e/specs/scale/timeline-native-scale.spec.ts'] if args.action == 'native' else
                           ['cargo', 'test', '--release', '--manifest-path', 'src-tauri/Cargo.toml',
                            'release_retained_scale_latency', '--', '--ignored', '--nocapture'])
                subprocess.run(command, check=True,
                               env={**os.environ, 'GNEAUXGHTS_RELEASE_SCALE_RUN': str(run)})
            except subprocess.CalledProcessError:
                if (run / 'logs').exists():
                    logs = Path(tempfile.mkdtemp(prefix='gneauxghts-timeline-logs-'))
                    shutil.copytree(run / 'logs', logs, dirs_exist_ok=True)
                    print(f'Failed-run logs: {logs}', flush=True)
                raise
            finally:
                shutil.rmtree(run)
                check(cache)


if __name__ == '__main__':
    main()
