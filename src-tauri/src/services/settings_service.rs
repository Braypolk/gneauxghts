//! Settings application service.
//!
//! Owns vault info reads and the vault switching command. Settings mutations
//! emit [`crate::app::AppEvent::VaultChanged`] when the vault path changes
//! and [`crate::app::AppEvent::SemanticStatusChanged`] when the semantic
//! indexer status moves. The bundled settings payload lives in
//! [`crate::commands::get_settings_view`].

use crate::app::AppData;
use crate::index::AppState;
use crate::state::{
    current_vault_info, ensure_vault_scaffold, set_notes_root, vault_root, VaultInfo,
};
use std::path::Path;
use tauri::State;

pub(crate) struct SettingsService;

impl SettingsService {
    pub(crate) fn new() -> Self {
        Self
    }

    pub(crate) fn vault_info(&self) -> Result<VaultInfo, String> {
        current_vault_info()
    }

    pub(crate) fn set_vault(
        &self,
        app_data: &AppData,
        app_state: &State<'_, AppState>,
        path: Option<String>,
    ) -> Result<VaultInfo, String> {
        let info = match path.as_deref().map(str::trim) {
            Some("") | None => set_notes_root(None),
            Some(raw) => set_notes_root(Some(Path::new(raw))),
        }?;
        // Scaffold the newly-selected vault's `.gneauxghts` data/cache dirs
        // and manifest up front so that, on the next launch, opening this
        // vault finds a clean, initialized layout. Vault-local DBs and the
        // HNSW cache still initialize lazily on that launch; live switching
        // is intentionally deferred (globals, DB handles, and the watcher
        // are bound once at startup), so `VaultInfo.requires_restart`
        // remains true and the UI prompts for a restart. Best-effort: a
        // scaffold failure here must not block recording the new path.
        if let Ok(new_root) = vault_root() {
            let _ = ensure_vault_scaffold(&new_root);
        }
        if let Ok(status) = app_state.semantic.get_status() {
            app_data.events.semantic_status_changed(status);
        }
        app_data.events.vault_changed(info.clone());
        Ok(info)
    }
}
