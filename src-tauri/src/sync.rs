use crate::{
    index::{build_indexed_note, AppState},
    note,
    note::ManagedNoteMetadata,
    semantic::db::content_hash,
    state::{
        app_data_dir, forgotten_notes_root, is_forgotten_note_path, notes_root, persist_note,
        read_state, write_state, PersistedForgottenNote,
    },
};
use gneauxghts_sync_contract::{
    CompleteMagicLinkRequest, GetManifestResponse, GetNoteResponse, PullChangesResponse,
    PushNoteSnapshotRequest, PushNoteSnapshotResponse, PushNoteSnapshotStatus,
    PushTrashEventRequest, PushTrashEventResponse, RemoteHead, RequestMagicLinkRequest,
    RequestMagicLinkResponse, TrashAction,
};
use notify::{event::ModifyKind, Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::blocking::Client;
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
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const SYNC_DB_FILE_NAME: &str = "sync.sqlite3";
pub(crate) const VAULT_NOTE_CHANGED_EVENT: &str = "vault-note-changed";

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

#[derive(Debug)]
struct SyncReadyNote {
    note_id: String,
    markdown: String,
    managed: ManagedNoteMetadata,
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
        return Err(response.text().unwrap_or_else(|_| "Magic link request failed".to_string()));
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
        return Err(response.text().unwrap_or_else(|_| "Sign-in failed".to_string()));
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
    match sync_now_inner(state, notes_dir) {
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

fn sync_now_inner(state: &AppState, notes_dir: &Path) -> Result<SyncStatus, String> {
    initialize()?;
    import_existing_local_notes(notes_dir)?;

    let connection = open_database()?;
    let sync_state = load_sync_state(&connection)?;
    if sync_state.paused {
        return Err("Sync is paused on this device".to_string());
    }
    let base_url = sync_state
        .sync_base_url
        .clone()
        .ok_or_else(|| "Sync server URL is not configured".to_string())?;
    let session_token = sync_state
        .session_token
        .clone()
        .ok_or_else(|| "No active sync session. Complete sign-in first.".to_string())?;
    let client = authorized_client(&base_url, &session_token)?;

    let dirty_notes = load_dirty_notes(&connection)?;
    for tracked_note in dirty_notes {
        push_local_change(&connection, state, notes_dir, &base_url, &client, &tracked_note)?;
    }

    let manifest: GetManifestResponse = client
        .get(sync_url(&base_url, "/v1/sync/manifest")?)
        .send()
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;

    let changes: PullChangesResponse = client
        .get(sync_url(
            &base_url,
            &format!("/v1/sync/changes?cursor={}", sync_state.sync_cursor),
        )?)
        .send()
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;

    let mut notes_to_fetch = HashSet::new();
    for note in &manifest.notes {
        let tracked = get_tracked_note(&connection, &note.note_id)?;
        let file_missing = tracked
            .as_ref()
            .is_some_and(|tracked| !Path::new(&tracked.note_path).exists());
        if tracked
            .as_ref()
            .is_none_or(|tracked| tracked.last_known_remote_revision != Some(note.revision))
            || file_missing
        {
            notes_to_fetch.insert(note.note_id.clone());
        }
    }

    for change in &changes.changes {
        notes_to_fetch.insert(change.note_id.clone());
    }

    for note_id in notes_to_fetch {
        let tracked = get_tracked_note(&connection, &note_id)?;
        if tracked.as_ref().is_some_and(|tracked| tracked.dirty) {
            continue;
        }

        let remote: GetNoteResponse = client
            .get(sync_url(
                &base_url,
                &format!("/v1/sync/notes/{note_id}"),
            )?)
            .send()
            .map_err(|err| err.to_string())?
            .error_for_status()
            .map_err(|err| err.to_string())?
            .json()
            .map_err(|err| err.to_string())?;
        apply_remote_head(&connection, state, notes_dir, &remote.note, tracked.as_ref())?;
    }

    connection
        .execute(
            "UPDATE sync_state
             SET linked = 1,
                 vault_id = ?1,
                 sync_cursor = ?2,
                 last_sync_at_millis = ?3,
                 last_sync_error = NULL
             WHERE id = 1",
            params![
                manifest.vault_id,
                manifest.cursor,
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;

    get_sync_status()
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
        .query_row("SELECT COUNT(*) FROM tracked_notes", [], |row| row.get::<_, usize>(0))
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
    let record = load_sync_conflict_record(note_id)?
        .ok_or_else(|| "Sync conflict not found".to_string())?;
    let connection = open_database()?;
    let canonical_path = resolve_conflict_canonical_path(&connection, &record);
    let previous_canonical_path = canonical_path.clone();
    let saved_path = persist_note(notes_dir, &record.detail.local_markdown, Some(&canonical_path))?
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
    let record = load_sync_conflict_record(note_id)?
        .ok_or_else(|| "Sync conflict not found".to_string())?;
    cleanup_resolved_sync_conflict(state, &record.detail, false)?;
    get_sync_status()
}

pub(crate) fn get_sync_conflict_detail(note_id: &str) -> Result<Option<SyncConflictDetail>, String> {
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
        import_local_note(connection, path, &markdown, deleted)?;
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

fn import_existing_local_notes(notes_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(notes_dir).map_err(|err| err.to_string())?;
    let connection = open_database()?;
    for entry in fs::read_dir(notes_dir).map_err(|err| err.to_string())? {
        let path = entry.map_err(|err| err.to_string())?.path();
        if path.is_file() && path.extension().is_some_and(|extension| extension == "md") {
            let markdown = fs::read_to_string(&path).map_err(|err| err.to_string())?;
            import_local_note(&connection, &path, &markdown, false)?;
        }
    }

    let forgotten_dir = forgotten_notes_root(notes_dir);
    if forgotten_dir.is_dir() {
        for entry in fs::read_dir(&forgotten_dir).map_err(|err| err.to_string())? {
            let path = entry.map_err(|err| err.to_string())?.path();
            if path.is_file() && path.extension().is_some_and(|extension| extension == "md") {
                let markdown = fs::read_to_string(&path).map_err(|err| err.to_string())?;
                import_local_note(&connection, &path, &markdown, true)?;
            }
        }
    }

    Ok(())
}

fn push_local_change(
    connection: &Connection,
    state: &AppState,
    notes_dir: &Path,
    base_url: &str,
    client: &Client,
    tracked_note: &TrackedNoteRow,
) -> Result<(), String> {
    let path = PathBuf::from(&tracked_note.note_path);
    if !path.exists() {
        return Ok(());
    }
    let markdown = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let sync_ready = ensure_sync_ready_note(&path, &markdown, tracked_note.deleted)?;
    if sync_ready.note_id != tracked_note.note_id {
        connection
            .execute(
                "DELETE FROM tracked_notes WHERE note_id = ?1",
                params![tracked_note.note_id],
            )
            .map_err(|err| err.to_string())?;
        upsert_tracked_note_record(
            connection,
            &sync_ready.note_id,
            &path,
            &sync_ready.markdown,
            tracked_note.deleted,
            false,
            false,
            true,
        )?;
        let migrated = get_tracked_note(connection, &sync_ready.note_id)?
            .ok_or_else(|| "Migrated tracked note missing".to_string())?;
        return push_local_change(connection, state, notes_dir, base_url, client, &migrated);
    }
    let relative_path = relative_sync_path(notes_dir, &path)?;
    let sent_content_hash = content_hash(&sync_ready.markdown);

    if tracked_note.deleted {
        let response: PushTrashEventResponse = client
            .post(sync_url(base_url, "/v1/sync/trash")?)
            .json(&PushTrashEventRequest {
                note_id: tracked_note.note_id.clone(),
                base_revision: tracked_note.last_synced_base_revision,
                action: TrashAction::Trash,
                relative_path: forgotten_original_relative_path(notes_dir, &path)?,
                markdown: sync_ready.markdown.clone(),
                content_hash: sent_content_hash.clone(),
                updated_at: sync_ready.managed.updated_at.clone(),
                trashed_at: sync_ready.managed.trashed_at.clone(),
            })
            .send()
            .map_err(|err| err.to_string())?
            .error_for_status()
            .map_err(|err| err.to_string())?
            .json()
            .map_err(|err| err.to_string())?;
        handle_push_response(
            connection,
            state,
            notes_dir,
            tracked_note,
            &sync_ready.markdown,
            &sent_content_hash,
            PushNoteSnapshotResponse {
                status: response.status,
                current_revision: response.current_revision,
                cursor: response.cursor,
                remote_head: response.remote_head,
            },
        )?;
        return Ok(());
    }

    let response: PushNoteSnapshotResponse = client
        .post(sync_url(base_url, "/v1/sync/notes")?)
        .json(&PushNoteSnapshotRequest {
            note_id: tracked_note.note_id.clone(),
            base_revision: tracked_note.last_synced_base_revision,
            relative_path,
            markdown: sync_ready.markdown.clone(),
            content_hash: sent_content_hash.clone(),
            updated_at: sync_ready.managed.updated_at,
        })
        .send()
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;
    handle_push_response(
        connection,
        state,
        notes_dir,
        tracked_note,
        &sync_ready.markdown,
        &sent_content_hash,
        response,
    )?;
    Ok(())
}

fn handle_push_response(
    connection: &Connection,
    state: &AppState,
    notes_dir: &Path,
    tracked_note: &TrackedNoteRow,
    local_markdown: &str,
    local_content_hash: &str,
    response: PushNoteSnapshotResponse,
) -> Result<(), String> {
    match response.status {
        PushNoteSnapshotStatus::Accepted => {
            connection
                .execute(
                    "UPDATE tracked_notes
                     SET dirty = 0,
                         last_known_remote_revision = ?2,
                         last_synced_base_revision = ?2,
                         last_synced_content_hash = ?3
                     WHERE note_id = ?1",
                    params![
                        tracked_note.note_id,
                        response.current_revision,
                        local_content_hash,
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    "UPDATE sync_state SET sync_cursor = MAX(sync_cursor, ?1) WHERE id = 1",
                    params![response.cursor],
                )
                .map_err(|err| err.to_string())?;
        }
        PushNoteSnapshotStatus::Conflict => {
            let remote_head = response
                .remote_head
                .ok_or_else(|| "Conflict response missing remote head".to_string())?;
            resolve_sync_conflict(connection, state, notes_dir, tracked_note, local_markdown, &remote_head)?;
            connection
                .execute(
                    "UPDATE sync_state SET sync_cursor = MAX(sync_cursor, ?1) WHERE id = 1",
                    params![response.cursor],
                )
                .map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

fn import_local_note(
    connection: &Connection,
    note_path: &Path,
    markdown: &str,
    deleted: bool,
) -> Result<(), String> {
    let sync_ready = ensure_sync_ready_note(note_path, markdown, deleted)?;
    if let Some(stale_tracked_note) = get_tracked_note_by_path(connection, note_path)? {
        if stale_tracked_note.note_id != sync_ready.note_id {
            connection
                .execute(
                    "DELETE FROM tracked_notes WHERE note_id = ?1",
                    params![stale_tracked_note.note_id],
                )
                .map_err(|err| err.to_string())?;
        }
    }

    let current_hash = content_hash(&sync_ready.markdown);
    let current_path = note_path.to_string_lossy().into_owned();
    match get_tracked_note(connection, &sync_ready.note_id)? {
        Some(tracked_note) if tracked_note.local_only => {
            update_local_only_tracked_note(connection, &sync_ready.note_id, note_path, &sync_ready.markdown, deleted)?;
        }
        Some(tracked_note)
            if tracked_note.note_path == current_path
                && tracked_note.content_hash == current_hash
                && tracked_note.deleted == deleted => {}
        _ => upsert_tracked_note_record(
            connection,
            &sync_ready.note_id,
            note_path,
            &sync_ready.markdown,
            deleted,
            false,
            false,
            true,
        )?,
    }

    Ok(())
}

fn ensure_sync_ready_note(
    note_path: &Path,
    markdown: &str,
    deleted: bool,
) -> Result<SyncReadyNote, String> {
    let parsed = note::parse_note(markdown);
    let existing_managed = parsed.frontmatter.managed.clone();
    let needs_metadata = existing_managed.is_none();
    let needs_trashed_at = deleted
        && existing_managed
            .as_ref()
            .is_none_or(|managed| managed.trashed_at.is_none());

    if !needs_metadata && !needs_trashed_at {
        let managed = existing_managed.ok_or_else(|| "Managed note metadata missing".to_string())?;
        return Ok(SyncReadyNote {
            note_id: managed.id.clone(),
            markdown: markdown.to_string(),
            managed,
        });
    }

    let trashed_at = if deleted {
        Some(Some(
            existing_managed
                .as_ref()
                .and_then(|managed| managed.trashed_at.clone())
                .unwrap_or(note::current_timestamp_rfc3339()?),
        ))
    } else {
        None
    };
    let (prepared_markdown, managed) =
        note::prepare_note_markdown(markdown, Some(markdown), trashed_at)?;
    fs::write(note_path, &prepared_markdown).map_err(|err| err.to_string())?;

    Ok(SyncReadyNote {
        note_id: managed.id.clone(),
        markdown: prepared_markdown,
        managed,
    })
}

fn resolve_sync_conflict(
    connection: &Connection,
    state: &AppState,
    notes_dir: &Path,
    tracked_note: &TrackedNoteRow,
    local_markdown: &str,
    remote_head: &RemoteHead,
) -> Result<(), String> {
    let conflict_copy_path = write_conflicted_copy(notes_dir, local_markdown)?;
    let conflict_copy_markdown =
        fs::read_to_string(&conflict_copy_path).map_err(|err| err.to_string())?;
    mark_conflicted(&conflict_copy_path, &conflict_copy_markdown)?;
    record_sync_conflict(
        connection,
        tracked_note,
        &conflict_copy_path,
        local_markdown,
        &conflict_copy_markdown,
        remote_head,
    )?;
    apply_remote_head(connection, state, notes_dir, remote_head, Some(tracked_note))?;
    Ok(())
}

fn write_conflicted_copy(notes_dir: &Path, markdown: &str) -> Result<PathBuf, String> {
    let (title, _) = note::extract_title_and_body(markdown, "Conflicted Note");
    let conflict_markdown = if title.trim().is_empty() {
        note::strip_frontmatter(markdown)
    } else {
        let body = note::strip_frontmatter(markdown);
        body.replacen(
            &format!("# {title}"),
            &format!("# {title} (Conflicted Copy)"),
            1,
        )
    };
    let prepared = note::prepare_note_markdown(&conflict_markdown, None, Some(None))?.0;
    let file_stem = crate::state::derive_file_stem(&prepared);
    let target_path = resolve_unique_path(notes_dir, &format!("{file_stem}.md"));
    fs::write(&target_path, prepared).map_err(|err| err.to_string())?;
    Ok(target_path)
}

fn apply_remote_head(
    connection: &Connection,
    state: &AppState,
    notes_dir: &Path,
    remote_head: &RemoteHead,
    tracked_note: Option<&TrackedNoteRow>,
) -> Result<(), String> {
    let target_path = if remote_head.trashed_at.is_some() {
        tracked_note
            .and_then(|tracked_note| {
                let path = PathBuf::from(&tracked_note.note_path);
                is_forgotten_note_path(&path, notes_dir).then_some(path)
            })
            .unwrap_or_else(|| {
                let forgotten_dir = forgotten_notes_root(notes_dir);
                let _ = fs::create_dir_all(&forgotten_dir);
                let file_name = Path::new(&remote_head.relative_path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| format!("{}.md", remote_head.note_id));
                resolve_unique_path(&forgotten_dir, &file_name)
            })
    } else {
        let relative_path = validated_relative_path(&remote_head.relative_path)?;
        let candidate = notes_dir.join(relative_path);
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        candidate
    };

    if let Some(tracked_note) = tracked_note {
        let previous_path = PathBuf::from(&tracked_note.note_path);
        if previous_path.exists() && previous_path != target_path {
            let _ = fs::remove_file(&previous_path);
        }
        if tracked_note.deleted && !is_forgotten_note_path(&previous_path, notes_dir) {
            state.semantic.queue_delete_note(&previous_path)?;
        }
    }

    fs::write(&target_path, &remote_head.markdown).map_err(|err| err.to_string())?;
    reconcile_forgotten_state(notes_dir, remote_head, &target_path)?;

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
             ) VALUES (?1, ?2, ?3, ?4, ?4, ?3, 0, 0, 0, ?5, 0, ?6)
             ON CONFLICT(note_id) DO UPDATE SET
                note_path = excluded.note_path,
                content_hash = excluded.content_hash,
                last_known_remote_revision = excluded.last_known_remote_revision,
                last_synced_base_revision = excluded.last_synced_base_revision,
                last_synced_content_hash = excluded.last_synced_content_hash,
                dirty = 0,
                conflicted = 0,
                deleted = excluded.deleted,
                local_only = 0,
                updated_at_millis = excluded.updated_at_millis",
            params![
                remote_head.note_id,
                target_path.to_string_lossy().into_owned(),
                remote_head.content_hash,
                remote_head.revision,
                remote_head.trashed_at.is_some(),
                current_time_millis()?,
            ],
        )
        .map_err(|err| err.to_string())?;

    let timestamp_millis = current_time_millis()?;
    if remote_head.trashed_at.is_some() {
        state.semantic.queue_delete_note(&target_path)?;
        let mut index = state
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.remove_note(&target_path);
    } else {
        let note = build_indexed_note(&target_path, &remote_head.markdown, timestamp_millis);
        {
            let mut index = state
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            index.upsert_note(target_path.clone(), note);
        }
        state
            .semantic
            .queue_note_update(&target_path, remote_head.markdown.clone(), timestamp_millis)?;
    }

    Ok(())
}

fn reconcile_forgotten_state(
    notes_dir: &Path,
    remote_head: &RemoteHead,
    target_path: &Path,
) -> Result<(), String> {
    let mut state = read_state(notes_dir)?;
    let original_path = notes_dir.join(validated_relative_path(&remote_head.relative_path)?);
    if remote_head.trashed_at.is_some() {
        if !state.forgotten_notes.iter().any(|forgotten_note| {
            forgotten_note.forgotten_path == target_path.to_string_lossy()
        }) {
            let (title, _) = note::extract_title_and_body(
                &remote_head.markdown,
                &Path::new(&remote_head.relative_path)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy(),
            );
            let forgotten_at_millis = current_time_millis()?;
            state.forgotten_notes.push(PersistedForgottenNote {
                forgotten_path: target_path.to_string_lossy().into_owned(),
                original_path: original_path.to_string_lossy().into_owned(),
                title,
                forgotten_at_millis,
                purge_after_days: 7,
                purge_at_millis: forgotten_at_millis + 7 * 24 * 60 * 60 * 1000,
            });
        }
    } else {
        state.forgotten_notes.retain(|forgotten_note| {
            forgotten_note.original_path != original_path.to_string_lossy()
                && forgotten_note.forgotten_path != target_path.to_string_lossy()
        });
    }
    write_state(notes_dir, &state)
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

fn get_tracked_note(connection: &Connection, note_id: &str) -> Result<Option<TrackedNoteRow>, String> {
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

fn open_database() -> Result<Connection, String> {
    let app_data_dir = app_data_dir()?;
    fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
    Connection::open(app_data_dir.join(SYNC_DB_FILE_NAME)).map_err(|err| err.to_string())
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                device_id TEXT NOT NULL,
                vault_id TEXT,
                linked INTEGER NOT NULL DEFAULT 0,
                paused INTEGER NOT NULL DEFAULT 0,
                sync_cursor INTEGER NOT NULL DEFAULT 0,
                last_sync_at_millis INTEGER,
                auth_email TEXT,
                sync_base_url TEXT,
                session_token TEXT,
                last_sync_error TEXT
            );
            CREATE TABLE IF NOT EXISTS tracked_notes (
                note_id TEXT PRIMARY KEY,
                note_path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                last_known_remote_revision INTEGER,
                last_synced_base_revision INTEGER,
                last_synced_content_hash TEXT,
                dirty INTEGER NOT NULL DEFAULT 1,
                syncing INTEGER NOT NULL DEFAULT 0,
                conflicted INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
                local_only INTEGER NOT NULL DEFAULT 0,
                updated_at_millis INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sync_conflicts (
                note_id TEXT PRIMARY KEY,
                note_path TEXT NOT NULL,
                title TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                original_note_id TEXT,
                original_note_path TEXT,
                local_markdown TEXT NOT NULL,
                remote_markdown TEXT NOT NULL,
                created_at_millis INTEGER NOT NULL
            );",
        )
        .map_err(|err| err.to_string())?;
    ensure_column(connection, "sync_state", "sync_cursor", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "sync_state", "paused", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "sync_state", "sync_base_url", "TEXT")?;
    ensure_column(connection, "sync_state", "session_token", "TEXT")?;
    ensure_column(connection, "sync_state", "last_sync_error", "TEXT")?;
    ensure_column(connection, "tracked_notes", "local_only", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(connection, "sync_conflicts", "original_note_id", "TEXT")?;
    ensure_column(connection, "sync_conflicts", "original_note_path", "TEXT")?;
    ensure_column(connection, "sync_conflicts", "local_markdown", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(connection, "sync_conflicts", "remote_markdown", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut statement = connection.prepare(&pragma).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| err.to_string())?;
    let columns = rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())?;
    if columns.iter().any(|existing| existing == column) {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn ensure_sync_state_row(connection: &Connection) -> Result<(), String> {
    let existing = connection
        .query_row("SELECT device_id FROM sync_state WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|err| err.to_string())?;
    if existing.is_some() {
        return Ok(());
    }

    connection
        .execute(
            "INSERT INTO sync_state (id, device_id, linked, sync_cursor) VALUES (1, ?1, 0, 0)",
            params![generate_device_id()],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
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
        .execute("UPDATE sync_state SET last_sync_error = NULL WHERE id = 1", [])
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn build_client() -> Result<Client, String> {
    Client::builder().build().map_err(|err| err.to_string())
}

fn authorized_client(sync_base_url: &str, session_token: &str) -> Result<Client, String> {
    Client::builder()
        .default_headers(
            [(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&format!("Bearer {session_token}"))
                    .map_err(|err| err.to_string())?,
            )]
            .into_iter()
            .collect(),
        )
        .build()
        .map_err(|err| err.to_string())
        .map(|client| {
            let _ = sync_base_url;
            client
        })
}

fn sync_url(sync_base_url: &str, path: &str) -> Result<String, String> {
    Ok(format!("{}{}", normalize_base_url(sync_base_url)?, path))
}

fn normalize_base_url(sync_base_url: &str) -> Result<String, String> {
    let trimmed = sync_base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Sync server URL is required".to_string());
    }
    Ok(trimmed.to_string())
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

fn resolve_conflict_canonical_path(connection: &Connection, record: &SyncConflictRecord) -> PathBuf {
    record
        .detail
        .original_note_id
        .as_deref()
        .and_then(|original_note_id| get_tracked_note(connection, original_note_id).ok().flatten())
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
    let state = read_state(notes_dir)?;
    state
        .forgotten_notes
        .iter()
        .find(|forgotten_note| forgotten_note.forgotten_path == note_path.to_string_lossy())
        .map(|forgotten_note| {
            Path::new(&forgotten_note.original_path)
                .strip_prefix(notes_dir)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .map_err(|_| "Forgotten note original path is outside the vault".to_string())
        })
        .transpose()?
        .ok_or_else(|| "Forgotten note is missing its original path metadata".to_string())
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
    use super::{
        complete_magic_link, dismiss_sync_conflict, get_sync_status, import_existing_local_notes,
        initialize, mark_conflicted, mark_note_dirty, record_sync_conflict,
    };
    use crate::note;
    use crate::state::initialize_app_data_dir;
    use crate::test_support::TestDir;
    use std::sync::Mutex;

    static SYNC_TEST_GUARD: Mutex<()> = Mutex::new(());

    #[test]
    fn sync_status_tracks_dirty_notes() {
        let _guard = SYNC_TEST_GUARD.lock().expect("lock sync tests");
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
        let _guard = SYNC_TEST_GUARD.lock().expect("lock sync tests");
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
        let _guard = SYNC_TEST_GUARD.lock().expect("lock sync tests");
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
        let _guard = SYNC_TEST_GUARD.lock().expect("lock sync tests");
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
