mod commands;
mod index;
mod search;
mod state;

use index::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
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
            commands::search_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
