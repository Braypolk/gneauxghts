//! Shared disposable schema setup; adapter-specific seeds remain with their tests.
use rusqlite::Connection;
use std::path::Path;

pub(super) fn database(path: &Path) -> Connection {
    let connection = super::db::open_database(path).expect("open semantic test database");
    initialize(connection)
}

pub(super) fn memory_database() -> Connection {
    initialize(Connection::open_in_memory().expect("open in-memory semantic test database"))
}

fn initialize(connection: Connection) -> Connection {
    super::db::ensure_schema(&connection).expect("initialize semantic test schema");
    connection
}
