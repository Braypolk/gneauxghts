use crate::{index::AppState, note::DocumentKind};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

#[derive(Clone, Debug)]
pub(crate) struct VaultRetrievalItem {
    pub(crate) note_id: String,
    pub(crate) note_path: PathBuf,
    pub(crate) title: String,
    pub(crate) excerpt: String,
    pub(crate) section_label: String,
    pub(crate) score: f32,
    pub(crate) lexical_score: Option<f32>,
    pub(crate) semantic_score: Option<f32>,
    pub(crate) start_line: Option<usize>,
    pub(crate) end_line: Option<usize>,
    pub(crate) block_anchor: Option<String>,
    pub(crate) modified_millis: u64,
}

/// Shared policy-aware hybrid retrieval used by both interactive Tauri search
/// and the vault agent. Semantic failures deliberately degrade to lexical
/// matches so note recall remains useful while the local model warms up.
pub(crate) fn retrieve_vault_notes(
    state: &AppState,
    query: &str,
    limit: usize,
    allowed_note_ids: Option<&HashSet<String>>,
    excluded_note_ids: &HashSet<String>,
    modified_after: Option<u64>,
    modified_before: Option<u64>,
) -> Result<Vec<VaultRetrievalItem>, String> {
    let limit = limit.clamp(1, 20);
    let terms = query
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|term| term.len() > 1)
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let mut candidates = HashMap::<String, VaultRetrievalItem>::new();
    {
        let index = state
            .notes_index
            .lock()
            .map_err(|_| "Notes index lock poisoned".to_string())?;
        for (path, indexed) in &index.entries {
            if indexed.document_kind != DocumentKind::Note
                || excluded_note_ids.contains(&indexed.note_id)
                || allowed_note_ids.is_some_and(|ids| !ids.contains(&indexed.note_id))
                || modified_after.is_some_and(|value| indexed.modified_millis < value)
                || modified_before.is_some_and(|value| indexed.modified_millis > value)
            {
                continue;
            }
            let paragraph = indexed.paragraphs.iter().find(|paragraph| {
                terms
                    .iter()
                    .any(|term| paragraph.text_lower.contains(term.as_str()))
            });
            let matches = terms
                .iter()
                .filter(|term| {
                    indexed.title_lower.contains(term.as_str())
                        || indexed.file_name_lower.contains(term.as_str())
                        || indexed
                            .paragraphs
                            .iter()
                            .any(|paragraph| paragraph.text_lower.contains(term.as_str()))
                })
                .count();
            if matches == 0 {
                continue;
            }
            let lexical_score = matches as f32 / terms.len() as f32;
            candidates.insert(
                indexed.note_id.clone(),
                VaultRetrievalItem {
                    note_id: indexed.note_id.clone(),
                    note_path: path.clone(),
                    title: indexed.title.clone(),
                    excerpt: paragraph
                        .map(|value| value.text.clone())
                        .unwrap_or_else(|| indexed.title.clone()),
                    section_label: paragraph
                        .map(|value| value.section_label.clone())
                        .unwrap_or_default(),
                    score: lexical_score,
                    lexical_score: Some(lexical_score),
                    semantic_score: None,
                    start_line: paragraph
                        .and_then(|value| value.lines.first())
                        .map(|line| line.line_number),
                    end_line: paragraph
                        .and_then(|value| value.lines.last())
                        .map(|line| line.line_number),
                    block_anchor: None,
                    modified_millis: indexed.modified_millis,
                },
            );
        }
    }

    let semantic_enabled = state
        .semantic
        .get_settings()
        .map(|settings| settings.semantic_search_enabled)
        .unwrap_or(false);
    if semantic_enabled {
        for item in state
            .semantic
            .semantic_matches_for_text(query, None, limit.saturating_mul(3))
            .unwrap_or_default()
        {
            if item.document_kind != DocumentKind::Note {
                continue;
            }
            let path = PathBuf::from(&item.note_path);
            let indexed = {
                let index = state
                    .notes_index
                    .lock()
                    .map_err(|_| "Notes index lock poisoned".to_string())?;
                index.entries.get(&path).cloned()
            };
            let Some(indexed) = indexed else { continue };
            if excluded_note_ids.contains(&indexed.note_id)
                || allowed_note_ids.is_some_and(|ids| !ids.contains(&indexed.note_id))
                || modified_after.is_some_and(|value| indexed.modified_millis < value)
                || modified_before.is_some_and(|value| indexed.modified_millis > value)
            {
                continue;
            }
            candidates
                .entry(indexed.note_id.clone())
                .and_modify(|candidate| {
                    candidate.semantic_score = Some(item.score);
                    candidate.score = candidate.score.max(item.score);
                    if item.excerpt.len() > candidate.excerpt.len() {
                        candidate.excerpt = item.excerpt.clone();
                        candidate.section_label = item.section_label.clone();
                        candidate.start_line = Some(item.start_line);
                        candidate.end_line = Some(item.end_line);
                        candidate.block_anchor = item.block_anchor.clone();
                    }
                })
                .or_insert(VaultRetrievalItem {
                    note_id: indexed.note_id,
                    note_path: path,
                    title: item.note_title,
                    excerpt: item.excerpt,
                    section_label: item.section_label,
                    score: item.score,
                    lexical_score: None,
                    semantic_score: Some(item.score),
                    start_line: Some(item.start_line),
                    end_line: Some(item.end_line),
                    block_anchor: item.block_anchor,
                    modified_millis: indexed.modified_millis,
                });
        }
    }

    let mut results = candidates.into_values().collect::<Vec<_>>();
    results.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.title.cmp(&right.title))
    });
    results.truncate(limit);
    Ok(results)
}
