//! Application service helpers that sit beside command shims.
//!
//! Prefer keeping orchestration in command modules and domain code.
//! This module only holds shared workers that are not IPC entry points.

pub(crate) mod background_index_queue;
pub(crate) mod current_document;
pub(crate) mod note_catalog;
pub(crate) mod note_timeline;
pub(crate) mod retrieval;
pub(crate) mod task_mutation;

pub(crate) use background_index_queue::BackgroundIndexQueue;
pub(crate) use current_document::{resolve_current_document, CurrentDocumentRequest};
pub(crate) use note_catalog::NoteCatalog;
pub(crate) mod evidence;
