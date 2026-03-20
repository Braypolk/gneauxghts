use crate::state::AppState;
use anyhow::Result;
use sqlx::{Executor, FromRow, PgPool};

pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    Ok(PgPool::connect(database_url).await?)
}

pub async fn ensure_schema(pool: &PgPool) -> Result<()> {
    pool.execute(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS vaults (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS devices (
            id UUID PRIMARY KEY,
            vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            device_name TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (vault_id, device_id)
        );

        CREATE TABLE IF NOT EXISTS magic_link_tokens (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS notes (
            id UUID PRIMARY KEY,
            vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            note_id TEXT NOT NULL,
            current_relative_path TEXT NOT NULL,
            current_revision BIGINT NOT NULL,
            current_content_hash TEXT NOT NULL,
            trashed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE (vault_id, note_id)
        );

        CREATE TABLE IF NOT EXISTS note_revisions (
            id UUID PRIMARY KEY,
            note_row_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            revision BIGINT NOT NULL,
            content_hash TEXT NOT NULL,
            blob_path TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            base_revision BIGINT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (note_row_id, revision)
        );

        CREATE TABLE IF NOT EXISTS sync_changes (
            seq BIGSERIAL PRIMARY KEY,
            vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            note_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            revision BIGINT,
            relative_path TEXT,
            content_hash TEXT,
            trashed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL
        );
        "#,
    )
    .await?;
    Ok(())
}

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: uuid::Uuid,
    pub email: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct VaultRow {
    pub id: uuid::Uuid,
}

#[derive(Debug, Clone, FromRow)]
pub struct SessionRow {
    pub vault_id: uuid::Uuid,
}

pub async fn find_or_create_user(pool: &PgPool, email: &str) -> Result<UserRow> {
    if let Some(user) = sqlx::query_as::<_, UserRow>("SELECT id, email FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await?
    {
        return Ok(user);
    }

    let id = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email) VALUES ($1, $2)")
        .bind(id)
        .bind(email)
        .execute(pool)
        .await?;

    Ok(UserRow {
        id,
        email: email.to_string(),
    })
}

pub async fn find_or_create_vault(pool: &PgPool, user_id: uuid::Uuid) -> Result<VaultRow> {
    if let Some(vault) =
        sqlx::query_as::<_, VaultRow>("SELECT id, user_id FROM vaults WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?
    {
        return Ok(vault);
    }

    let id = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO vaults (id, user_id) VALUES ($1, $2)")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(VaultRow { id })
}

pub async fn touch_device(
    pool: &PgPool,
    vault_id: uuid::Uuid,
    device_id: &str,
    device_name: Option<&str>,
) -> Result<()> {
    let existing = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM devices WHERE vault_id = $1 AND device_id = $2
        )",
    )
    .bind(vault_id)
    .bind(device_id)
    .fetch_one(pool)
    .await?;

    if existing {
        sqlx::query(
            "UPDATE devices SET device_name = COALESCE($3, device_name), last_seen_at = NOW()
             WHERE vault_id = $1 AND device_id = $2",
        )
        .bind(vault_id)
        .bind(device_id)
        .bind(device_name)
        .execute(pool)
        .await?;
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO devices (id, vault_id, device_id, device_name) VALUES ($1, $2, $3, $4)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(vault_id)
    .bind(device_id)
    .bind(device_name)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn max_cursor(pool: &PgPool, vault_id: uuid::Uuid) -> Result<i64> {
    let cursor = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(seq) FROM sync_changes WHERE vault_id = $1",
    )
    .bind(vault_id)
    .fetch_one(pool)
    .await?;
    Ok(cursor.unwrap_or(0))
}

pub async fn authenticate_session(
    state: &AppState,
    token_hash: &str,
) -> Result<Option<SessionRow>> {
    let session = sqlx::query_as::<_, SessionRow>(
        "SELECT vault_id FROM sessions
         WHERE token_hash = $1 AND expires_at > NOW()",
    )
    .bind(token_hash)
    .fetch_optional(&state.pool)
    .await?;
    Ok(session)
}
