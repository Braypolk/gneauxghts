use crate::auth::internal_error;
use axum::http::StatusCode;
use gneauxghts_sync_contract::RemoteHead;
use sqlx::{FromRow, PgPool};
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

pub(super) async fn write_blob(
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

pub(super) async fn load_remote_head(
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
pub(super) struct ExistingNoteRow {
    pub(super) id: Uuid,
    pub(super) current_revision: i64,
    pub(super) current_relative_path: String,
    pub(super) current_content_hash: String,
    pub(super) trashed_at: Option<String>,
    pub(super) updated_at: String,
}

#[derive(Debug, FromRow)]
struct RevisionBlobRow {
    blob_path: String,
}
