use crate::state::derive_file_stem;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

#[derive(Default)]
pub(crate) struct AppState {
    pub(crate) notes_index: Mutex<NotesIndex>,
}

#[derive(Default)]
pub(crate) struct NotesIndex {
    pub(crate) entries: HashMap<PathBuf, IndexedNote>,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct FileSignature {
    modified_millis: u64,
    len: u64,
}

#[derive(Clone)]
pub(crate) struct IndexedParagraph {
    pub(crate) section_label: String,
    pub(crate) text: String,
    pub(crate) text_lower: String,
    pub(crate) paragraph_index: Option<usize>,
}

#[derive(Clone)]
pub(crate) struct IndexedTask {
    pub(crate) section_label: Option<String>,
    pub(crate) text: String,
    pub(crate) completed: bool,
    pub(crate) depth: usize,
    pub(crate) line_number: usize,
}

#[derive(Clone)]
pub(crate) struct IndexedNote {
    signature: FileSignature,
    pub(crate) modified_millis: u64,
    pub(crate) title: String,
    pub(crate) title_lower: String,
    pub(crate) file_name: String,
    pub(crate) file_name_lower: String,
    pub(crate) paragraphs: Vec<IndexedParagraph>,
    pub(crate) tasks: Vec<IndexedTask>,
}

pub(crate) fn refresh_notes_index(state: &AppState, notes_dir: &Path) -> Result<(), String> {
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(notes_dir)
}

impl NotesIndex {
    pub(crate) fn refresh(&mut self, notes_dir: &Path) -> Result<(), String> {
        let mut seen_paths = HashSet::new();

        for entry in fs::read_dir(notes_dir).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if !is_note_file(&path) {
                continue;
            }

            seen_paths.insert(path.clone());
            let signature = read_file_signature(&path)?;
            let should_reload = self
                .entries
                .get(&path)
                .map(|indexed_note| indexed_note.signature != signature)
                .unwrap_or(true);

            if should_reload {
                self.entries
                    .insert(path.clone(), load_indexed_note(&path, signature)?);
            }
        }

        self.entries.retain(|path, _| seen_paths.contains(path));
        Ok(())
    }
}

pub(crate) fn is_note_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

pub(crate) fn build_current_override(
    current_path: Option<&Path>,
    markdown: &str,
) -> Option<IndexedNote> {
    if markdown.trim().is_empty() && current_path.is_none() {
        return None;
    }

    Some(build_indexed_note_with_signature(
        current_path,
        markdown,
        FileSignature {
            modified_millis: 0,
            len: markdown.len() as u64,
        },
    ))
}

pub(crate) fn task_key(note_path: &Path, task: &IndexedTask) -> String {
    format!(
        "{}::{}::{}::{}",
        note_path.to_string_lossy(),
        task.line_number,
        task.section_label.as_deref().unwrap_or_default(),
        task.text.to_lowercase()
    )
}

pub(crate) fn toggle_task_in_markdown(
    markdown: &str,
    line_number: usize,
    task_text: &str,
) -> Result<String, String> {
    let normalized = markdown.replace("\r\n", "\n");
    let had_trailing_newline = normalized.ends_with('\n');
    let mut lines = normalized.lines().map(str::to_string).collect::<Vec<_>>();
    let normalized_task_text = normalize_search_text(task_text);

    if lines.is_empty() {
        return Err("Task not found".to_string());
    }

    let preferred_index = line_number.saturating_sub(1);
    if preferred_index < lines.len()
        && task_line_matches(&lines[preferred_index], &normalized_task_text)
        && toggle_task_line(&mut lines[preferred_index]).is_some()
    {
        return Ok(join_task_lines(lines, had_trailing_newline));
    }

    let fallback_index = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| task_line_matches(line, &normalized_task_text))
        .min_by_key(|(index, _)| index.abs_diff(preferred_index))
        .map(|(index, _)| index)
        .ok_or_else(|| "Task not found".to_string())?;

    toggle_task_line(&mut lines[fallback_index]).ok_or_else(|| "Task not found".to_string())?;
    Ok(join_task_lines(lines, had_trailing_newline))
}

pub(crate) fn normalize_search_text(value: &str) -> String {
    collapse_whitespace(value).to_lowercase()
}

pub(crate) fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn read_file_signature(path: &Path) -> Result<FileSignature, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let modified = modified.min(u128::from(u64::MAX)) as u64;

    Ok(FileSignature {
        modified_millis: modified,
        len: metadata.len(),
    })
}

fn load_indexed_note(path: &Path, signature: FileSignature) -> Result<IndexedNote, String> {
    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(build_indexed_note_with_signature(
        Some(path),
        &markdown,
        signature,
    ))
}

fn build_indexed_note_with_signature(
    path: Option<&Path>,
    markdown: &str,
    signature: FileSignature,
) -> IndexedNote {
    let modified_millis = signature.modified_millis;
    let fallback_file_name = path
        .and_then(|path| path.file_stem())
        .and_then(|file_name| file_name.to_str())
        .filter(|file_name| !file_name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| derive_file_stem(markdown));

    let (title, body) = extract_title_and_body(markdown, &fallback_file_name);
    let file_name = fallback_file_name;

    IndexedNote {
        signature,
        modified_millis,
        title: title.clone(),
        title_lower: title.to_lowercase(),
        file_name_lower: file_name.to_lowercase(),
        paragraphs: build_paragraphs(&title, &body),
        tasks: build_tasks(markdown),
        file_name,
    }
}

fn extract_title_and_body(markdown: &str, fallback_title: &str) -> (String, String) {
    let normalized = markdown.replace("\r\n", "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let first_content_index = lines.iter().position(|line| !line.trim().is_empty());

    let Some(first_content_index) = first_content_index else {
        return (fallback_title.to_string(), String::new());
    };

    let first_content_line = lines[first_content_index].trim();
    let heading = first_content_line
        .strip_prefix("# ")
        .map(str::trim)
        .filter(|heading| !heading.is_empty());

    if let Some(title) = heading {
        let mut remaining_lines = lines[first_content_index + 1..].to_vec();
        if remaining_lines
            .first()
            .is_some_and(|line| line.trim().is_empty())
        {
            remaining_lines.remove(0);
        }

        return (title.to_string(), remaining_lines.join("\n"));
    }

    (fallback_title.to_string(), normalized)
}

fn build_paragraphs(title: &str, body: &str) -> Vec<IndexedParagraph> {
    let mut paragraphs = Vec::new();

    let normalized_title = collapse_whitespace(title);
    if !normalized_title.is_empty() {
        paragraphs.push(IndexedParagraph {
            section_label: "Title".to_string(),
            text_lower: normalized_title.to_lowercase(),
            text: normalized_title,
            paragraph_index: None,
        });
    }

    let mut current_lines = Vec::new();
    let mut paragraph_number = 0;

    for line in body.replace("\r\n", "\n").lines() {
        if line.trim().is_empty() {
            if let Some(paragraph) = finalize_paragraph(&current_lines, paragraph_number) {
                paragraph_number += 1;
                paragraphs.push(paragraph);
            }
            current_lines.clear();
            continue;
        }

        current_lines.push(line.trim().to_string());
    }

    if let Some(paragraph) = finalize_paragraph(&current_lines, paragraph_number) {
        paragraphs.push(paragraph);
    }

    paragraphs
}

fn finalize_paragraph(lines: &[String], paragraph_index: usize) -> Option<IndexedParagraph> {
    let joined = lines.join(" ");
    let text = collapse_whitespace(&joined);
    if text.is_empty() {
        return None;
    }

    Some(IndexedParagraph {
        section_label: format!("Paragraph {}", paragraph_index + 1),
        text_lower: text.to_lowercase(),
        text,
        paragraph_index: Some(paragraph_index),
    })
}

fn build_tasks(markdown: &str) -> Vec<IndexedTask> {
    let normalized = markdown.replace("\r\n", "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let first_content_index = lines.iter().position(|line| !line.trim().is_empty());
    let mut section_label = None;
    let mut indent_levels = Vec::new();
    let mut tasks = Vec::new();

    for (line_index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if Some(line_index) == first_content_index && trimmed.starts_with("# ") {
            continue;
        }

        if let Some(next_heading) = parse_heading(trimmed) {
            section_label = Some(next_heading);
            indent_levels.clear();
            continue;
        }

        if let Some((completed, text, indentation_width)) = parse_task_line(line) {
            tasks.push(IndexedTask {
                section_label: section_label.clone(),
                text,
                completed,
                depth: task_depth(indentation_width, &mut indent_levels),
                line_number: line_index + 1,
            });
        }
    }

    tasks
}

fn parse_heading(line: &str) -> Option<String> {
    let heading = line.trim_start_matches('#');
    if heading.len() == line.len() || !line.starts_with('#') {
        return None;
    }

    let heading = heading.trim();
    if heading.is_empty() {
        return None;
    }

    Some(heading.to_string())
}

fn parse_task_line(line: &str) -> Option<(bool, String, usize)> {
    let indentation_width = indentation_width(line);
    let trimmed = line.trim_start();
    let rest = trimmed
        .strip_prefix("* ")
        .or_else(|| trimmed.strip_prefix("- "))?;
    let (completed, text) = if let Some(text) = rest.strip_prefix("[ ]") {
        (false, text)
    } else if let Some(text) = rest
        .strip_prefix("[x]")
        .or_else(|| rest.strip_prefix("[X]"))
    {
        (true, text)
    } else {
        return None;
    };

    let text = collapse_whitespace(text);
    if text.is_empty() {
        return None;
    }

    Some((completed, text, indentation_width))
}

fn indentation_width(line: &str) -> usize {
    line.chars()
        .take_while(|character| character.is_whitespace())
        .map(|character| match character {
            '\t' => 2,
            _ => 1,
        })
        .sum()
}

fn task_depth(indentation_width: usize, indent_levels: &mut Vec<usize>) -> usize {
    while indent_levels
        .last()
        .is_some_and(|level| *level > indentation_width)
    {
        indent_levels.pop();
    }

    if let Some(last_level) = indent_levels.last() {
        if *last_level < indentation_width {
            indent_levels.push(indentation_width);
            return indent_levels.len() - 1;
        }

        return indent_levels.len().saturating_sub(1);
    }

    indent_levels.push(indentation_width);
    0
}

fn join_task_lines(lines: Vec<String>, had_trailing_newline: bool) -> String {
    let mut markdown = lines.join("\n");
    if had_trailing_newline {
        markdown.push('\n');
    }
    markdown
}

fn task_line_matches(line: &str, normalized_task_text: &str) -> bool {
    parse_task_line(line).is_some_and(|(_, text, _)| {
        normalized_task_text.is_empty() || normalize_search_text(&text) == normalized_task_text
    })
}

fn toggle_task_line(line: &mut String) -> Option<()> {
    let indentation_len = line.len() - line.trim_start().len();
    let indentation = &line[..indentation_len];
    let trimmed = &line[indentation_len..];
    let (bullet, rest) = if let Some(rest) = trimmed.strip_prefix("* ") {
        ("* ", rest)
    } else if let Some(rest) = trimmed.strip_prefix("- ") {
        ("- ", rest)
    } else {
        return None;
    };

    let toggled_rest = if let Some(rest) = rest.strip_prefix("[ ]") {
        format!("[x]{rest}")
    } else if let Some(rest) = rest
        .strip_prefix("[x]")
        .or_else(|| rest.strip_prefix("[X]"))
    {
        format!("[ ]{rest}")
    } else {
        return None;
    };

    *line = format!("{indentation}{bullet}{toggled_rest}");
    Some(())
}
