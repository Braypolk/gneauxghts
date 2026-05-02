//! Vault repository: markdown files on disk.
//!
//! The vault is the source of truth for note content. This repository
//! exposes a small surface for reading/writing notes via the existing
//! `state::persistence` helpers, which already enforce path validation,
//! frontmatter ID stamping, and rename-on-title-change behaviour.

use crate::state::{persist_note, resolve_note_id_from_path, resolve_note_path_by_id};
use std::path::{Path, PathBuf};

/// Schema version for vault-on-disk conventions (frontmatter shape,
/// note id encoding, etc.). Bump when the on-disk markdown format
/// changes in a way that needs migration.
pub(crate) const VAULT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct VaultRepository;

#[allow(dead_code)]
impl VaultRepository {
    pub(crate) fn new() -> Self {
        Self
    }

    pub(crate) fn schema_version(&self) -> u32 {
        VAULT_SCHEMA_VERSION
    }

    /// Persist a note to the vault. Delegates to the existing
    /// `state::persist_note` which handles renames and frontmatter.
    pub(crate) fn write_note(
        &self,
        notes_dir: &Path,
        title: &str,
        markdown: &str,
        current_path: Option<&Path>,
    ) -> Result<Option<String>, String> {
        persist_note(notes_dir, title, markdown, current_path)
    }

    /// Resolve a note id back to its path by scanning disk (cold path).
    /// Hot-path callers should use the in-memory `NoteCatalog` first.
    pub(crate) fn resolve_id_to_path(
        &self,
        notes_dir: &Path,
        note_id: &str,
    ) -> Result<Option<PathBuf>, String> {
        resolve_note_path_by_id(notes_dir, note_id)
    }

    /// Read the canonical note id from a path (parses frontmatter).
    pub(crate) fn id_from_path(&self, path: &Path) -> Result<String, String> {
        resolve_note_id_from_path(path)
    }
}
