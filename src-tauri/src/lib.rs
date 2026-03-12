mod commands;
mod index;
mod semantic;
mod search;
mod state;

use index::AppState;
use semantic::SemanticState;
use state::notes_root;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| err.to_string())?;
            let notes_dir = notes_root()?;
            let semantic = SemanticState::new(app_data_dir, notes_dir)?;
            app.manage(AppState::new(semantic));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_note_session,
            commands::open_note,
            commands::save_note,
            commands::remember_note,
            commands::forget_note,
            commands::list_recent_notes,
            commands::list_recent_tasks,
            commands::list_tasks,
            commands::set_note_collapsed,
            commands::set_note_hidden,
            commands::set_note_order,
            commands::set_task_hidden,
            commands::toggle_task,
            commands::search_notes,
            commands::search_notes_hybrid,
            commands::get_related_notes,
            commands::get_semantic_settings,
            commands::set_semantic_settings,
            commands::get_semantic_status,
            commands::rebuild_semantic_index,
            commands::pause_semantic_indexing,
            commands::resume_semantic_indexing,
            commands::get_map_graph
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
