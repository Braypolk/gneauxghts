pub(crate) mod activity;
pub(crate) mod ann;
mod ann_core;
pub(crate) mod atlas;
pub(crate) mod atlas_labels;
pub(crate) mod chunking;
pub(crate) mod db;
pub(crate) mod debug;
pub(crate) mod embed;
pub(crate) mod generation;
mod image_ann;
pub(crate) mod image_input;
mod image_inventory;
pub(crate) mod images;
pub(crate) mod indexer;
mod legacy_jina;
mod litert;
mod litert_ffi;
mod litert_install;
pub(crate) mod note_ann;
pub(crate) mod related;
mod runtime_install;
pub(crate) mod similarity;
#[cfg(test)]
mod test_support;

use self::{
    activity::BackgroundWorkGate,
    ann::AnnIndexState,
    atlas::{AtlasChatVisibilityKey, AtlasGenerationKey, AtlasSearchResponse, VaultAtlasResponse},
    db::{
        clear_atlas_cache, content_hash, count_indexed_items, delete_note,
        edges_are_stale_for_generation, edges_are_stale_for_model, ensure_schema,
        load_chunks_by_ann_labels, load_latest_job, load_note_chunk_labels, load_note_record,
        load_related_note_previews, load_related_note_previews_for_paths, load_semantic_settings,
        mark_running_jobs_interrupted, open_database, save_semantic_settings,
    },
    debug::{SemanticDebugSnapshot, SemanticDebugState},
    embed::{EmbeddingInputKind, EmbeddingProvider, ModelInfo},
    indexer::{
        chat_recall_content_hash, spawn_indexing_worker, ChatRecallExcerpt, IndexingWorkerContext,
        PendingIndexState, PendingNoteMove, PendingNoteUpdate, PendingSemanticDocument,
        SemanticWorkQueue,
    },
    litert::GemmaLiteRtEmbeddingProvider,
    note_ann::NoteAnnIndexState,
    related::{build_excerpt, related_scope_label},
    similarity::cosine_similarity,
};
use crate::time::current_time_millis;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Instant,
};

pub(crate) const SEMANTIC_RETRY_MAX_ATTEMPTS: u32 = 3;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticSettings {
    #[serde(default = "default_image_tokens")]
    pub(crate) image_tokens: u16,
    pub(crate) semantic_search_enabled: bool,
    pub(crate) lexical_weight: f32,
    pub(crate) semantic_weight: f32,
}

impl Default for SemanticSettings {
    fn default() -> Self {
        Self {
            image_tokens: default_image_tokens(),
            semantic_search_enabled: true,
            lexical_weight: 0.5,
            semantic_weight: 0.4,
        }
    }
}

fn default_image_tokens() -> u16 {
    70
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SemanticHealth {
    Fresh,
    Working,
    Stale,
    Degraded,
    Paused,
}

impl SemanticHealth {
    fn legacy_recovery_state(self) -> &'static str {
        match self {
            Self::Fresh => "ready",
            Self::Working => "catchingUp",
            Self::Stale | Self::Degraded => "stale",
            Self::Paused => "paused",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticStatus {
    pub(crate) image_coverage: images::ImageCoverage,
    pub(crate) text_ready: bool,
    pub(crate) image_capability: String,
    pub(crate) migration_state: String,
    pub(crate) previous_generation_available: bool,
    pub(crate) next_provider: generation::NextProvider,
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
    pub(crate) health: SemanticHealth,
    pub(crate) recovery_state: String,
    pub(crate) index_usable: bool,
    pub(crate) retry_attempt: u32,
    pub(crate) retry_max_attempts: u32,
    pub(crate) retry_exhausted: bool,
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
    indexing_in_progress: bool,
    current_job_label: Option<String>,
    last_indexed_at_millis: Option<u64>,
    last_error: Option<String>,
    last_scan_requested_at_millis: Option<u64>,
    health: SemanticHealth,
    retry_attempt: u32,
    retry_exhausted: bool,
    progress_current: usize,
    progress_total: usize,
    rebuild_reason: Option<String>,
    edges_stale: bool,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            indexing_in_progress: false,
            current_job_label: None,
            last_indexed_at_millis: None,
            last_error: None,
            last_scan_requested_at_millis: None,
            health: SemanticHealth::Working,
            retry_attempt: 0,
            retry_exhausted: false,
            progress_current: 0,
            progress_total: 0,
            rebuild_reason: None,
            edges_stale: false,
        }
    }
}

impl RuntimeState {
    fn reset_for_manual_retry(&mut self) {
        self.retry_attempt = 0;
        self.retry_exhausted = false;
        self.last_error = None;
        self.health = SemanticHealth::Working;
        self.indexing_in_progress = true;
        self.current_job_label = Some("Retrying semantic repair".to_string());
    }

    fn mark_query_failure(&mut self, error: &str) {
        self.last_error = Some(error.to_string());
        self.health = SemanticHealth::Degraded;
    }
}

fn queue_manual_retry_work(pending: &mut PendingIndexState, needs_rebuild: bool) {
    if needs_rebuild {
        pending.automatic_rebuild_requested = true;
    } else {
        pending.full_scan_requested = true;
        pending.force_full_scan = true;
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
    image_ann: Arc<image_ann::ImageAnnIndex>,
    generation: Arc<generation::SemanticGeneration>,
    work_queue: SemanticWorkQueue,
    index_revision: Arc<AtomicU64>,
    related_query_cache: Mutex<Vec<(String, u64, RelatedNotesResponse)>>,
    background_gate: Arc<BackgroundWorkGate>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

#[derive(Clone, Copy)]
enum WarmupScheduling {
    DeferredUntilAnnReady,
    WakeImmediately,
}

struct AnnStartupContext {
    ann: Arc<AnnIndexState>,
    note_ann: Arc<NoteAnnIndexState>,
    db_path: PathBuf,
    debug: Arc<SemanticDebugState>,
    work_queue: SemanticWorkQueue,
    runtime: Arc<Mutex<RuntimeState>>,
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
        let next_provider = generation::next_provider(&vault_data_dir)?;
        let legacy = next_provider == generation::NextProvider::Jina
            || (!GemmaLiteRtEmbeddingProvider::supported()
                && vault_data_dir.join("semantic.sqlite3").is_file());
        if !legacy && !GemmaLiteRtEmbeddingProvider::supported() {
            return Ok(Self::new_disabled("Gemma local search is unavailable on this device architecture. Keyword search remains available."));
        }
        fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
        // Derived databases and sidecars are vault-local and separated by
        // representation/platform; model artifacts remain device-local.
        fs::create_dir_all(&vault_data_dir).map_err(|err| err.to_string())?;
        let cache_dir = vault_data_dir
            .join(crate::state::VAULT_CACHE_DIR_NAME)
            .join(if legacy {
                "".into()
            } else {
                litert::text_namespace()
            });
        fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
        // A separate representation namespace preserves Jina's last-good
        // database and sidecars and cannot reuse same-dimension Jina vectors.
        let db_path = vault_data_dir.join(if legacy {
            "semantic.sqlite3".into()
        } else {
            format!("{}.sqlite3", litert::text_namespace())
        });

        // The model cache (large, device-specific, non-portable) stays
        // GLOBAL in app_data_dir; only the index + caches are vault-local.
        let semantic_dir = cache_dir.clone();
        let connection = open_database(&db_path)?;
        ensure_schema(&connection)?;
        mark_running_jobs_interrupted(&connection)?;
        let stored_settings = load_semantic_settings(&connection)?;
        let initial_settings = if let Some(settings) = stored_settings.clone() {
            settings
        } else {
            let legacy = vault_data_dir.join("semantic.sqlite3");
            if legacy.is_file() {
                load_semantic_settings(&open_database(&legacy)?)?.unwrap_or_default()
            } else {
                SemanticSettings::default()
            }
        };
        if stored_settings.is_none() {
            save_semantic_settings(&connection, &initial_settings)?;
        }
        let settings = Arc::new(Mutex::new(initial_settings));
        let debug = Arc::new(SemanticDebugState::new());
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> = if legacy {
            Arc::new(legacy_jina::JinaLlamaEmbeddingProvider::new(
                app_data_dir,
                bundled_runtime_path,
                debug.clone(),
            )?)
        } else {
            Arc::new(GemmaLiteRtEmbeddingProvider::new(
                app_data_dir,
                settings.clone(),
                debug.clone(),
            ))
        };
        let generation = Arc::new(generation::SemanticGeneration::staging(
            &connection,
            provider.model_info().fingerprint(),
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

        let image_ann = Arc::new(image_ann::ImageAnnIndex::new(semantic_dir.clone()));
        let initial_runtime = RuntimeState {
            edges_stale: initial_edges_stale,
            ..Default::default()
        };
        let runtime = Arc::new(Mutex::new(initial_runtime));
        let background_gate = Arc::new(BackgroundWorkGate::new());
        let initial_pending = PendingIndexState {
            edge_refresh_requested: initial_edges_stale,
            ..Default::default()
        };
        let (work_queue, signal_rx) = SemanticWorkQueue::new(initial_pending);
        let index_revision = Arc::new(AtomicU64::new(0));
        let worker = spawn_indexing_worker(
            IndexingWorkerContext {
                db_path: db_path.clone(),
                notes_dir: notes_dir.clone(),
                provider: provider.clone(),
                ann: ann.clone(),
                note_ann: note_ann.clone(),
                image_ann: image_ann.clone(),
                generation: generation.clone(),
                queue: work_queue.clone(),
                index_revision: index_revision.clone(),
                runtime: runtime.clone(),
                debug: debug.clone(),
                background_gate: background_gate.clone(),
            },
            signal_rx,
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
            image_ann,
            generation,
            work_queue: work_queue.clone(),
            index_revision,
            related_query_cache: Mutex::new(Vec::new()),
            background_gate,
            worker: Mutex::new(Some(worker)),
        };
        state.warmup_model_in_background(WarmupScheduling::DeferredUntilAnnReady);
        // Defer the persisted ANN snapshot load AND the initial vault
        // scan onto a background thread. Running the scan only after the
        // snapshot finishes loading prevents the worker from racing
        // ahead, finding an empty in-memory ANN, and rebuilding the
        // graph from scratch in SQLite — the load was already
        // authoritative.
        spawn_ann_initialize_and_scan_in_background(AnnStartupContext {
            ann,
            note_ann,
            db_path,
            debug,
            work_queue,
            runtime,
        });
        Ok(Self {
            inner: SemanticStateInner::Active(state),
        })
    }

    pub(crate) fn stage_next_provider(&self, use_previous: bool) -> Result<(), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Err("Local search is unavailable".into());
        };
        generation::stage_provider(
            state
                .db_path
                .parent()
                .ok_or("Semantic vault data unavailable")?,
            if use_previous {
                generation::NextProvider::Jina
            } else {
                generation::NextProvider::Gemma
            },
        )
    }

    pub(crate) fn bind_current_sources(
        &self,
        admission: crate::services::note_timeline::SemanticSourceAdmission,
    ) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.generation.bind_sources(admission);
        }
    }

    pub(crate) fn finish_startup_reconciliation(&self) -> Result<(), String> {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.generation.recall_finished();
            state.work_queue.enqueue(|_| {})?;
        }
        Ok(())
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
                state.work_queue.enqueue(|pending| {
                    if pending.rebuild_requested || pending.full_scan_requested {
                        return;
                    }
                    pending.deleted_notes.remove(note_path);
                    pending.note_updates.insert(
                        note_path.to_path_buf(),
                        PendingNoteUpdate {
                            document: PendingSemanticDocument::NoteMarkdown(markdown),
                            modified_millis,
                        },
                    );
                })
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
                let update = |pending: &mut PendingIndexState| {
                    pending.deleted_notes.remove(conversation_path);
                    pending.note_updates.insert(
                        conversation_path.to_path_buf(),
                        PendingNoteUpdate {
                            document: PendingSemanticDocument::ChatRecall { title, excerpts },
                            modified_millis,
                        },
                    );
                };
                if wake {
                    if let Ok(mut runtime) = state.runtime.lock() {
                        runtime.indexing_in_progress = true;
                        runtime.current_job_label = Some("Applying changes".to_string());
                        if !runtime.retry_exhausted {
                            runtime.health = SemanticHealth::Working;
                        }
                        runtime.progress_current = 0;
                        runtime.progress_total = 1;
                    }
                    state.work_queue.enqueue(update)
                } else {
                    state.work_queue.stage(update)
                }
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn queue_delete_note(&self, note_path: &Path) -> Result<(), String> {
        self.queue_delete_note_inner(note_path, true)
    }

    /// Remove queryable semantic rows and ANN labels before a permanent purge
    /// returns. Stable identity prevents recovery from deleting a replacement
    /// note that reused the same canonical path.
    pub(crate) fn purge_note_projection(
        &self,
        note_path: &Path,
        purged_note_id: &str,
    ) -> Result<(), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Ok(());
        };
        state
            .related_query_cache
            .lock()
            .map_err(|_| "Related query cache lock poisoned".to_string())?
            .clear();
        let mut connection = open_database(&state.db_path)?;
        ensure_schema(&connection)?;
        let path = note_path.to_string_lossy();
        let previous_note = load_note_record(&connection, &path)?;
        let belongs_to_purged_note = previous_note
            .as_ref()
            .is_some_and(|note| note.note_id.is_empty() || note.note_id == purged_note_id);
        if belongs_to_purged_note {
            let previous_labels = load_note_chunk_labels(&connection, &path)?;
            state.ann.apply_note_delete(&previous_labels)?;
            state.note_ann.apply_note_delete(
                previous_note
                    .as_ref()
                    .map(|note| note.stable_ann_label)
                    .unwrap_or(0),
            )?;
            delete_note(&mut connection, &path)?;
            state.index_revision.fetch_add(1, Ordering::AcqRel);
        }
        drop(connection);
        self.clear_atlas_cache()
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
                let update = |pending: &mut PendingIndexState| {
                    pending.note_updates.remove(note_path);
                    pending.deleted_notes.insert(note_path.to_path_buf());
                };
                if wake {
                    if let Ok(mut runtime) = state.runtime.lock() {
                        runtime.indexing_in_progress = true;
                        runtime.current_job_label = Some("Applying changes".to_string());
                        if !runtime.retry_exhausted {
                            runtime.health = SemanticHealth::Working;
                        }
                        runtime.progress_current = 0;
                        runtime.progress_total = 1;
                    }
                    state.work_queue.enqueue(update)
                } else {
                    state.work_queue.stage(update)
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
                state.work_queue.enqueue(|pending| {
                    if pending.rebuild_requested || pending.full_scan_requested {
                        return;
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
                })
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
                state.work_queue.enqueue(|pending| {
                    state.generation.rebuilding();
                    pending.rebuild_requested = true;
                    pending.full_scan_requested = false;
                    pending.force_full_scan = false;
                    pending.note_updates.clear();
                    pending.deleted_notes.clear();
                    pending.moved_notes.clear();
                })
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn retry_indexing_now(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                {
                    let mut runtime = state
                        .runtime
                        .lock()
                        .map_err(|_| "Semantic runtime lock poisoned".to_string())?;
                    runtime.reset_for_manual_retry();
                }
                state.work_queue.enqueue(|pending| {
                    queue_manual_retry_work(
                        pending,
                        state.ann.needs_rebuild() || state.note_ann.needs_rebuild(),
                    );
                })
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn record_query_failure(&self, error: &str) {
        if let SemanticStateInner::Active(state) = &self.inner {
            if let Ok(mut runtime) = state.runtime.lock() {
                runtime.mark_query_failure(error);
            }
        }
    }

    pub(crate) fn prepare_model(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let _work = state.work_queue.admit_work()?;
                state.provider.prepare()
            }
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn download_embedding_model(
        &self,
    ) -> Result<embed::SemanticModelDownloadResult, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let _work = state.work_queue.admit_work()?;
                state.provider.download_model_if_needed()
            }
            SemanticStateInner::Disabled(_) => {
                Err("Semantic search is disabled on this platform.".to_string())
            }
        }
    }

    /// Reversibly stop semantic producer admission and join every admitted
    /// indexer, model-warmup, and ANN-maintenance unit. Pending semantic work
    /// is rebuildable and is intentionally discarded rather than making a
    /// complete index catch-up a vault-portability requirement.
    pub(crate) fn quiesce_for_restart(&self) -> Result<(), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Ok(());
        };
        state.background_gate.set_manually_paused(true)?;
        state.provider.shutdown();
        state.work_queue.quiesce_and_discard()?;
        // A model warmup admitted just before quiescence may have restarted
        // the local provider while we were waiting for it. Stop once more
        // after every tracked unit has settled.
        state.provider.shutdown();
        Ok(())
    }

    pub(crate) fn resume_after_failed_restart(&self) -> Result<(), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Ok(());
        };
        let worker_usable = state
            .worker
            .lock()
            .map_err(|_| "Semantic worker lock poisoned".to_string())?
            .as_ref()
            .is_some_and(|worker| !worker.is_finished());
        if !worker_usable {
            return Err("Semantic worker is unavailable after restart preparation".to_string());
        }
        state.work_queue.resume_after_failed_restart()?;
        state.background_gate.set_manually_paused(false)
    }

    pub(crate) fn finish_restart_shutdown(&self) -> Result<(), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Ok(());
        };
        state.provider.shutdown();
        let mut worker = state
            .worker
            .lock()
            .map_err(|_| "Semantic worker lock poisoned".to_string())?;
        if worker.is_some() {
            state.work_queue.stop_worker()?;
        }
        if let Some(worker) = worker.take() {
            worker
                .join()
                .map_err(|_| "Semantic indexer panicked during shutdown".to_string())?;
        }
        Ok(())
    }

    pub(crate) fn warmup_model_in_background(&self) {
        if let SemanticStateInner::Active(state) = &self.inner {
            state.warmup_model_in_background(WarmupScheduling::WakeImmediately);
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
                state.work_queue.enqueue(|pending| {
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
                })
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
            SemanticStateInner::Active(state) => state.background_gate.set_manually_paused(true),
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn resume_indexing(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.background_gate.set_manually_paused(false)?;
                state.work_queue.request_wake()
            }
            SemanticStateInner::Disabled(_) => Ok(()),
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
        if !matches!(next_settings.image_tokens, 70 | 140) {
            return Err("Image detail must use 70 or 140 tokens.".into());
        }
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let connection = open_database(&state.db_path)?;
                ensure_schema(&connection)?;
                let mut settings = state
                    .settings
                    .lock()
                    .map_err(|_| "Semantic settings lock poisoned".to_string())?;
                let images_changed = settings.image_tokens != next_settings.image_tokens;
                save_semantic_settings(&connection, &next_settings)?;
                *settings = next_settings.clone();
                drop(settings);
                if images_changed {
                    state
                        .work_queue
                        .enqueue(|pending| pending.image_scan_requested = true)?;
                }
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

    pub(crate) fn queue_image_reconciliation(&self) -> Result<(), String> {
        if let SemanticStateInner::Active(state) = &self.inner {
            state
                .work_queue
                .enqueue(|pending| pending.image_scan_requested = true)?;
        }
        Ok(())
    }

    pub(crate) fn media_matches(
        &self,
        text: Option<&str>,
        image: Option<&[u8]>,
        allowed: Option<&std::collections::HashSet<String>>,
        root: &Path,
    ) -> Result<(Vec<images::ImageMatch>, Vec<SemanticChunkMatch>), String> {
        let SemanticStateInner::Active(state) = &self.inner else {
            return Err("Image search is unavailable on this device.".into());
        };
        let _work = state.work_queue.admit_work()?;
        if !state.get_settings()?.semantic_search_enabled {
            return Err("Enable semantic search in Settings to search images.".into());
        }
        let _generation = state.generation.require_active()?;
        let representation = state
            .provider
            .image_representation()
            .ok_or("Image search is unavailable.")?;
        let vector = if let Some(bytes) = image {
            state.provider.embed_image_query(bytes, text)?
        } else {
            state
                .provider
                .embed_texts(
                    &[text.ok_or("Search query is empty.")?.to_string()],
                    EmbeddingInputKind::Query,
                )?
                .into_iter()
                .next()
                .ok_or("No query embedding.")?
        };
        if state.provider.image_representation().as_deref() != Some(&representation) {
            return Err("Image detail changed. Search again.".into());
        }
        let images = images::search(
            &state.image_ann,
            &open_database(&state.db_path)?,
            root,
            &representation,
            &vector,
            allowed,
            state.provider.minimum_image_score(image.is_some()),
            12,
        )?;
        let paths = allowed.map(|paths| paths.iter().cloned().collect::<Vec<_>>());
        let passages = state.matches_for_vector(
            &vector,
            None,
            12,
            paths.as_deref(),
            None,
            if image.is_some() {
                state.provider.minimum_image_to_text_score()
            } else {
                state.provider.minimum_text_score()
            },
        )?;
        Ok((images, passages))
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
                let _work = state.work_queue.admit_work()?;
                let _generation = state.generation.require_active()?;
                state.semantic_matches_for_text(text, exclude_note_path, limit)
            }
            SemanticStateInner::Disabled(_) => Ok(Vec::new()),
        }
    }

    pub(crate) fn semantic_matches_for_text_scoped(
        &self,
        text: &str,
        exclude_note_path: Option<&str>,
        limit: usize,
        allowed_paths: Option<&[String]>,
        document_kind: Option<crate::note::DocumentKind>,
    ) -> Result<Vec<SemanticChunkMatch>, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let _work = state.work_queue.admit_work()?;
                let _generation = state.generation.require_active()?;
                state.semantic_matches_for_text_scoped(
                    text,
                    exclude_note_path,
                    limit,
                    allowed_paths,
                    document_kind,
                )
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
            SemanticStateInner::Active(state) => {
                let _work = state.work_queue.admit_work()?;
                let _generation = state.generation.require_active()?;
                state.related_notes(
                    current_path,
                    current_title,
                    current_markdown,
                    selected_text,
                    limit,
                )
            }
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
        notes_dir: &Path,
    ) -> Result<AtlasSearchResponse, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                let _work = state.work_queue.admit_work()?;
                let _generation = state.generation.require_active()?;
                state.search_vault_atlas(generation_key, query, activity_by_note_id, notes_dir)
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

    fn warmup_model_in_background(&self, scheduling: WarmupScheduling) {
        let provider = Arc::clone(&self.provider);
        let debug = Arc::clone(&self.debug);
        let db_path = self.db_path.clone();
        let note_ann = Arc::clone(&self.note_ann);
        let work_queue = self.work_queue.clone();
        let runtime = Arc::clone(&self.runtime);
        let Ok(work) = work_queue.admit_work() else {
            return;
        };
        let _ = thread::Builder::new()
            .name("semantic-model-warmup".to_string())
            .spawn(move || {
                let _work = work;
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
                            let update = |pending: &mut PendingIndexState| {
                                pending.edge_refresh_requested = true;
                            };
                            match scheduling {
                                WarmupScheduling::DeferredUntilAnnReady => {
                                    let _ = work_queue.stage(update);
                                }
                                WarmupScheduling::WakeImmediately => {
                                    let _ = work_queue.enqueue(update);
                                }
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
        let indexing_paused = self.background_gate.is_manually_paused()?;
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "Semantic runtime lock poisoned".to_string())?;

        Ok(SemanticStatus {
            text_ready: model.ready && self.generation.is_active(),
            image_capability: self.provider.image_capability().into(),
            migration_state: if self.generation.is_active() {
                "active"
            } else if runtime.retry_exhausted {
                "failed"
            } else {
                "staging"
            }
            .into(),
            previous_generation_available: self
                .db_path
                .parent()
                .is_some_and(|p| p.join("semantic.sqlite3").is_file()),
            next_provider: generation::next_provider(
                self.db_path
                    .parent()
                    .ok_or("Semantic vault data unavailable")?,
            )?,
            image_coverage: self
                .provider
                .image_representation()
                .map(|r| images::coverage(&connection, &r))
                .transpose()?
                .unwrap_or_default(),
            settings,
            model_available: model.available,
            model: model.clone(),
            platform_supported: true,
            disabled_reason: None,
            indexing_paused,
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
            health: if indexing_paused {
                SemanticHealth::Paused
            } else {
                runtime.health
            },
            recovery_state: if indexing_paused {
                SemanticHealth::Paused.legacy_recovery_state().to_string()
            } else {
                runtime.health.legacy_recovery_state().to_string()
            },
            index_usable: ann_status.loaded && self.generation.is_active(),
            retry_attempt: runtime.retry_attempt,
            retry_max_attempts: SEMANTIC_RETRY_MAX_ATTEMPTS,
            retry_exhausted: runtime.retry_exhausted,
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
        self.semantic_matches_for_text_scoped(text, exclude_note_path, limit, None, None)
    }

    fn semantic_matches_for_text_scoped(
        &self,
        text: &str,
        exclude_note_path: Option<&str>,
        limit: usize,
        allowed_paths: Option<&[String]>,
        document_kind: Option<crate::note::DocumentKind>,
    ) -> Result<Vec<SemanticChunkMatch>, String> {
        if allowed_paths.is_some_and(|paths| paths.is_empty()) {
            return Ok(Vec::new());
        }
        let settings = self.get_settings()?;
        if !settings.semantic_search_enabled {
            return Ok(Vec::new());
        }
        let ann_status = self.ann.status_snapshot();
        if allowed_paths.is_none()
            && document_kind.is_none()
            && (!ann_status.loaded || ann_status.indexed_chunks == 0)
        {
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
        self.matches_for_vector(
            &query_embedding,
            exclude_note_path,
            limit,
            allowed_paths,
            document_kind,
            self.provider.minimum_text_score(),
        )
    }

    fn matches_for_vector(
        &self,
        query_embedding: &[f32],
        exclude_note_path: Option<&str>,
        limit: usize,
        allowed_paths: Option<&[String]>,
        document_kind: Option<crate::note::DocumentKind>,
        minimum_score: f32,
    ) -> Result<Vec<SemanticChunkMatch>, String> {
        let started_at = Instant::now();
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        // Admit the requested document kind before any candidate limit. Filtering
        // an overfetched ANN result afterward can still starve ordinary notes when
        // chat excerpts dominate the nearest neighbors.
        let candidate_labels = if let Some(paths) = allowed_paths {
            let mut statement = connection
                .prepare(
                    "SELECT c.ann_label FROM chunks c JOIN notes n ON n.path = c.note_path
                    WHERE c.note_path = ?1 AND (?2 IS NULL OR n.document_kind = ?2)",
                )
                .map_err(|err| err.to_string())?;
            let mut labels = Vec::new();
            for path in paths {
                let rows = statement
                    .query_map(
                        rusqlite::params![
                            path,
                            document_kind.map(|kind| kind.as_frontmatter_value())
                        ],
                        |row| row.get::<_, u64>(0),
                    )
                    .map_err(|err| err.to_string())?;
                for label in rows {
                    labels.push(label.map_err(|err| err.to_string())?);
                }
            }
            labels
        } else if let Some(kind) = document_kind {
            let mut statement = connection
                .prepare(
                    "SELECT c.ann_label FROM chunks c JOIN notes n ON n.path = c.note_path
                 WHERE n.document_kind = ?1",
                )
                .map_err(|err| err.to_string())?;
            let rows = statement
                .query_map([kind.as_frontmatter_value()], |row| row.get::<_, u64>(0))
                .map_err(|err| err.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|err| err.to_string())?
        } else {
            self.ann
                .search(&query_embedding, limit.saturating_mul(8).max(64))?
        };
        let mut chunks = Vec::new();
        for labels in candidate_labels.chunks(400) {
            chunks.extend(load_chunks_by_ann_labels(&connection, labels)?);
        }
        let mut current_paths = std::collections::HashSet::new();
        for chunk in &chunks {
            if current_paths.contains(&chunk.note_path) {
                continue;
            }
            if load_note_record(&connection, &chunk.note_path)?.is_some_and(|record| {
                if record.document_kind.is_chat_projection() {
                    return true;
                }
                fs::read_to_string(&chunk.note_path).is_ok_and(|markdown| {
                    crate::note::semantic_recall_eligible(&markdown)
                        && content_hash(&markdown) == record.content_hash
                })
            }) {
                current_paths.insert(chunk.note_path.clone());
            }
        }
        let reranked_count = candidate_labels.len();
        let mut matches = chunks
            .into_iter()
            .filter(|chunk| current_paths.contains(&chunk.note_path))
            .filter(|chunk| exclude_note_path != Some(chunk.note_path.as_str()))
            .filter_map(|chunk| {
                let score = cosine_similarity(&query_embedding, &chunk.embedding);
                if score < minimum_score {
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
            text_ready: false,
            image_capability: "unsupported".into(),
            migration_state: "unavailable".into(),
            previous_generation_available: false,
            next_provider: generation::NextProvider::Gemma,
            image_coverage: images::ImageCoverage::default(),
            settings,
            model: ModelInfo {
                id: "semantic-disabled".to_string(),
                label: "Semantic Search Disabled".to_string(),
                dimensions: 0,
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
            health: SemanticHealth::Fresh,
            recovery_state: "ready".to_string(),
            index_usable: false,
            retry_attempt: 0,
            retry_max_attempts: SEMANTIC_RETRY_MAX_ATTEMPTS,
            retry_exhausted: false,
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
fn spawn_ann_initialize_and_scan_in_background(context: AnnStartupContext) {
    let Ok(work) = context.work_queue.admit_work() else {
        return;
    };
    let _ = thread::Builder::new()
        .name("semantic-ann-initialize".to_string())
        .spawn(move || {
            let _work = work;
            let started_at = Instant::now();
            let connection_result = open_database(&context.db_path).and_then(|connection| {
                ensure_schema(&connection)?;
                Ok(connection)
            });
            match connection_result {
                Ok(connection) => match context
                    .ann
                    .initialize(&connection)
                    .and_then(|()| context.note_ann.initialize(&connection))
                {
                    Ok(()) => {
                        let elapsed =
                            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                        context.debug.record_timing(
                            "ann",
                            "background_load_completed",
                            None,
                            elapsed,
                            |_| {},
                        );
                    }
                    Err(error) => {
                        context.debug.record_with_metrics(
                            "ann",
                            "background_load_failed",
                            Some(error),
                            None,
                            |metrics| metrics.ann_load_failure_count += 1,
                        );
                    }
                },
                Err(error) => {
                    context.debug.record_with_metrics(
                        "ann",
                        "background_load_open_failed",
                        Some(error),
                        None,
                        |metrics| metrics.ann_load_failure_count += 1,
                    );
                }
            }
            context
                .work_queue
                .release_initial_scan(&context.runtime, &context.debug);
        });
}

#[cfg(test)]
mod health_tests {
    use super::*;
    use crate::test_support::TestDir;

    struct StatusEmbeddingProvider;

    impl EmbeddingProvider for StatusEmbeddingProvider {
        fn embed_texts(
            &self,
            texts: &[String],
            _kind: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            Ok(vec![vec![1.0, 0.0, 0.0]; texts.len()])
        }

        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }

        fn model_info(&self) -> ModelInfo {
            ModelInfo {
                id: "status-test".to_string(),
                label: "Status Test".to_string(),
                dimensions: 3,
                runtime_binary_path: None,
                model_path: None,
                model_repo_id: "status-test".to_string(),
                available: true,
                loading: false,
                ready: true,
                status: "ready".to_string(),
                error: None,
            }
        }

        fn shutdown(&self) {}
    }

    fn active_status_state(
        runtime: RuntimeState,
    ) -> (
        SemanticState,
        std::sync::mpsc::Receiver<indexer::WorkerSignal>,
        TestDir,
    ) {
        let temp = TestDir::new("semantic-status");
        let db_path = temp.path().join("semantic.sqlite3");
        let connection = open_database(&db_path).expect("open status database");
        ensure_schema(&connection).expect("create status schema");
        drop(connection);
        let debug = Arc::new(SemanticDebugState::new());
        let ann = Arc::new(
            AnnIndexState::new(temp.path().join("ann"), 3, debug.clone())
                .expect("create status ann"),
        );
        let note_ann = Arc::new(
            NoteAnnIndexState::new(temp.path().join("note-ann"), 3, "status-test".to_string())
                .expect("create status note ann"),
        );
        let (work_queue, signals) = SemanticWorkQueue::new(PendingIndexState::default());
        let state = SemanticState {
            inner: SemanticStateInner::Active(ActiveSemanticState {
                image_ann: Arc::new(super::image_ann::ImageAnnIndex::new(
                    temp.path().join("images"),
                )),
                generation: Arc::new(super::generation::SemanticGeneration::ready_for_test()),
                db_path,
                atlas_cache_dir: temp.path().join("atlas"),
                settings: Arc::new(Mutex::new(SemanticSettings::default())),
                provider: Arc::new(StatusEmbeddingProvider),
                runtime: Arc::new(Mutex::new(runtime)),
                debug,
                ann,
                note_ann,
                work_queue,
                index_revision: Arc::new(AtomicU64::new(0)),
                related_query_cache: Mutex::new(Vec::new()),
                background_gate: Arc::new(BackgroundWorkGate::new()),
                worker: Mutex::new(None),
            }),
        };
        (state, signals, temp)
    }

    #[test]
    fn scoped_query_admits_document_kind_before_candidate_limits() {
        use crate::note::DocumentKind;
        use crate::semantic::chunking::SemanticChunk;
        use crate::semantic::db::{upsert_note_chunks, SemanticNoteMetadata};

        let (state, _signals, temp) = active_status_state(RuntimeState::default());
        let SemanticStateInner::Active(active) = &state.inner else {
            unreachable!()
        };
        let mut connection = crate::semantic::test_support::database(&active.db_path);
        let mut paths = Vec::new();
        // More perfect chat matches than either the requested top-k or the ANN
        // overfetch floor. The ordinary note is relevant but ranks after them.
        for (name, kind, count, embedding) in [
            ("chat", DocumentKind::ChatIndex, 80, vec![1.0, 0.0, 0.0]),
            ("ordinary", DocumentKind::Note, 1, vec![0.8, 0.6, 0.0]),
        ] {
            let path = temp.path().join(format!("{name}.md"));
            fs::write(&path, name).unwrap();
            let path = path.to_string_lossy().into_owned();
            let chunks = (0..count)
                .map(|ordinal| SemanticChunk {
                    ordinal,
                    section_label: name.into(),
                    text: format!("{name} passage {ordinal}"),
                    text_hash: format!("{name}-{ordinal}"),
                    start_line: ordinal + 1,
                    end_line: ordinal + 1,
                    block_anchor: None,
                })
                .collect::<Vec<_>>();
            upsert_note_chunks(
                &mut connection,
                &path,
                name,
                1,
                &content_hash(name),
                "",
                "",
                kind,
                &SemanticNoteMetadata::default(),
                &chunks,
                &vec![embedding; count],
            )
            .unwrap();
            paths.push(path);
        }
        active.ann.rebuild_from_connection(&connection).unwrap();
        let ordinary = state
            .semantic_matches_for_text_scoped("query", None, 1, None, Some(DocumentKind::Note))
            .unwrap();
        assert_eq!(ordinary.len(), 1);
        assert_eq!(ordinary[0].note_path, paths[1]);
        assert_eq!(ordinary[0].document_kind, DocumentKind::Note);
        let all = state
            .semantic_matches_for_text_scoped("query", None, 1, None, None)
            .unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].document_kind, DocumentKind::ChatIndex);
        assert_eq!(
            state.semantic_matches_for_text("query", None, 1).unwrap()[0].document_kind,
            DocumentKind::ChatIndex
        );
        let chat_path_only = &paths[..1];
        assert!(state
            .semantic_matches_for_text_scoped(
                "query",
                None,
                1,
                Some(chat_path_only),
                Some(DocumentKind::Note)
            )
            .unwrap()
            .is_empty());
        assert_eq!(
            state
                .semantic_matches_for_text_scoped(
                    "query",
                    None,
                    1,
                    Some(&paths),
                    Some(DocumentKind::Note)
                )
                .unwrap()[0]
                .note_path,
            paths[1]
        );
        assert!(state
            .semantic_matches_for_text_scoped(
                "query",
                Some(&paths[1]),
                1,
                None,
                Some(DocumentKind::Note)
            )
            .unwrap()
            .is_empty());
    }

    #[test]
    #[ignore = "requires pinned local Gemma/Jina models and native GPU/runtime"]
    fn native_generation_migration_and_jina_recovery() {
        let _environment = crate::test_support::lock_test_env();
        let temp = crate::test_support::TestDir::new("native-generation-recovery");
        let app_data = temp.path().join("app");
        let root = temp.path().join("vault");
        fs::create_dir_all(root.join("assets")).unwrap();
        crate::state::initialize_app_data_dir(app_data.clone()).unwrap();
        crate::state::set_notes_root_override(Some(root.clone())).unwrap();
        let fixture = PathBuf::from(std::env::var("GNEAUXGHTS_LITERT_FIXTURE").unwrap());
        super::litert_install::tests::install_fixture(
            &app_data,
            &fixture.join("litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl"),
        );
        let models = app_data.join("semantic/models");
        fs::create_dir_all(&models).unwrap();
        fs::copy(
            fixture.join(super::litert_install::MODEL_FILE),
            models.join(super::litert_install::MODEL_FILE),
        )
        .unwrap();
        fs::copy(
            std::env::var("GNEAUXGHTS_JINA_MODEL").unwrap(),
            models.join("jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf"),
        )
        .unwrap();
        fs::copy(
            fixture.join("visual-fixtures/privacy.png"),
            root.join("assets/privacy.png"),
        )
        .unwrap();
        let note = root.join("Privacy.md");
        fs::write(&note,"# Privacy

An application settings screenshot with Privacy and Sharing, public sharing and allow analytics toggles.

![[privacy.png]]").unwrap();
        let running = crate::state::RunningVault::resolve(app_data.clone()).unwrap();
        let vault_data = running.data_dir().to_path_buf();
        let legacy = vault_data.join("semantic.sqlite3");
        drop(crate::semantic::test_support::database(&legacy));
        let retained = fs::read(&legacy).unwrap();
        let compose = |running: crate::state::RunningVault| {
            let semantic = SemanticState::new_with_runtime(
                app_data.clone(),
                vault_data.clone(),
                root.clone(),
                Some(PathBuf::from("/opt/homebrew/bin/llama-server")),
            )
            .unwrap();
            crate::index::AppState::new_with_running_vault(
                running,
                semantic,
                crate::app::EventBus::disabled(),
            )
            .unwrap()
        };
        let wait = |state: &crate::index::AppState| {
            let deadline = Instant::now() + std::time::Duration::from_secs(90);
            loop {
                let status = state.semantic.get_status().unwrap();
                if status.migration_state == "active" {
                    break;
                }
                assert!(!status.retry_exhausted, "{:?}", status.last_error);
                assert!(
                    Instant::now() < deadline,
                    "migration timed out: {:?}",
                    status
                );
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        };
        let state = compose(running);
        assert_eq!(
            state.semantic.get_status().unwrap().migration_state,
            "staging"
        );
        assert!(state
            .semantic
            .semantic_matches_for_text("Privacy settings", None, 3)
            .is_err());
        state.semantic.finish_startup_reconciliation().unwrap();
        wait(&state);
        let (images, passages) = state
            .semantic
            .media_matches(
                Some("Privacy and Sharing settings with public sharing and analytics"),
                None,
                None,
                &root,
            )
            .unwrap();
        assert_eq!(images.len(), 1);
        assert!(!passages.is_empty());
        assert_eq!(fs::read(&legacy).unwrap(), retained);
        state.semantic.stage_next_provider(true).unwrap();
        state.semantic.finish_restart_shutdown().unwrap();
        drop(state);
        let recovered = compose(crate::state::RunningVault::resolve(app_data.clone()).unwrap());
        assert_eq!(
            recovered.semantic.get_status().unwrap().model.id,
            "jinaai/jina-embeddings-v5-text-nano-retrieval"
        );
        assert_eq!(
            recovered.semantic.get_status().unwrap().image_capability,
            "unsupported"
        );
        recovered.semantic.finish_startup_reconciliation().unwrap();
        wait(&recovered);
        assert!(!recovered
            .semantic
            .semantic_matches_for_text("Privacy and sharing settings", None, 3)
            .unwrap()
            .is_empty());
        recovered.semantic.finish_restart_shutdown().unwrap();
    }

    #[test]
    fn image_budget_defaults_persists_and_only_queues_image_work() {
        let (state, _signals, _temp) = active_status_state(RuntimeState::default());
        assert_eq!(state.get_settings().unwrap().image_tokens, 70);
        let mut settings = state.get_settings().unwrap();
        settings.image_tokens = 140;
        state.set_settings(settings.clone()).unwrap();
        let SemanticStateInner::Active(active) = &state.inner else {
            panic!()
        };
        let saved = load_semantic_settings(&open_database(&active.db_path).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(saved.image_tokens, 140);
        active
            .work_queue
            .stage(|pending| {
                assert!(pending.image_scan_requested);
                assert!(!pending.full_scan_requested);
                assert!(!pending.rebuild_requested);
                assert!(pending.atlas_requests.is_empty());
            })
            .unwrap();
        assert_eq!(active.index_revision.load(Ordering::Acquire), 0);
        settings.image_tokens = 280;
        assert!(state.set_settings(settings).is_err());
        assert_eq!(state.get_settings().unwrap().image_tokens, 140);
    }
    #[test]
    fn legacy_local_only_setting_is_ignored_when_loading_saved_settings() {
        let settings: SemanticSettings = serde_json::from_value(serde_json::json!({
            "semanticSearchEnabled": true,
            "localOnlyMode": true,
            "lexicalWeight": 0.5,
            "semanticWeight": 0.4
        }))
        .expect("legacy semantic settings should still load");

        assert_eq!(settings.image_tokens, 70);
        let saved = serde_json::to_value(settings).expect("semantic settings should serialize");
        assert!(saved.get("localOnlyMode").is_none());
    }

    #[test]
    fn query_failure_degrades_without_consuming_the_worker_retry_budget() {
        let mut runtime = RuntimeState {
            retry_attempt: 2,
            ..Default::default()
        };

        runtime.mark_query_failure("query embedding failed");

        assert_eq!(runtime.health, SemanticHealth::Degraded);
        assert_eq!(runtime.retry_attempt, 2);
        assert!(!runtime.retry_exhausted);
        assert_eq!(
            runtime.last_error.as_deref(),
            Some("query embedding failed")
        );
    }

    #[test]
    fn manual_retry_resets_the_bound_and_queues_the_needed_repair() {
        let mut runtime = RuntimeState {
            retry_attempt: SEMANTIC_RETRY_MAX_ATTEMPTS,
            retry_exhausted: true,
            health: SemanticHealth::Degraded,
            last_error: Some("failed".to_string()),
            ..RuntimeState::default()
        };
        let mut pending = PendingIndexState {
            full_scan_requested: true,
            ..PendingIndexState::default()
        };

        runtime.reset_for_manual_retry();
        queue_manual_retry_work(&mut pending, true);

        assert_eq!(runtime.retry_attempt, 0);
        assert!(!runtime.retry_exhausted);
        assert_eq!(runtime.health, SemanticHealth::Working);
        assert!(runtime.indexing_in_progress);
        assert!(pending.full_scan_requested);
        assert!(pending.automatic_rebuild_requested);
    }

    #[test]
    fn paused_status_overlays_but_does_not_erase_retry_exhaustion() {
        let (semantic, _signals, _temp) = active_status_state(RuntimeState {
            health: SemanticHealth::Degraded,
            retry_attempt: SEMANTIC_RETRY_MAX_ATTEMPTS,
            retry_exhausted: true,
            last_error: Some("repair failed".to_string()),
            ..RuntimeState::default()
        });

        semantic.pause_indexing().expect("pause indexing");
        let paused = semantic.get_status().expect("paused status");
        assert!(paused.indexing_paused);
        assert_eq!(paused.health, SemanticHealth::Paused);
        assert_eq!(paused.recovery_state, "paused");
        assert!(paused.retry_exhausted);
        assert_eq!(paused.retry_attempt, SEMANTIC_RETRY_MAX_ATTEMPTS);

        semantic.resume_indexing().expect("resume indexing");
        let resumed = semantic.get_status().expect("resumed status");
        assert!(!resumed.indexing_paused);
        assert_eq!(resumed.health, SemanticHealth::Degraded);
        assert_eq!(resumed.recovery_state, "stale");
        assert!(resumed.retry_exhausted);
        assert_eq!(resumed.last_error.as_deref(), Some("repair failed"));
    }

    #[test]
    fn health_states_derive_compatible_legacy_recovery_values() {
        assert_eq!(SemanticHealth::Fresh.legacy_recovery_state(), "ready");
        assert_eq!(
            SemanticHealth::Working.legacy_recovery_state(),
            "catchingUp"
        );
        assert_eq!(SemanticHealth::Stale.legacy_recovery_state(), "stale");
        assert_eq!(SemanticHealth::Degraded.legacy_recovery_state(), "stale");
        assert_eq!(SemanticHealth::Paused.legacy_recovery_state(), "paused");
    }
}
