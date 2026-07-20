//! Typed domain event bus.
//!
//! [`EventBus`] lives on [`crate::index::AppState`] so commands, the vault
//! watcher, and other backend code share one managed root for runtime state
//! and event emission.

pub(crate) mod events;

pub(crate) use events::EventBus;
