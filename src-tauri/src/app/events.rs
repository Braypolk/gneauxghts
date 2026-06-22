//! Typed domain event bus.
//!
//! Replaces the previous pattern of scattered `app_handle.emit("...string...", ...)`
//! calls with a single enum that owns the event names and payloads. The
//! `EventBus` is held inside [`super::AppData`] so commands and services
//! reach it through one place. The frontend continues to listen on the
//! original event channel names (e.g. `vault-note-changed`) so the contract
//! across IPC is preserved.

use crate::semantic::SemanticStatus;
use crate::state::VaultInfo;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter};

pub(crate) const VAULT_NOTE_CHANGED_EVENT: &str = "vault-note-changed";
pub(crate) const SEMANTIC_STATUS_CHANGED_EVENT: &str = "semantic-status-changed";
pub(crate) const INBOX_CHANGED_EVENT: &str = "inbox-changed";
pub(crate) const NOTE_SAVED_EVENT: &str = "note-saved";
pub(crate) const VAULT_CHANGED_EVENT: &str = "vault-changed";

/// Stable channel identifier each `AppEvent` is emitted on. Returning the
/// channel name from the enum keeps the wire-level contract close to the
/// type definition rather than scattered through call sites.
#[derive(Clone, Copy, Debug)]
pub(crate) struct EventChannel(pub &'static str);

/// Domain events emitted by the backend.
///
/// The variants intentionally mirror the names from the architecture target
/// so downstream code can pattern-match on intent. A few existing events
/// (`InboxChanged`, `SemanticStatusChanged`, `VaultNoteChanged`) preserve
/// the exact channel name and payload shape the frontend already listens
/// to; new events (`NoteSaved`, `VaultChanged`) are
/// additive and do not require frontend changes to ship.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum AppEvent {
    /// External (non-self) note change observed by the vault watcher.
    VaultNoteChanged {
        note_path: String,
        deleted: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    /// Semantic indexer status snapshot (count of indexed notes, queue
    /// depth, etc.). Pushed instead of polled.
    SemanticStatusChanged(SemanticStatus),
    /// Inbox mutation (queued, applied, rejected). Payload mirrors the
    /// pre-existing `{"updated": true}` shape for backward compatibility.
    InboxChanged,
    /// Local save completed; carries the canonical note id, path, and
    /// optional task delta so the frontend can splice instead of refetch.
    NoteSaved {
        note_id: Option<String>,
        note_path: Option<String>,
        title: String,
        revision: u64,
    },
    /// Vault location or note count changed; carries the fresh `VaultInfo`.
    VaultChanged(VaultInfo),
}

impl AppEvent {
    pub(crate) fn channel(&self) -> EventChannel {
        EventChannel(match self {
            AppEvent::VaultNoteChanged { .. } => VAULT_NOTE_CHANGED_EVENT,
            AppEvent::SemanticStatusChanged(_) => SEMANTIC_STATUS_CHANGED_EVENT,
            AppEvent::InboxChanged => INBOX_CHANGED_EVENT,
            AppEvent::NoteSaved { .. } => NOTE_SAVED_EVENT,
            AppEvent::VaultChanged(_) => VAULT_CHANGED_EVENT,
        })
    }

    /// Wire payload for the legacy channel each event is emitted on. We
    /// keep these payloads byte-compatible with what the frontend expected
    /// before this rewrite so the listeners in `Notepad.svelte` and
    /// `settings/store.ts` keep working unchanged.
    fn legacy_payload(&self) -> Value {
        match self {
            AppEvent::VaultNoteChanged {
                note_path,
                deleted,
                source,
            } => json!({ "notePath": note_path, "deleted": deleted, "source": source }),
            AppEvent::SemanticStatusChanged(status) => {
                serde_json::to_value(status).unwrap_or_else(|_| json!({}))
            }
            AppEvent::InboxChanged => json!({ "updated": true }),
            AppEvent::NoteSaved {
                note_id,
                note_path,
                title,
                revision,
            } => json!({
                "noteId": note_id,
                "notePath": note_path,
                "title": title,
                "revision": revision,
            }),
            AppEvent::VaultChanged(info) => {
                serde_json::to_value(info).unwrap_or_else(|_| json!({}))
            }
        }
    }
}

/// Single emission point for typed [`AppEvent`]s. Holds the Tauri
/// `AppHandle` and centralises error handling so callers do not need to
/// match on emit results.
#[derive(Clone)]
pub(crate) struct EventBus {
    app_handle: AppHandle,
}

impl EventBus {
    pub(crate) fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    #[allow(dead_code)]
    pub(crate) fn handle(&self) -> &AppHandle {
        &self.app_handle
    }

    /// Best-effort emit. Errors from the IPC layer are swallowed because
    /// we never want a failed event delivery to fail the underlying
    /// command (the previous code base already used `let _ = ...`).
    pub(crate) fn emit(&self, event: AppEvent) {
        let channel = event.channel();
        let payload = event.legacy_payload();
        let _ = self.app_handle.emit(channel.0, payload);
    }

    pub(crate) fn vault_note_changed(&self, path: &Path, deleted: bool) {
        self.emit(AppEvent::VaultNoteChanged {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
            source: None,
        });
    }

    pub(crate) fn vault_note_changed_from_source(&self, path: &Path, deleted: bool, source: &str) {
        self.emit(AppEvent::VaultNoteChanged {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
            source: Some(source.to_string()),
        });
    }

    pub(crate) fn semantic_status_changed(&self, status: SemanticStatus) {
        self.emit(AppEvent::SemanticStatusChanged(status));
    }

    pub(crate) fn inbox_changed(&self) {
        self.emit(AppEvent::InboxChanged);
    }

    pub(crate) fn note_saved(
        &self,
        note_id: Option<String>,
        note_path: Option<String>,
        title: String,
        revision: u64,
    ) {
        self.emit(AppEvent::NoteSaved {
            note_id,
            note_path,
            title,
            revision,
        });
    }

    pub(crate) fn vault_changed(&self, info: VaultInfo) {
        self.emit(AppEvent::VaultChanged(info));
    }
}
