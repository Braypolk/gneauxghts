pub(crate) mod chunking;
pub(crate) mod db;
pub(crate) mod embed;
pub(crate) mod indexer;
pub(crate) mod similarity;

use self::{
    chunking::chunk_markdown,
    db::{
        count_indexed_items, ensure_schema, load_chunks_with_embeddings, load_graph_data,
        load_latest_job, load_semantic_settings, open_database, save_semantic_settings,
    },
    embed::{EmbeddingProvider, LocalHashEmbeddingProvider, ModelInfo},
    indexer::{spawn_indexing_worker, IndexWork},
    similarity::cosine_similarity,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticSettings {
    pub(crate) semantic_search_enabled: bool,
    pub(crate) related_sidebar_enabled: bool,
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
            related_sidebar_enabled: true,
            local_only_mode: true,
            auto_download_model: false,
            lexical_weight: 0.45,
            semantic_weight: 0.45,
            graph_min_score: 0.32,
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
    pub(crate) model_available: bool,
    pub(crate) indexing_paused: bool,
    pub(crate) indexing_in_progress: bool,
    pub(crate) indexed_notes: usize,
    pub(crate) indexed_chunks: usize,
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
pub(crate) struct RelatedNote {
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) excerpt: String,
    pub(crate) match_text: String,
    pub(crate) section_label: Option<String>,
    pub(crate) score: f32,
    pub(crate) reason_label: String,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
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
    db_path: PathBuf,
    provider: Arc<dyn EmbeddingProvider + Send + Sync>,
    runtime: Arc<Mutex<RuntimeState>>,
    work_tx: Sender<IndexWork>,
}

impl SemanticState {
    pub(crate) fn new(app_data_dir: PathBuf, notes_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
        let semantic_dir = app_data_dir.join("semantic");
        let db_path = semantic_dir.join("semantic.sqlite3");
        let provider: Arc<dyn EmbeddingProvider + Send + Sync> =
            Arc::new(LocalHashEmbeddingProvider::new(256));
        let connection = open_database(&db_path)?;
        ensure_schema(&connection)?;
        if load_semantic_settings(&connection)?.is_none() {
            save_semantic_settings(&connection, &SemanticSettings::default())?;
        }
        drop(connection);

        let runtime = Arc::new(Mutex::new(RuntimeState::default()));
        let (work_tx, work_rx) = mpsc::channel();
        spawn_indexing_worker(
            db_path.clone(),
            notes_dir.clone(),
            provider.clone(),
            work_rx,
            &runtime,
        )?;

        let state = Self {
            db_path,
            provider,
            runtime,
            work_tx,
        };
        state.enqueue_scan(false)?;
        Ok(state)
    }

    pub(crate) fn queue_note_update(
        &self,
        note_path: &Path,
        markdown: String,
        modified_millis: u64,
    ) -> Result<(), String> {
        self.work_tx
            .send(IndexWork::UpsertNote {
                note_path: note_path.to_path_buf(),
                markdown,
                modified_millis,
            })
            .map_err(|err| err.to_string())
    }

    pub(crate) fn queue_delete_note(&self, note_path: &Path) -> Result<(), String> {
        self.work_tx
            .send(IndexWork::DeleteNote {
                note_path: note_path.to_path_buf(),
            })
            .map_err(|err| err.to_string())
    }

    pub(crate) fn enqueue_scan_if_stale(&self) -> Result<(), String> {
        let now = current_time_millis()?;
        let should_enqueue = {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| "Semantic runtime lock poisoned".to_string())?;
            runtime
                .last_scan_requested_at_millis
                .map(|last_requested| now.saturating_sub(last_requested) > 5_000)
                .unwrap_or(true)
        };

        if should_enqueue {
            self.enqueue_scan(false)?;
        }
        Ok(())
    }

    pub(crate) fn enqueue_scan(&self, force: bool) -> Result<(), String> {
        let now = current_time_millis()?;
        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "Semantic runtime lock poisoned".to_string())?;
            runtime.last_scan_requested_at_millis = Some(now);
        }
        self.work_tx
            .send(IndexWork::FullScan { force })
            .map_err(|err| err.to_string())
    }

    pub(crate) fn rebuild_index(&self) -> Result<(), String> {
        self.work_tx
            .send(IndexWork::Rebuild)
            .map_err(|err| err.to_string())
    }

    pub(crate) fn pause_indexing(&self) -> Result<(), String> {
        self.work_tx
            .send(IndexWork::SetPaused { paused: true })
            .map_err(|err| err.to_string())
    }

    pub(crate) fn resume_indexing(&self) -> Result<(), String> {
        self.work_tx
            .send(IndexWork::SetPaused { paused: false })
            .map_err(|err| err.to_string())
    }

    pub(crate) fn get_settings(&self) -> Result<SemanticSettings, String> {
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        Ok(load_semantic_settings(&connection)?.unwrap_or_default())
    }

    pub(crate) fn set_settings(
        &self,
        next_settings: SemanticSettings,
    ) -> Result<SemanticSettings, String> {
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        save_semantic_settings(&connection, &next_settings)?;
        Ok(next_settings)
    }

    pub(crate) fn get_status(&self) -> Result<SemanticStatus, String> {
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let settings = load_semantic_settings(&connection)?.unwrap_or_default();
        let (indexed_notes, indexed_chunks, last_indexed_at_millis) =
            count_indexed_items(&connection)?;
        let latest_job = load_latest_job(&connection)?;
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "Semantic runtime lock poisoned".to_string())?;

        Ok(SemanticStatus {
            settings,
            model: self.provider.model_info(),
            model_available: true,
            indexing_paused: runtime.indexing_paused,
            indexing_in_progress: runtime.indexing_in_progress,
            indexed_notes,
            indexed_chunks,
            last_indexed_at_millis: runtime.last_indexed_at_millis.or(last_indexed_at_millis),
            last_error: runtime.last_error.clone(),
            current_job_label: runtime.current_job_label.clone(),
            latest_job,
        })
    }

    pub(crate) fn semantic_matches_for_text(
        &self,
        text: &str,
        exclude_note_path: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SemanticChunkMatch>, String> {
        let settings = self.get_settings()?;
        if !settings.semantic_search_enabled {
            return Ok(Vec::new());
        }

        self.enqueue_scan_if_stale()?;
        let query_embedding = self
            .provider
            .embed_texts(&[text.to_string()])?
            .into_iter()
            .next()
            .ok_or_else(|| "Unable to embed semantic query".to_string())?;
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let mut matches = load_chunks_with_embeddings(&connection, exclude_note_path)?
            .into_iter()
            .filter_map(|chunk| {
                let score = cosine_similarity(&query_embedding, &chunk.embedding);
                if score <= 0.0 {
                    return None;
                }

                Some(SemanticChunkMatch {
                    note_path: chunk.note_path,
                    note_title: chunk.note_title,
                    section_label: chunk.section_label,
                    excerpt: build_excerpt(&chunk.text, 180),
                    match_text: chunk.text,
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
        Ok(matches)
    }

    pub(crate) fn related_notes(
        &self,
        current_path: Option<&str>,
        current_markdown: &str,
        limit: usize,
    ) -> Result<Vec<RelatedNote>, String> {
        let settings = self.get_settings()?;
        if !settings.related_sidebar_enabled {
            return Ok(Vec::new());
        }

        self.enqueue_scan_if_stale()?;
        let draft = chunk_markdown(current_markdown, "Untitled");
        if draft.chunks.is_empty() {
            return Ok(Vec::new());
        }

        let draft_embeddings = self
            .provider
            .embed_texts(
                &draft
                    .chunks
                    .iter()
                    .map(|chunk| chunk.text.clone())
                    .collect::<Vec<_>>(),
            )?;
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let stored_chunks = load_chunks_with_embeddings(&connection, current_path)?;

        let mut grouped = std::collections::HashMap::<String, RelatedNote>::new();

        for chunk in stored_chunks {
            let best_score = draft_embeddings
                .iter()
                .map(|draft_embedding| cosine_similarity(draft_embedding, &chunk.embedding))
                .fold(f32::MIN, f32::max);
            if best_score < 0.2 {
                continue;
            }

            let reason_label = if chunk.section_label.eq_ignore_ascii_case("title") {
                "title + concept".to_string()
            } else {
                "concept match".to_string()
            };

            let candidate = RelatedNote {
                note_path: chunk.note_path.clone(),
                note_title: chunk.note_title.clone(),
                excerpt: build_excerpt(&chunk.text, 180),
                match_text: chunk.text.clone(),
                section_label: Some(chunk.section_label.clone()),
                score: best_score,
                reason_label,
                start_line: chunk.start_line,
                end_line: chunk.end_line,
            };

            let entry = grouped.entry(chunk.note_path.clone()).or_insert(candidate.clone());
            if candidate.score > entry.score {
                *entry = candidate;
            }
        }

        let mut related = grouped.into_values().collect::<Vec<_>>();
        related.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.note_title.cmp(&right.note_title))
        });
        related.truncate(limit);
        Ok(related)
    }

    pub(crate) fn map_graph(
        &self,
        limit: usize,
        min_score: f32,
    ) -> Result<MapGraph, String> {
        self.enqueue_scan_if_stale()?;
        let connection = open_database(&self.db_path)?;
        ensure_schema(&connection)?;
        let graph = load_graph_data(&connection, limit, min_score)?;
        Ok(graph)
    }

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
