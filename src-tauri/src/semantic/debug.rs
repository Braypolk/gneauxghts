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
    pub(crate) related_request_count: u64,
    pub(crate) related_note_request_count: u64,
    pub(crate) related_selection_request_count: u64,
    pub(crate) related_cache_hit_count: u64,
    pub(crate) related_edge_reuse_count: u64,
    pub(crate) related_semantic_query_count: u64,
    pub(crate) related_insufficient_content_count: u64,
    pub(crate) related_unavailable_count: u64,
    pub(crate) related_result_total: u64,
    pub(crate) related_duration_total_millis: u64,
    pub(crate) related_duration_max_millis: u64,
    pub(crate) index_job_enqueued_count: u64,
    pub(crate) index_job_started_count: u64,
    pub(crate) index_job_completed_count: u64,
    pub(crate) index_job_failed_count: u64,
    pub(crate) index_zero_work_count: u64,
    pub(crate) index_scanned_total: u64,
    pub(crate) index_embedded_total: u64,
    pub(crate) index_duration_total_millis: u64,
    pub(crate) index_duration_max_millis: u64,
    pub(crate) edge_rebuild_count: u64,
    pub(crate) edge_rebuild_note_count: u64,
    pub(crate) edge_rebuild_edge_count: u64,
    pub(crate) edge_rebuild_dimensions: u64,
    pub(crate) edge_rebuild_comparisons_total: u64,
    pub(crate) edge_rebuild_duration_total_millis: u64,
    pub(crate) edge_rebuild_duration_max_millis: u64,
    pub(crate) ann_rebuild_chunk_count: u64,
    pub(crate) ann_rebuild_text_bytes: u64,
    pub(crate) process_rss_bytes: Option<u64>,
    pub(crate) process_rss_peak_bytes: u64,
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

    /// Sample resident set size and fold it into the metrics. Opt-in via the
    /// `GNEAUXGHTS_PROFILE_RSS` env var so the (potentially process-spawning)
    /// read never runs on the hot path unless explicitly requested. No-op on
    /// platforms where RSS cannot be read cheaply.
    pub(crate) fn sample_rss(&self, category: &str, action: &str) {
        if !rss_profiling_enabled() {
            return;
        }
        let rss = current_rss_bytes();
        self.record_with_metrics(category, action, None, None, |metrics| {
            metrics.process_rss_bytes = rss;
            if let Some(bytes) = rss {
                metrics.process_rss_peak_bytes = metrics.process_rss_peak_bytes.max(bytes);
            }
        });
    }
}

fn rss_profiling_enabled() -> bool {
    std::env::var_os("GNEAUXGHTS_PROFILE_RSS").is_some_and(|value| {
        let value = value.to_string_lossy();
        let value = value.trim();
        !value.is_empty() && value != "0" && !value.eq_ignore_ascii_case("false")
    })
}

/// Best-effort current resident set size in bytes. Returns `None` when the
/// platform does not expose a cheap way to read it.
pub(crate) fn current_rss_bytes() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
        let resident_pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
        let page_size = 4096u64;
        Some(resident_pages.saturating_mul(page_size))
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let pid = std::process::id();
        let output = Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        let kib: u64 = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .ok()?;
        Some(kib.saturating_mul(1024))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        None
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_timing_folds_metrics_and_pushes_event() {
        let state = SemanticDebugState::new();
        state.record_timing(
            "edge",
            "rebuild_completed",
            Some("notes=3".to_string()),
            12,
            |metrics| {
                metrics.edge_rebuild_count += 1;
                metrics.edge_rebuild_note_count += 3;
                metrics.edge_rebuild_duration_total_millis += 12;
                metrics.edge_rebuild_duration_max_millis =
                    metrics.edge_rebuild_duration_max_millis.max(12);
            },
        );

        let snapshot = state.snapshot().expect("snapshot");
        assert_eq!(snapshot.metrics.edge_rebuild_count, 1);
        assert_eq!(snapshot.metrics.edge_rebuild_note_count, 3);
        assert_eq!(snapshot.metrics.edge_rebuild_duration_total_millis, 12);
        assert_eq!(snapshot.metrics.edge_rebuild_duration_max_millis, 12);
        assert_eq!(snapshot.recent_events.len(), 1);
        let event = &snapshot.recent_events[0];
        assert_eq!(event.category, "edge");
        assert_eq!(event.action, "rebuild_completed");
        assert_eq!(event.detail.as_deref(), Some("notes=3"));
        assert_eq!(event.duration_millis, Some(12));
    }

    #[test]
    fn rss_profiling_enabled_respects_truthy_and_falsy_values() {
        // This mutates a process-global env var; keep it isolated to one test and
        // restore the prior value afterward so parallel tests are unaffected.
        let key = "GNEAUXGHTS_PROFILE_RSS";
        let previous = std::env::var_os(key);

        std::env::remove_var(key);
        assert!(!rss_profiling_enabled(), "unset must be disabled");

        std::env::set_var(key, "");
        assert!(!rss_profiling_enabled(), "empty must be disabled");

        std::env::set_var(key, "0");
        assert!(!rss_profiling_enabled(), "\"0\" must be disabled");

        std::env::set_var(key, "false");
        assert!(!rss_profiling_enabled(), "\"false\" must be disabled");

        std::env::set_var(key, "1");
        assert!(rss_profiling_enabled(), "\"1\" must be enabled");

        std::env::set_var(key, "true");
        assert!(rss_profiling_enabled(), "\"true\" must be enabled");

        match previous {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn sample_rss_is_noop_when_disabled() {
        let key = "GNEAUXGHTS_PROFILE_RSS";
        let previous = std::env::var_os(key);
        std::env::remove_var(key);

        let state = SemanticDebugState::new();
        state.sample_rss("ann", "rebuild_completed");

        let snapshot = state.snapshot().expect("snapshot");
        assert_eq!(snapshot.metrics.process_rss_bytes, None);
        assert_eq!(snapshot.metrics.process_rss_peak_bytes, 0);
        assert!(
            snapshot.recent_events.is_empty(),
            "disabled sampling must not record an event"
        );

        match previous {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn current_rss_bytes_reports_nonzero_on_linux() {
        let rss = current_rss_bytes().expect("linux exposes /proc/self/statm");
        assert!(rss > 0, "resident set size should be positive");
    }
}
