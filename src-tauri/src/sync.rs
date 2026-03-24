mod client;
mod reconcile;
mod store;

use crate::{
    index::{build_indexed_note, AppState},
    note,
    semantic::db::content_hash,
    state::{
        is_forgotten_note_path, notes_root, persist_note, read_state, write_state,
        PersistedForgottenNote,
    },
};
use client::{authorized_client, build_client, normalize_base_url, sync_url};
use gneauxghts_sync_contract::{
    CompleteMagicLinkRequest, RemoteHead, RequestMagicLinkRequest, RequestMagicLinkResponse,
};
use notify::{
    event::ModifyKind, Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode,
    Watcher,
};
use rusqlite::{
    params,
    types::{Type, ValueRef},
    Connection, OptionalExtension, Row,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use store::{ensure_schema, ensure_sync_state_row, open_database};
use tauri::{AppHandle, Emitter, Manager};

const SYNC_DB_FILE_NAME: &str = "sync.sqlite3";
pub(crate) const VAULT_NOTE_CHANGED_EVENT: &str = "vault-note-changed";
const SYNC_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SYNC_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[allow(dead_code)]
pub(crate) struct VaultWatcherHandle {
    watcher: RecommendedWatcher,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultNoteChangeEvent {
    note_path: String,
    deleted: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedVaultState {
    pub(crate) vault_id: Option<String>,
    pub(crate) device_id: String,
    pub(crate) linked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatus {
    pub(crate) device_id: String,
    pub(crate) linked_vault: LinkedVaultState,
    pub(crate) paused: bool,
    pub(crate) dirty_note_count: usize,
    pub(crate) conflicted_note_count: usize,
    pub(crate) tracked_note_count: usize,
    pub(crate) last_sync_at_millis: Option<u64>,
    pub(crate) auth_email: Option<String>,
    pub(crate) sync_base_url: Option<String>,
    pub(crate) last_sync_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncConflict {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) deleted: bool,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncConflictDetail {
    pub(crate) conflict: SyncConflict,
    pub(crate) original_note_id: Option<String>,
    pub(crate) original_note_path: Option<String>,
    pub(crate) local_markdown: String,
    pub(crate) remote_markdown: String,
}

#[derive(Debug)]
struct SyncConflictRecord {
    detail: SyncConflictDetail,
}

#[derive(Debug)]
struct SyncStateRow {
    device_id: String,
    vault_id: Option<String>,
    linked: bool,
    paused: bool,
    sync_cursor: i64,
    last_sync_at_millis: Option<u64>,
    auth_email: Option<String>,
    sync_base_url: Option<String>,
    session_token: Option<String>,
    last_sync_error: Option<String>,
}

#[derive(Debug)]
struct TrackedNoteRow {
    note_id: String,
    note_path: String,
    content_hash: String,
    last_known_remote_revision: Option<i64>,
    last_synced_base_revision: Option<i64>,
    dirty: bool,
    deleted: bool,
    local_only: bool,
}

pub(crate) fn initialize() -> Result<(), String> {
    let connection = open_database()?;
    ensure_schema(&connection)?;
    ensure_sync_state_row(&connection)?;
    Ok(())
}

pub(crate) fn start_vault_watcher(app_handle: AppHandle) -> Result<VaultWatcherHandle, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let callback_handle = app_handle.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            if let Err(error) = handle_watch_result(&callback_handle, result) {
                eprintln!("vault watcher error: {error}");
            }
        },
        NotifyConfig::default(),
    )
    .map_err(|err| err.to_string())?;
    watcher
        .watch(&notes_dir, RecursiveMode::Recursive)
        .map_err(|err| err.to_string())?;
    Ok(VaultWatcherHandle { watcher })
}

pub(crate) fn request_magic_link(
    sync_base_url: &str,
    email: &str,
) -> Result<RequestMagicLinkResponse, String> {
    let client = build_client()?;
    let response = client
        .post(sync_url(sync_base_url, "/auth/request-magic-link")?)
        .json(&RequestMagicLinkRequest {
            email: email.trim().to_lowercase(),
        })
        .send()
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(response
            .text()
            .unwrap_or_else(|_| "Magic link request failed".to_string()));
    }

    response.json().map_err(|err| err.to_string())
}

pub(crate) fn complete_magic_link(
    sync_base_url: &str,
    email: &str,
    magic_link_token: &str,
    device_name: Option<&str>,
) -> Result<SyncStatus, String> {
    initialize()?;
    let connection = open_database()?;
    let sync_state = load_sync_state(&connection)?;
    let client = build_client()?;
    let response = client
        .post(sync_url(sync_base_url, "/auth/complete")?)
        .json(&CompleteMagicLinkRequest {
            email: email.trim().to_lowercase(),
            magic_link_token: magic_link_token.trim().to_string(),
            device_id: sync_state.device_id.clone(),
            device_name: device_name.map(str::to_string),
        })
        .send()
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(response
            .text()
            .unwrap_or_else(|_| "Sign-in failed".to_string()));
    }

    let session: gneauxghts_sync_contract::AuthSession =
        response.json().map_err(|err| err.to_string())?;
    connection
        .execute(
            "UPDATE sync_state
             SET sync_base_url = ?1,
                 session_token = ?2,
                 vault_id = ?3,
                 linked = 1,
                 auth_email = ?4,
                 last_sync_error = NULL
             WHERE id = 1",
            params![
                normalize_base_url(sync_base_url)?,
                session.session_token,
                session.vault_id,
                email.trim().to_lowercase(),
            ],
        )
        .map_err(|err| err.to_string())?;
    get_sync_status()
}

pub(crate) fn sync_now(state: &AppState, notes_dir: &Path) -> Result<SyncStatus, String> {
    match reconcile::sync_now_inner(state, notes_dir) {
        Ok(status) => {
            clear_last_sync_error()?;
            Ok(status)
        }
        Err(error) => {
            set_last_sync_error(&error)?;
            Err(error)
        }
    }
}

pub(crate) fn mark_note_dirty(note_path: &Path, markdown: &str) -> Result<(), String> {
    upsert_tracked_note(note_path, markdown, false, false)
}

pub(crate) fn mark_note_trashed(note_path: &Path, markdown: &str) -> Result<(), String> {
    upsert_tracked_note(note_path, markdown, true, false)
}

pub(crate) fn mark_conflicted(note_path: &Path, markdown: &str) -> Result<(), String> {
    upsert_tracked_note(note_path, markdown, false, true)
}

pub(crate) fn get_sync_status() -> Result<SyncStatus, String> {
    initialize()?;
    let connection = open_database()?;
    let sync_state = load_sync_state(&connection)?;
    let tracked_note_count = connection
        .query_row("SELECT COUNT(*) FROM tracked_notes", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;
    let dirty_note_count = connection
        .query_row(
            "SELECT COUNT(*) FROM tracked_notes WHERE dirty = 1",
            [],
            |row| row.get::<_, usize>(0),
        )
        .map_err(|err| err.to_string())?;
    let conflicted_note_count = connection
        .query_row("SELECT COUNT(*) FROM sync_conflicts", [], |row| {
            row.get::<_, usize>(0)
        })
        .map_err(|err| err.to_string())?;

    Ok(SyncStatus {
        device_id: sync_state.device_id.clone(),
        linked_vault: LinkedVaultState {
            vault_id: sync_state.vault_id.clone(),
            device_id: sync_state.device_id,
            linked: sync_state.linked && sync_state.session_token.is_some(),
        },
        paused: sync_state.paused,
        dirty_note_count,
        conflicted_note_count,
        tracked_note_count,
        last_sync_at_millis: sync_state.last_sync_at_millis,
        auth_email: sync_state.auth_email,
        sync_base_url: sync_state.sync_base_url,
        last_sync_error: sync_state.last_sync_error,
    })
}

pub(crate) fn set_sync_paused(paused: bool) -> Result<SyncStatus, String> {
    initialize()?;
    let connection = open_database()?;
    connection
        .execute(
            "UPDATE sync_state
             SET paused = ?1,
                 last_sync_error = CASE WHEN ?1 = 1 THEN NULL ELSE last_sync_error END
             WHERE id = 1",
            params![paused],
        )
        .map_err(|err| err.to_string())?;
    get_sync_status()
}

pub(crate) fn list_sync_conflicts() -> Result<Vec<SyncConflict>, String> {
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
                updated_at_millis: read_optional_u64(row, 4)?.unwrap_or(0),
            })
        })
        .map_err(|err| err.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub(crate) fn dismiss_sync_conflict(note_id: &str) -> Result<SyncStatus, String> {
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

pub(crate) fn resolve_sync_conflict_keep_local(
    state: &AppState,
    notes_dir: &Path,
    note_id: &str,
) -> Result<SyncStatus, String> {
    initialize()?;
    let record =
        load_sync_conflict_record(note_id)?.ok_or_else(|| "Sync conflict not found".to_string())?;
    let connection = open_database()?;
    let canonical_path = resolve_conflict_canonical_path(&connection, &record);
    let previous_canonical_path = canonical_path.clone();
    let saved_path = persist_note(
        notes_dir,
        &record.detail.local_markdown,
        Some(&canonical_path),
    )?
    .map(PathBuf::from)
    .ok_or_else(|| "Failed to write resolved note".to_string())?;
    let persisted_markdown = fs::read_to_string(&saved_path).map_err(|err| err.to_string())?;
    let timestamp_millis = current_time_millis()?;
    let note = build_indexed_note(&saved_path, &persisted_markdown, timestamp_millis);
    {
        let mut index = state
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.upsert_note(saved_path.clone(), note);
        if previous_canonical_path != saved_path {
            index.remove_note(&previous_canonical_path);
        }
    }
    if previous_canonical_path != saved_path && previous_canonical_path.exists() {
        state.semantic.queue_delete_note(&previous_canonical_path)?;
    }
    state
        .semantic
        .queue_note_update(&saved_path, persisted_markdown.clone(), timestamp_millis)?;
    mark_note_dirty(&saved_path, &persisted_markdown)?;
    cleanup_resolved_sync_conflict(state, &record.detail, true)?;
    get_sync_status()
}

pub(crate) fn resolve_sync_conflict_keep_remote(
    state: &AppState,
    note_id: &str,
) -> Result<SyncStatus, String> {
    initialize()?;
    let record =
        load_sync_conflict_record(note_id)?.ok_or_else(|| "Sync conflict not found".to_string())?;
    cleanup_resolved_sync_conflict(state, &record.detail, false)?;
    get_sync_status()
}

pub(crate) fn get_sync_conflict_detail(
    note_id: &str,
) -> Result<Option<SyncConflictDetail>, String> {
    initialize()?;
    Ok(load_sync_conflict_record(note_id)?.map(|record| record.detail))
}

pub(crate) fn sign_out(keep_server_url: bool) -> Result<SyncStatus, String> {
    initialize()?;
    let connection = open_database()?;
    connection
        .execute(
            if keep_server_url {
                "UPDATE sync_state
                 SET vault_id = NULL,
                     linked = 0,
                     sync_cursor = 0,
                     auth_email = NULL,
                     session_token = NULL,
                     last_sync_error = NULL
                 WHERE id = 1"
            } else {
                "UPDATE sync_state
                 SET vault_id = NULL,
                     linked = 0,
                     sync_cursor = 0,
                     auth_email = NULL,
                     sync_base_url = NULL,
                     session_token = NULL,
                     last_sync_error = NULL
                 WHERE id = 1"
            },
            [],
        )
        .map_err(|err| err.to_string())?;
    get_sync_status()
}

fn handle_watch_result(
    app_handle: &AppHandle,
    result: notify::Result<Event>,
) -> Result<(), String> {
    let event = match result {
        Ok(event) => event,
        Err(error) => return Err(error.to_string()),
    };
    if !should_process_watch_event(&event.kind) {
        return Ok(());
    }

    let notes_dir = notes_root()?;
    let Some(state) = app_handle.try_state::<AppState>() else {
        return Ok(());
    };
    let connection = open_database()?;
    let mut seen_paths = HashSet::new();

    for path in event.paths {
        if !seen_paths.insert(path.clone()) {
            continue;
        }
        if !is_watchable_markdown_path(&path) {
            continue;
        }
        handle_watched_path_change(app_handle, &connection, &state, &notes_dir, &path)?;
    }

    Ok(())
}

fn should_process_watch_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Remove(_)
    )
}

fn is_watchable_markdown_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn handle_watched_path_change(
    app_handle: &AppHandle,
    connection: &Connection,
    state: &AppState,
    notes_dir: &Path,
    path: &Path,
) -> Result<(), String> {
    if path.exists() {
        let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
        let deleted = is_forgotten_note_path(path, notes_dir);
        reconcile::import_local_note(connection, path, &markdown, deleted)?;
        let payload = VaultNoteChangeEvent {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
        };

        if deleted {
            state.semantic.queue_delete_note(path)?;
            let mut index = state
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.remove_note(path);
        } else {
            let timestamp_millis = current_time_millis()?;
            let note = build_indexed_note(path, &markdown, timestamp_millis);
            {
                let mut index = state
                    .notes_index
                    .lock()
                    .map_err(|_| "Search index lock poisoned".to_string())?;
                index.upsert_note(path.to_path_buf(), note);
            }
            state
                .semantic
                .queue_note_update(path, markdown, timestamp_millis)?;
        }

        app_handle
            .emit(VAULT_NOTE_CHANGED_EVENT, payload)
            .map_err(|err| err.to_string())
    } else {
        if let Some(tracked_note) = get_tracked_note_by_path(connection, path)? {
            connection
                .execute(
                    "UPDATE tracked_notes
                     SET dirty = 1,
                         deleted = 1,
                         updated_at_millis = ?2
                     WHERE note_id = ?1",
                    params![tracked_note.note_id, current_time_millis()?],
                )
                .map_err(|err| err.to_string())?;
        }
        state.semantic.queue_delete_note(path)?;
        let mut index = state
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.remove_note(path);
        app_handle
            .emit(
                VAULT_NOTE_CHANGED_EVENT,
                VaultNoteChangeEvent {
                    note_path: path.to_string_lossy().into_owned(),
                    deleted: true,
                },
            )
            .map_err(|err| err.to_string())
    }
}

fn upsert_tracked_note(
    note_path: &Path,
    markdown: &str,
    deleted: bool,
    conflicted: bool,
) -> Result<(), String> {
    initialize()?;
    let connection = open_database()?;
    let note_id = resolve_note_id(note_path, markdown)?;
    upsert_tracked_note_record(
        &connection,
        &note_id,
        note_path,
        markdown,
        deleted,
        conflicted,
        conflicted,
        !conflicted,
    )
}

fn upsert_tracked_note_record(
    connection: &Connection,
    note_id: &str,
    note_path: &Path,
    markdown: &str,
    deleted: bool,
    conflicted: bool,
    local_only: bool,
    dirty: bool,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO tracked_notes (
                note_id,
                note_path,
                content_hash,
                last_known_remote_revision,
                last_synced_base_revision,
                last_synced_content_hash,
                dirty,
                syncing,
                conflicted,
                deleted,
                local_only,
                updated_at_millis
            ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, ?4, 0, ?5, ?6, ?7, ?8)
            ON CONFLICT(note_id) DO UPDATE SET
                note_path = excluded.note_path,
                content_hash = excluded.content_hash,
                dirty = CASE
                    WHEN tracked_notes.local_only = 1 THEN 0
                    ELSE excluded.dirty
                END,
                syncing = 0,
                conflicted = CASE
                    WHEN tracked_notes.conflicted = 1 THEN 1
                    ELSE excluded.conflicted
                END,
                deleted = excluded.deleted,
                local_only = CASE
                    WHEN tracked_notes.local_only = 1 THEN 1
                    ELSE excluded.local_only
                END,
                updated_at_millis = excluded.updated_at_millis",
            params![
                note_id,
                note_path.to_string_lossy().into_owned(),
                content_hash(markdown),
                dirty,
                conflicted,
                deleted,
                local_only,
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn load_dirty_notes(connection: &Connection) -> Result<Vec<TrackedNoteRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT
                note_id,
                note_path,
                content_hash,
                last_known_remote_revision,
                last_synced_base_revision,
                dirty,
                deleted,
                local_only
             FROM tracked_notes
             WHERE dirty = 1 AND local_only = 0
             ORDER BY updated_at_millis ASC",
        )
        .map_err(|err| err.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(TrackedNoteRow {
                note_id: row.get(0)?,
                note_path: row.get(1)?,
                content_hash: row.get(2)?,
                last_known_remote_revision: read_optional_i64(row, 3)?,
                last_synced_base_revision: read_optional_i64(row, 4)?,
                dirty: row.get::<_, i64>(5)? != 0,
                deleted: row.get::<_, i64>(6)? != 0,
                local_only: row.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|err| err.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn get_tracked_note(
    connection: &Connection,
    note_id: &str,
) -> Result<Option<TrackedNoteRow>, String> {
    connection
        .query_row(
            "SELECT
                note_id,
                note_path,
                content_hash,
                last_known_remote_revision,
                last_synced_base_revision,
                dirty,
                deleted,
                local_only
             FROM tracked_notes
             WHERE note_id = ?1",
            params![note_id],
            |row| {
                Ok(TrackedNoteRow {
                    note_id: row.get(0)?,
                    note_path: row.get(1)?,
                    content_hash: row.get(2)?,
                    last_known_remote_revision: read_optional_i64(row, 3)?,
                    last_synced_base_revision: read_optional_i64(row, 4)?,
                    dirty: row.get::<_, i64>(5)? != 0,
                    deleted: row.get::<_, i64>(6)? != 0,
                    local_only: row.get::<_, i64>(7)? != 0,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

fn get_tracked_note_by_path(
    connection: &Connection,
    note_path: &Path,
) -> Result<Option<TrackedNoteRow>, String> {
    connection
        .query_row(
            "SELECT
                note_id,
                note_path,
                content_hash,
                last_known_remote_revision,
                last_synced_base_revision,
                dirty,
                deleted,
                local_only
             FROM tracked_notes
             WHERE note_path = ?1",
            params![note_path.to_string_lossy().into_owned()],
            |row| {
                Ok(TrackedNoteRow {
                    note_id: row.get(0)?,
                    note_path: row.get(1)?,
                    content_hash: row.get(2)?,
                    last_known_remote_revision: read_optional_i64(row, 3)?,
                    last_synced_base_revision: read_optional_i64(row, 4)?,
                    dirty: row.get::<_, i64>(5)? != 0,
                    deleted: row.get::<_, i64>(6)? != 0,
                    local_only: row.get::<_, i64>(7)? != 0,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
}

fn load_sync_state(connection: &Connection) -> Result<SyncStateRow, String> {
    connection
        .query_row(
            "SELECT
                device_id,
                vault_id,
                linked,
                paused,
                sync_cursor,
                last_sync_at_millis,
                auth_email,
                sync_base_url,
                session_token,
                last_sync_error
             FROM sync_state
             WHERE id = 1",
            [],
            |row| {
                Ok(SyncStateRow {
                    device_id: row.get(0)?,
                    vault_id: row.get(1)?,
                    linked: row.get::<_, i64>(2)? != 0,
                    paused: row.get::<_, i64>(3)? != 0,
                    sync_cursor: read_optional_i64(row, 4)?.unwrap_or(0),
                    last_sync_at_millis: read_optional_u64(row, 5)?,
                    auth_email: row.get(6)?,
                    sync_base_url: row.get(7)?,
                    session_token: row.get(8)?,
                    last_sync_error: row.get(9)?,
                })
            },
        )
        .map_err(|err| err.to_string())
}

fn set_last_sync_error(message: &str) -> Result<(), String> {
    initialize()?;
    let connection = open_database()?;
    connection
        .execute(
            "UPDATE sync_state SET last_sync_error = ?1 WHERE id = 1",
            params![message],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn clear_last_sync_error() -> Result<(), String> {
    initialize()?;
    let connection = open_database()?;
    connection
        .execute(
            "UPDATE sync_state SET last_sync_error = NULL WHERE id = 1",
            [],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn load_sync_conflict_record(note_id: &str) -> Result<Option<SyncConflictRecord>, String> {
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
                            updated_at_millis: read_optional_u64(row, 4)?.unwrap_or(0),
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

fn record_sync_conflict(
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

    {
        let mut index = state
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.remove_note(&conflict_path);
    }
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

fn update_local_only_tracked_note(
    connection: &Connection,
    note_id: &str,
    note_path: &Path,
    markdown: &str,
    deleted: bool,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE tracked_notes
             SET note_path = ?2,
                 content_hash = ?3,
                 deleted = ?4,
                 dirty = 0,
                 local_only = 1,
                 updated_at_millis = ?5
             WHERE note_id = ?1",
            params![
                note_id,
                note_path.to_string_lossy().into_owned(),
                content_hash(markdown),
                deleted,
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn relative_sync_path(notes_dir: &Path, note_path: &Path) -> Result<String, String> {
    if is_forgotten_note_path(note_path, notes_dir) {
        let file_name = note_path
            .file_name()
            .ok_or_else(|| "Forgotten note file name is missing".to_string())?;
        return Ok(file_name.to_string_lossy().into_owned());
    }

    note_path
        .strip_prefix(notes_dir)
        .map_err(|_| "Note path is outside the vault".to_string())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn forgotten_original_relative_path(notes_dir: &Path, note_path: &Path) -> Result<String, String> {
    let forgotten_path = note_path.to_string_lossy().into_owned();
    let state = read_state(notes_dir)?;
    if let Some(relative_path) = state
        .forgotten_notes
        .iter()
        .find(|forgotten_note| forgotten_note.forgotten_path == forgotten_path)
        .map(|forgotten_note| {
            Path::new(&forgotten_note.original_path)
                .strip_prefix(notes_dir)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .map_err(|_| "Forgotten note original path is outside the vault".to_string())
        })
        .transpose()?
    {
        return Ok(relative_path);
    }

    repair_missing_forgotten_original_path(notes_dir, note_path)
}

fn repair_missing_forgotten_original_path(
    notes_dir: &Path,
    note_path: &Path,
) -> Result<String, String> {
    let file_name = note_path
        .file_name()
        .ok_or_else(|| "Forgotten note file name is missing".to_string())?
        .to_string_lossy()
        .into_owned();
    let original_path = notes_dir.join(&file_name);
    let title = Path::new(&file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let forgotten_at_millis = current_time_millis()?;
    let mut state = read_state(notes_dir)?;
    state.forgotten_notes.push(PersistedForgottenNote {
        forgotten_path: note_path.to_string_lossy().into_owned(),
        original_path: original_path.to_string_lossy().into_owned(),
        title,
        forgotten_at_millis,
        purge_after_days: 7,
        purge_at_millis: forgotten_at_millis + 7 * 24 * 60 * 60 * 1000,
    });
    write_state(notes_dir, &state)?;
    Ok(file_name)
}

fn validated_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);
    if candidate.is_absolute() {
        return Err("Remote relative path must not be absolute".to_string());
    }
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
    {
        return Err("Remote relative path is invalid".to_string());
    }
    Ok(candidate)
}

fn resolve_unique_path(directory: &Path, preferred_file_name: &str) -> PathBuf {
    let preferred_path = directory.join(preferred_file_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let preferred_path = Path::new(preferred_file_name);
    let stem = preferred_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let extension = preferred_path
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();

    for suffix in 2.. {
        let candidate = directory.join(format!("{stem} {suffix}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    preferred_path.to_path_buf()
}

fn resolve_note_id(note_path: &Path, markdown: &str) -> Result<String, String> {
    note::note_id_from_path_or_markdown(Some(note_path), markdown)
        .ok_or_else(|| "Unable to determine note id".to_string())
}

fn read_conflict_title(note_path: &Path) -> String {
    fs::read_to_string(note_path)
        .ok()
        .map(|markdown| {
            let fallback = note_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            note::extract_title_and_body(&markdown, &fallback).0
        })
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| {
            note_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        })
}

fn generate_device_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    format!("device-{millis:x}-{:x}", std::process::id())
}

fn current_time_millis() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis() as u64)
}

fn read_optional_i64(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<i64>> {
    match row.get_ref(index)? {
        ValueRef::Null => Ok(None),
        ValueRef::Integer(value) => Ok(Some(value)),
        ValueRef::Real(value) => Ok(Some(value as i64)),
        ValueRef::Text(value) => {
            let value = std::str::from_utf8(value).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(err))
            })?;
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            trimmed.parse::<i64>().map(Some).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(err))
            })
        }
        ValueRef::Blob(_) => Err(rusqlite::Error::InvalidColumnType(
            index,
            "revision".to_string(),
            Type::Blob,
        )),
    }
}

fn read_optional_u64(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<u64>> {
    read_optional_i64(row, index).and_then(|value| {
        value
            .map(|value| {
                u64::try_from(value).map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(index, Type::Integer, Box::new(err))
                })
            })
            .transpose()
    })
}

#[cfg(test)]
mod tests {
    use super::reconcile::import_existing_local_notes;
    use super::{
        complete_magic_link, dismiss_sync_conflict, get_sync_status, initialize, mark_conflicted,
        mark_note_dirty, record_sync_conflict,
    };
    use crate::note;
    use crate::state::initialize_app_data_dir;
    use crate::test_support::{TestDir, TEST_ENV_GUARD};

    #[test]
    fn sync_status_tracks_dirty_notes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("sync-app-data");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        initialize().expect("initialize sync db");
        let note_dir = TestDir::new("sync-note-dir");
        let note_path = note_dir.path().join("Title.md");
        mark_note_dirty(&note_path, "# Title\n\nBody").expect("mark dirty");

        let status = get_sync_status().expect("get sync status");
        assert_eq!(status.dirty_note_count, 1);
        assert_eq!(status.tracked_note_count, 1);
    }

    #[test]
    fn complete_magic_link_requires_server() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("sync-auth-data");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        initialize().expect("initialize sync db");
        let result = complete_magic_link(
            "http://127.0.0.1:9",
            "user@example.com",
            "token",
            Some("Device"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn import_existing_local_notes_backfills_managed_metadata() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("sync-import-app-data");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        initialize().expect("initialize sync db");

        let note_dir = TestDir::new("sync-import-note-dir");
        let note_path = note_dir.path().join("Legacy.md");
        std::fs::write(&note_path, "# Legacy\n\nBody").expect("write legacy note");

        import_existing_local_notes(note_dir.path()).expect("import notes");

        let upgraded = std::fs::read_to_string(&note_path).expect("read upgraded note");
        assert!(upgraded.contains("gneauxghts:"));
        assert!(note::parse_note(&upgraded).frontmatter.managed.is_some());

        let status = get_sync_status().expect("get sync status");
        assert_eq!(status.tracked_note_count, 1);
        assert_eq!(status.dirty_note_count, 1);
    }

    #[test]
    fn conflict_flag_persists_until_explicitly_dismissed() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("sync-conflict-app-data");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        initialize().expect("initialize sync db");

        let note_dir = TestDir::new("sync-conflict-note-dir");
        let note_path = note_dir.path().join("Conflict Copy.md");
        std::fs::write(&note_path, "# Conflict Copy\n\nLocal version").expect("write note");

        mark_conflicted(&note_path, "# Conflict Copy\n\nLocal version").expect("mark conflicted");
        record_sync_conflict(
            &super::open_database().expect("open database"),
            &super::TrackedNoteRow {
                note_id: "original-note".to_string(),
                note_path: "/tmp/original-note.md".to_string(),
                content_hash: String::new(),
                last_known_remote_revision: Some(1),
                last_synced_base_revision: Some(1),
                dirty: true,
                deleted: false,
                local_only: false,
            },
            &note_path,
            "# Conflict Copy\n\nLocal version",
            "# Conflict Copy\n\nLocal version",
            &gneauxghts_sync_contract::RemoteHead {
                note_id: "original-note".to_string(),
                revision: 2,
                relative_path: "Original Note.md".to_string(),
                content_hash: "remote-hash".to_string(),
                trashed_at: None,
                updated_at: "2026-03-20T00:00:00Z".to_string(),
                markdown: "# Conflict Copy\n\nRemote version".to_string(),
            },
        )
        .expect("record sync conflict");
        mark_note_dirty(&note_path, "# Conflict Copy\n\nLocal version updated")
            .expect("mark dirty");

        let status = get_sync_status().expect("get sync status");
        assert_eq!(status.conflicted_note_count, 1);

        let note_id = note::note_id_from_path_or_markdown(
            Some(&note_path),
            &std::fs::read_to_string(&note_path).expect("read note"),
        )
        .expect("note id");
        let status = dismiss_sync_conflict(&note_id).expect("dismiss conflict");
        assert_eq!(status.conflicted_note_count, 0);
    }
}
