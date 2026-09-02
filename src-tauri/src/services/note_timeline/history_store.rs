//! Private SQLite persistence and revision codec for `NoteTimeline`.
//!
//! SQL, WAL policy, row ordering, and checkpoint placement intentionally stop
//! here. The parent module exposes only storage-neutral domain records.

use super::{
    BaselineInitializationPhase, BaselineInitializationProgress, DeletionMarker,
    DeletionOperationIdentity, DeletionScope, HistoryClearBaseline, HistoryDeletionKind,
    HistoryIntentIdentity, HistoryStorageUsage, LifecycleEventHeader, LifecycleEventIdentity,
    LifecycleEventKind, MutationSource, NoteBaselineInitializationState, NoteIdentity,
    NoteRevisionHeader, PayloadVersion, ReconstructedNoteRevision, RevisionIdentity,
    RevisionTimeEvidence, TimelineRecordIdentity, VaultObservation, VaultObservationKind,
    VaultObservationSource, BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, DiffOp};
use std::{
    collections::BTreeMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const HISTORY_DATABASE_FILE_NAME: &str = "history.sqlite3";
const HISTORY_OBSERVATIONS_FILE_NAME: &str = "note-timeline-history-observations.json";
pub(super) const HISTORY_FORMAT: &str = "sqlite-v1";
pub(super) const INITIAL_HISTORY_GENERATION: u64 = 1;
const HISTORY_SCHEMA_VERSION: u64 = 6;
const AUTHORED_STATE_MAGIC: &[u8; 4] = b"NAS1";
const LINE_DELTA_MAGIC: &[u8; 4] = b"NTL1";
const CHECKPOINT_PAYLOAD_VERSION: i64 = 1;
const DELTA_PAYLOAD_VERSION: i64 = 1;
const MAX_REPLAY_REVISIONS: u64 = 128;
const MAX_ACCUMULATED_DELTA_BYTES: u64 = 256 * 1024;
const MAX_DELTA_TO_FULL_RATIO: f64 = 0.65;
const MAX_MEASURED_REPLAY: Duration = Duration::from_millis(50);
const MAX_COMPACTION_PAGES_PER_PASS: u64 = 256;

static HISTORY_OBSERVATIONS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static HISTORY_STORE_OPEN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryObservations {
    #[serde(default)]
    vaults: BTreeMap<String, ObservedHistorySelection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservedHistorySelection {
    history_format: String,
    generation: u64,
    #[serde(default)]
    allow_missing_store: bool,
    last_reset: Option<PersistedHistoryReset>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedHistoryReset {
    operation_id: String,
    previous_generation: u64,
    generation: u64,
    reset_at_millis: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PublicationIntentKind {
    Create,
    Update,
}

pub(super) struct RetainedObservation {
    pub(super) sequence: i64,
    pub(super) observation: VaultObservation,
}

pub(super) struct BaselineSeed<'a> {
    pub(super) path: &'a Path,
    pub(super) canonical_markdown: &'a str,
    pub(super) known_since_millis: u64,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FaultPoint {
    Prepare,
    Finalize,
    Recover,
    Baseline,
    Deletion,
    Migration,
}

#[cfg(test)]
static NEXT_FAULT: std::sync::Mutex<Option<FaultPoint>> = std::sync::Mutex::new(None);

#[cfg(test)]
pub(super) fn inject_fault_once(point: FaultPoint) {
    *NEXT_FAULT.lock().expect("history fault lock") = Some(point);
}

#[cfg(test)]
pub(super) fn prepared_intent_count(status: &str) -> u64 {
    open_store()
        .expect("open history store")
        .query_row(
            "SELECT COUNT(*) FROM prepared_intents WHERE status = ?1",
            params![status],
            |row| row.get(0),
        )
        .expect("count prepared history intents")
}

#[cfg(test)]
pub(super) fn replace_revision_source(note_id: &NoteIdentity, source: &str) {
    open_store()
        .expect("open history store")
        .execute(
            "UPDATE revisions SET source = ?1 WHERE note_id = ?2",
            params![source, note_id.as_str()],
        )
        .expect("replace stored revision source");
}

#[cfg(test)]
pub(super) fn replace_lifecycle_kind(note_id: &NoteIdentity, kind: &str) {
    open_store()
        .expect("open history store")
        .execute(
            "UPDATE lifecycle_events SET kind = ?1 WHERE note_id = ?2",
            params![kind, note_id.as_str()],
        )
        .expect("replace stored lifecycle kind");
}

#[cfg(test)]
pub(super) fn replace_history_generation(generation: u64) {
    Connection::open(
        crate::state::vault_data_dir()
            .expect("vault data directory")
            .join(HISTORY_DATABASE_FILE_NAME),
    )
    .expect("open history store directly")
    .execute(
        "UPDATE history_metadata SET history_generation = ?1 WHERE singleton = 1",
        params![generation],
    )
    .expect("replace history generation");
}

#[cfg(test)]
pub(super) fn remove_history_store() {
    let data_dir = crate::state::vault_data_dir().expect("vault data directory");
    for path in [
        data_dir.join(HISTORY_DATABASE_FILE_NAME),
        data_dir.join(format!("{HISTORY_DATABASE_FILE_NAME}-wal")),
        data_dir.join(format!("{HISTORY_DATABASE_FILE_NAME}-shm")),
    ] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("remove history store fixture: {error}"),
        }
    }
}

#[cfg(test)]
pub(super) fn history_store_exists() -> bool {
    crate::state::vault_data_dir()
        .expect("vault data directory")
        .join(HISTORY_DATABASE_FILE_NAME)
        .is_file()
}

#[cfg(test)]
pub(super) fn auto_vacuum_mode_for_test() -> u64 {
    open_store()
        .expect("open history store")
        .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
        .expect("read history auto-vacuum mode")
}

#[cfg(test)]
pub(super) fn baseline_failure_note_ids() -> Vec<String> {
    let connection = open_store().expect("open history store");
    let mut statement = connection
        .prepare("SELECT note_id FROM baseline_initialization_failures ORDER BY note_id")
        .expect("prepare baseline failure query");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("query baseline failures")
        .collect::<Result<Vec<_>, _>>()
        .expect("read baseline failures")
}

#[cfg(test)]
pub(super) fn seed_revision_dependents_for_test(revision_id: &RevisionIdentity) {
    let connection = open_store().expect("open history store");
    connection
        .execute(
            "INSERT INTO named_revision_labels (label_id, revision_id, label)
             VALUES ('test-label', ?1, 'Milestone')",
            params![revision_id.0],
        )
        .expect("seed Named Revision label");
    connection
        .execute(
            "INSERT INTO revision_citations (citation_id, revision_id, current_excerpt)
             VALUES ('test-citation', ?1, 'Deleted prose projection')",
            params![revision_id.0],
        )
        .expect("seed Revision Citation projection");
}

#[cfg(test)]
pub(super) fn revision_dependent_count_for_test(note_id: &NoteIdentity) -> u64 {
    open_store()
        .expect("open history store")
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM named_revision_labels labels
                JOIN revisions revisions ON revisions.revision_id = labels.revision_id
                WHERE revisions.note_id = ?1)
             + (SELECT COUNT(*) FROM revision_citations citations
                JOIN revisions revisions ON revisions.revision_id = citations.revision_id
                WHERE revisions.note_id = ?1)",
            params![note_id.as_str()],
            |row| row.get(0),
        )
        .expect("count revision dependents")
}

#[cfg(test)]
pub(super) fn replace_lifecycle_payload_version(note_id: &NoteIdentity, version: i64) {
    open_store()
        .expect("open history store")
        .execute(
            "UPDATE lifecycle_events SET payload_version = ?1 WHERE note_id = ?2",
            params![version, note_id.as_str()],
        )
        .expect("replace stored lifecycle payload version");
}

#[cfg(test)]
pub(super) fn replace_revision_payload_version(note_id: &NoteIdentity, version: i64) {
    open_store()
        .expect("open history store")
        .execute(
            "UPDATE revisions SET payload_version = ?1 WHERE note_id = ?2",
            params![version, note_id.as_str()],
        )
        .expect("replace stored revision payload version");
}

#[cfg(test)]
pub(super) fn replace_revision_predecessor(
    note_id: &NoteIdentity,
    kind: Option<&str>,
    identity: Option<&str>,
) {
    open_store()
        .expect("open history store")
        .execute(
            "UPDATE revisions SET predecessor_kind = ?1, predecessor_id = ?2
             WHERE note_id = ?3",
            params![kind, identity, note_id.as_str()],
        )
        .expect("replace stored revision predecessor");
}

#[cfg(test)]
fn take_fault(point: FaultPoint) -> bool {
    let mut fault = NEXT_FAULT.lock().expect("history fault lock");
    if *fault == Some(point) {
        *fault = None;
        true
    } else {
        false
    }
}

#[cfg(not(test))]
fn take_prepare_fault() -> bool {
    false
}

#[cfg(test)]
fn take_prepare_fault() -> bool {
    take_fault(FaultPoint::Prepare)
}

#[cfg(not(test))]
fn take_finalize_fault() -> bool {
    false
}

#[cfg(test)]
fn take_finalize_fault() -> bool {
    take_fault(FaultPoint::Finalize)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AuthoredState {
    unmanaged_frontmatter: Option<String>,
    body: String,
}

impl AuthoredState {
    fn from_canonical(markdown: &str) -> Self {
        let Some(frontmatter) = ExactFrontmatter::parse(markdown) else {
            return Self {
                unmanaged_frontmatter: None,
                body: markdown.to_string(),
            };
        };
        Self {
            unmanaged_frontmatter: remove_managed_frontmatter(frontmatter.raw),
            body: frontmatter.body.to_string(),
        }
    }

    fn encode(&self) -> Vec<u8> {
        let frontmatter = self.unmanaged_frontmatter.as_deref().map(str::as_bytes);
        let mut encoded =
            Vec::with_capacity(20 + frontmatter.map_or(0, <[u8]>::len) + self.body.len());
        encoded.extend_from_slice(AUTHORED_STATE_MAGIC);
        encoded.extend_from_slice(
            &frontmatter
                .map(|bytes| bytes.len() as u64)
                .unwrap_or(u64::MAX)
                .to_le_bytes(),
        );
        encoded.extend_from_slice(&(self.body.len() as u64).to_le_bytes());
        if let Some(frontmatter) = frontmatter {
            encoded.extend_from_slice(frontmatter);
        }
        encoded.extend_from_slice(self.body.as_bytes());
        encoded
    }

    fn decode(encoded: &[u8]) -> Result<Self, String> {
        if encoded.len() < 20 || &encoded[..4] != AUTHORED_STATE_MAGIC {
            return Err("Unsupported authored-state payload".to_string());
        }
        let frontmatter_len = read_u64(encoded, 4)?;
        let body_len = usize::try_from(read_u64(encoded, 12)?)
            .map_err(|_| "Authored body length exceeds this platform".to_string())?;
        let mut cursor = 20usize;
        let unmanaged_frontmatter = if frontmatter_len == u64::MAX {
            None
        } else {
            let len = usize::try_from(frontmatter_len)
                .map_err(|_| "Authored frontmatter length exceeds this platform".to_string())?;
            let end = cursor
                .checked_add(len)
                .filter(|end| *end <= encoded.len())
                .ok_or_else(|| "Authored frontmatter payload is truncated".to_string())?;
            let value = std::str::from_utf8(&encoded[cursor..end])
                .map_err(|error| format!("Authored frontmatter is not UTF-8: {error}"))?
                .to_string();
            cursor = end;
            Some(value)
        };
        let end = cursor
            .checked_add(body_len)
            .filter(|end| *end == encoded.len())
            .ok_or_else(|| "Authored body payload length is inconsistent".to_string())?;
        let body = std::str::from_utf8(&encoded[cursor..end])
            .map_err(|error| format!("Authored body is not UTF-8: {error}"))?
            .to_string();
        Ok(Self {
            unmanaged_frontmatter,
            body,
        })
    }
}

struct ExactFrontmatter<'a> {
    raw: &'a str,
    body: &'a str,
}

impl<'a> ExactFrontmatter<'a> {
    fn parse(markdown: &'a str) -> Option<Self> {
        let opening_end = line_end(markdown, 0)?;
        if markdown[..line_content_end(markdown, 0, opening_end)].trim_end_matches('\r') != "---" {
            return None;
        }
        let mut cursor = opening_end;
        while cursor < markdown.len() {
            let end = line_end(markdown, cursor).unwrap_or(markdown.len());
            let content_end = line_content_end(markdown, cursor, end);
            if markdown[cursor..content_end].trim_end_matches('\r') == "---" {
                let mut body_start = end;
                if markdown[body_start..].starts_with("\r\n") {
                    body_start += 2;
                } else if markdown[body_start..].starts_with('\n') {
                    body_start += 1;
                }
                return Some(Self {
                    raw: &markdown[opening_end..cursor],
                    body: &markdown[body_start..],
                });
            }
            cursor = end;
        }
        None
    }
}

fn line_end(value: &str, start: usize) -> Option<usize> {
    value[start..]
        .find('\n')
        .map(|offset| start + offset + 1)
        .or_else(|| (start < value.len()).then_some(value.len()))
}

fn line_content_end(value: &str, start: usize, end: usize) -> usize {
    let without_newline = if value.as_bytes().get(end.saturating_sub(1)) == Some(&b'\n') {
        end - 1
    } else {
        end
    };
    if without_newline > start && value.as_bytes().get(without_newline - 1) == Some(&b'\r') {
        without_newline - 1
    } else {
        without_newline
    }
}

fn remove_managed_frontmatter(raw: &str) -> Option<String> {
    let mut preserved = String::new();
    let mut cursor = 0usize;
    while cursor < raw.len() {
        let end = line_end(raw, cursor).unwrap_or(raw.len());
        let content_end = line_content_end(raw, cursor, end);
        let line = &raw[cursor..content_end];
        if !starts_with_indentation(line) && line.trim() == "gneauxghts:" {
            cursor = end;
            while cursor < raw.len() {
                let candidate_end = line_end(raw, cursor).unwrap_or(raw.len());
                let candidate_content_end = line_content_end(raw, cursor, candidate_end);
                let candidate = &raw[cursor..candidate_content_end];
                if !candidate.trim().is_empty() && !starts_with_indentation(candidate) {
                    break;
                }
                cursor = candidate_end;
            }
            continue;
        }
        preserved.push_str(&raw[cursor..end]);
        cursor = end;
    }
    (!preserved.trim().is_empty()).then_some(preserved)
}

fn starts_with_indentation(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
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
                } => push_op(
                    &mut ops,
                    DeltaOp::Delete(lines_len(&base_lines[old_index..old_index + old_len]) as u64),
                ),
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
                    let old = base_lines[old_index..old_index + old_len].concat();
                    let new = result_lines[new_index..new_index + new_len].concat();
                    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
                    let shared = old.len().min(new.len()).saturating_sub(prefix);
                    let suffix = old[prefix..]
                        .iter()
                        .rev()
                        .zip(new[prefix..].iter().rev())
                        .take(shared)
                        .take_while(|(a, b)| a == b)
                        .count();
                    push_op(&mut ops, DeltaOp::Retain(prefix as u64));
                    push_op(
                        &mut ops,
                        DeltaOp::Delete((old.len() - prefix - suffix) as u64),
                    );
                    push_op(
                        &mut ops,
                        DeltaOp::Insert(new[prefix..new.len() - suffix].to_vec()),
                    );
                    push_op(&mut ops, DeltaOp::Retain(suffix as u64));
                }
            }
        }
        Self {
            ops,
            result_len: result.len() as u64,
        }
    }

    fn encode(&self) -> Vec<u8> {
        let mut encoded = Vec::new();
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
            return Err("Unsupported line-delta payload".to_string());
        }
        let result_len = read_u64(encoded, 4)?;
        let op_count = u32::from_le_bytes(
            encoded[12..16]
                .try_into()
                .map_err(|_| "Truncated line-delta header".to_string())?,
        ) as usize;
        let mut cursor = 16usize;
        let mut ops = Vec::with_capacity(op_count);
        for _ in 0..op_count {
            if encoded.len().saturating_sub(cursor) < 9 {
                return Err("Truncated line-delta operation".to_string());
            }
            let tag = encoded[cursor];
            let len = read_u64(encoded, cursor + 1)?;
            cursor += 9;
            match tag {
                0 => push_op(&mut ops, DeltaOp::Retain(len)),
                1 => push_op(&mut ops, DeltaOp::Delete(len)),
                2 => {
                    let len = usize::try_from(len)
                        .map_err(|_| "Delta insertion exceeds this platform".to_string())?;
                    let end = cursor
                        .checked_add(len)
                        .filter(|end| *end <= encoded.len())
                        .ok_or_else(|| "Truncated line-delta insertion".to_string())?;
                    push_op(&mut ops, DeltaOp::Insert(encoded[cursor..end].to_vec()));
                    cursor = end;
                }
                _ => return Err("Unknown line-delta operation".to_string()),
            }
        }
        if cursor != encoded.len() {
            return Err("Trailing bytes in line-delta payload".to_string());
        }
        Ok(Self { ops, result_len })
    }

    fn apply(&self, base: &[u8]) -> Result<Vec<u8>, String> {
        let expected_len = usize::try_from(self.result_len)
            .map_err(|_| "Delta result exceeds this platform".to_string())?;
        let mut result = Vec::with_capacity(expected_len);
        let mut cursor = 0usize;
        for operation in &self.ops {
            match operation {
                DeltaOp::Retain(len) => {
                    let len = usize::try_from(*len)
                        .map_err(|_| "Delta retain exceeds this platform".to_string())?;
                    let end = cursor
                        .checked_add(len)
                        .filter(|end| *end <= base.len())
                        .ok_or_else(|| "Delta retain exceeds base content".to_string())?;
                    result.extend_from_slice(&base[cursor..end]);
                    cursor = end;
                }
                DeltaOp::Delete(len) => {
                    let len = usize::try_from(*len)
                        .map_err(|_| "Delta delete exceeds this platform".to_string())?;
                    cursor = cursor
                        .checked_add(len)
                        .filter(|end| *end <= base.len())
                        .ok_or_else(|| "Delta delete exceeds base content".to_string())?;
                }
                DeltaOp::Insert(bytes) => result.extend_from_slice(bytes),
            }
        }
        if cursor != base.len() || result.len() != expected_len {
            return Err(
                "Delta did not consume its base or produce its declared result".to_string(),
            );
        }
        Ok(result)
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

fn observation_source_value(source: VaultObservationSource) -> &'static str {
    match source {
        VaultObservationSource::Watcher => "watcher",
        VaultObservationSource::Reconciliation => "reconciliation",
    }
}

fn observation_source_from_value(value: &str) -> Option<VaultObservationSource> {
    match value {
        "watcher" => Some(VaultObservationSource::Watcher),
        "reconciliation" => Some(VaultObservationSource::Reconciliation),
        _ => None,
    }
}

fn observation_kind_value(kind: VaultObservationKind) -> &'static str {
    match kind {
        VaultObservationKind::CanonicalState => "canonicalState",
        VaultObservationKind::ReconciliationScan => "reconciliationScan",
        VaultObservationKind::Lifecycle(kind) => kind.as_storage_value(),
    }
}

fn observation_kind_from_value(value: &str) -> Option<VaultObservationKind> {
    match value {
        "canonicalState" => Some(VaultObservationKind::CanonicalState),
        "reconciliationScan" => Some(VaultObservationKind::ReconciliationScan),
        value => LifecycleEventKind::from_storage_value(value).map(VaultObservationKind::Lifecycle),
    }
}

pub(super) fn retain_observation(observation: &VaultObservation) -> Result<i64, String> {
    let connection = open_store()?;
    connection
        .execute(
            "INSERT INTO pending_observations (
               source, kind, path, previous_path, observed_at_millis,
               modified_at_millis, canonical_markdown
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                observation_source_value(observation.source),
                observation_kind_value(observation.kind),
                observation.path.to_string_lossy().into_owned(),
                observation
                    .previous_path
                    .as_deref()
                    .map(|path| path.to_string_lossy().into_owned()),
                observation.observed_at_millis,
                observation.modified_at_millis,
                observation.canonical_markdown.as_deref(),
            ],
        )
        .map_err(|error| format!("Retain Note Timeline observation: {error}"))?;
    Ok(connection.last_insert_rowid())
}

pub(super) fn retained_observations() -> Result<Vec<RetainedObservation>, String> {
    let connection = open_store()?;
    let mut statement = connection
        .prepare(
            "SELECT sequence, source, kind, path, previous_path,
                    observed_at_millis, modified_at_millis, canonical_markdown
             FROM pending_observations
             ORDER BY sequence ASC",
        )
        .map_err(|error| format!("Prepare retained Note Timeline observations: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, u64>(5)?,
                row.get::<_, Option<u64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(|error| format!("Read retained Note Timeline observations: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Decode retained Note Timeline observations: {error}"))?;

    rows.into_iter()
        .map(
            |(
                sequence,
                source,
                kind,
                path,
                previous_path,
                observed_at_millis,
                modified_at_millis,
                canonical_markdown,
            )| {
                let source = observation_source_from_value(&source).ok_or_else(|| {
                    format!("Unknown retained Note Timeline observation source: {source}")
                })?;
                let kind = observation_kind_from_value(&kind).ok_or_else(|| {
                    format!("Unknown retained Note Timeline observation kind: {kind}")
                })?;
                Ok(RetainedObservation {
                    sequence,
                    observation: VaultObservation {
                        source,
                        kind,
                        path: PathBuf::from(path),
                        previous_path: previous_path.map(PathBuf::from),
                        observed_at_millis,
                        modified_at_millis,
                        canonical_markdown,
                    },
                })
            },
        )
        .collect()
}

pub(super) fn acknowledge_observation(sequence: i64) -> Result<(), String> {
    open_store()?
        .execute(
            "DELETE FROM pending_observations WHERE sequence = ?1",
            params![sequence],
        )
        .map_err(|error| format!("Acknowledge Note Timeline observation: {error}"))?;
    Ok(())
}

#[cfg(test)]
pub(super) fn retained_observation_count() -> u64 {
    open_store()
        .expect("open history store")
        .query_row("SELECT COUNT(*) FROM pending_observations", [], |row| {
            row.get(0)
        })
        .expect("count retained history observations")
}

pub(super) fn prepare_publication(
    source: MutationSource,
    target_path: &Path,
    markdown: &str,
    kind: PublicationIntentKind,
    baseline: Option<BaselineSeed<'_>>,
) -> Result<HistoryIntentIdentity, String> {
    if take_prepare_fault() {
        return Err("injected history preparation failure".to_string());
    }
    let note_id = crate::note::parse_note(markdown)
        .frontmatter
        .managed
        .map(|metadata| metadata.id)
        .filter(|identity| !identity.trim().is_empty())
        .ok_or_else(|| "History preparation requires a managed Note Identity".to_string())?;
    let authored_payload = AuthoredState::from_canonical(markdown).encode();
    let result_hash = hash(&authored_payload);
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    if let Some(baseline) = baseline {
        append_baseline_if_absent(
            &transaction,
            &NoteIdentity::new(note_id.clone()),
            baseline.path,
            baseline.canonical_markdown,
            baseline.known_since_millis,
        )?;
    }
    let intent_id = crate::note::generate_unique_id();
    let revision_id = RevisionIdentity::issue().0;
    let prepared_at_millis = crate::time::current_time_millis()
        .map_err(|error| format!("Issue canonical publication time: {error}"))?;
    let lifecycle_event_id =
        (kind == PublicationIntentKind::Create).then(|| LifecycleEventIdentity::issue().0);
    transaction
        .execute(
            "INSERT INTO prepared_intents (
               intent_id, revision_id, lifecycle_event_id, note_id, target_path,
               source, prepared_at_millis, committed_at_millis, authored_payload,
               result_hash, status
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, 'prepared')",
            params![
                intent_id,
                revision_id,
                lifecycle_event_id,
                note_id,
                target_path.to_string_lossy().into_owned(),
                source.as_storage_value(),
                prepared_at_millis,
                authored_payload,
                result_hash,
            ],
        )
        .map_err(|error| format!("Prepare Note Revision: {error}"))?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(HistoryIntentIdentity::from_persisted(intent_id))
}

pub(super) fn finalize_publication(
    history_intent: &HistoryIntentIdentity,
    source: MutationSource,
    target_path: &Path,
    canonical_markdown: &str,
) -> Result<(), String> {
    if take_finalize_fault() {
        return Err("injected history finalization failure".to_string());
    }
    let payload = AuthoredState::from_canonical(canonical_markdown).encode();
    let result_hash = hash(&payload);
    let mut connection = open_store()?;
    let intent = connection
        .query_row(
            "SELECT target_path, source, result_hash, status, note_id
             FROM prepared_intents WHERE intent_id = ?1",
            params![history_intent.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Find prepared Note Revision: {error}"))?
        .ok_or_else(|| {
            format!(
                "No durable history intent matches the committed note at {}",
                target_path.display()
            )
        })?;
    let canonical_note_id = match managed_note_identity(canonical_markdown) {
        Ok(note_id) => note_id,
        Err(error) => {
            if intent.3 == "prepared" {
                connection
                    .execute(
                        "UPDATE prepared_intents SET status = 'abandoned'
                         WHERE intent_id = ?1 AND status = 'prepared'",
                        params![history_intent.as_str()],
                    )
                    .map_err(|abandon_error| {
                        format!(
                            "{error}; additionally failed to abandon its prepared Note Revision: {abandon_error}"
                        )
                    })?;
            }
            return Err(error);
        }
    };
    if intent.0 != target_path.to_string_lossy()
        || intent.1 != source.as_storage_value()
        || intent.2 != result_hash
        || intent.3 != "prepared"
        || intent.4 != canonical_note_id
    {
        if intent.3 == "prepared" {
            connection
                .execute(
                    "UPDATE prepared_intents SET status = 'abandoned'
                     WHERE intent_id = ?1 AND status = 'prepared'",
                    params![history_intent.as_str()],
                )
                .map_err(|error| format!("Abandon mismatched Note Revision: {error}"))?;
        }
        return Err("Committed note does not match its exact durable history intent".to_string());
    }
    finalize_intent(&mut connection, history_intent.as_str(), &payload)
}

pub(super) fn abandon_publication(history_intent: &HistoryIntentIdentity) -> Result<(), String> {
    let connection = open_store()?;
    connection
        .execute(
            "UPDATE prepared_intents SET status = 'abandoned'
             WHERE intent_id = ?1 AND status = 'prepared'",
            params![history_intent.as_str()],
        )
        .map_err(|error| format!("Abandon prepared Note Revision: {error}"))?;
    Ok(())
}

pub(super) fn record_baseline_revision_if_absent(
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    known_since_millis: u64,
) -> Result<bool, String> {
    #[cfg(test)]
    if take_fault(FaultPoint::Baseline) {
        return Err("injected Baseline Revision failure".to_string());
    }
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let inserted = append_baseline_if_absent(
        &transaction,
        note_id,
        path,
        canonical_markdown,
        known_since_millis,
    )?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(inserted)
}

fn append_baseline_if_absent(
    transaction: &Transaction<'_>,
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    known_since_millis: u64,
) -> Result<bool, String> {
    let head = load_head(&transaction, note_id.as_str())?;
    if head
        .as_ref()
        .and_then(|head| head.revision_id.as_ref())
        .is_some()
    {
        return Ok(false);
    }
    let authored_payload = AuthoredState::from_canonical(canonical_markdown).encode();
    let result_hash = hash(&authored_payload);
    append_revision(
        &transaction,
        RevisionAppend {
            revision_id: &RevisionIdentity::issue().0,
            note_id: note_id.as_str(),
            predecessor: head
                .as_ref()
                .map(|head| (head.record_kind.as_str(), head.record_id.as_str())),
            base_revision_id: None,
            source: MutationSource::BaselineInitialization,
            time_evidence: RevisionTimeEvidence::Baseline { known_since_millis },
            authored_payload: &authored_payload,
            result_hash: &result_hash,
            intent_id: None,
            path,
        },
    )?;
    Ok(true)
}

pub(super) fn record_external_revision(
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    observed_at_millis: u64,
    modified_at_millis: Option<u64>,
) -> Result<(), String> {
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let authored_payload = AuthoredState::from_canonical(canonical_markdown).encode();
    let result_hash = hash(&authored_payload);
    let head = load_head(&transaction, note_id.as_str())?;
    if head.as_ref().and_then(|head| head.result_hash.as_deref()) == Some(result_hash.as_str()) {
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(());
    }

    append_revision(
        &transaction,
        RevisionAppend {
            revision_id: &RevisionIdentity::issue().0,
            note_id: note_id.as_str(),
            predecessor: head
                .as_ref()
                .map(|head| (head.record_kind.as_str(), head.record_id.as_str())),
            base_revision_id: head.as_ref().and_then(|head| head.revision_id.as_deref()),
            source: MutationSource::ExternalEdit,
            time_evidence: RevisionTimeEvidence::Observed {
                observed_at_millis,
                modified_at_millis,
            },
            authored_payload: &authored_payload,
            result_hash: &result_hash,
            intent_id: None,
            path,
        },
    )?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(super) fn record_observed_lifecycle_event(
    note_id: &NoteIdentity,
    kind: LifecycleEventKind,
    previous_path: Option<&Path>,
    path: &Path,
    occurred_at_millis: u64,
) -> Result<(), String> {
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    reject_purged_note_identity(&transaction, note_id.as_str())?;
    let head = load_head(&transaction, note_id.as_str())?;
    if let Some(head) = &head {
        if head.record_kind == "lifecycleEvent" {
            let duplicate = transaction
                .query_row(
                    "SELECT 1 FROM lifecycle_events
                     WHERE event_id = ?1 AND kind = ?2
                       AND previous_path IS ?3 AND path IS ?4",
                    params![
                        head.record_id,
                        kind.as_storage_value(),
                        previous_path.map(|value| value.to_string_lossy().into_owned()),
                        path.to_string_lossy().into_owned(),
                    ],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .is_some();
            if duplicate {
                transaction.commit().map_err(|error| error.to_string())?;
                return Ok(());
            }
        }
    }
    let event_id = LifecycleEventIdentity::issue().0;
    transaction
        .execute(
            "INSERT INTO lifecycle_events (
               event_id, note_id, predecessor_kind, predecessor_id, kind,
               occurred_at_millis, previous_path, path, payload_version, intent_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, NULL)",
            params![
                event_id,
                note_id.as_str(),
                head.as_ref().map(|value| value.record_kind.as_str()),
                head.as_ref().map(|value| value.record_id.as_str()),
                kind.as_storage_value(),
                occurred_at_millis,
                previous_path.map(|value| value.to_string_lossy().into_owned()),
                path.to_string_lossy().into_owned(),
            ],
        )
        .map_err(|error| format!("Record observed Lifecycle Event: {error}"))?;
    transaction
        .execute(
            "INSERT INTO timeline_heads (
               note_id, record_kind, record_id, revision_id, result_hash, current_path
             ) VALUES (?1, 'lifecycleEvent', ?2, ?3, ?4, ?5)
             ON CONFLICT(note_id) DO UPDATE SET
               record_kind = excluded.record_kind,
               record_id = excluded.record_id,
               revision_id = excluded.revision_id,
               result_hash = excluded.result_hash,
               current_path = excluded.current_path",
            params![
                note_id.as_str(),
                event_id,
                head.as_ref().and_then(|value| value.revision_id.as_deref()),
                head.as_ref().and_then(|value| value.result_hash.as_deref()),
                path.to_string_lossy().into_owned(),
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

struct RevisionAppend<'a> {
    revision_id: &'a str,
    note_id: &'a str,
    predecessor: Option<(&'a str, &'a str)>,
    base_revision_id: Option<&'a str>,
    source: MutationSource,
    time_evidence: RevisionTimeEvidence,
    authored_payload: &'a [u8],
    result_hash: &'a str,
    intent_id: Option<&'a str>,
    path: &'a Path,
}

fn append_revision(
    transaction: &Transaction<'_>,
    append: RevisionAppend<'_>,
) -> Result<(), String> {
    reject_purged_note_identity(transaction, append.note_id)?;
    let base = append
        .base_revision_id
        .map(|revision_id| reconstruct_revision(transaction, revision_id))
        .transpose()?
        .unwrap_or_default();
    let delta = LineDelta::between(&base, append.authored_payload).encode();
    let prior_policy = append
        .base_revision_id
        .map(|revision_id| load_revision_policy(transaction, revision_id))
        .transpose()?
        .unwrap_or_default();
    let replay_started = Instant::now();
    let replay_result = LineDelta::decode(&delta)?.apply(&base)?;
    let replay_elapsed = replay_started.elapsed();
    if replay_result != append.authored_payload {
        return Err("Encoded Note Revision did not reconstruct its intended state".to_string());
    }
    let next_replay = prior_policy.replay_count.saturating_add(1);
    let next_accumulated = prior_policy
        .accumulated_delta_bytes
        .saturating_add(delta.len() as u64);
    let ratio = delta.len() as f64 / append.authored_payload.len().max(1) as f64;
    let checkpoint = append.base_revision_id.is_none()
        || next_replay >= MAX_REPLAY_REVISIONS
        || next_accumulated >= MAX_ACCUMULATED_DELTA_BYTES
        || ratio >= MAX_DELTA_TO_FULL_RATIO
        || replay_elapsed >= MAX_MEASURED_REPLAY;
    let (payload_kind, payload, replay_count, accumulated_delta_bytes, payload_version) =
        if checkpoint {
            (
                "checkpoint",
                zstd::stream::encode_all(Cursor::new(append.authored_payload), 3)
                    .map_err(|error| format!("Compress Note Revision checkpoint: {error}"))?,
                0,
                0,
                CHECKPOINT_PAYLOAD_VERSION,
            )
        } else {
            (
                "delta",
                delta,
                next_replay,
                next_accumulated,
                DELTA_PAYLOAD_VERSION,
            )
        };
    let (known_since_millis, committed_at_millis, observed_at_millis, modified_at_millis) =
        match append.time_evidence {
            RevisionTimeEvidence::Baseline { known_since_millis } => {
                (Some(known_since_millis), None, None, None)
            }
            RevisionTimeEvidence::Committed {
                committed_at_millis,
            } => (None, Some(committed_at_millis), None, None),
            RevisionTimeEvidence::Observed {
                observed_at_millis,
                modified_at_millis,
            } => (None, None, Some(observed_at_millis), modified_at_millis),
        };
    transaction
        .execute(
             "INSERT INTO revisions (
               revision_id, note_id, predecessor_kind, predecessor_id, base_revision_id,
               source, known_since_millis, committed_at_millis, observed_at_millis, modified_at_millis,
               payload_version, payload_kind, payload, base_hash, result_hash,
               replay_count, accumulated_delta_bytes, intent_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                       ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                append.revision_id,
                append.note_id,
                append.predecessor.map(|value| value.0),
                append.predecessor.map(|value| value.1),
                append.base_revision_id,
                append.source.as_storage_value(),
                known_since_millis,
                committed_at_millis,
                observed_at_millis,
                modified_at_millis,
                payload_version,
                payload_kind,
                payload,
                (!base.is_empty()).then(|| hash(&base)),
                append.result_hash,
                replay_count,
                accumulated_delta_bytes,
                append.intent_id,
            ],
        )
        .map_err(|error| format!("Append Note Revision: {error}"))?;
    transaction
        .execute(
            "INSERT INTO timeline_heads (
               note_id, record_kind, record_id, revision_id, result_hash, current_path
             ) VALUES (?1, 'revision', ?2, ?2, ?3, ?4)
             ON CONFLICT(note_id) DO UPDATE SET
               record_kind = excluded.record_kind,
               record_id = excluded.record_id,
               revision_id = excluded.revision_id,
               result_hash = excluded.result_hash,
               current_path = excluded.current_path",
            params![
                append.note_id,
                append.revision_id,
                append.result_hash,
                append.path.to_string_lossy().into_owned(),
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn reject_purged_note_identity(connection: &Connection, note_id: &str) -> Result<(), String> {
    let purged = connection
        .query_row(
            "SELECT 1 FROM (
               SELECT scope_id FROM deletion_markers
               WHERE scope_kind = 'note' AND deletion_kind = 'purge'
               UNION ALL
               SELECT scope_id FROM pending_deletions
             ) WHERE scope_id = ?1
             LIMIT 1",
            params![note_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("Read Note Timeline purge boundary: {error}"))?
        .is_some();
    if purged {
        return Err("Purged Note Identity cannot acquire new timeline records".to_string());
    }
    Ok(())
}

fn baseline_phase_value(phase: BaselineInitializationPhase) -> &'static str {
    match phase {
        BaselineInitializationPhase::NotStarted => "notStarted",
        BaselineInitializationPhase::Initializing => "initializing",
        BaselineInitializationPhase::Complete => "complete",
        BaselineInitializationPhase::Degraded => "degraded",
    }
}

fn baseline_phase_from_value(value: &str) -> Option<BaselineInitializationPhase> {
    match value {
        "notStarted" => Some(BaselineInitializationPhase::NotStarted),
        "initializing" => Some(BaselineInitializationPhase::Initializing),
        "complete" => Some(BaselineInitializationPhase::Complete),
        "degraded" => Some(BaselineInitializationPhase::Degraded),
        _ => None,
    }
}

pub(super) fn store_baseline_initialization_progress(
    progress: &BaselineInitializationProgress,
) -> Result<(), String> {
    open_store()?
        .execute(
            "UPDATE baseline_initialization SET
               phase = ?1, discovered_notes = ?2, baseline_revisions = ?3,
               ready_notes = ?4, failed_notes = ?5, last_error = ?6
             WHERE singleton = 1",
            params![
                baseline_phase_value(progress.phase),
                progress.discovered_notes,
                progress.baseline_revisions,
                progress.ready_notes,
                progress.failed_notes,
                progress.last_error.as_deref(),
            ],
        )
        .map_err(|error| format!("Store Baseline Revision initialization progress: {error}"))?;
    Ok(())
}

pub(super) fn baseline_initialization_progress() -> Result<BaselineInitializationProgress, String> {
    let stored = open_store()?
        .query_row(
            "SELECT phase, discovered_notes, baseline_revisions,
                    ready_notes, failed_notes, last_error
             FROM baseline_initialization WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u64>(3)?,
                    row.get::<_, u64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .map_err(|error| format!("Read Baseline Revision initialization progress: {error}"))?;
    let phase = baseline_phase_from_value(&stored.0).ok_or_else(|| {
        format!(
            "Unknown Baseline Revision initialization phase `{}`",
            stored.0
        )
    })?;
    Ok(BaselineInitializationProgress {
        phase,
        discovered_notes: stored.1,
        baseline_revisions: stored.2,
        ready_notes: stored.3,
        failed_notes: stored.4,
        last_error: stored.5,
    })
}

pub(super) fn note_baseline_initialization_state(
    note_id: &NoteIdentity,
) -> Result<NoteBaselineInitializationState, String> {
    let connection = open_store()?;
    let failure = connection
        .query_row(
            "SELECT error FROM baseline_initialization_failures WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Read per-note Baseline Revision failure: {error}"))?;
    if let Some(error) = failure {
        return Ok(NoteBaselineInitializationState::Failed { error });
    }
    let root_revision = connection
        .query_row(
            "SELECT source, known_since_millis
             FROM revisions
             WHERE note_id = ?1 AND base_revision_id IS NULL",
            params![note_id.as_str()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<u64>>(1)?)),
        )
        .optional()
        .map_err(|error| format!("Read per-note Baseline Revision state: {error}"))?;
    Ok(match root_revision {
        Some((source, known_since_millis)) => {
            let source = MutationSource::from_storage_value(&source)
                .ok_or_else(|| format!("Unknown stored Mutation Source `{source}`"))?;
            NoteBaselineInitializationState::Initialized {
                known_since_millis: (source == MutationSource::BaselineInitialization)
                    .then_some(known_since_millis)
                    .flatten(),
            }
        }
        None => NoteBaselineInitializationState::Uninitialized,
    })
}

pub(super) fn record_baseline_initialization_failure(
    note_id: &NoteIdentity,
    path: &Path,
    error: &str,
) -> Result<(), String> {
    open_store()?
        .execute(
            "INSERT INTO baseline_initialization_failures (note_id, path, error)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(note_id) DO UPDATE SET path = excluded.path, error = excluded.error",
            params![note_id.as_str(), path.to_string_lossy().into_owned(), error],
        )
        .map_err(|store_error| format!("Record Baseline Revision failure: {store_error}"))?;
    Ok(())
}

pub(super) fn clear_baseline_initialization_failure(note_id: &NoteIdentity) -> Result<(), String> {
    open_store()?
        .execute(
            "DELETE FROM baseline_initialization_failures WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| format!("Clear Baseline Revision failure: {error}"))?;
    Ok(())
}

pub(super) fn revisions(note_id: &NoteIdentity) -> Result<Vec<NoteRevisionHeader>, String> {
    let connection = open_store()?;
    let mut statement = connection
        .prepare(
            "SELECT revision_id, predecessor_kind, predecessor_id, source, base_revision_id,
                    known_since_millis, committed_at_millis, observed_at_millis,
                    modified_at_millis, payload_version
             FROM revisions WHERE note_id = ?1",
        )
        .map_err(|error| error.to_string())?;
    let revisions = statement
        .query_map(params![note_id.as_str()], |row| {
            let predecessor_kind = row.get::<_, Option<String>>(1)?;
            let predecessor_id = row.get::<_, Option<String>>(2)?;
            Ok((
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(0)?,
                predecessor_kind,
                predecessor_id,
                row.get::<_, String>(3)?,
                row.get::<_, Option<u64>>(5)?,
                row.get::<_, Option<u64>>(6)?,
                row.get::<_, Option<u64>>(7)?,
                row.get::<_, Option<u64>>(8)?,
                row.get::<_, i64>(9)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(
            |(
                base,
                revision_id,
                predecessor_kind,
                predecessor_id,
                source,
                known_since_millis,
                committed_at_millis,
                observed_at_millis,
                modified_at_millis,
                payload_version,
            )| {
                let source = MutationSource::from_storage_value(&source)
                    .ok_or_else(|| format!("Unknown stored Mutation Source `{source}`"))?;
                let payload_version = parse_payload_version(payload_version)?;
                let time_evidence =
                    match (known_since_millis, committed_at_millis, observed_at_millis) {
                        (Some(known_since_millis), None, None) => {
                            RevisionTimeEvidence::Baseline { known_since_millis }
                        }
                        (None, Some(committed_at_millis), None) => {
                            RevisionTimeEvidence::Committed {
                                committed_at_millis,
                            }
                        }
                        (None, None, Some(observed_at_millis)) => RevisionTimeEvidence::Observed {
                            observed_at_millis,
                            modified_at_millis,
                        },
                        _ => {
                            return Err("Stored Note Revision has invalid time evidence".to_string())
                        }
                    };
                Ok((
                    base,
                    NoteRevisionHeader {
                        identity: RevisionIdentity::from_persisted(revision_id),
                        note_identity: note_id.clone(),
                        predecessor: parse_record_identity(predecessor_kind, predecessor_id)?,
                        payload_version,
                        source,
                        time_evidence,
                    },
                ))
            },
        )
        .collect::<Result<Vec<_>, String>>()?;
    order_revision_chain(revisions)
}

pub(super) fn current_path(note_id: &NoteIdentity) -> Result<Option<PathBuf>, String> {
    let connection = open_store()?;
    connection
        .query_row(
            "SELECT current_path FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| row.get::<_, String>(0).map(PathBuf::from),
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub(super) fn note_identity_for_current_path(path: &Path) -> Result<Option<NoteIdentity>, String> {
    let connection = open_store()?;
    let mut statement = connection
        .prepare(
            "SELECT note_id FROM timeline_heads
             WHERE current_path = ?1
             ORDER BY note_id
             LIMIT 2",
        )
        .map_err(|error| error.to_string())?;
    let identities = statement
        .query_map(params![path.to_string_lossy().into_owned()], |row| {
            row.get::<_, String>(0).map(NoteIdentity::new)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    match identities.as_slice() {
        [] => Ok(None),
        [identity] => Ok(Some(identity.clone())),
        _ => Err(format!(
            "Multiple Note Timelines currently claim path {}",
            path.display()
        )),
    }
}

fn order_revision_chain(
    mut revisions: Vec<(Option<String>, NoteRevisionHeader)>,
) -> Result<Vec<NoteRevisionHeader>, String> {
    let mut ordered = Vec::with_capacity(revisions.len());
    let mut base_revision_id = None::<String>;
    while !revisions.is_empty() {
        let matches = revisions
            .iter()
            .enumerate()
            .filter(|(_, (base, _))| base.as_deref() == base_revision_id.as_deref())
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err("Note Revision lineage is missing or branched".to_string());
        }
        let (_, revision) = revisions.remove(matches[0]);
        base_revision_id = Some(revision.identity.0.clone());
        ordered.push(revision);
    }
    Ok(ordered)
}

pub(super) fn lifecycle_events(
    note_id: &NoteIdentity,
) -> Result<Vec<LifecycleEventHeader>, String> {
    let connection = open_store()?;
    let mut statement = connection
        .prepare(
            "SELECT event_id, predecessor_kind, predecessor_id, kind, occurred_at_millis,
                    previous_path, path, payload_version
             FROM lifecycle_events WHERE note_id = ?1
             ORDER BY occurred_at_millis ASC, event_id ASC",
        )
        .map_err(|error| error.to_string())?;
    let events = statement
        .query_map(params![note_id.as_str()], |row| {
            let predecessor_kind = row.get::<_, Option<String>>(1)?;
            let predecessor_id = row.get::<_, Option<String>>(2)?;
            Ok((
                row.get::<_, String>(0)?,
                predecessor_kind,
                predecessor_id,
                row.get::<_, String>(3)?,
                row.get::<_, u64>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(
            |(
                event_id,
                predecessor_kind,
                predecessor_id,
                kind,
                occurred_at_millis,
                previous_path,
                path,
                payload_version,
            )| {
                let kind = LifecycleEventKind::from_storage_value(&kind)
                    .ok_or_else(|| format!("Unknown stored Lifecycle Event Kind `{kind}`"))?;
                Ok(LifecycleEventHeader {
                    identity: LifecycleEventIdentity::from_persisted(event_id),
                    note_identity: note_id.clone(),
                    predecessor: parse_record_identity(predecessor_kind, predecessor_id)?,
                    payload_version: parse_payload_version(payload_version)?,
                    kind,
                    occurred_at_millis,
                    previous_path: previous_path.map(PathBuf::from),
                    path: path.map(PathBuf::from),
                })
            },
        )
        .collect::<Result<Vec<_>, String>>()?;
    Ok(events)
}

pub(super) fn reconstruct(
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
) -> Result<ReconstructedNoteRevision, String> {
    let connection = open_store()?;
    let stored_note_id = connection
        .query_row(
            "SELECT note_id FROM revisions WHERE revision_id = ?1",
            params![revision_id.0],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Unknown Note Revision".to_string())?;
    if stored_note_id != note_id.as_str() {
        return Err("Note Revision does not belong to this Note Timeline".to_string());
    }
    let encoded = reconstruct_revision(&connection, &revision_id.0)?;
    let state = AuthoredState::decode(&encoded)?;
    Ok(ReconstructedNoteRevision {
        unmanaged_frontmatter: state.unmanaged_frontmatter,
        body: state.body,
    })
}

fn insert_deletion_marker(
    transaction: &Transaction<'_>,
    marker: &DeletionMarker,
) -> Result<(), String> {
    let (scope_kind, scope_id) = marker.scope.storage_parts();
    transaction
        .execute(
            "INSERT INTO deletion_markers (
               operation_id, scope_kind, scope_id, deletion_kind,
               occurred_at_millis, history_generation, payload_version
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
            params![
                marker.operation_id.as_str(),
                scope_kind,
                scope_id,
                marker.kind.as_storage_value(),
                marker.occurred_at_millis,
                marker.history_generation,
            ],
        )
        .map_err(|error| format!("Record Note Timeline deletion marker: {error}"))?;
    Ok(())
}

fn delete_note_timeline_records(
    transaction: &Transaction<'_>,
    note_id: &NoteIdentity,
) -> Result<(), String> {
    transaction
        .execute(
            "DELETE FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| format!("Delete Note Timeline head: {error}"))?;
    transaction
        .execute(
            "DELETE FROM baseline_initialization_failures WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| format!("Delete Note Timeline initialization failure: {error}"))?;
    transaction
        .execute(
            "DELETE FROM lifecycle_events WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| format!("Delete Note Timeline Lifecycle Events: {error}"))?;
    transaction
        .execute(
            "DELETE FROM revisions WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| format!("Delete Note Timeline revisions: {error}"))?;
    transaction
        .execute(
            "DELETE FROM prepared_intents WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| format!("Delete Note Timeline publication intents: {error}"))?;
    Ok(())
}

pub(super) fn clear_note_history(
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    marker: &DeletionMarker,
) -> Result<(), String> {
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|error| format!("Defer Note Timeline clear constraints: {error}"))?;
    delete_note_timeline_records(&transaction, note_id)?;
    insert_deletion_marker(&transaction, marker)?;
    append_baseline_if_absent(
        &transaction,
        note_id,
        path,
        canonical_markdown,
        marker.occurred_at_millis,
    )?;
    #[cfg(test)]
    if take_fault(FaultPoint::Deletion) {
        return Err("injected history deletion interruption".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit Note Timeline clear: {error}"))
}

pub(super) fn clear_vault_history(
    seeds: &[HistoryClearBaseline],
    marker: &DeletionMarker,
) -> Result<(), String> {
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|error| format!("Defer vault Note Timeline clear constraints: {error}"))?;
    for seed in seeds {
        delete_note_timeline_records(&transaction, &seed.note_id)?;
    }
    insert_deletion_marker(&transaction, marker)?;
    for seed in seeds {
        append_baseline_if_absent(
            &transaction,
            &seed.note_id,
            &seed.path,
            &seed.canonical_markdown,
            marker.occurred_at_millis,
        )?;
    }
    #[cfg(test)]
    if take_fault(FaultPoint::Deletion) {
        return Err("injected history deletion interruption".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit vault Note Timeline clear: {error}"))
}

pub(super) fn prepare_note_purge(
    note_id: &NoteIdentity,
    path: &Path,
    marker: &DeletionMarker,
) -> Result<PathBuf, String> {
    let connection = open_store()?;
    let (scope_kind, scope_id) = marker.scope.storage_parts();
    if scope_kind != "note" || scope_id != note_id.as_str() {
        return Err("Note purge marker scope does not match its Note Identity".to_string());
    }
    let staged_path = purge_staging_path(marker.operation_id())?;
    connection
        .execute(
            "INSERT INTO pending_deletions (
               operation_id, note_id, path, staged_path, scope_kind, scope_id,
               deletion_kind, occurred_at_millis, history_generation, payload_version
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)",
            params![
                marker.operation_id.as_str(),
                note_id.as_str(),
                path.to_string_lossy().into_owned(),
                staged_path.to_string_lossy().into_owned(),
                scope_kind,
                scope_id,
                marker.kind.as_storage_value(),
                marker.occurred_at_millis,
                marker.history_generation,
            ],
        )
        .map_err(|error| format!("Prepare Note Timeline purge: {error}"))?;
    Ok(staged_path)
}

pub(super) fn abandon_note_purge(operation_id: &DeletionOperationIdentity) -> Result<(), String> {
    open_store()?
        .execute(
            "DELETE FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
        )
        .map_err(|error| format!("Abandon prepared Note Timeline purge: {error}"))?;
    Ok(())
}

pub(super) fn finalize_note_purge(operation_id: &DeletionOperationIdentity) -> Result<(), String> {
    let mut connection = open_store()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let pending = transaction
        .query_row(
            "SELECT note_id, path, scope_kind, scope_id, deletion_kind,
                    occurred_at_millis, history_generation, payload_version
             FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    PathBuf::from(row.get::<_, String>(1)?),
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, u64>(5)?,
                    row.get::<_, u64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Read prepared Note Timeline purge: {error}"))?
        .ok_or_else(|| "Unknown prepared Note Timeline purge".to_string())?;
    let marker = DeletionMarker {
        payload_version: parse_payload_version(pending.7)?,
        operation_id: operation_id.clone(),
        scope: DeletionScope::from_storage_parts(&pending.2, pending.3)?,
        kind: HistoryDeletionKind::from_storage_value(&pending.4)
            .ok_or_else(|| format!("Unknown prepared deletion kind `{}`", pending.4))?,
        occurred_at_millis: pending.5,
        history_generation: pending.6,
    };
    if marker.kind != HistoryDeletionKind::Purge
        || marker.scope != DeletionScope::Note(NoteIdentity::new(pending.0.clone()))
    {
        return Err("Prepared Note Timeline purge has an invalid scope or kind".to_string());
    }
    transaction
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|error| format!("Defer Note Timeline purge constraints: {error}"))?;
    transaction
        .execute(
            "DELETE FROM pending_observations WHERE path = ?1 OR previous_path = ?1",
            params![pending.1.to_string_lossy().into_owned()],
        )
        .map_err(|error| format!("Delete pending observations for purged note: {error}"))?;
    delete_note_timeline_records(&transaction, &NoteIdentity::new(pending.0))?;
    insert_deletion_marker(&transaction, &marker)?;
    #[cfg(test)]
    if take_fault(FaultPoint::Deletion) {
        return Err("injected history deletion interruption".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit Note Timeline purge: {error}"))
}

pub(super) fn complete_note_purge(operation_id: &DeletionOperationIdentity) -> Result<(), String> {
    let connection = open_store()?;
    let staged_path = connection
        .query_row(
            "SELECT staged_path FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
            |row| row.get::<_, String>(0).map(PathBuf::from),
        )
        .optional()
        .map_err(|error| format!("Read staged Note Timeline purge cleanup: {error}"))?;
    let Some(staged_path) = staged_path else {
        return Ok(());
    };
    match fs::remove_file(&staged_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Remove staged canonical note after timeline purge {}: {error}",
                staged_path.display()
            ));
        }
    }
    connection
        .execute(
            "DELETE FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
        )
        .map_err(|error| format!("Complete prepared Note Timeline purge: {error}"))?;
    Ok(())
}

pub(super) struct PendingDeletionRecovery {
    pub(super) operation_id: DeletionOperationIdentity,
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) staged_path: PathBuf,
    pub(super) finalized: bool,
}

pub(super) fn pending_deletions_for_recovery() -> Result<Vec<PendingDeletionRecovery>, String> {
    let connection = open_store()?;
    let pending = {
        let mut statement = connection
            .prepare(
                "SELECT operation_id, note_id, path, staged_path
                 FROM pending_deletions ORDER BY operation_id",
            )
            .map_err(|error| format!("Prepare pending deletion recovery: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    DeletionOperationIdentity::from_persisted(row.get::<_, String>(0)?),
                    NoteIdentity::new(row.get::<_, String>(1)?),
                    PathBuf::from(row.get::<_, String>(2)?),
                    PathBuf::from(row.get::<_, String>(3)?),
                ))
            })
            .map_err(|error| format!("Read pending deletion recovery: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Decode pending deletion recovery: {error}"))?;
        rows
    };
    drop(connection);
    pending
        .into_iter()
        .map(|(operation_id, note_id, path, staged_path)| {
            let finalized = deletion_marker_exists(&operation_id)?;
            Ok(PendingDeletionRecovery {
                operation_id,
                note_id,
                path,
                staged_path,
                finalized,
            })
        })
        .collect()
}

fn deletion_marker_exists(operation_id: &DeletionOperationIdentity) -> Result<bool, String> {
    Ok(open_store()?
        .query_row(
            "SELECT 1 FROM deletion_markers WHERE operation_id = ?1",
            params![operation_id.as_str()],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("Read Note Timeline purge completion marker: {error}"))?
        .is_some())
}

fn purge_staging_path(operation_id: &DeletionOperationIdentity) -> Result<PathBuf, String> {
    let directory = crate::state::vault_data_dir()?.join("pending-note-purges");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Create Note Timeline purge staging directory: {error}"))?;
    Ok(directory.join(format!("{}.md", operation_id.as_str())))
}

pub(super) fn deletion_markers() -> Result<Vec<DeletionMarker>, String> {
    let connection = open_store()?;
    let mut statement = connection
        .prepare(
            "SELECT operation_id, scope_kind, scope_id, deletion_kind,
                    occurred_at_millis, history_generation, payload_version
             FROM deletion_markers
             ORDER BY occurred_at_millis, operation_id",
        )
        .map_err(|error| format!("Prepare deletion marker export: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, u64>(4)?,
                row.get::<_, u64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|error| format!("Read deletion marker export: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Decode deletion marker export: {error}"))?;
    rows.into_iter()
        .map(
            |(
                operation_id,
                scope_kind,
                scope_id,
                deletion_kind,
                occurred_at_millis,
                history_generation,
                payload_version,
            )| {
                Ok(DeletionMarker {
                    payload_version: parse_payload_version(payload_version)?,
                    operation_id: DeletionOperationIdentity::from_persisted(operation_id),
                    scope: DeletionScope::from_storage_parts(&scope_kind, scope_id)?,
                    kind: HistoryDeletionKind::from_storage_value(&deletion_kind)
                        .ok_or_else(|| format!("Unknown deletion marker kind `{deletion_kind}`"))?,
                    occurred_at_millis,
                    history_generation,
                })
            },
        )
        .collect()
}

fn storage_usage_with_connection(connection: &Connection) -> Result<HistoryStorageUsage, String> {
    let page_size = connection
        .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
        .map_err(|error| format!("Read Note Timeline storage page size: {error}"))?;
    let reclaimable_pages = connection
        .query_row("PRAGMA freelist_count", [], |row| row.get::<_, u64>(0))
        .map_err(|error| format!("Read reclaimable Note Timeline storage: {error}"))?;
    let logical_pages = connection
        .query_row("PRAGMA page_count", [], |row| row.get::<_, u64>(0))
        .map_err(|error| format!("Read logical Note Timeline storage pages: {error}"))?;
    let database_path = history_database_path()?;
    let allocated_bytes = sqlite_store_paths(&database_path)
        .into_iter()
        .try_fold(0_u64, |total, path| {
            storage_file_bytes(&path).map(|bytes| total.saturating_add(bytes))
        })?;
    let main_bytes = storage_file_bytes(&database_path)?;
    let wal_bytes = storage_file_bytes(&sqlite_sidecar_path(&database_path, "-wal"))?;
    let checkpoint_growth = logical_pages
        .saturating_mul(page_size)
        .saturating_sub(main_bytes);
    let checkpoint_reclaimable_bytes = wal_bytes.saturating_sub(checkpoint_growth);
    Ok(HistoryStorageUsage {
        allocated_bytes,
        reclaimable_bytes: reclaimable_pages
            .saturating_mul(page_size)
            .saturating_add(checkpoint_reclaimable_bytes),
    })
}

pub(super) fn storage_usage() -> Result<HistoryStorageUsage, String> {
    storage_usage_with_connection(&open_store()?)
}

pub(super) fn compact(maximum_reclaim_bytes: u64) -> Result<(), String> {
    let connection = open_store()?;
    connection
        .execute_batch("PRAGMA wal_autocheckpoint=0;")
        .map_err(|error| format!("Bound Note Timeline compaction checkpointing: {error}"))?;
    if maximum_reclaim_bytes == 0 {
        return Ok(());
    }
    let database_path = history_database_path()?;
    let wal_path = sqlite_sidecar_path(&database_path, "-wal");
    let wal_bytes = storage_file_bytes(&wal_path)?;
    let mut remaining_budget = maximum_reclaim_bytes;
    if wal_bytes > 0 && wal_bytes <= remaining_budget {
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| format!("Compact Note Timeline WAL storage: {error}"))?;
        remaining_budget = remaining_budget.saturating_sub(wal_bytes);
    }
    if remaining_budget == 0 {
        return Ok(());
    }
    let usage = storage_usage_with_connection(&connection)?;
    if usage.reclaimable_bytes == 0 {
        return Ok(());
    }
    let page_size = connection
        .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
        .map_err(|error| format!("Read Note Timeline compaction page size: {error}"))?;
    let maximum_pages = (remaining_budget / page_size).min(MAX_COMPACTION_PAGES_PER_PASS);
    if maximum_pages == 0 {
        return Ok(());
    }
    let reclaimable_pages = usage.reclaimable_bytes / page_size;
    let pages = maximum_pages.min(reclaimable_pages);
    for _ in 0..pages {
        connection
            .execute_batch("PRAGMA incremental_vacuum(1);")
            .map_err(|error| format!("Compact Note Timeline storage: {error}"))?;
    }
    Ok(())
}

fn history_database_path() -> Result<PathBuf, String> {
    Ok(crate::state::vault_data_dir()?.join(HISTORY_DATABASE_FILE_NAME))
}

fn sqlite_sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = database_path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

fn sqlite_store_paths(database_path: &Path) -> [PathBuf; 3] {
    [
        database_path.to_path_buf(),
        sqlite_sidecar_path(database_path, "-wal"),
        sqlite_sidecar_path(database_path, "-shm"),
    ]
}

fn storage_file_bytes(path: &Path) -> Result<u64, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(format!(
            "Read Note Timeline storage allocation {}: {error}",
            path.display()
        )),
    }
}

pub(super) fn reset_development_store(
    vault_root: &Path,
) -> Result<(u64, u64, String, u64), String> {
    let generations = crate::state::advance_vault_history_generation(
        vault_root,
        HISTORY_FORMAT,
        INITIAL_HISTORY_GENERATION,
    )?;
    let operation_id = crate::note::generate_unique_id();
    let reset_at_millis = crate::time::current_time_millis()
        .map_err(|error| format!("Issue development history reset time: {error}"))?;
    let manifest = crate::state::read_vault_manifest_for(vault_root)?
        .ok_or_else(|| "Development history reset requires a vault manifest".to_string())?;
    record_history_reset(
        &manifest,
        &operation_id,
        generations.0,
        generations.1,
        reset_at_millis,
    )?;
    let data_dir = crate::state::vault_data_dir()?;
    for path in [
        data_dir.join(HISTORY_DATABASE_FILE_NAME),
        data_dir.join(format!("{HISTORY_DATABASE_FILE_NAME}-wal")),
        data_dir.join(format!("{HISTORY_DATABASE_FILE_NAME}-shm")),
    ] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Remove development Note Timeline store {}: {error}",
                    path.display()
                ))
            }
        }
    }
    drop(open_store()?);
    Ok((generations.0, generations.1, operation_id, reset_at_millis))
}

fn history_observations_path() -> Result<PathBuf, String> {
    Ok(crate::state::app_data_dir()?.join(HISTORY_OBSERVATIONS_FILE_NAME))
}

fn read_history_observations(path: &Path) -> Result<HistoryObservations, String> {
    if !path.is_file() {
        return Ok(HistoryObservations::default());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Read Note Timeline history observations: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Parse Note Timeline history observations: {error}"))
}

fn write_history_observations(
    path: &Path,
    observations: &HistoryObservations,
) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(observations)
        .map_err(|error| format!("Serialize Note Timeline history observations: {error}"))?;
    let temporary = path.with_file_name(format!(
        ".history-observations-{}.tmp",
        crate::note::generate_unique_id()
    ));
    fs::write(&temporary, serialized)
        .map_err(|error| format!("Write Note Timeline history observations: {error}"))?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Select Note Timeline history observations atomically: {error}"
        ));
    }
    Ok(())
}

fn validate_and_remember_history_selection(
    manifest: &crate::state::VaultManifest,
) -> Result<(), String> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let path = history_observations_path()?;
    let mut observations = read_history_observations(&path)?;
    if let Some(observed) = observations.vaults.get(&manifest.vault_id) {
        if manifest.history_generation < observed.generation {
            return Err(format!(
                "Note Timeline history generation rollback: vault selected generation {} after this app observed generation {}",
                manifest.history_generation, observed.generation
            ));
        }
        if manifest.history_generation == observed.generation
            && manifest.history_format != observed.history_format
        {
            return Err(
                "Note Timeline history format changed without a generation change".to_string(),
            );
        }
        if manifest.history_generation == observed.generation
            && manifest.history_format == observed.history_format
            && !observed.allow_missing_store
        {
            return Ok(());
        }
    }
    let last_reset = observations
        .vaults
        .get(&manifest.vault_id)
        .and_then(|observed| observed.last_reset.clone());
    observations.vaults.insert(
        manifest.vault_id.clone(),
        ObservedHistorySelection {
            history_format: manifest.history_format.clone(),
            generation: manifest.history_generation,
            allow_missing_store: false,
            last_reset,
        },
    );
    write_history_observations(&path, &observations)
}

fn record_history_reset(
    manifest: &crate::state::VaultManifest,
    operation_id: &str,
    previous_generation: u64,
    generation: u64,
    reset_at_millis: u64,
) -> Result<(), String> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let path = history_observations_path()?;
    let mut observations = read_history_observations(&path)?;
    observations.vaults.insert(
        manifest.vault_id.clone(),
        ObservedHistorySelection {
            history_format: manifest.history_format.clone(),
            generation,
            allow_missing_store: true,
            last_reset: Some(PersistedHistoryReset {
                operation_id: operation_id.to_string(),
                previous_generation,
                generation,
                reset_at_millis,
            }),
        },
    );
    write_history_observations(&path, &observations)
}

fn ensure_store_creation_is_authorized(
    manifest: &crate::state::VaultManifest,
) -> Result<(), String> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let observations = read_history_observations(&history_observations_path()?)?;
    let Some(observed) = observations.vaults.get(&manifest.vault_id) else {
        return Ok(());
    };
    if manifest.history_generation < observed.generation {
        return Err(format!(
            "Note Timeline history generation rollback: vault selected generation {} after this app observed generation {}",
            manifest.history_generation, observed.generation
        ));
    }
    if manifest.history_generation == observed.generation
        && manifest.history_format != observed.history_format
    {
        return Err("Note Timeline history format changed without a generation change".to_string());
    }
    if manifest.history_generation == observed.generation && observed.allow_missing_store {
        return Ok(());
    }
    Err(format!(
        "Note Timeline history store is missing or uninitialized for previously observed generation {}",
        manifest.history_generation
    ))
}

pub(super) fn latest_development_history_reset() -> Result<Option<(String, u64, u64, u64)>, String>
{
    let manifest = crate::state::read_vault_manifest_for(&crate::state::vault_root()?)?
        .ok_or_else(|| "Read development history reset without a vault manifest".to_string())?;
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let observations = read_history_observations(&history_observations_path()?)?;
    Ok(observations
        .vaults
        .get(&manifest.vault_id)
        .and_then(|observed| observed.last_reset.as_ref())
        .map(|reset| {
            (
                reset.operation_id.clone(),
                reset.previous_generation,
                reset.generation,
                reset.reset_at_millis,
            )
        }))
}

fn open_store() -> Result<Connection, String> {
    let _open_guard = HISTORY_STORE_OPEN_LOCK
        .lock()
        .map_err(|_| "Note Timeline history store open lock poisoned".to_string())?;
    let vault_root = crate::state::vault_root()?;
    let manifest = crate::state::read_vault_manifest_for(&vault_root)?
        .map(Ok)
        .unwrap_or_else(|| super::ensure_vault_scaffold(&vault_root))?;
    if manifest.history_format != HISTORY_FORMAT {
        return Err(format!(
            "Note Timeline history format mismatch: manifest selects `{}` but this build supports `{HISTORY_FORMAT}`",
            manifest.history_format
        ));
    }
    let data_dir = crate::state::vault_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let path = history_database_path()?;
    let creating_store = !path.is_file();
    if creating_store {
        ensure_store_creation_is_authorized(&manifest)?;
    }
    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    if !creating_store {
        let has_metadata_table = connection
            .query_row(
                "SELECT 1 FROM sqlite_master
                 WHERE type = 'table' AND name = 'history_metadata'",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some();
        if has_metadata_table {
            let metadata = connection
                .query_row(
                    "SELECT vault_id, history_format, history_generation, schema_version
                     FROM history_metadata WHERE singleton = 1",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, u64>(2)?,
                            row.get::<_, u64>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some((vault_id, format, generation, schema)) = metadata {
                if vault_id != manifest.vault_id {
                    return Err("Note Timeline history store vault identity mismatch".to_string());
                }
                if format != manifest.history_format {
                    return Err("Note Timeline history store format mismatch".to_string());
                }
                if generation != manifest.history_generation {
                    return Err("Note Timeline history store generation mismatch".to_string());
                }
                match schema {
                    5 => migrate_schema_five_storage(&connection)?,
                    HISTORY_SCHEMA_VERSION => {}
                    _ => return Err("Note Timeline history store schema mismatch".to_string()),
                }
            }
        }
    }
    if creating_store {
        connection
            .execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM;")
            .map_err(|error| format!("Initialize reclaimable Note Timeline storage: {error}"))?;
    }
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA synchronous=FULL;
             PRAGMA busy_timeout=5000;
             CREATE TABLE IF NOT EXISTS history_metadata (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               vault_id TEXT NOT NULL,
               history_format TEXT NOT NULL,
               history_generation INTEGER NOT NULL,
               schema_version INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS prepared_intents (
               intent_id TEXT PRIMARY KEY,
               revision_id TEXT NOT NULL UNIQUE,
               lifecycle_event_id TEXT UNIQUE,
               note_id TEXT NOT NULL,
               target_path TEXT NOT NULL,
               source TEXT NOT NULL,
               prepared_at_millis INTEGER NOT NULL,
               committed_at_millis INTEGER NOT NULL,
               authored_payload BLOB NOT NULL,
               result_hash TEXT NOT NULL,
               status TEXT NOT NULL CHECK (status IN ('prepared', 'finalized', 'abandoned'))
             );
             CREATE INDEX IF NOT EXISTS prepared_intents_by_target
               ON prepared_intents(target_path, source, result_hash, status);
             CREATE TABLE IF NOT EXISTS revisions (
               revision_id TEXT PRIMARY KEY,
               note_id TEXT NOT NULL,
               predecessor_kind TEXT,
               predecessor_id TEXT,
               base_revision_id TEXT REFERENCES revisions(revision_id),
               source TEXT NOT NULL,
               known_since_millis INTEGER,
               committed_at_millis INTEGER,
               observed_at_millis INTEGER,
               modified_at_millis INTEGER,
               payload_version INTEGER NOT NULL,
               payload_kind TEXT NOT NULL CHECK (payload_kind IN ('checkpoint', 'delta')),
               payload BLOB NOT NULL,
               base_hash TEXT,
               result_hash TEXT NOT NULL,
               replay_count INTEGER NOT NULL,
               accumulated_delta_bytes INTEGER NOT NULL,
               intent_id TEXT UNIQUE REFERENCES prepared_intents(intent_id),
               CHECK ((known_since_millis IS NOT NULL
                       AND committed_at_millis IS NULL AND observed_at_millis IS NULL)
                   OR (known_since_millis IS NULL
                       AND committed_at_millis IS NOT NULL AND observed_at_millis IS NULL)
                   OR (known_since_millis IS NULL
                       AND committed_at_millis IS NULL AND observed_at_millis IS NOT NULL))
             );
             CREATE INDEX IF NOT EXISTS revisions_by_note_time
               ON revisions(note_id, COALESCE(known_since_millis, committed_at_millis, observed_at_millis), revision_id);
             CREATE TABLE IF NOT EXISTS named_revision_labels (
               label_id TEXT PRIMARY KEY,
               revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
               label TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS named_revision_labels_by_revision
               ON named_revision_labels(revision_id, label_id);
             CREATE TABLE IF NOT EXISTS revision_citations (
               citation_id TEXT PRIMARY KEY,
               revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
               current_excerpt TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS revision_citations_by_revision
               ON revision_citations(revision_id, citation_id);
             CREATE TABLE IF NOT EXISTS lifecycle_events (
               event_id TEXT PRIMARY KEY,
               note_id TEXT NOT NULL,
               predecessor_kind TEXT,
               predecessor_id TEXT,
               kind TEXT NOT NULL,
               occurred_at_millis INTEGER NOT NULL,
               previous_path TEXT,
               path TEXT,
               payload_version INTEGER NOT NULL,
               intent_id TEXT UNIQUE REFERENCES prepared_intents(intent_id)
             );
             CREATE INDEX IF NOT EXISTS lifecycle_events_by_note_time
               ON lifecycle_events(note_id, occurred_at_millis, event_id);
             CREATE TABLE IF NOT EXISTS pending_observations (
               sequence INTEGER PRIMARY KEY AUTOINCREMENT,
               source TEXT NOT NULL CHECK (source IN ('watcher', 'reconciliation')),
               kind TEXT NOT NULL,
               path TEXT NOT NULL,
               previous_path TEXT,
               observed_at_millis INTEGER NOT NULL,
               modified_at_millis INTEGER,
               canonical_markdown TEXT
             );
             CREATE TABLE IF NOT EXISTS baseline_initialization (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               phase TEXT NOT NULL CHECK (phase IN ('notStarted', 'initializing', 'complete', 'degraded')),
               discovered_notes INTEGER NOT NULL,
               baseline_revisions INTEGER NOT NULL,
               ready_notes INTEGER NOT NULL,
               failed_notes INTEGER NOT NULL,
               last_error TEXT
             );
             INSERT OR IGNORE INTO baseline_initialization (
               singleton, phase, discovered_notes, baseline_revisions,
               ready_notes, failed_notes, last_error
             ) VALUES (1, 'notStarted', 0, 0, 0, 0, NULL);
             CREATE TABLE IF NOT EXISTS baseline_initialization_failures (
               note_id TEXT PRIMARY KEY,
               path TEXT NOT NULL,
               error TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS timeline_heads (
               note_id TEXT PRIMARY KEY,
               record_kind TEXT NOT NULL,
               record_id TEXT NOT NULL,
               revision_id TEXT,
               result_hash TEXT,
               current_path TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS timeline_heads_by_current_path
               ON timeline_heads(current_path);
             CREATE TABLE IF NOT EXISTS deletion_markers (
               operation_id TEXT PRIMARY KEY,
               scope_kind TEXT NOT NULL CHECK (scope_kind IN ('note', 'vault')),
               scope_id TEXT NOT NULL,
               deletion_kind TEXT NOT NULL CHECK (deletion_kind IN ('clear', 'purge')),
               occurred_at_millis INTEGER NOT NULL,
               history_generation INTEGER NOT NULL,
               payload_version INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS deletion_markers_by_scope
               ON deletion_markers(scope_kind, scope_id, occurred_at_millis, operation_id);
             CREATE TABLE IF NOT EXISTS pending_deletions (
               operation_id TEXT PRIMARY KEY,
               note_id TEXT NOT NULL,
               path TEXT NOT NULL,
               staged_path TEXT NOT NULL,
               scope_kind TEXT NOT NULL CHECK (scope_kind = 'note'),
               scope_id TEXT NOT NULL,
               deletion_kind TEXT NOT NULL CHECK (deletion_kind = 'purge'),
               occurred_at_millis INTEGER NOT NULL,
               history_generation INTEGER NOT NULL,
               payload_version INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Initialize Note Timeline history store: {error}"))?;
    configure_wal_bounds(&connection)?;
    let metadata = connection
        .query_row(
            "SELECT vault_id, history_format, history_generation, schema_version
             FROM history_metadata WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match metadata {
        Some((vault_id, _, _, _)) if vault_id != manifest.vault_id => {
            return Err("Note Timeline history store vault identity mismatch".to_string())
        }
        Some((_, format, _, _)) if format != manifest.history_format => {
            return Err("Note Timeline history store format mismatch".to_string())
        }
        Some((_, _, generation, _)) if generation != manifest.history_generation => {
            return Err("Note Timeline history store generation mismatch".to_string())
        }
        Some((_, _, _, 5)) => {
            record_schema_six_migration(&connection)?;
        }
        Some((_, _, _, schema)) if schema != HISTORY_SCHEMA_VERSION => {
            return Err("Note Timeline history store schema mismatch".to_string())
        }
        Some(_) => {}
        None => {
            ensure_store_creation_is_authorized(&manifest)?;
            connection
                .execute(
                    "INSERT INTO history_metadata (
                       singleton, vault_id, history_format, history_generation, schema_version
                     ) VALUES (1, ?1, ?2, ?3, ?4)",
                    params![
                        &manifest.vault_id,
                        &manifest.history_format,
                        manifest.history_generation,
                        HISTORY_SCHEMA_VERSION
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    validate_and_remember_history_selection(&manifest)?;
    Ok(connection)
}

fn migrate_schema_five_storage(connection: &Connection) -> Result<(), String> {
    #[cfg(test)]
    if take_fault(FaultPoint::Migration) {
        return Err("injected schema migration interruption".to_string());
    }
    let auto_vacuum = connection
        .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, u64>(0))
        .map_err(|error| format!("Read legacy Note Timeline auto-vacuum mode: {error}"))?;
    if auto_vacuum != 2 {
        connection
            .execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM;")
            .map_err(|error| format!("Migrate Note Timeline to bounded reclamation: {error}"))?;
    }
    Ok(())
}

fn record_schema_six_migration(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "UPDATE history_metadata SET schema_version = ?1
             WHERE singleton = 1 AND schema_version = 5",
            params![HISTORY_SCHEMA_VERSION],
        )
        .map_err(|error| format!("Record Note Timeline schema migration: {error}"))?;
    Ok(())
}

fn configure_wal_bounds(connection: &Connection) -> Result<(), String> {
    let page_size = connection
        .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
        .map_err(|error| format!("Read Note Timeline WAL page size: {error}"))?;
    let wal_header_bytes = 32_u64;
    let wal_frame_header_bytes = 24_u64;
    let autocheckpoint_pages = BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES
        .saturating_sub(wal_header_bytes)
        .checked_div(page_size.saturating_add(wal_frame_header_bytes))
        .unwrap_or(0)
        .max(1);
    connection
        .pragma_update(None, "wal_autocheckpoint", autocheckpoint_pages)
        .map_err(|error| format!("Configure Note Timeline WAL autocheckpoint: {error}"))?;
    connection
        .pragma_update(
            None,
            "journal_size_limit",
            BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES,
        )
        .map_err(|error| format!("Configure Note Timeline WAL size limit: {error}"))?;
    Ok(())
}

pub(super) fn recover_pending() -> Result<(), String> {
    #[cfg(test)]
    if take_fault(FaultPoint::Recover) {
        return Err("injected history recovery failure".to_string());
    }
    let connection = open_store()?;
    recover_pending_with_connection(&connection)
}

fn recover_pending_with_connection(connection: &Connection) -> Result<(), String> {
    let pending = {
        let mut statement = connection
            .prepare(
                "SELECT intent_id, target_path, authored_payload, result_hash, note_id
                 FROM prepared_intents WHERE status = 'prepared'
                 ORDER BY prepared_at_millis, intent_id",
            )
            .map_err(|error| error.to_string())?;
        let pending = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    PathBuf::from(row.get::<_, String>(1)?),
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        pending
    };
    for (intent_id, path, intended_payload, intended_hash, intended_note_id) in pending {
        match fs::read_to_string(&path) {
            Ok(markdown) => {
                let canonical_payload = AuthoredState::from_canonical(&markdown).encode();
                if hash(&canonical_payload) == intended_hash
                    && canonical_payload == intended_payload
                    && managed_note_identity(&markdown).as_deref() == Ok(intended_note_id.as_str())
                {
                    let mut recovered = open_existing_connection(connection)?;
                    finalize_intent(&mut recovered, &intent_id, &canonical_payload)?;
                } else {
                    connection
                        .execute(
                            "UPDATE prepared_intents SET status = 'abandoned'
                             WHERE intent_id = ?1 AND status = 'prepared'",
                            params![intent_id],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                connection
                    .execute(
                        "UPDATE prepared_intents SET status = 'abandoned'
                         WHERE intent_id = ?1 AND status = 'prepared'",
                        params![intent_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Err(error) => {
                return Err(format!(
                    "Read pending canonical publication {}: {error}",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

// A separate connection avoids requiring mutable access from read-capability
// callers while SQLite serializes the short finalization transaction.
fn open_existing_connection(_connection: &Connection) -> Result<Connection, String> {
    let path = crate::state::vault_data_dir()?.join(HISTORY_DATABASE_FILE_NAME);
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA synchronous=FULL;
             PRAGMA busy_timeout=5000;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn finalize_intent(
    connection: &mut Connection,
    intent_id: &str,
    authored_payload: &[u8],
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let intent = load_intent(&transaction, intent_id)?;
    if intent.status == "finalized" {
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(());
    }
    if intent.status != "prepared" {
        return Err("Prepared Note Revision intent is no longer recoverable".to_string());
    }
    if hash(authored_payload) != intent.result_hash || authored_payload != intent.authored_payload {
        return Err(
            "Committed authored state does not match its durable history intent".to_string(),
        );
    }
    let head = load_head(&transaction, &intent.note_id)?;
    let content_is_unchanged = head.as_ref().and_then(|head| head.result_hash.as_deref())
        == Some(intent.result_hash.as_str());

    let occurred_at = intent.committed_at_millis;
    let mut predecessor = head
        .as_ref()
        .map(|head| (head.record_kind.clone(), head.record_id.clone()));
    if let Some(head) = head
        .as_ref()
        .filter(|head| head.current_path != intent.target_path)
    {
        let event_id = LifecycleEventIdentity::issue().0;
        let kind = if head.current_path.parent() == intent.target_path.parent() {
            LifecycleEventKind::Renamed
        } else {
            LifecycleEventKind::Moved
        };
        transaction
            .execute(
                "INSERT INTO lifecycle_events (
                   event_id, note_id, predecessor_kind, predecessor_id, kind,
                   occurred_at_millis, previous_path, path, payload_version, intent_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, NULL)",
                params![
                    event_id,
                    intent.note_id,
                    predecessor.as_ref().map(|value| value.0.as_str()),
                    predecessor.as_ref().map(|value| value.1.as_str()),
                    kind.as_storage_value(),
                    occurred_at,
                    head.current_path.to_string_lossy().into_owned(),
                    intent.target_path.to_string_lossy().into_owned(),
                ],
            )
            .map_err(|error| error.to_string())?;
        predecessor = Some(("lifecycleEvent".to_string(), event_id.clone()));
        if content_is_unchanged {
            transaction
                .execute(
                    "UPDATE timeline_heads
                     SET record_kind = 'lifecycleEvent', record_id = ?1, current_path = ?2
                     WHERE note_id = ?3",
                    params![
                        event_id,
                        intent.target_path.to_string_lossy().into_owned(),
                        intent.note_id,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    if let Some(event_id) = intent.lifecycle_event_id.as_deref() {
        transaction
            .execute(
                "INSERT OR IGNORE INTO lifecycle_events (
                   event_id, note_id, predecessor_kind, predecessor_id, kind,
                   occurred_at_millis, payload_version, intent_id
                 ) VALUES (?1, ?2, ?3, ?4, 'created', ?5, 1, ?6)",
                params![
                    event_id,
                    intent.note_id,
                    predecessor.as_ref().map(|value| value.0.as_str()),
                    predecessor.as_ref().map(|value| value.1.as_str()),
                    occurred_at,
                    intent_id,
                ],
            )
            .map_err(|error| error.to_string())?;
        predecessor = Some(("lifecycleEvent".to_string(), event_id.to_string()));
    }

    if content_is_unchanged {
        transaction
            .execute(
                "UPDATE prepared_intents SET status = 'finalized' WHERE intent_id = ?1",
                params![intent_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let source = MutationSource::from_storage_value(&intent.source)
        .ok_or_else(|| format!("Unknown prepared Mutation Source `{}`", intent.source))?;
    append_revision(
        &transaction,
        RevisionAppend {
            revision_id: &intent.revision_id,
            note_id: &intent.note_id,
            predecessor: predecessor
                .as_ref()
                .map(|value| (value.0.as_str(), value.1.as_str())),
            base_revision_id: head.as_ref().and_then(|head| head.revision_id.as_deref()),
            source,
            time_evidence: RevisionTimeEvidence::Committed {
                committed_at_millis: occurred_at,
            },
            authored_payload,
            result_hash: &intent.result_hash,
            intent_id: Some(intent_id),
            path: &intent.target_path,
        },
    )?;
    transaction
        .execute(
            "UPDATE prepared_intents SET status = 'finalized' WHERE intent_id = ?1",
            params![intent_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[derive(Default)]
struct RevisionPolicy {
    replay_count: u64,
    accumulated_delta_bytes: u64,
}

struct PreparedIntent {
    revision_id: String,
    lifecycle_event_id: Option<String>,
    note_id: String,
    target_path: PathBuf,
    source: String,
    authored_payload: Vec<u8>,
    result_hash: String,
    committed_at_millis: u64,
    status: String,
}

struct TimelineHead {
    record_kind: String,
    record_id: String,
    revision_id: Option<String>,
    result_hash: Option<String>,
    current_path: PathBuf,
}

fn load_intent(transaction: &Transaction<'_>, intent_id: &str) -> Result<PreparedIntent, String> {
    transaction
        .query_row(
            "SELECT revision_id, lifecycle_event_id, note_id, target_path, source,
                    authored_payload, result_hash, committed_at_millis, status
             FROM prepared_intents WHERE intent_id = ?1",
            params![intent_id],
            |row| {
                Ok(PreparedIntent {
                    revision_id: row.get(0)?,
                    lifecycle_event_id: row.get(1)?,
                    note_id: row.get(2)?,
                    target_path: PathBuf::from(row.get::<_, String>(3)?),
                    source: row.get(4)?,
                    authored_payload: row.get(5)?,
                    result_hash: row.get(6)?,
                    committed_at_millis: row.get(7)?,
                    status: row.get(8)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

fn load_head(transaction: &Transaction<'_>, note_id: &str) -> Result<Option<TimelineHead>, String> {
    transaction
        .query_row(
            "SELECT record_kind, record_id, revision_id, result_hash, current_path
             FROM timeline_heads WHERE note_id = ?1",
            params![note_id],
            |row| {
                Ok(TimelineHead {
                    record_kind: row.get(0)?,
                    record_id: row.get(1)?,
                    revision_id: row.get(2)?,
                    result_hash: row.get(3)?,
                    current_path: PathBuf::from(row.get::<_, String>(4)?),
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn load_revision_policy(
    connection: &Connection,
    revision_id: &str,
) -> Result<RevisionPolicy, String> {
    connection
        .query_row(
            "SELECT replay_count, accumulated_delta_bytes FROM revisions WHERE revision_id = ?1",
            params![revision_id],
            |row| {
                Ok(RevisionPolicy {
                    replay_count: row.get(0)?,
                    accumulated_delta_bytes: row.get(1)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

fn reconstruct_revision(connection: &Connection, revision_id: &str) -> Result<Vec<u8>, String> {
    let row = connection
        .query_row(
            "SELECT base_revision_id, payload_version, payload_kind, payload, base_hash, result_hash
             FROM revisions WHERE revision_id = ?1",
            params![revision_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let (base_revision_id, payload_version, payload_kind, payload, base_hash, result_hash) = row;
    let result = match payload_kind.as_str() {
        "checkpoint" if payload_version == CHECKPOINT_PAYLOAD_VERSION => {
            zstd::stream::decode_all(Cursor::new(payload))
                .map_err(|error| format!("Decompress Note Revision checkpoint: {error}"))?
        }
        "delta" if payload_version == DELTA_PAYLOAD_VERSION => {
            let base_revision_id = base_revision_id
                .ok_or_else(|| "Delta Note Revision has no base revision".to_string())?;
            let base = reconstruct_revision(connection, &base_revision_id)?;
            if base_hash.as_deref() != Some(hash(&base).as_str()) {
                return Err("Note Revision base hash verification failed".to_string());
            }
            LineDelta::decode(&payload)?.apply(&base)?
        }
        _ => return Err("Unsupported Note Revision payload version".to_string()),
    };
    if hash(&result) != result_hash {
        return Err("Note Revision result hash verification failed".to_string());
    }
    AuthoredState::decode(&result)?;
    Ok(result)
}

fn parse_record_identity(
    kind: Option<String>,
    identity: Option<String>,
) -> Result<Option<TimelineRecordIdentity>, String> {
    match (kind.as_deref(), identity) {
        (None, None) => Ok(None),
        (Some("revision"), Some(identity)) => Ok(Some(TimelineRecordIdentity::Revision(
            RevisionIdentity::from_persisted(identity),
        ))),
        (Some("lifecycleEvent"), Some(identity)) => {
            Ok(Some(TimelineRecordIdentity::LifecycleEvent(
                LifecycleEventIdentity::from_persisted(identity),
            )))
        }
        (kind, identity) => Err(format!(
            "Invalid stored Timeline predecessor kind={kind:?} identity={identity:?}"
        )),
    }
}

fn parse_payload_version(version: i64) -> Result<PayloadVersion, String> {
    match version {
        1 => Ok(PayloadVersion::V1),
        _ => Err(format!("Unknown stored Payload Version `{version}`")),
    }
}

fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn read_u64(encoded: &[u8], offset: usize) -> Result<u64, String> {
    encoded
        .get(offset..offset + 8)
        .ok_or_else(|| "Truncated fixed-width payload field".to_string())?
        .try_into()
        .map(u64::from_le_bytes)
        .map_err(|_| "Invalid fixed-width payload field".to_string())
}

fn managed_note_identity(markdown: &str) -> Result<String, String> {
    crate::note::parse_note(markdown)
        .frontmatter
        .managed
        .map(|metadata| metadata.id)
        .filter(|identity| !identity.trim().is_empty())
        .ok_or_else(|| "Canonical history publication has no managed Note Identity".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authored_state_and_delta_preserve_utf8_line_endings_and_empty_content() {
        let states = [
            AuthoredState {
                unmanaged_frontmatter: Some("project: α\r\n".to_string()),
                body: "Hello 🌍\r\n".to_string(),
            },
            AuthoredState {
                unmanaged_frontmatter: Some("project: β\n".to_string()),
                body: "Replacement 🦀\n".to_string(),
            },
            AuthoredState {
                unmanaged_frontmatter: None,
                body: String::new(),
            },
        ];
        let mut base = Vec::new();
        for state in states {
            let encoded = state.encode();
            let delta = LineDelta::between(&base, &encoded);
            let payload = delta.encode();
            let reconstructed = LineDelta::decode(&payload).unwrap().apply(&base).unwrap();
            assert_eq!(AuthoredState::decode(&reconstructed).unwrap(), state);
            base = reconstructed;
        }
    }

    #[test]
    fn exact_authored_parser_removes_only_managed_frontmatter() {
        let markdown = "---\r\nproject: atlas\r\ngneauxghts:\r\n  id: note-1\r\n  updated_at: now\r\nstatus: active\r\n---\r\n\r\nBody\r\n";
        let state = AuthoredState::from_canonical(markdown);
        assert_eq!(
            state.unmanaged_frontmatter.as_deref(),
            Some("project: atlas\r\nstatus: active\r\n")
        );
        assert_eq!(state.body, "Body\r\n");
    }

    #[test]
    fn reconstruction_rejects_corrupt_payloads_instead_of_returning_prose() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-corruption-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-corruption-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Corrupt.md");
        let markdown = "---\ngneauxghts:\n  id: corrupt-note\n  kind: note\n---\n\nOriginal";

        let history_intent = prepare_publication(
            MutationSource::NoteCreation,
            &path,
            markdown,
            PublicationIntentKind::Create,
            None,
        )
        .unwrap();
        fs::write(&path, markdown).unwrap();
        finalize_publication(
            &history_intent,
            MutationSource::NoteCreation,
            &path,
            markdown,
        )
        .unwrap();
        let note_id = NoteIdentity::new("corrupt-note");
        let revision = revisions(&note_id).unwrap().remove(0);
        let connection = open_store().unwrap();
        let page_size = connection
            .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
            .unwrap();
        let autocheckpoint_pages = connection
            .query_row("PRAGMA wal_autocheckpoint", [], |row| row.get::<_, u64>(0))
            .unwrap();
        assert!(
            32_u64.saturating_add(autocheckpoint_pages.saturating_mul(page_size + 24))
                <= BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES
        );
        assert_eq!(
            connection
                .query_row("PRAGMA journal_size_limit", [], |row| row.get::<_, u64>(0))
                .unwrap(),
            BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES
        );
        connection
            .execute(
                "UPDATE revisions SET payload = ?1 WHERE revision_id = ?2",
                params![vec![0_u8], revision.identity().0],
            )
            .unwrap();

        let error = reconstruct(&note_id, revision.identity()).unwrap_err();
        assert!(error.contains("checkpoint") || error.contains("hash"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn storage_usage_counts_live_sidecars_and_tiny_compaction_skips_a_larger_wal() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-storage-sidecars-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-storage-sidecars-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let connection = open_store().unwrap();
        connection
            .execute_batch(
                "PRAGMA wal_checkpoint(TRUNCATE);
                 CREATE TABLE IF NOT EXISTS storage_usage_probe (payload BLOB NOT NULL);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO storage_usage_probe (payload) VALUES (?1)",
                params![vec![7_u8; 128 * 1024]],
            )
            .unwrap();
        let database_path = history_database_path().unwrap();
        let wal_path = sqlite_sidecar_path(&database_path, "-wal");
        let wal_before = storage_file_bytes(&wal_path).unwrap();
        assert!(wal_before > 1);
        let physical_bytes = sqlite_store_paths(&database_path)
            .into_iter()
            .map(|path| storage_file_bytes(&path).unwrap())
            .sum::<u64>();

        assert_eq!(
            storage_usage_with_connection(&connection)
                .unwrap()
                .allocated_bytes,
            physical_bytes
        );
        compact(1).unwrap();
        assert!(storage_file_bytes(&wal_path).unwrap() >= wal_before);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn opening_schema_five_store_migrates_it_to_incremental_vacuum_without_data_loss() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-schema-five-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-schema-five-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let manifest = crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let database_path = history_database_path().unwrap();
        fs::create_dir_all(database_path.parent().unwrap()).unwrap();
        let legacy = Connection::open(&database_path).unwrap();
        legacy
            .execute_batch(
                "CREATE TABLE history_metadata (
                   singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                   vault_id TEXT NOT NULL,
                   history_format TEXT NOT NULL,
                   history_generation INTEGER NOT NULL,
                   schema_version INTEGER NOT NULL
                 );
                 CREATE TABLE migration_probe (value TEXT NOT NULL);
                 INSERT INTO migration_probe (value) VALUES ('retained');",
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO history_metadata (
                   singleton, vault_id, history_format, history_generation, schema_version
                 ) VALUES (1, ?1, ?2, ?3, 5)",
                params![
                    manifest.vault_id,
                    HISTORY_FORMAT,
                    manifest.history_generation
                ],
            )
            .unwrap();
        assert_eq!(
            legacy
                .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, u64>(0))
                .unwrap(),
            0
        );
        drop(legacy);

        inject_fault_once(FaultPoint::Migration);
        assert!(open_store()
            .unwrap_err()
            .contains("injected schema migration interruption"));
        let interrupted = Connection::open(&database_path).unwrap();
        assert_eq!(
            interrupted
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name = 'deletion_markers'",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            interrupted
                .query_row(
                    "SELECT schema_version FROM history_metadata WHERE singleton = 1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            5
        );
        drop(interrupted);

        let migrated = open_store().unwrap();

        assert_eq!(
            migrated
                .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, u64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            migrated
                .query_row(
                    "SELECT schema_version FROM history_metadata WHERE singleton = 1",
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            HISTORY_SCHEMA_VERSION
        );
        assert_eq!(
            migrated
                .query_row("SELECT value FROM migration_probe", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "retained"
        );
        crate::state::set_notes_root_override(None).unwrap();
    }
}
