//! Typed domain event bus.
//!
//! Replaces the previous pattern of scattered `app_handle.emit("...string...", ...)`
//! calls with a single enum that owns the event names and payloads. The bus
//! lives on [`crate::index::AppState`]. The frontend continues to listen on
//! the original event channel names (e.g. `vault-note-changed`) so the
//! contract across IPC is preserved.

use crate::note::DocumentKind;
use crate::semantic::SemanticStatus;
use crate::state::VaultInfo;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter};

pub(crate) const VAULT_NOTE_CHANGED_EVENT: &str = "vault-note-changed";
pub(crate) const SEMANTIC_STATUS_CHANGED_EVENT: &str = "semantic-status-changed";
pub(crate) const NOTE_SAVED_EVENT: &str = "note-saved";
pub(crate) const VAULT_CHANGED_EVENT: &str = "vault-changed";
pub(crate) const CHAT_PROJECTION_CONFLICT_EVENT: &str = "chat://projection-conflict";

/// Stable channel identifier each `AppEvent` is emitted on. Returning the
/// channel name from the enum keeps the wire-level contract close to the
/// type definition rather than scattered through call sites.
#[derive(Clone, Copy, Debug)]
pub(crate) struct EventChannel(pub &'static str);

/// Domain events emitted by the backend.
///
/// The variants intentionally mirror the names from the architecture target
/// so downstream code can pattern-match on intent.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum AppEvent {
    /// External (non-self) note change observed by the vault watcher.
    VaultNoteChanged {
        note_path: String,
        deleted: bool,
        document_kind: DocumentKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chat_id: Option<String>,
    },
    ChatProjectionConflict {
        chat_id: String,
        note_path: String,
        deleted: bool,
    },
    /// Semantic indexer status snapshot (count of indexed notes, queue
    /// depth, etc.). Pushed instead of polled.
    SemanticStatusChanged(Box<SemanticStatus>),
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
            AppEvent::ChatProjectionConflict { .. } => CHAT_PROJECTION_CONFLICT_EVENT,
            AppEvent::SemanticStatusChanged(_) => SEMANTIC_STATUS_CHANGED_EVENT,
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
                document_kind,
                source,
                chat_id,
            } => json!({
                "notePath": note_path,
                "deleted": deleted,
                "documentKind": document_kind,
                "source": source,
                "chatId": chat_id,
            }),
            AppEvent::ChatProjectionConflict {
                chat_id,
                note_path,
                deleted,
            } => json!({ "conversationId": chat_id, "notePath": note_path, "deleted": deleted }),
            AppEvent::SemanticStatusChanged(status) => {
                serde_json::to_value(status).unwrap_or_else(|_| json!({}))
            }
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
/// `AppHandle` when running inside the app; tests use [`Self::disabled`]
/// so emits are no-ops without a Tauri runtime.
#[derive(Clone)]
pub(crate) struct EventBus {
    app_handle: Option<AppHandle>,
}

impl EventBus {
    pub(crate) fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle: Some(app_handle),
        }
    }

    /// No-op bus for unit tests that construct [`crate::index::AppState`]
    /// outside a Tauri runtime.
    #[cfg(test)]
    pub(crate) fn disabled() -> Self {
        Self { app_handle: None }
    }

    /// Best-effort emit. Errors from the IPC layer are swallowed because
    /// we never want a failed event delivery to fail the underlying
    /// command (the previous code base already used `let _ = ...`).
    pub(crate) fn emit(&self, event: AppEvent) {
        let Some(app_handle) = &self.app_handle else {
            return;
        };
        let channel = event.channel();
        let payload = event.legacy_payload();
        let _ = app_handle.emit(channel.0, payload);
    }

    pub(crate) fn vault_note_changed(&self, path: &Path, deleted: bool) {
        self.emit(AppEvent::VaultNoteChanged {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
            document_kind: DocumentKind::Note,
            source: None,
            chat_id: None,
        });
    }

    pub(crate) fn vault_note_changed_from_source(&self, path: &Path, deleted: bool, source: &str) {
        self.emit(AppEvent::VaultNoteChanged {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
            document_kind: DocumentKind::Note,
            source: Some(source.to_string()),
            chat_id: None,
        });
    }

    pub(crate) fn vault_document_changed(
        &self,
        path: &Path,
        deleted: bool,
        document_kind: DocumentKind,
        source: &str,
        chat_id: Option<String>,
    ) {
        self.emit(AppEvent::VaultNoteChanged {
            note_path: path.to_string_lossy().into_owned(),
            deleted,
            document_kind,
            source: Some(source.to_string()),
            chat_id,
        });
    }

    pub(crate) fn chat_projection_conflict(&self, chat_id: String, path: &Path, deleted: bool) {
        self.emit(AppEvent::ChatProjectionConflict {
            chat_id,
            note_path: path.to_string_lossy().into_owned(),
            deleted,
        });
    }

    pub(crate) fn semantic_status_changed(&self, status: SemanticStatus) {
        self.emit(AppEvent::SemanticStatusChanged(Box::new(status)));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        semantic::{embed::ModelInfo, SemanticHealth, SemanticIndexJob, SemanticSettings},
        test_support::load_json_fixture,
    };

    #[test]
    fn typed_non_streaming_events_match_contract_fixture() {
        let fixture = load_json_fixture("contracts/app-events.json");
        let events = [
            AppEvent::VaultNoteChanged {
                note_path: "/vault/Changed.md".to_string(),
                deleted: false,
                document_kind: DocumentKind::Note,
                source: Some("watcher".to_string()),
                chat_id: None,
            },
            AppEvent::ChatProjectionConflict {
                chat_id: "conversation-1".to_string(),
                note_path: "/vault/Chats/conversation-1/Conversation.md".to_string(),
                deleted: false,
            },
            AppEvent::SemanticStatusChanged(Box::new(SemanticStatus {
                settings: SemanticSettings::default(),
                model: ModelInfo {
                    id: "jina-v5-nano".to_string(),
                    label: "Jina embeddings v5 nano".to_string(),
                    dimensions: 768,
                    runtime_binary_path: Some("/app/llama-server".to_string()),
                    model_path: Some("/app/models/jina.gguf".to_string()),
                    model_repo_id: "jinaai/jina-embeddings-v5-text-nano-retrieval".to_string(),
                    available: true,
                    loading: false,
                    ready: true,
                    status: "ready".to_string(),
                    error: None,
                },
                platform_supported: true,
                disabled_reason: None,
                model_available: true,
                indexing_paused: false,
                indexing_in_progress: false,
                indexed_notes: 12,
                indexed_chunks: 48,
                ann_index_loaded: true,
                ann_index_dirty: false,
                ann_rebuild_pending: false,
                ann_last_dumped_at_millis: Some(1_700_000_000_000),
                ann_indexed_chunks: 48,
                note_ann_index_loaded: true,
                note_ann_index_dirty: false,
                note_ann_rebuild_pending: false,
                note_ann_indexed_notes: 12,
                note_ann_generation_id: Some("note-ann-generation-1".to_string()),
                last_indexed_at_millis: Some(1_700_000_000_000),
                last_error: None,
                current_job_label: None,
                latest_job: Some(SemanticIndexJob {
                    id: 7,
                    status: "completed".to_string(),
                    scanned_count: 12,
                    embedded_count: 12,
                    error_text: None,
                    started_at_millis: 1_699_999_999_000,
                    updated_at_millis: 1_700_000_000_000,
                }),
                health: SemanticHealth::Fresh,
                recovery_state: "ready".to_string(),
                index_usable: true,
                retry_attempt: 0,
                retry_max_attempts: 3,
                retry_exhausted: false,
                progress_current: 12,
                progress_total: 12,
                rebuild_reason: None,
            })),
            AppEvent::NoteSaved {
                note_id: Some("note-1".to_string()),
                note_path: Some("/vault/Title.md".to_string()),
                title: "Title".to_string(),
                revision: 42,
            },
            AppEvent::VaultChanged(VaultInfo {
                current_path: "/vault".to_string(),
                default_path: "/documents/Gneauxghts".to_string(),
                forgotten_path: "/vault/.forgotten".to_string(),
                is_default: false,
                note_count: 12,
                requires_restart: true,
                can_configure_path: true,
                can_pick_arbitrary_path: true,
                vault_container_path: None,
                path_configuration_note: Some("Restart to finish switching vaults.".to_string()),
            }),
        ];

        let actual = events
            .iter()
            .map(|event| {
                json!({
                    "channel": event.channel().0,
                    "payload": event.legacy_payload(),
                })
            })
            .collect::<Vec<_>>();

        assert_eq!(fixture["version"], 1);
        assert_eq!(fixture["events"], json!(actual));
    }
}
