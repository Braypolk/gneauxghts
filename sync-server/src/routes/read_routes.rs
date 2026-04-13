use super::shared::{load_remote_head, validate_note_id, ExistingNoteRow};
use crate::{
    auth::{internal_error, AuthenticatedSession},
    db,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use gneauxghts_sync_contract::{
    GetManifestResponse, GetNoteResponse, GetNotesRequest, GetNotesResponse, NoteHead,
    PullChangesResponse, SyncChange, SyncChangeKind,
};
use serde::Deserialize;
use sqlx::FromRow;
use std::{collections::{HashMap, HashSet}, sync::Arc};

const MAX_NOTES_BATCH_SIZE: usize = 200;

pub(super) async fn get_manifest(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
) -> Result<Json<GetManifestResponse>, (StatusCode, String)> {
    let notes = sqlx::query_as::<_, ManifestNoteRow>(
        "SELECT
            note_id,
            current_revision AS revision,
            current_relative_path AS relative_path,
            current_content_hash AS content_hash,
            CASE
                WHEN trashed_at IS NULL THEN NULL
                ELSE to_char(trashed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
            END AS trashed_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
         FROM notes
         WHERE vault_id = $1
         ORDER BY note_id",
    )
    .bind(session.vault_id)
    .fetch_all(&state.pool)
    .await
    .map_err(internal_error)?;
    let cursor = db::max_cursor(&state.pool, session.vault_id)
        .await
        .map_err(internal_error)?;

    Ok(Json(GetManifestResponse {
        vault_id: session.vault_id.to_string(),
        cursor,
        notes: notes
            .into_iter()
            .map(|note| NoteHead {
                note_id: note.note_id,
                revision: note.revision,
                relative_path: note.relative_path,
                content_hash: note.content_hash,
                trashed_at: note.trashed_at,
                updated_at: note.updated_at,
            })
            .collect(),
    }))
}

pub(super) async fn pull_changes(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Query(query): Query<PullChangesQuery>,
) -> Result<Json<PullChangesResponse>, (StatusCode, String)> {
    let cursor = query.cursor.unwrap_or(0);
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let changes = sqlx::query_as::<_, ChangeRow>(
        "SELECT
            seq,
            kind,
            note_id,
            revision,
            relative_path,
            content_hash,
            CASE
                WHEN trashed_at IS NULL THEN NULL
                ELSE to_char(trashed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
            END AS trashed_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
         FROM sync_changes
         WHERE vault_id = $1 AND seq > $2
         ORDER BY seq ASC
         LIMIT $3",
    )
    .bind(session.vault_id)
    .bind(cursor)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(internal_error)?;
    let next_cursor = changes.last().map(|change| change.seq).unwrap_or(cursor);

    Ok(Json(PullChangesResponse {
        vault_id: session.vault_id.to_string(),
        cursor: next_cursor,
        changes: changes
            .into_iter()
            .map(|change| SyncChange {
                cursor: change.seq,
                kind: match change.kind.as_str() {
                    "trash" => SyncChangeKind::Trash,
                    "restore" => SyncChangeKind::Restore,
                    _ => SyncChangeKind::Upsert,
                },
                note_id: change.note_id,
                revision: change.revision,
                relative_path: change.relative_path,
                content_hash: change.content_hash,
                trashed_at: change.trashed_at,
                updated_at: change.updated_at,
            })
            .collect(),
    }))
}

pub(super) async fn get_note(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Path(note_id): Path<String>,
) -> Result<Json<GetNoteResponse>, (StatusCode, String)> {
    validate_note_id(&note_id)?;

    let existing = sqlx::query_as::<_, ExistingNoteRow>(
        "SELECT
            id,
            current_revision,
            current_relative_path,
            current_content_hash,
            CASE
                WHEN trashed_at IS NULL THEN NULL
                ELSE to_char(trashed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
            END AS trashed_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
         FROM notes
         WHERE vault_id = $1 AND note_id = $2",
    )
    .bind(session.vault_id)
    .bind(&note_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Note not found".to_string()))?;

    let note = load_remote_head(&state.pool, &state.config.blob_root, &note_id, existing).await?;
    Ok(Json(GetNoteResponse { note }))
}

pub(super) async fn get_notes_batch(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Json(request): Json<GetNotesRequest>,
) -> Result<Json<GetNotesResponse>, (StatusCode, String)> {
    if request.note_ids.is_empty() {
        return Ok(Json(GetNotesResponse { notes: Vec::new() }));
    }
    if request.note_ids.len() > MAX_NOTES_BATCH_SIZE {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("noteIds batch limit is {MAX_NOTES_BATCH_SIZE}"),
        ));
    }

    let mut seen_note_ids = HashSet::new();
    let mut note_ids = Vec::new();

    for note_id in request.note_ids {
        validate_note_id(&note_id)?;
        if !seen_note_ids.insert(note_id.clone()) {
            continue;
        }
        note_ids.push(note_id);
    }

    let existing_rows = sqlx::query_as::<_, BatchNoteRow>(
        "SELECT
            note_id,
            id,
            current_revision,
            current_relative_path,
            current_content_hash,
            CASE
                WHEN trashed_at IS NULL THEN NULL
                ELSE to_char(trashed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
            END AS trashed_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
         FROM notes
         WHERE vault_id = $1 AND note_id = ANY($2)",
    )
    .bind(session.vault_id)
    .bind(&note_ids)
    .fetch_all(&state.pool)
    .await
    .map_err(internal_error)?;
    let mut rows_by_note_id = existing_rows
        .into_iter()
        .map(|row| {
            (
                row.note_id,
                ExistingNoteRow {
                    id: row.id,
                    current_revision: row.current_revision,
                    current_relative_path: row.current_relative_path,
                    current_content_hash: row.current_content_hash,
                    trashed_at: row.trashed_at,
                    updated_at: row.updated_at,
                },
            )
        })
        .collect::<HashMap<_, _>>();

    let mut notes = Vec::new();
    for note_id in note_ids {
        let Some(existing) = rows_by_note_id.remove(&note_id) else {
            continue;
        };

        notes.push(
            load_remote_head(&state.pool, &state.config.blob_root, &note_id, existing).await?,
        );
    }

    Ok(Json(GetNotesResponse { notes }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PullChangesQuery {
    cursor: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, FromRow)]
struct ManifestNoteRow {
    note_id: String,
    revision: i64,
    relative_path: String,
    content_hash: String,
    trashed_at: Option<String>,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct ChangeRow {
    seq: i64,
    kind: String,
    note_id: String,
    revision: Option<i64>,
    relative_path: Option<String>,
    content_hash: Option<String>,
    trashed_at: Option<String>,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct BatchNoteRow {
    note_id: String,
    id: uuid::Uuid,
    current_revision: i64,
    current_relative_path: String,
    current_content_hash: String,
    trashed_at: Option<String>,
    updated_at: String,
}
