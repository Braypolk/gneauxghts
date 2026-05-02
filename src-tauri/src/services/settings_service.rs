//! Settings application service.
//!
//! Owns the cross-cutting "give me the current settings view" use case
//! (vault info + semantic status/settings + AI settings) and the vault
//! switching command. Settings mutations emit
//! [`crate::app::AppEvent::VaultChanged`] when the vault path changes
//! and [`crate::app::AppEvent::SemanticStatusChanged`] when the semantic
//! indexer status moves.

use crate::ai::AiSettings;
use crate::ai::AiState;
use crate::app::AppData;
use crate::index::AppState;
use crate::semantic::{debug::SemanticDebugSnapshot, SemanticSettings, SemanticStatus};
use crate::state::{current_vault_info, set_notes_root, VaultInfo};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[allow(dead_code)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsView {
    pub vault: VaultInfo,
    pub semantic_status: SemanticStatus,
    pub semantic_settings: SemanticSettings,
    pub semantic_debug: SemanticDebugSnapshot,
    pub ai_settings: Option<AiSettings>,
}

pub(crate) struct SettingsService;

impl SettingsService {
    pub(crate) fn new() -> Self {
        Self
    }

    pub(crate) fn vault_info(&self) -> Result<VaultInfo, String> {
        current_vault_info()
    }

    #[allow(dead_code)]
    pub(crate) fn settings_view(
        &self,
        app_state: &State<'_, AppState>,
        ai: &State<'_, AiState>,
    ) -> Result<SettingsView, String> {
        Ok(SettingsView {
            vault: current_vault_info()?,
            semantic_status: app_state.semantic.get_status()?,
            semantic_settings: app_state.semantic.get_settings()?,
            semantic_debug: app_state.semantic.debug_snapshot()?,
            ai_settings: ai.load_public_settings().ok(),
        })
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
        if let Ok(status) = app_state.semantic.get_status() {
            app_data.events.semantic_status_changed(status);
        }
        app_data.events.vault_changed(info.clone());
        Ok(info)
    }
}
