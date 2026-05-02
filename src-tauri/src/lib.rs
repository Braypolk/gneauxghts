mod ai;
mod app;
mod commands;
mod index;
mod lexical;
mod note;
mod path_utils;
mod repositories;
mod search;
mod semantic;
mod services;
mod state;
#[cfg(test)]
mod test_support;
mod time;
mod vault_watcher;

use app::AppData;
use index::AppState;
use semantic::SemanticState;
use state::{initialize_app_data_dir, initialize_documents_dir, notes_root};
use std::path::PathBuf;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
            initialize_app_data_dir(app_data_dir.clone())?;
            if let Ok(documents_dir) = app.path().document_dir() {
                initialize_documents_dir(documents_dir)?;
            }

            let notes_dir = notes_root()?;
            let semantic = if cfg!(target_os = "ios") {
                SemanticState::new_disabled("Semantic search is disabled on iPhone builds for now.")
            } else {
                let bundled_runtime_path = bundled_llama_server_path(app.handle());
                SemanticState::new_with_runtime(app_data_dir, notes_dir, bundled_runtime_path)?
            };
            app.manage(AppState::new(semantic)?);
            app.manage(ai::AiState::new(app.handle().clone())?);
            // Break-the-app: one managed `AppData` carrying the typed event
            // bus and the `NoteCatalog` facade. Coexists with the
            // pre-existing `AppState`/`AiState` so existing commands keep
            // working while new code routes through services + events.
            app.manage(AppData::new(app.handle().clone()));
            app.manage(vault_watcher::start_vault_watcher(app.handle().clone())?);
            // Run the forgotten-note cleanup once at startup so we still purge
            // expired entries even though we no longer trigger it on every
            // save/open/list hot path.
            let _ = commands::startup_cleanup_expired_forgotten_notes();
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_app,
            commands::get_settings_view,
            commands::load_note_session,
            commands::open_note,
            commands::read_note,
            commands::get_vault_info,
            commands::asset_commands::read_image_asset_data_url,
            commands::asset_commands::store_pasted_image,
            commands::set_vault_directory,
            commands::wikilink_commands::resolve_note_link,
            commands::wikilink_commands::autocomplete_note_links,
            commands::save_note,
            commands::remember_note,
            ai::remember_with_mode,
            ai::remember_with_action,
            commands::forgotten_note_commands::forget_note,
            commands::forgotten_note_commands::list_forgotten_notes,
            commands::forgotten_note_commands::restore_forgotten_notes,
            commands::forgotten_note_commands::delete_forgotten_notes,
            commands::search_commands::list_recent_notes,
            commands::search_commands::list_recent_focus,
            commands::list_recent_tasks,
            commands::list_tasks,
            commands::set_note_collapsed,
            commands::set_note_hidden,
            commands::set_note_order,
            commands::set_task_hidden,
            commands::toggle_task,
            commands::delete_task,
            commands::search_commands::search_notes,
            commands::search_commands::search_notes_hybrid,
            commands::search_commands::get_related_notes,
            commands::graph_commands::get_graph_data_metadata,
            commands::graph_commands::get_graph_data,
            commands::graph_commands::save_graph_node_positions,
            commands::get_semantic_settings,
            commands::set_semantic_settings,
            commands::get_semantic_status,
            commands::get_semantic_debug_metrics,
            commands::clear_semantic_debug_metrics,
            commands::rebuild_semantic_index,
            commands::pause_semantic_indexing,
            commands::resume_semantic_indexing,
            commands::prepare_semantic_model,
            commands::download_semantic_embedding_model,
            ai::get_ai_settings,
            ai::set_ai_settings,
            ai::get_ai_diagnostics,
            ai::clear_ai_diagnostics,
            ai::list_ai_models,
            ai::list_inbox_items,
            ai::get_inbox_item,
            ai::approve_inbox_item,
            ai::approve_inbox_item_with_changes,
            ai::reject_inbox_item,
            ai::retry_inbox_item,
            ai::clear_inbox
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.semantic.shutdown();
            }
        }
    });
}

fn bundled_llama_server_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }

    let resource_dir = app.path().resource_dir().ok()?;
    let binary_name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let candidate = resource_dir.join("bin").join(binary_name);
    candidate.is_file().then_some(candidate)
}
