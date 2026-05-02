//! Semantic repository handle.
//!
//! Wraps `SemanticState` with a service-friendly facade: `queue_update`,
//! `queue_delete`, `status`, etc. The existing [`crate::semantic`]
//! module owns the heavy lifting (DB connection, HNSW index, worker
//! thread). This layer documents the boundary between domain code and
//! the semantic database without duplicating it.

use crate::semantic::{SemanticSettings, SemanticState, SemanticStatus};
use std::path::Path;
use std::sync::Arc;

pub(crate) const SEMANTIC_SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct SemanticRepository {
    state: Arc<SemanticState>,
}

#[allow(dead_code)]
impl SemanticRepository {
    pub(crate) fn new(state: Arc<SemanticState>) -> Self {
        Self { state }
    }

    pub(crate) fn schema_version(&self) -> u32 {
        SEMANTIC_SCHEMA_VERSION
    }

    pub(crate) fn status(&self) -> Result<SemanticStatus, String> {
        self.state.get_status()
    }

    pub(crate) fn settings(&self) -> Result<SemanticSettings, String> {
        self.state.get_settings()
    }

    pub(crate) fn queue_note_update(
        &self,
        path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String> {
        self.state
            .queue_note_update(path, markdown, modified_millis)
    }

    pub(crate) fn queue_delete_note(&self, path: &Path) -> Result<(), String> {
        self.state.queue_delete_note(path)
    }
}
