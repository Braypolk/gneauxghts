"""Inspect a stable raw copy while the owned native process is live. Never open its SQLite."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
assert root.name.startswith('gneauxghts-process-relaunch-')
assert (root / 'owner.txt').read_text().strip() == 'issue48-disposable'
databases = list((root / 'vault').rglob('history.sqlite3'))
assert len(databases) == 1, databases
source = databases[0]
copy_root = Path(sys.argv[2])
copy_root.mkdir()
# A parked boundary holds the production mutation owner. For ordinary settled
# reads, reject a changing source instead of accepting an inconsistent file pair.
def source_bytes():
    return {suffix: Path(str(source) + suffix).read_bytes()
            for suffix in ('', '-wal') if Path(str(source) + suffix).exists()}

before = source_bytes()
for suffix, payload in before.items():
    (copy_root / ('history.sqlite3' + suffix)).write_bytes(payload)
assert source_bytes() == before, 'Native history changed during raw snapshot; retry the case'
copy = copy_root / 'history.sqlite3'
# SQLite needs SHM/WAL setup for a WAL-mode main file even when no WAL exists.
# A closed byte copy without WAL is immutable; never ignore a nonempty WAL.
suffix = '?mode=ro' if before.get('-wal') else '?mode=ro&immutable=1'
connection = sqlite3.connect(copy.as_uri() + suffix, uri=True)
connection.row_factory = sqlite3.Row

def rows(sql):
    return [dict(row) for row in connection.execute(sql)]

print(json.dumps({
    'database': str(source),
    'inspectedCopy': str(copy),
    'sourceFileSha256': {suffix or 'main': hashlib.sha256(payload).hexdigest() for suffix, payload in before.items()},
    'integrity': rows('PRAGMA integrity_check'),
    'foreignKeys': rows('PRAGMA foreign_key_check'),
    'intents': rows('SELECT intent_id, note_id, status, source, length(authored_payload) AS payloadBytes FROM prepared_intents ORDER BY prepared_at_millis, intent_id'),
    'windowPreparations': rows('SELECT * FROM pending_window_preparations'),
    'receipts': rows('SELECT * FROM publication_receipts ORDER BY sequence'),
    'scopes': rows('SELECT * FROM publication_scopes'),
    'windows': rows('SELECT note_id, window_id, anchor_revision_id, endpoint_intent_id, result_hash, length(payload) AS payloadBytes FROM pending_editing_windows'),
    'revisions': rows('SELECT revision_id, predecessor_id, source, intent_id, result_hash FROM revisions'),
    'evidence': rows('SELECT revision_id, window_id FROM revision_window_evidence'),
    'observations': rows('SELECT sequence, canonical_markdown FROM pending_observations'),
}))
