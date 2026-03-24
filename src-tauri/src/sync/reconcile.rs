use super::{
    current_time_millis, forgotten_original_relative_path, get_sync_status, get_tracked_note,
    get_tracked_note_by_path, initialize, load_dirty_notes, load_sync_state, mark_conflicted,
    open_database, relative_sync_path, resolve_unique_path, sync_url,
    update_local_only_tracked_note, upsert_tracked_note_record, validated_relative_path,
    TrackedNoteRow,
};
use crate::{
    index::{build_indexed_note, AppState},
    note,
    note::ManagedNoteMetadata,
    semantic::db::content_hash,
    state::{
        forgotten_notes_root, is_forgotten_note_path, read_state, write_state,
        PersistedForgottenNote,
    },
};
use gneauxghts_sync_contract::{
    GetManifestResponse, GetNotesRequest, GetNotesResponse, PullChangesResponse,
    PushNoteSnapshotRequest, PushNoteSnapshotResponse, PushNoteSnapshotStatus,
    PushTrashEventRequest, PushTrashEventResponse, RemoteHead, TrashAction,
};
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

struct SyncReadyNote {
    note_id: String,
    markdown: String,
    managed: ManagedNoteMetadata,
}

pub(super) fn sync_now_inner(
    state: &AppState,
    notes_dir: &Path,
) -> Result<super::SyncStatus, String> {
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
    let client = super::authorized_client(&base_url, &session_token)?;

    for tracked_note in load_dirty_notes(&connection)? {
        push_local_change(
            &connection,
            state,
            notes_dir,
            &base_url,
            &client,
            &tracked_note,
        )?;
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

    let mut eligible_note_ids = Vec::new();
    let mut tracked_by_note_id = Vec::new();
    for note_id in notes_to_fetch {
        let tracked = get_tracked_note(&connection, &note_id)?;
        if tracked.as_ref().is_some_and(|tracked| tracked.dirty) {
            continue;
        }

        tracked_by_note_id.push((note_id.clone(), tracked));
        eligible_note_ids.push(note_id);
    }

    if !eligible_note_ids.is_empty() {
        let remote: GetNotesResponse = client
            .post(sync_url(&base_url, "/v1/sync/notes/batch")?)
            .json(&GetNotesRequest {
                note_ids: eligible_note_ids,
            })
            .send()
            .map_err(|err| err.to_string())?
            .error_for_status()
            .map_err(|err| err.to_string())?
            .json()
            .map_err(|err| err.to_string())?;
        let tracked_by_note_id = tracked_by_note_id.into_iter().collect::<HashMap<_, _>>();

        for note in remote.notes {
            let tracked = tracked_by_note_id
                .get(&note.note_id)
                .and_then(|tracked| tracked.as_ref());
            apply_remote_head(&connection, state, notes_dir, &note, tracked)?;
        }
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
            params![manifest.vault_id, manifest.cursor, current_time_millis()?,],
        )
        .map_err(|err| err.to_string())?;

    get_sync_status()
}

pub(super) fn import_existing_local_notes(notes_dir: &Path) -> Result<(), String> {
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
            resolve_sync_conflict(
                connection,
                state,
                notes_dir,
                tracked_note,
                local_markdown,
                &remote_head,
            )?;
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

pub(super) fn import_local_note(
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
            update_local_only_tracked_note(
                connection,
                &sync_ready.note_id,
                note_path,
                &sync_ready.markdown,
                deleted,
            )?;
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
        let managed =
            existing_managed.ok_or_else(|| "Managed note metadata missing".to_string())?;
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
    super::record_sync_conflict(
        connection,
        tracked_note,
        &conflict_copy_path,
        local_markdown,
        &conflict_copy_markdown,
        remote_head,
    )?;
    apply_remote_head(
        connection,
        state,
        notes_dir,
        remote_head,
        Some(tracked_note),
    )?;
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
        state.semantic.queue_note_update(
            &target_path,
            remote_head.markdown.clone(),
            timestamp_millis,
        )?;
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
        if !state
            .forgotten_notes
            .iter()
            .any(|forgotten_note| forgotten_note.forgotten_path == target_path.to_string_lossy())
        {
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
