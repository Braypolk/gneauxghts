//! Infrastructure / persistence repositories.
//!
//! Each repository owns the boundary between the in-process domain types
//! and a specific external resource:
//!
//! - [`vault_repository`]: markdown files on disk in the user's vault.
//! - [`ui_state_repository`]: `app-state.sqlite3` (recents, hidden lists,
//!   collapsed sets, task timestamps, forgotten notes).
//! - [`semantic_repository`]: `semantic.sqlite3` and the HNSW sidecar.
//! - [`ai_repository`]: `ai.sqlite3` (inbox, AI job queue, AI settings).
//!
//! These modules deliberately re-export the existing low-level helpers
//! rather than rewriting the storage code from scratch, with one
//! addition: a small `schema_version` helper per repository so we have a
//! place to evolve the on-disk layout in the future. Keeping the
//! existing files (`state/persistence.rs`, `semantic/db.rs`,
//! `ai/store.rs`) intact preserves migration safety: the on-disk schema
//! is unchanged and existing user vaults open without conversion.

pub(crate) mod ai_repository;
pub(crate) mod connection;
pub(crate) mod semantic_repository;
pub(crate) mod ui_state_repository;
pub(crate) mod vault_repository;

#[allow(unused_imports)]
pub(crate) use ai_repository::AiRepository;
#[allow(unused_imports)]
pub(crate) use semantic_repository::SemanticRepository;
#[allow(unused_imports)]
pub(crate) use ui_state_repository::UiStateRepository;
#[allow(unused_imports)]
pub(crate) use vault_repository::VaultRepository;
