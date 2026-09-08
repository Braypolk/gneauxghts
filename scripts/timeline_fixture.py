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

KIND = 'gneauxghts-editing-window-v3'
SCALE_KIND = 'gneauxghts-current-scale-v2'
KINDS = (KIND, SCALE_KIND)
SCHEMA = 14
DB = Path('.gneauxghts/history.sqlite3')
DEFAULT = Path(tempfile.gettempdir()) / 'gneauxghts-window-fixture-v3'


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


def readonly_uri(path):
    # Only stopped synthetic exports and sealed/disposable fixtures enter here.
    # With no WAL, immutable avoids SQLite creating sidecars for a copied WAL-mode
    # main file. Never ignore a nonempty stopped-writer WAL during import.
    wal = Path(str(path) + '-wal')
    suffix = '?mode=ro' if wal.exists() and wal.stat().st_size else '?mode=ro&immutable=1'
    return path.resolve().as_uri() + suffix


def validate_prepared_intents(db, window):
    # Portable fixtures contain only completed receipts; recovery fields never
    # survive capture. Validate the compact retained retry tail once per vault.
    require_valid(db.execute('SELECT count(*) FROM prepared_intents').fetchone()[0] == 0)
    require_valid(db.execute('SELECT count(*) FROM pending_window_preparations').fetchone()[0] == 0)
    counts = dict(db.execute('SELECT note_id,count(*) FROM publication_receipts GROUP BY note_id'))
    note_ids = [note['noteId'] for note in window['notes']]
    require_valid(len(note_ids) == len(set(note_ids)) and set(counts) == set(note_ids))
    for note in window['notes']:
        count = counts[note['noteId']]
        require_valid(count <= note['windows'] + 65)
        if window['kind'] == SCALE_KIND:
            require_valid(count == note['revisions'] + 64)
    require_valid(db.execute("SELECT count(*) FROM publication_receipts WHERE status='prepared' OR live!=0 OR (status='finalized' AND outcome IS NULL) OR intent_id LIKE 'publication-v1:%'").fetchone()[0] == 0)


def validate(vault, data):
    require_valid(not ((data / 'release-window-fixture.json').exists() and (data / 'release-current-scale-fixture.json').exists()))
    window_manifest = data / 'release-window-fixture.json'
    if not window_manifest.exists():
        window_manifest = data / 'release-current-scale-fixture.json'
    require_valid(window_manifest.exists())
    window = json.loads(window_manifest.read_text())
    with closing(sqlite3.connect(readonly_uri(vault / DB), uri=True)) as db:
        require_valid(db.execute('PRAGMA quick_check').fetchall() == [('ok',)])
        require_valid(not db.execute('PRAGMA foreign_key_check').fetchall())
        require_valid(db.execute('SELECT schema_version FROM history_metadata').fetchone()[0] == SCHEMA)
        require_valid(window['kind'] in KINDS)
        if window['kind'] == KIND:
            require_valid([(n['saves'], n['windows']) for n in window['notes']] == [(3600, 12), (120, 40), (120, 40)])
        else:
            require_valid(len(window['notes']) in (1, 901))
            require_valid([(n['revisions'], n['windows'], n['saves'], n['bytes']) for n in window['notes']] == [(10000, 9999, 19998, 65536)] + [(100, 99, 198, 65536)] * (len(window['notes']) - 1))
        require_valid(db.execute('SELECT count(*) FROM revisions').fetchone()[0] == sum(n['windows'] + 1 for n in window['notes']))
        require_valid(db.execute('SELECT count(*) FROM timeline_heads').fetchone()[0] == len(window['notes']))
        require_valid(db.execute('SELECT count(*) FROM pending_editing_windows').fetchone()[0] == 0)
        require_valid(db.execute('SELECT count(*) FROM revision_window_evidence').fetchone()[0] == sum(n['windows'] for n in window['notes']))
        validate_prepared_intents(db, window)
        if window['kind'] == SCALE_KIND:
            require_valid(db.execute('SELECT count(*) FROM publication_receipts').fetchone()[0] == sum(note['revisions'] + 64 for note in window['notes']))
        for note in window['notes']:
            require_valid(db.execute('SELECT count(*) FROM revisions WHERE note_id=?', (note['noteId'],)).fetchone()[0] == note['windows'] + 1)
            if window['kind'] == SCALE_KIND:
                require_valid(db.execute('SELECT count(*) FROM publication_receipts WHERE note_id=?', (note['noteId'],)).fetchone()[0] == note['revisions'] + 64)
                require_valid(db.execute('SELECT issued_sequence FROM publication_scopes WHERE note_id=?', (note['noteId'],)).fetchone()[0] == note['saves'] + 1)
                require_valid(db.execute('SELECT count(*) FROM lifecycle_events WHERE note_id=?', (note['noteId'],)).fetchone()[0] == 1)
        anchor_id = window['notes'][0]['noteId']
        require_valid(db.execute("SELECT count(*) FROM prepared_intents WHERE status='prepared'").fetchone()[0] == 0)
        for table in ['pending_observations', 'pending_deletions', 'deletion_markers']:
            require_valid(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0)
        identity = db.execute('SELECT vault_id, history_format, history_generation, store_instance_id, clean_close_sequence FROM history_metadata').fetchone()
        original = str(Path(db.execute("SELECT current_path FROM timeline_heads WHERE note_id=?", (anchor_id,)).fetchone()[0]).parent)
    manifest = json.loads((vault / '.gneauxghts/vault.json').read_text())
    observations = json.loads((data / 'note-timeline-history-observations.json').read_text())['vaults'][identity[0]]
    require_valid([manifest['vaultId'], manifest['historyFormat'], manifest['historyGeneration']] == list(identity[:3]))
    require_valid([observations['historyFormat'], observations['generation'], observations['storeInstanceId'], observations['cleanCloseSequence']] == list(identity[1:]))
    for note in window['notes']:
        require_valid(f"id: {note['noteId']}\n" in (vault / f"{note['title']}.md").read_text())
    return {'kind': window['kind'], 'identity': list(identity), 'original_vault': original}


def seal(cache, vault, data, origin):
    kind = KIND if (data / 'release-window-fixture.json').exists() else SCALE_KIND
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
        with closing(sqlite3.connect(readonly_uri(vault / DB), uri=True)) as source:
            with closing(sqlite3.connect(cache / 'vault' / DB)) as target:
                source.backup(target)
                target.execute("PRAGMA journal_mode=DELETE")
        validate(cache / 'vault', cache / 'data')
        (cache / 'fixture.json').write_text(json.dumps({
            'kind': kind, 'origin': origin, **metadata, 'files': digest_files(cache)
        }, indent=2) + '\n')
    except BaseException:
        shutil.rmtree(cache)
        raise


def check(cache):
    manifest = json.loads((cache / 'fixture.json').read_text())
    if manifest['kind'] not in KINDS or manifest['files'] != digest_files(cache):
        raise ValueError('Fixture identity or content changed; refusing reuse')
    metadata = validate(cache / 'vault', cache / 'data')
    if any(manifest[key] != value for key, value in metadata.items()):
        raise ValueError('Fixture metadata mismatch')
    return manifest


def require_kind(cache, kind):
    manifest = check(cache)
    if manifest['kind'] != kind:
        raise ValueError('Requested fixture policy does not match the existing sealed fixture')
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
        (run / 'run.json').write_text(json.dumps({'kind': manifest.get('kind', KIND), 'master': str(cache.resolve())}))
        return run
    except BaseException:
        shutil.rmtree(run)
        raise


def reset(cache):
    # A damaged recognized master can be reset, but an arbitrary directory cannot.
    manifest = json.loads((cache / 'fixture.json').read_text())
    if cache.is_symlink() or manifest.get('kind') not in KINDS or not manifest.get('identity'):
        raise ValueError('Refusing to reset an unrecognized fixture')
    shutil.rmtree(cache)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'check', 'clone', 'native', 'reset', 'create-scale', 'native-scale'])
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--vault', type=Path)
    parser.add_argument('--data', type=Path)
    parser.add_argument('--notes', type=int, choices=[1, 901], default=901)
    args = parser.parse_args()
    args.cache = args.cache or DEFAULT
    if args.cache.is_symlink():
        raise ValueError('Fixture root must not be a symlink')
    cache = args.cache.resolve()
    if args.action == 'create-scale':
        if args.cache == DEFAULT:
            raise ValueError('create-scale requires an explicit --cache')
        if cache.exists():
            require_kind(cache, SCALE_KIND)
            require_valid(len(json.loads((cache / 'data/release-current-scale-fixture.json').read_text())['notes']) == args.notes)
        else:
            with tempfile.TemporaryDirectory(prefix='gneauxghts-current-scale-build-') as staging:
                export = Path(staging) / 'export'
                env = {**os.environ, 'GNEAUXGHTS_SCALE_EXPORT': str(export), 'GNEAUXGHTS_SCALE_NOTES': str(args.notes)}
                subprocess.run(['cargo', 'test', '--release', '--manifest-path', 'src-tauri/Cargo.toml', 'release_current_scale_fixture', '--', '--ignored', '--nocapture'], env=env, check=True)
                seal(cache, export / 'vault', export / 'data', 'production save command; two saves per fixed-deadline Editing Window; clean close')
        print(cache)
    elif args.action == 'create':
        if cache.exists():
            require_kind(cache, KIND)
            print(cache)
            return
        with tempfile.TemporaryDirectory(prefix='gneauxghts-fixture-create-') as staging:
            env = {**os.environ, 'GNEAUXGHTS_WINDOW_FIXTURE_EXPORT': staging}
            subprocess.run(['cargo', 'test', '--release', '--manifest-path', 'src-tauri/Cargo.toml',
                            'release_window_fixture', '--', '--ignored', '--nocapture'], env=env, check=True)
            seal(cache, Path(staging) / 'vault', Path(staging) / 'data', 'production save command; clean close')
        print(cache)
    elif args.action == 'check':
        print(json.dumps(check(cache), indent=2))
    elif args.action == 'reset':
        reset(cache)
    else:
        if args.action in ('native', 'native-scale'):
            require_kind(cache, KIND if args.action == 'native' else SCALE_KIND)
            for port in [1430, 4445]:
                with socket.socket() as probe:
                    if probe.connect_ex(('127.0.0.1', port)) == 0:
                        raise ValueError(f'Test port {port} is already in use; stop the previous test before retrying')
        run = clone(cache)
        print(run, flush=True)
        if args.action in ('native', 'native-scale'):
            try:
                command = ['pnpm', 'exec', 'wdio', 'run', 'e2e/wdio.native.conf.ts', '--spec',
                           'e2e/specs/scale/editing-window-native-scale.spec.ts']
                if args.action == 'native-scale':
                    command = ['node', 'e2e/support/currentScaleNative.mjs', str(run)]
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
