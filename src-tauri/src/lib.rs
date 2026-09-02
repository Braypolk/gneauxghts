mod agent_guardrails;
mod agent_permissions;
mod agent_run_coordinator;
mod agent_runtime;
mod agent_tools;
mod app;
mod chat;
mod commands;
mod index;
mod lexical;
mod note;
mod path_utils;
mod proposals;
mod search;
mod secrets;
mod semantic;
mod services;
mod state;
#[cfg(test)]
mod test_support;
mod time;
mod vault_watcher;

use app::EventBus;
use chat::ChatService;
use index::AppState;
use semantic::SemanticState;
use services::note_timeline::NoteTimeline;
use state::{
    initialize_app_data_dir, initialize_documents_dir, notes_root, set_notes_root_override,
};
#[cfg(feature = "e2e-wdio")]
use std::ffi::OsString;
use std::{path::PathBuf, thread};
use tauri::{Manager, RunEvent};
#[cfg(target_os = "ios")]
use tauri_plugin_keyring_store::WriteAccessibility;
#[cfg(desktop)]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[cfg(desktop)]
fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

#[derive(Clone, Default)]
struct StartupPathOverrides {
    app_data_dir: Option<PathBuf>,
    documents_dir: Option<PathBuf>,
    notes_root: Option<PathBuf>,
}

#[cfg(feature = "e2e-wdio")]
fn e2e_path_argument(args: &[OsString], flag: &str) -> Result<Option<PathBuf>, String> {
    let Some(index) = args.iter().position(|argument| argument == flag) else {
        return Ok(None);
    };
    let raw_path = args
        .get(index + 1)
        .ok_or_else(|| format!("Missing path after {flag}"))?;
    let path = PathBuf::from(raw_path);
    if !path.is_absolute() {
        return Err(format!("{flag} must be an absolute path"));
    }
    Ok(Some(path))
}

fn startup_path_overrides() -> Result<StartupPathOverrides, String> {
    #[cfg(feature = "e2e-wdio")]
    {
        let args = std::env::args_os().collect::<Vec<_>>();
        return Ok(StartupPathOverrides {
            app_data_dir: e2e_path_argument(&args, "--e2e-app-data-root")?,
            documents_dir: e2e_path_argument(&args, "--e2e-documents-root")?,
            notes_root: e2e_path_argument(&args, "--e2e-vault-root")?,
        });
    }

    #[cfg(not(feature = "e2e-wdio"))]
    Ok(StartupPathOverrides::default())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_paths =
        startup_path_overrides().expect("invalid debug-only E2E path configuration");
    let keyring_plugin =
        tauri_plugin_keyring_store::Builder::new().service(secrets::keyring_service());
    #[cfg(target_os = "ios")]
    let keyring_plugin =
        keyring_plugin.ios_write_accessibility(WriteAccessibility::WhenUnlockedThisDeviceOnly);

    // Register before `setup` so configured windows are observed when Tauri
    // creates them. Registering dynamically inside `setup` is too late for the
    // initial window's ready event and leaves the plugin cache empty.
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(window_state_flags())
            .build(),
    );
    // The WebDriver surface is deliberately feature-gated so release builds do
    // not expose test execution or an embedded automation server.
    #[cfg(feature = "e2e-wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .setup(move |app| {
            if let Some(notes_root) = startup_paths.notes_root.clone() {
                set_notes_root_override(Some(notes_root))?;
            }
            let app_data_dir = match startup_paths.app_data_dir.clone() {
                Some(path) => path,
                None => app.path().app_data_dir().map_err(|err| err.to_string())?,
            };
            initialize_app_data_dir(app_data_dir.clone())?;
            if let Some(documents_dir) = startup_paths.documents_dir.clone() {
                initialize_documents_dir(documents_dir)?;
            } else if let Ok(documents_dir) = app.path().document_dir() {
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
                    vault_data_dir.clone(),
                    notes_dir.clone(),
                    bundled_runtime_path,
                )?
            };
            app.manage(AppState::new(
                semantic,
                EventBus::new(app.handle().clone()),
            )?);
            let chat_service =
                ChatService::new_managed(notes_dir, vault_data_dir, app.handle().clone())?;
            if let Some(state) = app.try_state::<AppState>() {
                chat_service.reconcile_semantic_recall(&state.semantic)?;
            }
            app.manage(chat_service);
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
                    if let Some(state) = watcher_handle.try_state::<AppState>() {
                        if let Err(error) =
                            commands::startup_cleanup_expired_forgotten_notes(&state)
                        {
                            eprintln!("forgotten-note startup cleanup failed: {error}");
                        }
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
                                if let Err(error) =
                                    NoteTimeline::new(&state).initialize_existing_notes(&notes_dir)
                                {
                                    eprintln!("Baseline Revision initialization failed: {error}");
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
        .plugin(keyring_plugin.build())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_app,
            commands::get_settings_view,
            commands::load_note_session,
            commands::open_note,
            commands::read_note,
            commands::get_vault_info,
            commands::list_vault_folders,
            commands::create_vault_folder,
            commands::asset_commands::read_image_asset_data_url,
            commands::asset_commands::store_pasted_image,
            commands::set_vault_directory,
            commands::wikilink_commands::resolve_note_link,
            commands::wikilink_commands::autocomplete_note_links,
            commands::save_note,
            commands::save_task_note,
            commands::mark_note_opened,
            commands::clear_last_opened_note,
            commands::forgotten_note_commands::forget_note,
            commands::forgotten_note_commands::list_forgotten_notes,
            commands::forgotten_note_commands::restore_forgotten_notes,
            commands::forgotten_note_commands::delete_forgotten_notes,
            commands::search_commands::list_recent_notes,
            commands::search_commands::list_recent_focus,
            commands::search_commands::get_last_chat_location,
            commands::search_commands::set_last_chat_location,
            commands::search_commands::set_note_pinned,
            commands::list_recent_tasks,
            commands::list_tasks,
            commands::get_task_group,
            commands::set_note_collapsed,
            commands::set_note_hidden,
            commands::set_note_order,
            commands::set_task_hidden,
            commands::toggle_task,
            commands::delete_task,
            commands::task_commands::prepare_task_document_mutation,
            commands::search_commands::search_notes_hybrid,
            commands::search_commands::get_related_notes,
            commands::search_commands::retrieve_note_context,
            commands::atlas_commands::get_vault_atlas,
            commands::atlas_commands::search_vault_atlas,
            commands::atlas_commands::clear_atlas_cache,
            commands::chat_commands::chat_get_settings,
            commands::chat_commands::chat_set_settings,
            commands::chat_commands::chat_get_composer_draft,
            commands::chat_commands::chat_set_composer_draft,
            commands::chat_commands::chat_get_key_status,
            commands::chat_commands::chat_set_api_key,
            commands::chat_commands::chat_create_conversation,
            commands::chat_commands::chat_list_conversations,
            commands::chat_commands::chat_get_conversation,
            commands::chat_commands::chat_branch_from_message,
            commands::chat_commands::chat_find_conversation_by_projection_path,
            commands::chat_commands::chat_rename_conversation,
            commands::chat_commands::chat_archive_conversation,
            commands::chat_commands::chat_update_conversation_policy,
            commands::chat_commands::chat_update_conversation_provider,
            commands::chat_commands::chat_list_local_models,
            commands::chat_commands::chat_list_openai_models,
            commands::chat_commands::chat_get_model_capabilities,
            commands::chat_commands::chat_set_local_model_capabilities,
            commands::chat_commands::chat_set_note_excluded,
            commands::chat_commands::chat_list_note_policies,
            commands::chat_commands::chat_search_notes,
            commands::chat_commands::chat_suggest_context,
            commands::chat_commands::chat_list_pending_proposals,
            commands::chat_commands::chat_send_message,
            commands::chat_commands::chat_cancel_request,
            commands::chat_commands::chat_decide_permission,
            commands::chat_commands::chat_retry_message,
            commands::chat_commands::chat_create_excerpt,
            commands::chat_commands::chat_remember_excerpt,
            commands::chat_commands::chat_unremember_excerpt,
            commands::chat_commands::chat_list_grants,
            commands::chat_commands::chat_grant_note,
            commands::chat_commands::chat_revoke_note,
            commands::chat_commands::chat_resolve_projection_conflict,
            commands::proposal_commands::commit_agent_proposal,
            commands::proposal_commands::dismiss_agent_proposal,
            commands::get_semantic_settings,
            commands::set_semantic_settings,
            commands::get_semantic_status,
            commands::report_user_activity,
            commands::get_semantic_debug_metrics,
            commands::clear_semantic_debug_metrics,
            commands::rebuild_semantic_index,
            commands::retry_semantic_index,
            commands::pause_semantic_indexing,
            commands::resume_semantic_indexing,
            commands::prepare_semantic_model,
            commands::download_semantic_embedding_model
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // Persist while the window still exists. This also covers the macOS
        // close-window path, which does not necessarily terminate the app.
        #[cfg(desktop)]
        if matches!(
            &event,
            RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } | RunEvent::ExitRequested { .. }
        ) {
            if let Err(error) = app_handle.save_window_state(window_state_flags()) {
                eprintln!("window-state save failed: {error}");
            }
        }

        if matches!(&event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
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
