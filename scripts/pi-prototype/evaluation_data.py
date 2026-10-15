#!/usr/bin/env python3
"""Private, stopped-vault setup for the opt-in Pi evaluation (never a live backup)."""
import argparse
from contextlib import contextmanager, closing
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import tempfile

KIND = 'gneauxghts-pi-evaluation-v1'
MARKER = 'pi-evaluation.json'
RECOVERY_MARKER = 'pi-stopped-recovery.json'
RECOVERY_KIND = 'gneauxghts-pi-stopped-recovery-v1'
VAULT = Path('PROTOTYPE-wipe-me/vault')
HISTORY = Path('.gneauxghts/history.sqlite3')
PATH_COLUMNS = {'timeline_heads': ['current_path'], 'lifecycle_events': ['path', 'previous_path'],
                'missing_notes': ['path'], 'baseline_initialization_failures': ['path']}
PENDING = ['prepared_intents', 'pending_observations', 'pending_deletions',
           'pending_editing_windows', 'pending_window_preparations']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(path):
    path = Path(path).absolute()
    require(path != Path('/') and path != Path.home(), 'Refusing an unsafe evaluation/source root')
    for ancestor in [path, *path.parents]:
        require(not ancestor.is_symlink(), 'Symlink paths are not supported; use the canonical path')
    return path


def inventory(root, hash_files=True):
    """Reject links/special files even in excluded folders. Keep private names in memory only."""
    result = {}
    for base, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(base) / name
            info = path.lstat()
            require(not stat.S_ISLNK(info.st_mode), 'Vault/evaluation tree contains a symlink')
            require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'Tree contains a special file')
            if stat.S_ISREG(info.st_mode):
                if hash_files:
                    digest = hashlib.sha256()
                    with path.open('rb') as handle:
                        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                            digest.update(chunk)
                    result[str(path.relative_to(root))] = digest.hexdigest()
    return result


def stopped(root):
    # Fail closed if lsof is absent or cannot inspect the tree. No stdout (which
    # could expose private paths) is retained. This is a stopped-writer check,
    # not a claim of a lock against an independently restarted ordinary app.
    check = subprocess.run(['lsof', '-t', '+D', str(root)], stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=30)
    require(check.returncode == 1 and not check.stdout.strip(), 'Close the app using this root before setup/reset/launch; lsof must confirm no open files')


@contextmanager
def operation(root):
    root = safe_path(root)
    root.parent.mkdir(parents=True, exist_ok=True)
    lock = root.parent / (root.name + '.pi-evaluation.lock')
    require(not lock.is_symlink(), 'Evaluation lock must not be a symlink')
    descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('Another evaluation runner/setup owns this root') from error
        yield root


def recognized(root):
    require(root.is_dir(), 'Evaluation root is missing; run setup or desktop first')
    inventory(root, hash_files=False)
    try:
        marker = json.loads((root / MARKER).read_text())
    except (OSError, ValueError) as error:
        raise ValueError('Refusing an unrecognized root; evaluation marker is required') from error
    require(marker.get('kind') == KIND and marker.get('root') == str(root), 'Evaluation marker/root mismatch')
    return marker


def inspect_history(vault, allow_open=False):
    path = vault / HISTORY
    require(path.is_file(), 'A copied vault requires its cleanly closed Note Timeline store')
    require(not Path(str(path) + '-wal').exists() or Path(str(path) + '-wal').stat().st_size == 0,
            'Nonempty history WAL: cleanly close the source app before copying')
    manifest = json.loads((vault / '.gneauxghts/vault.json').read_text())
    require(manifest.get('schemaVersion') == 2 and manifest.get('historyFormat') == 'sqlite-v1',
            'Unsupported vault manifest; this helper does not migrate/reset source history')
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        require(db.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'History integrity check failed')
        require(not db.execute('PRAGMA foreign_key_check').fetchall(), 'History foreign-key check failed')
        row = db.execute('SELECT vault_id,history_format,history_generation,schema_version,store_instance_id,clean_close_sequence,portability_state FROM history_metadata WHERE singleton=1').fetchone()
        require(row and list(row[:3]) == [manifest['vaultId'], manifest['historyFormat'], manifest['historyGeneration']],
                'History manifest/store identity mismatch')
        require(row[3] == 14 and row[4] and row[5] >= 0 and row[6] in ['open', 'portable'],
                'Source history metadata is unsupported or incomplete')
        require(allow_open or (row[5] > 0 and row[6] == 'portable'),
                'Source history must be current schema and portable after clean close')
        for table in PENDING:
            require(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0,
                    'Source history has unsettled work; cleanly close the source app')
        require(db.execute("SELECT count(*) FROM publication_receipts WHERE status='prepared' OR live!=0 OR (status='finalized' AND outcome IS NULL)").fetchone()[0] == 0,
                'Source history has unsettled publication receipts')
        require(db.execute('SELECT count(*) FROM history_reset_rebuild WHERE pending!=0').fetchone()[0] == 0,
                'Source history reset is not complete')
    return {'vaultId': row[0], 'historyGeneration': row[2], 'storeInstanceId': row[4], 'cleanCloseSequence': row[5],
            **({'portabilityState': row[6]} if allow_open else {})}


def portable(vault):
    return inspect_history(vault)


def recovery_root(root):
    root = safe_path(root)
    return root.parent / (root.name + '.stopped-recovery')


def legacy_markdown(path):
    if path.suffix.lower() != '.md':
        return False
    # This app emits a closed managed kind inside its frontmatter. Omit all
    # managed chat artifacts, including relocated/forgotten copies outside Chats.
    with path.open('r', encoding='utf-8-sig') as handle:
        if handle.readline().strip() != '---':
            return False
        for line in handle:
            if line.strip() == '---':
                break
            if re.match(r'^\s*kind:\s*[\'"]?chat(?:Index|Transcript|Excerpt)\b', line):
                return True
    return False


def copy_files(source, destination):
    copied = excluded = 0
    for base, directories, files in os.walk(source):
        relative = Path(base).relative_to(source)
        directories[:] = [name for name in directories if
                           not (relative == Path('.') and (name == 'Chats' or (name.startswith('.') and name != '.forgotten')))]
        for name in files:
            path = Path(base) / name
            if (relative == Path('.') and name.startswith('.')) or legacy_markdown(path):
                excluded += 1
                continue
            target = destination / relative / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            copied += 1
    data = destination / '.gneauxghts'
    data.mkdir(parents=True, exist_ok=True)
    for name in ['vault.json', 'history.sqlite3']:
        shutil.copy2(source / '.gneauxghts' / name, data / name)
    return copied, excluded


def relocate_history(vault, source, final_vault):
    # Rewrite storage location geometry only, as the existing timeline fixture
    # clone does. IDs, revision payloads/hashes, provenance, generation and clean
    # close watermark are unchanged. Never open the source read-write.
    with closing(sqlite3.connect(vault / HISTORY)) as db, db:
        db.execute('PRAGMA journal_mode=DELETE')
        for table, columns in PATH_COLUMNS.items():
            for column in columns:
                for rowid, value in db.execute(f'SELECT rowid,{column} FROM {table} WHERE {column} IS NOT NULL').fetchall():
                    path = Path(value)
                    # Older lifecycle locations may predate a vault relocation.
                    # Fail closed rather than leave links to an original/external root.
                    require(path.is_absolute() and path.is_relative_to(source), 'History contains paths outside the supplied source root; use a reconciled portable export')
                    db.execute(f'UPDATE {table} SET {column}=? WHERE rowid=?',
                               (str(final_vault / path.relative_to(source)), rowid))


def create(root, source=None, recovery=False, intended_root=None, observations=None, allow_pending_recovery=False):
    root = safe_path(root)
    source = safe_path(source) if source else None
    if not recovery and not allow_pending_recovery and recovery_root(root).exists():
        pending = json.loads((recovery_root(root) / RECOVERY_MARKER).read_text())
        require(pending.get('state') == 'adopted', 'A stopped-source recovery is pending; adopt its native-cleanly-closed vault before launching')
    if source:
        require(source.is_dir() and not source.is_relative_to(root) and not root.is_relative_to(source),
                'Source and evaluation roots must be separate non-nested folders')
    with operation(root) as root:
        require(not root.exists() or (root.is_dir() and not any(root.iterdir())),
                'Root already contains data; reuse it or explicitly reset before setup')
        if source:
            before = inventory(source)
            stopped(source)
            identity = inspect_history(source, allow_open=recovery)
            if recovery:
                observation_path = safe_path(observations)
                require(observation_path.is_file(), 'Stopped-source recovery requires the original app-local observations file')
                observation_bytes = observation_path.read_bytes()
                observation_hash = hashlib.sha256(observation_bytes).hexdigest()
                original = json.loads(observation_bytes)
                entry = original.get('vaults', {}).get(identity['vaultId'])
                require(entry and entry.get('historyFormat') == 'sqlite-v1'
                        and entry.get('generation') == identity['historyGeneration']
                        and entry.get('storeInstanceId') == identity['storeInstanceId']
                        and entry.get('cleanCloseSequence') == identity['cleanCloseSequence']
                        and not entry.get('allowMissingStore', False)
                        and not entry.get('resetRebuildPending', False),
                        'Original app-local observation does not exactly match stopped history')
        staging = Path(tempfile.mkdtemp(prefix=root.name + '.staging-', dir=root.parent))
        os.chmod(staging, 0o700)
        try:
            vault = staging / VAULT
            vault.mkdir(parents=True)
            report = {'kind': KIND, 'root': str(root), 'copied': bool(source)}
            if source:
                copied, excluded = copy_files(source, vault)
                require(inventory(source) == before, 'Source changed during copying; no evaluation data adopted')
                stopped(source)
                require(inspect_history(source, allow_open=recovery) == identity, 'Source history changed during copying')
                relocate_history(vault, source, root / VAULT)
                require(inspect_history(vault, allow_open=recovery) == identity, 'Copied history identity changed')
                report.update(history=identity, copiedFiles=copied, excludedFiles=excluded)
            if recovery:
                require(hashlib.sha256(observation_path.read_bytes()).hexdigest() == observation_hash,
                        'Original app-local observation changed during copying')
                (staging / 'note-timeline-history-observations.json').write_text(
                    json.dumps({'vaults': {identity['vaultId']: entry}}, indent=2) + '\n')
                report.update(observationSha256=observation_hash,
                              observationEntryCopied=True, kind=RECOVERY_KIND, intendedRoot=str(intended_root),
                              state='requires-native-recovery-and-clean-close',
                              recoveryRequirement='Native NoteTimeline requires a verified matching original app-local observation for an open store; missing observation must remain a rejection')
            (staging / (RECOVERY_MARKER if recovery else MARKER)).write_text(json.dumps(report, indent=2) + '\n')
            if root.exists():
                root.rmdir()  # Only the verified empty root, never existing data.
            staging.rename(root)
            return report
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def export_stopped_recovery(root, source, observations):
    require(observations, 'Stopped-source recovery requires original app-local observations')
    root = safe_path(root)
    require(not root.exists() or (root.is_dir() and not any(root.iterdir())),
            'Normal evaluation root already contains data; recovery cannot replace it')
    with operation(root):
        return create(recovery_root(root), source, recovery=True, intended_root=root, observations=observations)


def adopt_recovered(root, quarantine):
    root = safe_path(root)
    quarantine = safe_path(quarantine)
    require(quarantine == recovery_root(root), 'Recovery path must match this evaluation root sibling')
    with operation(quarantine):
        inventory(quarantine, hash_files=False)
        receipt = json.loads((quarantine / RECOVERY_MARKER).read_text())
        require(receipt.get('kind') == RECOVERY_KIND and receipt.get('root') == str(quarantine)
                and receipt.get('intendedRoot') == str(root), 'Recovery marker/root mismatch')
        stopped(quarantine)
        current = portable(quarantine / VAULT)
        previous = receipt['history']
        observed = json.loads((quarantine / 'note-timeline-history-observations.json').read_text()).get('vaults', {}).get(current['vaultId'])
        require(observed and observed.get('historyFormat') == 'sqlite-v1'
                and observed.get('generation') == current['historyGeneration']
                and observed.get('storeInstanceId') == current['storeInstanceId']
                and observed.get('cleanCloseSequence') == current['cleanCloseSequence']
                and not observed.get('allowMissingStore', False)
                and not observed.get('resetRebuildPending', False),
                'Native recovery must record the same clean-close watermark in quarantine observations')
        require(all(current[key] == previous[key] for key in ['vaultId', 'historyGeneration', 'storeInstanceId'])
                and current['cleanCloseSequence'] > previous['cleanCloseSequence'],
                'Native recovery must retain history identity and advance clean-close watermark')
        report = create(root, quarantine / VAULT, allow_pending_recovery=True)
        receipt.update(state='adopted', adoptedRoot=str(root), adoptedHistory=current)
        (quarantine / RECOVERY_MARKER).write_text(json.dumps(receipt, indent=2) + '\n')
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['init', 'setup', 'status', 'reset', 'launch'])
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--recover-stopped-source', action='store_true')
    parser.add_argument('--adopt-recovered', type=Path)
    parser.add_argument('--observations', type=Path)
    import sys
    argv = sys.argv[1:]
    split = argv.index('--') if '--' in argv else len(argv)
    args = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    if args.action in ['init', 'setup']:
        require(args.action != 'setup' or args.source or args.adopt_recovered, 'setup requires --source or --adopt-recovered')
        require(not (args.adopt_recovered and (args.source or args.recover_stopped_source)), 'Recovery export and adoption are separate operations')
        require(not args.recover_stopped_source or (args.action == 'setup' and args.source), 'Stopped-source recovery requires setup --source')
        if args.adopt_recovered:
            report = adopt_recovered(args.root, args.adopt_recovered)
        elif args.recover_stopped_source:
            require(args.observations, 'Stopped-source recovery requires --observations /absolute/original-app-observations.json')
            report = export_stopped_recovery(args.root, args.source, args.observations)
        else:
            report = create(args.root, args.source)
    else:
        with operation(args.root) as root:
            report = recognized(root)
            if args.action == 'reset':
                stopped(root)
                shutil.rmtree(root)
                report = {'kind': KIND, 'reset': True, 'root': str(root)}
            elif args.action == 'launch':
                stopped(root)
                require(command, 'launch requires a command')
                raise SystemExit(subprocess.call(command))
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except OSError as error:
        # Avoid per-note source paths in a failed private copy's logs.
        raise SystemExit(f'Evaluation setup refused: filesystem operation failed ({error.strerror})')
    except UnicodeError:
        raise SystemExit('Evaluation setup refused: source Markdown is not valid UTF-8')
    except subprocess.SubprocessError:
        raise SystemExit('Evaluation setup refused: stopped-writer check or launch failed')
    except (ValueError, sqlite3.Error) as error:
        # SQLite errors contain schema diagnostics, not query result/prose.
        raise SystemExit(f'Evaluation setup refused: {error}')
