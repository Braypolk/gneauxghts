use crate::index::{IndexedNote, IndexedParagraph};
use serde::Serialize;
use std::path::Path;

pub(crate) const MAX_SEARCH_RESULTS: usize = 12;
const MAX_EXCERPT_LENGTH: usize = 180;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextRange {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteSearchResult {
    #[serde(default)]
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: Option<String>,
    pub(crate) file_name: String,
    pub(crate) section_label: String,
    pub(crate) excerpt: String,
    pub(crate) highlight_ranges: Vec<TextRange>,
    pub(crate) match_text: String,
    #[serde(default)]
    pub(crate) reason_labels: Vec<String>,
    #[serde(default)]
    pub(crate) lexical_score: Option<f32>,
    #[serde(default)]
    pub(crate) semantic_score: Option<f32>,
    #[serde(default)]
    pub(crate) start_line: Option<usize>,
    #[serde(default)]
    pub(crate) end_line: Option<usize>,
}

pub(crate) struct ScoredSearchResult {
    pub(crate) score: usize,
    pub(crate) result: NoteSearchResult,
}

struct SearchCandidate<'a> {
    note_path: Option<&'a Path>,
    note: &'a IndexedNote,
    paragraph: &'a IndexedParagraph,
}

struct SearchMatch {
    match_text: String,
    match_offset: usize,
}

pub(crate) fn search_note(
    note_path: Option<&Path>,
    note: &IndexedNote,
    normalized_query: &str,
    query_terms: &[&str],
) -> Vec<ScoredSearchResult> {
    note.paragraphs
        .iter()
        .filter_map(|paragraph| {
            score_search_candidate(
                SearchCandidate {
                    note_path,
                    note,
                    paragraph,
                },
                normalized_query,
                query_terms,
            )
        })
        .collect()
}

pub(crate) fn build_recent_result(
    note_path: Option<&Path>,
    note: &IndexedNote,
) -> NoteSearchResult {
    let preview = note
        .paragraphs
        .iter()
        .find(|paragraph| paragraph.section_label != "Title")
        .or_else(|| note.paragraphs.first());

    let (section_label, excerpt) = preview
        .map(|paragraph| {
            let (excerpt, _) = excerpt_around(&paragraph.text, 0, MAX_EXCERPT_LENGTH);
            (paragraph.section_label.clone(), excerpt)
        })
        .unwrap_or_else(|| ("Title".to_string(), String::new()));

    NoteSearchResult {
        note_id: Some(note.note_id.clone()),
        note_path: note_path.map(|path| path.to_string_lossy().into_owned()),
        file_name: note.file_name.clone(),
        section_label,
        excerpt,
        highlight_ranges: Vec::new(),
        match_text: String::new(),
        reason_labels: Vec::new(),
        lexical_score: None,
        semantic_score: None,
        start_line: None,
        end_line: None,
    }
}

fn score_search_candidate(
    candidate: SearchCandidate<'_>,
    normalized_query: &str,
    query_terms: &[&str],
) -> Option<ScoredSearchResult> {
    if query_terms.iter().any(|term| {
        !candidate.note.file_name_lower.contains(term)
            && !candidate.note.title_lower.contains(term)
            && !candidate.paragraph.text_lower.contains(term)
    }) {
        return None;
    }

    let paragraph_phrase_match = candidate.paragraph.text_lower.contains(normalized_query);
    let title_phrase_match = candidate.note.title_lower.contains(normalized_query);
    let file_phrase_match = candidate.note.file_name_lower.contains(normalized_query);
    let paragraph_has_any_match = query_terms
        .iter()
        .any(|term| candidate.paragraph.text_lower.contains(term));

    if candidate.paragraph.section_label != "Title" && !paragraph_has_any_match {
        return None;
    }

    let search_match = find_best_match_in_lower(
        &candidate.paragraph.text_lower,
        normalized_query,
        query_terms,
    )?;
    let mut score = 0;

    if paragraph_phrase_match {
        score += 280;
    }
    if title_phrase_match {
        score += 160;
    }
    if file_phrase_match {
        score += 120;
    }

    for term in query_terms {
        score += count_matches(&candidate.paragraph.text_lower, term) * 40;
        score += count_matches(&candidate.note.title_lower, term) * 24;
        score += count_matches(&candidate.note.file_name_lower, term) * 18;
    }

    if candidate.paragraph.section_label == "Title" {
        score += 120;
    } else if let Some(paragraph_index) = candidate.paragraph.paragraph_index {
        score += 90usize.saturating_sub(paragraph_index * 8);
    }

    let (excerpt, highlight_ranges) = build_excerpt_and_highlights(
        &candidate.paragraph.text,
        &candidate.paragraph.text_lower,
        search_match.match_offset,
        query_terms,
    );

    Some(ScoredSearchResult {
        score,
        result: NoteSearchResult {
            note_id: Some(candidate.note.note_id.clone()),
            note_path: candidate
                .note_path
                .map(|path| path.to_string_lossy().into_owned()),
            file_name: candidate.note.file_name.clone(),
            section_label: candidate.paragraph.section_label.clone(),
            excerpt,
            highlight_ranges,
            match_text: search_match.match_text,
            reason_labels: Vec::new(),
            lexical_score: Some(score as f32),
            semantic_score: None,
            start_line: None,
            end_line: None,
        },
    })
}

fn find_best_match_in_lower(
    text_lower: &str,
    normalized_query: &str,
    query_terms: &[&str],
) -> Option<SearchMatch> {
    if let Some(match_offset) = text_lower.find(normalized_query) {
        return Some(SearchMatch {
            match_text: normalized_query.to_string(),
            match_offset,
        });
    }

    query_terms
        .iter()
        .filter_map(|term| {
            text_lower
                .find(term)
                .map(|match_offset| (*term, match_offset))
        })
        .min_by_key(|(_, match_offset)| *match_offset)
        .map(|(term, match_offset)| SearchMatch {
            match_text: term.to_string(),
            match_offset,
        })
}

pub(crate) fn build_search_preview(
    text: &str,
    normalized_query: &str,
    query_terms: &[&str],
) -> Option<(String, Vec<TextRange>, String)> {
    let text_lower = text.to_lowercase();
    let search_match = find_best_match_in_lower(&text_lower, normalized_query, query_terms)?;
    let (excerpt, highlight_ranges) =
        build_excerpt_and_highlights(text, &text_lower, search_match.match_offset, query_terms);
    Some((excerpt, highlight_ranges, search_match.match_text))
}

fn build_excerpt_and_highlights(
    text: &str,
    text_lower: &str,
    match_offset: usize,
    query_terms: &[&str],
) -> (String, Vec<TextRange>) {
    let (excerpt, excerpt_start_offset) = excerpt_around(text, match_offset, MAX_EXCERPT_LENGTH);
    let excerpt_lower = excerpt.to_lowercase();
    let mut highlight_ranges = Vec::new();

    for term in query_terms {
        for (match_start, _) in excerpt_lower.match_indices(term) {
            highlight_ranges.push(TextRange {
                start: count_chars(&excerpt_lower[..match_start]),
                end: count_chars(&excerpt_lower[..match_start]) + term.chars().count(),
            });
        }
    }

    if highlight_ranges.is_empty() && text_lower.contains(&excerpt_lower) {
        let local_offset = match_offset.saturating_sub(excerpt_start_offset);
        highlight_ranges.push(TextRange {
            start: count_chars(&text[..local_offset.min(text.len())]),
            end: count_chars(&text[..local_offset.min(text.len())]),
        });
    }

    match merge_ranges(highlight_ranges) {
        Some(ranges) => (excerpt, ranges),
        None => (excerpt, Vec::new()),
    }
}

fn merge_ranges(mut ranges: Vec<TextRange>) -> Option<Vec<TextRange>> {
    if ranges.is_empty() {
        return None;
    }

    ranges.sort_by_key(|range| range.start);
    let mut merged: Vec<TextRange> = Vec::with_capacity(ranges.len());

    for range in ranges {
        if let Some(last) = merged.last_mut() {
            if range.start <= last.end {
                last.end = last.end.max(range.end);
                continue;
            }
        }
        merged.push(range);
    }

    Some(merged)
}

fn count_matches(haystack: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }

    haystack.match_indices(needle).count()
}

fn excerpt_around(text: &str, match_offset: usize, max_chars: usize) -> (String, usize) {
    let text_chars = text.chars().collect::<Vec<_>>();
    if text_chars.len() <= max_chars {
        return (text.to_string(), 0);
    }

    let match_char_index = count_chars(&text[..match_offset.min(text.len())]);
    let half_window = max_chars / 2;
    let start_char = match_char_index.saturating_sub(half_window);
    let end_char = (start_char + max_chars).min(text_chars.len());
    let excerpt = text_chars[start_char..end_char].iter().collect::<String>();
    let trimmed = excerpt.trim().to_string();
    let mut snippet = String::new();

    if start_char > 0 {
        snippet.push('…');
    }
    snippet.push_str(&trimmed);
    if end_char < text_chars.len() {
        snippet.push('…');
    }

    (snippet, char_index_to_byte_index(text, start_char))
}

fn count_chars(value: &str) -> usize {
    value.chars().count()
}

fn char_index_to_byte_index(text: &str, char_index: usize) -> usize {
    if char_index == 0 {
        return 0;
    }

    text.char_indices()
        .nth(char_index)
        .map(|(byte_index, _)| byte_index)
        .unwrap_or(text.len())
}

#[cfg(test)]
mod tests {
    use super::{build_recent_result, search_note};
    use crate::{
        index::{build_indexed_note, normalize_search_text},
        test_support::{fixture_path, load_fixture, load_json_fixture},
    };
    use serde_json::json;

    #[test]
    fn search_note_matches_project_atlas_fixture() {
        let markdown = load_fixture("project-atlas.md");
        let note_path = fixture_path("project-atlas.md");
        let note = build_indexed_note(&note_path, &markdown, 42);
        let normalized_query = normalize_search_text("wording changes");
        let query_terms = normalized_query.split_whitespace().collect::<Vec<_>>();

        let results = search_note(
            Some(note_path.as_path()),
            &note,
            &normalized_query,
            &query_terms,
        );

        let actual = results
            .into_iter()
            .map(|candidate| {
                json!({
                    "fileName": candidate.result.file_name,
                    "sectionLabel": candidate.result.section_label,
                    "excerpt": candidate.result.excerpt,
                    "matchText": candidate.result.match_text,
                    "lexicalScore": candidate.result.lexical_score,
                })
            })
            .collect::<Vec<_>>();

        assert_eq!(
            serde_json::Value::Array(actual),
            load_json_fixture("project-atlas.search-wording-changes.json")
        );
    }

    #[test]
    fn build_recent_result_prefers_first_body_paragraph() {
        let markdown = load_fixture("project-atlas.md");
        let note_path = fixture_path("project-atlas.md");
        let note = build_indexed_note(&note_path, &markdown, 42);

        let recent = build_recent_result(Some(note_path.as_path()), &note);

        assert_eq!(recent.section_label, "Paragraph 1");
        assert_eq!(
            recent.excerpt,
            "This note tracks the roadmap for semantic retrieval in local markdown tools."
        );
        assert_eq!(recent.file_name, "project-atlas");
    }
}
