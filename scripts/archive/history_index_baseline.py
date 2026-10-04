#!/usr/bin/env python3
"""Immutable schema-13 fixture allocation and owned-copy DROP/VACUUM experiment."""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time

DATABASE = Path('vault/.gneauxghts/history.sqlite3')
INDEX = 'prepared_intents_by_target'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_seal(master):
    manifest = json.loads((master / 'fixture.json').read_text())
    if manifest['kind'] != 'gneauxghts-current-scale-v1':
        raise ValueError('Expected sealed old-format current-scale fixture')
    actual = {}
    for path in sorted(master.rglob('*')):
        if path.is_symlink():
            raise ValueError('Fixture must not contain symlinks')
        if path.is_file() and path != master / 'fixture.json':
            actual[str(path.relative_to(master))] = sha256(path)
    if actual != manifest['files']:
        raise ValueError('Sealed fixture changed')
    wal = Path(str(master / DATABASE) + '-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('Immutable read requires a zero-byte or absent WAL')
    return manifest


def allocation(db, path):
    rows = db.execute('''SELECT s.name, s.type, count(*), sum(d.pgsize),
        sum(d.payload), sum(d.unused) FROM dbstat d
        JOIN sqlite_schema s ON s.name=d.name GROUP BY s.name, s.type ORDER BY s.name''').fetchall()
    # sqlite_schema itself is not a row in sqlite_schema.
    schema = db.execute("SELECT count(*), sum(pgsize), sum(payload), sum(unused) FROM dbstat WHERE name='sqlite_schema'").fetchone()
    objects = [dict(zip(('name', 'type', 'pages', 'allocated_bytes', 'payload_bytes',
                        'in_page_unused_bytes'), row)) for row in rows]
    objects.append(dict(zip(('name', 'type', 'pages', 'allocated_bytes', 'payload_bytes',
                            'in_page_unused_bytes'), ('sqlite_schema', 'table', *schema))))
    page_size = db.execute('PRAGMA page_size').fetchone()[0]
    pages = db.execute('PRAGMA page_count').fetchone()[0]
    free_pages = db.execute('PRAGMA freelist_count').fetchone()[0]
    return {
        'main_file_bytes': path.stat().st_size,
        'page_size': page_size, 'page_count': pages,
        'freelist_pages': free_pages, 'freelist_bytes': free_pages * page_size,
        'auto_vacuum': db.execute('PRAGMA auto_vacuum').fetchone()[0],
        'objects': objects,
        'table_allocated_bytes': sum(o['allocated_bytes'] for o in objects if o['type'] == 'table'),
        'index_allocated_bytes': sum(o['allocated_bytes'] for o in objects if o['type'] == 'index'),
        'btree_payload_bytes': sum(o['payload_bytes'] for o in objects),
        'in_page_unused_bytes': sum(o['in_page_unused_bytes'] for o in objects),
        'other_allocated_bytes': pages * page_size - free_pages * page_size - sum(o['allocated_bytes'] for o in objects),
        'compressed_revision_payload_bytes': db.execute('SELECT sum(length(payload)) FROM revisions').fetchone()[0],
        'pending_and_terminal_authored_payload_bytes': db.execute('SELECT sum(length(authored_payload)) FROM prepared_intents').fetchone()[0],
        'prepared_intent_count': db.execute('SELECT count(*) FROM prepared_intents').fetchone()[0],
        'revision_count': db.execute('SELECT count(*) FROM revisions').fetchone()[0],
        'average_intent_token_bytes': db.execute('SELECT avg(length(CAST(intent_id AS BLOB))) FROM prepared_intents').fetchone()[0],
    }


def query_plans(db):
    # Concrete access paths from history_store.rs and history_store/editing_windows.rs.
    note, intent = db.execute('SELECT note_id, intent_id FROM prepared_intents LIMIT 1').fetchone()
    queries = {
        'exact_intent': ('SELECT result_hash FROM prepared_intents WHERE intent_id=?1', [intent]),
        'note_pending_guard': ("SELECT COUNT(*) FROM prepared_intents WHERE note_id=?1 AND status='prepared' AND intent_id!=?2", [note, 'next-intent']),
        'pending_recovery': ('''SELECT intent_id, target_path, authored_payload, result_hash, note_id
            FROM prepared_intents WHERE status='prepared'
            AND (?1=0 OR EXISTS(SELECT 1 FROM publication_receipts p WHERE p.intent_id=prepared_intents.intent_id AND p.live=0))
            ORDER BY prepared_at_millis, intent_id''', [0]),
        'pending_health': ("SELECT COUNT(*) FROM prepared_intents WHERE status='prepared'", []),
        'note_deletion': ('DELETE FROM prepared_intents WHERE note_id=?1', [note]),
        'receipt_retirement': ('''SELECT p.intent_id,p.sequence FROM publication_receipts p JOIN prepared_intents i ON i.intent_id=p.intent_id
            WHERE p.note_id=?1 AND p.live=0 AND i.status != 'prepared'
            AND NOT EXISTS(SELECT 1 FROM pending_editing_windows w WHERE w.endpoint_intent_id=p.intent_id)
            AND NOT EXISTS(SELECT 1 FROM revisions r WHERE r.intent_id=p.intent_id)
            AND NOT EXISTS(SELECT 1 FROM lifecycle_events l WHERE l.intent_id=p.intent_id)
            AND NOT EXISTS(SELECT 1 FROM restore_origins o WHERE o.intent_id=p.intent_id)
            ORDER BY p.sequence DESC LIMIT -1 OFFSET ?2''', [note, 64]),
    }
    return {name: {'sql': sql, 'plan': [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + sql, params)]}
            for name, (sql, params) in queries.items()}


def measure(master, repack):
    manifest = verify_seal(master)
    path = master / DATABASE
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True, cached_statements=0)) as db:
        db.execute('PRAGMA foreign_keys=ON')
        identity = db.execute('SELECT vault_id, history_format, history_generation, store_instance_id, clean_close_sequence FROM history_metadata').fetchone()
        if list(identity) != manifest['identity'] or db.execute('SELECT schema_version, portability_state FROM history_metadata').fetchone() != (13, 'portable'):
            raise ValueError('Fixture admission metadata mismatch')
        before = allocation(db, path)
        plans_before = query_plans(db)
    with tempfile.TemporaryDirectory(prefix='gneauxghts-issue51-index-copy-') as temporary:
        copy = Path(temporary) / 'history.sqlite3'
        shutil.copyfile(path, copy)
        if sha256(copy) != manifest['files'][str(DATABASE)]:
            raise ValueError('Disposable copy differs from sealed database')
        with closing(sqlite3.connect(copy, cached_statements=0)) as db:
            db.execute('PRAGMA foreign_keys=ON')
            started = time.monotonic()
            db.execute('DROP INDEX ' + INDEX)
            db.commit()
            # The controlled experiment contains only this DROP, not newer app DDL.
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            drop_ms = (time.monotonic() - started) * 1000
            after_drop = allocation(db, copy)
            plans_after = query_plans(db)
            after_vacuum = None
            vacuum_ms = None
            if repack:
                started = time.monotonic()
                db.execute('VACUUM')
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                vacuum_ms = (time.monotonic() - started) * 1000
                after_vacuum = allocation(db, copy)
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Disposable experiment failed integrity checks')
            # Outside the allocation experiment: the 10k master predates even
            # the pending partial index. Compare current code's access paths
            # with/without the obsolete index, leaving the masters untouched.
            db.executescript('''CREATE INDEX prepared_intents_by_target ON prepared_intents(target_path, source, result_hash, status);
                CREATE INDEX IF NOT EXISTS prepared_intents_pending_by_note ON prepared_intents(note_id) WHERE status='prepared';
                CREATE INDEX IF NOT EXISTS revisions_by_predecessor ON revisions(note_id, predecessor_kind, predecessor_id);
                CREATE INDEX IF NOT EXISTS lifecycle_events_by_predecessor ON lifecycle_events(note_id, predecessor_kind, predecessor_id);''')
            current_plans_before = query_plans(db)
            db.execute('DROP INDEX ' + INDEX)
            current_plans_after = query_plans(db)
            if current_plans_before != current_plans_after:
                raise ValueError('Current derived-index query plan changed after removal')
    if verify_seal(master) != manifest:
        raise ValueError('Master changed during experiment')
    return {'master': str(master), 'seal_sha256': sha256(master / 'fixture.json'),
            'database_sha256': manifest['files'][str(DATABASE)],
            'master_verified_before_and_after': True, 'master_wal_bytes': 0,
            'identity': identity, 'baseline': before, 'after_drop_checkpoint': after_drop,
            'after_drop_vacuum_checkpoint': after_vacuum, 'drop_checkpoint_ms': drop_ms,
            'vacuum_checkpoint_ms': vacuum_ms, 'plans_before': plans_before,
            'plans_after_drop': plans_after, 'original_plans_unchanged': plans_before == plans_after,
            'current_derived_index_plans_before': current_plans_before,
            'current_derived_index_plans_after': current_plans_after,
            'current_derived_index_plans_unchanged': True,
            'copy_integrity_check': 'ok', 'copy_foreign_key_violations': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--master', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--repack', action='store_true')
    args = parser.parse_args()
    # Refuse to overwrite evidence or write into a source fixture.
    if args.output.exists() or any(args.output.resolve().is_relative_to(p.resolve()) for p in args.master):
        raise ValueError('Output must be a new file outside each master')
    results = {'experiment': 'issue51-old-schema13-drop-only', 'sqlite_version': sqlite3.sqlite_version,
               'scope': 'Read-only sealed old masters; byte-for-byte disposable DB copies; no application startup or newer indexes',
               'fixtures': [measure(master.resolve(), args.repack) for master in args.master]}
    with args.output.open('x') as output:
        json.dump(results, output, indent=2)
        output.write('\n')
    print(args.output)


if __name__ == '__main__':
    main()
