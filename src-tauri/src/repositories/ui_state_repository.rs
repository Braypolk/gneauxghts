//! UI / app-state repository.
//!
//! Owns reads and writes against `app-state.sqlite3` (recents, hidden
//! lists, collapsed sets, task timestamps, forgotten-note metadata).
//! Delegates to the existing helpers in [`crate::state::persistence`]
//! which already implement row-scoped writes (Phase 1) so this layer
//! keeps the storage decisions intact while making the boundary
//! explicit.

use crate::state::{
    db_set_hidden_task_key, db_set_last_opened_note_id, db_set_note_collapsed, db_set_note_hidden,
    db_set_note_order, db_set_recent_note_ids, db_upsert_task_timestamp, read_state, write_state,
    PersistedState, PersistedTaskTimestamps,
};
use std::path::Path;

pub(crate) const UI_STATE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct UiStateRepository;

#[allow(dead_code)]
impl UiStateRepository {
    pub(crate) fn new() -> Self {
        Self
    }

    pub(crate) fn schema_version(&self) -> u32 {
        UI_STATE_SCHEMA_VERSION
    }

    pub(crate) fn read(&self, notes_dir: &Path) -> Result<PersistedState, String> {
        read_state(notes_dir)
    }

    pub(crate) fn write(&self, notes_dir: &Path, state: &PersistedState) -> Result<(), String> {
        write_state(notes_dir, state)
    }

    pub(crate) fn set_last_opened_note_id(&self, note_id: Option<&str>) -> Result<(), String> {
        db_set_last_opened_note_id(note_id)
    }

    pub(crate) fn set_recent_note_ids(&self, ids: &[String]) -> Result<(), String> {
        db_set_recent_note_ids(ids)
    }

    pub(crate) fn set_hidden_task_key(&self, key: &str, hidden: bool) -> Result<(), String> {
        db_set_hidden_task_key(key, hidden)
    }

    pub(crate) fn set_note_hidden(&self, note_id: &str, hidden: bool) -> Result<(), String> {
        db_set_note_hidden(note_id, hidden)
    }

    pub(crate) fn set_note_collapsed(&self, note_id: &str, collapsed: bool) -> Result<(), String> {
        db_set_note_collapsed(note_id, collapsed)
    }

    pub(crate) fn set_note_order(&self, ids: &[String]) -> Result<(), String> {
        db_set_note_order(ids)
    }

    pub(crate) fn upsert_task_timestamp(
        &self,
        key: &str,
        stamps: &PersistedTaskTimestamps,
    ) -> Result<(), String> {
        db_upsert_task_timestamp(key, stamps)
    }
}
