use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, DiffOp};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const DELTA_MAGIC: &[u8; 4] = b"NTD1";
const LINE_DELTA_MAGIC: &[u8; 4] = b"NTL1";
const MAX_REPLAY_REVISIONS: usize = 128;
const MAX_ACCUMULATED_DELTA_BYTES: usize = 256 * 1024;
const MAX_DELTA_TO_FULL_RATIO: f64 = 0.65;
const MAX_MEASURED_REPLAY: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, PartialEq, Eq)]
struct Delta {
    retained_prefix: u64,
    deleted: u64,
    inserted: Vec<u8>,
    result_len: u64,
}

impl Delta {
    fn between(base: &[u8], result: &[u8]) -> Self {
        let prefix = base
            .iter()
            .zip(result)
            .take_while(|(left, right)| left == right)
            .count();
        let shared_after_prefix = base.len().min(result.len()).saturating_sub(prefix);
        let suffix = base[prefix..]
            .iter()
            .rev()
            .zip(result[prefix..].iter().rev())
            .take(shared_after_prefix)
            .take_while(|(left, right)| left == right)
            .count();
        Self {
            retained_prefix: prefix as u64,
            deleted: (base.len() - prefix - suffix) as u64,
            inserted: result[prefix..result.len() - suffix].to_vec(),
            result_len: result.len() as u64,
        }
    }

    #[cfg(test)]
    fn apply(&self, base: &[u8]) -> Result<Vec<u8>, String> {
        let prefix = usize::try_from(self.retained_prefix)
            .map_err(|_| "delta prefix does not fit this platform".to_string())?;
        let deleted = usize::try_from(self.deleted)
            .map_err(|_| "delta deletion does not fit this platform".to_string())?;
        let suffix_start = prefix
            .checked_add(deleted)
            .filter(|end| *end <= base.len())
            .ok_or_else(|| "delta deletion exceeds base content".to_string())?;
        let expected_len = usize::try_from(self.result_len)
            .map_err(|_| "delta result length does not fit this platform".to_string())?;
        let mut result = Vec::with_capacity(expected_len);
        result.extend_from_slice(&base[..prefix]);
        result.extend_from_slice(&self.inserted);
        result.extend_from_slice(&base[suffix_start..]);
        if result.len() != expected_len {
            return Err(format!(
                "delta reconstructed {} bytes, expected {expected_len}",
                result.len()
            ));
        }
        Ok(result)
    }

    fn encode(&self) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(36 + self.inserted.len());
        encoded.extend_from_slice(DELTA_MAGIC);
        encoded.extend_from_slice(&self.retained_prefix.to_le_bytes());
        encoded.extend_from_slice(&self.deleted.to_le_bytes());
        encoded.extend_from_slice(&(self.inserted.len() as u64).to_le_bytes());
        encoded.extend_from_slice(&self.result_len.to_le_bytes());
        encoded.extend_from_slice(&self.inserted);
        encoded
    }

    #[cfg(test)]
    fn decode(encoded: &[u8]) -> Result<Self, String> {
        if encoded.len() < 36 || &encoded[..4] != DELTA_MAGIC {
            return Err("unsupported delta payload".to_string());
        }
        let read_u64 = |offset: usize| {
            let bytes: [u8; 8] = encoded[offset..offset + 8]
                .try_into()
                .expect("fixed-width field");
            u64::from_le_bytes(bytes)
        };
        let inserted_len = usize::try_from(read_u64(20))
            .map_err(|_| "inserted length does not fit this platform".to_string())?;
        if encoded.len() != 36 + inserted_len {
            return Err("delta payload length is inconsistent".to_string());
        }
        Ok(Self {
            retained_prefix: read_u64(4),
            deleted: read_u64(12),
            inserted: encoded[36..].to_vec(),
            result_len: read_u64(28),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DeltaOp {
    Retain(u64),
    Delete(u64),
    Insert(Vec<u8>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct LineDelta {
    ops: Vec<DeltaOp>,
    result_len: u64,
}

impl LineDelta {
    fn between(base: &[u8], result: &[u8]) -> Self {
        let base_lines = base
            .split_inclusive(|byte| *byte == b'\n')
            .collect::<Vec<_>>();
        let result_lines = result
            .split_inclusive(|byte| *byte == b'\n')
            .collect::<Vec<_>>();
        let mut ops = Vec::new();
        for operation in capture_diff_slices(Algorithm::Myers, &base_lines, &result_lines) {
            match operation {
                DiffOp::Equal { old_index, len, .. } => push_op(
                    &mut ops,
                    DeltaOp::Retain(lines_len(&base_lines[old_index..old_index + len]) as u64),
                ),
                DiffOp::Delete {
                    old_index, old_len, ..
                } => {
                    push_op(
                        &mut ops,
                        DeltaOp::Delete(
                            lines_len(&base_lines[old_index..old_index + old_len]) as u64
                        ),
                    );
                }
                DiffOp::Insert {
                    new_index, new_len, ..
                } => push_op(
                    &mut ops,
                    DeltaOp::Insert(result_lines[new_index..new_index + new_len].concat()),
                ),
                DiffOp::Replace {
                    old_index,
                    old_len,
                    new_index,
                    new_len,
                    ..
                } => {
                    let old_block = base_lines[old_index..old_index + old_len].concat();
                    let new_block = result_lines[new_index..new_index + new_len].concat();
                    let local = Delta::between(&old_block, &new_block);
                    push_op(&mut ops, DeltaOp::Retain(local.retained_prefix));
                    push_op(&mut ops, DeltaOp::Delete(local.deleted));
                    push_op(&mut ops, DeltaOp::Insert(local.inserted));
                    let consumed = local.retained_prefix + local.deleted;
                    push_op(&mut ops, DeltaOp::Retain(old_block.len() as u64 - consumed));
                }
            }
        }
        Self {
            ops,
            result_len: result.len() as u64,
        }
    }

    fn apply(&self, base: &[u8]) -> Result<Vec<u8>, String> {
        let expected_len = usize::try_from(self.result_len)
            .map_err(|_| "delta result length does not fit this platform".to_string())?;
        let mut result = Vec::with_capacity(expected_len);
        let mut cursor = 0_usize;
        for operation in &self.ops {
            match operation {
                DeltaOp::Retain(len) => {
                    let len = usize::try_from(*len)
                        .map_err(|_| "retain length does not fit this platform".to_string())?;
                    let end = cursor
                        .checked_add(len)
                        .filter(|end| *end <= base.len())
                        .ok_or_else(|| "retain exceeds base content".to_string())?;
                    result.extend_from_slice(&base[cursor..end]);
                    cursor = end;
                }
                DeltaOp::Delete(len) => {
                    let len = usize::try_from(*len)
                        .map_err(|_| "delete length does not fit this platform".to_string())?;
                    cursor = cursor
                        .checked_add(len)
                        .filter(|end| *end <= base.len())
                        .ok_or_else(|| "delete exceeds base content".to_string())?;
                }
                DeltaOp::Insert(bytes) => result.extend_from_slice(bytes),
            }
        }
        if cursor != base.len() || result.len() != expected_len {
            return Err(
                "delta did not consume the base or produce the declared result".to_string(),
            );
        }
        Ok(result)
    }

    fn encode(&self) -> Vec<u8> {
        let inserted_bytes = self
            .ops
            .iter()
            .map(|operation| match operation {
                DeltaOp::Insert(bytes) => bytes.len(),
                _ => 0,
            })
            .sum::<usize>();
        let mut encoded = Vec::with_capacity(16 + self.ops.len() * 9 + inserted_bytes);
        encoded.extend_from_slice(LINE_DELTA_MAGIC);
        encoded.extend_from_slice(&self.result_len.to_le_bytes());
        encoded.extend_from_slice(&(self.ops.len() as u32).to_le_bytes());
        for operation in &self.ops {
            match operation {
                DeltaOp::Retain(len) => {
                    encoded.push(0);
                    encoded.extend_from_slice(&len.to_le_bytes());
                }
                DeltaOp::Delete(len) => {
                    encoded.push(1);
                    encoded.extend_from_slice(&len.to_le_bytes());
                }
                DeltaOp::Insert(bytes) => {
                    encoded.push(2);
                    encoded.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
                    encoded.extend_from_slice(bytes);
                }
            }
        }
        encoded
    }

    fn decode(encoded: &[u8]) -> Result<Self, String> {
        if encoded.len() < 16 || &encoded[..4] != LINE_DELTA_MAGIC {
            return Err("unsupported line delta payload".to_string());
        }
        let result_len = u64::from_le_bytes(
            encoded[4..12]
                .try_into()
                .expect("fixed-width result length"),
        );
        let op_count = u32::from_le_bytes(
            encoded[12..16]
                .try_into()
                .expect("fixed-width operation count"),
        ) as usize;
        let mut cursor = 16_usize;
        let mut ops = Vec::with_capacity(op_count);
        for _ in 0..op_count {
            if encoded.len().saturating_sub(cursor) < 9 {
                return Err("truncated line delta operation".to_string());
            }
            let tag = encoded[cursor];
            let len = u64::from_le_bytes(
                encoded[cursor + 1..cursor + 9]
                    .try_into()
                    .expect("fixed-width operation length"),
            );
            cursor += 9;
            match tag {
                0 => push_op(&mut ops, DeltaOp::Retain(len)),
                1 => push_op(&mut ops, DeltaOp::Delete(len)),
                2 => {
                    let len = usize::try_from(len)
                        .map_err(|_| "insert length does not fit this platform".to_string())?;
                    let end = cursor
                        .checked_add(len)
                        .filter(|end| *end <= encoded.len())
                        .ok_or_else(|| "truncated line delta insertion".to_string())?;
                    push_op(&mut ops, DeltaOp::Insert(encoded[cursor..end].to_vec()));
                    cursor = end;
                }
                _ => return Err("unknown line delta operation".to_string()),
            }
        }
        if cursor != encoded.len() {
            return Err("trailing bytes in line delta payload".to_string());
        }
        Ok(Self { ops, result_len })
    }
}

fn lines_len(lines: &[&[u8]]) -> usize {
    lines.iter().map(|line| line.len()).sum()
}

fn push_op(ops: &mut Vec<DeltaOp>, operation: DeltaOp) {
    match (ops.last_mut(), operation) {
        (Some(DeltaOp::Retain(existing)), DeltaOp::Retain(next)) => *existing += next,
        (Some(DeltaOp::Delete(existing)), DeltaOp::Delete(next)) => *existing += next,
        (Some(DeltaOp::Insert(existing)), DeltaOp::Insert(next)) => existing.extend(next),
        (_, operation) => ops.push(operation),
    }
}

#[derive(Default)]
struct DeterministicBytes(u64);

impl DeterministicBytes {
    fn with_seed(seed: u64) -> Self {
        Self(seed)
    }

    fn next(&mut self) -> u8 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        (value >> 24) as u8
    }

    fn fill(&mut self, bytes: &mut [u8]) {
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = if index % 80 == 79 {
                b'\n'
            } else {
                b'a' + self.next() % 26
            };
        }
    }
}

fn line_rich_buffer(len: usize, fill: u8) -> Vec<u8> {
    let mut bytes = vec![fill; len];
    for index in (79..len).step_by(80) {
        bytes[index] = b'\n';
    }
    bytes
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioMetrics {
    name: String,
    revisions: usize,
    final_bytes: usize,
    full_snapshot_bytes: u64,
    single_span_delta_bytes: u64,
    delta_bytes: u64,
    delta_percent_of_full: f64,
    checkpoints: usize,
    zstd_checkpoint_bytes: u64,
    lz4_checkpoint_bytes: u64,
    single_span_encode_nanos: u128,
    selected_delta_encode_nanos: u128,
    max_selected_delta_encode_nanos: u128,
    zstd_checkpoint_micros: u128,
    lz4_checkpoint_micros: u128,
    max_replay_micros: u128,
}

struct ScenarioRun {
    metrics: ScenarioMetrics,
    replay_bound_exceeded: bool,
}

fn run_scenario(
    name: &str,
    initial: Vec<u8>,
    revisions: usize,
    mut mutate: impl FnMut(usize, &mut Vec<u8>),
) -> Result<ScenarioRun, String> {
    let mut current = initial.clone();
    let mut checkpoint = initial;
    let mut replay = Vec::<Vec<u8>>::new();
    let mut full_snapshot_bytes = 0_u64;
    let mut single_span_delta_bytes = 0_u64;
    let mut delta_bytes = 0_u64;
    let mut accumulated_delta_bytes = 0_usize;
    let mut checkpoint_count = 0_usize;
    let mut zstd_checkpoint_bytes = 0_u64;
    let mut lz4_checkpoint_bytes = 0_u64;
    let mut zstd_checkpoint_micros = 0_u128;
    let mut lz4_checkpoint_micros = 0_u128;
    let mut single_span_encode_nanos = 0_u128;
    let mut selected_delta_encode_nanos = 0_u128;
    let mut max_selected_delta_encode_nanos = 0_u128;
    let mut max_replay = Duration::ZERO;
    let mut replay_bound_exceeded = false;

    for revision in 0..revisions {
        let base = current.clone();
        mutate(revision, &mut current);
        let started = Instant::now();
        let single_span = Delta::between(&base, &current).encode();
        single_span_encode_nanos += started.elapsed().as_nanos();
        let started = Instant::now();
        let encoded = LineDelta::between(&base, &current).encode();
        let selected_elapsed = started.elapsed().as_nanos();
        selected_delta_encode_nanos += selected_elapsed;
        max_selected_delta_encode_nanos = max_selected_delta_encode_nanos.max(selected_elapsed);
        let decoded = LineDelta::decode(&encoded)?;
        if decoded.apply(&base)? != current {
            return Err(format!("{name} revision {revision} did not round-trip"));
        }
        full_snapshot_bytes += current.len() as u64;
        single_span_delta_bytes += single_span.len() as u64;
        delta_bytes += encoded.len() as u64;
        accumulated_delta_bytes += encoded.len();
        let ratio = encoded.len() as f64 / current.len().max(1) as f64;
        replay.push(encoded);

        let policy_checkpoint = replay.len() >= MAX_REPLAY_REVISIONS
            || accumulated_delta_bytes >= MAX_ACCUMULATED_DELTA_BYTES
            || ratio >= MAX_DELTA_TO_FULL_RATIO;
        if policy_checkpoint {
            let started = Instant::now();
            let reconstructed = replay_chain(&checkpoint, &replay)?;
            let elapsed = started.elapsed();
            max_replay = max_replay.max(elapsed);
            replay_bound_exceeded |= elapsed > MAX_MEASURED_REPLAY;
            if reconstructed != current {
                return Err(format!("{name} checkpoint reconstruction diverged"));
            }
            let (zstd, zstd_elapsed) = compress("zstd", &["-q", "-3", "-c"], &current)?;
            let (lz4, lz4_elapsed) = compress("lz4", &["-q", "-c"], &current)?;
            zstd_checkpoint_bytes += zstd.len() as u64;
            lz4_checkpoint_bytes += lz4.len() as u64;
            zstd_checkpoint_micros += zstd_elapsed.as_micros();
            lz4_checkpoint_micros += lz4_elapsed.as_micros();
            checkpoint = current.clone();
            replay.clear();
            accumulated_delta_bytes = 0;
            checkpoint_count += 1;
        }
    }

    if !replay.is_empty() {
        let started = Instant::now();
        let reconstructed = replay_chain(&checkpoint, &replay)?;
        let elapsed = started.elapsed();
        max_replay = max_replay.max(elapsed);
        replay_bound_exceeded |= elapsed > MAX_MEASURED_REPLAY;
        if reconstructed != current {
            return Err(format!("{name} final reconstruction diverged"));
        }
    }

    Ok(ScenarioRun {
        metrics: ScenarioMetrics {
            name: name.to_string(),
            revisions,
            final_bytes: current.len(),
            full_snapshot_bytes,
            single_span_delta_bytes,
            delta_bytes,
            delta_percent_of_full: percentage(delta_bytes, full_snapshot_bytes),
            checkpoints: checkpoint_count,
            zstd_checkpoint_bytes,
            lz4_checkpoint_bytes,
            single_span_encode_nanos,
            selected_delta_encode_nanos,
            max_selected_delta_encode_nanos,
            zstd_checkpoint_micros,
            lz4_checkpoint_micros,
            max_replay_micros: max_replay.as_micros(),
        },
        replay_bound_exceeded,
    })
}

fn replay_chain(checkpoint: &[u8], encoded_deltas: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    encoded_deltas
        .iter()
        .try_fold(checkpoint.to_vec(), |base, encoded| {
            LineDelta::decode(encoded)?.apply(&base)
        })
}

fn percentage(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        ((part as f64 / whole as f64) * 10_000.0).round() / 100.0
    }
}

fn compress(program: &str, args: &[&str], bytes: &[u8]) -> Result<(Vec<u8>, Duration), String> {
    let started = Instant::now();
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("start {program}: {error}"))?;
    child
        .stdin
        .take()
        .expect("piped stdin")
        .write_all(bytes)
        .map_err(|error| format!("write {program} input: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("wait for {program}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok((output.stdout, started.elapsed()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SqliteMetrics {
    synchronous: String,
    commits: usize,
    payload_bytes: usize,
    elapsed_millis: u128,
    average_commit_micros: u128,
}

fn benchmark_sqlite(
    synchronous: &str,
    commits: usize,
    payload_bytes: usize,
) -> Result<SqliteMetrics, String> {
    let database_path = temporary_database_path(&format!("{synchronous}-{payload_bytes}"));
    let connection = Connection::open(&database_path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(&format!(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA synchronous={synchronous};
             PRAGMA busy_timeout=5000;
             PRAGMA wal_autocheckpoint=1000;
             CREATE TABLE records (
               record_id TEXT PRIMARY KEY,
               parent_id TEXT,
               payload BLOB NOT NULL,
               content_hash TEXT NOT NULL
             );"
        ))
        .map_err(|error| error.to_string())?;
    let payload = vec![b'x'; payload_bytes];
    let started = Instant::now();
    for index in 0..commits {
        connection
            .execute(
                "INSERT INTO records(record_id, parent_id, payload, content_hash)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    format!("revision-{index:05}"),
                    (index > 0).then(|| format!("revision-{:05}", index - 1)),
                    &payload,
                    blake3::hash(&payload).to_hex().to_string(),
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    let elapsed = started.elapsed();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| error.to_string())?;
    drop(connection);
    remove_sqlite_files(&database_path);
    Ok(SqliteMetrics {
        synchronous: synchronous.to_string(),
        commits,
        payload_bytes,
        elapsed_millis: elapsed.as_millis(),
        average_commit_micros: elapsed.as_micros() / commits as u128,
    })
}

fn temporary_database_path(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "gneauxghts-note-timeline-spike-{}-{label}-{unique}.sqlite3",
        std::process::id()
    ))
}

fn remove_sqlite_files(database_path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let candidate = PathBuf::from(format!("{}{suffix}", database_path.display()));
        let _ = std::fs::remove_file(candidate);
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImmutableRecord {
    record_id: String,
    record_kind: String,
    parent_id: Option<String>,
    payload_version: u32,
    payload_base64: String,
    result_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportMetrics {
    records: usize,
    record_kinds: Vec<String>,
    fixture_bytes: usize,
    final_hash: String,
    reconstruction_ignores_row_order: bool,
    fixture_round_trips: bool,
    verified_parent_references: bool,
    verified_content_hashes: usize,
    verified_utf8: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PagingMetrics {
    records_across_vault: usize,
    revisions_per_note: usize,
    page_size: usize,
    first_page_micros: u128,
    deep_page_micros: u128,
}

fn benchmark_timeline_paging() -> Result<PagingMetrics, String> {
    const NOTE_COUNT: usize = 100;
    const REVISIONS_PER_NOTE: usize = 1_000;
    const PAGE_SIZE: usize = 100;

    let mut connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE revisions (
               record_id TEXT PRIMARY KEY,
               note_id TEXT NOT NULL,
               committed_at INTEGER NOT NULL,
               summary TEXT NOT NULL
             );
             CREATE INDEX revisions_by_note_time
               ON revisions(note_id, committed_at DESC, record_id DESC);",
        )
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    {
        let mut insert = transaction
            .prepare(
                "INSERT INTO revisions(record_id, note_id, committed_at, summary)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|error| error.to_string())?;
        for note in 0..NOTE_COUNT {
            for revision in 0..REVISIONS_PER_NOTE {
                insert
                    .execute(params![
                        format!("revision-{note:03}-{revision:05}"),
                        format!("note-{note:03}"),
                        revision as i64,
                        "8 chars inserted",
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;

    let page = |offset: usize| -> Result<(u128, usize), String> {
        let started = Instant::now();
        let mut statement = connection
            .prepare(
                "SELECT record_id FROM revisions
                 WHERE note_id = ?1
                 ORDER BY committed_at DESC, record_id DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params!["note-042", PAGE_SIZE as i64, offset as i64],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok((started.elapsed().as_micros(), rows.len()))
    };
    let (first_page_micros, first_count) = page(0)?;
    let (deep_page_micros, deep_count) = page(900)?;
    if first_count != PAGE_SIZE || deep_count != PAGE_SIZE {
        return Err("timeline paging returned an incomplete page".to_string());
    }
    Ok(PagingMetrics {
        records_across_vault: NOTE_COUNT * REVISIONS_PER_NOTE,
        revisions_per_note: REVISIONS_PER_NOTE,
        page_size: PAGE_SIZE,
        first_page_micros,
        deep_page_micros,
    })
}

fn migration_shape_fixture() -> Result<ExportMetrics, String> {
    let states = [
        b"# Timeline\n\nFirst state".to_vec(),
        b"# Timeline\n\nFirst durable state".to_vec(),
        b"# Timeline\n\nFinal durable state\n".to_vec(),
    ];
    let mut records = Vec::new();
    let mut base = Vec::new();
    for (index, state) in states.iter().enumerate() {
        let delta = LineDelta::between(&base, state).encode();
        records.push(ImmutableRecord {
            record_id: format!("revision-{:02}", index + 1),
            record_kind: "revision".to_string(),
            parent_id: (index > 0).then(|| format!("revision-{index:02}")),
            payload_version: 1,
            payload_base64: BASE64.encode(delta),
            result_hash: Some(blake3::hash(state).to_hex().to_string()),
        });
        base = state.clone();
    }
    records.extend([
        ImmutableRecord {
            record_id: "checkpoint-01".to_string(),
            record_kind: "checkpoint".to_string(),
            parent_id: Some("revision-03".to_string()),
            payload_version: 1,
            payload_base64: BASE64.encode(&states[2]),
            result_hash: Some(blake3::hash(&states[2]).to_hex().to_string()),
        },
        ImmutableRecord {
            record_id: "lifecycle-01".to_string(),
            record_kind: "lifecycleEvent".to_string(),
            parent_id: Some("revision-03".to_string()),
            payload_version: 1,
            payload_base64: BASE64.encode(br#"{"kind":"renamed","title":"Timeline"}"#),
            result_hash: None,
        },
        ImmutableRecord {
            record_id: "label-01".to_string(),
            record_kind: "namedRevision".to_string(),
            parent_id: Some("revision-02".to_string()),
            payload_version: 1,
            payload_base64: BASE64.encode(br#"{"name":"Before review"}"#),
            result_hash: None,
        },
        ImmutableRecord {
            record_id: "deletion-01".to_string(),
            record_kind: "deletionMarker".to_string(),
            parent_id: Some("revision-03".to_string()),
            payload_version: 1,
            payload_base64: BASE64.encode(br#"{"scope":"note-01","generation":2}"#),
            result_hash: None,
        },
    ]);

    let connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE records (
               row_id INTEGER PRIMARY KEY AUTOINCREMENT,
               record_id TEXT UNIQUE NOT NULL,
               record_kind TEXT NOT NULL,
               parent_id TEXT,
               payload_version INTEGER NOT NULL,
               payload_base64 TEXT NOT NULL,
               result_hash TEXT
             );",
        )
        .map_err(|error| error.to_string())?;
    for index in [6_usize, 2, 4, 0, 5, 1, 3] {
        let record = &records[index];
        connection
            .execute(
                "INSERT INTO records(
                   record_id, record_kind, parent_id, payload_version, payload_base64, result_hash
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    record.record_id,
                    record.record_kind,
                    record.parent_id,
                    record.payload_version,
                    record.payload_base64,
                    record.result_hash,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    let mut statement = connection
        .prepare(
            "SELECT record_id, record_kind, parent_id, payload_version, payload_base64, result_hash
             FROM records ORDER BY row_id DESC",
        )
        .map_err(|error| error.to_string())?;
    let exported = statement
        .query_map([], |row| {
            Ok(ImmutableRecord {
                record_id: row.get(0)?,
                record_kind: row.get(1)?,
                parent_id: row.get(2)?,
                payload_version: row.get(3)?,
                payload_base64: row.get(4)?,
                result_hash: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let fixture = serde_json::to_vec_pretty(&exported).map_err(|error| error.to_string())?;
    let fixture_records: Vec<ImmutableRecord> =
        serde_json::from_slice(&fixture).map_err(|error| error.to_string())?;
    let source_by_id = records
        .iter()
        .cloned()
        .map(|record| (record.record_id.clone(), record))
        .collect::<HashMap<_, _>>();
    let by_id = fixture_records
        .into_iter()
        .map(|record| (record.record_id.clone(), record))
        .collect::<HashMap<_, _>>();
    if source_by_id != by_id {
        return Err("immutable fixture changed record meaning during export".to_string());
    }
    if by_id.values().any(|record| record.payload_version != 1) {
        return Err("immutable fixture contains an unsupported payload version".to_string());
    }
    for record in by_id.values() {
        if let Some(parent_id) = &record.parent_id {
            if !by_id.contains_key(parent_id) {
                return Err(format!(
                    "{} references missing parent {parent_id}",
                    record.record_id
                ));
            }
        }
    }
    let final_id = "revision-03";
    let mut chain = Vec::new();
    let mut cursor = Some(final_id.to_string());
    while let Some(record_id) = cursor {
        let record = by_id
            .get(&record_id)
            .ok_or_else(|| format!("missing exported record {record_id}"))?;
        chain.push(record.clone());
        cursor = record.parent_id.clone();
    }
    chain.reverse();
    let mut verified_content_hashes = 0_usize;
    let reconstructed = chain.iter().try_fold(Vec::new(), |base, record| {
        let encoded = BASE64
            .decode(&record.payload_base64)
            .map_err(|error| error.to_string())?;
        let result = LineDelta::decode(&encoded)?.apply(&base)?;
        String::from_utf8(result.clone()).map_err(|error| {
            format!("{} reconstructed invalid UTF-8: {error}", record.record_id)
        })?;
        let hash = blake3::hash(&result).to_hex().to_string();
        if record.result_hash.as_deref() != Some(hash.as_str()) {
            return Err(format!("hash mismatch for {}", record.record_id));
        }
        verified_content_hashes += 1;
        Ok(result)
    })?;
    for record in by_id
        .values()
        .filter(|record| record.result_hash.is_some() && record.record_kind != "revision")
    {
        if record.record_kind != "checkpoint" {
            return Err(format!(
                "cannot verify hashed record kind {}",
                record.record_kind
            ));
        }
        let content = BASE64
            .decode(&record.payload_base64)
            .map_err(|error| error.to_string())?;
        String::from_utf8(content.clone())
            .map_err(|error| format!("{} contains invalid UTF-8: {error}", record.record_id))?;
        let hash = blake3::hash(&content).to_hex().to_string();
        if record.result_hash.as_deref() != Some(hash.as_str()) {
            return Err(format!("hash mismatch for {}", record.record_id));
        }
        verified_content_hashes += 1;
    }
    let mut record_kinds = by_id
        .values()
        .map(|record| record.record_kind.clone())
        .collect::<Vec<_>>();
    record_kinds.sort();
    record_kinds.dedup();
    Ok(ExportMetrics {
        records: records.len(),
        record_kinds,
        fixture_bytes: fixture.len(),
        final_hash: blake3::hash(&reconstructed).to_hex().to_string(),
        reconstruction_ignores_row_order: reconstructed == states[2],
        fixture_round_trips: source_by_id == by_id,
        verified_parent_references: true,
        verified_content_hashes,
        verified_utf8: true,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpikeReport {
    delta_codec: &'static str,
    compression: &'static str,
    checkpoint_policy: CheckpointPolicy,
    scenarios: Vec<ScenarioMetrics>,
    sqlite: Vec<SqliteMetrics>,
    paging: PagingMetrics,
    migration_shape: ExportMetrics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointPolicy {
    max_replay_revisions: usize,
    max_accumulated_delta_bytes: usize,
    max_delta_to_full_ratio: f64,
    max_measured_replay_millis: u128,
}

fn main() -> Result<(), String> {
    let mut scenarios = Vec::new();
    let mut replay_bound_exceeded = false;

    let realistic = run_scenario(
        "realistic-typing",
        b"# Working note\n\n".to_vec(),
        2_000,
        |index, note| {
            if index % 17 == 0 && note.len() > 40 {
                let offset = 20 + (index * 31 % (note.len() - 28));
                note.splice(offset..offset + 8, format!("edit{index:04}").bytes());
            } else {
                note.extend_from_slice(format!("word{index} ").as_bytes());
            }
        },
    )?;
    replay_bound_exceeded |= realistic.replay_bound_exceeded;
    scenarios.push(realistic.metrics);

    let repeated_megabyte = vec![b'a'; 1024 * 1024];
    let repeated = run_scenario(
        "one-megabyte-repetitive",
        repeated_megabyte,
        1_000,
        |index, note| {
            let offset = (index * 7919) % (note.len() - 16);
            note.splice(offset..offset + 16, format!("repeat{index:010}").bytes());
        },
    )?;
    replay_bound_exceeded |= repeated.replay_bound_exceeded;
    scenarios.push(repeated.metrics);

    let mut random_source = DeterministicBytes::with_seed(0x5eed_cafe_dead_beef);
    let mut random_megabyte = vec![0_u8; 1024 * 1024];
    random_source.fill(&mut random_megabyte);
    let random_edits = run_scenario(
        "one-megabyte-random",
        random_megabyte,
        1_000,
        |index, note| {
            let offset = (index * 6151) % (note.len() - 16);
            let replacement = format!("random{index:010}");
            note.splice(offset..offset + 16, replacement.bytes());
        },
    )?;
    replay_bound_exceeded |= random_edits.replay_bound_exceeded;
    scenarios.push(random_edits.metrics);

    let multi_hunk = run_scenario(
        "distant-multi-hunk-edits",
        line_rich_buffer(256 * 1024, b'm'),
        500,
        |index, note| {
            let first = 64 + (index % 128);
            let last = note.len() - 192 + (index % 128);
            note.splice(first..first + 8, format!("A{index:07}").bytes());
            note.splice(last..last + 8, format!("Z{index:07}").bytes());
        },
    )?;
    replay_bound_exceeded |= multi_hunk.replay_bound_exceeded;
    scenarios.push(multi_hunk.metrics);

    let complete = run_scenario(
        "complete-replacements",
        vec![b'x'; 128 * 1024],
        200,
        |index, note| {
            note.clear();
            note.resize(128 * 1024, b'a');
            DeterministicBytes::with_seed(index as u64 + 1).fill(note);
        },
    )?;
    replay_bound_exceeded |= complete.replay_bound_exceeded;
    scenarios.push(complete.metrics);

    let long_replay = run_scenario(
        "long-replay",
        vec![b'l'; 64 * 1024],
        10_000,
        |index, note| {
            let offset = (index * 3571) % (note.len() - 8);
            note.splice(offset..offset + 8, format!("{index:08}").bytes());
        },
    )?;
    replay_bound_exceeded |= long_replay.replay_bound_exceeded;
    scenarios.push(long_replay.metrics);

    if replay_bound_exceeded {
        return Err("selected checkpoint policy exceeded the 50 ms replay guard".to_string());
    }

    let report = SpikeReport {
        delta_codec: "similar 3.2 bounded Myers line diff with single-span byte refinement and versioned retain/delete/insert payloads (NTL1)",
        compression: "zstd level 3 for full checkpoints; raw deltas",
        checkpoint_policy: CheckpointPolicy {
            max_replay_revisions: MAX_REPLAY_REVISIONS,
            max_accumulated_delta_bytes: MAX_ACCUMULATED_DELTA_BYTES,
            max_delta_to_full_ratio: MAX_DELTA_TO_FULL_RATIO,
            max_measured_replay_millis: MAX_MEASURED_REPLAY.as_millis(),
        },
        scenarios,
        sqlite: vec![
            benchmark_sqlite("FULL", 250, 1024)?,
            benchmark_sqlite("NORMAL", 250, 1024)?,
            benchmark_sqlite("FULL", 100, 64 * 1024)?,
            benchmark_sqlite("FULL", 20, 1024 * 1024)?,
        ],
        paging: benchmark_timeline_paging()?,
        migration_shape: migration_shape_fixture()?,
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delta_round_trips_a_known_multiline_edit() {
        let base = b"# Note\n\nAlpha beta gamma\n";
        let result = b"# Note\n\nAlpha revised gamma\nAdded\n";
        let encoded = LineDelta::between(base, result).encode();
        let decoded = LineDelta::decode(&encoded).expect("decode delta");

        assert_eq!(decoded.apply(base).expect("apply delta"), result);
        assert_eq!(&encoded[..4], b"NTL1");
    }

    #[test]
    fn delta_round_trips_multibyte_utf8_without_splitting_code_points() {
        let base = "# Café ☕️\n\n今日は世界\n";
        let result = "# Café revisited ☕️\n\n今日は、世界 🌍\n";
        let encoded = LineDelta::between(base.as_bytes(), result.as_bytes()).encode();
        let reconstructed = LineDelta::decode(&encoded)
            .expect("decode UTF-8 delta")
            .apply(base.as_bytes())
            .expect("apply UTF-8 delta");

        assert_eq!(
            String::from_utf8(reconstructed).expect("valid UTF-8"),
            result
        );
    }

    #[test]
    fn line_delta_keeps_distant_edits_local() {
        let base = ("x".repeat(78) + "\n").repeat(840).into_bytes();
        let mut result = base.clone();
        result[64..72].copy_from_slice(b"first---");
        let end = result.len();
        result[end - 72..end - 64].copy_from_slice(b"last----");

        let single_span = Delta::between(&base, &result).encode();
        let line_delta = LineDelta::between(&base, &result).encode();

        assert!(line_delta.len() < 256);
        assert!(single_span.len() > 60 * 1024);
        assert_eq!(
            Delta::decode(&single_span)
                .expect("decode single-span delta")
                .apply(&base)
                .expect("apply single-span delta"),
            result
        );
        assert_eq!(
            LineDelta::decode(&line_delta)
                .expect("decode line delta")
                .apply(&base)
                .expect("apply line delta"),
            result
        );
    }

    #[test]
    fn migration_fixture_reconstructs_without_sqlite_row_order() {
        let fixture = migration_shape_fixture().expect("export fixture");

        assert_eq!(fixture.records, 7);
        assert_eq!(
            fixture.record_kinds,
            [
                "checkpoint",
                "deletionMarker",
                "lifecycleEvent",
                "namedRevision",
                "revision",
            ]
        );
        assert!(fixture.reconstruction_ignores_row_order);
        assert!(fixture.fixture_round_trips);
        assert!(fixture.verified_parent_references);
        assert_eq!(fixture.verified_content_hashes, 4);
        assert!(fixture.verified_utf8);
        assert_eq!(fixture.final_hash.len(), 64);
    }
}
