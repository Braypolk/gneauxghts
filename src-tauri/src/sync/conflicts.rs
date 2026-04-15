use super::{
    current_time_millis, get_sync_status, get_tracked_note, initialize, open_database,
    read_conflict_title, resolve_note_id, RemoteHead, SyncConflict, SyncConflictDetail,
    SyncConflictRecord, TrackedNoteRow,
};
use crate::{
    index::{build_indexed_note, AppState},
    state::persist_note,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn list_sync_conflicts() -> Result<Vec<SyncConflict>, String> {
    initialize()?;
    let connection = open_database()?;
    let mut statement = connection
        .prepare(
            "SELECT note_id, note_path, title, deleted, created_at_millis
             FROM sync_conflicts
             ORDER BY created_at_millis DESC, note_id ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(SyncConflict {
                note_id: row.get(0)?,
                note_path: row.get(1)?,
                title: row.get(2)?,
                deleted: row.get::<_, i64>(3)? != 0,
                updated_at_millis: super::read_optional_u64(row, 4)?.unwrap_or(0),
            })
        })
        .map_err(|err| err.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub(super) fn dismiss_sync_conflict(note_id: &str) -> Result<super::SyncStatus, String> {
    initialize()?;
    let connection = open_database()?;
    connection
        .execute(
            "DELETE FROM sync_conflicts WHERE note_id = ?1",
            params![note_id],
        )
        .map_err(|err| err.to_string())?;
    connection
        .execute(
            "UPDATE tracked_notes SET conflicted = 0 WHERE note_id = ?1",
            params![note_id],
        )
        .map_err(|err| err.to_string())?;
    get_sync_status()
}

pub(super) fn resolve_sync_conflict_keep_local(
    state: &AppState,
    notes_dir: &Path,
    note_id: &str,
) -> Result<super::SyncStatus, String> {
    initialize()?;
    let record =
        load_sync_conflict_record(note_id)?.ok_or_else(|| "Sync conflict not found".to_string())?;
    let connection = open_database()?;
    let canonical_path = resolve_conflict_canonical_path(&connection, &record);
    let previous_canonical_path = canonical_path.clone();
    let title = canonical_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let saved_path = persist_note(
        notes_dir,
        &title,
        &record.detail.local_markdown,
        Some(&canonical_path),
    )?
    .map(PathBuf::from)
    .ok_or_else(|| "Failed to write resolved note".to_string())?;
    let persisted_markdown = fs::read_to_string(&saved_path).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let note = build_indexed_note(&saved_path, &persisted_markdown, timestamp_millis);
    state.upsert_note_indexes(saved_path.clone(), note)?;
    if previous_canonical_path != saved_path {
        state.remove_note_indexes(&previous_canonical_path)?;
    }
    if previous_canonical_path != saved_path && previous_canonical_path.exists() {
        state.semantic.queue_delete_note(&previous_canonical_path)?;
    }
    state
        .semantic
        .queue_note_update(&saved_path, persisted_markdown.clone(), timestamp_millis)?;
    super::mark_note_dirty(&saved_path, &persisted_markdown)?;
    cleanup_resolved_sync_conflict(state, &record.detail, true)?;
    get_sync_status()
}

pub(super) fn resolve_sync_conflict_keep_remote(
    state: &AppState,
    note_id: &str,
) -> Result<super::SyncStatus, String> {
    initialize()?;
    let record =
        load_sync_conflict_record(note_id)?.ok_or_else(|| "Sync conflict not found".to_string())?;
    cleanup_resolved_sync_conflict(state, &record.detail, false)?;
    get_sync_status()
}

pub(super) fn get_sync_conflict_detail(
    note_id: &str,
) -> Result<Option<SyncConflictDetail>, String> {
    initialize()?;
    Ok(load_sync_conflict_record(note_id)?.map(|record| record.detail))
}

pub(super) fn load_sync_conflict_record(
    note_id: &str,
) -> Result<Option<SyncConflictRecord>, String> {
    initialize()?;
    let connection = open_database()?;
    connection
        .query_row(
            "SELECT
                note_id,
                note_path,
                title,
                deleted,
                created_at_millis,
                original_note_id,
                original_note_path,
                local_markdown,
                remote_markdown
             FROM sync_conflicts
             WHERE note_id = ?1",
            params![note_id],
            |row| {
                Ok(SyncConflictRecord {
                    detail: SyncConflictDetail {
                        conflict: SyncConflict {
                            note_id: row.get(0)?,
                            note_path: row.get(1)?,
                            title: row.get(2)?,
                            deleted: row.get::<_, i64>(3)? != 0,
                            updated_at_millis: super::read_optional_u64(row, 4)?.unwrap_or(0),
                        },
                        original_note_id: row.get(5)?,
                        original_note_path: row.get(6)?,
                        local_markdown: row.get(7)?,
                        remote_markdown: row.get(8)?,
                    },
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

pub(super) fn record_sync_conflict(
    connection: &Connection,
    original_note: &TrackedNoteRow,
    note_path: &Path,
    local_markdown: &str,
    conflict_copy_markdown: &str,
    remote_head: &RemoteHead,
) -> Result<(), String> {
    let note_id = resolve_note_id(note_path, conflict_copy_markdown)?;
    let title = read_conflict_title(note_path);
    connection
        .execute(
            "INSERT INTO sync_conflicts (
                note_id,
                note_path,
                title,
                deleted,
                original_note_id,
                original_note_path,
                local_markdown,
                remote_markdown,
                created_at_millis
             ) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(note_id) DO UPDATE SET
                note_path = excluded.note_path,
                title = excluded.title,
                deleted = excluded.deleted,
                original_note_id = excluded.original_note_id,
                original_note_path = excluded.original_note_path,
                local_markdown = excluded.local_markdown,
                remote_markdown = excluded.remote_markdown",
            params![
                note_id,
                note_path.to_string_lossy().into_owned(),
                title,
                original_note.note_id,
                original_note.note_path,
                local_markdown,
                remote_head.markdown,
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn resolve_conflict_canonical_path(
    connection: &Connection,
    record: &SyncConflictRecord,
) -> PathBuf {
    record
        .detail
        .original_note_id
        .as_deref()
        .and_then(|original_note_id| {
            get_tracked_note(connection, original_note_id)
                .ok()
                .flatten()
        })
        .map(|tracked_note| PathBuf::from(tracked_note.note_path))
        .or_else(|| record.detail.original_note_path.as_ref().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from(&record.detail.conflict.note_path))
}

fn cleanup_resolved_sync_conflict(
    state: &AppState,
    detail: &SyncConflictDetail,
    preserve_original_note: bool,
) -> Result<(), String> {
    let connection = open_database()?;
    connection
        .execute(
            "DELETE FROM sync_conflicts WHERE note_id = ?1",
            params![detail.conflict.note_id],
        )
        .map_err(|err| err.to_string())?;
    connection
        .execute(
            "DELETE FROM tracked_notes WHERE note_id = ?1",
            params![detail.conflict.note_id],
        )
        .map_err(|err| err.to_string())?;

    let conflict_path = PathBuf::from(&detail.conflict.note_path);
    if conflict_path.exists() {
        fs::remove_file(&conflict_path).map_err(|err| err.to_string())?;
    }

    state.remove_note_indexes(&conflict_path)?;
    state.semantic.queue_delete_note(&conflict_path)?;

    if !preserve_original_note {
        if let Some(original_note_id) = detail.original_note_id.as_deref() {
            if let Some(tracked_note) = get_tracked_note(&connection, original_note_id)? {
                connection
                    .execute(
                        "UPDATE tracked_notes SET dirty = 0 WHERE note_id = ?1",
                        params![tracked_note.note_id],
                    )
                    .map_err(|err| err.to_string())?;
            }
        }
    }

    Ok(())
}
