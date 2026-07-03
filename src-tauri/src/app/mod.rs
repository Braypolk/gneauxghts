//! Unified application infrastructure: typed event bus and shared read models.
//!
//! `AppData` is a Tauri-managed state object that exposes cross-cutting
//! infrastructure: a typed [`EventBus`] for domain events and a
//! [`NoteCatalog`] read-model facade over the in-memory notes index.
//!
//! `AppState` (notes index, lexical, semantic) remains Tauri-managed in its
//! own right so existing commands, tests, and the vault watcher can access it
//! via `State<'_, AppState>`. New service code prefers taking the explicit
//! pieces it needs through method parameters; the `AppData` aggregate is the
//! canonical place to hold infrastructure that doesn't already have a home.

pub(crate) mod catalog;
pub(crate) mod events;

pub(crate) use catalog::NoteCatalog;
pub(crate) use events::EventBus;

use tauri::AppHandle;

/// Tauri-managed state shared across services and command modules.
pub(crate) struct AppData {
    #[allow(dead_code)]
    pub(crate) catalog: NoteCatalog,
    pub(crate) events: EventBus,
}

impl AppData {
    pub(crate) fn new(app_handle: AppHandle) -> Self {
        Self {
            catalog: NoteCatalog::new(),
            events: EventBus::new(app_handle),
        }
    }
}
