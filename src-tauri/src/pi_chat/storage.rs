//! Production Pi storage facade. No conversation/task/publication semantics live here.
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
const QUIESCE_REDELIVERY: Duration = Duration::from_millis(250);

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

/// Application SQL is confined to this Pi database. Native transaction/durability commands
/// run outside this scoped authorizer; arbitrary SQL cannot control their lifetime.
fn application_sql_authorizer(
    context: rusqlite::hooks::AuthContext<'_>,
) -> rusqlite::hooks::Authorization {
    use rusqlite::hooks::{AuthAction, Authorization};
    if context
        .database_name
        .is_some_and(|database| database != "main")
    {
        return Authorization::Deny;
    }
    match context.action {
        AuthAction::Attach { .. }
        | AuthAction::Detach { .. }
        | AuthAction::Transaction { .. }
        | AuthAction::Savepoint { .. }
        | AuthAction::CreateVtable { .. }
        | AuthAction::DropVtable { .. }
        | AuthAction::Unknown { .. } => Authorization::Deny,
        AuthAction::Function { function_name }
            if matches!(
                function_name.to_ascii_lowercase().as_str(),
                "load_extension"
                    | "readfile"
                    | "writefile"
                    | "sqlite_readfile"
                    | "sqlite_writefile"
                    | "fsdir"
            ) =>
        {
            Authorization::Deny
        }
        AuthAction::Pragma {
            pragma_name,
            pragma_value,
        } => {
            let name = pragma_name.to_ascii_lowercase();
            let introspection = matches!(
                name.as_str(),
                "table_info"
                    | "table_xinfo"
                    | "index_info"
                    | "index_xinfo"
                    | "index_list"
                    | "foreign_key_list"
            );
            let readonly = pragma_value.is_none()
                && matches!(
                    name.as_str(),
                    "synchronous"
                        | "journal_mode"
                        | "foreign_keys"
                        | "page_count"
                        | "page_size"
                        | "freelist_count"
                        | "user_version"
                        | "data_version"
                );
            if introspection || readonly {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        _ => Authorization::Allow,
    }
}
struct ApplicationSqlGuard<'a>(&'a Connection);
impl Drop for ApplicationSqlGuard<'_> {
    fn drop(&mut self) {
        self.0.authorizer(
            None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>,
        );
    }
}

impl NativeDatabase {
    /// Ask the Pi owner to checkpoint and join its workers before native resources close.
    pub(crate) fn quiesce_for_restart<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        self.quiesce_with_timeout(app, Duration::from_secs(15))
    }

    fn quiesce_with_timeout<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        timeout: Duration,
    ) -> Result<(), String> {
        let mut shutdown = self
            .shutdown
            .lock()
            .map_err(|_| "Pi shutdown lock poisoned")?;
        {
            let mut state = self.state.lock().map_err(|_| "SQLite lock poisoned")?;
            if state.terminal {
                // A failed later clean-close step retries the same terminal release.
                // Admission stays closed; there is no WebView owner left to acknowledge.
                return Ok(());
            }
            // Settings may request restart before chat has ever opened. Closing
            // admission here also prevents a concurrent first owner from racing it.
            if state.connection.is_none() && shutdown.pending.is_none() {
                state.accepting = false;
                return Ok(());
            }
        }
        if shutdown.pending.is_none() {
            shutdown.next += 1;
            // Sending this request may irreversibly close the mounted Harness.
            // Preserve the boundary even if delivery/acknowledgement is uncertain.
            shutdown.pending = Some(format!("pi-restart-{}", shutdown.next));
            shutdown.acknowledged = false;
        }
        let deadline = Instant::now() + timeout;
        while !shutdown.acknowledged {
            // Startup can open storage before its frontend listener is installed.
            // Re-deliver the same idempotent request until that owner acknowledges;
            // neither a lost event nor Retry Restart creates a new close attempt.
            let token = shutdown.pending.clone().expect("pending quiesce request");
            drop(shutdown);
            app.emit("pi-chat-quiesce", serde_json::json!({"token":token}))
                .map_err(|e| e.to_string())?;
            shutdown = self
                .shutdown
                .lock()
                .map_err(|_| "Pi shutdown lock poisoned")?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            if !shutdown.acknowledged && remaining.is_zero() {
                return Err("Pi did not finish checkpointing and stopping its tasks; restart remains blocked".into());
            }
            shutdown = self
                .shutdown_changed
                .wait_timeout_while(shutdown, remaining.min(QUIESCE_REDELIVERY), |state| {
                    !state.acknowledged
                })
                .map_err(|_| "Pi shutdown wait poisoned")?
                .0;
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
        let mut shutdown = self
            .shutdown
            .lock()
            .map_err(|_| "Pi shutdown lock poisoned")?;
        if shutdown.pending.is_some() {
            return Err(
                "Pi cannot resume after requesting frontend Harness close; retry restart".into(),
            );
        }
        {
            let mut state = self.state.lock().map_err(|_| "SQLite lock poisoned")?;
            if state.terminal {
                return Err("Pi storage cannot resume after terminal close".into());
            }
            state.accepting = true;
        }
        shutdown.pending = None;
        shutdown.acknowledged = false;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn open_for_test(&self, path: &std::path::Path) {
        self.perform(
            path,
            SqlRequest {
                action: "open".into(),
                owner: None,
                transaction: None,
                sql: None,
                params: vec![],
            },
        )
        .unwrap();
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
            let connection = state.connection.as_ref().unwrap();
            if !connection.is_autocommit() {
                connection
                    .execute_batch("ROLLBACK")
                    .map_err(|e| e.to_string())?;
            }
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .map_err(|e| e.to_string())?;
            state
                .connection
                .take()
                .unwrap()
                .close()
                .map_err(|(_, e)| e.to_string())?;
            state.owner += 1;
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
        connection.authorizer(Some(application_sql_authorizer));
        let guard = ApplicationSqlGuard(connection);
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
        drop(guard);
        if let Some((_, deadline)) = state.transaction.as_mut() {
            *deadline = Instant::now() + LEASE_TIME;
        }
        result
    }
}

#[tauri::command]
pub(crate) fn pi_chat_quiesced(
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
        let path = app
            .state::<crate::index::AppState>()
            .running_vault()
            .data_dir()
            .join("pi-chat.sqlite3");
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
        assert!(database.resume_after_failed_restart().is_err());
        assert!(database.acknowledge_quiesce("obsolete").is_err());
        database.acknowledge_quiesce("current").unwrap();
    }
    #[test]
    fn timed_out_frontend_close_retains_late_ack_and_retry_without_reopening_admission() {
        use tauri::Listener;
        let dir = crate::test_support::TestDir::new("pi-shutdown-late-ack");
        let database = NativeDatabase::default();
        database.open_for_test(&dir.path().join("pi.sqlite3"));
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = count.clone();
        app.listen_any("pi-chat-quiesce", move |_| {
            observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        assert!(database
            .quiesce_with_timeout(app.handle(), Duration::ZERO)
            .is_err());
        assert!(database.resume_after_failed_restart().is_err());
        // The mounted Harness can still checkpoint while its close is pending.
        assert!(database.state.lock().unwrap().accepting);
        let token = database.shutdown.lock().unwrap().pending.clone().unwrap();
        // Harness.close may remove its SQL connection before the IPC ack arrives.
        database.state.lock().unwrap().connection.take();
        assert!(database
            .quiesce_with_timeout(app.handle(), Duration::ZERO)
            .is_err());
        database.acknowledge_quiesce(&token).unwrap();
        database
            .quiesce_with_timeout(app.handle(), Duration::ZERO)
            .unwrap();
        assert!(!database.state.lock().unwrap().accepting);
        assert!(database.resume_after_failed_restart().is_err());
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 2);
        database.finish_restart_shutdown().unwrap();
        database
            .quiesce_with_timeout(app.handle(), Duration::ZERO)
            .unwrap();
    }
    #[test]
    fn startup_listener_can_join_an_already_requested_quiesce() {
        use tauri::Listener;
        let dir = crate::test_support::TestDir::new("pi-shutdown-startup-listener");
        let database = std::sync::Arc::new(NativeDatabase::default());
        database.open_for_test(&dir.path().join("pi.sqlite3"));
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        app.listen_any("pi-chat-quiesce", move |event| {
            sent.send(event.payload().to_string()).unwrap();
        });
        std::thread::scope(|scope| {
            let closing = database.clone();
            let handle = app.handle().clone();
            let close =
                scope.spawn(move || closing.quiesce_with_timeout(&handle, Duration::from_secs(2)));
            let first: Value =
                serde_json::from_str(&received.recv_timeout(Duration::from_secs(1)).unwrap())
                    .unwrap();
            let owner = database.clone();
            let token = first["token"].as_str().unwrap().to_string();
            app.listen_any("pi-chat-quiesce", move |event| {
                let request: Value = serde_json::from_str(event.payload()).unwrap();
                assert_eq!(request["token"], token);
                owner.acknowledge_quiesce(&token).unwrap();
            });
            close.join().unwrap().unwrap();
        });
        assert!(!database.state.lock().unwrap().accepting);
        assert!(database.resume_after_failed_restart().is_err());
        database.finish_restart_shutdown().unwrap();
    }
    #[test]
    fn unopened_frontend_admission_can_resume_before_any_close_request() {
        let database = NativeDatabase::default();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        database
            .quiesce_with_timeout(app.handle(), Duration::ZERO)
            .unwrap();
        assert!(!database.state.lock().unwrap().accepting);
        assert!(database.shutdown.lock().unwrap().pending.is_none());
        database.resume_after_failed_restart().unwrap();
        assert!(database.state.lock().unwrap().accepting);
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
    #[test]
    fn failed_commit_rolls_back_before_reopen_and_never_reports_success() {
        let dir = crate::test_support::TestDir::new("pi-commit-failure");
        let path = dir.path().join("pi.sqlite3");
        let db = NativeDatabase::default();
        let owner = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        db.perform(&path, request("exec", Some(owner), None, "CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);")).unwrap();
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
                "INSERT INTO child VALUES(404)",
            ),
        )
        .unwrap();
        assert!(db
            .perform(&path, request("commit", Some(owner), Some(tx), ""))
            .unwrap_err()
            .contains("FOREIGN KEY"));
        db.perform(&path, request("rollback", Some(owner), Some(tx), ""))
            .unwrap();
        db.perform(&path, request("close", Some(owner), None, ""))
            .unwrap();
        let fresh = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        assert_eq!(
            db.perform(
                &path,
                request("get", Some(fresh), None, "SELECT count(*) AS n FROM child")
            )
            .unwrap()["n"],
            0
        );
        assert_eq!(
            db.perform(
                &path,
                request("get", Some(fresh), None, "PRAGMA synchronous")
            )
            .unwrap()["synchronous"],
            2
        );
        db.perform(&path, request("close", Some(fresh), None, ""))
            .unwrap();
    }
    #[test]
    fn expired_lease_cannot_commit_and_close_reopens_only_durable_rows() {
        let dir = crate::test_support::TestDir::new("pi-expired-lease");
        let path = dir.path().join("pi.sqlite3");
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
                "CREATE TABLE effects(value TEXT)",
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
                "INSERT INTO effects VALUES('pending')",
            ),
        )
        .unwrap();
        db.state.lock().unwrap().transaction = Some((tx, Instant::now() - Duration::from_secs(1)));
        assert!(db
            .perform(&path, request("commit", Some(owner), Some(tx), ""))
            .unwrap_err()
            .contains("Expired"));
        db.perform(&path, request("close", Some(owner), None, ""))
            .unwrap();
        assert!(db
            .perform(
                &path,
                request(
                    "run",
                    Some(owner),
                    None,
                    "INSERT INTO effects VALUES('stale')"
                )
            )
            .is_err());
        let fresh = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        assert_eq!(
            db.perform(
                &path,
                request(
                    "get",
                    Some(fresh),
                    None,
                    "SELECT count(*) AS n FROM effects"
                )
            )
            .unwrap()["n"],
            0
        );
        db.perform(&path, request("close", Some(fresh), None, ""))
            .unwrap();
    }

    #[test]
    fn bridge_sql_cannot_attach_native_authority_or_bypass_durability_and_transactions() {
        let dir = crate::test_support::TestDir::new("pi-sql-isolation");
        let authority_path = dir.path().join("ai.sqlite3");
        let authority = Connection::open(&authority_path).unwrap();
        authority.execute_batch("CREATE TABLE pi_chat_authorities(secret TEXT); INSERT INTO pi_chat_authorities VALUES('private')").unwrap();
        let path = dir.path().join("pi.sqlite3");
        let db = NativeDatabase::default();
        let owner = db
            .perform(&path, request("open", None, None, ""))
            .unwrap()
            .as_u64()
            .unwrap();
        let attach = format!(
            "ATTACH DATABASE '{}' AS native",
            authority_path.to_string_lossy().replace('\'', "''")
        );
        assert!(db
            .perform(&path, request("exec", Some(owner), None, &attach))
            .is_err());
        assert!(db
            .perform(
                &path,
                request(
                    "get",
                    Some(owner),
                    None,
                    "SELECT * FROM native.pi_chat_authorities"
                )
            )
            .is_err());
        assert!(db
            .perform(
                &path,
                request(
                    "run",
                    Some(owner),
                    None,
                    "UPDATE native.pi_chat_authorities SET secret='changed'"
                )
            )
            .is_err());
        for bypass in [
            "PRAGMA synchronous=OFF",
            "PRAGMA journal_mode=OFF",
            "PRAGMA foreign_keys=OFF",
            "PRAGMA writable_schema=ON",
            "BEGIN",
            "SAVEPOINT sneaky",
        ] {
            assert!(
                db.perform(&path, request("exec", Some(owner), None, bypass))
                    .is_err(),
                "allowed {bypass}"
            );
        }
        db.perform(
            &path,
            request(
                "exec",
                Some(owner),
                None,
                "CREATE TABLE effects(value TEXT)",
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
                "INSERT INTO effects VALUES('uncommitted')",
            ),
        )
        .unwrap();
        assert!(db
            .perform(&path, request("exec", Some(owner), Some(tx), "COMMIT"))
            .is_err());
        db.perform(&path, request("rollback", Some(owner), Some(tx), ""))
            .unwrap();
        assert_eq!(
            db.perform(
                &path,
                request(
                    "get",
                    Some(owner),
                    None,
                    "SELECT count(*) AS n FROM effects"
                )
            )
            .unwrap()["n"],
            0
        );
        assert_eq!(
            authority
                .query_row("SELECT secret FROM pi_chat_authorities", [], |row| row
                    .get::<_, String>(
                    0
                ))
                .unwrap(),
            "private"
        );
        db.perform(&path, request("close", Some(owner), None, ""))
            .unwrap();
    }
}
