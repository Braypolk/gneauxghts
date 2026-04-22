use super::{prepare_notes_dir, SearchMode, INTERACTIVE_INDEX_REFRESH_MAX_AGE};
use crate::{
    index::{build_current_override, normalize_search_text, AppState, NotesIndex},
    search::{
        build_recent_result, search_note, NoteSearchResult, ScoredSearchResult, MAX_SEARCH_RESULTS,
    },
    semantic::{RelatedNotesResponse, SemanticChunkMatch},
    state::{
        prune_recent_note_ids, read_state, resolve_note_id_from_path, validate_current_path,
        write_state,
    },
};
use std::{collections::HashMap, path::Path, time::Instant};
use tauri::State;

#[derive(Clone)]
struct HybridCandidate {
    lexical_score: f32,
    semantic_score: f32,
    structural_boost: f32,
    result: NoteSearchResult,
}

#[tauri::command]
pub(crate) fn list_recent_notes(
    state: State<'_, AppState>,
    limit: usize,
    current_path: Option<String>,
    current_title: String,
    current_markdown: String,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = prepare_notes_dir(true)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let _ = current_title;
    let _ = current_markdown;
    let mut persisted_state = read_state(&notes_dir)?;
    prune_recent_note_ids(&mut persisted_state, &notes_dir);
    write_state(&notes_dir, &persisted_state)?;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(&notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

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
pub(crate) fn search_notes(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_title: String,
    current_markdown: String,
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
    let mut candidates = collect_lexical_candidates(
        &state,
        &query,
        &notes_dir,
        mode,
        current_path.as_deref(),
        &current_title,
        &current_markdown,
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
pub(crate) async fn search_notes_hybrid(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_title: String,
    current_markdown: String,
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

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let lexical_candidates = collect_lexical_candidates(
        &state,
        &query,
        &notes_dir,
        mode.clone(),
        current_path.as_deref(),
        &current_title,
        &current_markdown,
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
        return Ok(finalize_lexical_results(lexical_candidates, limit));
    }

    let semantic = state.semantic.clone();
    let semantic_query = query.clone();
    let semantic_matches = tauri::async_runtime::spawn_blocking(move || {
        semantic.semantic_matches_for_text(
            &semantic_query,
            current_path_raw.as_deref(),
            limit.saturating_mul(3).max(limit),
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    let ranked = merge_hybrid_candidates(
        lexical_candidates,
        semantic_matches,
        &normalized_query,
        current_path.as_deref(),
        limit,
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
    Ok(ranked)
}

#[tauri::command]
pub(crate) async fn get_related_notes(
    state: State<'_, AppState>,
    current_path: Option<String>,
    current_title: String,
    current_markdown: String,
    selected_text: Option<String>,
    limit: usize,
) -> Result<RelatedNotesResponse, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_path_raw = current_path
        .as_deref()
        .map(|path| path.to_string_lossy().into_owned());
    let semantic = state.semantic.clone();

    tauri::async_runtime::spawn_blocking(move || {
        semantic.related_notes(
            current_path_raw.as_deref(),
            &current_title,
            &current_markdown,
            selected_text.as_deref(),
            limit.max(1),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

fn collect_lexical_candidates(
    state: &State<'_, AppState>,
    query: &str,
    notes_dir: &Path,
    mode: SearchMode,
    current_path: Option<&Path>,
    current_title: &str,
    current_markdown: &str,
    normalized_query: &str,
    query_terms: &[&str],
) -> Result<Vec<ScoredSearchResult>, String> {
    let current_override = build_current_override(current_path, current_title, current_markdown);
    let mut candidates = Vec::new();
    match mode {
        SearchMode::Current => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path,
                    current_note,
                    normalized_query,
                    query_terms,
                ));
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

            let lexical_entries = {
                let mut notes_index = state
                    .notes_index
                    .lock()
                    .map_err(|_| "Search index lock poisoned".to_string())?;
                if notes_index
                    .refresh_if_stale_with_flag(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?
                {
                    Some(notes_index.entries.clone())
                } else {
                    None
                }
            };
            if let Some(lexical_entries) = lexical_entries {
                state.lexical.sync_with_notes_index(&lexical_entries)?;
            }

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
    let mut merged = HashMap::<String, HybridCandidate>::new();

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
        let key = format!(
            "{}::{}::{}::{}",
            semantic_match.note_path,
            semantic_match.section_label,
            semantic_match.start_line,
            semantic_match.end_line
        );
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

fn hybrid_candidate_key(result: &NoteSearchResult) -> String {
    format!(
        "{}::{}::{}",
        result.note_path.as_deref().unwrap_or("draft"),
        result.section_label,
        result.match_text
    )
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
