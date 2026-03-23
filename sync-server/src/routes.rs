use crate::{
    auth::{internal_error, AuthenticatedSession},
    db,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use gneauxghts_sync_contract::{
    AuthSession, CompleteMagicLinkRequest, GetManifestResponse, GetNoteResponse, GetNotesRequest,
    GetNotesResponse, NoteHead, PullChangesResponse, PushNoteSnapshotRequest,
    PushNoteSnapshotResponse, PushNoteSnapshotStatus, PushTrashEventRequest,
    PushTrashEventResponse, RemoteHead, RequestMagicLinkRequest, RequestMagicLinkResponse,
    SyncChange, SyncChangeKind, TrashAction,
};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};
use std::{collections::HashSet, path::PathBuf, sync::Arc};
use tokio::fs;
use uuid::Uuid;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/request-magic-link", post(request_magic_link))
        .route("/auth/complete", post(complete_magic_link))
        .route("/v1/sync/manifest", get(get_manifest))
        .route("/v1/sync/changes", get(pull_changes))
        .route("/v1/sync/notes/batch", post(get_notes_batch))
        .route("/v1/sync/notes/:note_id", get(get_note))
        .route("/v1/sync/notes", post(push_note_snapshot))
        .route("/v1/sync/trash", post(push_trash_event))
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn request_magic_link(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RequestMagicLinkRequest>,
) -> Result<Json<RequestMagicLinkResponse>, (StatusCode, String)> {
    let email = request.email.trim().to_lowercase();
    if email.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Email is required".to_string()));
    }

    let user = db::find_or_create_user(&state.pool, &email)
        .await
        .map_err(internal_error)?;
    let raw_token = Uuid::new_v4().to_string();
    let token_hash = blake3::hash(raw_token.as_bytes()).to_hex().to_string();
    let expires_at = sqlx::query_scalar::<_, String>(
        "INSERT INTO magic_link_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + make_interval(mins => $4::int))
         RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(Uuid::new_v4())
    .bind(user.id)
    .bind(token_hash)
    .bind(state.config.magic_link_ttl_minutes)
    .fetch_one(&state.pool)
    .await
    .map_err(internal_error)?;

    tracing::info!(email = %user.email, "created magic link token");
    Ok(Json(RequestMagicLinkResponse {
        accepted: true,
        expires_at,
        magic_link_token: state
            .config
            .allow_insecure_token_response
            .then_some(raw_token),
    }))
}

async fn complete_magic_link(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CompleteMagicLinkRequest>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = request.email.trim().to_lowercase();
    let token_hash = blake3::hash(request.magic_link_token.as_bytes())
        .to_hex()
        .to_string();

    let user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT users.id
         FROM users
         INNER JOIN magic_link_tokens ON magic_link_tokens.user_id = users.id
         WHERE users.email = $1
           AND magic_link_tokens.token_hash = $2
           AND magic_link_tokens.consumed_at IS NULL
           AND magic_link_tokens.expires_at > NOW()",
    )
    .bind(&email)
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Invalid or expired magic link".to_string(),
        )
    })?;

    sqlx::query(
        "UPDATE magic_link_tokens SET consumed_at = NOW() WHERE token_hash = $1 AND consumed_at IS NULL",
    )
    .bind(&token_hash)
    .execute(&state.pool)
    .await
    .map_err(internal_error)?;

    let vault = db::find_or_create_vault(&state.pool, user_id)
        .await
        .map_err(internal_error)?;
    db::touch_device(
        &state.pool,
        vault.id,
        &request.device_id,
        request.device_name.as_deref(),
    )
    .await
    .map_err(internal_error)?;

    let raw_session_token = Uuid::new_v4().to_string();
    let session_token_hash = blake3::hash(raw_session_token.as_bytes())
        .to_hex()
        .to_string();
    let expires_at = sqlx::query_scalar::<_, String>(
        "INSERT INTO sessions (id, user_id, vault_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + make_interval(days => $5::int))
         RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(vault.id)
    .bind(session_token_hash)
    .bind(state.config.session_ttl_days)
    .fetch_one(&state.pool)
    .await
    .map_err(internal_error)?;

    Ok(Json(AuthSession {
        session_token: raw_session_token,
        user_id: user_id.to_string(),
        vault_id: vault.id.to_string(),
        device_id: request.device_id,
        expires_at,
    }))
}

async fn get_manifest(
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullChangesQuery {
    cursor: Option<i64>,
    limit: Option<i64>,
}

async fn pull_changes(
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

async fn get_note(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Path(note_id): Path<String>,
) -> Result<Json<GetNoteResponse>, (StatusCode, String)> {
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

async fn get_notes_batch(
    State(state): State<Arc<AppState>>,
    session: AuthenticatedSession,
    Json(request): Json<GetNotesRequest>,
) -> Result<Json<GetNotesResponse>, (StatusCode, String)> {
    if request.note_ids.is_empty() {
        return Ok(Json(GetNotesResponse { notes: Vec::new() }));
    }

    let mut notes = Vec::new();
    let mut seen_note_ids = HashSet::new();

    for note_id in request.note_ids {
        if !seen_note_ids.insert(note_id.clone()) {
            continue;
        }

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
        .map_err(internal_error)?;

        let Some(existing) = existing else {
            continue;
        };

        notes.push(
            load_remote_head(&state.pool, &state.config.blob_root, &note_id, existing).await?,
        );
    }

    Ok(Json(GetNotesResponse { notes }))
}

async fn push_note_snapshot(
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

async fn push_trash_event(
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
    let mut transaction = state.pool.begin().await.map_err(internal_error)?;
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
            Some(load_remote_head(&state.pool, &state.config.blob_root, &note_id, existing).await?)
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
        .map_err(internal_error)?;
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
        .map_err(internal_error)?;
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
    .map_err(internal_error)?;

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
    .map_err(internal_error)?;

    transaction.commit().await.map_err(internal_error)?;

    Ok(PushNoteSnapshotResponse {
        status: PushNoteSnapshotStatus::Accepted,
        current_revision: next_revision,
        cursor,
        remote_head: None,
    })
}

async fn write_blob(
    blob_root: &PathBuf,
    vault_id: Uuid,
    note_id: &str,
    revision: i64,
    markdown: &str,
) -> Result<String, anyhow::Error> {
    let relative_path = format!("{vault_id}/{note_id}/rev-{revision}.md");
    let path = blob_root.join(&relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(&path, markdown).await?;
    Ok(relative_path)
}

async fn load_remote_head(
    pool: &PgPool,
    blob_root: &PathBuf,
    note_id: &str,
    existing: ExistingNoteRow,
) -> Result<RemoteHead, (StatusCode, String)> {
    let revision = sqlx::query_as::<_, RevisionBlobRow>(
        "SELECT
            revision,
            content_hash,
            blob_path,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
         FROM note_revisions
         WHERE note_row_id = $1 AND revision = $2",
    )
    .bind(existing.id)
    .bind(existing.current_revision)
    .fetch_one(pool)
    .await
    .map_err(internal_error)?;
    let markdown = fs::read_to_string(blob_root.join(&revision.blob_path))
        .await
        .map_err(internal_error)?;

    Ok(RemoteHead {
        note_id: note_id.to_string(),
        revision: existing.current_revision,
        relative_path: existing.current_relative_path,
        markdown,
        content_hash: existing.current_content_hash,
        trashed_at: existing.trashed_at,
        updated_at: existing.updated_at,
    })
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
struct ExistingNoteRow {
    id: Uuid,
    current_revision: i64,
    current_relative_path: String,
    current_content_hash: String,
    trashed_at: Option<String>,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct RevisionBlobRow {
    blob_path: String,
}
