use super::{
    prepare_notes_dir, read_indexed_note_from_path, NoteLinkSuggestion, ResolvedNoteLink,
    INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    index::{
        build_current_override, collapse_whitespace, normalize_search_text, AppState, IndexedNote,
    },
    state::validate_current_path,
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};
use tauri::State;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ParsedWikilinkTarget {
    pub(super) note: Option<String>,
    pub(super) section: Option<String>,
}

#[tauri::command]
pub(crate) fn resolve_note_link(
    state: State<'_, AppState>,
    raw_target: String,
    current_path: Option<String>,
    current_title: String,
    current_markdown: String,
) -> Result<Option<ResolvedNoteLink>, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_override =
        build_current_override(current_path.as_deref(), &current_title, &current_markdown);
    let target = parse_wikilink_target(&raw_target);
    let Some(note_path) = resolve_wikilink_note_path(
        &state,
        &notes_dir,
        current_path.as_deref(),
        current_override.as_ref(),
        target.note.as_deref(),
    )?
    else {
        return Ok(None);
    };

    let note = if current_path.as_deref() == Some(note_path.as_path()) {
        current_override
            .as_ref()
            .cloned()
            .or_else(|| read_indexed_note_from_path(&note_path).ok().flatten())
    } else {
        read_indexed_note_from_path(&note_path)?
    };
    let Some(note) = note else {
        return Ok(None);
    };

    Ok(Some(resolve_note_link_target(
        &note_path,
        &note,
        target.section.as_deref(),
    )))
}

#[tauri::command]
pub(crate) fn autocomplete_note_links(
    state: State<'_, AppState>,
    raw_target: String,
    current_path: Option<String>,
    current_title: String,
    current_markdown: String,
    limit: usize,
) -> Result<Vec<NoteLinkSuggestion>, String> {
    let notes_dir = prepare_notes_dir(false)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_override =
        build_current_override(current_path.as_deref(), &current_title, &current_markdown);
    let target = parse_wikilink_target(&raw_target);
    let limit = limit.max(1);

    if raw_target.contains('|') {
        return Ok(Vec::new());
    }

    if raw_target.contains('#') {
        let Some(note) = resolve_wikilink_note_for_sections(
            &state,
            &notes_dir,
            current_path.as_deref(),
            current_override.as_ref(),
            target.note.as_deref(),
        )?
        else {
            return Ok(Vec::new());
        };

        return Ok(build_section_suggestions(
            target.note.as_deref(),
            target.section.as_deref().unwrap_or_default(),
            note,
            limit,
        ));
    }

    build_note_suggestions(
        &state,
        &notes_dir,
        current_path.as_deref(),
        current_override.as_ref(),
        target.note.as_deref().unwrap_or_default(),
        limit,
    )
}

pub(super) fn parse_wikilink_target(raw_target: &str) -> ParsedWikilinkTarget {
    let target = raw_target
        .split_once('|')
        .map(|(target, _)| target)
        .unwrap_or(raw_target)
        .trim();
    let (note, section) = target
        .split_once('#')
        .map(|(note, section)| (Some(note), Some(section)))
        .unwrap_or((Some(target), None));

    ParsedWikilinkTarget {
        note: note
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        section: section
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    }
}

fn normalize_note_reference(value: &str) -> String {
    let trimmed = value.trim();
    let without_extension = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".MD"))
        .unwrap_or(trimmed);
    normalize_search_text(without_extension)
}

fn note_matches_reference(reference: &str, note: &IndexedNote) -> bool {
    let normalized_reference = normalize_note_reference(reference);
    !normalized_reference.is_empty()
        && (normalized_reference == note.title_lower
            || normalized_reference == note.file_name_lower)
}

fn resolve_wikilink_note_path(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    current_path: Option<&Path>,
    current_override: Option<&IndexedNote>,
    note_reference: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(note_reference) = note_reference else {
        return Ok(current_path.map(Path::to_path_buf));
    };

    if let (Some(current_path), Some(current_override)) = (current_path, current_override) {
        if note_matches_reference(note_reference, current_override) {
            return Ok(Some(current_path.to_path_buf()));
        }
    }

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

    Ok(index
        .entries
        .iter()
        .find(|(_, note)| note_matches_reference(note_reference, note))
        .map(|(path, _)| path.clone()))
}

fn resolve_wikilink_note_for_sections(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    current_path: Option<&Path>,
    current_override: Option<&IndexedNote>,
    note_reference: Option<&str>,
) -> Result<Option<IndexedNote>, String> {
    let Some(note_reference) = note_reference else {
        return Ok(current_override.cloned().or_else(|| {
            current_path.and_then(|path| read_indexed_note_from_path(path).ok().flatten())
        }));
    };

    if let Some(current_override) = current_override {
        if note_matches_reference(note_reference, current_override) {
            return Ok(Some(current_override.clone()));
        }
    }

    let Some(note_path) = resolve_wikilink_note_path(
        state,
        notes_dir,
        current_path,
        current_override,
        Some(note_reference),
    )?
    else {
        return Ok(None);
    };

    read_indexed_note_from_path(&note_path)
}

fn display_text_for_section(text: &str) -> String {
    let normalized_lines = text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            let trimmed = if trimmed.starts_with('#') {
                trimmed.trim_start_matches('#').trim()
            } else if let Some(rest) = trimmed.strip_prefix("> ") {
                rest.trim()
            } else if let Some(rest) = trimmed
                .strip_prefix("- [ ] ")
                .or_else(|| trimmed.strip_prefix("- [x] "))
                .or_else(|| trimmed.strip_prefix("- [X] "))
                .or_else(|| trimmed.strip_prefix("* [ ] "))
                .or_else(|| trimmed.strip_prefix("* [x] "))
                .or_else(|| trimmed.strip_prefix("* [X] "))
            {
                rest.trim()
            } else if let Some(rest) = trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
            {
                rest.trim()
            } else {
                trimmed
            };

            let trimmed = trimmed.replace("[[", "").replace("]]", "");
            trimmed
                .chars()
                .filter(|ch| !matches!(ch, '`' | '*' | '_' | '~'))
                .collect::<String>()
        })
        .collect::<Vec<_>>();

    collapse_whitespace(&normalized_lines.join(" "))
}

fn build_note_suggestions(
    state: &State<'_, AppState>,
    notes_dir: &Path,
    current_path: Option<&Path>,
    current_override: Option<&IndexedNote>,
    query: &str,
    limit: usize,
) -> Result<Vec<NoteLinkSuggestion>, String> {
    let normalized_query = normalize_note_reference(query);
    let mut suggestions = Vec::<(u8, String, NoteLinkSuggestion)>::new();
    let mut seen_values = HashSet::<String>::new();

    if let (Some(_current_path), Some(current_override)) = (current_path, current_override) {
        let label = current_override.title.clone();
        let value = label.clone();
        let note_label = current_override.title_lower.clone();
        let file_label = current_override.file_name_lower.clone();
        let matches_query = normalized_query.is_empty()
            || note_label.contains(&normalized_query)
            || file_label.contains(&normalized_query);

        if matches_query && seen_values.insert(value.clone()) {
            let rank = if note_label.starts_with(&normalized_query)
                || file_label.starts_with(&normalized_query)
            {
                0
            } else {
                1
            };

            suggestions.push((
                rank,
                label.to_lowercase(),
                NoteLinkSuggestion {
                    kind: "note".to_string(),
                    value,
                    label: label.clone(),
                    detail: "Current note".to_string(),
                },
            ));
        }
    }

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh_if_stale(notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE)?;

    for (path, note) in &index.entries {
        if current_path.is_some_and(|current_path| current_path == path.as_path()) {
            continue;
        }

        let matches_query = normalized_query.is_empty()
            || note.title_lower.contains(&normalized_query)
            || note.file_name_lower.contains(&normalized_query);
        if !matches_query {
            continue;
        }

        let value = note.title.clone();
        if !seen_values.insert(value.clone()) {
            continue;
        }

        let rank = if note.title_lower.starts_with(&normalized_query)
            || note.file_name_lower.starts_with(&normalized_query)
        {
            0
        } else {
            1
        };
        let detail = if note.file_name == note.title {
            "Note".to_string()
        } else {
            note.file_name.clone()
        };

        suggestions.push((
            rank,
            note.title_lower.clone(),
            NoteLinkSuggestion {
                kind: "note".to_string(),
                value,
                label: note.title.clone(),
                detail,
            },
        ));
    }

    suggestions.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    suggestions.truncate(limit);

    Ok(suggestions
        .into_iter()
        .map(|(_, _, suggestion)| suggestion)
        .collect())
}

fn build_section_suggestions(
    note_reference: Option<&str>,
    query: &str,
    note: IndexedNote,
    limit: usize,
) -> Vec<NoteLinkSuggestion> {
    let normalized_query = normalize_section_reference(query);
    let prefix = note_reference
        .map(|note_reference| format!("{}#", note_reference.trim()))
        .unwrap_or_else(|| "#".to_string());
    let mut suggestions = Vec::<(u8, String, NoteLinkSuggestion)>::new();
    let mut seen_values = HashSet::<String>::new();

    for paragraph in note
        .paragraphs
        .iter()
        .filter(|paragraph| paragraph.section_label != "Title")
    {
        let label = display_text_for_section(&paragraph.text);
        if label.is_empty() {
            continue;
        }

        let normalized_label = normalize_search_text(&label);
        if !normalized_query.is_empty() && !normalized_label.contains(&normalized_query) {
            continue;
        }

        let value = format!("{prefix}{label}");
        if !seen_values.insert(value.clone()) {
            continue;
        }

        let rank = if normalized_label.starts_with(&normalized_query) {
            0
        } else {
            1
        };
        let detail = if paragraph.text.trim_start().starts_with('#') {
            format!("Header in {}", note.title)
        } else {
            format!("{} in {}", paragraph.section_label, note.title)
        };

        suggestions.push((
            rank,
            normalized_label.clone(),
            NoteLinkSuggestion {
                kind: "section".to_string(),
                value,
                label,
                detail,
            },
        ));
    }

    suggestions.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    suggestions.truncate(limit);

    suggestions
        .into_iter()
        .map(|(_, _, suggestion)| suggestion)
        .collect()
}

fn normalize_section_reference(value: &str) -> String {
    normalize_search_text(value.trim().trim_start_matches('^'))
}

pub(super) fn resolve_note_link_target(
    note_path: &Path,
    note: &IndexedNote,
    section_reference: Option<&str>,
) -> ResolvedNoteLink {
    let fallback = ResolvedNoteLink {
        note_id: note.note_id.clone(),
        note_path: note_path.to_string_lossy().into_owned(),
        section_label: "Title".to_string(),
        match_text: note.title.clone(),
    };

    let Some(section_reference) = section_reference else {
        return fallback;
    };

    let normalized_reference = normalize_section_reference(section_reference);
    if normalized_reference.is_empty() || normalized_reference == "title" {
        return fallback;
    }

    let paragraph_number = normalized_reference
        .strip_prefix("paragraph ")
        .and_then(|value| value.parse::<usize>().ok());

    let matched_paragraph = note
        .paragraphs
        .iter()
        .find(|paragraph| {
            paragraph_number.is_some_and(|paragraph_number| {
                paragraph.paragraph_index == Some(paragraph_number.saturating_sub(1))
            })
        })
        .or_else(|| {
            note.paragraphs.iter().find(|paragraph| {
                normalize_search_text(&paragraph.section_label) == normalized_reference
            })
        })
        .or_else(|| {
            note.paragraphs
                .iter()
                .find(|paragraph| paragraph.text_lower == normalized_reference)
        })
        .or_else(|| {
            note.paragraphs.iter().find(|paragraph| {
                paragraph.text_lower.starts_with(&normalized_reference)
                    || paragraph.text_lower.contains(&normalized_reference)
            })
        });

    matched_paragraph.map_or(fallback, |paragraph| ResolvedNoteLink {
        note_id: note.note_id.clone(),
        note_path: note_path.to_string_lossy().into_owned(),
        section_label: paragraph.section_label.clone(),
        match_text: paragraph.text.clone(),
    })
}
