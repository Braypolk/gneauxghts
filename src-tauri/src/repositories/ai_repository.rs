//! AI / inbox repository.
//!
//! Wraps `AiState` with a stable facade for service-layer code. The
//! underlying implementation in [`crate::ai`] continues to manage its
//! own SQLite connection (per-call) and background worker; this layer
//! keeps service code from reaching directly into AI internals so the
//! storage layer can later consolidate connection management without
//! disturbing callers.

use crate::ai::{AiSettings, AiState};
use std::sync::Arc;

pub(crate) const AI_SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct AiRepository {
    state: Arc<AiState>,
}

#[allow(dead_code)]
impl AiRepository {
    pub(crate) fn new(state: Arc<AiState>) -> Self {
        Self { state }
    }

    pub(crate) fn schema_version(&self) -> u32 {
        AI_SCHEMA_VERSION
    }

    pub(crate) fn public_settings(&self) -> Option<AiSettings> {
        self.state.load_public_settings().ok()
    }
}
