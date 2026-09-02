//! Private SQLite persistence and revision codec for `NoteTimeline`.
//!
//! SQL, WAL policy, row ordering, and checkpoint placement intentionally stop
//! here. The parent module exposes only storage-neutral domain records.

use super::{
    HistoryIntentIdentity, LifecycleEventHeader, LifecycleEventIdentity, LifecycleEventKind,
    MutationSource, NoteIdentity, NoteRevisionHeader, PayloadVersion, ReconstructedNoteRevision,
    RevisionIdentity, RevisionTimeEvidence, TimelineRecordIdentity,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use similar::{capture_diff_slices, Algorithm, DiffOp};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const HISTORY_DATABASE_FILE_NAME: &str = "history.sqlite3";
const HISTORY_FORMAT: &str = "sqlite-v1";
const HISTORY_GENERATION: u64 = 1;
const HISTORY_SCHEMA_VERSION: u64 = 3;
const AUTHORED_STATE_MAGIC: &[u8; 4] = b"NAS1";
const LINE_DELTA_MAGIC: &[u8; 4] = b"NTL1";
const CHECKPOINT_PAYLOAD_VERSION: i64 = 1;
const DELTA_PAYLOAD_VERSION: i64 = 1;
const MAX_REPLAY_REVISIONS: u64 = 128;
const MAX_ACCUMULATED_DELTA_BYTES: u64 = 256 * 1024;
const MAX_DELTA_TO_FULL_RATIO: f64 = 0.65;
const MAX_MEASURED_REPLAY: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PublicationIntentKind {
    Create,
    Update,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FaultPoint {
    Prepare,
    Finalize,
    Recover,
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

pub(super) fn prepare_publication(
    source: MutationSource,
    target_path: &Path,
    markdown: &str,
    kind: PublicationIntentKind,
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
    let connection = open_store()?;
    let intent_id = crate::note::generate_unique_id();
    let revision_id = RevisionIdentity::issue().0;
    let prepared_at_millis = crate::time::current_time_millis()
        .map_err(|error| format!("Issue canonical publication time: {error}"))?;
    let lifecycle_event_id =
        (kind == PublicationIntentKind::Create).then(|| LifecycleEventIdentity::issue().0);
    connection
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
    let (committed_at_millis, observed_at_millis, modified_at_millis) = match append.time_evidence {
        RevisionTimeEvidence::Committed {
            committed_at_millis,
        } => (Some(committed_at_millis), None, None),
        RevisionTimeEvidence::Observed {
            observed_at_millis,
            modified_at_millis,
        } => (None, Some(observed_at_millis), modified_at_millis),
    };
    transaction
        .execute(
            "INSERT INTO revisions (
               revision_id, note_id, predecessor_kind, predecessor_id, base_revision_id,
               source, committed_at_millis, observed_at_millis, modified_at_millis,
               payload_version, payload_kind, payload, base_hash, result_hash,
               replay_count, accumulated_delta_bytes, intent_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                       ?13, ?14, ?15, ?16, ?17)",
            params![
                append.revision_id,
                append.note_id,
                append.predecessor.map(|value| value.0),
                append.predecessor.map(|value| value.1),
                append.base_revision_id,
                append.source.as_storage_value(),
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

pub(super) fn revisions(note_id: &NoteIdentity) -> Result<Vec<NoteRevisionHeader>, String> {
    let connection = open_store()?;
    let mut statement = connection
        .prepare(
            "SELECT revision_id, predecessor_kind, predecessor_id, source, base_revision_id,
                    committed_at_millis, observed_at_millis, modified_at_millis, payload_version
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
                row.get::<_, i64>(8)?,
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
                committed_at_millis,
                observed_at_millis,
                modified_at_millis,
                payload_version,
            )| {
                let source = MutationSource::from_storage_value(&source)
                    .ok_or_else(|| format!("Unknown stored Mutation Source `{source}`"))?;
                let payload_version = parse_payload_version(payload_version)?;
                let time_evidence = match (committed_at_millis, observed_at_millis) {
                    (Some(committed_at_millis), None) => RevisionTimeEvidence::Committed {
                        committed_at_millis,
                    },
                    (None, Some(observed_at_millis)) => RevisionTimeEvidence::Observed {
                        observed_at_millis,
                        modified_at_millis,
                    },
                    _ => return Err("Stored Note Revision has invalid time evidence".to_string()),
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

fn open_store() -> Result<Connection, String> {
    let vault_root = crate::state::vault_root()?;
    let manifest = crate::state::read_vault_manifest_for(&vault_root)?
        .map(Ok)
        .unwrap_or_else(|| crate::state::ensure_vault_scaffold(&vault_root))?;
    let data_dir = crate::state::vault_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let path = data_dir.join(HISTORY_DATABASE_FILE_NAME);
    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA synchronous=FULL;
             PRAGMA busy_timeout=5000;
             PRAGMA wal_autocheckpoint=1000;
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
               CHECK ((committed_at_millis IS NOT NULL AND observed_at_millis IS NULL)
                   OR (committed_at_millis IS NULL AND observed_at_millis IS NOT NULL))
             );
             CREATE INDEX IF NOT EXISTS revisions_by_note_time
               ON revisions(note_id, COALESCE(committed_at_millis, observed_at_millis), revision_id);
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
             CREATE TABLE IF NOT EXISTS timeline_heads (
               note_id TEXT PRIMARY KEY,
               record_kind TEXT NOT NULL,
               record_id TEXT NOT NULL,
               revision_id TEXT,
               result_hash TEXT,
               current_path TEXT NOT NULL
             );",
        )
        .map_err(|error| format!("Initialize Note Timeline history store: {error}"))?;
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
        Some((vault_id, format, generation, schema))
            if vault_id == manifest.vault_id
                && format == HISTORY_FORMAT
                && generation == HISTORY_GENERATION
                && schema == HISTORY_SCHEMA_VERSION => {}
        Some(_) => {
            return Err(
                "Note Timeline history store identity or generation does not match the vault"
                    .to_string(),
            )
        }
        None => {
            connection
                .execute(
                    "INSERT INTO history_metadata (
                       singleton, vault_id, history_format, history_generation, schema_version
                     ) VALUES (1, ?1, ?2, ?3, ?4)",
                    params![
                        manifest.vault_id,
                        HISTORY_FORMAT,
                        HISTORY_GENERATION,
                        HISTORY_SCHEMA_VERSION
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(connection)
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
}
