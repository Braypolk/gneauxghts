//! Application service layer.
//!
//! Services sit between thin Tauri command shims (in
//! [`crate::commands`]) and the lower-level domain/infrastructure
//! modules. Each service exposes a small surface focused on a single use
//! case and routes through the relevant repositories. Services are
//! stateless structs; they take the pieces they need (state references,
//! event bus) as method parameters or borrow them from
//! [`crate::app::AppData`].

pub(crate) mod note_service;
pub(crate) mod search_service;
pub(crate) mod settings_service;
pub(crate) mod task_service;

pub(crate) use note_service::NoteService;
#[allow(unused_imports)]
pub(crate) use search_service::SearchService;
pub(crate) use settings_service::SettingsService;
pub(crate) use task_service::TaskService;
