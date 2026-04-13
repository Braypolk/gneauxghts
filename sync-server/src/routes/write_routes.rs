use super::shared::{
    load_remote_head, validate_note_id, validate_relative_path, write_blob, ExistingNoteRow,
};
use crate::{
    auth::{internal_error, AuthenticatedSession},
    db,
    state::AppState,
};
use axum::{extract::State, http::StatusCode, Json};
use gneauxghts_sync_contract::{
    PushNoteSnapshotRequest, PushNoteSnapshotResponse, PushNoteSnapshotStatus,
    PushTrashEventRequest, PushTrashEventResponse, TrashAction,
};
use std::sync::Arc;
use tokio::fs;
use uuid::Uuid;

pub(super) async fn push_note_snapshot(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Json(request): Json<PushNoteSnapshotRequest>,
) -> Result<Json<PushNoteSnapshotResponse>, (StatusCode, String)> {
    push_note_like(
        &state,
        session.vault_id,
        request.note_id,
        request.base_revision,
        request.relative_path,
        request.markdown,
        request.content_hash,
        request.updated_at,
        None,
        "upsert",
    )
    .await
    .map(Json)
}

pub(super) async fn push_trash_event(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Json(request): Json<PushTrashEventRequest>,
) -> Result<Json<PushTrashEventResponse>, (StatusCode, String)> {
    let kind = match request.action {
        TrashAction::Trash => "trash",
        TrashAction::Restore => "restore",
    };
    let response = push_note_like(
        &state,
        session.vault_id,
        request.note_id,
        request.base_revision,
        request.relative_path,
        request.markdown,
        request.content_hash,
        request.updated_at,
        request.trashed_at,
        kind,
    )
    .await?;

    Ok(Json(PushTrashEventResponse {
        status: response.status,
        current_revision: response.current_revision,
        cursor: response.cursor,
        remote_head: response.remote_head,
    }))
}

async fn push_note_like(
    state: &Arc<AppState>,
    vault_id: Uuid,
    note_id: String,
    base_revision: Option<i64>,
    relative_path: String,
    markdown: String,
    content_hash: String,
    updated_at: String,
    trashed_at: Option<String>,
    change_kind: &str,
) -> Result<PushNoteSnapshotResponse, (StatusCode, String)> {
    validate_note_id(&note_id)?;
    validate_relative_path(&relative_path)?;

    let mut transaction = state.pool.begin().await.map_err(internal_error)?;
    let mut written_blob_path = None;
    let operation = async {
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
        .bind(vault_id)
        .bind(&note_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(internal_error)?;

        let current_revision = existing
            .as_ref()
            .map(|note| note.current_revision)
            .unwrap_or(0);
        if current_revision != base_revision.unwrap_or(0) {
            let remote_head = if let Some(existing) = existing {
                Some(
                    load_remote_head(&state.pool, &state.config.blob_root, &note_id, existing)
                        .await?,
                )
            } else {
                None
            };
            return Ok(PushNoteSnapshotResponse {
                status: PushNoteSnapshotStatus::Conflict,
                current_revision,
                cursor: db::max_cursor(&state.pool, vault_id)
                    .await
                    .map_err(internal_error)?,
                remote_head,
            });
        }

        let next_revision = current_revision + 1;
        let blob_path = write_blob(
            &state.config.blob_root,
            vault_id,
            &note_id,
            next_revision,
            &markdown,
        )
        .await
        .map_err(internal_error)?;
        written_blob_path = Some(blob_path.clone());

        let note_row_id = existing
            .as_ref()
            .map(|row| row.id)
            .unwrap_or_else(Uuid::new_v4);

        if existing.is_some() {
            sqlx::query(
                "UPDATE notes
                 SET current_relative_path = $3,
                     current_revision = $4,
                     current_content_hash = $5,
                     trashed_at = CASE WHEN $6::TEXT IS NULL THEN NULL ELSE CAST($6 AS TIMESTAMPTZ) END,
                     updated_at = CAST($7 AS TIMESTAMPTZ)
                 WHERE id = $1 AND vault_id = $2",
            )
            .bind(note_row_id)
            .bind(vault_id)
            .bind(&relative_path)
            .bind(next_revision)
            .bind(&content_hash)
            .bind(trashed_at.as_deref())
            .bind(&updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(map_write_error)?;
        } else {
            sqlx::query(
                "INSERT INTO notes (
                    id,
                    vault_id,
                    note_id,
                    current_relative_path,
                    current_revision,
                    current_content_hash,
                    trashed_at,
                    updated_at
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    CASE WHEN $7::TEXT IS NULL THEN NULL ELSE CAST($7 AS TIMESTAMPTZ) END,
                    CAST($8 AS TIMESTAMPTZ)
                 )",
            )
            .bind(note_row_id)
            .bind(vault_id)
            .bind(&note_id)
            .bind(&relative_path)
            .bind(next_revision)
            .bind(&content_hash)
            .bind(trashed_at.as_deref())
            .bind(&updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(map_write_error)?;
        }

        sqlx::query(
            "INSERT INTO note_revisions (
                id,
                note_row_id,
                revision,
                content_hash,
                blob_path,
                updated_at,
                base_revision
             ) VALUES ($1, $2, $3, $4, $5, CAST($6 AS TIMESTAMPTZ), $7)",
        )
        .bind(Uuid::new_v4())
        .bind(note_row_id)
        .bind(next_revision)
        .bind(&content_hash)
        .bind(&blob_path)
        .bind(&updated_at)
        .bind(base_revision)
        .execute(&mut *transaction)
        .await
        .map_err(map_write_error)?;

        let cursor = sqlx::query_scalar::<_, i64>(
            "INSERT INTO sync_changes (
                vault_id,
                note_id,
                kind,
                revision,
                relative_path,
                content_hash,
                trashed_at,
                updated_at
             ) VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                CASE WHEN $7::TEXT IS NULL THEN NULL ELSE CAST($7 AS TIMESTAMPTZ) END,
                CAST($8 AS TIMESTAMPTZ)
             ) RETURNING seq",
        )
        .bind(vault_id)
        .bind(&note_id)
        .bind(change_kind)
        .bind(next_revision)
        .bind(&relative_path)
        .bind(&content_hash)
        .bind(trashed_at.as_deref())
        .bind(&updated_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_write_error)?;

        Ok(PushNoteSnapshotResponse {
            status: PushNoteSnapshotStatus::Accepted,
            current_revision: next_revision,
            cursor,
            remote_head: None,
        })
    }
    .await;

    match operation {
        Ok(response) => {
            if let Err(error) = transaction.commit().await {
                if let Some(blob_path) = written_blob_path.as_deref() {
                    cleanup_blob_file(&state.config.blob_root, &blob_path).await;
                }
                return Err(internal_error(error));
            }
            Ok(response)
        }
        Err(error) => {
            if let Some(blob_path) = written_blob_path.as_deref() {
                cleanup_blob_file(&state.config.blob_root, &blob_path).await;
            }
            Err(error)
        }
    }
}

async fn cleanup_blob_file(blob_root: &std::path::Path, relative_path: &str) {
    let full_path = blob_root.join(relative_path);
    match fs::remove_file(&full_path).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

fn map_write_error(error: sqlx::Error) -> (StatusCode, String) {
    if let Some(database_error) = error.as_database_error() {
        if database_error.constraint() == Some("notes_live_path_unique") {
            return (
                StatusCode::CONFLICT,
                "Another live note already uses that relativePath".to_string(),
            );
        }
    }

    internal_error(error)
}
