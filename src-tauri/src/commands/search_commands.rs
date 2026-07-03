use super::{
    prepare_notes_dir, DraftRef, RecentTaskItem, SearchMode, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    index::{build_current_override, normalize_search_text, AppState, IndexedNote, NotesIndex},
    search::{
        build_recent_result, search_note, search_note_exact_matches, NoteSearchResult,
        ScoredSearchResult, MAX_SEARCH_RESULTS,
    },
    semantic::{RelatedNotesResponse, SemanticChunkMatch},
    services::{resolve_current_document, CurrentDocumentRequest},
    state::{
        prune_recent_note_ids, read_state, resolve_note_id_from_path,
        task_projection::list_recent_open_tasks, validate_current_path, write_state,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::{
    collections::HashMap,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;

/// Phase 5: short-lived cache of search/related results. Keys include the
/// query text, mode, current path, and current draft hash so that
/// repeated keystrokes that resolve to the same input get a cached
/// response. Cache TTL is intentionally tiny — just long enough to absorb
/// double-fires from the editor.
const SEARCH_RESULT_CACHE_TTL: Duration = Duration::from_millis(750);
const SEARCH_RESULT_CACHE_MAX_ENTRIES: usize = 16;

#[derive(Clone)]
struct CachedSearchResults {
    fingerprint: String,
    inserted_at: Instant,
    results: Vec<NoteSearchResult>,
}

static SEARCH_RESULT_CACHE: Mutex<Vec<CachedSearchResults>> = Mutex::new(Vec::new());

fn search_cache_get(fingerprint: &str) -> Option<Vec<NoteSearchResult>> {
    let mut cache = SEARCH_RESULT_CACHE.lock().ok()?;
    let now = Instant::now();
    cache.retain(|entry| now.duration_since(entry.inserted_at) <= SEARCH_RESULT_CACHE_TTL);
    cache
        .iter()
        .find(|entry| entry.fingerprint == fingerprint)
        .map(|entry| entry.results.clone())
}

fn search_cache_put(fingerprint: String, results: Vec<NoteSearchResult>) {
    let Ok(mut cache) = SEARCH_RESULT_CACHE.lock() else {
        return;
    };
    let now = Instant::now();
    cache.retain(|entry| {
        entry.fingerprint != fingerprint
            && now.duration_since(entry.inserted_at) <= SEARCH_RESULT_CACHE_TTL
    });
    cache.push(CachedSearchResults {
        fingerprint,
        inserted_at: now,
        results,
    });
    while cache.len() > SEARCH_RESULT_CACHE_MAX_ENTRIES {
        cache.remove(0);
    }
}

#[derive(Clone)]
struct CachedRelatedResponse {
    fingerprint: String,
    inserted_at: Instant,
    response: RelatedNotesResponse,
}

static RELATED_RESULT_CACHE: Mutex<Vec<CachedRelatedResponse>> = Mutex::new(Vec::new());

fn related_cache_get(fingerprint: &str) -> Option<RelatedNotesResponse> {
    let mut cache = RELATED_RESULT_CACHE.lock().ok()?;
    let now = Instant::now();
    cache.retain(|entry| now.duration_since(entry.inserted_at) <= SEARCH_RESULT_CACHE_TTL);
    cache
        .iter()
        .find(|entry| entry.fingerprint == fingerprint)
        .map(|entry| entry.response.clone())
}

fn related_cache_put(fingerprint: String, response: RelatedNotesResponse) {
    let Ok(mut cache) = RELATED_RESULT_CACHE.lock() else {
        return;
    };
    let now = Instant::now();
    cache.retain(|entry| {
        entry.fingerprint != fingerprint
            && now.duration_since(entry.inserted_at) <= SEARCH_RESULT_CACHE_TTL
    });
    cache.push(CachedRelatedResponse {
        fingerprint,
        inserted_at: now,
        response,
    });
    while cache.len() > SEARCH_RESULT_CACHE_MAX_ENTRIES {
        cache.remove(0);
    }
}

/// Phase: small cache of parsed current-note overrides keyed by the draft
/// path + body hash. The body hash is the same content fingerprint that
/// keys SEARCH_RESULT_CACHE, so two distinct queries against the same
/// unsaved draft hit the cache instead of reparsing the note.
const CURRENT_OVERRIDE_CACHE_TTL: Duration = Duration::from_secs(5);
const CURRENT_OVERRIDE_CACHE_MAX_ENTRIES: usize = 4;

#[derive(Clone)]
struct CachedCurrentOverride {
    fingerprint: String,
    inserted_at: Instant,
    note: Option<IndexedNote>,
}

static CURRENT_OVERRIDE_CACHE: Mutex<Vec<CachedCurrentOverride>> = Mutex::new(Vec::new());

fn current_override_fingerprint(
    current_path: Option<&Path>,
    current_title: &str,
    body_hash: &str,
) -> String {
    format!(
        "{}|{}|{}",
        current_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        current_title,
        body_hash,
    )
}

fn current_override_cache_get(fingerprint: &str) -> Option<Option<IndexedNote>> {
    let mut cache = CURRENT_OVERRIDE_CACHE.lock().ok()?;
    let now = Instant::now();
    cache.retain(|entry| now.duration_since(entry.inserted_at) <= CURRENT_OVERRIDE_CACHE_TTL);
    cache
        .iter()
        .find(|entry| entry.fingerprint == fingerprint)
        .map(|entry| entry.note.clone())
}

fn current_override_cache_put(fingerprint: String, note: Option<IndexedNote>) {
    let Ok(mut cache) = CURRENT_OVERRIDE_CACHE.lock() else {
        return;
    };
    let now = Instant::now();
    cache.retain(|entry| {
        entry.fingerprint != fingerprint
            && now.duration_since(entry.inserted_at) <= CURRENT_OVERRIDE_CACHE_TTL
    });
    cache.push(CachedCurrentOverride {
        fingerprint,
        inserted_at: now,
        note,
    });
    while cache.len() > CURRENT_OVERRIDE_CACHE_MAX_ENTRIES {
        cache.remove(0);
    }
}

fn build_current_override_cached(
    current_path: Option<&Path>,
    current_title: &str,
    current_markdown: &str,
    body_hash: Option<&str>,
) -> Option<IndexedNote> {
    let Some(hash) = body_hash else {
        return build_current_override(current_path, current_title, current_markdown);
    };

    let fingerprint = current_override_fingerprint(current_path, current_title, hash);
    if let Some(cached) = current_override_cache_get(&fingerprint) {
        return cached;
    }

    let parsed = build_current_override(current_path, current_title, current_markdown);
    current_override_cache_put(fingerprint, parsed.clone());
    parsed
}

#[derive(Clone)]
struct HybridCandidate {
    lexical_score: f32,
    semantic_score: f32,
    structural_boost: f32,
    result: NoteSearchResult,
}

#[derive(Hash, PartialEq, Eq)]
struct HybridCandidateKey {
    note_path: Option<String>,
    section_label: String,
    match_text: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
}

#[tauri::command]
pub(crate) fn list_recent_notes(
    state: State<'_, AppState>,
    limit: usize,
    current_path: Option<String>,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;
    if prune_recent_note_ids(&mut persisted_state, &notes_dir) {
        write_state(&notes_dir, &persisted_state)?;
    }

    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "list_recent_notes",
    )?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;

    Ok(collect_recent_note_results(
        &persisted_state.recent_note_ids,
        current_path
            .as_deref()
            .map(resolve_note_id_from_path)
            .transpose()?
            .as_deref(),
        &index,
        limit,
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFocusBundle {
    recent_notes: Vec<NoteSearchResult>,
    recent_tasks: Vec<RecentTaskItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RetrievalContextScope {
    Note,
    Selection,
    Query,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetrievalContextItem {
    note_id: Option<String>,
    note_path: Option<String>,
    note_title: String,
    section_label: String,
    excerpt: String,
    match_text: String,
    source: String,
    reason: String,
    score: f32,
    lexical_score: Option<f32>,
    semantic_score: Option<f32>,
    start_line: Option<usize>,
    end_line: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetrievalContextResponse {
    status: String,
    scope: String,
    reason: Option<String>,
    items: Vec<RetrievalContextItem>,
}

/// Combined focus loader: returns both recent notes and recent tasks in a
/// single backend round-trip. This collapses two separate frontend calls
/// (each performing its own `read_state` + `ensure_interactive_index` +
/// optional `write_state`) into one shared traversal.
#[tauri::command]
pub(crate) fn list_recent_focus(
    state: State<'_, AppState>,
    limit: usize,
    current_path: Option<String>,
) -> Result<RecentFocusBundle, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;
    let prune_changed = prune_recent_note_ids(&mut persisted_state, &notes_dir);

    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "list_recent_focus",
    )?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;

    let current_note_id = current_path
        .as_deref()
        .map(resolve_note_id_from_path)
        .transpose()?;
    let recent_notes = collect_recent_note_results(
        &persisted_state.recent_note_ids,
        current_note_id.as_deref(),
        &index,
        limit,
    );

    drop(index);
    if prune_changed {
        write_state(&notes_dir, &persisted_state)?;
    }

    let hidden_note_ids: HashSet<String> =
        persisted_state.hidden_note_ids.iter().cloned().collect();
    let recent_tasks: Vec<RecentTaskItem> = list_recent_open_tasks(limit, &hidden_note_ids)?
        .into_iter()
        .map(|record| RecentTaskItem {
            note_id: record.note_id,
            task_key: record.task_key,
            note_path: record.note_path,
            note_title: record.note_title,
            text: record.text,
            line_number: record.line_number,
            updated_at_millis: record.updated_at_millis,
        })
        .collect();

    Ok(RecentFocusBundle {
        recent_notes,
        recent_tasks,
    })
}

pub(super) fn collect_recent_note_results(
    recent_note_ids: &[String],
    current_note_id: Option<&str>,
    index: &NotesIndex,
    limit: usize,
) -> Vec<NoteSearchResult> {
    recent_note_ids
        .iter()
        .filter_map(|note_id| {
            if current_note_id == Some(note_id.as_str()) {
                return None;
            }

            let (path, note) = index.get_note_by_note_id(note_id)?;
            Some(build_recent_result(Some(path.as_path()), note))
        })
        .take(limit)
        .collect()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn search_notes(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_title: String,
    current_markdown: Option<String>,
    current_body_hash: Option<String>,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let normalized_query = normalize_search_text(&query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let query_terms = normalized_query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let resolved_current = resolve_current_document(
        &state,
        CurrentDocumentRequest::from_path(
            current_path.as_deref(),
            current_title.clone(),
            current_markdown,
            current_body_hash,
        ),
    )?;
    let draft = resolved_current.draft;
    let resolved_body = resolved_current.body.unwrap_or_default();
    let mut candidates = collect_lexical_candidates(
        &state,
        &query,
        &notes_dir,
        mode,
        current_path.as_deref(),
        &current_title,
        &resolved_body,
        draft.hash.as_deref(),
        &normalized_query,
        &query_terms,
    )?;

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
            .then_with(|| left.result.note_path.cmp(&right.result.note_path))
    });
    candidates.truncate(MAX_SEARCH_RESULTS);

    Ok(candidates
        .into_iter()
        .map(|candidate| candidate.result)
        .collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn search_notes_hybrid(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_title: String,
    current_markdown: Option<String>,
    current_body_hash: Option<String>,
    limit: usize,
    semantic_weight: Option<f32>,
    lexical_weight: Option<f32>,
) -> Result<Vec<NoteSearchResult>, String> {
    let started_at = Instant::now();
    let notes_dir = prepare_notes_dir(false)?;

    let normalized_query = normalize_search_text(&query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let query_terms = normalized_query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }
    let effective_limit = match mode {
        SearchMode::Current => limit.max(200),
        SearchMode::All => limit,
    };

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let resolved_current = resolve_current_document(
        &state,
        CurrentDocumentRequest::from_path(
            current_path.as_deref(),
            current_title.clone(),
            current_markdown,
            current_body_hash,
        ),
    )?;
    let draft = resolved_current.draft;
    let cache_fingerprint = build_search_fingerprint(
        &normalized_query,
        &mode,
        current_path.as_deref(),
        draft.hash.as_deref(),
        effective_limit,
        lexical_weight,
        semantic_weight,
    );
    if let Some(cached) = search_cache_get(&cache_fingerprint) {
        return Ok(cached);
    }
    let resolved_body = resolved_current.body.unwrap_or_default();
    let lexical_candidates = collect_lexical_candidates(
        &state,
        &query,
        &notes_dir,
        mode.clone(),
        current_path.as_deref(),
        &current_title,
        &resolved_body,
        draft.hash.as_deref(),
        &normalized_query,
        &query_terms,
    )?;
    let settings = state.semantic.get_settings()?;
    let lexical_weight = lexical_weight.unwrap_or(settings.lexical_weight).max(0.0);
    let semantic_weight = semantic_weight.unwrap_or(settings.semantic_weight).max(0.0);
    let current_path_raw = current_path
        .as_deref()
        .map(|path| path.to_string_lossy().into_owned());
    let should_use_semantic = settings.semantic_search_enabled
        && matches!(mode, SearchMode::All)
        && (normalized_query.len() >= 6 || query_terms.len() >= 2);

    if !should_use_semantic {
        let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        let debug = state.semantic.debug_state();
        debug.record_timing(
            "search",
            "search_completed",
            Some("semantic_skipped".to_string()),
            elapsed,
            |metrics| {
                metrics.search_request_count += 1;
                metrics.search_semantic_skipped_count += 1;
                metrics.search_duration_total_millis += elapsed;
                metrics.search_duration_max_millis =
                    metrics.search_duration_max_millis.max(elapsed);
            },
        );
        let results = finalize_lexical_results(lexical_candidates, effective_limit);
        search_cache_put(cache_fingerprint, results.clone());
        return Ok(results);
    }

    let semantic = state.semantic.clone();
    let semantic_query = query.clone();
    let semantic_matches = tauri::async_runtime::spawn_blocking(move || {
        semantic.semantic_matches_for_text(
            &semantic_query,
            current_path_raw.as_deref(),
            effective_limit.saturating_mul(3).max(effective_limit),
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    let ranked = merge_hybrid_candidates(
        lexical_candidates,
        semantic_matches,
        &normalized_query,
        current_path.as_deref(),
        effective_limit,
        lexical_weight,
        semantic_weight,
    );
    let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    state.semantic.debug_state().record_timing(
        "search",
        "search_completed",
        Some(format!("semantic_used results={}", ranked.len())),
        elapsed,
        |metrics| {
            metrics.search_request_count += 1;
            metrics.search_semantic_used_count += 1;
            metrics.search_duration_total_millis += elapsed;
            metrics.search_duration_max_millis = metrics.search_duration_max_millis.max(elapsed);
        },
    );
    search_cache_put(cache_fingerprint, ranked.clone());
    Ok(ranked)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn get_related_notes(
    state: State<'_, AppState>,
    current_path: Option<String>,
    current_title: String,
    current_markdown: Option<String>,
    current_body_hash: Option<String>,
    selected_text: Option<String>,
    limit: usize,
) -> Result<RelatedNotesResponse, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let current_path = validate_current_path(current_path, &notes_dir)?;
    let resolved_current = resolve_current_document(
        &state,
        CurrentDocumentRequest::from_path(
            current_path.as_deref(),
            current_title.clone(),
            current_markdown,
            current_body_hash,
        ),
    )?;
    let draft = resolved_current.draft;
    let fingerprint = build_related_fingerprint(
        current_path.as_deref(),
        draft.hash.as_deref(),
        selected_text.as_deref(),
        limit,
    );
    if let Some(cached) = related_cache_get(&fingerprint) {
        return Ok(cached);
    }
    let resolved_body = resolved_current.body.unwrap_or_default();
    let current_path_raw = current_path
        .as_deref()
        .map(|path| path.to_string_lossy().into_owned());
    let semantic = state.semantic.clone();

    let response = tauri::async_runtime::spawn_blocking(move || {
        semantic.related_notes(
            current_path_raw.as_deref(),
            &current_title,
            &resolved_body,
            selected_text.as_deref(),
            limit.max(1),
        )
    })
    .await
    .map_err(|err| err.to_string())??;
    related_cache_put(fingerprint, response.clone());
    Ok(response)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn retrieve_note_context(
    state: State<'_, AppState>,
    scope: RetrievalContextScope,
    query: Option<String>,
    current_path: Option<String>,
    current_title: String,
    current_markdown: Option<String>,
    current_body_hash: Option<String>,
    selected_text: Option<String>,
    limit: usize,
) -> Result<RetrievalContextResponse, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let current_path = validate_current_path(current_path, &notes_dir)?;
    let resolved_current = resolve_current_document(
        &state,
        CurrentDocumentRequest::from_path(
            current_path.as_deref(),
            current_title.clone(),
            current_markdown,
            current_body_hash,
        ),
    )?;
    let resolved_body = resolved_current.body.unwrap_or_default();
    let current_path_raw = current_path
        .as_deref()
        .map(|path| path.to_string_lossy().into_owned());
    let effective_limit = limit.max(1);

    match scope {
        RetrievalContextScope::Query => {
            let Some(query) = query.filter(|value| !value.trim().is_empty()) else {
                return Ok(RetrievalContextResponse {
                    status: "insufficientContent".to_string(),
                    scope: "query".to_string(),
                    reason: Some("Provide a query to retrieve note context.".to_string()),
                    items: Vec::new(),
                });
            };
            let normalized_query = normalize_search_text(&query);
            let query_terms = normalized_query
                .split_whitespace()
                .filter(|term| !term.is_empty())
                .collect::<Vec<_>>();
            let lexical_candidates = collect_lexical_candidates(
                &state,
                &query,
                &notes_dir,
                SearchMode::All,
                current_path.as_deref(),
                &current_title,
                &resolved_body,
                resolved_current.draft.hash.as_deref(),
                &normalized_query,
                &query_terms,
            )?;
            let settings = state.semantic.get_settings()?;
            let semantic_matches = if settings.semantic_search_enabled {
                let semantic = state.semantic.clone();
                let semantic_query = query.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    semantic.semantic_matches_for_text(
                        &semantic_query,
                        current_path_raw.as_deref(),
                        effective_limit.saturating_mul(3),
                    )
                })
                .await
                .map_err(|err| err.to_string())??
            } else {
                Vec::new()
            };
            let merged = merge_hybrid_candidates(
                lexical_candidates,
                semantic_matches,
                &normalized_query,
                current_path.as_deref(),
                effective_limit,
                settings.lexical_weight.max(0.0),
                settings.semantic_weight.max(0.0),
            );
            return Ok(RetrievalContextResponse {
                status: "ready".to_string(),
                scope: "query".to_string(),
                reason: None,
                items: merged.into_iter().map(context_item_from_search).collect(),
            });
        }
        RetrievalContextScope::Note | RetrievalContextScope::Selection => {
            let semantic = state.semantic.clone();
            let response = tauri::async_runtime::spawn_blocking(move || {
                semantic.related_notes(
                    current_path_raw.as_deref(),
                    &current_title,
                    &resolved_body,
                    match scope {
                        RetrievalContextScope::Selection => selected_text.as_deref(),
                        _ => None,
                    },
                    effective_limit,
                )
            })
            .await
            .map_err(|err| err.to_string())??;
            Ok(RetrievalContextResponse {
                status: response.status,
                scope: response.scope,
                reason: response.reason,
                items: response
                    .items
                    .into_iter()
                    .map(|item| RetrievalContextItem {
                        note_id: None,
                        note_path: Some(item.note_path),
                        note_title: item.note_title,
                        section_label: item.section_label,
                        excerpt: item.excerpt,
                        match_text: item.match_text,
                        source: "semantic".to_string(),
                        reason: "related".to_string(),
                        score: item.score,
                        lexical_score: None,
                        semantic_score: Some(item.score),
                        start_line: Some(item.start_line),
                        end_line: Some(item.end_line),
                    })
                    .collect(),
            })
        }
    }
}

fn context_item_from_search(result: NoteSearchResult) -> RetrievalContextItem {
    let source = if result.reason_labels.iter().any(|label| label == "keyword")
        && result.reason_labels.iter().any(|label| label == "semantic")
    {
        "hybrid"
    } else if result.reason_labels.iter().any(|label| label == "semantic") {
        "semantic"
    } else {
        "lexical"
    };
    RetrievalContextItem {
        note_id: result.note_id,
        note_path: result.note_path,
        note_title: result.file_name,
        section_label: result.section_label,
        excerpt: result.excerpt,
        match_text: result.match_text,
        source: source.to_string(),
        reason: result.reason_labels.join(","),
        score: result
            .semantic_score
            .or(result.lexical_score)
            .unwrap_or_default(),
        lexical_score: result.lexical_score,
        semantic_score: result.semantic_score,
        start_line: result.start_line,
        end_line: result.end_line,
    }
}

pub(super) fn build_draft_ref(
    current_path: Option<&Path>,
    current_title: &str,
    current_markdown: Option<String>,
    current_body_hash: Option<String>,
) -> DraftRef {
    DraftRef {
        path: current_path.map(|path| path.to_string_lossy().into_owned()),
        title: current_title.to_string(),
        hash: current_body_hash,
        body: current_markdown,
        body_not_needed: false,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_search_fingerprint(
    normalized_query: &str,
    mode: &SearchMode,
    current_path: Option<&Path>,
    body_hash: Option<&str>,
    limit: usize,
    lexical_weight: Option<f32>,
    semantic_weight: Option<f32>,
) -> String {
    format!(
        "{}|{:?}|{}|{}|{}|{:?}|{:?}",
        normalized_query,
        mode,
        current_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        body_hash.unwrap_or(""),
        limit,
        lexical_weight,
        semantic_weight,
    )
}

fn build_related_fingerprint(
    current_path: Option<&Path>,
    body_hash: Option<&str>,
    selected_text: Option<&str>,
    limit: usize,
) -> String {
    format!(
        "{}|{}|{}|{}",
        current_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        body_hash.unwrap_or(""),
        selected_text.unwrap_or(""),
        limit,
    )
}

#[allow(clippy::too_many_arguments)]
fn collect_lexical_candidates(
    state: &State<'_, AppState>,
    query: &str,
    notes_dir: &Path,
    mode: SearchMode,
    current_path: Option<&Path>,
    current_title: &str,
    current_markdown: &str,
    current_body_hash: Option<&str>,
    normalized_query: &str,
    query_terms: &[&str],
) -> Result<Vec<ScoredSearchResult>, String> {
    let current_override = build_current_override_cached(
        current_path,
        current_title,
        current_markdown,
        current_body_hash,
    );
    let mut candidates = Vec::new();
    match mode {
        SearchMode::Current => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note_exact_matches(
                    current_path,
                    current_note,
                    normalized_query,
                ));
                if candidates.is_empty() {
                    candidates.extend(search_note(
                        current_path,
                        current_note,
                        normalized_query,
                        query_terms,
                    ));
                }
            }
        }
        SearchMode::All => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path,
                    current_note,
                    normalized_query,
                    query_terms,
                ));
            }

            // Phase 5: `ensure_interactive_index` now write-throughs to the
            // lexical mirror, so the search path no longer needs to clone the
            // entire `notes_index.entries` and call `sync_with_notes_index`
            // on every keystroke. Existing watcher + interactive entry points
            // keep the Tantivy index in step with `notes_index`.
            state.ensure_interactive_index(
                notes_dir,
                INTERACTIVE_INDEX_REFRESH_MAX_AGE,
                "search_notes_all",
            )?;

            candidates.extend(state.lexical.search(
                query,
                normalized_query,
                query_terms,
                MAX_SEARCH_RESULTS,
                current_path,
            )?);
        }
    }

    Ok(candidates)
}

fn finalize_lexical_results(
    mut candidates: Vec<ScoredSearchResult>,
    limit: usize,
) -> Vec<NoteSearchResult> {
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
            .then_with(|| left.result.note_path.cmp(&right.result.note_path))
    });
    candidates.truncate(limit.max(1));
    candidates
        .into_iter()
        .map(|mut candidate| {
            candidate.result.lexical_score = Some(candidate.score as f32);
            candidate.result.reason_labels = vec!["keyword".to_string()];
            candidate.result
        })
        .collect()
}

pub(super) fn merge_hybrid_candidates(
    lexical_candidates: Vec<ScoredSearchResult>,
    semantic_matches: Vec<SemanticChunkMatch>,
    normalized_query: &str,
    current_path: Option<&Path>,
    limit: usize,
    lexical_weight: f32,
    semantic_weight: f32,
) -> Vec<NoteSearchResult> {
    let max_lexical = lexical_candidates
        .iter()
        .map(|candidate| candidate.score as f32)
        .fold(0.0, f32::max);
    let max_semantic = semantic_matches
        .iter()
        .map(|candidate| candidate.score)
        .fold(0.0, f32::max);
    let mut merged = HashMap::<HybridCandidateKey, HybridCandidate>::new();

    for lexical_candidate in lexical_candidates {
        let mut result = lexical_candidate.result;
        let lexical_score = if max_lexical > 0.0 {
            lexical_candidate.score as f32 / max_lexical
        } else {
            0.0
        };
        result.reason_labels.push("keyword".to_string());
        result.lexical_score = Some(lexical_score);
        let structural_boost = structural_boost(&result, normalized_query, current_path);
        merged.insert(
            hybrid_candidate_key(&result),
            HybridCandidate {
                lexical_score,
                semantic_score: 0.0,
                structural_boost,
                result,
            },
        );
    }

    for semantic_match in semantic_matches {
        let semantic_score = if max_semantic > 0.0 {
            semantic_match.score / max_semantic
        } else {
            0.0
        };
        let key = HybridCandidateKey {
            note_path: Some(semantic_match.note_path.clone()),
            section_label: semantic_match.section_label.clone(),
            match_text: semantic_match.match_text.clone(),
            start_line: Some(semantic_match.start_line),
            end_line: Some(semantic_match.end_line),
        };
        let file_name = Path::new(&semantic_match.note_path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(&semantic_match.note_title)
            .to_string();
        let structural_boost =
            structural_boost_from_semantic(&semantic_match, normalized_query, current_path);

        let entry = merged.entry(key).or_insert_with(|| HybridCandidate {
            lexical_score: 0.0,
            semantic_score: 0.0,
            structural_boost,
            result: NoteSearchResult {
                note_id: None,
                note_path: Some(semantic_match.note_path.clone()),
                file_name,
                section_label: semantic_match.section_label.clone(),
                excerpt: semantic_match.excerpt.clone(),
                highlight_ranges: Vec::new(),
                match_text: semantic_match.match_text.clone(),
                reason_labels: vec!["semantic".to_string()],
                lexical_score: None,
                semantic_score: Some(semantic_score),
                start_line: Some(semantic_match.start_line),
                end_line: Some(semantic_match.end_line),
            },
        });

        entry.semantic_score = entry.semantic_score.max(semantic_score);
        entry.result.semantic_score = Some(entry.semantic_score);
        if !entry
            .result
            .reason_labels
            .iter()
            .any(|label| label == "semantic")
        {
            entry.result.reason_labels.push("semantic".to_string());
        }
        entry.structural_boost = entry.structural_boost.max(structural_boost);
    }

    let mut ranked = merged.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        let left_score = lexical_weight * left.lexical_score
            + semantic_weight * left.semantic_score
            + 0.10 * left.structural_boost;
        let right_score = lexical_weight * right.lexical_score
            + semantic_weight * right.semantic_score
            + 0.10 * right.structural_boost;
        right_score
            .total_cmp(&left_score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
    });

    ranked.truncate(limit.max(1));
    ranked
        .into_iter()
        .map(|mut candidate| {
            candidate.result.lexical_score = Some(candidate.lexical_score);
            candidate.result.semantic_score = Some(candidate.semantic_score);
            candidate.result
        })
        .collect()
}

fn hybrid_candidate_key(result: &NoteSearchResult) -> HybridCandidateKey {
    HybridCandidateKey {
        note_path: result.note_path.clone(),
        section_label: result.section_label.clone(),
        match_text: result.match_text.clone(),
        start_line: result.start_line,
        end_line: result.end_line,
    }
}

fn structural_boost(
    result: &NoteSearchResult,
    normalized_query: &str,
    current_path: Option<&Path>,
) -> f32 {
    let mut boost = 0.0;
    let excerpt = normalize_search_text(&result.excerpt);
    let file_name = normalize_search_text(&result.file_name);
    let section_label = normalize_search_text(&result.section_label);

    if file_name.contains(normalized_query) {
        boost += 1.0;
    }
    if section_label.contains(normalized_query) {
        boost += 0.7;
    }
    if excerpt.contains(normalized_query) {
        boost += 0.9;
    }
    if current_path
        .and_then(|path| path.to_str())
        .zip(result.note_path.as_deref())
        .is_some_and(|(current, result_path)| current == result_path)
    {
        boost -= 0.2;
    }

    boost
}

fn structural_boost_from_semantic(
    result: &SemanticChunkMatch,
    normalized_query: &str,
    current_path: Option<&Path>,
) -> f32 {
    let mut boost = 0.0;
    let title = normalize_search_text(&result.note_title);
    let excerpt = normalize_search_text(&result.excerpt);

    if title.contains(normalized_query) {
        boost += 1.0;
    }
    if excerpt.contains(normalized_query) {
        boost += 0.8;
    }
    if current_path
        .and_then(|path| path.to_str())
        .is_some_and(|current| current == result.note_path)
    {
        boost -= 0.2;
    }
    boost
}
