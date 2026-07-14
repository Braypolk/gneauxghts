use super::{prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE};
use crate::{
    index::AppState,
    semantic::atlas::{
        AtlasChatVisibilityKey, AtlasGenerationKey, AtlasSearchResponse, VaultAtlasResponse,
    },
    state::db_load_note_activity,
};
use tauri::State;

type AtlasChatVisibility = AtlasChatVisibilityKey;

#[tauri::command]
pub(crate) async fn get_vault_atlas(
    state: State<'_, AppState>,
    chat_visibility: Option<AtlasChatVisibility>,
) -> Result<VaultAtlasResponse, String> {
    let chat_visibility = chat_visibility.unwrap_or_default();
    let generation_key = AtlasGenerationKey { chat_visibility };
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "get_vault_atlas",
    )?;
    let activity_by_note_id = db_load_note_activity()?;
    let semantic = state.semantic.clone();

    tauri::async_runtime::spawn_blocking(move || {
        semantic.vault_atlas(generation_key, activity_by_note_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) fn clear_atlas_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.semantic.clear_atlas_cache()
}

#[tauri::command]
pub(crate) async fn search_vault_atlas(
    state: State<'_, AppState>,
    query: String,
    chat_visibility: Option<AtlasChatVisibility>,
) -> Result<AtlasSearchResponse, String> {
    let chat_visibility = chat_visibility.unwrap_or_default();
    let generation_key = AtlasGenerationKey { chat_visibility };
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "search_vault_atlas",
    )?;

    let activity_by_note_id = db_load_note_activity()?;
    let semantic = state.semantic.clone();

    tauri::async_runtime::spawn_blocking(move || {
        semantic.search_vault_atlas(generation_key, query, activity_by_note_id)
    })
    .await
    .map_err(|err| err.to_string())?
}
