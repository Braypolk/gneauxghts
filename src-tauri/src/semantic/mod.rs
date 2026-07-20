pub(crate) mod activity;
pub(crate) mod ann;
mod ann_core;
pub(crate) mod atlas;
pub(crate) mod atlas_labels;
pub(crate) mod chunking;
pub(crate) mod db;
pub(crate) mod debug;
pub(crate) mod embed;
pub(crate) mod indexer;
pub(crate) mod note_ann;
pub(crate) mod related;
pub(crate) mod similarity;

use self::{
    activity::BackgroundWorkGate,
    ann::AnnIndexState,
    atlas::{AtlasChatVisibilityKey, AtlasGenerationKey, AtlasSearchResponse, VaultAtlasResponse},
    db::{
        clear_atlas_cache, content_hash, count_indexed_items, edges_are_stale_for_generation,
        edges_are_stale_for_model, ensure_schema, load_chunks_by_ann_labels, load_latest_job,
        load_note_record, load_related_note_previews, load_related_note_previews_for_paths,
        load_semantic_settings, mark_running_jobs_interrupted, open_database,
        save_semantic_settings,
    },
    debug::{SemanticDebugSnapshot, SemanticDebugState},
    embed::{EmbeddingInputKind, EmbeddingProvider, JinaLlamaEmbeddingProvider, ModelInfo},
    indexer::{
        chat_recall_content_hash, spawn_indexing_worker, ChatRecallExcerpt, PendingIndexState,
        PendingNoteMove, PendingNoteUpdate, PendingSemanticDocument, WorkerSignal,
    },
    note_ann::NoteAnnIndexState,
    related::{build_excerpt, related_scope_label},
    similarity::{cosine_similarity, MIN_SEMANTIC_MATCH_SCORE},
};
use crate::time::current_time_millis;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
    time::Instant,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticSettings {
    pub(crate) semantic_search_enabled: bool,
    pub(crate) local_only_mode: bool,
    pub(crate) lexical_weight: f32,
    pub(crate) semantic_weight: f32,
}

impl Default for SemanticSettings {
    fn default() -> Self {
        Self {
            semantic_search_enabled: true,
            local_only_mode: true,
            lexical_weight: 0.5,
            semantic_weight: 0.4,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticIndexJob {
    pub(crate) id: i64,
    pub(crate) status: String,
    pub(crate) scanned_count: usize,
    pub(crate) embedded_count: usize,
    pub(crate) error_text: Option<String>,
    pub(crate) started_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticStatus {
    pub(crate) settings: SemanticSettings,
    pub(crate) model: ModelInfo,
    pub(crate) platform_supported: bool,
    pub(crate) disabled_reason: Option<String>,
    pub(crate) model_available: bool,
    pub(crate) indexing_paused: bool,
    pub(crate) indexing_in_progress: bool,
    pub(crate) indexed_notes: usize,
    pub(crate) indexed_chunks: usize,
    pub(crate) ann_index_loaded: bool,
    pub(crate) ann_index_dirty: bool,
    pub(crate) ann_rebuild_pending: bool,
    pub(crate) ann_last_dumped_at_millis: Option<u64>,
    pub(crate) ann_indexed_chunks: usize,
    pub(crate) note_ann_index_loaded: bool,
    pub(crate) note_ann_index_dirty: bool,
    pub(crate) note_ann_rebuild_pending: bool,
    pub(crate) note_ann_indexed_notes: usize,
    pub(crate) note_ann_generation_id: Option<String>,
    pub(crate) last_indexed_at_millis: Option<u64>,
    pub(crate) last_error: Option<String>,
    pub(crate) current_job_label: Option<String>,
    pub(crate) latest_job: Option<SemanticIndexJob>,
    pub(crate) recovery_state: String,
    pub(crate) index_usable: bool,
    pub(crate) progress_current: usize,
    pub(crate) progress_total: usize,
    pub(crate) rebuild_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticChunkMatch {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) section_label: String,
    pub(crate) excerpt: String,
    pub(crate) match_text: String,
    pub(crate) score: f32,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
    pub(crate) document_kind: crate::note::DocumentKind,
    pub(crate) block_anchor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedNoteMatch {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) section_label: String,
    pub(crate) excerpt: String,
    pub(crate) match_text: String,
    pub(crate) score: f32,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
    pub(crate) document_kind: crate::note::DocumentKind,
    pub(crate) block_anchor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedNotesResponse {
    pub(crate) status: String,
    pub(crate) scope: String,
    pub(crate) reason: Option<String>,
    pub(crate) items: Vec<RelatedNoteMatch>,
}

pub(super) struct RuntimeState {
    indexing_paused: bool,
    indexing_in_progress: bool,
    current_job_label: Option<String>,
    last_indexed_at_millis: Option<u64>,
    last_error: Option<String>,
    last_scan_requested_at_millis: Option<u64>,
    recovery_state: String,
    progress_current: usize,
    progress_total: usize,
    rebuild_reason: Option<String>,
    last_job_scanned_count: usize,
    last_job_edges_dirtied: bool,
    edges_stale: bool,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            indexing_paused: false,
            indexing_in_progress: false,
            current_job_label: None,
            last_indexed_at_millis: None,
            last_error: None,
            last_scan_requested_at_millis: None,
            recovery_state: "catchingUp".to_string(),
            progress_current: 0,
            progress_total: 0,
            rebuild_reason: None,
            last_job_scanned_count: 0,
            last_job_edges_dirtied: false,
            edges_stale: false,
        }
    }
}

pub(crate) struct SemanticState {
    inner: SemanticStateInner,
}

enum SemanticStateInner {
    Active(ActiveSemanticState),
    Disabled(DisabledSemanticState),
}

struct ActiveSemanticState {
    db_path: PathBuf,
    atlas_cache_dir: PathBuf,
    settings: Arc<Mutex<SemanticSettings>>,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    runtime: Arc<Mutex<RuntimeState>>,
    debug: Arc<SemanticDebugState>,
    ann: Arc<AnnIndexState>,
    note_ann: Arc<NoteAnnIndexState>,
    signal_tx: Sender<WorkerSignal>,
    pending: Arc<Mutex<PendingIndexState>>,
    wake_pending: Arc<AtomicBool>,
    index_revision: Arc<AtomicU64>,
    related_query_cache: Mutex<Vec<(String, u64, RelatedNotesResponse)>>,
    background_gate: Arc<BackgroundWorkGate>,
}

struct DisabledSemanticState {
    settings: Mutex<SemanticSettings>,
    debug: Arc<SemanticDebugState>,
    reason: String,
}

impl SemanticState {
    pub(crate) fn new_with_runtime(
        app_data_dir: PathBuf,
        vault_data_dir: PathBuf,
        notes_dir: PathBuf,
        bundled_runtime_path: Option<PathBuf>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
        // Vault-local, portable: semantic.sqlite3 lives directly under
        // `<vault>/.gneauxghts`; the rebuildable ANN/HNSW + lexical/graph
        // sidecars live under `<vault>/.gneauxghts/cache`.
        fs::create_dir_all(&vault_data_dir).map_err(|err| err.to_string())?;
        let cache_dir = vault_data_dir.join(crate::state::VAULT_CACHE_DIR_NAME);
        fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
        let db_path = vault_data_dir.join("semantic.sqlite3");

        // The model cache (large, device-specific, non-portable) stays
        // GLOBAL in app_data_dir; only the index + caches are vault-local.
        let semantic_dir = cache_dir.clone();
        let connection = open_database(&db_path)?;
        ensure_schema(&connection)?;
        mark_running_jobs_interrupted(&connection)?;
        let stored_settings = load_semantic_settings(&connection)?;
        let initial_settings = stored_settings.clone().unwrap_or_default();
        if stored_settings.is_none() {
            save_semantic_settings(&connection, &initial_settings)?;
        }
        let settings = Arc::new(Mutex::new(initial_settings));
        let debug = Arc::new(SemanticDebugState::new());
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> =
            Arc::new(JinaLlamaEmbeddingProvider::new(
                app_data_dir,
                settings.clone(),
                bundled_runtime_path,
                debug.clone(),
            )?);
        let ann = Arc::new(AnnIndexState::new(
            semantic_dir.clone(),
            provider.model_info().dimensions,
            debug.clone(),
        )?);
        let model = provider.model_info();
        let model_signature = format!("{}::{}", model.id, model.model_repo_id);
        let initial_edges_stale = edges_are_stale_for_model(&connection, Some(&model_signature))?;
        let note_ann = Arc::new(NoteAnnIndexState::new(
            semantic_dir.clone(),
            model.dimensions,
            model_signature,
        )?);
        // Drop the schema-setup connection before kicking off the
        // background ANN load: deserializing the persisted HNSW graph +
        // raw vectors can take hundreds of milliseconds on cold disks and
        // used to run synchronously inside Tauri `setup` before first
        // paint. The worker, search, and related-notes paths all already
        // tolerate a not-yet-loaded ANN snapshot (see
        // `AnnStatusState::default` and `related.rs` "warming up"
        // handling), so we only need to keep the load off the main
        // thread.
        drop(connection);

        let mut initial_runtime = RuntimeState::default();
        initial_runtime.edges_stale = initial_edges_stale;
        let runtime = Arc::new(Mutex::new(initial_runtime));
        let background_gate = Arc::new(BackgroundWorkGate::new());
        let mut initial_pending = PendingIndexState::default();
        initial_pending.edge_refresh_requested = initial_edges_stale;
        let pending = Arc::new(Mutex::new(initial_pending));
        let wake_pending = Arc::new(AtomicBool::new(false));
        let index_revision = Arc::new(AtomicU64::new(0));
        let (signal_tx, signal_rx) = mpsc::channel();
        spawn_indexing_worker(
            db_path.clone(),
            notes_dir.clone(),
            provider.clone(),
            ann.clone(),
            note_ann.clone(),
            signal_rx,
            pending.clone(),
            wake_pending.clone(),
            index_revision.clone(),
            &runtime,
            debug.clone(),
            background_gate.clone(),
        )?;

        let state = ActiveSemanticState {
            db_path: db_path.clone(),
            atlas_cache_dir: semantic_dir.clone(),
            settings,
            provider,
            runtime: runtime.clone(),
            debug: debug.clone(),
            ann: ann.clone(),
            note_ann: note_ann.clone(),
            signal_tx: signal_tx.clone(),
            pending: pending.clone(),
            wake_pending: wake_pending.clone(),
            index_revision,
            related_query_cache: Mutex::new(Vec::new()),
            background_gate,
        };
        state.warmup_model_in_background();
        // Defer the persisted ANN snapshot load AND the initial vault
        // scan onto a background thread. Running the scan only after the
        // snapshot finishes loading prevents the worker from racing
        // ahead, finding an empty in-memory ANN, and rebuilding the
        // graph from scratch in SQLite — the load was already
        // authoritative.
        spawn_ann_initialize_and_scan_in_background(
            ann,
            note_ann,
            db_path,
            debug,
            signal_tx,
            wake_pending,
            pending,
            runtime,
        );
        Ok(Self {
            inner: SemanticStateInner::Active(state),
        })
    }

    pub(crate) fn new_disabled(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        let debug = Arc::new(SemanticDebugState::new());
        debug.record_with_metrics(
            "runtime",
            "platform_disabled",
            Some(reason.clone()),
            None,
            |_| {},
        );
        Self {
            inner: SemanticStateInner::Disabled(DisabledSemanticState {
                settings: Mutex::new(disabled_settings(SemanticSettings::default())),
                debug,
                reason,
            }),
        }
    }

    pub(crate) fn queue_note_update(
        &self,
        note_path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.debug.record_with_metrics(
                    "index",
                    "enqueue_upsert_note",
                    Some(note_path.to_string_lossy().into_owned()),
                    None,
                    |metrics| metrics.index_job_enqueued_count += 1,
                );
                {
                    let mut pending = state
                        .pending
                        .lock()
                        .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
                    if pending.rebuild_requested || pending.full_scan_requested {
                        return Ok(());
                    }
                    pending.deleted_notes.remove(note_path);
                    pending.note_updates.insert(
                        note_path.to_path_buf(),
                        PendingNoteUpdate {
                            document: PendingSemanticDocument::NoteMarkdown(markdown),
                            modified_millis,
                        },
                    );
                }
                state.request_wake()
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    /// Queue the complete immutable remembered set for one conversation. Chat
    /// recall is sourced from ai.sqlite3, never reconstructed from projection
    /// Markdown. An empty set removes the semantic document.
    pub(crate) fn queue_chat_recall(
        &self,
        conversation_path: &Path,
        title: String,
        excerpts: Vec<ChatRecallExcerpt>,
        modified_millis: u64,
    ) -> Result<(), String> {
        self.queue_chat_recall_inner(conversation_path, title, excerpts, modified_millis, true)
    }

    pub(crate) fn queue_chat_recall_for_startup(
        &self,
        conversation_path: &Path,
        title: String,
        excerpts: Vec<ChatRecallExcerpt>,
        modified_millis: u64,
    ) -> Result<(), String> {
        if excerpts.is_empty() {
            let SemanticStateInner::Active(state) = &self.inner else {
                return Ok(());
            };
            let connection = open_database(&state.db_path)?;
            ensure_schema(&connection)?;
            if load_note_record(&connection, &conversation_path.to_string_lossy())?.is_none() {
                return Ok(());
            }
            return self.queue_delete_note_inner(conversation_path, false);
        }
        self.queue_chat_recall_inner(conversation_path, title, excerpts, modified_millis, false)
    }

    /// Remove semantic chat documents that no longer have an authoritative
    /// conversation in ai.sqlite3. This is deliberately deferred until the
    /// startup ANN load and note scan have completed.
    pub(crate) fn queue_orphaned_chat_recall_deletes_for_startup(
        &self,
        known_paths: &std::collections::HashSet<PathBuf>,
    ) -> Result<(), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Ok(());
        };
        let connection = open_database(&state.db_path)?;
        ensure_schema(&connection)?;
        let mut statement = connection
            .prepare("SELECT path FROM notes WHERE document_kind = 'chatIndex'")
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?;
        let stored_paths = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        for path in stored_paths.into_iter().map(PathBuf::from) {
            if !known_paths.contains(&path) {
                self.queue_delete_note_inner(&path, false)?;
            }
        }
        Ok(())
    }

    fn queue_chat_recall_inner(
        &self,
        conversation_path: &Path,
        title: String,
        excerpts: Vec<ChatRecallExcerpt>,
        modified_millis: u64,
        wake: bool,
    ) -> Result<(), String> {
        if excerpts.is_empty() {
            return self.queue_delete_note(conversation_path);
        }
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let connection = open_database(&state.db_path)?;
                ensure_schema(&connection)?;
                if load_note_record(&connection, &conversation_path.to_string_lossy())?.is_some_and(
                    |stored| {
                        stored.document_kind == crate::note::DocumentKind::ChatIndex
                            && stored.content_hash == chat_recall_content_hash(&excerpts)
                    },
                ) {
                    return Ok(());
                }
                state.debug.record_with_metrics(
                    "index",
                    "enqueue_chat_recall",
                    Some(conversation_path.to_string_lossy().into_owned()),
                    None,
                    |metrics| metrics.index_job_enqueued_count += 1,
                );
                {
                    let mut pending = state
                        .pending
                        .lock()
                        .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
                    pending.deleted_notes.remove(conversation_path);
                    pending.note_updates.insert(
                        conversation_path.to_path_buf(),
                        PendingNoteUpdate {
                            document: PendingSemanticDocument::ChatRecall { title, excerpts },
                            modified_millis,
                        },
                    );
                }
                if wake {
                    if let Ok(mut runtime) = state.runtime.lock() {
                        runtime.indexing_in_progress = true;
                        runtime.current_job_label = Some("Applying changes".to_string());
                        runtime.recovery_state = "catchingUp".to_string();
                        runtime.progress_current = 0;
                        runtime.progress_total = 1;
                    }
                    state.request_wake()
                } else {
                    Ok(())
                }
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn queue_delete_note(&self, note_path: &Path) -> Result<(), String> {
        self.queue_delete_note_inner(note_path, true)
    }

    fn queue_delete_note_inner(&self, note_path: &Path, wake: bool) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.debug.record_with_metrics(
                    "index",
                    "enqueue_delete_note",
                    Some(note_path.to_string_lossy().into_owned()),
                    None,
                    |metrics| metrics.index_job_enqueued_count += 1,
                );
                {
                    let mut pending = state
                        .pending
                        .lock()
                        .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
                    pending.note_updates.remove(note_path);
                    pending.deleted_notes.insert(note_path.to_path_buf());
                }
                if wake {
                    if let Ok(mut runtime) = state.runtime.lock() {
                        runtime.indexing_in_progress = true;
                        runtime.current_job_label = Some("Applying changes".to_string());
                        runtime.recovery_state = "catchingUp".to_string();
                        runtime.progress_current = 0;
                        runtime.progress_total = 1;
                    }
                    state.request_wake()
                } else {
                    Ok(())
                }
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    /// Enqueue a note move (rename/relocation with unchanged content). The
    /// indexer re-keys the stored rows from `old_path` to `new_path`, reusing
    /// existing embeddings. `markdown`/`modified_millis` are the destination
    /// content, used only as a fallback if the source was never indexed.
    pub(crate) fn queue_note_move(
        &self,
        old_path: &Path,
        new_path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.debug.record_with_metrics(
                    "index",
                    "enqueue_move_note",
                    Some(format!(
                        "{} -> {}",
                        old_path.to_string_lossy(),
                        new_path.to_string_lossy()
                    )),
                    None,
                    |metrics| metrics.index_job_enqueued_count += 1,
                );
                {
                    let mut pending = state
                        .pending
                        .lock()
                        .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
                    if pending.rebuild_requested || pending.full_scan_requested {
                        return Ok(());
                    }
                    // The destination is now authoritative: drop any pending
                    // delete/update that targeted either endpoint so the move
                    // is the single source of truth for this batch.
                    pending.deleted_notes.remove(old_path);
                    pending.deleted_notes.remove(new_path);
                    pending.note_updates.remove(old_path);
                    pending.note_updates.remove(new_path);
                    pending.moved_notes.insert(
                        old_path.to_path_buf(),
                        PendingNoteMove {
                            new_path: new_path.to_path_buf(),
                            markdown,
                            modified_millis,
                        },
                    );
                }
                state.request_wake()
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn rebuild_index(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.debug.record_with_metrics(
                    "index",
                    "enqueue_rebuild",
                    None,
                    None,
                    |metrics| metrics.index_job_enqueued_count += 1,
                );
                {
                    let mut pending = state
                        .pending
                        .lock()
                        .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
                    pending.rebuild_requested = true;
                    pending.full_scan_requested = false;
                    pending.force_full_scan = false;
                    pending.note_updates.clear();
                    pending.deleted_notes.clear();
                    pending.moved_notes.clear();
                }
                state.request_wake()
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn prepare_model(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state.provider.prepare(),
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn download_embedding_model(
        &self,
    ) -> Result<embed::SemanticModelDownloadResult, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state.provider.download_model_if_needed(),
            SemanticStateInner::Disabled(_) => {
                Err("Semantic search is disabled on this platform.".to_string())
            }
        }
    }

    pub(crate) fn shutdown(&self) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.provider.shutdown();
        }
    }

    pub(crate) fn warmup_model_in_background(&self) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.warmup_model_in_background();
        }
    }

    /// Return the content hash currently stored for `note_path`, if the note is
    /// indexed. Used by the vault watcher to detect content-identical renames
    /// (a removed path whose stored hash matches a newly-present path) so the
    /// move can reuse existing embeddings. Returns `None` when disabled, the
    /// note is not indexed, or the lookup fails (callers fall back to a plain
    /// delete + index).
    pub(crate) fn stored_content_hash(&self, note_path: &Path) -> Option<String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return None;
        };
        let connection = open_database(&state.db_path).ok()?;
        let record = load_note_record(&connection, &note_path.to_string_lossy()).ok()??;
        Some(record.content_hash)
    }

    pub(crate) fn debug_snapshot(&self) -> Result<SemanticDebugSnapshot, String> {
        self.debug_state().snapshot()
    }

    pub(crate) fn clear_debug_metrics(&self) -> Result<(), String> {
        self.debug_state().clear()
    }

    pub(crate) fn clear_atlas_cache(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let connection = open_database(&state.db_path)?;
                ensure_schema(&connection)?;
                clear_atlas_cache(&connection)?;
                let atlas_dir = state.atlas_cache_dir.join("atlas");
                if atlas_dir.exists() {
                    fs::remove_dir_all(&atlas_dir).map_err(|err| err.to_string())?;
                }
                {
                    let mut pending = state
                        .pending
                        .lock()
                        .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
                    let revision = state.index_revision.load(Ordering::Acquire);
                    // Full rebuild: always enqueue every visibility variant.
                    for visibility in [
                        AtlasChatVisibilityKey::Hidden,
                        AtlasChatVisibilityKey::Remembered,
                        AtlasChatVisibilityKey::All,
                    ] {
                        pending.atlas_requests.insert(
                            AtlasGenerationKey {
                                chat_visibility: visibility,
                            },
                            revision,
                        );
                    }
                }
                state.request_wake()
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn debug_state(&self) -> Arc<SemanticDebugState> {
        match &self.inner {
            SemanticStateInner::Active(state) => Arc::clone(&state.debug),
            SemanticStateInner::Disabled(state) => Arc::clone(&state.debug),
        }
    }

    pub(crate) fn pause_indexing(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.background_gate.set_manually_paused(true);
                if let Ok(mut runtime) = state.runtime.lock() {
                    runtime.indexing_paused = true;
                    runtime.recovery_state = "paused".to_string();
                }
                state
                    .signal_tx
                    .send(WorkerSignal::SetPaused { paused: true })
                    .map_err(|err| err.to_string())
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn resume_indexing(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.background_gate.set_manually_paused(false);
                if let Ok(mut runtime) = state.runtime.lock() {
                    runtime.indexing_paused = false;
                    runtime.recovery_state = if state.ann.needs_rebuild() {
                        "stale".to_string()
                    } else {
                        "ready".to_string()
                    };
                }
                state
                    .signal_tx
                    .send(WorkerSignal::SetPaused { paused: false })
                    .map_err(|err| err.to_string())
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn report_user_activity(&self) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.background_gate.report_activity();
        }
    }

    pub(crate) fn begin_foreground_activity(&self) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.background_gate.begin_foreground();
        }
    }

    pub(crate) fn end_foreground_activity(&self) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.background_gate.end_foreground();
        }
    }

    pub(crate) fn get_settings(&self) -> Result<SemanticSettings, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state
                .settings
                .lock()
                .map(|settings| settings.clone())
                .map_err(|_| "Semantic settings lock poisoned".to_string()),
            SemanticStateInner::Disabled(state) => state
                .settings
                .lock()
                .map(|settings| settings.clone())
                .map_err(|_| "Semantic settings lock poisoned".to_string()),
        }
    }

    pub(crate) fn set_settings(
        &self,
        next_settings: SemanticSettings,
    ) -> Result<SemanticSettings, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let connection = open_database(&state.db_path)?;
                ensure_schema(&connection)?;
                save_semantic_settings(&connection, &next_settings)?;
                *state
                    .settings
                    .lock()
                    .map_err(|_| "Semantic settings lock poisoned".to_string())? =
                    next_settings.clone();
                Ok(next_settings)
            }
            SemanticStateInner::Disabled(state) => {
                let next_settings = disabled_settings(next_settings);
                *state
                    .settings
                    .lock()
                    .map_err(|_| "Semantic settings lock poisoned".to_string())? =
                    next_settings.clone();
                Ok(next_settings)
            }
        }
    }

    pub(crate) fn get_status(&self) -> Result<SemanticStatus, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state.get_status(),
            SemanticStateInner::Disabled(state) => state.get_status(),
        }
    }

    pub(crate) fn current_index_revision(&self) -> u64 {
        match &self.inner {
            SemanticStateInner::Active(state) => state.index_revision.load(Ordering::Acquire),
            SemanticStateInner::Disabled(_) => 0,
        }
    }

    pub(crate) fn semantic_matches_for_text(
        &self,
        text: &str,
        exclude_note_path: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SemanticChunkMatch>, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.semantic_matches_for_text(text, exclude_note_path, limit)
            }
            SemanticStateInner::Disabled(_) => Ok(Vec::new()),
        }
    }

    pub(crate) fn related_notes(
        &self,
        current_path: Option<&str>,
        current_title: &str,
        current_markdown: &str,
        selected_text: Option<&str>,
        limit: usize,
    ) -> Result<RelatedNotesResponse, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state.related_notes(
                current_path,
                current_title,
                current_markdown,
                selected_text,
                limit,
            ),
            SemanticStateInner::Disabled(state) => Ok(RelatedNotesResponse {
                status: "unavailable".to_string(),
                scope: related_scope_label(selected_text),
                reason: Some(state.reason.clone()),
                items: Vec::new(),
            }),
        }
    }

    pub(crate) fn vault_atlas(
        &self,
        generation_key: AtlasGenerationKey,
        activity_by_note_id: std::collections::HashMap<String, crate::state::NoteActivity>,
    ) -> Result<VaultAtlasResponse, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state.vault_atlas(
                generation_key,
                activity_by_note_id,
                self.current_index_revision(),
            ),
            SemanticStateInner::Disabled(state) => Ok(VaultAtlasResponse {
                status: "unavailable".to_string(),
                reason: Some(state.reason.clone()),
                revision: 0,
                generated_at_millis: current_time_millis()?,
                structural_generation: String::new(),
                label_generation: None,
                published_at_millis: 0,
                stale: false,
                publish_in_progress: false,
                stats: atlas::VaultAtlasStats {
                    note_count: 0,
                    cloud_count: 0,
                    link_count: 0,
                    isolated_count: 0,
                },
                nodes: Vec::new(),
                links: Vec::new(),
                clouds: Vec::new(),
            }),
        }
    }

    pub(crate) fn search_vault_atlas(
        &self,
        generation_key: AtlasGenerationKey,
        query: String,
        activity_by_note_id: std::collections::HashMap<String, crate::state::NoteActivity>,
    ) -> Result<AtlasSearchResponse, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.search_vault_atlas(generation_key, query, activity_by_note_id)
            }
            SemanticStateInner::Disabled(state) => Ok(AtlasSearchResponse {
                status: "unavailable".to_string(),
                reason: Some(state.reason.clone()),
                query,
                generated_at_millis: current_time_millis()?,
                matches: Vec::new(),
            }),
        }
    }
}

impl ActiveSemanticState {
    fn get_settings(&self) -> Result<SemanticSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "Semantic settings lock poisoned".to_string())
    }

    fn request_wake(&self) -> Result<(), String> {
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            self.signal_tx
                .send(WorkerSignal::Wake)
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn warmup_model_in_background(&self) {
        let provider = Arc::clone(&self.provider);
        let debug = Arc::clone(&self.debug);
        let db_path = self.db_path.clone();
        let note_ann = Arc::clone(&self.note_ann);
        let pending = Arc::clone(&self.pending);
        let runtime = Arc::clone(&self.runtime);
        let _ = thread::Builder::new()
            .name("semantic-model-warmup".to_string())
            .spawn(move || {
                let started_at = std::time::Instant::now();
                debug.record_with_metrics("runtime", "warmup_started", None, None, |metrics| {
                    metrics.model_warmup_count += 1;
                });
                match provider.prepare() {
                    Ok(()) => {
                        let generation = note_ann.generation_id();
                        let edges_stale = open_database(&db_path)
                            .ok()
                            .and_then(|connection| {
                                edges_are_stale_for_generation(
                                    &connection,
                                    note_ann.model_signature(),
                                    generation.as_deref(),
                                )
                                .ok()
                            })
                            .unwrap_or(true);
                        if edges_stale {
                            if let Ok(mut pending) = pending.lock() {
                                pending.edge_refresh_requested = true;
                            }
                            if let Ok(mut runtime) = runtime.lock() {
                                runtime.edges_stale = true;
                            }
                        }
                        let elapsed =
                            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                        debug.record_timing(
                            "runtime",
                            "warmup_completed",
                            None,
                            elapsed,
                            |metrics| {
                                metrics.model_warmup_success_count += 1;
                                metrics.model_warmup_last_millis = Some(elapsed);
                            },
                        );
                    }
                    Err(error) => {
                        let elapsed =
                            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                        debug.record_timing(
                            "runtime",
                            "warmup_failed",
                            Some(error),
                            elapsed,
                            |metrics| {
                                metrics.model_warmup_failure_count += 1;
                                metrics.model_warmup_last_millis = Some(elapsed);
                            },
                        );
                    }
                }
            });
    }

    fn get_status(&self) -> Result<SemanticStatus, String> {
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let settings = self.get_settings()?;
        let (indexed_notes, indexed_chunks, last_indexed_at_millis) =
            count_indexed_items(&connection)?;
        let latest_job = load_latest_job(&connection)?;
        let model = self.provider.model_info();
        let ann_status = self.ann.status_snapshot();
        let note_ann_status = self.note_ann.status_snapshot();
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "Semantic runtime lock poisoned".to_string())?;

        Ok(SemanticStatus {
            settings,
            model_available: model.available,
            model: model.clone(),
            platform_supported: true,
            disabled_reason: None,
            indexing_paused: runtime.indexing_paused,
            indexing_in_progress: runtime.indexing_in_progress,
            indexed_notes,
            indexed_chunks,
            ann_index_loaded: ann_status.loaded,
            ann_index_dirty: ann_status.dirty,
            ann_rebuild_pending: ann_status.rebuild_pending,
            ann_last_dumped_at_millis: ann_status.last_dumped_at_millis,
            ann_indexed_chunks: ann_status.indexed_chunks,
            note_ann_index_loaded: note_ann_status.loaded,
            note_ann_index_dirty: note_ann_status.dirty,
            note_ann_rebuild_pending: note_ann_status.rebuild_pending,
            note_ann_indexed_notes: note_ann_status.indexed_notes,
            note_ann_generation_id: note_ann_status.generation_id,
            last_indexed_at_millis: runtime.last_indexed_at_millis.or(last_indexed_at_millis),
            last_error: runtime.last_error.clone().or(model.error.clone()),
            current_job_label: runtime.current_job_label.clone(),
            latest_job,
            recovery_state: if runtime.indexing_paused {
                "paused".to_string()
            } else {
                runtime.recovery_state.clone()
            },
            index_usable: ann_status.loaded,
            progress_current: runtime.progress_current,
            progress_total: runtime.progress_total,
            rebuild_reason: runtime.rebuild_reason.clone(),
        })
    }

    fn semantic_matches_for_text(
        &self,
        text: &str,
        exclude_note_path: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SemanticChunkMatch>, String> {
        let started_at = Instant::now();
        let settings = self.get_settings()?;
        if !settings.semantic_search_enabled {
            return Ok(Vec::new());
        }
        let ann_status = self.ann.status_snapshot();
        if !ann_status.loaded || ann_status.indexed_chunks == 0 {
            self.debug
                .record_timing("ann", "query_skipped_unavailable", None, 0, |metrics| {
                    metrics.ann_query_skipped_count += 1;
                });
            return Ok(Vec::new());
        }

        let query_embedding = self
            .provider
            .embed_texts(&[text.to_string()], EmbeddingInputKind::Query)?
            .into_iter()
            .next()
            .ok_or_else(|| "Unable to embed semantic query".to_string())?;
        let candidate_labels = self
            .ann
            .search(&query_embedding, limit.saturating_mul(8).max(64))?;
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let reranked_count = candidate_labels.len();
        let mut matches = load_chunks_by_ann_labels(&connection, &candidate_labels)?
            .into_iter()
            .filter(|chunk| exclude_note_path != Some(chunk.note_path.as_str()))
            .filter_map(|chunk| {
                let score = cosine_similarity(&query_embedding, &chunk.embedding);
                if score < MIN_SEMANTIC_MATCH_SCORE {
                    return None;
                }

                Some(SemanticChunkMatch {
                    note_path: chunk.note_path.clone(),
                    note_title: chunk.note_title.clone(),
                    section_label: chunk.section_label.clone(),
                    excerpt: build_excerpt(&chunk.text, 180),
                    match_text: chunk.text.clone(),
                    score,
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    document_kind: chunk.document_kind,
                    block_anchor: chunk.block_anchor,
                })
            })
            .collect::<Vec<_>>();

        matches.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.note_title.cmp(&right.note_title))
                .then_with(|| left.note_path.cmp(&right.note_path))
        });
        matches.truncate(limit);
        let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        self.debug
            .record_timing("ann", "query_completed", None, elapsed, |metrics| {
                metrics.ann_query_count += 1;
                metrics.ann_query_candidate_total += candidate_labels.len() as u64;
                metrics.ann_query_rerank_total += reranked_count as u64;
                metrics.ann_query_duration_total_millis += elapsed;
                metrics.ann_query_duration_max_millis =
                    metrics.ann_query_duration_max_millis.max(elapsed);
            });
        Ok(matches)
    }
}

impl DisabledSemanticState {
    fn get_status(&self) -> Result<SemanticStatus, String> {
        let settings = self
            .settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "Semantic settings lock poisoned".to_string())?;
        Ok(SemanticStatus {
            settings,
            model: ModelInfo {
                id: "semantic-disabled".to_string(),
                label: "Semantic Search Disabled".to_string(),
                dimensions: 0,
                local_only: true,
                runtime_binary_path: None,
                model_path: None,
                model_repo_id: String::new(),
                available: false,
                loading: false,
                ready: false,
                status: self.reason.clone(),
                error: None,
            },
            platform_supported: false,
            disabled_reason: Some(self.reason.clone()),
            model_available: false,
            indexing_paused: false,
            indexing_in_progress: false,
            indexed_notes: 0,
            indexed_chunks: 0,
            ann_index_loaded: false,
            ann_index_dirty: false,
            ann_rebuild_pending: false,
            ann_last_dumped_at_millis: None,
            ann_indexed_chunks: 0,
            note_ann_index_loaded: false,
            note_ann_index_dirty: false,
            note_ann_rebuild_pending: false,
            note_ann_indexed_notes: 0,
            note_ann_generation_id: None,
            last_indexed_at_millis: None,
            last_error: None,
            current_job_label: None,
            latest_job: None,
            recovery_state: "ready".to_string(),
            index_usable: false,
            progress_current: 0,
            progress_total: 0,
            rebuild_reason: None,
        })
    }
}

fn disabled_settings(mut settings: SemanticSettings) -> SemanticSettings {
    settings.semantic_search_enabled = false;
    settings
}

/// Load the persisted HNSW snapshot off the startup hot path and only
/// then queue the initial vault scan.
///
/// `AnnIndexState::initialize` reads the graph file, the raw vectors,
/// and the manifest from disk and deserializes them into memory. On
/// warm installs that snapshot can be tens of megabytes and the load
/// alone blocked the Tauri `setup` callback long enough for the user
/// to see a frozen window for several seconds. Moving it to a
/// background thread lets `setup` return immediately; until the
/// background thread finishes the ANN status reports `loaded=false,
/// rebuild_pending=true` (the default) and search / related callers
/// fall through to the existing "still warming up" path.
///
/// Holding the initial vault scan back until after the ANN snapshot
/// has loaded prevents the indexing worker from racing ahead, finding
/// an empty in-memory ANN, and rebuilding the graph from scratch when
/// the saved snapshot was already authoritative.
fn spawn_ann_initialize_and_scan_in_background(
    ann: Arc<AnnIndexState>,
    note_ann: Arc<NoteAnnIndexState>,
    db_path: PathBuf,
    debug: Arc<SemanticDebugState>,
    signal_tx: Sender<WorkerSignal>,
    wake_pending: Arc<AtomicBool>,
    pending: Arc<Mutex<PendingIndexState>>,
    runtime: Arc<Mutex<RuntimeState>>,
) {
    let _ = thread::Builder::new()
        .name("semantic-ann-initialize".to_string())
        .spawn(move || {
            let started_at = Instant::now();
            let connection_result = open_database(&db_path).and_then(|connection| {
                ensure_schema(&connection)?;
                Ok(connection)
            });
            match connection_result {
                Ok(connection) => match ann
                    .initialize(&connection)
                    .and_then(|()| note_ann.initialize(&connection))
                {
                    Ok(()) => {
                        let elapsed =
                            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                        debug.record_timing(
                            "ann",
                            "background_load_completed",
                            None,
                            elapsed,
                            |_| {},
                        );
                    }
                    Err(error) => {
                        debug.record_with_metrics(
                            "ann",
                            "background_load_failed",
                            Some(error),
                            None,
                            |metrics| metrics.ann_load_failure_count += 1,
                        );
                    }
                },
                Err(error) => {
                    debug.record_with_metrics(
                        "ann",
                        "background_load_open_failed",
                        Some(error),
                        None,
                        |metrics| metrics.ann_load_failure_count += 1,
                    );
                }
            }
            enqueue_initial_scan_after_warmup(
                &signal_tx,
                &wake_pending,
                &pending,
                &runtime,
                &debug,
            );
        });
}

/// Enqueue a full scan using only the wake/pending handles.
///
/// Used by the indexer worker and the background ANN-load thread without a
/// full `ActiveSemanticState` borrow. Errors are logged to the semantic debug
/// stream rather than propagated, since the caller has nowhere to surface them.
fn enqueue_initial_scan_after_warmup(
    signal_tx: &Sender<WorkerSignal>,
    wake_pending: &AtomicBool,
    pending: &Mutex<PendingIndexState>,
    runtime: &Mutex<RuntimeState>,
    debug: &SemanticDebugState,
) {
    if let Ok(now) = current_time_millis() {
        if let Ok(mut runtime_guard) = runtime.lock() {
            runtime_guard.last_scan_requested_at_millis = Some(now);
        }
    }
    debug.record_with_metrics(
        "index",
        "enqueue_full_scan_after_warmup",
        None,
        None,
        |metrics| metrics.index_job_enqueued_count += 1,
    );
    if let Ok(mut pending_guard) = pending.lock() {
        if !pending_guard.rebuild_requested {
            pending_guard.full_scan_requested = true;
        }
    }
    if !wake_pending.swap(true, Ordering::AcqRel) {
        let _ = signal_tx.send(WorkerSignal::Wake);
    }
}
