//! App-global secret store.
//!
//! Secrets — currently provider API keys — must never be written into the
//! portable vault (`<vault>/.gneauxghts`). If they were, moving or sharing a
//! vault folder would leak credentials. Instead they live in a small,
//! machine-global SQLite key/value file under the app data directory
//! (`secrets.sqlite3`), alongside other per-device state.
//!
//! The store is a flat `secrets(key TEXT PRIMARY KEY, value TEXT)` table.
//! Vault-local AI content (jobs, proposals, history) and non-secret provider
//! config (kind, base url, model) stay in the vault-local `ai.sqlite3`.

use rusqlite::{params, Connection, OptionalExtension};

/// Key under which the AI provider API key is stored.
pub(super) const AI_API_KEY: &str = "ai.api_key";

fn open(conn_path: &std::path::Path) -> Result<Connection, String> {
    if let Some(parent) = conn_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let connection = Connection::open(conn_path).map_err(|err| err.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS secrets (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL,
                 updated_at_millis INTEGER NOT NULL
             );",
        )
        .map_err(|err| err.to_string())?;
    Ok(connection)
}

fn store_path() -> Result<std::path::PathBuf, String> {
    crate::state::global_secrets_db_path()
}

/// Read a secret value, returning `None` if unset.
pub(super) fn get_secret(key: &str) -> Result<Option<String>, String> {
    let connection = open(&store_path()?)?;
    connection
        .query_row(
            "SELECT value FROM secrets WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())
}

/// Upsert a secret. Passing `None` (or an empty string) deletes it, so the
/// "clear the API key" path leaves no residue behind.
pub(super) fn set_secret(key: &str, value: Option<&str>) -> Result<(), String> {
    let connection = open(&store_path()?)?;
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            let now = crate::time::current_time_millis()? as i64;
            connection
                .execute(
                    "INSERT INTO secrets (key, value, updated_at_millis)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(key) DO UPDATE SET
                         value = excluded.value,
                         updated_at_millis = excluded.updated_at_millis",
                    params![key, value, now],
                )
                .map(|_| ())
                .map_err(|err| err.to_string())
        }
        None => connection
            .execute("DELETE FROM secrets WHERE key = ?1", params![key])
            .map(|_| ())
            .map_err(|err| err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{TestDir, TEST_ENV_GUARD};

    #[test]
    fn secret_round_trips_and_clears_in_global_store() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data = TestDir::new("secret-store-roundtrip");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).expect("set app data");

        assert_eq!(get_secret(AI_API_KEY).expect("get empty"), None);

        set_secret(AI_API_KEY, Some("sk-test-123")).expect("set");
        assert_eq!(
            get_secret(AI_API_KEY).expect("get"),
            Some("sk-test-123".to_string())
        );

        // The secret store lives in the global app data dir, never in a vault.
        let store = app_data.path().join("secrets.sqlite3");
        assert!(store.is_file(), "secret store must be in global app data");

        // Empty value clears the secret rather than persisting blanks.
        set_secret(AI_API_KEY, Some("   ")).expect("set blank");
        assert_eq!(get_secret(AI_API_KEY).expect("get after blank"), None);

        set_secret(AI_API_KEY, Some("sk-again")).expect("set again");
        set_secret(AI_API_KEY, None).expect("clear");
        assert_eq!(get_secret(AI_API_KEY).expect("get after clear"), None);
    }
}
