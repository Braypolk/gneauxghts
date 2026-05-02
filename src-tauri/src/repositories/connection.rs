//! Schema versioning helpers for SQLite-backed repositories.
//!
//! The break-the-app target asks for "one connection-managed persistence
//! layer with migrations". Migrating in a single rewrite is risky for
//! user data — instead we centralise a tiny `schema_version` helper that
//! every repository can call to record/read its on-disk schema version.
//! Each repository keeps its own physical database file (so existing
//! users' `app-state.sqlite3`, `semantic.sqlite3`, and `ai.sqlite3`
//! continue to open unchanged), but every file shares the same
//! `_schema_meta` table layout going forward.
//!
//! The function is best-effort by design: the existing schema bootstraps
//! (`ensure_schema()` in `semantic/db.rs` and `ai/store.rs`,
//! `ensure_app_state_schema` in `state/persistence.rs`) keep doing their
//! own DDL as before. Schema versions are additive metadata.

use rusqlite::Connection;

const SCHEMA_META_TABLE: &str = "_schema_meta";

/// Idempotently create the `_schema_meta` table if missing.
pub(crate) fn ensure_schema_meta_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {SCHEMA_META_TABLE} (
             component TEXT PRIMARY KEY,
             version INTEGER NOT NULL,
             updated_at_millis INTEGER NOT NULL
         );"
    ))
    .map_err(|err| format!("schema meta table: {err}"))
}

/// Record the schema version for a component (e.g. "ui_state", "semantic",
/// "ai"). Future migrations can read this back and apply incremental
/// changes. Best-effort: returns Ok if the metadata table cannot be
/// created (migration safety) — the caller's primary DDL still runs.
#[allow(dead_code)]
pub(crate) fn record_schema_version(
    conn: &Connection,
    component: &str,
    version: u32,
) -> Result<(), String> {
    if ensure_schema_meta_table(conn).is_err() {
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        &format!(
            "INSERT INTO {SCHEMA_META_TABLE} (component, version, updated_at_millis)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(component) DO UPDATE SET
                 version = excluded.version,
                 updated_at_millis = excluded.updated_at_millis"
        ),
        rusqlite::params![component, version as i64, now],
    )
    .map(|_| ())
    .map_err(|err| format!("record schema version: {err}"))
}

/// Read the recorded schema version for a component, returning 0 if the
/// metadata table or row is missing.
#[allow(dead_code)]
pub(crate) fn read_schema_version(conn: &Connection, component: &str) -> u32 {
    if ensure_schema_meta_table(conn).is_err() {
        return 0;
    }
    conn.query_row(
        &format!("SELECT version FROM {SCHEMA_META_TABLE} WHERE component = ?1"),
        rusqlite::params![component],
        |row| row.get::<_, i64>(0),
    )
    .ok()
    .map(|value| value.max(0) as u32)
    .unwrap_or(0)
}
