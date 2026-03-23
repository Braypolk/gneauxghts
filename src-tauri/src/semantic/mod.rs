pub(crate) mod ann;
pub(crate) mod chunking;
pub(crate) mod db;
pub(crate) mod debug;
pub(crate) mod embed;
pub(crate) mod indexer;
pub(crate) mod similarity;

use self::{
    ann::AnnIndexState,
    db::{
        content_hash, count_indexed_items, ensure_schema, load_chunks_by_ann_labels,
        load_graph_data, load_latest_job, load_note_record, load_related_note_previews,
        load_semantic_settings, open_database, save_semantic_settings,
    },
    debug::{SemanticDebugSnapshot, SemanticDebugState},
    embed::{EmbeddingInputKind, EmbeddingProvider, JinaLlamaEmbeddingProvider, ModelInfo},
    indexer::{spawn_indexing_worker, PendingIndexState, PendingNoteUpdate, WorkerSignal},
    similarity::cosine_similarity,
};
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
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const RELATED_QUERY_CACHE_LIMIT: usize = 32;
const MIN_RELATED_NOTE_CHARS: usize = 80;
const MIN_RELATED_SELECTION_CHARS: usize = 48;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticSettings {
    pub(crate) semantic_search_enabled: bool,
    pub(crate) local_only_mode: bool,
    pub(crate) auto_download_model: bool,
    pub(crate) lexical_weight: f32,
    pub(crate) semantic_weight: f32,
    pub(crate) graph_min_score: f32,
    pub(crate) strongest_links_only: bool,
}

impl Default for SemanticSettings {
    fn default() -> Self {
        Self {
            semantic_search_enabled: true,
            local_only_mode: true,
            auto_download_model: false,
            lexical_weight: 0.5,
            semantic_weight: 0.4,
            graph_min_score: 0.46,
            strongest_links_only: false,
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
    pub(crate) last_indexed_at_millis: Option<u64>,
    pub(crate) last_error: Option<String>,
    pub(crate) current_job_label: Option<String>,
    pub(crate) latest_job: Option<SemanticIndexJob>,
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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedNotesResponse {
    pub(crate) status: String,
    pub(crate) scope: String,
    pub(crate) reason: Option<String>,
    pub(crate) items: Vec<RelatedNoteMatch>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MapNode {
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) degree: usize,
    pub(crate) x: f32,
    pub(crate) y: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MapEdge {
    pub(crate) source_note_path: String,
    pub(crate) target_note_path: String,
    pub(crate) score: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MapGraph {
    pub(crate) nodes: Vec<MapNode>,
    pub(crate) edges: Vec<MapEdge>,
    pub(crate) min_score: f32,
}

#[derive(Default)]
pub(super) struct RuntimeState {
    indexing_paused: bool,
    indexing_in_progress: bool,
    current_job_label: Option<String>,
    last_indexed_at_millis: Option<u64>,
    last_error: Option<String>,
    last_scan_requested_at_millis: Option<u64>,
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
    settings: Arc<Mutex<SemanticSettings>>,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    runtime: Arc<Mutex<RuntimeState>>,
    debug: Arc<SemanticDebugState>,
    ann: Arc<AnnIndexState>,
    signal_tx: Sender<WorkerSignal>,
    pending: Arc<Mutex<PendingIndexState>>,
    wake_pending: Arc<AtomicBool>,
    index_revision: Arc<AtomicU64>,
    related_query_cache: Mutex<Vec<(String, u64, RelatedNotesResponse)>>,
}

struct DisabledSemanticState {
    settings: Mutex<SemanticSettings>,
    debug: Arc<SemanticDebugState>,
    reason: String,
}

impl SemanticState {
    pub(crate) fn new_with_runtime(
        app_data_dir: PathBuf,
        notes_dir: PathBuf,
        bundled_runtime_path: Option<PathBuf>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
        let semantic_dir = app_data_dir.join("semantic");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let connection = open_database(&db_path)?;
        ensure_schema(&connection)?;
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
        ann.initialize(&connection)?;
        drop(connection);

        let runtime = Arc::new(Mutex::new(RuntimeState::default()));
        let pending = Arc::new(Mutex::new(PendingIndexState::default()));
        let wake_pending = Arc::new(AtomicBool::new(false));
        let index_revision = Arc::new(AtomicU64::new(0));
        let (signal_tx, signal_rx) = mpsc::channel();
        spawn_indexing_worker(
            db_path.clone(),
            notes_dir.clone(),
            provider.clone(),
            ann.clone(),
            signal_rx,
            pending.clone(),
            wake_pending.clone(),
            index_revision.clone(),
            &runtime,
            debug.clone(),
        )?;

        let state = ActiveSemanticState {
            db_path,
            settings,
            provider,
            runtime,
            debug,
            ann,
            signal_tx,
            pending,
            wake_pending,
            index_revision,
            related_query_cache: Mutex::new(Vec::new()),
        };
        state.enqueue_scan(false)?;
        state.warmup_model_in_background();
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

    pub(crate) fn queue_delete_note(&self, note_path: &Path) -> Result<(), String> {
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
                    if pending.rebuild_requested || pending.full_scan_requested {
                        return Ok(());
                    }
                    pending.note_updates.remove(note_path);
                    pending.deleted_notes.insert(note_path.to_path_buf());
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

    pub(crate) fn debug_snapshot(&self) -> Result<SemanticDebugSnapshot, String> {
        self.debug_state().snapshot()
    }

    pub(crate) fn clear_debug_metrics(&self) -> Result<(), String> {
        self.debug_state().clear()
    }

    pub(crate) fn debug_state(&self) -> Arc<SemanticDebugState> {
        match &self.inner {
            SemanticStateInner::Active(state) => Arc::clone(&state.debug),
            SemanticStateInner::Disabled(state) => Arc::clone(&state.debug),
        }
    }

    pub(crate) fn pause_indexing(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state
                .signal_tx
                .send(WorkerSignal::SetPaused { paused: true })
                .map_err(|err| err.to_string()),
            SemanticStateInner::Disabled(_) => Ok(()),
        }
    }

    pub(crate) fn resume_indexing(&self) -> Result<(), String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state
                .signal_tx
                .send(WorkerSignal::SetPaused { paused: false })
                .map_err(|err| err.to_string()),
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
        current_markdown: &str,
        selected_text: Option<&str>,
        limit: usize,
    ) -> Result<RelatedNotesResponse, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => {
                state.related_notes(current_path, current_markdown, selected_text, limit)
            }
            SemanticStateInner::Disabled(state) => Ok(RelatedNotesResponse {
                status: "unavailable".to_string(),
                scope: related_scope_label(selected_text),
                reason: Some(state.reason.clone()),
                items: Vec::new(),
            }),
        }
    }

    pub(crate) fn map_graph(&self, limit: usize, min_score: f32) -> Result<MapGraph, String> {
        match &self.inner {
            SemanticStateInner::Active(state) => state.map_graph(limit, min_score),
            SemanticStateInner::Disabled(_) => Ok(MapGraph {
                nodes: Vec::new(),
                edges: Vec::new(),
                min_score,
            }),
        }
    }
}

impl ActiveSemanticState {
    fn record_related_response(
        &self,
        scope: &str,
        status: &str,
        strategy: &str,
        item_count: usize,
        elapsed: u64,
    ) {
        self.debug.record_timing(
            "related",
            "related_completed",
            Some(format!(
                "scope={scope} status={status} strategy={strategy} items={item_count}"
            )),
            elapsed,
            |metrics| {
                metrics.related_request_count += 1;
                if scope == "selection" {
                    metrics.related_selection_request_count += 1;
                } else {
                    metrics.related_note_request_count += 1;
                }
                match strategy {
                    "cache" => metrics.related_cache_hit_count += 1,
                    "edges" => metrics.related_edge_reuse_count += 1,
                    "semantic" => metrics.related_semantic_query_count += 1,
                    _ => {}
                }
                if status == "insufficientContent" {
                    metrics.related_insufficient_content_count += 1;
                }
                if status == "unavailable" {
                    metrics.related_unavailable_count += 1;
                }
                metrics.related_result_total += item_count as u64;
                metrics.related_duration_total_millis += elapsed;
                metrics.related_duration_max_millis =
                    metrics.related_duration_max_millis.max(elapsed);
            },
        );
    }

    fn get_settings(&self) -> Result<SemanticSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "Semantic settings lock poisoned".to_string())
    }

    fn enqueue_scan(&self, force: bool) -> Result<(), String> {
        let now = current_time_millis()?;
        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "Semantic runtime lock poisoned".to_string())?;
            runtime.last_scan_requested_at_millis = Some(now);
        }
        self.debug.record_with_metrics(
            "index",
            if force {
                "enqueue_full_scan_force"
            } else {
                "enqueue_full_scan"
            },
            None,
            None,
            |metrics| metrics.index_job_enqueued_count += 1,
        );
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "Semantic pending state lock poisoned".to_string())?;
            if !pending.rebuild_requested {
                pending.full_scan_requested = true;
                pending.force_full_scan |= force;
                pending.note_updates.clear();
                pending.deleted_notes.clear();
            }
        }
        self.request_wake()
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
        let _ = thread::Builder::new()
            .name("semantic-model-warmup".to_string())
            .spawn(move || {
                let started_at = std::time::Instant::now();
                debug.record_with_metrics("runtime", "warmup_started", None, None, |metrics| {
                    metrics.model_warmup_count += 1;
                });
                match provider.prepare() {
                    Ok(()) => {
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
            last_indexed_at_millis: runtime.last_indexed_at_millis.or(last_indexed_at_millis),
            last_error: runtime.last_error.clone().or(model.error.clone()),
            current_job_label: runtime.current_job_label.clone(),
            latest_job,
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
                if score < 0.18 {
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

    fn related_notes(
        &self,
        current_path: Option<&str>,
        current_markdown: &str,
        selected_text: Option<&str>,
        limit: usize,
    ) -> Result<RelatedNotesResponse, String> {
        let started_at = Instant::now();
        let scope = related_scope_label(selected_text);
        let normalized_markdown = normalize_related_text(current_markdown);
        let normalized_selection = selected_text
            .map(normalize_related_text)
            .filter(|text| !text.is_empty());

        if !self.get_settings()?.semantic_search_enabled {
            let response = RelatedNotesResponse {
                status: "unavailable".to_string(),
                scope: scope.clone(),
                reason: Some("Semantic search is disabled in Settings.".to_string()),
                items: Vec::new(),
            };
            self.record_related_response(
                &scope,
                &response.status,
                "disabled",
                response.items.len(),
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(response);
        }

        if selected_text.is_some()
            && normalized_selection
                .as_ref()
                .is_none_or(|text| text.chars().count() < MIN_RELATED_SELECTION_CHARS)
        {
            let response = RelatedNotesResponse {
                status: "insufficientContent".to_string(),
                scope: scope.clone(),
                reason: Some("Select a larger passage to find section-specific notes.".to_string()),
                items: Vec::new(),
            };
            self.record_related_response(
                &scope,
                &response.status,
                "none",
                0,
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(response);
        }

        if selected_text.is_none() && normalized_markdown.chars().count() < MIN_RELATED_NOTE_CHARS {
            let response = RelatedNotesResponse {
                status: "insufficientContent".to_string(),
                scope: scope.clone(),
                reason: Some("Write a bit more before looking for related notes.".to_string()),
                items: Vec::new(),
            };
            self.record_related_response(
                &scope,
                &response.status,
                "none",
                0,
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(response);
        }

        let revision = self.index_revision.load(Ordering::Acquire);
        let cache_key = build_related_cache_key(
            revision,
            current_path,
            current_markdown,
            normalized_selection.as_deref(),
            limit,
        );
        if let Some(cached) = self.lookup_related_query_cache(&cache_key, revision)? {
            self.record_related_response(
                &scope,
                &cached.status,
                "cache",
                cached.items.len(),
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(cached);
        }

        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let effective_limit = limit.max(1);

        let (response, strategy) = if normalized_selection.is_none() {
            match current_path
                .zip(load_note_record(
                    &connection,
                    current_path.unwrap_or_default(),
                )?)
                .filter(|(note_path, stored)| {
                    stored.content_hash == content_hash(current_markdown) && !note_path.is_empty()
                }) {
                Some((note_path, _)) => {
                    let items =
                        load_related_note_previews(&connection, note_path, effective_limit)?
                            .into_iter()
                            .map(|preview| RelatedNoteMatch {
                                note_path: preview.note_path,
                                note_title: preview.note_title,
                                section_label: preview.section_label,
                                excerpt: build_excerpt(&preview.text, 180),
                                match_text: preview.text,
                                score: preview.score,
                                start_line: preview.start_line,
                                end_line: preview.end_line,
                            })
                            .collect::<Vec<_>>();

                    (
                        RelatedNotesResponse {
                            status: "ready".to_string(),
                            scope: "note".to_string(),
                            reason: None,
                            items,
                        },
                        "edges",
                    )
                }
                None => {
                    let ann_status = self.ann.status_snapshot();
                    if !ann_status.loaded || ann_status.indexed_chunks == 0 {
                        let response = RelatedNotesResponse {
                            status: "unavailable".to_string(),
                            scope: "note".to_string(),
                            reason: Some(
                                "Semantic index is still warming up or has not been built yet."
                                    .to_string(),
                            ),
                            items: Vec::new(),
                        };
                        self.record_related_response(
                            &scope,
                            &response.status,
                            "semantic",
                            0,
                            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                        );
                        return Ok(response);
                    }

                    let matches = self.semantic_matches_for_text(
                        current_markdown,
                        current_path,
                        effective_limit.saturating_mul(4),
                    )?;

                    (
                        RelatedNotesResponse {
                            status: "ready".to_string(),
                            scope: "note".to_string(),
                            reason: None,
                            items: collapse_related_matches(matches, effective_limit),
                        },
                        "semantic",
                    )
                }
            }
        } else {
            let ann_status = self.ann.status_snapshot();
            if !ann_status.loaded || ann_status.indexed_chunks == 0 {
                let response = RelatedNotesResponse {
                    status: "unavailable".to_string(),
                    scope: "selection".to_string(),
                    reason: Some(
                        "Semantic index is still warming up or has not been built yet.".to_string(),
                    ),
                    items: Vec::new(),
                };
                self.record_related_response(
                    &scope,
                    &response.status,
                    "semantic",
                    0,
                    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                );
                return Ok(response);
            }

            let query_text = build_selection_query_text(
                current_markdown,
                normalized_selection.as_deref().unwrap_or_default(),
            );
            let matches = self.semantic_matches_for_text(
                &query_text,
                current_path,
                effective_limit.saturating_mul(4),
            )?;

            (
                RelatedNotesResponse {
                    status: "ready".to_string(),
                    scope: "selection".to_string(),
                    reason: None,
                    items: collapse_related_matches(matches, effective_limit),
                },
                "semantic",
            )
        };

        self.store_related_query_cache(cache_key, revision, response.clone())?;
        self.record_related_response(
            &scope,
            &response.status,
            strategy,
            response.items.len(),
            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        );
        Ok(response)
    }

    fn map_graph(&self, limit: usize, min_score: f32) -> Result<MapGraph, String> {
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let graph = load_graph_data(&connection, limit, min_score)?;
        Ok(graph)
    }

    fn lookup_related_query_cache(
        &self,
        key: &str,
        revision: u64,
    ) -> Result<Option<RelatedNotesResponse>, String> {
        let cache = self
            .related_query_cache
            .lock()
            .map_err(|_| "Related query cache lock poisoned".to_string())?;
        Ok(cache
            .iter()
            .find(|(cached_key, cached_revision, _)| {
                *cached_revision == revision && cached_key == key
            })
            .map(|(_, _, response)| response.clone()))
    }

    fn store_related_query_cache(
        &self,
        key: String,
        revision: u64,
        response: RelatedNotesResponse,
    ) -> Result<(), String> {
        let mut cache = self
            .related_query_cache
            .lock()
            .map_err(|_| "Related query cache lock poisoned".to_string())?;
        cache.retain(|(_, cached_revision, _)| *cached_revision == revision);
        cache.retain(|(cached_key, _, _)| cached_key != &key);
        cache.push((key, revision, response));
        if cache.len() > RELATED_QUERY_CACHE_LIMIT {
            let overflow = cache.len() - RELATED_QUERY_CACHE_LIMIT;
            cache.drain(0..overflow);
        }
        Ok(())
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
                auto_download_supported: false,
                runtime_binary_path: None,
                model_path: None,
                model_repo_id: String::new(),
                available: false,
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
            last_indexed_at_millis: None,
            last_error: None,
            current_job_label: None,
            latest_job: None,
        })
    }
}

fn disabled_settings(mut settings: SemanticSettings) -> SemanticSettings {
    settings.semantic_search_enabled = false;
    settings
}

fn related_scope_label(selected_text: Option<&str>) -> String {
    if selected_text.is_some() {
        "selection".to_string()
    } else {
        "note".to_string()
    }
}

fn normalize_related_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_related_cache_key(
    revision: u64,
    current_path: Option<&str>,
    current_markdown: &str,
    selected_text: Option<&str>,
    limit: usize,
) -> String {
    let scope = if selected_text.is_some() {
        "selection"
    } else {
        "note"
    };
    let base_hash = content_hash(current_markdown);
    let selected_hash = selected_text
        .map(content_hash)
        .unwrap_or_else(|| "none".to_string());
    format!(
        "{revision}:{scope}:{}:{base_hash}:{selected_hash}:{limit}",
        current_path.unwrap_or("")
    )
}

fn build_selection_query_text(current_markdown: &str, selected_text: &str) -> String {
    let chunked = chunking::chunk_markdown(current_markdown, "");
    if chunked.title.trim().is_empty() {
        selected_text.to_string()
    } else {
        format!("{}\n\n{}", chunked.title.trim(), selected_text)
    }
}

fn collapse_related_matches(
    matches: Vec<SemanticChunkMatch>,
    limit: usize,
) -> Vec<RelatedNoteMatch> {
    let mut collapsed = Vec::<RelatedNoteMatch>::new();

    for candidate in matches {
        if let Some(existing) = collapsed
            .iter_mut()
            .find(|existing| existing.note_path == candidate.note_path)
        {
            if candidate.score > existing.score {
                *existing = RelatedNoteMatch {
                    note_path: candidate.note_path,
                    note_title: candidate.note_title,
                    section_label: candidate.section_label,
                    excerpt: candidate.excerpt,
                    match_text: candidate.match_text,
                    score: candidate.score,
                    start_line: candidate.start_line,
                    end_line: candidate.end_line,
                };
            }
            continue;
        }

        collapsed.push(RelatedNoteMatch {
            note_path: candidate.note_path,
            note_title: candidate.note_title,
            section_label: candidate.section_label,
            excerpt: candidate.excerpt,
            match_text: candidate.match_text,
            score: candidate.score,
            start_line: candidate.start_line,
            end_line: candidate.end_line,
        });
    }

    collapsed.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.note_title.cmp(&right.note_title))
            .then_with(|| left.note_path.cmp(&right.note_path))
    });
    collapsed.truncate(limit);
    collapsed
}

fn build_excerpt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let excerpt = trimmed.chars().take(max_chars).collect::<String>();
    format!("{}…", excerpt.trim_end())
}

pub(crate) fn current_time_millis() -> Result<u64, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    Ok(now.min(u128::from(u64::MAX)) as u64)
}
