mod app;
mod commands;
mod index;
mod lexical;
mod note;
mod path_utils;
mod proposals;
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
use std::{path::PathBuf, thread};
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
            // Scaffold the portable vault data dir (`<vault>/.gneauxghts`),
            // its cache dir, and the vault manifest before any vault-local
            // DB or cache is opened. Idempotent and cheap; safe to run on
            // every launch.
            state::ensure_vault_scaffold(&notes_dir)?;
            let vault_data_dir = state::vault_data_dir()?;
            let semantic = if cfg!(target_os = "ios") {
                SemanticState::new_disabled("Semantic search is disabled on iPhone builds for now.")
            } else {
                let bundled_runtime_path = bundled_llama_server_path(app.handle());
                SemanticState::new_with_runtime(
                    app_data_dir,
                    vault_data_dir,
                    notes_dir,
                    bundled_runtime_path,
                )?
            };
            app.manage(AppState::new(semantic)?);
            // One managed `AppData` carrying the typed event bus and
            // `NoteCatalog` facade.
            app.manage(AppData::new(app.handle().clone()));
            // Vault watcher registration walks the notes directory tree
            // recursively; on large vaults that adds noticeable latency to
            // the Tauri `setup` callback before first paint. Move the
            // registration plus the one-shot forgotten-note cleanup onto a
            // background thread so the window can paint immediately. The
            // watcher feeds `AppState` via `try_state`, so it is safe to
            // attach after setup returns; events that arrive before the
            // watcher is mounted simply trigger the existing periodic
            // reconciliation pass.
            let watcher_handle = app.handle().clone();
            let _ = thread::Builder::new()
                .name("vault-watcher-startup".to_string())
                .spawn(move || {
                    match vault_watcher::start_vault_watcher(watcher_handle.clone()) {
                        Ok(handle) => {
                            watcher_handle.manage(handle);
                        }
                        Err(error) => {
                            eprintln!("vault watcher startup failed: {error}");
                        }
                    }
                    if let Err(error) = commands::startup_cleanup_expired_forgotten_notes() {
                        eprintln!("forgotten-note startup cleanup failed: {error}");
                    }
                    // Prewarm the in-memory `notes_index` so the first
                    // user-driven `open_note` (and the autosave it triggers
                    // on the previously-active note) does not pay the
                    // cold-start vault-walk cost inside
                    // `prune_state_in_place`. With a warm index, prune
                    // resolves note ids via O(1) hashmap lookups instead
                    // of walking the entire vault per id. Runs after the
                    // watcher is mounted so any concurrent watcher events
                    // are already feeding the dirty-path queue.
                    //
                    // Use the lightweight prewarm — it populates the
                    // in-memory map with one brief lock swap and offloads
                    // the heavy lexical/SQLite-projection writes to the
                    // background queue, so foreground note switches in
                    // the first seconds after launch do not contend on
                    // the global SQLite state mutex.
                    if let Some(state) = watcher_handle.try_state::<AppState>() {
                        if let Ok(notes_dir) = notes_root() {
                            if notes_dir.exists() {
                                if let Err(error) = state.prewarm_notes_index(&notes_dir) {
                                    eprintln!("notes-index prewarm failed: {error}");
                                }
                            }
                        }
                    }
                });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
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
            commands::forgotten_note_commands::forget_note,
            commands::forgotten_note_commands::list_forgotten_notes,
            commands::forgotten_note_commands::restore_forgotten_notes,
            commands::forgotten_note_commands::delete_forgotten_notes,
            commands::search_commands::list_recent_notes,
            commands::search_commands::list_recent_focus,
            commands::list_recent_tasks,
            commands::list_tasks,
            commands::get_task_group,
            commands::set_note_collapsed,
            commands::set_note_hidden,
            commands::set_note_order,
            commands::set_task_hidden,
            commands::toggle_task,
            commands::delete_task,
            commands::search_commands::search_notes_hybrid,
            commands::search_commands::get_related_notes,
            commands::search_commands::retrieve_note_context,
            commands::atlas_commands::get_vault_atlas,
            commands::atlas_commands::search_vault_atlas,
            commands::atlas_commands::clear_atlas_cache,
            commands::proposal_commands::apply_note_change_proposal,
            commands::get_semantic_settings,
            commands::set_semantic_settings,
            commands::get_semantic_status,
            commands::get_semantic_debug_metrics,
            commands::clear_semantic_debug_metrics,
            commands::rebuild_semantic_index,
            commands::pause_semantic_indexing,
            commands::resume_semantic_indexing,
            commands::prepare_semantic_model,
            commands::download_semantic_embedding_model
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
