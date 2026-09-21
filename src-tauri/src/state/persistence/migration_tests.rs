use super::*;
use std::{cell::RefCell, sync::mpsc, thread, time::Duration};

thread_local! {
    static AFTER_MISSING_COLUMN: RefCell<Option<Box<dyn FnOnce()>>> = RefCell::new(None);
    static CONTENDER_PROGRESS: RefCell<Option<mpsc::Sender<()>>> = RefCell::new(None);
}

pub(super) fn after_missing_chat_column() {
    AFTER_MISSING_COLUMN.with(|hook| {
        if let Some(hook) = hook.borrow_mut().take() {
            hook();
        }
    });
}

fn report_contention(attempt: i32) -> bool {
    CONTENDER_PROGRESS.with(|sender| {
        if let Some(sender) = sender.borrow_mut().take() {
            let _ = sender.send(());
        }
    });
    thread::sleep(Duration::from_millis(1));
    attempt < 5_000
}

#[test]
fn concurrent_initializers_preserve_legacy_state() {
    let _guard = crate::test_support::lock_test_env();
    let temp = crate::test_support::TestDir::new("concurrent-state-migration");
    let database = temp.path().join(APP_STATE_DB_FILE_NAME);
    Connection::open(&database)
        .unwrap()
        .execute_batch(
            "CREATE TABLE app_state (id INTEGER PRIMARY KEY, last_opened_note_id TEXT);
             INSERT INTO app_state VALUES (1, 'existing-note');",
        )
        .unwrap();

    let (checked, checked_rx) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let directory = temp.path().to_path_buf();
    let first = thread::spawn(move || {
        AFTER_MISSING_COLUMN.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                checked.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            }));
        });
        // Exercise the running-vault storage constructor, not a test-only lock.
        AppStateStorage::bind(&directory)
    });
    checked_rx.recv_timeout(Duration::from_secs(10)).unwrap();

    let (progress, progress_rx) = mpsc::channel();
    let second = thread::spawn(move || {
        let mut connection = Connection::open(database).unwrap();
        CONTENDER_PROGRESS.with(|sender| *sender.borrow_mut() = Some(progress.clone()));
        connection.busy_handler(Some(report_contention)).unwrap();
        let result = ensure_state_schema(&mut connection);
        // Before the fix this initializer completes while the first is paused.
        // With the fix SQLite reports write contention instead. Either event
        // releases the first initializer; ordering never depends on a sleep.
        let _ = progress.send(());
        result
    });
    let progress = progress_rx.recv_timeout(Duration::from_secs(10));
    let _ = release.send(());
    let first = first.join().unwrap();
    let second = second.join().unwrap();
    progress.expect("contender reaches SQLite or completes");
    let storage = first.unwrap_or_else(|error| panic!("first initializer failed: {error}"));
    second.expect("second initializer succeeds");
    storage
        .with(|connection| {
            ensure_state_schema(connection)?;
            let persisted: (String, u32) = connection
                .query_row(
                    "SELECT last_opened_note_id, forgotten_note_retention_days FROM app_state WHERE id = 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(persisted, ("existing-note".into(), 7));
            for column in ["last_chat_conversation_id", "last_chat_context_note_id", "last_chat_context_note_path"] {
                assert!(has_column(connection, "app_state", column)?);
            }
            Ok(())
        })
        .unwrap();
}

#[test]
fn failed_migration_rolls_back_bootstrap_and_preserves_legacy_data() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE legacy_activity (note_id TEXT, last_viewed_at_millis INTEGER);
         INSERT INTO legacy_activity VALUES ('existing-note', 42);
         CREATE VIEW app_state_note_activity AS SELECT * FROM legacy_activity;",
        )
        .unwrap();
    assert!(
        ensure_state_schema(&mut connection).is_err(),
        "a view cannot be migrated with ALTER TABLE"
    );
    let created: u32 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'app_state'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        created, 0,
        "failed initialization must not leave a partial schema"
    );
    let existing: String = connection
        .query_row(
            "SELECT note_id FROM legacy_activity WHERE last_viewed_at_millis = 42",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(existing, "existing-note");
}
