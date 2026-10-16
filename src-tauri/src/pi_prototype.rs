//! Evaluation Pi storage facade. No session/task/proposal semantics live here.
use rusqlite::{
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const LEASE_TIME: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(crate) struct NativeDatabase {
    state: Mutex<DatabaseState>,
    changed: Condvar,
    shutdown: Mutex<ShutdownState>,
    shutdown_changed: Condvar,
}

#[derive(Default)]
struct ShutdownState {
    next: u64,
    pending: Option<String>,
    acknowledged: bool,
}

struct DatabaseState {
    accepting: bool,
    terminal: bool,
    connection: Option<Connection>,
    owner: u64,
    next_transaction: u64,
    transaction: Option<(u64, Instant)>,
}

impl Default for DatabaseState {
    fn default() -> Self {
        Self {
            accepting: true,
            terminal: false,
            connection: None,
            owner: 0,
            next_transaction: 0,
            transaction: None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlRequest {
    action: String,
    owner: Option<u64>,
    transaction: Option<u64>,
    sql: Option<String>,
    #[serde(default)]
    params: Vec<Value>,
}

fn parameter(value: &Value) -> Result<SqlValue, String> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::String(s) => Ok(SqlValue::Text(s.clone())),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| n.as_f64().map(SqlValue::Real))
            .ok_or("Invalid number".into()),
        Value::Object(o) if o.contains_key("integer") => o["integer"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .map(SqlValue::Integer)
            .ok_or("Invalid integer".into()),
        Value::Object(o) if o.contains_key("blob") => serde_json::from_value(o["blob"].clone())
            .map(SqlValue::Blob)
            .map_err(|e| e.to_string()),
        _ => Err("Unsupported SQLite parameter".into()),
    }
}

impl NativeDatabase {
    /// Ask the Pi owner to checkpoint and join its workers before native resources close.
    pub(crate) fn quiesce_for_restart<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        {
            let mut state = self.state.lock().map_err(|_| "SQLite lock poisoned")?;
            if state.terminal {
                return Err("Pi storage is already closed for restart".into());
            }
            // Settings may request restart before chat has ever opened. Closing
            // admission here also prevents a concurrent first owner from racing it.
            if state.connection.is_none() {
                state.accepting = false;
                return Ok(());
            }
        }
        let mut shutdown = self
            .shutdown
            .lock()
            .map_err(|_| "Pi shutdown lock poisoned")?;
        shutdown.next += 1;
        let token = format!("pi-restart-{}", shutdown.next);
        shutdown.pending = Some(token.clone());
        shutdown.acknowledged = false;
        app.emit("pi-lifecycle-quiesce", serde_json::json!({"token":token}))
            .map_err(|e| e.to_string())?;
        let (shutdown, timeout) = self
            .shutdown_changed
            .wait_timeout_while(shutdown, Duration::from_secs(15), |state| {
                !state.acknowledged
            })
            .map_err(|_| "Pi shutdown wait poisoned")?;
        if timeout.timed_out() && !shutdown.acknowledged {
            return Err(
                "Pi did not finish checkpointing and stopping its tasks; restart remains blocked"
                    .into(),
            );
        }
        drop(shutdown);
        self.state
            .lock()
            .map_err(|_| "SQLite lock poisoned")?
            .accepting = false;
        Ok(())
    }
    fn acknowledge_quiesce(&self, token: &str) -> Result<(), String> {
        let mut shutdown = self
            .shutdown
            .lock()
            .map_err(|_| "Pi shutdown lock poisoned")?;
        if shutdown.pending.as_deref() != Some(token) {
            return Err("Obsolete Pi shutdown acknowledgement".into());
        }
        shutdown.acknowledged = true;
        self.shutdown_changed.notify_all();
        Ok(())
    }
    pub(crate) fn resume_after_failed_restart(&self) -> Result<(), String> {
        {
            let mut state = self.state.lock().map_err(|_| "SQLite lock poisoned")?;
            if state.terminal {
                return Err("Pi storage cannot resume after terminal close".into());
            }
            state.accepting = true;
        }
        let mut shutdown = self
            .shutdown
            .lock()
            .map_err(|_| "Pi shutdown lock poisoned")?;
        shutdown.pending = None;
        shutdown.acknowledged = false;
        Ok(())
    }
    /// Terminal boundary: revoke all owners, settle leased transactions, checkpoint and close.
    pub(crate) fn finish_restart_shutdown(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "SQLite lock poisoned")?;
        state.accepting = false;
        state.terminal = true;
        state.owner += 1;
        state.transaction = None;
        self.changed.notify_all();
        if let Some(connection) = state.connection.as_ref() {
            if !connection.is_autocommit() {
                connection
                    .execute_batch("ROLLBACK")
                    .map_err(|e| e.to_string())?;
            }
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .map_err(|e| e.to_string())?;
        }
        if let Some(connection) = state.connection.take() {
            connection.close().map_err(|(_, e)| e.to_string())?;
        }
        Ok(())
    }
    fn perform(&self, path: &std::path::Path, request: SqlRequest) -> Result<Value, String> {
        let mut state = self.state.lock().map_err(|_| "SQLite lock poisoned")?;
        if !state.accepting {
            return Err("Pi SQLite admission is closed for restart".into());
        }
        if request.action == "open" {
            // A new webview lifetime revokes old handles and abandons its transaction.
            if let Some(connection) = state.connection.take() {
                if !connection.is_autocommit() {
                    connection
                        .execute_batch("ROLLBACK")
                        .map_err(|e| e.to_string())?;
                }
            }
            state.transaction = None;
            self.changed.notify_all();
            std::fs::create_dir_all(path.parent().ok_or("Missing database parent")?)
                .map_err(|e| e.to_string())?;
            let connection = Connection::open(path).map_err(|e| e.to_string())?;
            connection
                .execute_batch(
                    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
                )
                .map_err(|e| e.to_string())?;
            state.connection = Some(connection);
            state.owner += 1;
            return Ok(json!(state.owner));
        }
        loop {
            if !state.accepting {
                return Err("Pi SQLite admission is closed for restart".into());
            }
            if request.owner != Some(state.owner) || state.connection.is_none() {
                return Err("Revoked SQLite owner".into());
            }
            match state.transaction {
                Some((id, deadline)) if Instant::now() >= deadline => {
                    state
                        .connection
                        .as_ref()
                        .unwrap()
                        .execute_batch("ROLLBACK")
                        .map_err(|e| format!("Abandoned transaction rollback failed: {e}"))?;
                    state.transaction = None;
                    self.changed.notify_all();
                    if request.transaction.is_some() {
                        return Err("Expired SQLite transaction".into());
                    }
                    let _ = id;
                }
                Some((id, _)) if request.transaction == Some(id) => break,
                Some((_, deadline)) if request.transaction.is_none() => {
                    let wait = deadline.saturating_duration_since(Instant::now());
                    state = self
                        .changed
                        .wait_timeout(state, wait)
                        .map_err(|_| "SQLite wait poisoned")?
                        .0;
                }
                Some(_) => return Err("Wrong SQLite transaction".into()),
                None if request.transaction.is_some() => {
                    return Err("Closed SQLite transaction".into())
                }
                None => break,
            }
        }
        if request.action == "begin" {
            if state.transaction.is_some() {
                return Err("Nested SQLite transaction".into());
            }
            state
                .connection
                .as_ref()
                .unwrap()
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            state.next_transaction += 1;
            let id = state.next_transaction;
            state.transaction = Some((id, Instant::now() + LEASE_TIME));
            return Ok(json!(id));
        }
        if request.action == "commit" || request.action == "rollback" {
            if request.transaction.is_none() {
                return Err("Transaction identity required".into());
            }
            let sql = if request.action == "commit" {
                "COMMIT"
            } else {
                "ROLLBACK"
            };
            let result = state
                .connection
                .as_ref()
                .unwrap()
                .execute_batch(sql)
                .map_err(|e| e.to_string());
            if result.is_ok() {
                state.transaction = None;
                self.changed.notify_all();
            }
            return result.map(|_| Value::Null);
        }
        if request.action == "close" {
            state.connection.take();
            state.transaction = None;
            self.changed.notify_all();
            return Ok(Value::Null);
        }
        let sql = request.sql.ok_or("Missing SQL")?;
        let params: Vec<SqlValue> = request
            .params
            .iter()
            .map(parameter)
            .collect::<Result<_, _>>()?;
        let connection = state.connection.as_ref().unwrap();
        let result = (|| {
            if request.action == "exec" {
                connection.execute_batch(&sql).map_err(|e| e.to_string())?;
                return Ok(Value::Null);
            }
            let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
            if request.action == "run" {
                statement
                    .execute(rusqlite::params_from_iter(params))
                    .map_err(|e| e.to_string())?;
                return Ok(Value::Null);
            }
            if request.action != "get" && request.action != "all" {
                return Err("Unknown SQLite operation".into());
            }
            let names: Vec<String> = statement
                .column_names()
                .iter()
                .map(|s| s.to_string())
                .collect();
            let mut rows = statement
                .query(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
            let mut values = Vec::new();
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let mut value = serde_json::Map::new();
                for (index, name) in names.iter().enumerate() {
                    let item = match row.get_ref(index).map_err(|e| e.to_string())? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(n) if n.unsigned_abs() > 9_007_199_254_740_991 => {
                            json!({"integer": n.to_string()})
                        }
                        ValueRef::Integer(n) => json!(n),
                        ValueRef::Real(n) => json!(n),
                        ValueRef::Text(s) => {
                            json!(std::str::from_utf8(s).map_err(|e| e.to_string())?)
                        }
                        ValueRef::Blob(b) => json!({"blob": b}),
                    };
                    value.insert(name.clone(), item);
                }
                values.push(Value::Object(value));
                if request.action == "get" {
                    break;
                }
            }
            Ok(if request.action == "get" {
                values.pop().unwrap_or(Value::Null)
            } else {
                Value::Array(values)
            })
        })();
        if let Some((_, deadline)) = state.transaction.as_mut() {
            *deadline = Instant::now() + LEASE_TIME;
        }
        result
    }
}

#[tauri::command]
pub(crate) fn pi_lifecycle_quiesced(
    database: tauri::State<'_, NativeDatabase>,
    token: String,
) -> Result<(), String> {
    database.acknowledge_quiesce(&token)
}

#[tauri::command]
pub(crate) async fn pi_sql(app: tauri::AppHandle, request: SqlRequest) -> Result<Value, String> {
    let begin = request.action == "begin";
    let watchdog_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let path = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me/pi.sqlite");
        app.state::<NativeDatabase>().perform(&path, request)
    })
    .await
    .map_err(|e| e.to_string())?;
    if begin {
        if let Ok(Value::Number(id)) = &result {
            let id = id.as_u64().ok_or("Invalid transaction identity")?;
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let database = watchdog_app.state::<NativeDatabase>();
                    let Ok(mut state) = database.state.lock() else {
                        return;
                    };
                    let Some((active, deadline)) = state.transaction else {
                        return;
                    };
                    if active != id {
                        return;
                    }
                    if Instant::now() >= deadline {
                        // Drop revokes the connection even if explicit rollback fails.
                        state.connection.take();
                        state.transaction = None;
                        database.changed.notify_all();
                        return;
                    }
                }
            });
        }
    }
    result
}

#[tauri::command]
pub(crate) fn pi_probe_config() -> Value {
    let followons = std::env::var_os("PI_PROTOTYPE_HTTP_FIXTURE").is_some()
        && std::env::var_os("PI_PROTOTYPE_INTERACTIVE_GATE").is_some()
        && std::env::var("PI_PROTOTYPE_EXPANDED_GATE").as_deref() == Ok("true")
        && std::env::var("PI_PROTOTYPE_FOLLOWONS_GATE").as_deref() == Ok("true");
    serde_json::json!({"fixture": std::env::var_os("PI_PROTOTYPE_HTTP_FIXTURE").is_some(),
        "uiGate":std::env::var_os("PI_PROTOTYPE_UI_GATE").is_some(),
        "interactiveGate":std::env::var_os("PI_PROTOTYPE_INTERACTIVE_GATE").is_some(),
        "expandedGate":std::env::var("PI_PROTOTYPE_EXPANDED_GATE").as_deref()==Ok("true"),
        "followonsGate":followons})
}

#[tauri::command]
pub(crate) async fn pi_ui_report(report: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    let limit = if std::env::var_os("PI_PROTOTYPE_HTTP_FIXTURE").is_some()
        && std::env::var_os("PI_PROTOTYPE_INTERACTIVE_GATE").is_some() { 131072 } else { 16384 };
    if bytes.len() > limit {
        return Err("UI diagnostic too large".into());
    }
    std::fs::write(
        crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me/ui-report.json"),
        bytes,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn pi_probe_report(_app: tauri::AppHandle, report: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    if bytes.len() > 16_384 {
        return Err("Prototype diagnostic too large".into());
    }
    let directory = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    std::fs::write(directory.join("probe.json"), bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(
        action: &str,
        owner: Option<u64>,
        transaction: Option<u64>,
        sql: &str,
    ) -> SqlRequest {
        SqlRequest {
            action: action.into(),
            owner,
            transaction,
            sql: Some(sql.into()),
            params: vec![],
        }
    }
    #[test]
    fn terminal_restart_revokes_database_and_rolls_back_uncommitted_work() {
        let dir = crate::test_support::TestDir::new("pi-shutdown-storage");
        let path = dir.path().join("pi.sqlite3");
        let database = NativeDatabase::default();
        let owner = database
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        database
            .perform(
                &path,
                request("run", Some(owner), None, "CREATE TABLE effects(value TEXT)"),
            )
            .unwrap();
        let tx = database
            .perform(&path, request("begin", Some(owner), None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        database
            .perform(
                &path,
                request(
                    "run",
                    Some(owner),
                    Some(tx),
                    "INSERT INTO effects VALUES('uncommitted')",
                ),
            )
            .unwrap();
        database.finish_restart_shutdown().unwrap();
        assert!(database
            .perform(&path, request("open", None, None, ""))
            .unwrap_err()
            .contains("admission is closed"));
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM effects", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn shutdown_acknowledgements_bind_the_current_attempt() {
        let database = NativeDatabase::default();
        database.shutdown.lock().unwrap().pending = Some("current".into());
        assert!(database.acknowledge_quiesce("obsolete").is_err());
        assert!(!database.shutdown.lock().unwrap().acknowledged);
        database.acknowledge_quiesce("current").unwrap();
        assert!(database.shutdown.lock().unwrap().acknowledged);
        database.resume_after_failed_restart().unwrap();
        assert!(database.acknowledge_quiesce("current").is_err());
    }
    #[test]
    fn revoked_owner_rolls_back_and_stale_transaction_cannot_publish() {
        let dir = std::env::temp_dir().join(format!("pi-native-lease-{}", std::process::id()));
        let path = dir.join("PROTOTYPE.sqlite");
        let db = NativeDatabase::default();
        let owner = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        db.perform(
            &path,
            request(
                "exec",
                Some(owner),
                None,
                "CREATE TABLE IF NOT EXISTS probe (v INTEGER); DELETE FROM probe",
            ),
        )
        .unwrap();
        let tx = db
            .perform(&path, request("begin", Some(owner), None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        db.perform(
            &path,
            request(
                "run",
                Some(owner),
                Some(tx),
                "INSERT INTO probe VALUES (42)",
            ),
        )
        .unwrap();
        let replacement = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        assert!(db
            .perform(&path, request("commit", Some(owner), Some(tx), ""))
            .is_err());
        assert_eq!(
            db.perform(
                &path,
                request("get", Some(replacement), None, "SELECT * FROM probe")
            )
            .unwrap(),
            Value::Null
        );
        db.perform(&path, request("close", Some(replacement), None, ""))
            .unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn constraint_error_rolls_back_transaction_and_never_acknowledges_commit() {
        let dir = std::env::temp_dir().join(format!("pi-native-rollback-{}", std::process::id()));
        let path = dir.join("PROTOTYPE.sqlite");
        let db = NativeDatabase::default();
        let owner = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        db.perform(
            &path,
            request(
                "exec",
                Some(owner),
                None,
                "CREATE TABLE IF NOT EXISTS probe (v INTEGER UNIQUE); DELETE FROM probe",
            ),
        )
        .unwrap();
        let tx = db
            .perform(&path, request("begin", Some(owner), None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        db.perform(
            &path,
            request(
                "run",
                Some(owner),
                Some(tx),
                "INSERT INTO probe VALUES (42)",
            ),
        )
        .unwrap();
        assert!(db
            .perform(
                &path,
                request(
                    "run",
                    Some(owner),
                    Some(tx),
                    "INSERT INTO probe VALUES (42)"
                )
            )
            .is_err());
        db.perform(&path, request("rollback", Some(owner), Some(tx), ""))
            .unwrap();
        assert!(db
            .perform(&path, request("commit", Some(owner), Some(tx), ""))
            .is_err());
        assert_eq!(
            db.perform(
                &path,
                request("get", Some(owner), None, "SELECT * FROM probe")
            )
            .unwrap(),
            Value::Null
        );
        db.perform(&path, request("close", Some(owner), None, ""))
            .unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
