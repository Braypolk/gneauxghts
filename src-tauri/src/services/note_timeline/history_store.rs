//! Private SQLite persistence and revision codec for `NoteTimeline`.
//!
//! SQL, WAL policy, row ordering, and checkpoint placement intentionally stop
//! here. The parent module exposes only storage-neutral domain records.

use super::{
    BaselineInitializationPhase, BaselineInitializationProgress, DeletionMarker,
    DeletionOperationIdentity, DeletionScope, HistoryClearBaseline, HistoryDeletionKind,
    HistoryError, HistoryStorageUsage, LifecycleEventHeader, LifecycleEventIdentity,
    LifecycleEventKind, MissingNoteRecord, MutationSource, NoteBaselineInitializationState,
    NoteIdentity, NoteRevisionHeader, PayloadVersion, PreparedHistoryIntent,
    ReconstructedNoteRevision, RevisionIdentity, RevisionTimeEvidence, TimelineRecordIdentity,
    VaultObservation, VaultObservationKind, VaultObservationSource,
    BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES,
};
use rusqlite::OpenFlags;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, DiffOp};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// Concrete selected-vault storage context. It never resolves process-global
/// selection after composition. Clones snapshot the scope for delayed callbacks.
#[derive(Debug)]
pub(super) struct Store {
    vault_root: PathBuf,
    data_dir: PathBuf,
    app_data_dir: PathBuf,
    scope: std::sync::Mutex<Option<(String, u64)>>,
}
impl Clone for Store {
    fn clone(&self) -> Self {
        Self {
            vault_root: self.vault_root.clone(),
            data_dir: self.data_dir.clone(),
            app_data_dir: self.app_data_dir.clone(),
            scope: std::sync::Mutex::new(self.scope.lock().expect("history scope lock").clone()),
        }
    }
}
impl Store {
    pub(super) fn new(vault_root: PathBuf, app_data_dir: PathBuf) -> Result<Self, HistoryError> {
        let scope = crate::state::read_vault_manifest_for(&vault_root)?
            .map(|m| (m.vault_id, m.history_generation));
        Ok(Self {
            data_dir: crate::state::vault_data_dir_for(&vault_root),
            vault_root,
            app_data_dir,
            scope: std::sync::Mutex::new(scope),
        })
    }
    pub(super) fn vault_root(&self) -> &Path {
        &self.vault_root
    }
    pub(super) fn require_path(&self, path: &Path) -> Result<(), HistoryError> {
        let root = fs::canonicalize(&self.vault_root).unwrap_or_else(|_| self.vault_root.clone());
        let mut existing = path;
        while !existing.exists() {
            existing = existing
                .parent()
                .ok_or_else(|| HistoryError::Stale("Note path is outside selected vault".into()))?;
        }
        let resolved = fs::canonicalize(existing).map_err(HistoryError::from)?;
        if !path.is_absolute()
            || !resolved.starts_with(root)
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(HistoryError::Stale(
                "Note path is outside selected vault".into(),
            ));
        }
        Ok(())
    }

    fn validate_scope(&self, manifest: &crate::state::VaultManifest) -> Result<(), HistoryError> {
        let mut scope = self
            .scope
            .lock()
            .map_err(|_| "History scope lock poisoned")?;
        let current = (manifest.vault_id.clone(), manifest.history_generation);
        if scope.as_ref().is_some_and(|expected| expected != &current) {
            let message = if scope
                .as_ref()
                .is_some_and(|(_, generation)| current.1 < *generation)
            {
                "Selected history generation rollback"
            } else {
                "Selected history store generation changed"
            };
            return Err(HistoryError::Stale(message.into()));
        }
        *scope = Some(current);
        Ok(())
    }
    #[cfg(test)]
    pub(super) fn for_test() -> Self {
        Self::new(
            crate::state::vault_root().expect("fixture vault"),
            crate::state::app_data_dir().expect("fixture app data"),
        )
        .expect("fixture store context")
    }
}

const HISTORY_DATABASE_FILE_NAME: &str = "history.sqlite3";
const HISTORY_OBSERVATIONS_FILE_NAME: &str = "note-timeline-history-observations.json";
pub(super) const HISTORY_FORMAT: &str = "sqlite-v1";
pub(super) const INITIAL_HISTORY_GENERATION: u64 = 1;
const HISTORY_SCHEMA_VERSION: u64 = 14;

#[allow(dead_code)]
mod editing_windows;
mod verification;
pub(super) use editing_windows::{CaptureOutcome, PendingWindow, WindowAdmission};
#[cfg(test)]
pub(super) use verification::note_verification_count;
pub(super) use verification::{
    admit_current_store, verification_notes, verify_note, verify_structure,
};
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
static ACTIVE_HISTORY_STORE_SESSIONS: std::sync::Mutex<BTreeSet<PathBuf>> =
    std::sync::Mutex::new(BTreeSet::new());

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
    store_instance_id: Option<String>,
    #[serde(default)]
    clean_close_sequence: u64,
    #[serde(default)]
    allow_missing_store: bool,
    #[serde(default)]
    reset_rebuild_pending: bool,
    last_reset: Option<PersistedHistoryReset>,
}

struct StorePortability {
    instance_id: String,
    clean_close_sequence: u64,
    state: StorePortabilityState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StorePortabilityState {
    Open,
    Portable,
}

impl StorePortabilityState {
    fn parse(value: &str) -> Result<Self, HistoryError> {
        match value {
            "open" => Ok(Self::Open),
            "portable" => Ok(Self::Portable),
            other => Err(format!(
                "Note Timeline history store has invalid portability state `{other}`"
            )
            .into()),
        }
    }
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

pub(super) struct HistoryStoreHealthSnapshot {
    pub(super) initialization: BaselineInitializationProgress,
    pub(super) storage: HistoryStorageUsage,
    pub(super) pending_repairs: u64,
}

pub(super) enum HistoryStoreHealth {
    Available(HistoryStoreHealthSnapshot),
    Unavailable,
    Corrupt,
}

#[cfg(test)]
pub(super) enum HistoryStoreIntegrity {
    Verified,
    Unavailable,
    Corrupt,
}

pub(super) struct NoteHistoryStoreSnapshot {
    pub(super) initialization: NoteBaselineInitializationState,
    pub(super) revision_count: u64,
    pub(super) lifecycle_event_count: u64,
    pub(super) revision_payload_bytes: u64,
}

pub(super) enum NoteHistoryStoreHealth {
    Available(NoteHistoryStoreSnapshot),
    Unavailable,
    Corrupt,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FaultPoint {
    Prepare,
    Finalize,
    ReceiptOutcome,
    PreparationRemoval,
    Recover,
    Baseline,
    Deletion,
    Close,
    Lifecycle,
}

#[cfg(test)]
static NEXT_FAULT: std::sync::Mutex<Option<FaultPoint>> = std::sync::Mutex::new(None);
#[cfg(test)]
static INTEGRITY_SNAPSHOT_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
static HEALTH_SNAPSHOT_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(super) fn diagnostic_scan_counts() -> (usize, usize) {
    (
        integrity_snapshot_count(),
        HEALTH_SNAPSHOT_COUNT.load(std::sync::atomic::Ordering::SeqCst),
    )
}

#[cfg(test)]
pub(super) fn inject_fault_once(point: FaultPoint) {
    *NEXT_FAULT.lock().expect("history fault lock") = Some(point);
}

#[cfg(test)]
pub(super) fn reset_integrity_snapshot_count() {
    INTEGRITY_SNAPSHOT_COUNT.store(0, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
pub(super) fn integrity_snapshot_count() -> usize {
    INTEGRITY_SNAPSHOT_COUNT.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(test)]
pub(super) fn prepared_intent_count(store: &Store, status: &str) -> u64 {
    open_store(store)
        .expect("open history store")
        .query_row(
            "SELECT COUNT(*) FROM publication_receipts WHERE status = ?1",
            params![status],
            |row| row.get(0),
        )
        .expect("count prepared history intents")
}

#[cfg(test)]
pub(super) fn prepared_intent_count_without_opening_store(store: &Store, status: &str) -> u64 {
    Connection::open(history_database_path(store).expect("history database path"))
        .expect("inspect closed history store")
        .query_row(
            "SELECT COUNT(*) FROM publication_receipts WHERE status = ?1",
            params![status],
            |row| row.get(0),
        )
        .expect("count prepared history intents without opening store")
}

#[cfg(test)]
pub(super) fn replace_revision_source(store: &Store, note_id: &NoteIdentity, source: &str) {
    open_store(store)
        .expect("open history store")
        .execute(
            "UPDATE revisions SET source = ?1 WHERE note_id = ?2",
            params![source, note_id.as_str()],
        )
        .expect("replace stored revision source");
}

#[cfg(test)]
pub(super) fn replace_one_revision_source(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    source: &str,
) {
    open_store(store)
        .expect("open history store")
        .execute(
            "UPDATE revisions SET source = ?1 WHERE note_id = ?2 AND revision_id = ?3",
            params![source, note_id.as_str(), revision_id.0],
        )
        .expect("replace one stored revision source");
}

#[cfg(test)]
pub(super) fn replace_lifecycle_kind(store: &Store, note_id: &NoteIdentity, kind: &str) {
    open_store(store)
        .expect("open history store")
        .execute(
            "UPDATE lifecycle_events SET kind = ?1 WHERE note_id = ?2",
            params![kind, note_id.as_str()],
        )
        .expect("replace stored lifecycle kind");
}

#[cfg(test)]
pub(super) fn replace_history_generation(store: &Store, generation: u64) {
    Connection::open(
        Some(store.data_dir.clone())
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
pub(super) fn remove_history_store(store: &Store) {
    let data_dir = store.data_dir.clone();
    ACTIVE_HISTORY_STORE_SESSIONS
        .lock()
        .expect("history store sessions lock")
        .remove(&data_dir.join(HISTORY_DATABASE_FILE_NAME));
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

#[cfg(any(test, feature = "e2e-wdio"))]
pub(super) fn replace_history_store_with_malformed_file_for_test(store: &Store) {
    let database = history_database_path(store).expect("history database path");
    ACTIVE_HISTORY_STORE_SESSIONS
        .lock()
        .expect("history store sessions lock")
        .remove(&database);
    for sidecar in [
        sqlite_sidecar_path(&database, "-wal"),
        sqlite_sidecar_path(&database, "-shm"),
    ] {
        match fs::remove_file(sidecar) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("remove history sidecar fixture: {error}"),
        }
    }
    fs::write(database, b"not a sqlite database").expect("write malformed history store");
}

#[cfg(test)]
pub(super) fn history_store_exists(store: &Store) -> bool {
    Ok::<_, HistoryError>(store.data_dir.clone())
        .expect("vault data directory")
        .join(HISTORY_DATABASE_FILE_NAME)
        .is_file()
}

#[cfg(test)]
pub(super) fn auto_vacuum_mode_for_test(store: &Store) -> u64 {
    open_store(store)
        .expect("open history store")
        .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
        .expect("read history auto-vacuum mode")
}

#[cfg(test)]
pub(super) fn hold_history_store_open_for_test(store: &Store) -> Connection {
    let connection = open_store(store).expect("hold history store open");
    connection
        .pragma_update(None, "wal_autocheckpoint", 0_u64)
        .expect("disable WAL autocheckpoint for recovery fixture");
    connection
}

#[cfg(test)]
pub(super) fn history_database_path_for_test(vault_root: &Path) -> PathBuf {
    crate::state::vault_data_dir_for(vault_root).join(HISTORY_DATABASE_FILE_NAME)
}

#[cfg(test)]
pub(super) fn history_wal_path_for_test(vault_root: &Path) -> PathBuf {
    sqlite_sidecar_path(&history_database_path_for_test(vault_root), "-wal")
}

#[cfg(test)]
pub(super) fn history_shm_path_for_test(vault_root: &Path) -> PathBuf {
    sqlite_sidecar_path(&history_database_path_for_test(vault_root), "-shm")
}

#[cfg(test)]
pub(super) fn baseline_failure_note_ids(store: &Store) -> Vec<String> {
    let connection = open_store(store).expect("open history store");
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
pub(super) fn seed_revision_dependents_for_test(store: &Store, revision_id: &RevisionIdentity) {
    let connection = open_store(store).expect("open history store");
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
pub(super) fn revision_dependent_count_for_test(store: &Store, note_id: &NoteIdentity) -> u64 {
    open_store(store)
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
pub(super) fn replace_lifecycle_payload_version(
    store: &Store,
    note_id: &NoteIdentity,
    version: i64,
) {
    open_store(store)
        .expect("open history store")
        .execute(
            "UPDATE lifecycle_events SET payload_version = ?1 WHERE note_id = ?2",
            params![version, note_id.as_str()],
        )
        .expect("replace stored lifecycle payload version");
}

#[cfg(test)]
pub(super) fn replace_revision_payload_version(
    store: &Store,
    note_id: &NoteIdentity,
    version: i64,
) {
    open_store(store)
        .expect("open history store")
        .execute(
            "UPDATE revisions SET payload_version = ?1 WHERE note_id = ?2",
            params![version, note_id.as_str()],
        )
        .expect("replace stored revision payload version");
}

#[cfg(test)]
pub(super) fn clear_reset_rebuild_marker_for_test(store: &Store) {
    open_store(store)
        .expect("open history store")
        .execute(
            "UPDATE history_reset_rebuild SET pending = 0 WHERE singleton = 1",
            [],
        )
        .expect("clear in-store reset rebuild marker");
}

#[cfg(test)]
pub(super) fn replace_revision_predecessor(
    store: &Store,
    note_id: &NoteIdentity,
    kind: Option<&str>,
    identity: Option<&str>,
) {
    open_store(store)
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

    fn decode(encoded: &[u8]) -> Result<Self, HistoryError> {
        let (frontmatter, body) = Self::decode_parts(encoded)?;
        Ok(Self {
            unmanaged_frontmatter: frontmatter.map(str::to_owned),
            body: body.to_owned(),
        })
    }

    fn decode_parts(encoded: &[u8]) -> Result<(Option<&str>, &str), HistoryError> {
        if encoded.len() < 20 || &encoded[..4] != AUTHORED_STATE_MAGIC {
            return Err(corrupt("Unsupported authored-state payload"));
        }
        let frontmatter_len = read_u64(encoded, 4)?;
        let body_len = usize::try_from(read_u64(encoded, 12)?)
            .map_err(|_| corrupt("Authored body length exceeds this platform"))?;
        let mut cursor = 20usize;
        let unmanaged_frontmatter = if frontmatter_len == u64::MAX {
            None
        } else {
            let len = usize::try_from(frontmatter_len)
                .map_err(|_| corrupt("Authored frontmatter length exceeds this platform"))?;
            let end = cursor
                .checked_add(len)
                .filter(|end| *end <= encoded.len())
                .ok_or_else(|| corrupt("Authored frontmatter payload is truncated"))?;
            let value = std::str::from_utf8(&encoded[cursor..end])
                .map_err(|error| corrupt(format!("Authored frontmatter is not UTF-8: {error}")))?;
            cursor = end;
            Some(value)
        };
        let end = cursor
            .checked_add(body_len)
            .filter(|end| *end == encoded.len())
            .ok_or_else(|| corrupt("Authored body payload length is inconsistent"))?;
        let body = std::str::from_utf8(&encoded[cursor..end])
            .map_err(|error| corrupt(format!("Authored body is not UTF-8: {error}")))?;
        Ok((unmanaged_frontmatter, body))
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

    fn decode(encoded: &[u8]) -> Result<Self, HistoryError> {
        if encoded.len() < 16 || &encoded[..4] != LINE_DELTA_MAGIC {
            return Err(corrupt("Unsupported line-delta payload"));
        }
        let result_len = read_u64(encoded, 4)?;
        let op_count = u32::from_le_bytes(
            encoded[12..16]
                .try_into()
                .map_err(|_| corrupt("Truncated line-delta header"))?,
        ) as usize;
        let mut cursor = 16usize;
        let mut ops = Vec::with_capacity(op_count);
        for _ in 0..op_count {
            if encoded.len().saturating_sub(cursor) < 9 {
                return Err(corrupt("Truncated line-delta operation"));
            }
            let tag = encoded[cursor];
            let len = read_u64(encoded, cursor + 1)?;
            cursor += 9;
            match tag {
                0 => push_op(&mut ops, DeltaOp::Retain(len)),
                1 => push_op(&mut ops, DeltaOp::Delete(len)),
                2 => {
                    let len = usize::try_from(len)
                        .map_err(|_| corrupt("Delta insertion exceeds this platform"))?;
                    let end = cursor
                        .checked_add(len)
                        .filter(|end| *end <= encoded.len())
                        .ok_or_else(|| corrupt("Truncated line-delta insertion"))?;
                    push_op(&mut ops, DeltaOp::Insert(encoded[cursor..end].to_vec()));
                    cursor = end;
                }
                _ => return Err(corrupt("Unknown line-delta operation")),
            }
        }
        if cursor != encoded.len() {
            return Err(corrupt("Trailing bytes in line-delta payload"));
        }
        Ok(Self { ops, result_len })
    }

    fn apply(&self, base: &[u8]) -> Result<Vec<u8>, HistoryError> {
        let expected_len = usize::try_from(self.result_len)
            .map_err(|_| corrupt("Delta result exceeds this platform"))?;
        let mut result = Vec::with_capacity(expected_len);
        let mut cursor = 0usize;
        for operation in &self.ops {
            match operation {
                DeltaOp::Retain(len) => {
                    let len = usize::try_from(*len)
                        .map_err(|_| corrupt("Delta retain exceeds this platform"))?;
                    let end = cursor
                        .checked_add(len)
                        .filter(|end| *end <= base.len())
                        .ok_or_else(|| corrupt("Delta retain exceeds base content"))?;
                    result.extend_from_slice(&base[cursor..end]);
                    cursor = end;
                }
                DeltaOp::Delete(len) => {
                    let len = usize::try_from(*len)
                        .map_err(|_| corrupt("Delta delete exceeds this platform"))?;
                    cursor = cursor
                        .checked_add(len)
                        .filter(|end| *end <= base.len())
                        .ok_or_else(|| corrupt("Delta delete exceeds base content"))?;
                }
                DeltaOp::Insert(bytes) => result.extend_from_slice(bytes),
            }
        }
        if cursor != base.len() || result.len() != expected_len {
            return Err(corrupt(
                "Delta did not consume its base or produce its declared result",
            ));
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

pub(super) fn retain_observation(
    store: &Store,
    observation: &VaultObservation,
) -> Result<i64, HistoryError> {
    let connection = open_store(store)?;
    connection
        .execute(
            "INSERT INTO pending_observations (
               source, kind, path, previous_path, observed_at_millis,
               modified_at_millis, canonical_markdown, missing_retention_days
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
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
                observation.missing_retention_days,
            ],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Retain Note Timeline observation")
        })?;
    Ok(connection.last_insert_rowid())
}

/// Locate observations belonging to the discarded timeline by its durable
/// current path and ordered move continuity. The same selection is used by
/// replay deferral and transactional deletion, so failed deletion loses none.
fn observation_sequences_for_notes(
    connection: &Connection,
    notes: &HashSet<NoteIdentity>,
) -> Result<HashSet<i64>, HistoryError> {
    let mut paths = HashSet::<String>::new();
    for note in notes {
        let path: Option<String> = connection
            .query_row(
                "SELECT current_path FROM timeline_heads WHERE note_id=?1",
                [note.as_str()],
                |r| r.get(0),
            )
            .optional()
            .map_err(HistoryError::from)?;
        if let Some(path) = path {
            paths.insert(path);
        }
    }
    let mut statement = connection
        .prepare("SELECT sequence, path, previous_path, canonical_markdown FROM pending_observations ORDER BY sequence")
        .map_err(HistoryError::from)?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(HistoryError::from)?;
    let mut selected = HashSet::new();
    for row in rows {
        let (sequence, path, previous, canonical) = row.map_err(HistoryError::from)?;
        // Captured identity outranks a reused path. A foreign snapshot also
        // ends the old path's continuity for later identity-less events.
        if let Some(managed) = canonical
            .as_deref()
            .and_then(|text| crate::note::parse_note(text).frontmatter.managed)
        {
            if !notes.contains(&NoteIdentity::new(managed.id)) {
                paths.remove(&path);
                continue;
            }
        }
        if paths.contains(&path) || previous.as_ref().is_some_and(|p| paths.contains(p)) {
            selected.insert(sequence);
            if let Some(previous) = previous {
                paths.remove(&previous);
            }
            paths.insert(path);
        }
    }
    Ok(selected)
}

pub(super) fn discarded_observation_sequences(
    store: &Store,
    notes: &HashSet<NoteIdentity>,
) -> Result<HashSet<i64>, HistoryError> {
    observation_sequences_for_notes(&open_store(store)?, notes)
}

pub(super) fn has_pending_replay(store: &Store) -> Result<bool, HistoryError> {
    Ok(open_store(store)?.query_row(
        "SELECT EXISTS(SELECT 1 FROM pending_observations) OR EXISTS(SELECT 1 FROM pending_deletions)",
        [], |row| row.get(0),
    )?)
}

pub(super) fn retained_observations(
    store: &Store,
) -> Result<Vec<RetainedObservation>, HistoryError> {
    let connection = open_store(store)?;
    let mut statement = connection
        .prepare(
            "SELECT sequence, source, kind, path, previous_path,
                    observed_at_millis, modified_at_millis, canonical_markdown,
                    missing_retention_days
             FROM pending_observations
             ORDER BY sequence ASC",
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Prepare retained Note Timeline observations")
        })?;
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
                row.get::<_, Option<u32>>(8)?,
            ))
        })
        .map_err(|error| {
            HistoryError::from(error).with_context("Read retained Note Timeline observations")
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            HistoryError::from(error).with_context("Decode retained Note Timeline observations")
        })?;

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
                missing_retention_days,
            )| {
                let source = observation_source_from_value(&source).ok_or_else(|| {
                    corrupt(format!(
                        "Unknown retained Note Timeline observation source: {source}"
                    ))
                })?;
                let kind = observation_kind_from_value(&kind).ok_or_else(|| {
                    corrupt(format!(
                        "Unknown retained Note Timeline observation kind: {kind}"
                    ))
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
                        missing_retention_days,
                    },
                })
            },
        )
        .collect()
}

pub(super) fn acknowledge_observation(store: &Store, sequence: i64) -> Result<(), HistoryError> {
    open_store(store)?
        .execute(
            "DELETE FROM pending_observations WHERE sequence = ?1",
            params![sequence],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Acknowledge Note Timeline observation")
        })?;
    Ok(())
}

#[cfg(test)]
pub(super) fn retained_observation_count(store: &Store) -> u64 {
    open_store(store)
        .expect("open history store")
        .query_row("SELECT COUNT(*) FROM pending_observations", [], |row| {
            row.get(0)
        })
        .expect("count retained history observations")
}

// Private durable window operations; runtime admission and boundaries are wired separately.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn pending_windows(store: &Store) -> Result<Vec<PendingWindow>, HistoryError> {
    editing_windows::pending(&open_store(store)?, None)
}

pub(super) fn pending_window(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<Option<PendingWindow>, HistoryError> {
    Ok(editing_windows::pending(&open_store(store)?, Some(note_id.as_str()))?.pop())
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn seal_pending_window(
    store: &Store,
    note_id: &NoteIdentity,
    window_id: &str,
    generation: u64,
) -> Result<Option<RevisionIdentity>, HistoryError> {
    editing_windows::seal(
        &mut open_store(store)?,
        note_id.as_str(),
        window_id,
        generation,
    )
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn release_publication_receipt(
    store: &Store,
    intent: &PreparedHistoryIntent,
) -> Result<(), HistoryError> {
    editing_windows::release(&mut open_store(store)?, intent.as_str())
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn publication_capture_outcome(
    store: &Store,
    intent: &PreparedHistoryIntent,
) -> Result<CaptureOutcome, HistoryError> {
    editing_windows::capture_outcome(&open_store(store)?, intent.as_str())
}

pub(super) fn prepare_publication(
    store: &Store,
    source: MutationSource,
    target_path: &Path,
    markdown: &str,
    kind: PublicationIntentKind,
    baseline: Option<BaselineSeed<'_>>,
) -> Result<PreparedHistoryIntent, HistoryError> {
    if source == MutationSource::Editor
        && kind == PublicationIntentKind::Update
        && baseline
            .as_ref()
            .is_none_or(|seed| seed.path == target_path)
    {
        return Err("Ordinary Editor publication requires Editing Window admission".into());
    }
    prepare_publication_capture(store, source, target_path, markdown, kind, baseline, None)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn prepare_window_publication(
    store: &Store,
    target_path: &Path,
    markdown: &str,
    admission: WindowAdmission,
    baseline: Option<BaselineSeed<'_>>,
) -> Result<PreparedHistoryIntent, HistoryError> {
    prepare_publication_capture(
        store,
        MutationSource::Editor,
        target_path,
        markdown,
        PublicationIntentKind::Update,
        baseline,
        Some(admission),
    )
}

fn prepare_publication_capture(
    store: &Store,
    source: MutationSource,
    target_path: &Path,
    markdown: &str,
    kind: PublicationIntentKind,
    baseline: Option<BaselineSeed<'_>>,
    admission: Option<WindowAdmission>,
) -> Result<PreparedHistoryIntent, HistoryError> {
    store.require_path(target_path)?;
    if let Some(seed) = &baseline {
        store.require_path(seed.path)?;
    }
    if take_prepare_fault() {
        return Err("injected history preparation failure".to_string().into());
    }
    let note_id = crate::note::parse_note(markdown)
        .frontmatter
        .managed
        .map(|metadata| metadata.id)
        .filter(|identity| !identity.trim().is_empty())
        .ok_or_else(|| "History preparation requires a managed Note Identity".to_string())?;
    let authored_payload = AuthoredState::from_canonical(markdown).encode();
    let result_hash = hash(&authored_payload);
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    if let Some(baseline) = baseline.as_ref() {
        append_baseline_if_absent(
            &transaction,
            &NoteIdentity::new(note_id.clone()),
            baseline.path,
            baseline.canonical_markdown,
            baseline.known_since_millis,
        )?;
    }
    let prepared_base = baseline.as_ref().map(|baseline| {
        let payload = AuthoredState::from_canonical(baseline.canonical_markdown).encode();
        PreparedRevisionBase { payload }
    });
    let token = editing_windows::issue_token(&transaction, &note_id)?;
    let intent_id = editing_windows::receipt_key(&token)?;
    editing_windows::register_receipt(&transaction, &token, admission.is_some())?;
    // Point publications reserve a real identity before writing (Version Restore).
    // A window disposition has no public revision identity until it is sealed.
    let revision_id = admission.is_none().then(|| RevisionIdentity::issue().0);
    let prepared_at_millis = match admission.as_ref() {
        Some(admission) => admission.wall_millis,
        None => crate::time::current_time_millis().map_err(|error| {
            HistoryError::from(error).with_context("Issue canonical publication time")
        })?,
    };
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
        .map_err(|error| HistoryError::from(error).with_context("Prepare Note Revision"))?;
    if let Some(admission) = admission {
        editing_windows::prepare(&transaction, &intent_id, &note_id, target_path, admission)?;
    } else {
        editing_windows::require_no_window(&transaction, &note_id)?;
    }
    transaction.commit().map_err(HistoryError::from)?;
    let mut intent = PreparedHistoryIntent::from_persisted(token);
    intent.store = Some(store.clone());
    intent.prepared_base = prepared_base;
    Ok(intent)
}

pub(super) fn finalize_publication(
    store: &Store,
    history_intent: &PreparedHistoryIntent,
    source: MutationSource,
    target_path: &Path,
    canonical_markdown: &str,
) -> Result<(), HistoryError> {
    if take_finalize_fault() {
        return Err("injected history finalization failure".to_string().into());
    }
    let payload = AuthoredState::from_canonical(canonical_markdown).encode();
    let result_hash = hash(&payload);
    let mut connection = open_store(store)?;
    match editing_windows::receipt_outcome(&connection, history_intent.as_str())? {
        super::editing_window_policy::TokenOutcome::ReturnOriginalOutcome => return Ok(()),
        super::editing_window_policy::TokenOutcome::RecoverExactIntent => {}
        other => return Err(format!("History publication token is {other:?}").into()),
    }
    let key = editing_windows::receipt_key(history_intent.as_str())?;
    let intent = connection
        .query_row(
            "SELECT target_path, source, result_hash, status, note_id
             FROM prepared_intents WHERE intent_id = ?1",
            params![key],
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
        .map_err(|error| HistoryError::from(error).with_context("Find prepared Note Revision"))?
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
                editing_windows::abandon(&connection, &key)?;
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
            editing_windows::abandon(&connection, &key)?;
        }
        return Err(
            "Committed note does not match its exact durable history intent"
                .to_string()
                .into(),
        );
    }
    finalize_intent(
        &mut connection,
        &key,
        &payload,
        history_intent.prepared_base.as_ref(),
    )
}

pub(super) fn publication_revision_identity(
    store: &Store,
    history_intent: &PreparedHistoryIntent,
) -> Result<RevisionIdentity, HistoryError> {
    let connection = open_store(store)?;
    match editing_windows::receipt_outcome(&connection, history_intent.as_str())? {
        super::editing_window_policy::TokenOutcome::RecoverExactIntent => {}
        super::editing_window_policy::TokenOutcome::ReturnOriginalOutcome => {
            return match editing_windows::capture_outcome(&connection, history_intent.as_str())? {
                CaptureOutcome::Revision { revision_id } => {
                    Ok(RevisionIdentity::from_persisted(revision_id))
                }
                _ => Err("Publication has no reserved point Revision Identity".into()),
            };
        }
        _ => return Err("Stale or unknown history publication token".into()),
    }
    connection.query_row("SELECT revision_id FROM prepared_intents WHERE intent_id=?1 AND revision_id IS NOT NULL",
        [editing_windows::receipt_key(history_intent.as_str())?], |row| row.get::<_,String>(0))
        .map(RevisionIdentity::from_persisted)
        .map_err(|error| HistoryError::from(error).with_context("Read prepared Note Revision identity"))
}

/// Durable domain evidence, attached before publication so crash finalization
/// retains the exact selected revision even when several revisions share bytes.
pub(super) fn prepare_restore_origin(
    store: &Store,
    intent: &PreparedHistoryIntent,
    selected: &RevisionIdentity,
) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    if editing_windows::receipt_outcome(&connection, intent.as_str())?
        != super::editing_window_policy::TokenOutcome::RecoverExactIntent
    {
        return Err("Version Restore requires an unresolved scoped publication".into());
    }
    let inserted = connection
        .execute(
            "INSERT INTO restore_origins (intent_id, selected_revision_id)
         SELECT intent.intent_id, selected.revision_id
         FROM prepared_intents intent JOIN revisions selected
           ON selected.note_id = intent.note_id AND selected.result_hash = intent.result_hash
         WHERE intent.intent_id = ?1 AND selected.revision_id = ?2
           AND intent.status = 'prepared' AND intent.source = 'versionRestore'",
            params![editing_windows::receipt_key(intent.as_str())?, selected.0],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Prepare Version Restore lineage")
        })?;
    if inserted != 1 {
        return Err("Version Restore lineage does not match the prepared authored state".into());
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn restore_origin(
    store: &Store,
    revision: &RevisionIdentity,
) -> Result<Option<RevisionIdentity>, HistoryError> {
    Ok(open_store(store)?
        .query_row(
            "SELECT origin.selected_revision_id FROM restore_origins origin
         JOIN revisions revision ON revision.intent_id = origin.intent_id
         WHERE revision.revision_id = ?1",
            params![revision.0],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map(|value| value.map(RevisionIdentity::from_persisted))
        .map_err(|error| HistoryError::from(error).with_context("Read Version Restore lineage"))?)
}

pub(super) fn abandon_publication(
    store: &Store,
    history_intent: &PreparedHistoryIntent,
) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    match editing_windows::receipt_outcome(&connection, history_intent.as_str())? {
        super::editing_window_policy::TokenOutcome::Stale
        | super::editing_window_policy::TokenOutcome::Unknown => {
            return Err("Stale or unknown history publication token".into());
        }
        _ => {}
    }
    editing_windows::abandon(
        &connection,
        &editing_windows::receipt_key(history_intent.as_str())?,
    )
}

pub(super) fn record_baseline_revision_if_absent(
    store: &Store,
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    known_since_millis: u64,
) -> Result<bool, HistoryError> {
    #[cfg(test)]
    if take_fault(FaultPoint::Baseline) {
        return Err("injected Baseline Revision failure".to_string().into());
    }
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    let inserted = append_baseline_if_absent(
        &transaction,
        note_id,
        path,
        canonical_markdown,
        known_since_millis,
    )?;
    transaction.commit().map_err(HistoryError::from)?;
    Ok(inserted)
}

fn append_baseline_if_absent(
    transaction: &Transaction<'_>,
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    known_since_millis: u64,
) -> Result<bool, HistoryError> {
    let head = load_head(transaction, note_id.as_str())?;
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
        transaction,
        RevisionAppend {
            prepared_base: None,
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
            record_count: head.as_ref().map_or(1, |head| head.record_count + 1),
        },
    )?;
    Ok(true)
}

pub(super) fn record_external_revision(
    store: &Store,
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    observed_at_millis: u64,
    modified_at_millis: Option<u64>,
) -> Result<(), HistoryError> {
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    editing_windows::require_no_window(&transaction, note_id.as_str())?;
    let authored_payload = AuthoredState::from_canonical(canonical_markdown).encode();
    let result_hash = hash(&authored_payload);
    let head = load_head(&transaction, note_id.as_str())?;
    if head.as_ref().and_then(|head| head.result_hash.as_deref()) == Some(result_hash.as_str()) {
        transaction.commit().map_err(HistoryError::from)?;
        return Ok(());
    }

    append_revision(
        &transaction,
        RevisionAppend {
            prepared_base: None,
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
            record_count: head.as_ref().map_or(1, |head| head.record_count + 1),
        },
    )?;
    Ok(transaction.commit().map_err(HistoryError::from)?)
}

pub(super) fn record_observed_lifecycle_event(
    store: &Store,
    note_id: &NoteIdentity,
    kind: LifecycleEventKind,
    previous_path: Option<&Path>,
    path: &Path,
    occurred_at_millis: u64,
) -> Result<(), HistoryError> {
    if kind == LifecycleEventKind::Missing {
        return Err(
            "Missing lifecycle evidence requires a captured recovery record"
                .to_string()
                .into(),
        );
    }
    record_observed_lifecycle_event_with_missing_record(
        store,
        note_id,
        kind,
        previous_path,
        path,
        occurred_at_millis,
        None,
    )
}

pub(super) fn record_observed_missing_lifecycle_event(
    store: &Store,
    record: &MissingNoteRecord,
) -> Result<(), HistoryError> {
    record_observed_lifecycle_event_with_missing_record(
        store,
        record.note_id(),
        LifecycleEventKind::Missing,
        None,
        record.path(),
        record.missing_at_millis(),
        Some(record),
    )
}

fn record_observed_lifecycle_event_with_missing_record(
    store: &Store,
    note_id: &NoteIdentity,
    kind: LifecycleEventKind,
    previous_path: Option<&Path>,
    path: &Path,
    occurred_at_millis: u64,
    missing_record: Option<&MissingNoteRecord>,
) -> Result<(), HistoryError> {
    #[cfg(test)]
    if take_fault(FaultPoint::Lifecycle) {
        return Err("injected lifecycle finalization failure".to_string().into());
    }
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    reject_purged_note_identity(&transaction, note_id.as_str())?;
    editing_windows::require_no_window(&transaction, note_id.as_str())?;
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
                .map_err(HistoryError::from)?
                .is_some();
            if duplicate {
                synchronize_missing_record(&transaction, note_id, kind, missing_record)?;
                transaction.commit().map_err(HistoryError::from)?;
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
        .map_err(|error| {
            HistoryError::from(error).with_context("Record observed Lifecycle Event")
        })?;
    transaction
        .execute(
            "INSERT INTO timeline_heads (
               note_id, record_kind, record_id, revision_id, result_hash, current_path,
               record_count
             ) VALUES (?1, 'lifecycleEvent', ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(note_id) DO UPDATE SET
               record_kind = excluded.record_kind,
               record_id = excluded.record_id,
               revision_id = excluded.revision_id,
               result_hash = excluded.result_hash,
               current_path = excluded.current_path,
               record_count = excluded.record_count",
            params![
                note_id.as_str(),
                event_id,
                head.as_ref().and_then(|value| value.revision_id.as_deref()),
                head.as_ref().and_then(|value| value.result_hash.as_deref()),
                path.to_string_lossy().into_owned(),
                head.as_ref().map_or(1, |head| head.record_count + 1),
            ],
        )
        .map_err(HistoryError::from)?;
    synchronize_missing_record(&transaction, note_id, kind, missing_record)?;
    Ok(transaction.commit().map_err(HistoryError::from)?)
}

fn synchronize_missing_record(
    transaction: &Transaction<'_>,
    note_id: &NoteIdentity,
    kind: LifecycleEventKind,
    missing_record: Option<&MissingNoteRecord>,
) -> Result<(), HistoryError> {
    match kind {
        LifecycleEventKind::Missing => {
            let record = missing_record
                .ok_or_else(|| "Missing lifecycle event has no retention evidence".to_string())?;
            if record.note_id != *note_id {
                return Err(
                    "Missing lifecycle retention identity does not match its timeline"
                        .to_string()
                        .into(),
                );
            }
            transaction
                .execute(
                    "INSERT OR IGNORE INTO missing_notes (
                       note_id, path, title, missing_at_millis, retention_days, purge_at_millis
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        note_id.as_str(),
                        record.path.to_string_lossy().into_owned(),
                        record.title.as_str(),
                        record.missing_at_millis,
                        record.retention_days,
                        record.purge_at_millis,
                    ],
                )
                .map_err(|error| {
                    HistoryError::from(error).with_context("Capture Missing Note recovery deadline")
                })?;
        }
        LifecycleEventKind::Reattached | LifecycleEventKind::Recovered => {
            transaction
                .execute(
                    "DELETE FROM missing_notes WHERE note_id = ?1",
                    params![note_id.as_str()],
                )
                .map_err(|error| {
                    HistoryError::from(error).with_context("Complete Missing Note recovery")
                })?;
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn missing_notes(store: &Store) -> Result<Vec<MissingNoteRecord>, HistoryError> {
    let connection = open_store(store)?;
    let mut statement = connection
        .prepare(
            "SELECT note_id, path, title, missing_at_millis, retention_days, purge_at_millis
             FROM missing_notes
             ORDER BY missing_at_millis DESC, note_id ASC",
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Prepare Missing Note recovery list")
        })?;
    let records = statement
        .query_map([], |row| {
            Ok(MissingNoteRecord {
                note_id: NoteIdentity::new(row.get::<_, String>(0)?),
                path: PathBuf::from(row.get::<_, String>(1)?),
                title: row.get(2)?,
                missing_at_millis: row.get(3)?,
                retention_days: row.get(4)?,
                purge_at_millis: row.get(5)?,
            })
        })
        .map_err(|error| HistoryError::from(error).with_context("Read Missing Note recovery list"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            HistoryError::from(error).with_context("Decode Missing Note recovery list")
        })?;
    Ok(records)
}

pub(super) fn missing_note(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<Option<MissingNoteRecord>, HistoryError> {
    let connection = open_store(store)?;
    Ok(connection
        .query_row(
            "SELECT path, title, missing_at_millis, retention_days, purge_at_millis
             FROM missing_notes WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| {
                Ok(MissingNoteRecord {
                    note_id: note_id.clone(),
                    path: PathBuf::from(row.get::<_, String>(0)?),
                    title: row.get(1)?,
                    missing_at_millis: row.get(2)?,
                    retention_days: row.get(3)?,
                    purge_at_millis: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Missing Note recovery state")
        })?)
}

// A candidate captured for one prepared publication, never a cross-operation cache.
// The append transaction verifies its hash against the exact current base revision.
pub(super) struct PreparedRevisionBase {
    payload: Vec<u8>,
}

struct RevisionAppend<'a> {
    prepared_base: Option<&'a PreparedRevisionBase>,
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
    record_count: usize,
}

#[cfg(test)]
thread_local! {
    static APPEND_TIMINGS: std::cell::RefCell<Option<Vec<(&'static str, f64)>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(super) fn begin_append_measurement() {
    APPEND_TIMINGS.with(|samples| *samples.borrow_mut() = Some(Vec::new()));
}

#[cfg(test)]
pub(super) fn take_append_measurement() -> Vec<(&'static str, f64)> {
    APPEND_TIMINGS.with(|samples| samples.borrow_mut().take().unwrap_or_default())
}

#[cfg(test)]
fn record_append_stage(name: &'static str, started: Instant) {
    APPEND_TIMINGS.with(|samples| {
        if let Some(samples) = samples.borrow_mut().as_mut() {
            samples.push((name, started.elapsed().as_secs_f64() * 1000.0));
        }
    });
}

fn append_revision(
    transaction: &Transaction<'_>,
    append: RevisionAppend<'_>,
) -> Result<(), HistoryError> {
    reject_purged_note_identity(transaction, append.note_id)?;
    #[cfg(test)]
    let stage = Instant::now();
    let base =
        append
            .base_revision_id
            .map(|revision_id| {
                if let Some(candidate) = append.prepared_base {
                    let expected: String = transaction.query_row(
                    "SELECT result_hash FROM revisions WHERE revision_id = ?1 AND note_id = ?2",
                    params![revision_id, append.note_id], |row| row.get(0)
                ).map_err(HistoryError::from)?;
                    if hash(&candidate.payload) == expected {
                        return Ok(candidate.payload.clone());
                    }
                }
                reconstruct_revision(transaction, revision_id)
            })
            .transpose()?
            .unwrap_or_default();
    #[cfg(test)]
    record_append_stage("base_reconstruction", stage);
    #[cfg(test)]
    let stage = Instant::now();
    let delta = LineDelta::between(&base, append.authored_payload).encode();
    #[cfg(test)]
    record_append_stage("delta_encoding", stage);
    #[cfg(test)]
    let stage = Instant::now();
    let prior_policy = append
        .base_revision_id
        .map(|revision_id| load_revision_policy(transaction, revision_id))
        .transpose()?
        .unwrap_or_default();
    let replay_started = Instant::now();
    let replay_result = LineDelta::decode(&delta)?.apply(&base)?;
    let replay_elapsed = replay_started.elapsed();
    if replay_result != append.authored_payload {
        return Err(
            "Encoded Note Revision did not reconstruct its intended state"
                .to_string()
                .into(),
        );
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
                zstd::stream::encode_all(Cursor::new(append.authored_payload), 3).map_err(
                    |error| {
                        HistoryError::from(error).with_context("Compress Note Revision checkpoint")
                    },
                )?,
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
    #[cfg(test)]
    record_append_stage("verify_and_compress", stage);
    let (known_since_millis, committed_at_millis, observed_at_millis, modified_at_millis) =
        match append.time_evidence {
            RevisionTimeEvidence::Baseline { known_since_millis } => {
                (Some(known_since_millis), None, None, None)
            }
            RevisionTimeEvidence::Committed {
                committed_at_millis,
            } => (None, Some(committed_at_millis), None, None),
            RevisionTimeEvidence::EditingWindow { .. } => {
                return Err(
                    "Editing Window evidence must be appended by window finalization".into(),
                )
            }
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
        .map_err(|error| HistoryError::from(error).with_context("Append Note Revision"))?;
    transaction
        .execute(
            "INSERT INTO timeline_heads (
               note_id, record_kind, record_id, revision_id, result_hash, current_path,
               record_count
             ) VALUES (?1, 'revision', ?2, ?2, ?3, ?4, ?5)
             ON CONFLICT(note_id) DO UPDATE SET
               record_kind = excluded.record_kind,
               record_id = excluded.record_id,
               revision_id = excluded.revision_id,
               result_hash = excluded.result_hash,
               current_path = excluded.current_path,
               record_count = excluded.record_count",
            params![
                append.note_id,
                append.revision_id,
                append.result_hash,
                append.path.to_string_lossy().into_owned(),
                append.record_count,
            ],
        )
        .map_err(HistoryError::from)?;
    Ok(())
}

fn reject_purged_note_identity(connection: &Connection, note_id: &str) -> Result<(), HistoryError> {
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
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Note Timeline purge boundary")
        })?
        .is_some();
    if purged {
        return Err("Purged Note Identity cannot acquire new timeline records"
            .to_string()
            .into());
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
    store: &Store,
    progress: &BaselineInitializationProgress,
) -> Result<(), HistoryError> {
    open_store(store)?
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
        .map_err(|error| {
            HistoryError::from(error)
                .with_context("Store Baseline Revision initialization progress")
        })?;
    Ok(())
}

pub(super) fn baseline_initialization_progress(
    store: &Store,
) -> Result<BaselineInitializationProgress, HistoryError> {
    baseline_initialization_progress_with_connection(&open_store(store)?)
}

fn baseline_initialization_progress_with_connection(
    connection: &Connection,
) -> Result<BaselineInitializationProgress, HistoryError> {
    let stored = connection
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
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Baseline Revision initialization progress")
        })?;
    let phase = baseline_phase_from_value(&stored.0).ok_or_else(|| {
        corrupt(format!(
            "Unknown Baseline Revision initialization phase `{}`",
            stored.0
        ))
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
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<NoteBaselineInitializationState, HistoryError> {
    let connection = open_store(store)?;
    note_baseline_initialization_state_with_connection(&connection, note_id)
}

fn note_baseline_initialization_state_with_connection(
    connection: &Connection,
    note_id: &NoteIdentity,
) -> Result<NoteBaselineInitializationState, HistoryError> {
    let failure = connection
        .query_row(
            "SELECT error FROM baseline_initialization_failures WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| {
            HistoryError::from(error).with_context("Read per-note Baseline Revision failure")
        })?;
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
        .map_err(|error| {
            HistoryError::from(error).with_context("Read per-note Baseline Revision state")
        })?;
    Ok(match root_revision {
        Some((source, known_since_millis)) => {
            let source = MutationSource::from_storage_value(&source)
                .ok_or_else(|| corrupt(format!("Unknown stored Mutation Source `{source}`")))?;
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
    store: &Store,
    note_id: &NoteIdentity,
    path: &Path,
    error: &str,
) -> Result<(), HistoryError> {
    open_store(store)?
        .execute(
            "INSERT INTO baseline_initialization_failures (note_id, path, error)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(note_id) DO UPDATE SET path = excluded.path, error = excluded.error",
            params![note_id.as_str(), path.to_string_lossy().into_owned(), error],
        )
        .map_err(|store_error| {
            HistoryError::from(store_error).with_context("Record Baseline Revision failure")
        })?;
    Ok(())
}

pub(super) fn clear_baseline_initialization_failure(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<(), HistoryError> {
    open_store(store)?
        .execute(
            "DELETE FROM baseline_initialization_failures WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Clear Baseline Revision failure")
        })?;
    Ok(())
}

fn verify_editor_revision_format(
    connection: &Connection,
    note: &str,
    revision: Option<&str>,
) -> Result<(), HistoryError> {
    let query = format!("SELECT EXISTS(SELECT 1 FROM revisions r WHERE r.note_id=?1
           {} AND r.source='editor'
           AND NOT EXISTS(SELECT 1 FROM revision_window_evidence w WHERE w.revision_id=r.revision_id)
           AND NOT EXISTS(SELECT 1 FROM lifecycle_events e WHERE
             r.predecessor_kind='lifecycleEvent' AND e.event_id=r.predecessor_id
             AND e.note_id=r.note_id AND e.kind IN ('created','renamed','moved')
             AND e.occurred_at_millis=r.committed_at_millis))",
           if revision.is_some() { "AND r.revision_id=?2" } else { "" });
    let invalid: bool = if let Some(revision) = revision {
        connection.query_row(&query, params![note, revision], |r| r.get(0))
    } else {
        connection.query_row(&query, [note], |r| r.get(0))
    }
    .map_err(HistoryError::from)?;
    if invalid {
        Err(corrupt("Unsupported granular Editor revision; rebuild history with the confirmed Settings reset"))
    } else {
        Ok(())
    }
}

struct StoredRevisionHeader {
    revision_id: String,
    predecessor_kind: Option<String>,
    predecessor_id: Option<String>,
    source: String,
    base_revision_id: Option<String>,
    known_since_millis: Option<u64>,
    committed_at_millis: Option<u64>,
    observed_at_millis: Option<u64>,
    modified_at_millis: Option<u64>,
    payload_version: i64,
    content_hash: String,
    restored_from: Option<String>,
    window_evidence: Option<String>,
}

impl StoredRevisionHeader {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            revision_id: row.get(0)?,
            predecessor_kind: row.get(1)?,
            predecessor_id: row.get(2)?,
            source: row.get(3)?,
            base_revision_id: row.get(4)?,
            known_since_millis: row.get(5)?,
            committed_at_millis: row.get(6)?,
            observed_at_millis: row.get(7)?,
            modified_at_millis: row.get(8)?,
            payload_version: row.get(9)?,
            content_hash: row.get(10)?,
            restored_from: row.get(11)?,
            window_evidence: row.get(12)?,
        })
    }

    fn into_domain(
        self,
        note_id: &NoteIdentity,
        connection: &Connection,
    ) -> Result<(Option<String>, NoteRevisionHeader), HistoryError> {
        let source = MutationSource::from_storage_value(&self.source)
            .ok_or_else(|| corrupt(format!("Unknown stored Mutation Source `{}`", self.source)))?;
        if source == MutationSource::Editor && self.window_evidence.is_none() {
            verify_editor_revision_format(connection, note_id.as_str(), Some(&self.revision_id))?;
        }
        editing_windows::verify_retained_revision(connection, &self.revision_id)?;
        let time_evidence = match (
            self.known_since_millis,
            self.committed_at_millis,
            self.observed_at_millis,
        ) {
            (Some(known_since_millis), None, None) => {
                RevisionTimeEvidence::Baseline { known_since_millis }
            }
            (None, Some(committed_at_millis), None) => RevisionTimeEvidence::Committed {
                committed_at_millis,
            },
            (None, None, Some(observed_at_millis)) => RevisionTimeEvidence::Observed {
                observed_at_millis,
                modified_at_millis: self.modified_at_millis,
            },
            _ => return Err(corrupt("Stored Note Revision has invalid time evidence")),
        };
        let time_evidence = if let Some(json) = self.window_evidence {
            let evidence: editing_windows::WindowEvidence = serde_json::from_str(&json)
                .map_err(|e| corrupt(format!("Invalid Editing Window evidence: {e}")))?;
            evidence.validate()?;
            if source != MutationSource::Editor
                || self.committed_at_millis != Some(evidence.last_wall_millis)
            {
                return Err(corrupt(
                    "Editing Window evidence does not match its revision",
                ));
            }
            evidence.time_evidence()
        } else {
            time_evidence
        };
        Ok((
            self.base_revision_id,
            NoteRevisionHeader {
                identity: RevisionIdentity::from_persisted(self.revision_id),
                note_identity: note_id.clone(),
                predecessor: parse_record_identity(self.predecessor_kind, self.predecessor_id)?,
                payload_version: parse_payload_version(self.payload_version)?,
                source,
                time_evidence,
                content_hash: self.content_hash,
                restored_from: self.restored_from.map(RevisionIdentity::from_persisted),
            },
        ))
    }
}

struct StoredLifecycleHeader {
    event_id: String,
    predecessor_kind: Option<String>,
    predecessor_id: Option<String>,
    kind: String,
    occurred_at_millis: u64,
    previous_path: Option<String>,
    path: Option<String>,
    payload_version: i64,
}

impl StoredLifecycleHeader {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            event_id: row.get(0)?,
            predecessor_kind: row.get(1)?,
            predecessor_id: row.get(2)?,
            kind: row.get(3)?,
            occurred_at_millis: row.get(4)?,
            previous_path: row.get(5)?,
            path: row.get(6)?,
            payload_version: row.get(7)?,
        })
    }

    fn into_domain(self, note_id: &NoteIdentity) -> Result<LifecycleEventHeader, HistoryError> {
        let kind = LifecycleEventKind::from_storage_value(&self.kind).ok_or_else(|| {
            corrupt(format!(
                "Unknown stored Lifecycle Event Kind `{}`",
                self.kind
            ))
        })?;
        Ok(LifecycleEventHeader {
            identity: LifecycleEventIdentity::from_persisted(self.event_id),
            note_identity: note_id.clone(),
            predecessor: parse_record_identity(self.predecessor_kind, self.predecessor_id)?,
            payload_version: parse_payload_version(self.payload_version)?,
            kind,
            occurred_at_millis: self.occurred_at_millis,
            previous_path: self.previous_path.map(PathBuf::from),
            path: self.path.map(PathBuf::from),
        })
    }
}

pub(super) fn revisions(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<Vec<NoteRevisionHeader>, HistoryError> {
    let connection = open_store(store)?;
    let mut statement = connection
        .prepare(
            "SELECT revision_id, predecessor_kind, predecessor_id, source, base_revision_id,
                    known_since_millis, committed_at_millis, observed_at_millis,
                    modified_at_millis, payload_version, result_hash,
                    (SELECT selected_revision_id FROM restore_origins
                     WHERE restore_origins.intent_id = revisions.intent_id),
                    (SELECT evidence FROM revision_window_evidence e WHERE e.revision_id = revisions.revision_id)
             FROM revisions WHERE note_id = ?1",
        )
        .map_err(HistoryError::from)?;
    let revisions = statement
        .query_map(params![note_id.as_str()], StoredRevisionHeader::from_row)
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?
        .into_iter()
        .map(|stored| stored.into_domain(note_id, &connection))
        .collect::<Result<Vec<_>, HistoryError>>()?;
    order_revision_chain(revisions)
}

/// One storage-neutral timeline record loaded by following the durable
/// predecessor chain. A page never materializes headers outside its bound.
pub(super) enum BoundedTimelineRecord {
    Revision {
        header: NoteRevisionHeader,
        label: Option<String>,
    },
    LifecycleEvent(LifecycleEventHeader),
}

impl BoundedTimelineRecord {
    fn predecessor(&self) -> Option<TimelineRecordIdentity> {
        match self {
            Self::Revision { header, .. } => header.predecessor.clone(),
            Self::LifecycleEvent(event) => event.predecessor.clone(),
        }
    }
    fn identity(&self) -> TimelineRecordIdentity {
        match self {
            Self::Revision { header, .. } => {
                TimelineRecordIdentity::Revision(header.identity.clone())
            }
            Self::LifecycleEvent(event) => {
                TimelineRecordIdentity::LifecycleEvent(event.identity.clone())
            }
        }
    }
}

pub(super) struct BoundedTimelinePage {
    pub(super) records: Vec<BoundedTimelineRecord>,
    pub(super) next_record: Option<TimelineRecordIdentity>,
    pub(super) total_records: usize,
}

fn bounded_revision_record(
    connection: &Connection,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
) -> Result<Option<BoundedTimelineRecord>, HistoryError> {
    let stored = connection
        .query_row(
            "SELECT revisions.revision_id, revisions.predecessor_kind,
                    revisions.predecessor_id, revisions.source, revisions.base_revision_id,
                    revisions.known_since_millis, revisions.committed_at_millis,
                    revisions.observed_at_millis, revisions.modified_at_millis,
                    revisions.payload_version, revisions.result_hash,
                    (SELECT selected_revision_id FROM restore_origins
                     WHERE restore_origins.intent_id = revisions.intent_id),
                    (SELECT evidence FROM revision_window_evidence e WHERE e.revision_id = revisions.revision_id),
                    (SELECT label FROM named_revision_labels labels
                     WHERE labels.revision_id = revisions.revision_id
                     ORDER BY labels.label_id LIMIT 1)
             FROM revisions
             WHERE revisions.note_id = ?1 AND revisions.revision_id = ?2",
            params![note_id.as_str(), revision_id.0],
            |row| Ok((StoredRevisionHeader::from_row(row)?, row.get(13)?)),
        )
        .optional()
        .map_err(|error| HistoryError::from(error).with_context("Read bounded Note Revision header"))?;
    let Some((stored, label)) = stored else {
        return Ok(None);
    };
    let (_, header) = stored.into_domain(note_id, connection)?;
    Ok(Some(BoundedTimelineRecord::Revision { header, label }))
}

fn bounded_lifecycle_record(
    connection: &Connection,
    note_id: &NoteIdentity,
    event_id: &LifecycleEventIdentity,
) -> Result<Option<BoundedTimelineRecord>, HistoryError> {
    let stored = connection
        .query_row(
            "SELECT event_id, predecessor_kind, predecessor_id, kind, occurred_at_millis,
                    previous_path, path, payload_version
             FROM lifecycle_events WHERE note_id = ?1 AND event_id = ?2",
            params![note_id.as_str(), event_id.0],
            StoredLifecycleHeader::from_row,
        )
        .optional()
        .map_err(|error| {
            HistoryError::from(error).with_context("Read bounded Lifecycle Event header")
        })?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    Ok(Some(BoundedTimelineRecord::LifecycleEvent(
        stored.into_domain(note_id)?,
    )))
}

fn bounded_timeline_record(
    connection: &Connection,
    note_id: &NoteIdentity,
    identity: &TimelineRecordIdentity,
) -> Result<Option<BoundedTimelineRecord>, HistoryError> {
    match identity {
        TimelineRecordIdentity::Revision(revision_id) => {
            bounded_revision_record(connection, note_id, revision_id)
        }
        TimelineRecordIdentity::LifecycleEvent(event_id) => {
            bounded_lifecycle_record(connection, note_id, event_id)
        }
    }
}

pub(super) fn bounded_timeline_page(
    store: &Store,
    note_id: &NoteIdentity,
    start: Option<TimelineRecordIdentity>,
    limit: usize,
) -> Result<Option<BoundedTimelinePage>, HistoryError> {
    let connection = open_store(store)?;
    let page_size = limit.clamp(1, 100);
    let head = connection
        .query_row(
            "SELECT record_kind, record_id, record_count
             FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, usize>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| {
            HistoryError::from(error).with_context("Read bounded Note Timeline head")
        })?;
    let total_records = head.as_ref().map_or(0, |(_, _, count)| *count);
    let is_continuation = start.is_some();
    let mut next_record = match start {
        Some(start) => Some(start),
        None => head
            .map(|(kind, identity, _)| parse_record_identity(Some(kind), Some(identity)))
            .transpose()?
            .flatten(),
    };
    let mut records = Vec::with_capacity(page_size + 1);
    for _ in 0..=page_size {
        let Some(identity) = next_record.take() else {
            break;
        };
        let record = bounded_timeline_record(&connection, note_id, &identity)?;
        let Some(record) = record else {
            return if is_continuation && records.is_empty() {
                Ok(None)
            } else {
                Err(corrupt(
                    "Note Timeline record lineage is missing or disconnected",
                ))
            };
        };
        next_record = match &record {
            BoundedTimelineRecord::Revision { header, .. } => header.predecessor.clone(),
            BoundedTimelineRecord::LifecycleEvent(event) => event.predecessor.clone(),
        };
        records.push(record);
    }
    if records.len() > page_size {
        next_record = Some(
            records
                .pop()
                .expect("bounded page includes next record")
                .identity(),
        );
    }
    Ok(Some(BoundedTimelinePage {
        records,
        next_record,
        total_records,
    }))
}

// Rebuildable access paths over explicit predecessor identity, never row order or time.
const SUCCESSOR_QUERY: &str = "SELECT 'revision', revision_id FROM revisions
    WHERE note_id = ?1 AND predecessor_kind = ?2 AND predecessor_id = ?3
    UNION ALL SELECT 'lifecycleEvent', event_id FROM lifecycle_events
    WHERE note_id = ?1 AND predecessor_kind = ?2 AND predecessor_id = ?3 LIMIT 2";

fn bounded_successor(
    connection: &Connection,
    note_id: &NoteIdentity,
    identity: &TimelineRecordIdentity,
) -> Result<Option<TimelineRecordIdentity>, HistoryError> {
    let (kind, id) = match identity {
        TimelineRecordIdentity::Revision(id) => ("revision", id.as_str()),
        TimelineRecordIdentity::LifecycleEvent(id) => ("lifecycleEvent", id.0.as_str()),
    };
    let mut statement = connection.prepare(SUCCESSOR_QUERY)?;
    let mut rows = statement.query(params![note_id.as_str(), kind, id])?;
    let first = rows
        .next()?
        .map(|row| Ok::<_, rusqlite::Error>((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .transpose()?;
    if rows.next()?.is_some() {
        return Err(corrupt("Note Timeline has ambiguous successors"));
    }
    first
        .map(|(kind, id)| parse_record_identity(Some(kind), Some(id)))
        .transpose()
        .map(Option::flatten)
}

pub(super) struct BoundedRevisionContext {
    pub(super) records: Vec<BoundedTimelineRecord>,
    pub(super) first_ordinal: i64,
    pub(super) older: Option<TimelineRecordIdentity>,
    pub(super) newer: Option<TimelineRecordIdentity>,
}

/// A fixed viewport in coordinates relative to an immutable revision. No rank,
/// count, timestamp sort, OFFSET, or traversal from the current head is needed.
pub(super) fn bounded_revision_context(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    continuation: Option<(TimelineRecordIdentity, i64, bool)>,
) -> Result<BoundedRevisionContext, HistoryError> {
    const CONTEXT_ROWS: usize = 31;
    let connection = open_store(store)?;
    let anchor = TimelineRecordIdentity::Revision(revision_id.clone());
    // Revalidate the anchor on every page, including after clear or purge.
    if bounded_timeline_record(&connection, note_id, &anchor)?.is_none() {
        return Err(HistoryError::Missing(
            "Cited Note Revision is no longer retained".into(),
        ));
    }
    let is_continuation = continuation.is_some();
    let (mut start, mut ordinal, newer) = match continuation {
        Some(cursor) => cursor,
        None => {
            let mut start = anchor;
            let mut ordinal = 0;
            for _ in 0..CONTEXT_ROWS / 2 {
                let Some(next) = bounded_successor(&connection, note_id, &start)? else {
                    break;
                };
                start = next;
                ordinal += 1;
            }
            (start, ordinal, false)
        }
    };
    let mut records = Vec::with_capacity(CONTEXT_ROWS);
    for index in 0..CONTEXT_ROWS {
        let record = bounded_timeline_record(&connection, note_id, &start)?.ok_or_else(|| {
            if is_continuation && index == 0 {
                HistoryError::Stale("History context continuation is no longer retained".into())
            } else {
                corrupt("Note Timeline context lineage is missing or disconnected")
            }
        })?;
        let next = if newer {
            bounded_successor(&connection, note_id, &start)?
        } else {
            record.predecessor()
        };
        records.push(record);
        if index + 1 == CONTEXT_ROWS {
            break;
        }
        let Some(next) = next else {
            break;
        };
        start = next;
        ordinal = ordinal
            .checked_add(if newer { 1 } else { -1 })
            .ok_or_else(|| HistoryError::Stale("Invalid history context position".into()))?;
    }
    if newer {
        records.reverse();
    }
    let first_ordinal = if newer {
        ordinal
    } else {
        ordinal
            .checked_add(records.len() as i64 - 1)
            .ok_or_else(|| HistoryError::Stale("Invalid history context position".into()))?
    };
    let newer = bounded_successor(&connection, note_id, &records[0].identity())?;
    let older = records.last().and_then(BoundedTimelineRecord::predecessor);
    if let Some(identity) = &older {
        if bounded_timeline_record(&connection, note_id, identity)?.is_none() {
            return Err(corrupt(
                "Note Timeline context lineage is missing or disconnected",
            ));
        }
    }
    Ok(BoundedRevisionContext {
        records,
        first_ordinal,
        older,
        newer,
    })
}

pub(super) fn history_page_revision_counts(
    store: &Store,
    records: &[BoundedTimelineRecord],
) -> Result<std::collections::HashMap<RevisionIdentity, (usize, usize)>, HistoryError> {
    let connection = open_store(store)?;
    // Walk the bounded page oldest first, reusing only the previous verified
    // authored state. Replaying every revision independently multiplies the
    // checkpoint replay cost by the page size for large notes.
    let mut revision_counts = std::collections::HashMap::new();
    let mut previous: Option<(String, VerifiedAuthoredPayload)> = None;
    for record in records.iter().rev() {
        if let BoundedTimelineRecord::Revision { header, .. } = record {
            let encoded = reconstruct_revision_after(
                &connection,
                header.identity.as_str(),
                previous.as_ref().map(|(id, bytes)| (id.as_str(), bytes)),
            )?;
            let authored = AuthoredState::decode(&encoded.bytes)?;
            revision_counts.insert(
                header.identity.clone(),
                super::authored_content_counts(&ReconstructedNoteRevision {
                    unmanaged_frontmatter: authored.unmanaged_frontmatter,
                    body: authored.body,
                }),
            );
            previous = Some((header.identity.0.clone(), encoded));
        }
    }
    Ok(revision_counts)
}

pub(super) fn current_path(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<Option<PathBuf>, HistoryError> {
    let connection = open_store(store)?;
    Ok(connection
        .query_row(
            "SELECT current_path FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| row.get::<_, String>(0).map(PathBuf::from),
        )
        .optional()
        .map_err(HistoryError::from)?)
}

pub(super) fn current_content_hash(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<Option<String>, HistoryError> {
    let connection = open_store(store)?;
    Ok(connection
        .query_row(
            "SELECT COALESCE((SELECT result_hash FROM pending_editing_windows WHERE note_id = ?1), result_hash) FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|value| value.flatten())
        .map_err(HistoryError::from)?)
}

pub(super) fn note_identity_for_current_path(
    store: &Store,
    path: &Path,
) -> Result<Option<NoteIdentity>, HistoryError> {
    let connection = open_store(store)?;
    let mut statement = connection
        .prepare(
            "SELECT heads.note_id FROM timeline_heads heads
             LEFT JOIN lifecycle_events events
               ON heads.record_kind = 'lifecycleEvent' AND events.event_id = heads.record_id
             WHERE heads.current_path = ?1
               AND COALESCE(events.kind, '') != 'missing'
             ORDER BY heads.note_id
             LIMIT 2",
        )
        .map_err(HistoryError::from)?;
    let identities = statement
        .query_map(params![path.to_string_lossy().into_owned()], |row| {
            row.get::<_, String>(0).map(NoteIdentity::new)
        })
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?;
    match identities.as_slice() {
        [] => Ok(None),
        [identity] => Ok(Some(identity.clone())),
        _ => Err(format!(
            "Multiple Note Timelines currently claim path {}",
            path.display()
        )
        .into()),
    }
}

fn order_revision_chain(
    revisions: Vec<(Option<String>, NoteRevisionHeader)>,
) -> Result<Vec<NoteRevisionHeader>, HistoryError> {
    let mut ordered = Vec::with_capacity(revisions.len());
    let mut children = std::collections::HashMap::with_capacity(revisions.len());
    for (base, revision) in revisions {
        if children.insert(base, revision).is_some() {
            return Err(corrupt("Note Revision lineage is missing or branched"));
        }
    }
    let mut base_revision_id = None;
    while !children.is_empty() {
        let revision = children
            .remove(&base_revision_id)
            .ok_or_else(|| corrupt("Note Revision lineage is missing or branched"))?;
        base_revision_id = Some(revision.identity.0.clone());
        ordered.push(revision);
    }
    Ok(ordered)
}

pub(super) fn lifecycle_events(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<Vec<LifecycleEventHeader>, HistoryError> {
    let connection = open_store(store)?;
    let mut statement = connection
        .prepare(
            "SELECT event_id, predecessor_kind, predecessor_id, kind, occurred_at_millis,
                    previous_path, path, payload_version
             FROM lifecycle_events WHERE note_id = ?1
             ORDER BY occurred_at_millis ASC, event_id ASC",
        )
        .map_err(HistoryError::from)?;
    let events = statement
        .query_map(params![note_id.as_str()], StoredLifecycleHeader::from_row)
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?
        .into_iter()
        .map(|stored| stored.into_domain(note_id))
        .collect::<Result<Vec<_>, HistoryError>>()?;
    Ok(events)
}

pub(super) fn reconstruct(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
) -> Result<ReconstructedNoteRevision, HistoryError> {
    let connection = open_store(store)?;
    let stored_note_id = connection
        .query_row(
            "SELECT note_id FROM revisions WHERE revision_id = ?1",
            params![revision_id.0],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(HistoryError::from)?
        .ok_or_else(|| "Unknown Note Revision".to_string())?;
    if stored_note_id != note_id.as_str() {
        return Err("Note Revision does not belong to this Note Timeline"
            .to_string()
            .into());
    }
    let encoded = reconstruct_revision(&connection, &revision_id.0)?;
    let state = AuthoredState::decode(&encoded)?;
    Ok(ReconstructedNoteRevision {
        unmanaged_frontmatter: state.unmanaged_frontmatter,
        body: state.body,
    })
}

pub(super) fn owns_revision(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
) -> Result<bool, HistoryError> {
    Ok(open_store(store)?
        .query_row(
            "SELECT 1 FROM revisions WHERE note_id = ?1 AND revision_id = ?2",
            params![note_id.as_str(), revision_id.0],
            |_| Ok(()),
        )
        .optional()
        .map(|row| row.is_some())
        .map_err(|error| HistoryError::from(error).with_context("Find Note Revision"))?)
}

pub(super) fn reconstruct_latest(
    store: &Store,
    note_id: &NoteIdentity,
) -> Result<ReconstructedNoteRevision, HistoryError> {
    let connection = open_store(store)?;
    let revision_id = connection
        .query_row(
            "SELECT revision_id FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(HistoryError::from)?
        .flatten()
        .ok_or_else(|| "Missing Note has no retained revision to recover".to_string())?;
    let encoded = reconstruct_revision(&connection, &revision_id)?;
    let state = AuthoredState::decode(&encoded)?;
    Ok(ReconstructedNoteRevision {
        unmanaged_frontmatter: state.unmanaged_frontmatter,
        body: state.body,
    })
}

pub(super) struct RevisionComparison {
    pub(super) from_id: Option<RevisionIdentity>,
    pub(super) to_id: Option<RevisionIdentity>,
    pub(super) from: ReconstructedNoteRevision,
    pub(super) to: ReconstructedNoteRevision,
}

pub(super) fn reconstruct_comparison(
    store: &Store,
    note_id: &NoteIdentity,
    selected_id: &RevisionIdentity,
    comparison: super::HistoryDiffComparison,
) -> Result<RevisionComparison, HistoryError> {
    // Preserve exhaustive header/lineage validation. Ordering uses a linear
    // child lookup rather than rescanning the remaining chain for each revision.
    let revisions = revisions(store, note_id)?;
    let selected_index = revisions
        .iter()
        .position(|revision| revision.identity() == selected_id)
        .ok_or_else(|| "Unknown Note Revision".to_string())?;
    let (from_id, to_id) = match comparison {
        super::HistoryDiffComparison::Parent => (
            selected_index
                .checked_sub(1)
                .map(|index| revisions[index].identity().clone()),
            selected_id.clone(),
        ),
        super::HistoryDiffComparison::Current => (
            Some(selected_id.clone()),
            revisions
                .last()
                .expect("selected revision exists")
                .identity()
                .clone(),
        ),
    };
    let connection = open_store(store)?;
    let from_bytes = from_id
        .as_ref()
        .map(|id| reconstruct_revision_after(&connection, id.as_str(), None))
        .transpose()?;
    let to_bytes = reconstruct_revision_after(
        &connection,
        to_id.as_str(),
        from_id
            .as_ref()
            .zip(from_bytes.as_ref())
            .map(|(id, bytes)| (id.as_str(), bytes)),
    )?;
    let from = from_bytes
        .as_ref()
        .map(|bytes| AuthoredState::decode(&bytes.bytes))
        .transpose()?
        .unwrap_or_else(|| AuthoredState {
            unmanaged_frontmatter: None,
            body: String::new(),
        });
    // Current means the latest captured canonical endpoint, which may not yet
    // have a public revision identity. This read does not create a boundary.
    let pending = if comparison == super::HistoryDiffComparison::Current {
        editing_windows::pending(&connection, Some(note_id.as_str()))?.pop()
    } else {
        None
    };
    let (to_id, to) = if let Some(window) = pending {
        let bytes = editing_windows::validate_pending(&connection, &window, true)?;
        (None, AuthoredState::decode(&bytes)?)
    } else {
        (Some(to_id), AuthoredState::decode(&to_bytes.bytes)?)
    };
    Ok(RevisionComparison {
        from_id,
        to_id,
        from: ReconstructedNoteRevision {
            unmanaged_frontmatter: from.unmanaged_frontmatter,
            body: from.body,
        },
        to: ReconstructedNoteRevision {
            unmanaged_frontmatter: to.unmanaged_frontmatter,
            body: to.body,
        },
    })
}

fn insert_deletion_marker(
    transaction: &Transaction<'_>,
    marker: &DeletionMarker,
) -> Result<(), HistoryError> {
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
        .map_err(|error| {
            HistoryError::from(error).with_context("Record Note Timeline deletion marker")
        })?;
    Ok(())
}

fn delete_note_timeline_records(
    transaction: &Transaction<'_>,
    note_id: &NoteIdentity,
) -> Result<(), HistoryError> {
    for sequence in observation_sequences_for_notes(transaction, &HashSet::from([note_id.clone()]))?
    {
        transaction
            .execute(
                "DELETE FROM pending_observations WHERE sequence=?1",
                [sequence],
            )
            .map_err(|e| {
                HistoryError::from(e).with_context("Delete discarded timeline observation")
            })?;
    }
    editing_windows::delete_note(transaction, note_id.as_str())?;
    transaction
        .execute(
            "DELETE FROM missing_notes WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Delete Missing Note recovery state")
        })?;
    transaction
        .execute(
            "DELETE FROM timeline_heads WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| HistoryError::from(error).with_context("Delete Note Timeline head"))?;
    transaction
        .execute(
            "DELETE FROM baseline_initialization_failures WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Delete Note Timeline initialization failure")
        })?;
    transaction
        .execute(
            "DELETE FROM lifecycle_events WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Delete Note Timeline Lifecycle Events")
        })?;
    transaction
        .execute(
            "DELETE FROM revisions WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Delete Note Timeline revisions")
        })?;
    transaction
        .execute(
            "DELETE FROM prepared_intents WHERE note_id = ?1",
            params![note_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Delete Note Timeline publication intents")
        })?;
    transaction
        .execute(
            "DELETE FROM publication_receipts WHERE note_id=?1",
            [note_id.as_str()],
        )
        .map_err(HistoryError::from)?;
    Ok(())
}

pub(super) fn clear_note_history(
    store: &Store,
    note_id: &NoteIdentity,
    path: &Path,
    canonical_markdown: &str,
    marker: &DeletionMarker,
) -> Result<(), HistoryError> {
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|error| {
            HistoryError::from(error).with_context("Defer Note Timeline clear constraints")
        })?;
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
        return Err("injected history deletion interruption".to_string().into());
    }
    Ok(transaction
        .commit()
        .map_err(|error| HistoryError::from(error).with_context("Commit Note Timeline clear"))?)
}

fn require_revision_owned_by_note(
    transaction: &Transaction<'_>,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
) -> Result<(), HistoryError> {
    let exists = transaction
        .query_row(
            "SELECT 1 FROM revisions WHERE revision_id = ?1 AND note_id = ?2",
            params![revision_id.0, note_id.as_str()],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| HistoryError::from(error).with_context("Find Named Revision target"))?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err("Selected Note Revision is no longer available"
            .to_string()
            .into())
    }
}

pub(super) fn name_revision(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    label: &str,
) -> Result<(), HistoryError> {
    mutate_owned_revision_label(
        store,
        note_id,
        revision_id,
        "Commit Named Revision label",
        |transaction| {
            transaction
                .execute(
                    "DELETE FROM named_revision_labels WHERE revision_id = ?1",
                    params![revision_id.0],
                )
                .map_err(|error| {
                    HistoryError::from(error).with_context("Replace Named Revision label")
                })?;
            transaction
                .execute(
                    "INSERT INTO named_revision_labels (label_id, revision_id, label)
                     VALUES (?1, ?2, ?3)",
                    params![crate::note::generate_unique_id(), revision_id.0, label],
                )
                .map_err(|error| {
                    HistoryError::from(error).with_context("Store Named Revision label")
                })?;
            Ok(())
        },
    )
}

fn mutate_owned_revision_label(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    commit_context: &str,
    mutation: impl FnOnce(&Transaction<'_>) -> Result<(), HistoryError>,
) -> Result<(), HistoryError> {
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    require_revision_owned_by_note(&transaction, note_id, revision_id)?;
    mutation(&transaction)?;
    Ok(transaction
        .commit()
        .map_err(|error| HistoryError::from(error).with_context(format!("{commit_context}")))?)
}

pub(super) fn remove_revision_name(
    store: &Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
) -> Result<(), HistoryError> {
    mutate_owned_revision_label(
        store,
        note_id,
        revision_id,
        "Commit Named Revision label removal",
        |transaction| {
            transaction
                .execute(
                    "DELETE FROM named_revision_labels WHERE revision_id = ?1",
                    params![revision_id.0],
                )
                .map_err(|error| {
                    HistoryError::from(error).with_context("Remove Named Revision label")
                })?;
            Ok(())
        },
    )
}

pub(super) fn clear_vault_history(
    store: &Store,
    seeds: &[HistoryClearBaseline],
    marker: &DeletionMarker,
) -> Result<(), HistoryError> {
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
    transaction
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|error| {
            HistoryError::from(error).with_context("Defer vault Note Timeline clear constraints")
        })?;
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
        return Err("injected history deletion interruption".to_string().into());
    }
    Ok(transaction.commit().map_err(|error| {
        HistoryError::from(error).with_context("Commit vault Note Timeline clear")
    })?)
}

pub(super) fn prepare_note_purge(
    store: &Store,
    note_id: &NoteIdentity,
    path: &Path,
    marker: &DeletionMarker,
) -> Result<PathBuf, HistoryError> {
    let connection = open_store(store)?;
    let (scope_kind, scope_id) = marker.scope.storage_parts();
    if scope_kind != "note" || scope_id != note_id.as_str() {
        return Err("Note purge marker scope does not match its Note Identity"
            .to_string()
            .into());
    }
    let staged_path = purge_staging_path(store, marker.operation_id())?;
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
        .map_err(|error| HistoryError::from(error).with_context("Prepare Note Timeline purge"))?;
    Ok(staged_path)
}

pub(super) fn abandon_note_purge(
    store: &Store,
    operation_id: &DeletionOperationIdentity,
) -> Result<(), HistoryError> {
    open_store(store)?
        .execute(
            "DELETE FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Abandon prepared Note Timeline purge")
        })?;
    Ok(())
}

pub(super) fn finalize_note_purge(
    store: &Store,
    operation_id: &DeletionOperationIdentity,
) -> Result<(), HistoryError> {
    let mut connection = open_store(store)?;
    let transaction = connection.transaction().map_err(HistoryError::from)?;
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
        .map_err(|error| {
            HistoryError::from(error).with_context("Read prepared Note Timeline purge")
        })?
        .ok_or_else(|| "Unknown prepared Note Timeline purge".to_string())?;
    let marker = DeletionMarker {
        payload_version: parse_payload_version(pending.7)?,
        operation_id: operation_id.clone(),
        scope: DeletionScope::from_storage_parts(&pending.2, pending.3)?,
        kind: HistoryDeletionKind::from_storage_value(&pending.4)
            .ok_or_else(|| corrupt(format!("Unknown prepared deletion kind `{}`", pending.4)))?,
        occurred_at_millis: pending.5,
        history_generation: pending.6,
    };
    if marker.kind != HistoryDeletionKind::Purge
        || marker.scope != DeletionScope::Note(NoteIdentity::new(pending.0.clone()))
    {
        return Err(corrupt(
            "Prepared Note Timeline purge has an invalid scope or kind",
        ));
    }
    transaction
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|error| {
            HistoryError::from(error).with_context("Defer Note Timeline purge constraints")
        })?;
    delete_note_timeline_records(&transaction, &NoteIdentity::new(pending.0))?;
    transaction
        .execute(
            "DELETE FROM pending_observations WHERE path = ?1 OR previous_path = ?1",
            params![pending.1.to_string_lossy().into_owned()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Delete pending observations for purged note")
        })?;
    insert_deletion_marker(&transaction, &marker)?;
    #[cfg(test)]
    if take_fault(FaultPoint::Deletion) {
        return Err("injected history deletion interruption".to_string().into());
    }
    Ok(transaction
        .commit()
        .map_err(|error| HistoryError::from(error).with_context("Commit Note Timeline purge"))?)
}

pub(super) fn complete_note_purge(
    store: &Store,
    operation_id: &DeletionOperationIdentity,
) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    let staged_path = connection
        .query_row(
            "SELECT staged_path FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
            |row| row.get::<_, String>(0).map(PathBuf::from),
        )
        .optional()
        .map_err(|error| {
            HistoryError::from(error).with_context("Read staged Note Timeline purge cleanup")
        })?;
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
            )
            .into());
        }
    }
    connection
        .execute(
            "DELETE FROM pending_deletions WHERE operation_id = ?1",
            params![operation_id.as_str()],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Complete prepared Note Timeline purge")
        })?;
    Ok(())
}

pub(super) struct PendingDeletionRecovery {
    pub(super) operation_id: DeletionOperationIdentity,
    pub(super) note_id: NoteIdentity,
    pub(super) path: PathBuf,
    pub(super) staged_path: PathBuf,
    pub(super) finalized: bool,
}

pub(super) fn pending_deletions_for_recovery(
    store: &Store,
) -> Result<Vec<PendingDeletionRecovery>, HistoryError> {
    let connection = open_store(store)?;
    let pending = {
        let mut statement = connection
            .prepare(
                "SELECT operation_id, note_id, path, staged_path
                 FROM pending_deletions ORDER BY operation_id",
            )
            .map_err(|error| {
                HistoryError::from(error).with_context("Prepare pending deletion recovery")
            })?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    DeletionOperationIdentity::from_persisted(row.get::<_, String>(0)?),
                    NoteIdentity::new(row.get::<_, String>(1)?),
                    PathBuf::from(row.get::<_, String>(2)?),
                    PathBuf::from(row.get::<_, String>(3)?),
                ))
            })
            .map_err(|error| {
                HistoryError::from(error).with_context("Read pending deletion recovery")
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                HistoryError::from(error).with_context("Decode pending deletion recovery")
            })?;
        rows
    };
    drop(connection);
    pending
        .into_iter()
        .map(|(operation_id, note_id, path, staged_path)| {
            let finalized = deletion_marker_exists(store, &operation_id)?;
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

fn deletion_marker_exists(
    store: &Store,
    operation_id: &DeletionOperationIdentity,
) -> Result<bool, HistoryError> {
    Ok(open_store(store)?
        .query_row(
            "SELECT 1 FROM deletion_markers WHERE operation_id = ?1",
            params![operation_id.as_str()],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Note Timeline purge completion marker")
        })?
        .is_some())
}

fn purge_staging_path(
    store: &Store,
    operation_id: &DeletionOperationIdentity,
) -> Result<PathBuf, HistoryError> {
    let directory = store.data_dir.clone().join("pending-note-purges");
    fs::create_dir_all(&directory).map_err(|error| {
        HistoryError::from(error).with_context("Create Note Timeline purge staging directory")
    })?;
    Ok(directory.join(format!("{}.md", operation_id.as_str())))
}

#[cfg(test)]
pub(super) fn deletion_markers(store: &Store) -> Result<Vec<DeletionMarker>, HistoryError> {
    let connection = open_store(store)?;
    let mut statement = connection
        .prepare(
            "SELECT operation_id, scope_kind, scope_id, deletion_kind,
                    occurred_at_millis, history_generation, payload_version
             FROM deletion_markers
             ORDER BY occurred_at_millis, operation_id",
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Prepare deletion marker export")
        })?;
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
        .map_err(|error| HistoryError::from(error).with_context("Read deletion marker export"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| HistoryError::from(error).with_context("Decode deletion marker export"))?;
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
                    kind: HistoryDeletionKind::from_storage_value(&deletion_kind).ok_or_else(
                        || corrupt(format!("Unknown deletion marker kind `{deletion_kind}`")),
                    )?,
                    occurred_at_millis,
                    history_generation,
                })
            },
        )
        .collect()
}

fn storage_usage_with_connection(
    store: &Store,
    connection: &Connection,
) -> Result<HistoryStorageUsage, HistoryError> {
    let page_size = connection
        .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Note Timeline storage page size")
        })?;
    let reclaimable_pages = connection
        .query_row("PRAGMA freelist_count", [], |row| row.get::<_, u64>(0))
        .map_err(|error| {
            HistoryError::from(error).with_context("Read reclaimable Note Timeline storage")
        })?;
    let logical_pages = connection
        .query_row("PRAGMA page_count", [], |row| row.get::<_, u64>(0))
        .map_err(|error| {
            HistoryError::from(error).with_context("Read logical Note Timeline storage pages")
        })?;
    let database_path = history_database_path(store)?;
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

fn connection_integrity_is_verified(connection: &Connection) -> Result<bool, rusqlite::Error> {
    let mut quick_check = connection.prepare("PRAGMA quick_check")?;
    let results = quick_check
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if results.as_slice() != ["ok"] {
        return Ok(false);
    }
    let foreign_key_failures =
        connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, u64>(0)
        })?;
    Ok(foreign_key_failures == 0)
}

fn corrupt(cause: impl std::fmt::Display) -> HistoryError {
    HistoryError::Corrupt(cause.to_string())
}

impl From<rusqlite::Error> for HistoryError {
    fn from(error: rusqlite::Error) -> Self {
        if sqlite_error_is_corruption(&error)
            || matches!(
                error,
                rusqlite::Error::QueryReturnedNoRows
                    | rusqlite::Error::InvalidColumnType(..)
                    | rusqlite::Error::FromSqlConversionFailure(..)
                    | rusqlite::Error::IntegralValueOutOfRange(..)
            )
        {
            corrupt(error)
        } else {
            Self::Unavailable(error.to_string())
        }
    }
}

impl From<serde_json::Error> for HistoryError {
    fn from(error: serde_json::Error) -> Self {
        corrupt(error)
    }
}

fn sqlite_error_is_corruption(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase)
    )
}

#[cfg(test)]
fn verify_revision_payloads(
    connection: &Connection,
    note_id: Option<&NoteIdentity>,
) -> Result<(), HistoryError> {
    verify_revision_payloads_cancellable(connection, note_id, &|| Ok(()))
}

fn verify_revision_payloads_cancellable(
    connection: &Connection,
    note_id: Option<&NoteIdentity>,
    checkpoint: &dyn Fn() -> Result<(), HistoryError>,
) -> Result<(), HistoryError> {
    // Attest every payload once in lineage order. Only the preceding verified
    // state survives an iteration; nothing is shared with another operation.
    let mut statement = connection
        .prepare(
            if note_id.is_some() {
                "SELECT note_id, base_revision_id, revision_id, base_hash FROM revisions WHERE note_id = ?1"
            } else {
                "SELECT note_id, base_revision_id, revision_id, base_hash FROM revisions WHERE ?1 IS NULL"
            },
        )
        .map_err(HistoryError::from)?;
    let rows = statement
        .query_map(params![note_id.map(NoteIdentity::as_str)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(HistoryError::from)?;
    let mut notes = BTreeMap::<
        String,
        std::collections::HashMap<Option<String>, (String, Option<String>)>,
    >::new();
    for row in rows {
        checkpoint()?;
        let (note, base, revision, base_hash) = row.map_err(HistoryError::from)?;
        if notes
            .entry(note)
            .or_default()
            .insert(base, (revision, base_hash))
            .is_some()
        {
            return Err(corrupt(corrupt(
                "Note Revision lineage is missing or branched",
            )));
        }
    }
    for mut children in notes.into_values() {
        let mut previous: Option<(String, VerifiedAuthoredPayload)> = None;
        while !children.is_empty() {
            checkpoint()?;
            let base = previous.as_ref().map(|(id, _)| id.clone());
            let (revision, base_hash) = children
                .remove(&base)
                .ok_or_else(|| corrupt(corrupt("Note Revision lineage is missing or branched")))?;
            if base_hash.as_deref()
                != previous
                    .as_ref()
                    .map(|(_, payload)| payload.result_hash.as_str())
            {
                return Err(corrupt("Note Revision base hash verification failed"));
            }
            let bytes = reconstruct_revision_after(
                connection,
                &revision,
                previous.as_ref().map(|(id, bytes)| (id.as_str(), bytes)),
            )?;
            previous = Some((revision, bytes));
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn integrity_snapshot(store: &Store) -> HistoryStoreIntegrity {
    INTEGRITY_SNAPSHOT_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    match verify_all(
        store,
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    ) {
        Ok(()) => HistoryStoreIntegrity::Verified,
        Err(HistoryError::Corrupt(_)) => HistoryStoreIntegrity::Corrupt,
        Err(_) => HistoryStoreIntegrity::Unavailable,
    }
}

fn verify_all(
    store: &Store,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), HistoryError> {
    admit_current_store(store)?;
    for note in verification_notes(store, stop.clone())? {
        verify_note(store, &note, stop.clone())?;
    }
    verify_structure(store, stop)
}

pub(super) fn health_snapshot(
    store: &Store,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> HistoryStoreHealth {
    #[cfg(test)]
    HEALTH_SNAPSHOT_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let result = (|| -> Result<HistoryStoreHealthSnapshot, HistoryError> {
        verify_all(store, stop)?;
        let connection = open_store(store)?;
        let initialization = baseline_initialization_progress_with_connection(&connection)?;
        let storage = storage_usage_with_connection(store, &connection)?;
        let pending_repairs = connection.query_row("SELECT (SELECT COUNT(*) FROM prepared_intents WHERE status='prepared') + (SELECT COUNT(*) FROM pending_observations) + (SELECT COUNT(*) FROM pending_deletions)", [], |r| r.get(0))?;
        Ok(HistoryStoreHealthSnapshot {
            initialization,
            storage,
            pending_repairs,
        })
    })();
    match result {
        Ok(snapshot) => HistoryStoreHealth::Available(snapshot),
        Err(HistoryError::Corrupt(_)) => HistoryStoreHealth::Corrupt,
        Err(_) => HistoryStoreHealth::Unavailable,
    }
}

pub(super) fn note_health_snapshot(
    store: &Store,
    note_id: &NoteIdentity,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> NoteHistoryStoreHealth {
    let result = (|| -> Result<NoteHistoryStoreSnapshot, HistoryError> {
        admit_current_store(store)?;
        verify_note(store, note_id, stop)?;
        let connection = open_store(store)?;
        let initialization =
            note_baseline_initialization_state_with_connection(&connection, note_id)?;
        let (revision_count, lifecycle_event_count, revision_payload_bytes) = connection.query_row("SELECT (SELECT COUNT(*) FROM revisions WHERE note_id=?1), (SELECT COUNT(*) FROM lifecycle_events WHERE note_id=?1), COALESCE((SELECT SUM(LENGTH(payload)) FROM revisions WHERE note_id=?1),0)", [note_id.as_str()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(NoteHistoryStoreSnapshot {
            initialization,
            revision_count,
            lifecycle_event_count,
            revision_payload_bytes,
        })
    })();
    match result {
        Ok(snapshot) => NoteHistoryStoreHealth::Available(snapshot),
        Err(HistoryError::Corrupt(_)) => NoteHistoryStoreHealth::Corrupt,
        Err(_) => NoteHistoryStoreHealth::Unavailable,
    }
}

pub(super) fn storage_usage(store: &Store) -> Result<HistoryStorageUsage, HistoryError> {
    storage_usage_with_connection(store, &open_store(store)?)
}

pub(super) fn compact(store: &Store, maximum_reclaim_bytes: u64) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    connection
        .execute_batch("PRAGMA wal_autocheckpoint=0;")
        .map_err(|error| {
            HistoryError::from(error).with_context("Bound Note Timeline compaction checkpointing")
        })?;
    if maximum_reclaim_bytes == 0 {
        return Ok(());
    }
    let database_path = history_database_path(store)?;
    let wal_path = sqlite_sidecar_path(&database_path, "-wal");
    let wal_bytes = storage_file_bytes(&wal_path)?;
    let mut remaining_budget = maximum_reclaim_bytes;
    if wal_bytes > 0 && wal_bytes <= remaining_budget {
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| {
                HistoryError::from(error).with_context("Compact Note Timeline WAL storage")
            })?;
        remaining_budget = remaining_budget.saturating_sub(wal_bytes);
    }
    if remaining_budget == 0 {
        return Ok(());
    }
    let usage = storage_usage_with_connection(store, &connection)?;
    if usage.reclaimable_bytes == 0 {
        return Ok(());
    }
    let page_size = connection
        .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Note Timeline compaction page size")
        })?;
    let maximum_pages = (remaining_budget / page_size).min(MAX_COMPACTION_PAGES_PER_PASS);
    if maximum_pages == 0 {
        return Ok(());
    }
    let reclaimable_pages = usage.reclaimable_bytes / page_size;
    let pages = maximum_pages.min(reclaimable_pages);
    for _ in 0..pages {
        connection
            .execute_batch("PRAGMA incremental_vacuum(1);")
            .map_err(|error| {
                HistoryError::from(error).with_context("Compact Note Timeline storage")
            })?;
    }
    Ok(())
}

pub(super) fn clean_close(store: &Store) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    recover_pending_with_connection(&connection, false)?;
    if !editing_windows::pending(&connection, None)?.is_empty() {
        return Err("Finalize Editing Windows before portable close".into());
    }
    let close_result = (|| {
        connection
            .execute(
                "UPDATE history_metadata
                 SET portability_state = 'portable',
                     clean_close_sequence = clean_close_sequence + 1
                 WHERE singleton = 1",
                [],
            )
            .map_err(|error| {
                HistoryError::from(error).with_context("Record clean Note Timeline close")
            })?;
        checkpoint_store(&connection, "clean close")?;
        let (instance_id, clean_close_sequence, state) = connection
            .query_row(
                "SELECT store_instance_id, clean_close_sequence, portability_state
                 FROM history_metadata WHERE singleton = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, String>(2)?)),
            )
            .map_err(|error| {
                HistoryError::from(error).with_context("Read clean Note Timeline close")
            })?;
        let portability = StorePortability {
            instance_id,
            clean_close_sequence,
            state: StorePortabilityState::parse(&state)?,
        };
        let manifest = crate::state::read_vault_manifest_for(&store.vault_root.clone())?
            .ok_or_else(|| "Clean close requires a vault manifest".to_string())?;
        validate_and_remember_history_selection(store, &manifest, &portability, false)
    })();
    if let Err(error) = close_result {
        return restore_open_after_failed_close(&connection, error, "failed clean-close recovery");
    }
    if let Err(close_error) = close_history_connection(connection) {
        let (connection, error) = *close_error;
        return restore_open_after_failed_close(
            &connection,
            error,
            "failed connection-close recovery",
        );
    }
    ACTIVE_HISTORY_STORE_SESSIONS
        .lock()
        .map_err(|_| "Note Timeline history store sessions lock poisoned".to_string())?
        .remove(&history_database_path(store)?);
    Ok(())
}

fn restore_open_after_failed_close(
    connection: &Connection,
    error: HistoryError,
    checkpoint_purpose: &str,
) -> Result<(), HistoryError> {
    let reopen = connection
        .execute(
            "UPDATE history_metadata SET portability_state = 'open' WHERE singleton = 1",
            [],
        )
        .map_err(|reopen_error| {
            HistoryError::from(reopen_error)
                .with_context("Restore open Note Timeline state after failed close")
        })
        .and_then(|_| checkpoint_store(connection, checkpoint_purpose));
    match reopen {
        Ok(()) => Err(error),
        Err(reopen_error) if matches!(reopen_error, HistoryError::Corrupt(_)) => {
            Err(reopen_error.with_context(error))
        }
        Err(reopen_error) => Err(error.with_context(reopen_error)),
    }
}

fn close_history_connection(connection: Connection) -> Result<(), Box<(Connection, HistoryError)>> {
    #[cfg(test)]
    if take_fault(FaultPoint::Close) {
        return Err(Box::new((
            connection,
            "injected history connection close failure".into(),
        )));
    }
    connection.close().map_err(|(connection, error)| {
        Box::new((
            connection,
            HistoryError::from(error).with_context("Close Note Timeline history connection"),
        ))
    })
}

fn history_database_path(store: &Store) -> Result<PathBuf, HistoryError> {
    Ok(store.data_dir.clone().join(HISTORY_DATABASE_FILE_NAME))
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

fn storage_file_bytes(path: &Path) -> Result<u64, HistoryError> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(format!(
            "Read Note Timeline storage allocation {}: {error}",
            path.display()
        )
        .into()),
    }
}

pub(super) fn reset_history_store(
    store: &Store,
    vault_root: &Path,
) -> Result<(u64, u64, String, u64), HistoryError> {
    if vault_root != store.vault_root() {
        return Err(HistoryError::Stale("History reset vault mismatch".into()));
    }
    let generations = crate::state::advance_vault_history_generation(
        vault_root,
        HISTORY_FORMAT,
        INITIAL_HISTORY_GENERATION,
    )?;
    let operation_id = crate::note::generate_unique_id();
    let reset_at_millis = crate::time::current_time_millis()
        .map_err(|error| HistoryError::from(error).with_context("Issue history reset time"))?;
    let manifest = crate::state::read_vault_manifest_for(vault_root)?
        .ok_or_else(|| "History reset requires a vault manifest".to_string())?;
    *store
        .scope
        .lock()
        .map_err(|_| "History scope lock poisoned")? =
        Some((manifest.vault_id.clone(), manifest.history_generation));
    record_history_reset(
        store,
        &manifest,
        &operation_id,
        generations.0,
        generations.1,
        reset_at_millis,
    )?;
    let data_dir = store.data_dir.clone();
    ACTIVE_HISTORY_STORE_SESSIONS
        .lock()
        .map_err(|_| "Note Timeline history store sessions lock poisoned".to_string())?
        .remove(&data_dir.join(HISTORY_DATABASE_FILE_NAME));
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
                )
                .into())
            }
        }
    }
    drop(open_store(store)?);
    Ok((generations.0, generations.1, operation_id, reset_at_millis))
}

pub(super) fn store_is_queryable_for_reset(store: &Store) -> bool {
    // Explicit reset may replace a physically unreadable store, but a store
    // that can still be queried must first preserve all reconstructable
    // inactive timelines or fail before advancing the generation.
    open_store(store).is_ok()
}

pub(super) fn complete_history_reset_rebuild(store: &Store) -> Result<(), HistoryError> {
    open_store(store)?
        .execute(
            "UPDATE history_reset_rebuild SET pending = 0 WHERE singleton = 1",
            [],
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Mark history reset replacement complete")
        })?;
    mark_observed_history_reset_rebuild_complete(store)
}

fn history_reset_rebuild_is_pending(
    store: &Store,
    connection: &Connection,
) -> Result<bool, HistoryError> {
    let stored_pending = connection
        .query_row(
            "SELECT pending FROM history_reset_rebuild WHERE singleton = 1",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Read history reset rebuild state")
        })?;
    if stored_pending {
        return Ok(true);
    }
    let manifest = crate::state::read_vault_manifest_for(&store.vault_root.clone())?
        .ok_or_else(|| "Read reset rebuild state without a vault manifest".to_string())?;
    observed_history_reset_rebuild_is_pending(store, &manifest)
}

fn history_observations_path(store: &Store) -> Result<PathBuf, HistoryError> {
    Ok(store
        .app_data_dir
        .clone()
        .join(HISTORY_OBSERVATIONS_FILE_NAME))
}

fn read_history_observations(path: &Path) -> Result<HistoryObservations, HistoryError> {
    if !path.is_file() {
        return Ok(HistoryObservations::default());
    }
    let contents = fs::read_to_string(path).map_err(|error| {
        HistoryError::from(error).with_context("Read Note Timeline history observations")
    })?;
    serde_json::from_str(&contents).map_err(HistoryError::from)
}

fn write_history_observations(
    path: &Path,
    observations: &HistoryObservations,
) -> Result<(), HistoryError> {
    let serialized = serde_json::to_vec_pretty(observations).map_err(|error| {
        HistoryError::from(error).with_context("Serialize Note Timeline history observations")
    })?;
    let temporary = path.with_file_name(format!(
        ".history-observations-{}.tmp",
        crate::note::generate_unique_id()
    ));
    fs::write(&temporary, serialized).map_err(|error| {
        HistoryError::from(error).with_context("Write Note Timeline history observations")
    })?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(
            format!("Select Note Timeline history observations atomically: {error}").into(),
        );
    }
    Ok(())
}

fn validate_and_remember_history_selection(
    store: &Store,
    manifest: &crate::state::VaultManifest,
    portability: &StorePortability,
    creating_store: bool,
) -> Result<(), HistoryError> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let path = history_observations_path(store)?;
    let mut observations = read_history_observations(&path)?;
    if let Some(observed) = observations.vaults.get(&manifest.vault_id) {
        if manifest.history_generation < observed.generation {
            return Err(format!(
                "Note Timeline history generation rollback: vault selected generation {} after this app observed generation {}",
                manifest.history_generation, observed.generation
            ).into());
        }
        if manifest.history_generation == observed.generation
            && manifest.history_format != observed.history_format
        {
            return Err(
                "Note Timeline history format changed without a generation change"
                    .to_string()
                    .into(),
            );
        }
        if manifest.history_generation == observed.generation {
            if let Some(observed_instance_id) = observed.store_instance_id.as_deref() {
                if observed_instance_id != portability.instance_id {
                    return Err(
                        "Note Timeline history store replacement requires explicit recovery"
                            .to_string()
                            .into(),
                    );
                }
            }
            if observed.clean_close_sequence > portability.clean_close_sequence {
                return Err(format!(
                    "Note Timeline clean-close watermark rollback: store has {} after this app observed {}",
                    portability.clean_close_sequence, observed.clean_close_sequence
                ).into());
            }
        }
    } else if !creating_store && portability.state == StorePortabilityState::Open {
        return Err(
            "Note Timeline unsupported live copy requires explicit recovery"
                .to_string()
                .into(),
        );
    }
    let last_reset = observations
        .vaults
        .get(&manifest.vault_id)
        .and_then(|observed| observed.last_reset.clone());
    let reset_rebuild_pending = observations
        .vaults
        .get(&manifest.vault_id)
        .is_some_and(|observed| observed.reset_rebuild_pending);
    observations.vaults.insert(
        manifest.vault_id.clone(),
        ObservedHistorySelection {
            history_format: manifest.history_format.clone(),
            generation: manifest.history_generation,
            store_instance_id: Some(portability.instance_id.clone()),
            clean_close_sequence: portability.clean_close_sequence,
            allow_missing_store: false,
            reset_rebuild_pending,
            last_reset,
        },
    );
    write_history_observations(&path, &observations)
}

fn record_history_reset(
    store: &Store,
    manifest: &crate::state::VaultManifest,
    operation_id: &str,
    previous_generation: u64,
    generation: u64,
    reset_at_millis: u64,
) -> Result<(), HistoryError> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let path = history_observations_path(store)?;
    let mut observations = read_history_observations(&path)?;
    observations.vaults.insert(
        manifest.vault_id.clone(),
        ObservedHistorySelection {
            history_format: manifest.history_format.clone(),
            generation,
            store_instance_id: None,
            clean_close_sequence: 0,
            allow_missing_store: true,
            reset_rebuild_pending: true,
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

fn mark_observed_history_reset_rebuild_complete(store: &Store) -> Result<(), HistoryError> {
    let manifest = crate::state::read_vault_manifest_for(&store.vault_root.clone())?
        .ok_or_else(|| "Complete reset rebuild without a vault manifest".to_string())?;
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let path = history_observations_path(store)?;
    let mut observations = read_history_observations(&path)?;
    let observed = observations
        .vaults
        .get_mut(&manifest.vault_id)
        .ok_or_else(|| {
            "Complete reset rebuild without an observed history selection".to_string()
        })?;
    if observed.generation != manifest.history_generation
        || observed
            .last_reset
            .as_ref()
            .is_none_or(|reset| reset.generation != manifest.history_generation)
    {
        return Err("Complete reset rebuild for a different history generation"
            .to_string()
            .into());
    }
    observed.reset_rebuild_pending = false;
    write_history_observations(&path, &observations)
}

fn ensure_store_creation_is_authorized(
    store: &Store,
    manifest: &crate::state::VaultManifest,
) -> Result<(), HistoryError> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let observations = read_history_observations(&history_observations_path(store)?)?;
    let Some(observed) = observations.vaults.get(&manifest.vault_id) else {
        return Ok(());
    };
    if manifest.history_generation < observed.generation {
        return Err(format!(
            "Note Timeline history generation rollback: vault selected generation {} after this app observed generation {}",
            manifest.history_generation, observed.generation
        ).into());
    }
    if manifest.history_generation == observed.generation
        && manifest.history_format != observed.history_format
    {
        return Err(
            "Note Timeline history format changed without a generation change"
                .to_string()
                .into(),
        );
    }
    if manifest.history_generation == observed.generation && observed.allow_missing_store {
        return Ok(());
    }
    Err(format!(
        "Note Timeline history store is missing or uninitialized for previously observed generation {}",
        manifest.history_generation
    ).into())
}

fn store_creation_is_history_reset_replacement(
    store: &Store,
    manifest: &crate::state::VaultManifest,
) -> Result<bool, HistoryError> {
    observed_history_reset_rebuild_is_pending(store, manifest)
}

fn observed_history_reset_rebuild_is_pending(
    store: &Store,
    manifest: &crate::state::VaultManifest,
) -> Result<bool, HistoryError> {
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let observations = read_history_observations(&history_observations_path(store)?)?;
    Ok(observations
        .vaults
        .get(&manifest.vault_id)
        .is_some_and(|observed| {
            observed.reset_rebuild_pending
                && observed
                    .last_reset
                    .as_ref()
                    .is_some_and(|reset| reset.generation == manifest.history_generation)
        }))
}

pub(super) fn latest_history_reset(
    store: &Store,
) -> Result<Option<(String, u64, u64, u64)>, HistoryError> {
    let manifest = crate::state::read_vault_manifest_for(&store.vault_root.clone())?
        .ok_or_else(|| "Read history reset without a vault manifest".to_string())?;
    let _guard = HISTORY_OBSERVATIONS_LOCK
        .lock()
        .map_err(|_| "Note Timeline history observations lock poisoned".to_string())?;
    let observations = read_history_observations(&history_observations_path(store)?)?;
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

fn open_store(store: &Store) -> Result<Connection, HistoryError> {
    let _open_guard = HISTORY_STORE_OPEN_LOCK
        .lock()
        .map_err(|_| "Note Timeline history store open lock poisoned".to_string())?;
    let vault_root = store.vault_root.clone();
    let manifest = crate::state::read_vault_manifest_for(&vault_root)?
        .map(Ok)
        .unwrap_or_else(|| super::ensure_vault_scaffold(&vault_root))?;
    store.validate_scope(&manifest)?;
    if manifest.history_format != HISTORY_FORMAT {
        return Err(format!(
            "Note Timeline history format mismatch: manifest selects `{}` but this build supports `{HISTORY_FORMAT}`",
            manifest.history_format
        ).into());
    }
    let data_dir = store.data_dir.clone();
    fs::create_dir_all(&data_dir).map_err(HistoryError::from)?;
    let path = history_database_path(store)?;
    let creating_store = !path.is_file();
    let creating_reset_replacement =
        creating_store && store_creation_is_history_reset_replacement(store, &manifest)?;
    if creating_store {
        ensure_store_creation_is_authorized(store, &manifest)?;
    }
    let connection = Connection::open(&path).map_err(HistoryError::from)?;
    #[cfg(test)]
    sql_work::observe(&connection);
    if !creating_store {
        let has_metadata_table = connection
            .query_row(
                "SELECT 1 FROM sqlite_master
                 WHERE type = 'table' AND name = 'history_metadata'",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(HistoryError::from)?
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
                .map_err(HistoryError::from)?;
            if let Some((vault_id, format, generation, schema)) = metadata {
                if vault_id != manifest.vault_id {
                    return Err("Note Timeline history store vault identity mismatch"
                        .to_string()
                        .into());
                }
                if format != manifest.history_format {
                    return Err("Note Timeline history store format mismatch"
                        .to_string()
                        .into());
                }
                if generation != manifest.history_generation {
                    return Err("Note Timeline history store generation mismatch"
                        .to_string()
                        .into());
                }
                if schema != HISTORY_SCHEMA_VERSION {
                    return Err("Note Timeline history store schema mismatch; rebuild history with the confirmed Settings reset".to_string().into());
                }
                let (instance, _sequence, portability) = connection.query_row(
                    "SELECT store_instance_id, clean_close_sequence, portability_state FROM history_metadata WHERE singleton=1",
                    [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?, row.get::<_, String>(2)?))
                ).map_err(|_| "Note Timeline history store metadata incomplete; rebuild history with the confirmed Settings reset")?;
                if instance.is_empty() || StorePortabilityState::parse(&portability).is_err() {
                    return Err("Note Timeline history store metadata invalid; rebuild history with the confirmed Settings reset".into());
                }
            } else {
                return Err("Note Timeline history store metadata missing; rebuild history with the confirmed Settings reset".into());
            }
        } else {
            return Err("Note Timeline history store metadata missing; rebuild history with the confirmed Settings reset".into());
        }
    }
    if creating_store {
        connection
            .execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM;")
            .map_err(|error| {
                HistoryError::from(error)
                    .with_context("Initialize reclaimable Note Timeline storage")
            })?;
    }
    connection
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;")
        .map_err(HistoryError::from)?;
    if creating_store {
        connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS history_metadata (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               vault_id TEXT NOT NULL,
               history_format TEXT NOT NULL,
               history_generation INTEGER NOT NULL,
               schema_version INTEGER NOT NULL,
               store_instance_id TEXT NOT NULL,
               clean_close_sequence INTEGER NOT NULL,
               portability_state TEXT NOT NULL CHECK (portability_state IN ('open', 'portable'))
             );
             CREATE TABLE IF NOT EXISTS history_reset_rebuild (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               pending INTEGER NOT NULL CHECK (pending IN (0, 1))
             );
             CREATE TABLE IF NOT EXISTS prepared_intents (
               intent_id TEXT PRIMARY KEY REFERENCES publication_receipts(intent_id),
               revision_id TEXT UNIQUE,
               lifecycle_event_id TEXT UNIQUE,
               note_id TEXT NOT NULL,
               target_path TEXT NOT NULL,
               source TEXT NOT NULL,
               prepared_at_millis INTEGER NOT NULL,
               committed_at_millis INTEGER NOT NULL,
               authored_payload BLOB NOT NULL,
               result_hash TEXT NOT NULL,
               status TEXT NOT NULL CHECK (status = 'prepared')
             );
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
               intent_id TEXT UNIQUE REFERENCES publication_receipts(intent_id),
               CHECK ((known_since_millis IS NOT NULL
                       AND committed_at_millis IS NULL AND observed_at_millis IS NULL)
                   OR (known_since_millis IS NULL
                       AND committed_at_millis IS NOT NULL AND observed_at_millis IS NULL)
                   OR (known_since_millis IS NULL
                       AND committed_at_millis IS NULL AND observed_at_millis IS NOT NULL))
             );
             CREATE INDEX IF NOT EXISTS revisions_by_note_time
               ON revisions(note_id, COALESCE(known_since_millis, committed_at_millis, observed_at_millis), revision_id);
             CREATE TABLE IF NOT EXISTS restore_origins (
               intent_id TEXT PRIMARY KEY REFERENCES publication_receipts(intent_id) ON DELETE CASCADE,
               selected_revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE
             );
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
               intent_id TEXT UNIQUE REFERENCES publication_receipts(intent_id)
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
               canonical_markdown TEXT,
               missing_retention_days INTEGER
             );
             CREATE TABLE IF NOT EXISTS missing_notes (
               note_id TEXT PRIMARY KEY,
               path TEXT NOT NULL,
               title TEXT NOT NULL,
               missing_at_millis INTEGER NOT NULL,
               retention_days INTEGER NOT NULL CHECK (retention_days IN (1, 7, 30)),
               purge_at_millis INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS missing_notes_by_deadline
               ON missing_notes(purge_at_millis, note_id);
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
               current_path TEXT NOT NULL,
               record_count INTEGER NOT NULL
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
        .map_err(|error| HistoryError::from(error).with_context("Initialize Note Timeline history store"))?;
        connection
            .execute(
                "INSERT OR IGNORE INTO history_reset_rebuild (singleton, pending) VALUES (1, ?1)",
                params![creating_reset_replacement],
            )
            .map_err(|error| {
                HistoryError::from(error).with_context("Initialize history reset rebuild state")
            })?;
        editing_windows::initialize(&connection)?;
    }
    let metadata = connection
        .query_row(
            "SELECT vault_id, history_format, history_generation, schema_version,
                    store_instance_id, clean_close_sequence, portability_state
             FROM history_metadata WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, u64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()
        .map_err(HistoryError::from)?;
    match metadata {
        Some((vault_id, _, _, _, _, _, _)) if vault_id != manifest.vault_id => {
            return Err("Note Timeline history store vault identity mismatch"
                .to_string()
                .into())
        }
        Some((_, format, _, _, _, _, _)) if format != manifest.history_format => {
            return Err("Note Timeline history store format mismatch"
                .to_string()
                .into())
        }
        Some((_, _, generation, _, _, _, _)) if generation != manifest.history_generation => {
            return Err("Note Timeline history store generation mismatch"
                .to_string()
                .into())
        }
        Some((_, _, _, schema, _, _, _)) if schema != HISTORY_SCHEMA_VERSION => {
            return Err("Note Timeline history store schema mismatch"
                .to_string()
                .into())
        }
        Some((_, _, _, _, instance_id, clean_close_sequence, portability_state)) => {
            let portability = StorePortability {
                instance_id,
                clean_close_sequence,
                state: StorePortabilityState::parse(&portability_state)?,
            };
            validate_and_remember_history_selection(store, &manifest, &portability, false)?;
        }
        None => {
            ensure_store_creation_is_authorized(store, &manifest)?;
            let store_instance_id = crate::note::generate_unique_id();
            connection
                .execute(
                    "INSERT INTO history_metadata (
                       singleton, vault_id, history_format, history_generation, schema_version,
                       store_instance_id, clean_close_sequence, portability_state
                     ) VALUES (1, ?1, ?2, ?3, ?4, ?5, 0, 'open')",
                    params![
                        &manifest.vault_id,
                        &manifest.history_format,
                        manifest.history_generation,
                        HISTORY_SCHEMA_VERSION,
                        &store_instance_id,
                    ],
                )
                .map_err(HistoryError::from)?;
            validate_and_remember_history_selection(
                store,
                &manifest,
                &StorePortability {
                    instance_id: store_instance_id,
                    clean_close_sequence: 0,
                    state: StorePortabilityState::Open,
                },
                true,
            )?;
        }
    }
    // Journal mode changes the database header, so even this configuration
    // must wait until an existing store passes observation admission.
    connection
        .execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(HistoryError::from)?;
    configure_wal_bounds(&connection)?;
    // Maintain derived indexes only after format, identity, generation and
    // observation admission above. Exact intent IDs replaced target matching;
    // no query uses the old target/source/hash access path.
    // Keep the direct prepared-intent guard (including corrupt orphan rows)
    // without scanning every retained terminal receipt on each publication.
    connection
        .execute_batch(
            "DROP INDEX IF EXISTS prepared_intents_by_target;
         CREATE INDEX IF NOT EXISTS prepared_intents_pending_by_note
         ON prepared_intents(note_id) WHERE status = 'prepared';
         CREATE INDEX IF NOT EXISTS revisions_by_predecessor
         ON revisions(note_id, predecessor_kind, predecessor_id);
         CREATE INDEX IF NOT EXISTS lifecycle_events_by_predecessor
         ON lifecycle_events(note_id, predecessor_kind, predecessor_id)",
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Maintain Note Timeline access indexes")
        })?;
    let activate_session = ACTIVE_HISTORY_STORE_SESSIONS
        .lock()
        .map_err(|_| "Note Timeline history store sessions lock poisoned".to_string())?
        .insert(path);
    if activate_session {
        connection
            .execute(
                "UPDATE history_metadata SET portability_state = 'open' WHERE singleton = 1",
                [],
            )
            .map_err(|error| {
                HistoryError::from(error).with_context("Mark Note Timeline history store open")
            })?;
        checkpoint_store(&connection, "open")?;
    }
    Ok(connection)
}

fn checkpoint_store(connection: &Connection, purpose: &str) -> Result<(), HistoryError> {
    let (busy, remaining, _checkpointed) = connection
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, u64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|error| {
            HistoryError::from(error)
                .with_context(format!("Checkpoint Note Timeline for {purpose}"))
        })?;
    if busy != 0 || remaining != 0 {
        return Err(format!(
            "Checkpoint Note Timeline for {purpose} remained busy ({busy}) with {remaining} WAL frames"
        ).into());
    }
    Ok(())
}

fn configure_wal_bounds(connection: &Connection) -> Result<(), HistoryError> {
    let page_size = connection
        .query_row("PRAGMA page_size", [], |row| row.get::<_, u64>(0))
        .map_err(|error| {
            HistoryError::from(error).with_context("Read Note Timeline WAL page size")
        })?;
    let wal_header_bytes = 32_u64;
    let wal_frame_header_bytes = 24_u64;
    let autocheckpoint_pages = BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES
        .saturating_sub(wal_header_bytes)
        .checked_div(page_size.saturating_add(wal_frame_header_bytes))
        .unwrap_or(0)
        .max(1);
    connection
        .pragma_update(None, "wal_autocheckpoint", autocheckpoint_pages)
        .map_err(|error| {
            HistoryError::from(error).with_context("Configure Note Timeline WAL autocheckpoint")
        })?;
    connection
        .pragma_update(
            None,
            "journal_size_limit",
            BACKGROUND_HISTORY_COMPACTION_BUDGET_BYTES,
        )
        .map_err(|error| {
            HistoryError::from(error).with_context("Configure Note Timeline WAL size limit")
        })?;
    Ok(())
}

pub(super) fn recover_pending(store: &Store) -> Result<(), HistoryError> {
    #[cfg(test)]
    if take_fault(FaultPoint::Recover) {
        return Err("injected history recovery failure".to_string().into());
    }
    let connection = open_store(store)?;
    verify_pending_recovery_notes(store, &connection, false)?;
    recover_pending_with_connection(&connection, false)?;
    editing_windows::release_recovered_receipts(&connection)
}

// A completed operation may leave an uncertain capture with a released receipt.
// Retry only those records: a concurrent read must never recover a live writer.
pub(super) fn recover_released_publications(store: &Store) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    verify_pending_recovery_notes(store, &connection, true)?;
    recover_pending_with_connection(&connection, true)
}
fn verify_pending_recovery_notes(
    store: &Store,
    connection: &Connection,
    released_only: bool,
) -> Result<(), HistoryError> {
    let mut stmt = connection.prepare("SELECT DISTINCT i.note_id FROM prepared_intents i JOIN publication_receipts p ON p.intent_id=i.intent_id WHERE i.status='prepared' AND (?1=0 OR p.live=0)")?;
    for note in stmt.query_map([released_only], |r| r.get::<_, String>(0))? {
        verify_note(
            store,
            &NoteIdentity::new(note?),
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )?;
    }
    Ok(())
}

fn recover_pending_with_connection(
    connection: &Connection,
    released_only: bool,
) -> Result<(), HistoryError> {
    let pending = {
        let mut statement = connection
            .prepare(
                "SELECT intent_id, target_path, authored_payload, result_hash, note_id
                 FROM prepared_intents WHERE status = 'prepared'
                   AND (?1 = 0 OR EXISTS (SELECT 1 FROM publication_receipts p
                        WHERE p.intent_id = prepared_intents.intent_id AND p.live = 0))
                 ORDER BY prepared_at_millis, intent_id",
            )
            .map_err(HistoryError::from)?;
        let pending = statement
            .query_map([released_only], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    PathBuf::from(row.get::<_, String>(1)?),
                    row.get::<_, Vec<u8>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(HistoryError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(HistoryError::from)?;
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
                    finalize_intent(&mut recovered, &intent_id, &canonical_payload, None)?;
                    #[cfg(feature = "e2e-wdio")]
                    crate::e2e_process_fault::hit("recovery-publication-captured");
                } else {
                    editing_windows::abandon(connection, &intent_id)?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                editing_windows::abandon(connection, &intent_id)?;
            }
            Err(error) => {
                return Err(format!(
                    "Read pending canonical publication {}: {error}",
                    path.display()
                )
                .into());
            }
        }
    }
    Ok(())
}

// A separate connection avoids requiring mutable access from read-capability
// callers while SQLite serializes the short finalization transaction.
fn open_existing_connection(existing: &Connection) -> Result<Connection, HistoryError> {
    let path = existing
        .path()
        .ok_or("History recovery connection has no database path")?;
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(HistoryError::from)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA synchronous=FULL;
             PRAGMA busy_timeout=5000;",
        )
        .map_err(HistoryError::from)?;
    Ok(connection)
}

fn finalize_intent(
    connection: &mut Connection,
    intent_id: &str,
    authored_payload: &[u8],
    prepared_base: Option<&PreparedRevisionBase>,
) -> Result<(), HistoryError> {
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(HistoryError::from)?;
    editing_windows::validate_preparation(&transaction, intent_id)?;
    let intent = load_intent(&transaction, intent_id)?;
    if intent.status != "prepared" {
        return Err("Prepared Note Revision intent is no longer recoverable"
            .to_string()
            .into());
    }
    if hash(authored_payload) != intent.result_hash || authored_payload != intent.authored_payload {
        return Err(
            "Committed authored state does not match its durable history intent"
                .to_string()
                .into(),
        );
    }
    if editing_windows::capture(&transaction, intent_id, &intent, authored_payload)? {
        transaction.commit().map_err(HistoryError::from)?;
        return Ok(());
    }
    editing_windows::require_no_window(&transaction, &intent.note_id)?;
    let head = load_head(&transaction, &intent.note_id)?;
    let content_is_unchanged = head.as_ref().and_then(|head| head.result_hash.as_deref())
        == Some(intent.result_hash.as_str());
    let mut record_count = head.as_ref().map_or(0, |head| head.record_count);

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
            .map_err(HistoryError::from)?;
        record_count += 1;
        predecessor = Some(("lifecycleEvent".to_string(), event_id.clone()));
        if content_is_unchanged {
            transaction
                .execute(
                    "UPDATE timeline_heads
                     SET record_kind = 'lifecycleEvent', record_id = ?1, current_path = ?2,
                         record_count = ?3
                     WHERE note_id = ?4",
                    params![
                        event_id,
                        intent.target_path.to_string_lossy().into_owned(),
                        record_count,
                        intent.note_id,
                    ],
                )
                .map_err(HistoryError::from)?;
        }
    }
    if let Some(event_id) = intent.lifecycle_event_id.as_deref() {
        let inserted = transaction
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
            .map_err(HistoryError::from)?;
        record_count += inserted;
        predecessor = Some(("lifecycleEvent".to_string(), event_id.to_string()));
    }

    if content_is_unchanged {
        editing_windows::finish(
            &transaction,
            intent_id,
            Some(&CaptureOutcome::Unchanged {
                result_hash: intent.result_hash.clone(),
            }),
        )?;
        transaction.commit().map_err(HistoryError::from)?;
        return Ok(());
    }

    let source = MutationSource::from_storage_value(&intent.source).ok_or_else(|| {
        corrupt(format!(
            "Unknown prepared Mutation Source `{}`",
            intent.source
        ))
    })?;
    append_revision(
        &transaction,
        RevisionAppend {
            prepared_base,
            revision_id: intent
                .revision_id
                .as_deref()
                .ok_or_else(|| corrupt("Missing point publication Revision Identity"))?,
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
            record_count: record_count + 1,
        },
    )?;
    editing_windows::finish(
        &transaction,
        intent_id,
        Some(&CaptureOutcome::Revision {
            revision_id: intent
                .revision_id
                .ok_or_else(|| corrupt("Missing point publication Revision Identity"))?,
        }),
    )?;
    Ok(transaction.commit().map_err(HistoryError::from)?)
}

#[derive(Default)]
struct RevisionPolicy {
    replay_count: u64,
    accumulated_delta_bytes: u64,
}

struct PreparedIntent {
    revision_id: Option<String>,
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
    record_count: usize,
}

fn load_intent(
    transaction: &Transaction<'_>,
    intent_id: &str,
) -> Result<PreparedIntent, HistoryError> {
    Ok(transaction
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
        .map_err(HistoryError::from)?)
}

fn load_head(
    transaction: &Transaction<'_>,
    note_id: &str,
) -> Result<Option<TimelineHead>, HistoryError> {
    Ok(transaction
        .query_row(
            "SELECT record_kind, record_id, revision_id, result_hash, current_path, record_count
             FROM timeline_heads WHERE note_id = ?1",
            params![note_id],
            |row| {
                Ok(TimelineHead {
                    record_kind: row.get(0)?,
                    record_id: row.get(1)?,
                    revision_id: row.get(2)?,
                    result_hash: row.get(3)?,
                    current_path: PathBuf::from(row.get::<_, String>(4)?),
                    record_count: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(HistoryError::from)?)
}

fn load_revision_policy(
    connection: &Connection,
    revision_id: &str,
) -> Result<RevisionPolicy, HistoryError> {
    Ok(connection
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
        .map_err(HistoryError::from)?)
}

// Constructed only after hash and UTF-8/structure validation. A predecessor's
// verified hash can be compared directly to the next delta's base hash during
// this reconstruction/page/attestation; no payload escapes into a runtime cache.
#[derive(Clone)]
struct VerifiedAuthoredPayload {
    bytes: Vec<u8>,
    result_hash: String,
}

fn reconstruct_revision(
    connection: &Connection,
    revision_id: &str,
) -> Result<Vec<u8>, HistoryError> {
    reconstruct_revision_after(connection, revision_id, None).map(|verified| verified.bytes)
}

fn reconstruct_revision_after(
    connection: &Connection,
    revision_id: &str,
    previous: Option<(&str, &VerifiedAuthoredPayload)>,
) -> Result<VerifiedAuthoredPayload, HistoryError> {
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
        .map_err(HistoryError::from)?;
    let (base_revision_id, payload_version, payload_kind, payload, base_hash, result_hash) = row;
    let result = match payload_kind.as_str() {
        "checkpoint" if payload_version == CHECKPOINT_PAYLOAD_VERSION => {
            zstd::stream::decode_all(Cursor::new(payload))
                .map_err(|error| corrupt(format!("Decompress Note Revision checkpoint: {error}")))?
        }
        "delta" if payload_version == DELTA_PAYLOAD_VERSION => {
            let base_revision_id = base_revision_id
                .ok_or_else(|| corrupt("Delta Note Revision has no base revision"))?;
            let base = match previous.filter(|(id, _)| *id == base_revision_id) {
                Some((_, bytes)) => std::borrow::Cow::Borrowed(bytes),
                None => std::borrow::Cow::Owned(reconstruct_revision_after(
                    connection,
                    &base_revision_id,
                    None,
                )?),
            };
            if base_hash.as_deref() != Some(base.result_hash.as_str()) {
                return Err(corrupt("Note Revision base hash verification failed"));
            }
            LineDelta::decode(&payload)?.apply(&base.bytes)?
        }
        _ => return Err(corrupt("Unsupported Note Revision payload version")),
    };
    if hash(&result) != result_hash {
        return Err(corrupt("Note Revision result hash verification failed"));
    }
    AuthoredState::decode_parts(&result)?;
    Ok(VerifiedAuthoredPayload {
        bytes: result,
        result_hash,
    })
}

fn parse_record_identity(
    kind: Option<String>,
    identity: Option<String>,
) -> Result<Option<TimelineRecordIdentity>, HistoryError> {
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
        (kind, identity) => Err(corrupt(format!(
            "Invalid stored Timeline predecessor kind={kind:?} identity={identity:?}"
        ))),
    }
}

fn parse_payload_version(version: i64) -> Result<PayloadVersion, HistoryError> {
    match version {
        1 => Ok(PayloadVersion::V1),
        _ => Err(corrupt(format!(
            "Unknown stored Payload Version `{version}`"
        ))),
    }
}

fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub(super) fn authored_content(markdown: &str) -> ReconstructedNoteRevision {
    let authored = AuthoredState::from_canonical(markdown);
    ReconstructedNoteRevision {
        unmanaged_frontmatter: authored.unmanaged_frontmatter,
        body: authored.body,
    }
}

pub(super) fn authored_content_hash(markdown: &str) -> String {
    hash(&AuthoredState::from_canonical(markdown).encode())
}

pub(super) fn authored_parts_hash(unmanaged_frontmatter: Option<&str>, body: &str) -> String {
    hash(
        &AuthoredState {
            unmanaged_frontmatter: unmanaged_frontmatter.map(str::to_string),
            body: body.to_string(),
        }
        .encode(),
    )
}

fn read_u64(encoded: &[u8], offset: usize) -> Result<u64, HistoryError> {
    Ok(encoded
        .get(offset..offset + 8)
        .ok_or_else(|| corrupt("Truncated fixed-width payload field"))?
        .try_into()
        .map(u64::from_le_bytes)
        .map_err(|_| corrupt("Invalid fixed-width payload field"))?)
}

fn managed_note_identity(markdown: &str) -> Result<String, HistoryError> {
    Ok(crate::note::parse_note(markdown)
        .frontmatter
        .managed
        .map(|metadata| metadata.id)
        .filter(|identity| !identity.trim().is_empty())
        .ok_or_else(|| "Canonical history publication has no managed Note Identity".to_string())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNUSED_TARGET_INDEX: &str = "CREATE INDEX prepared_intents_by_target
        ON prepared_intents(target_path, source, result_hash, status)";

    #[test]
    fn admitted_store_removes_only_the_unused_target_index() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("index-cleanup-data");
        let notes = crate::test_support::TestDir::new("index-cleanup-notes");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let store = Store::for_test();
        let indexes = |db: &Connection| {
            db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
                .unwrap()
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        let db = open_store(&store).unwrap();
        let fresh_indexes = indexes(&db);
        assert!(!fresh_indexes
            .iter()
            .any(|name| name == "prepared_intents_by_target"));
        for required in [
            "prepared_intents_pending_by_note",
            "revisions_by_predecessor",
            "lifecycle_events_by_predecessor",
        ] {
            assert!(fresh_indexes.iter().any(|name| name == required));
        }
        db.execute_batch(UNUSED_TARGET_INDEX).unwrap();
        drop(db);
        let db = open_store(&store).unwrap();
        assert_eq!(indexes(&db), fresh_indexes);
        drop(db);
        assert_eq!(indexes(&open_store(&store).unwrap()), fresh_indexes);
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn rejected_store_preserves_unused_index_and_durable_bytes() {
        let _guard = crate::test_support::lock_test_env();
        for rejection in [
            "schema",
            "missing metadata",
            "vault",
            "format",
            "generation",
            "instance",
            "empty instance",
            "observed generation",
            "observed format",
            "watermark",
            "live copy",
        ] {
            let data = crate::test_support::TestDir::new("rejected-index-data");
            let notes = crate::test_support::TestDir::new("rejected-index-notes");
            crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
            crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
            let manifest = crate::state::ensure_vault_scaffold(notes.path()).unwrap();
            let store = Store::for_test();
            let db = open_store(&store).unwrap();
            db.execute_batch(UNUSED_TARGET_INDEX).unwrap();
            let observations_path = history_observations_path(&store).unwrap();
            let mut observations = read_history_observations(&observations_path).unwrap();
            let observed = observations.vaults.get_mut(&manifest.vault_id).unwrap();
            match rejection {
                "schema" => {
                    db.execute_batch("UPDATE history_metadata SET schema_version=12")
                        .unwrap();
                }
                "missing metadata" => {
                    db.execute_batch("DELETE FROM history_metadata").unwrap();
                }
                "vault" => {
                    db.execute_batch("UPDATE history_metadata SET vault_id='other'")
                        .unwrap();
                }
                "format" => {
                    db.execute_batch("UPDATE history_metadata SET history_format='other'")
                        .unwrap();
                }
                "generation" => {
                    db.execute_batch(
                        "UPDATE history_metadata SET history_generation=history_generation+1",
                    )
                    .unwrap();
                }
                "instance" => {
                    db.execute_batch("UPDATE history_metadata SET store_instance_id='replacement'")
                        .unwrap();
                }
                "empty instance" => {
                    db.execute_batch("UPDATE history_metadata SET store_instance_id=''")
                        .unwrap();
                }
                "observed generation" => observed.generation += 1,
                "observed format" => observed.history_format = "other".into(),
                "watermark" => observed.clean_close_sequence += 1,
                "live copy" => observations.vaults.clear(),
                _ => unreachable!(),
            }
            write_history_observations(&observations_path, &observations).unwrap();
            // A clean portable copy can use DELETE journaling. Rejection must
            // not even change its journal-mode header before admission.
            db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
                .unwrap();
            drop(db);
            let database = history_database_path(&store).unwrap();
            let before = fs::read(&database).unwrap();
            let observation_before = fs::read(&observations_path).unwrap();
            assert!(open_store(&store).is_err(), "{rejection}");
            assert_eq!(fs::read(&database).unwrap(), before, "{rejection}");
            assert_eq!(
                fs::read(&observations_path).unwrap(),
                observation_before,
                "{rejection}"
            );
            assert!(
                !database.with_file_name("history.sqlite3-wal").exists(),
                "{rejection}"
            );
            let db =
                Connection::open_with_flags(&database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .unwrap();
            assert_eq!(db.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='prepared_intents_by_target'", [], |row| row.get::<_, u64>(0)).unwrap(), 1, "{rejection}");
        }
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn unsupported_or_incomplete_existing_stores_are_rejected_before_schema_writes() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("strict-schema-data");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        for schema in [
            None,
            Some(0),
            Some(5),
            Some(6),
            Some(7),
            Some(8),
            Some(9),
            Some(10),
            Some(11),
            Some(12),
            Some(13),
            Some(14),
        ] {
            let notes = crate::test_support::TestDir::new("strict-schema-notes");
            crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
            let manifest = crate::state::ensure_vault_scaffold(notes.path()).unwrap();
            let database = history_database_path(&Store::for_test()).unwrap();
            let db = Connection::open(&database).unwrap();
            if let Some(schema) = schema {
                db.execute_batch("CREATE TABLE history_metadata(singleton INTEGER PRIMARY KEY, vault_id TEXT, history_format TEXT, history_generation INTEGER, schema_version INTEGER)").unwrap();
                db.execute(
                    "INSERT INTO history_metadata VALUES(1,?1,?2,?3,?4)",
                    params![
                        manifest.vault_id,
                        manifest.history_format,
                        manifest.history_generation,
                        schema
                    ],
                )
                .unwrap();
            } else {
                db.execute_batch("CREATE TABLE unrelated(payload TEXT); INSERT INTO unrelated VALUES('preserve');").unwrap();
            }
            drop(db);
            let before = fs::read(&database).unwrap();
            assert!(open_store(&Store::for_test())
                .unwrap_err()
                .to_string()
                .contains("rebuild history"));
            assert_eq!(fs::read(&database).unwrap(), before);
        }
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn verified_predecessor_reuse_still_checks_the_next_base_and_result_hashes() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE revisions (revision_id TEXT PRIMARY KEY,
            base_revision_id TEXT, payload_version INTEGER, payload_kind TEXT,
            payload BLOB, base_hash TEXT, result_hash TEXT, note_id TEXT DEFAULT 'note')",
            )
            .unwrap();
        let base = AuthoredState {
            unmanaged_frontmatter: None,
            body: "Original 🌍\n".repeat(100),
        }
        .encode();
        let next = AuthoredState {
            unmanaged_frontmatter: None,
            body: "Updated 🌍\n".repeat(100),
        }
        .encode();
        connection.execute("INSERT INTO revisions (revision_id, base_revision_id, payload_version, payload_kind, payload, base_hash, result_hash) VALUES ('base', NULL, 1, 'checkpoint', ?1, NULL, ?2)",
            params![zstd::stream::encode_all(Cursor::new(&base), 3).unwrap(), hash(&base)]).unwrap();
        connection.execute("INSERT INTO revisions (revision_id, base_revision_id, payload_version, payload_kind, payload, base_hash, result_hash) VALUES ('next', 'base', 1, 'delta', ?1, 'bad base hash', ?2)",
            params![LineDelta::between(&base, &next).encode(), hash(&next)]).unwrap();
        let previous = reconstruct_revision_after(&connection, "base", None).unwrap();
        assert!(
            reconstruct_revision_after(&connection, "next", Some(("base", &previous)))
                .err()
                .unwrap()
                .to_string()
                .contains("base hash")
        );
        connection
            .execute(
                "UPDATE revisions SET base_hash = ?1 WHERE revision_id = 'next'",
                params![hash(&base)],
            )
            .unwrap();
        assert_eq!(
            reconstruct_revision_after(&connection, "next", Some(("base", &previous)))
                .unwrap()
                .bytes,
            next
        );
        connection
            .execute(
                "UPDATE revisions SET result_hash = 'bad result hash' WHERE revision_id = 'next'",
                [],
            )
            .unwrap();
        assert!(
            reconstruct_revision_after(&connection, "next", Some(("base", &previous)))
                .err()
                .unwrap()
                .to_string()
                .contains("result hash")
        );
        connection.execute("UPDATE revisions SET payload_kind = 'checkpoint', payload = ?1, result_hash = ?2, base_hash = 'bad checkpoint base' WHERE revision_id = 'next'",
            params![zstd::stream::encode_all(Cursor::new(&next), 3).unwrap(), hash(&next)]).unwrap();
        assert!(verify_revision_payloads(&connection, None)
            .unwrap_err()
            .to_string()
            .contains("base hash"));
        connection
            .execute(
                "UPDATE revisions SET base_hash = ?1 WHERE revision_id = 'next'",
                params![hash(&base)],
            )
            .unwrap();
        verify_revision_payloads(&connection, None).unwrap();
        connection.execute("UPDATE revisions SET base_hash = 'unexpected root base' WHERE revision_id = 'base'", []).unwrap();
        assert!(verify_revision_payloads(&connection, None)
            .unwrap_err()
            .to_string()
            .contains("base hash"));
    }

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
    fn generated_authored_edits_round_trip_through_serialized_deltas() {
        // Fixed seeds make a failing edit sequence reproducible without an RNG dependency.
        for initial_seed in [1_u64, 23, 0xdead_beef, u64::MAX] {
            let mut seed = initial_seed;
            let mut next = || {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                (seed >> 32) as usize
            };
            let tokens = ["a", "é", "🦀", "\r\n", "\n", "---", "\0", "中", " "];
            let mut chars = Vec::new();
            let mut base = Vec::new();
            for step in 0..256 {
                let position = next() % (chars.len() + 1);
                match next() % 4 {
                    0 => chars.truncate(position),
                    1 if position < chars.len() => {
                        chars.remove(position);
                    }
                    _ => chars.insert(position, tokens[next() % tokens.len()]),
                }
                let state = AuthoredState {
                    unmanaged_frontmatter: (next() % 3 == 0)
                        .then(|| format!("tag: {}\r\n", tokens[next() % tokens.len()])),
                    body: chars.concat(),
                };
                let encoded = state.encode();
                let payload = LineDelta::between(&base, &encoded).encode();
                let rebuilt = LineDelta::decode(&payload).unwrap().apply(&base).unwrap();
                assert_eq!(rebuilt, encoded, "seed={initial_seed}, step={step}");
                assert_eq!(AuthoredState::decode(&rebuilt).unwrap(), state);
                base = rebuilt;
            }
        }
    }

    #[test]
    fn comparison_rejects_a_checkpoint_with_disconnected_lineage() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("comparison-lineage-data");
        let notes = crate::test_support::TestDir::new("comparison-lineage-notes");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Lineage.md");
        for (source, kind, character) in [
            (
                MutationSource::NoteCreation,
                PublicationIntentKind::Create,
                "a",
            ),
            (
                MutationSource::TaskAction,
                PublicationIntentKind::Update,
                "b",
            ),
        ] {
            let markdown = format!(
                "---\ngneauxghts:\n  id: lineage-note\n  kind: note\n---\n\n{}",
                character.repeat(2048)
            );
            let intent =
                prepare_publication(&Store::for_test(), source, &path, &markdown, kind, None)
                    .unwrap();
            fs::write(&path, &markdown).unwrap();
            finalize_publication(&Store::for_test(), &intent, source, &path, &markdown).unwrap();
        }
        let id = NoteIdentity::new("lineage-note");
        let selected = revisions(&Store::for_test(), &id)
            .unwrap()
            .pop()
            .unwrap()
            .identity()
            .clone();
        let connection = open_store(&Store::for_test()).unwrap();
        let kind: String = connection
            .query_row(
                "SELECT payload_kind FROM revisions WHERE revision_id = ?1",
                params![selected.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kind, "checkpoint");
        assert!(verify_revision_payloads(&connection, None).is_ok());
        connection
            .execute(
                "UPDATE revisions SET base_revision_id = NULL WHERE revision_id = ?1",
                params![selected.as_str()],
            )
            .unwrap();
        assert!(verify_revision_payloads(&connection, None).is_err());
        drop(connection);
        assert_eq!(
            reconstruct(&Store::for_test(), &id, &selected)
                .unwrap()
                .body(),
            "b".repeat(2048)
        );
        assert!(reconstruct_comparison(
            &Store::for_test(),
            &id,
            &selected,
            super::super::HistoryDiffComparison::Parent
        )
        .is_err());
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn prepared_base_must_match_retained_history_and_recovery_needs_no_memory() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("prepared-base-data");
        let notes = crate::test_support::TestDir::new("prepared-base-notes");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let path = notes.path().join("Candidate.md");
        let canonical = |body: &str| {
            format!("---\ngneauxghts:\n  id: candidate-note\n  kind: note\n---\n\n{body}")
        };
        let original = canonical("Retained original\n");
        let first = prepare_publication(
            &Store::for_test(),
            MutationSource::NoteCreation,
            &path,
            &original,
            PublicationIntentKind::Create,
            None,
        )
        .unwrap();
        fs::write(&path, &original).unwrap();
        finalize_publication(
            &Store::for_test(),
            &first,
            MutationSource::NoteCreation,
            &path,
            &original,
        )
        .unwrap();
        // Canonical content captured for preparation may differ from the retained
        // head (e.g. an external edit). It must never become an unchecked delta base.
        let external = canonical("Different external bytes\n");
        let updated = canonical("Retained original\nNew line\n");
        let second = prepare_publication(
            &Store::for_test(),
            MutationSource::TaskAction,
            &path,
            &updated,
            PublicationIntentKind::Update,
            Some(BaselineSeed {
                path: &path,
                canonical_markdown: &external,
                known_since_millis: 1,
            }),
        )
        .unwrap();
        fs::write(&path, &updated).unwrap();
        finalize_publication(
            &Store::for_test(),
            &second,
            MutationSource::TaskAction,
            &path,
            &updated,
        )
        .unwrap();
        let id = NoteIdentity::new("candidate-note");
        assert_eq!(
            reconstruct_latest(&Store::for_test(), &id).unwrap().body(),
            "Retained original\nNew line\n"
        );
        let final_markdown = canonical("After restart\n");
        let pending = prepare_publication(
            &Store::for_test(),
            MutationSource::TaskAction,
            &path,
            &final_markdown,
            PublicationIntentKind::Update,
            Some(BaselineSeed {
                path: &path,
                canonical_markdown: &updated,
                known_since_millis: 1,
            }),
        )
        .unwrap();
        fs::write(&path, &final_markdown).unwrap();
        drop(pending);
        recover_pending(&Store::for_test()).unwrap();
        recover_pending(&Store::for_test()).unwrap();
        assert_eq!(revisions(&Store::for_test(), &id).unwrap().len(), 3);
        assert_eq!(
            reconstruct_latest(&Store::for_test(), &id).unwrap().body(),
            "After restart\n"
        );
        assert!(verify_revision_payloads(&open_store(&Store::for_test()).unwrap(), None).is_ok());
        crate::state::set_notes_root_override(None).unwrap();
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
            &Store::for_test(),
            MutationSource::NoteCreation,
            &path,
            markdown,
            PublicationIntentKind::Create,
            None,
        )
        .unwrap();
        fs::write(&path, markdown).unwrap();
        finalize_publication(
            &Store::for_test(),
            &history_intent,
            MutationSource::NoteCreation,
            &path,
            markdown,
        )
        .unwrap();
        let note_id = NoteIdentity::new("corrupt-note");
        let revision = revisions(&Store::for_test(), &note_id).unwrap().remove(0);
        let connection = open_store(&Store::for_test()).unwrap();
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

        let error = reconstruct(&Store::for_test(), &note_id, revision.identity()).unwrap_err();
        assert!(error.to_string().contains("checkpoint") || error.to_string().contains("hash"));
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
        let connection = open_store(&Store::for_test()).unwrap();
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
        let database_path = history_database_path(&Store::for_test()).unwrap();
        let wal_path = sqlite_sidecar_path(&database_path, "-wal");
        let wal_before = storage_file_bytes(&wal_path).unwrap();
        assert!(wal_before > 1);
        let physical_bytes = sqlite_store_paths(&database_path)
            .into_iter()
            .map(|path| storage_file_bytes(&path).unwrap())
            .sum::<u64>();

        assert_eq!(
            storage_usage_with_connection(&Store::for_test(), &connection)
                .unwrap()
                .allocated_bytes,
            physical_bytes
        );
        compact(&Store::for_test(), 1).unwrap();
        assert!(storage_file_bytes(&wal_path).unwrap() >= wal_before);
        crate::state::set_notes_root_override(None).unwrap();
    }
}

pub(super) fn mark_window_clock_discontinuity(
    store: &Store,
    note: &NoteIdentity,
    id: &str,
    generation: u64,
    changed: bool,
) -> Result<(), HistoryError> {
    if !changed {
        return Ok(());
    }
    let mut connection = open_store(store)?;
    let tx = connection.transaction().map_err(HistoryError::from)?;
    if let Some(mut window) = editing_windows::pending(&tx, Some(note.as_str()))?.pop() {
        if window.window_id == id && window.generation == generation {
            window.evidence.clock_discontinuity = true;
            tx.execute(
                "UPDATE pending_editing_windows SET evidence=?2 WHERE note_id=?1",
                params![
                    note.as_str(),
                    serde_json::to_string(&window.evidence).map_err(HistoryError::from)?
                ],
            )
            .map_err(HistoryError::from)?;
        }
    }
    Ok(tx.commit().map_err(HistoryError::from)?)
}

#[cfg(test)]
pub(super) fn editing_window_evidence(
    store: &Store,
    revision: &RevisionIdentity,
) -> Result<Option<editing_windows::WindowEvidence>, HistoryError> {
    let json: Option<String> = open_store(store)?
        .query_row(
            "SELECT evidence FROM revision_window_evidence WHERE revision_id=?1",
            [revision.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(HistoryError::from)?;
    Ok(json
        .map(|value| serde_json::from_str(&value).map_err(HistoryError::from))
        .transpose()?)
}

#[cfg(test)]
pub(super) fn damage_retained_revision_for_test(
    store: &Store,
    revision_id: &str,
    damage: super::HistoryTestDamage,
) {
    let db = open_store(store).unwrap();
    match damage {
        super::HistoryTestDamage::Payload => {
            db.execute(
                "UPDATE revisions SET payload=X'00' WHERE revision_id=?1",
                [revision_id],
            )
            .unwrap();
        }
        super::HistoryTestDamage::WindowEvidence => {
            db.execute(
                "UPDATE revision_window_evidence SET evidence='{}' WHERE revision_id=?1",
                [revision_id],
            )
            .unwrap();
        }
        super::HistoryTestDamage::ReciprocalEvidence => {
            db.execute("UPDATE publication_receipts SET outcome='{}' WHERE intent_id=(SELECT intent_id FROM revisions WHERE revision_id=?1)", [revision_id]).unwrap();
        }
        super::HistoryTestDamage::PayloadVersion => {
            db.execute(
                "UPDATE revisions SET payload_version=99 WHERE revision_id=?1",
                [revision_id],
            )
            .unwrap();
        }
        super::HistoryTestDamage::DeltaLength => {
            let (base_payload, base_hash): (Vec<u8>, String) = db.query_row(
                        "SELECT b.payload,b.result_hash FROM revisions r JOIN revisions b ON b.revision_id=r.base_revision_id WHERE r.revision_id=?1",
                        [revision_id], |r| Ok((r.get(0)?,r.get(1)?)),
                    ).unwrap();
            let base = zstd::stream::decode_all(std::io::Cursor::new(base_payload)).unwrap();
            let mut delta = b"NTL1".to_vec();
            delta.extend_from_slice(&(base.len() as u64 + 1).to_le_bytes());
            delta.extend_from_slice(&1_u32.to_le_bytes());
            delta.push(0); // Valid retain operation; the declared result length is wrong.
            delta.extend_from_slice(&(base.len() as u64).to_le_bytes());
            db.execute("UPDATE revisions SET payload_kind='delta',payload_version=1,payload=?1,base_hash=?2 WHERE revision_id=?3",
                        rusqlite::params![delta,base_hash,revision_id]).unwrap();
        }
        super::HistoryTestDamage::Ancestry => {
            db.execute(
                "UPDATE revisions SET base_revision_id=NULL WHERE revision_id=?1",
                [revision_id],
            )
            .unwrap();
        }
        super::HistoryTestDamage::Lineage => {
            db.execute("UPDATE revisions SET predecessor_kind='revision',predecessor_id='absent' WHERE revision_id=?1", [revision_id]).unwrap();
        }
        super::HistoryTestDamage::Predecessor => {
            db.execute(
                "UPDATE revisions SET predecessor_kind='invalid' WHERE revision_id=?1",
                [revision_id],
            )
            .unwrap();
        }
        super::HistoryTestDamage::DatabaseBytes => {
            db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        }
        super::HistoryTestDamage::Source => {
            db.execute(
                "UPDATE revisions SET source='invalid-source' WHERE revision_id=?1",
                [revision_id],
            )
            .unwrap();
        }
    }
    drop(db);
    if damage == super::HistoryTestDamage::DatabaseBytes {
        fs::write(
            Ok::<_, HistoryError>(store.data_dir.clone())
                .unwrap()
                .join("history.sqlite3"),
            b"not a SQLite database",
        )
        .unwrap();
    }
}

#[cfg(test)]
#[path = "history_store_sql_work.rs"]
pub(super) mod sql_work;
