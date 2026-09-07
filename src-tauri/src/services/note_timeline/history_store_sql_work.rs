//! Test-only query-plan assertions and corruption helpers.
use rusqlite::Connection;

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
