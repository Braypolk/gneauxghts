use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_DEBUG_EVENTS: usize = 250;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticDebugMetrics {
    pub(crate) runtime_spawn_count: u64,
    pub(crate) runtime_restart_count: u64,
    pub(crate) runtime_shutdown_count: u64,
    pub(crate) runtime_ready_count: u64,
    pub(crate) runtime_timeout_count: u64,
    pub(crate) model_prepare_count: u64,
    pub(crate) model_prepare_success_count: u64,
    pub(crate) model_prepare_failure_count: u64,
    pub(crate) model_prepare_last_millis: Option<u64>,
    pub(crate) model_warmup_count: u64,
    pub(crate) model_warmup_success_count: u64,
    pub(crate) model_warmup_failure_count: u64,
    pub(crate) model_warmup_last_millis: Option<u64>,
    pub(crate) embedding_request_count: u64,
    pub(crate) embedding_request_success_count: u64,
    pub(crate) embedding_request_failure_count: u64,
    pub(crate) embedding_text_count_total: u64,
    pub(crate) embedding_char_count_total: u64,
    pub(crate) embedding_duration_total_millis: u64,
    pub(crate) embedding_duration_max_millis: u64,
    pub(crate) search_request_count: u64,
    pub(crate) search_semantic_used_count: u64,
    pub(crate) search_semantic_skipped_count: u64,
    pub(crate) search_duration_total_millis: u64,
    pub(crate) search_duration_max_millis: u64,
    pub(crate) ann_query_count: u64,
    pub(crate) ann_query_skipped_count: u64,
    pub(crate) ann_query_candidate_total: u64,
    pub(crate) ann_query_rerank_total: u64,
    pub(crate) ann_query_duration_total_millis: u64,
    pub(crate) ann_query_duration_max_millis: u64,
    pub(crate) ann_load_success_count: u64,
    pub(crate) ann_load_failure_count: u64,
    pub(crate) ann_rebuild_count: u64,
    pub(crate) ann_rebuild_pending_count: u64,
    pub(crate) ann_rebuild_duration_total_millis: u64,
    pub(crate) ann_rebuild_duration_max_millis: u64,
    pub(crate) ann_update_failure_count: u64,
    pub(crate) map_request_count: u64,
    pub(crate) map_duration_total_millis: u64,
    pub(crate) map_duration_max_millis: u64,
    pub(crate) index_job_enqueued_count: u64,
    pub(crate) index_job_started_count: u64,
    pub(crate) index_job_completed_count: u64,
    pub(crate) index_job_failed_count: u64,
    pub(crate) index_zero_work_count: u64,
    pub(crate) index_scanned_total: u64,
    pub(crate) index_embedded_total: u64,
    pub(crate) index_duration_total_millis: u64,
    pub(crate) index_duration_max_millis: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticDebugEvent {
    pub(crate) timestamp_millis: u64,
    pub(crate) category: String,
    pub(crate) action: String,
    pub(crate) detail: Option<String>,
    pub(crate) duration_millis: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticDebugSnapshot {
    pub(crate) captured_at_millis: u64,
    pub(crate) metrics: SemanticDebugMetrics,
    pub(crate) recent_events: Vec<SemanticDebugEvent>,
}

#[derive(Default)]
struct DebugInner {
    metrics: SemanticDebugMetrics,
    recent_events: VecDeque<SemanticDebugEvent>,
}

pub(crate) struct SemanticDebugState {
    inner: Mutex<DebugInner>,
}

impl SemanticDebugState {
    pub(crate) fn new() -> Self {
        Self {
            inner: Mutex::new(DebugInner::default()),
        }
    }

    pub(crate) fn record_timing<F>(
        &self,
        category: &str,
        action: &str,
        detail: Option<String>,
        duration_millis: u64,
        mutate: F,
    ) where
        F: FnOnce(&mut SemanticDebugMetrics),
    {
        self.record_with_metrics(category, action, detail, Some(duration_millis), mutate);
    }

    pub(crate) fn record_with_metrics<F>(
        &self,
        category: &str,
        action: &str,
        detail: Option<String>,
        duration_millis: Option<u64>,
        mutate: F,
    ) where
        F: FnOnce(&mut SemanticDebugMetrics),
    {
        if let Ok(mut inner) = self.inner.lock() {
            mutate(&mut inner.metrics);
            push_event(
                &mut inner.recent_events,
                SemanticDebugEvent {
                    timestamp_millis: now_millis(),
                    category: category.to_string(),
                    action: action.to_string(),
                    detail,
                    duration_millis,
                },
            );
        }
    }

    pub(crate) fn snapshot(&self) -> Result<SemanticDebugSnapshot, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Semantic debug lock poisoned".to_string())?;
        Ok(SemanticDebugSnapshot {
            captured_at_millis: now_millis(),
            metrics: inner.metrics.clone(),
            recent_events: inner.recent_events.iter().cloned().collect(),
        })
    }

    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Semantic debug lock poisoned".to_string())?;
        *inner = DebugInner::default();
        Ok(())
    }
}

fn push_event(recent_events: &mut VecDeque<SemanticDebugEvent>, event: SemanticDebugEvent) {
    recent_events.push_front(event);
    while recent_events.len() > MAX_DEBUG_EVENTS {
        recent_events.pop_back();
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}
