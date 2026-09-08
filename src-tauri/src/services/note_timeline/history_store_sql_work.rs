//! Test-only measurement of actual executed SQLite programs, including store
//! admission, indexed seeks and reconstruction. Never compiled into the app.
use rusqlite::{ffi, Connection};
use std::{cell::Cell, ffi::c_void};

#[derive(Clone, Copy, Default, Debug, serde::Serialize)]
pub(crate) struct Work {
    pub statements: u64,
    pub vm_steps: u64,
    pub fullscan_steps: u64,
    pub sorts: u64,
    pub derived_index_vm_steps: u64,
    pub derived_index_elapsed_ns: u64,
}
thread_local! { static WORK: Cell<Option<Work>> = const { Cell::new(None) }; }

pub(super) fn observe(connection: &Connection) {
    // The callback stores no connection/statement pointer. SQLite invokes it
    // synchronously with a live statement at PROFILE completion.
    unsafe {
        ffi::sqlite3_trace_v2(
            connection.handle(),
            ffi::SQLITE_TRACE_PROFILE as u32,
            Some(profile),
            std::ptr::null_mut(),
        );
    }
}
unsafe extern "C" fn profile(
    _: u32,
    _: *mut c_void,
    statement: *mut c_void,
    elapsed: *mut c_void,
) -> i32 {
    WORK.with(|cell| {
        if let Some(mut work) = cell.get() {
            let statement = statement.cast::<ffi::sqlite3_stmt>();
            work.statements += 1;
            let steps =
                ffi::sqlite3_stmt_status(statement, ffi::SQLITE_STMTSTATUS_VM_STEP, 1) as u64;
            work.vm_steps += steps;
            let sql = std::ffi::CStr::from_ptr(ffi::sqlite3_sql(statement)).to_string_lossy();
            if sql
                .trim_start()
                .starts_with("CREATE INDEX IF NOT EXISTS revisions_by_predecessor")
                || sql
                    .trim_start()
                    .starts_with("CREATE INDEX IF NOT EXISTS lifecycle_events_by_predecessor")
            {
                work.derived_index_vm_steps += steps;
                work.derived_index_elapsed_ns += *elapsed.cast::<u64>();
            }
            work.fullscan_steps +=
                ffi::sqlite3_stmt_status(statement, ffi::SQLITE_STMTSTATUS_FULLSCAN_STEP, 1) as u64;
            work.sorts +=
                ffi::sqlite3_stmt_status(statement, ffi::SQLITE_STMTSTATUS_SORT, 1) as u64;
            cell.set(Some(work));
        }
    });
    0
}
pub(crate) fn measure<T>(read: impl FnOnce() -> T) -> (T, Work) {
    WORK.with(|cell| {
        assert!(cell.get().is_none());
        cell.set(Some(Work::default()));
    });
    let result = read();
    let work = WORK.with(|cell| cell.take().unwrap());
    (result, work)
}

pub(crate) fn successor_plan(store: &super::Store) -> Vec<String> {
    let connection = super::open_store(store).unwrap();
    let mut query = connection
        .prepare(&format!("EXPLAIN QUERY PLAN {}", super::SUCCESSOR_QUERY))
        .unwrap();
    let plan = query
        .query_map(["note", "revision", "identity"], |row| row.get(3))
        .unwrap();
    plan.map(Result::unwrap).collect()
}

#[test]
fn successor_lookup_rejects_ambiguous_cross_kind_lineage() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE revisions (revision_id TEXT, note_id TEXT, predecessor_kind TEXT, predecessor_id TEXT);
        CREATE TABLE lifecycle_events (event_id TEXT, note_id TEXT, predecessor_kind TEXT, predecessor_id TEXT);
        CREATE INDEX revisions_by_predecessor ON revisions(note_id, predecessor_kind, predecessor_id);
        CREATE INDEX lifecycle_events_by_predecessor ON lifecycle_events(note_id, predecessor_kind, predecessor_id);
        INSERT INTO revisions VALUES ('next', 'note', 'revision', 'anchor');
        INSERT INTO lifecycle_events VALUES ('event', 'note', 'revision', 'anchor');").unwrap();
    let result = super::bounded_successor(
        &connection,
        &super::NoteIdentity::new("note"),
        &super::TimelineRecordIdentity::Revision(super::RevisionIdentity::from_persisted("anchor")),
    );
    assert!(matches!(result, Err(super::HistoryError::Corrupt(_))));
}

pub(crate) fn break_lifecycle_predecessor(store: &super::Store, note_id: &super::NoteIdentity) {
    super::open_store(store).unwrap().execute("UPDATE lifecycle_events SET predecessor_kind = 'revision', predecessor_id = 'missing' WHERE note_id = ?1", [note_id.as_str()]).unwrap();
}
