use crate::{index::AppState, note::DocumentKind, services::note_timeline::NoteTimeline};
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
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct VaultDateFilters {
    pub(crate) created_after: Option<u64>,
    pub(crate) created_before: Option<u64>,
    pub(crate) updated_after: Option<u64>,
    pub(crate) updated_before: Option<u64>,
}

impl VaultDateFilters {
    fn is_active(self) -> bool {
        self.created_after.is_some()
            || self.created_before.is_some()
            || self.updated_after.is_some()
            || self.updated_before.is_some()
    }
}

fn matches_date_filters(note: &crate::index::IndexedNote, filters: VaultDateFilters) -> bool {
    !filters
        .created_after
        .is_some_and(|value| note.created_at_millis < value)
        && !filters
            .created_before
            .is_some_and(|value| note.created_at_millis > value)
        && !filters
            .updated_after
            .is_some_and(|value| note.updated_at_millis < value)
        && !filters
            .updated_before
            .is_some_and(|value| note.updated_at_millis > value)
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
    date_filters: VaultDateFilters,
) -> Result<Vec<VaultRetrievalItem>, String> {
    let content_read = NoteTimeline::new(state).begin_current_content_read()?;
    let limit = limit.clamp(1, 20);
    let terms = query
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|term| term.len() > 1)
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    let date_only = terms.is_empty();
    if date_only && !date_filters.is_active() {
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
                || !matches_date_filters(indexed, date_filters)
            {
                continue;
            }
            let paragraph = (!date_only).then(|| {
                indexed.paragraphs.iter().find(|paragraph| {
                    terms
                        .iter()
                        .any(|term| paragraph.text_lower.contains(term.as_str()))
                })
            });
            let paragraph = paragraph.flatten();
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
            if !date_only && matches == 0 {
                continue;
            }
            let lexical_score = (!date_only).then(|| matches as f32 / terms.len() as f32);
            let score = lexical_score.unwrap_or(1.0);
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
                    score,
                    lexical_score,
                    semantic_score: None,
                    start_line: paragraph
                        .and_then(|value| value.lines.first())
                        .map(|line| line.line_number),
                    end_line: paragraph
                        .and_then(|value| value.lines.last())
                        .map(|line| line.line_number),
                    block_anchor: None,
                    created_at_millis: indexed.created_at_millis,
                    updated_at_millis: indexed.updated_at_millis,
                },
            );
        }
    }

    let semantic_enabled = state
        .semantic
        .get_settings()
        .map(|settings| settings.semantic_search_enabled)
        .unwrap_or(false);
    if semantic_enabled && !date_only {
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
                || !matches_date_filters(&indexed, date_filters)
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
                    created_at_millis: indexed.created_at_millis,
                    updated_at_millis: indexed.updated_at_millis,
                });
        }
    }

    let mut results = candidates.into_values().collect::<Vec<_>>();
    if date_only {
        let created_only = (date_filters.created_after.is_some()
            || date_filters.created_before.is_some())
            && date_filters.updated_after.is_none()
            && date_filters.updated_before.is_none();
        results.sort_by(|left, right| {
            let (left_date, right_date) = if created_only {
                (left.created_at_millis, right.created_at_millis)
            } else {
                (left.updated_at_millis, right.updated_at_millis)
            };
            right_date
                .cmp(&left_date)
                .then_with(|| left.title.cmp(&right.title))
        });
    } else {
        results.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.title.cmp(&right.title))
        });
    }
    results.truncate(limit);
    if !content_read.is_current() {
        results.clear();
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{matches_date_filters, VaultDateFilters};
    use crate::index::build_indexed_note;
    use std::path::Path;

    #[test]
    fn date_filters_use_created_and_updated_frontmatter_independently() {
        let markdown = "---\ngneauxghts:\n  id: dated-note\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-02-01T00:00:00Z\n---\n\nBody";
        let note = build_indexed_note(Path::new("dated.md"), markdown, 42);
        let january_15 = crate::note::parse_rfc3339_millis("2026-01-15T00:00:00Z");

        assert!(matches_date_filters(
            &note,
            VaultDateFilters {
                created_before: january_15,
                updated_after: january_15,
                ..VaultDateFilters::default()
            }
        ));
        assert!(!matches_date_filters(
            &note,
            VaultDateFilters {
                created_after: january_15,
                ..VaultDateFilters::default()
            }
        ));
    }
}
