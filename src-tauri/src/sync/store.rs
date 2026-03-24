use super::{generate_device_id, SYNC_DB_FILE_NAME};
use crate::state::app_data_dir;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;

pub(super) fn open_database() -> Result<Connection, String> {
    let app_data_dir = app_data_dir()?;
    fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
    Connection::open(app_data_dir.join(SYNC_DB_FILE_NAME)).map_err(|err| err.to_string())
}

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
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
    ensure_column(
        connection,
        "sync_state",
        "sync_cursor",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        connection,
        "sync_state",
        "paused",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(connection, "sync_state", "sync_base_url", "TEXT")?;
    ensure_column(connection, "sync_state", "session_token", "TEXT")?;
    ensure_column(connection, "sync_state", "last_sync_error", "TEXT")?;
    ensure_column(
        connection,
        "tracked_notes",
        "local_only",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(connection, "sync_conflicts", "original_note_id", "TEXT")?;
    ensure_column(connection, "sync_conflicts", "original_note_path", "TEXT")?;
    ensure_column(
        connection,
        "sync_conflicts",
        "local_markdown",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        connection,
        "sync_conflicts",
        "remote_markdown",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

pub(super) fn ensure_sync_state_row(connection: &Connection) -> Result<(), String> {
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
    let columns = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
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
