//! Application service helpers that sit beside command shims.
//!
//! Prefer keeping orchestration in command modules and domain code.
//! This module only holds shared workers that are not IPC entry points.

pub(crate) mod background_index_queue;
pub(crate) mod current_document;

pub(crate) use background_index_queue::BackgroundIndexQueue;
pub(crate) use current_document::{resolve_current_document, CurrentDocumentRequest};
