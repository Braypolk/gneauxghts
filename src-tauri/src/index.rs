use crate::{
    lexical::LexicalIndex,
    note,
    path_utils::collect_markdown_files_recursively,
    semantic::SemanticState,
    state::{derive_file_stem, derive_file_stem_from_title_and_markdown},
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
    time::{Duration, Instant},
};

pub(crate) struct AppState {
    pub(crate) notes_index: Mutex<NotesIndex>,
    pub(crate) lexical: Arc<LexicalIndex>,
    pub(crate) semantic: Arc<SemanticState>,
    interactive_invalidation: Mutex<InteractiveInvalidationState>,
}

#[derive(Clone, Copy)]
pub(crate) struct InteractiveRefreshOutcome {
    pub(crate) revision: u64,
    pub(crate) changed: bool,
    pub(crate) used_full_refresh: bool,
    pub(crate) epoch: u64,
}

#[derive(Default)]
struct InteractiveInvalidationState {
    epoch: u64,
    dirty_paths: HashSet<PathBuf>,
    full_refresh_count: u64,
    incremental_update_count: u64,
    refresh_source_counts: HashMap<String, u64>,
}

impl AppState {
    pub(crate) fn new(semantic: SemanticState) -> Result<Self, String> {
        Ok(Self {
            notes_index: Mutex::new(NotesIndex::default()),
            lexical: Arc::new(LexicalIndex::new()?),
            semantic: Arc::new(semantic),
            interactive_invalidation: Mutex::new(InteractiveInvalidationState::default()),
        })
    }

    pub(crate) fn upsert_note_indexes(
        &self,
        path: PathBuf,
        note: IndexedNote,
    ) -> Result<(), String> {
        self.lexical.upsert_note(&path, &note)?;
        let mut index = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.upsert_note(path.clone(), note);
        drop(index);
        self.clear_dirty_path(&path)?;
        Ok(())
    }

    pub(crate) fn remove_note_indexes(&self, path: &Path) -> Result<(), String> {
        self.lexical.remove_note(path)?;
        let mut index = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        index.remove_note(path);
        drop(index);
        self.clear_dirty_path(path)?;
        Ok(())
    }

    pub(crate) fn mark_notes_index_dirty(&self, path: &Path, source: &str) -> Result<(), String> {
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.epoch = invalidation.epoch.wrapping_add(1);
        invalidation.dirty_paths.insert(path.to_path_buf());
        *invalidation
            .refresh_source_counts
            .entry(format!("dirty:{source}"))
            .or_insert(0) += 1;
        Ok(())
    }

    pub(crate) fn ensure_interactive_index(
        &self,
        notes_dir: &Path,
        max_age: Duration,
        source: &str,
    ) -> Result<InteractiveRefreshOutcome, String> {
        let mut index = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        *invalidation
            .refresh_source_counts
            .entry(source.to_string())
            .or_insert(0) += 1;

        let mut changed = false;
        let had_dirty_paths = !invalidation.dirty_paths.is_empty();
        if had_dirty_paths {
            let dirty_paths = invalidation.dirty_paths.drain().collect::<Vec<_>>();
            for path in dirty_paths {
                if index.apply_dirty_path(&path)? {
                    changed = true;
                }
            }
            index.mark_refreshed(changed);
            invalidation.incremental_update_count =
                invalidation.incremental_update_count.wrapping_add(1);
        }

        let mut used_full_refresh = false;
        let stale = index
            .last_refresh_at
            .is_none_or(|last_refresh_at| last_refresh_at.elapsed() >= max_age);
        if stale && !had_dirty_paths {
            changed = index.refresh(notes_dir)? || changed;
            used_full_refresh = true;
            invalidation.full_refresh_count = invalidation.full_refresh_count.wrapping_add(1);
        }

        Ok(InteractiveRefreshOutcome {
            revision: index.revision(),
            changed,
            used_full_refresh,
            epoch: invalidation.epoch,
        })
    }

    fn clear_dirty_path(&self, path: &Path) -> Result<(), String> {
        let mut invalidation = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
        invalidation.dirty_paths.remove(path);
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct NotesIndex {
    pub(crate) entries: HashMap<PathBuf, IndexedNote>,
    last_refresh_at: Option<Instant>,
    revision: u64,
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
    pub(crate) note_id: String,
    pub(crate) modified_millis: u64,
    pub(crate) title: String,
    pub(crate) title_lower: String,
    pub(crate) file_name: String,
    pub(crate) file_name_lower: String,
    pub(crate) paragraphs: Vec<IndexedParagraph>,
    pub(crate) tasks: Vec<IndexedTask>,
}

impl NotesIndex {
    pub(crate) fn refresh(&mut self, notes_dir: &Path) -> Result<bool, String> {
        let mut seen_paths = HashSet::new();
        let mut changed = false;

        for path in collect_markdown_files_recursively(notes_dir)? {
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
                changed = true;
            }
        }

        let stale_paths = self
            .entries
            .keys()
            .filter(|path| !seen_paths.contains(*path))
            .cloned()
            .collect::<Vec<_>>();
        for stale_path in stale_paths {
            if self.entries.remove(&stale_path).is_some() {
                changed = true;
            }
        }
        self.last_refresh_at = Some(Instant::now());
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
        Ok(changed)
    }

    pub(crate) fn upsert_note(&mut self, path: PathBuf, note: IndexedNote) -> bool {
        if self
            .entries
            .get(&path)
            .is_some_and(|existing_note| existing_note.signature() == note.signature())
        {
            return false;
        }

        self.entries.insert(path, note);
        self.last_refresh_at = Some(Instant::now());
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn remove_note(&mut self, path: &Path) -> bool {
        if self.entries.remove(path).is_none() {
            return false;
        }
        self.last_refresh_at = Some(Instant::now());
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn get_note_by_note_id(&self, note_id: &str) -> Option<(&PathBuf, &IndexedNote)> {
        self.entries
            .iter()
            .find(|(_, note)| note.note_id == note_id)
    }

    fn apply_dirty_path(&mut self, path: &Path) -> Result<bool, String> {
        if is_note_file(path) {
            let signature = read_file_signature(path)?;
            let should_reload = self
                .entries
                .get(path)
                .map(|indexed_note| indexed_note.signature != signature)
                .unwrap_or(true);
            if should_reload {
                self.entries
                    .insert(path.to_path_buf(), load_indexed_note(path, signature)?);
                return Ok(true);
            }
            return Ok(false);
        }

        Ok(self.entries.remove(path).is_some())
    }

    fn mark_refreshed(&mut self, changed: bool) {
        self.last_refresh_at = Some(Instant::now());
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
    }
}

impl IndexedNote {
    pub(crate) fn signature(&self) -> &FileSignature {
        &self.signature
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
    current_title: &str,
    markdown: &str,
) -> Option<IndexedNote> {
    if markdown.trim().is_empty() && current_path.is_none() && current_title.trim().is_empty() {
        return None;
    }

    Some(build_current_override_with_signature(
        current_path,
        current_title,
        markdown,
        FileSignature {
            modified_millis: 0,
            len: markdown.len() as u64,
        },
    ))
}

pub(crate) fn build_indexed_note(path: &Path, markdown: &str, modified_millis: u64) -> IndexedNote {
    build_indexed_note_with_signature(
        Some(path),
        markdown,
        FileSignature {
            modified_millis,
            len: markdown.len() as u64,
        },
    )
}

pub(crate) fn task_key(note_id: &str, task: &IndexedTask) -> String {
    format!(
        "{}::{}::{}::{}",
        note_id,
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

pub(crate) fn delete_task_in_markdown(
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
    let remove_index = if preferred_index < lines.len()
        && task_line_matches(&lines[preferred_index], &normalized_task_text)
    {
        preferred_index
    } else {
        lines
            .iter()
            .enumerate()
            .filter(|(_, line)| task_line_matches(line, &normalized_task_text))
            .min_by_key(|(index, _)| index.abs_diff(preferred_index))
            .map(|(index, _)| index)
            .ok_or_else(|| "Task not found".to_string())?
    };

    let parent_indent = indentation_width(&lines[remove_index]);
    lines.remove(remove_index);

    // Remove subtasks: any following lines that are task lines with deeper indentation
    while remove_index < lines.len() {
        let line = &lines[remove_index];
        let is_task = parse_task_line(line).is_some();
        let indent = indentation_width(line);
        if is_task && indent > parent_indent {
            lines.remove(remove_index);
        } else {
            break;
        }
    }

    Ok(join_task_lines(lines, had_trailing_newline))
}

pub(crate) fn normalize_search_text(value: &str) -> String {
    collapse_whitespace(value).to_lowercase()
}

pub(crate) fn collapse_whitespace(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    for segment in value.split_whitespace() {
        if !collapsed.is_empty() {
            collapsed.push(' ');
        }
        collapsed.push_str(segment);
    }
    collapsed
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

    let (title, body) = note::extract_file_name_title_and_body(markdown, &fallback_file_name);
    let file_name = fallback_file_name;
    let note_id =
        note::note_id_from_path_or_markdown(path, markdown).unwrap_or_else(|| file_name.clone());

    IndexedNote {
        signature,
        note_id,
        modified_millis,
        title: title.clone(),
        title_lower: title.to_lowercase(),
        file_name_lower: file_name.to_lowercase(),
        paragraphs: build_paragraphs(&title, &body),
        tasks: build_tasks(markdown),
        file_name,
    }
}

fn build_current_override_with_signature(
    path: Option<&Path>,
    current_title: &str,
    markdown: &str,
    signature: FileSignature,
) -> IndexedNote {
    let modified_millis = signature.modified_millis;
    let file_name = if current_title.trim().is_empty() {
        path.and_then(|path| path.file_stem())
            .and_then(|file_name| file_name.to_str())
            .filter(|file_name| !file_name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| derive_file_stem(markdown))
    } else {
        derive_file_stem_from_title_and_markdown(current_title, markdown)
    };

    let title = current_title.trim().to_string();
    let effective_title = if title.is_empty() {
        file_name.clone()
    } else {
        title
    };
    let note_id =
        note::note_id_from_path_or_markdown(path, markdown).unwrap_or_else(|| file_name.clone());

    IndexedNote {
        signature,
        note_id,
        modified_millis,
        title: effective_title.clone(),
        title_lower: effective_title.to_lowercase(),
        file_name_lower: file_name.to_lowercase(),
        paragraphs: build_paragraphs(&effective_title, markdown),
        tasks: build_tasks(markdown),
        file_name,
    }
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

#[cfg(test)]
mod tests {
    use super::{build_indexed_note, toggle_task_in_markdown, NotesIndex};
    use crate::test_support::{fixture_path, load_fixture, load_json_fixture, TestDir};
    use serde_json::json;
    use std::fs;

    #[test]
    fn build_indexed_note_matches_project_atlas_fixture() {
        let markdown = load_fixture("project-atlas.md");
        let note = build_indexed_note(&fixture_path("project-atlas.md"), &markdown, 42);

        let actual = json!({
            "title": note.title,
            "fileName": note.file_name,
            "paragraphs": note.paragraphs.iter().map(|paragraph| json!({
                "sectionLabel": paragraph.section_label,
                "text": paragraph.text,
            })).collect::<Vec<_>>(),
            "tasks": note.tasks.iter().map(|task| json!({
                "sectionLabel": task.section_label,
                "text": task.text,
                "completed": task.completed,
                "depth": task.depth,
                "lineNumber": task.line_number,
            })).collect::<Vec<_>>(),
        });

        assert_eq!(actual, load_json_fixture("project-atlas.index.json"));
    }

    #[test]
    fn toggle_task_in_markdown_uses_exact_line_then_nearest_match() {
        let markdown = "\
# Duplicate Tasks

- [ ] Review search ranking
- [ ] Another task
- [ ] Review search ranking
";

        let exact_toggle = toggle_task_in_markdown(markdown, 5, "Review search ranking")
            .expect("toggle exact line");
        let exact_lines = exact_toggle.lines().collect::<Vec<_>>();
        assert_eq!(exact_lines[2], "- [ ] Review search ranking");
        assert_eq!(exact_lines[4], "- [x] Review search ranking");

        let fallback_toggle = toggle_task_in_markdown(markdown, 99, "Review search ranking")
            .expect("toggle nearest line");
        let fallback_lines = fallback_toggle.lines().collect::<Vec<_>>();
        assert_eq!(fallback_lines[2], "- [ ] Review search ranking");
        assert_eq!(fallback_lines[4], "- [x] Review search ranking");
    }

    #[test]
    fn refresh_discovers_nested_notes_and_skips_hidden_directories() {
        let temp = TestDir::new("index-refresh-nested");
        let nested_dir = temp.path().join("Projects");
        let hidden_dir = temp.path().join(".obsidian");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::create_dir_all(&hidden_dir).expect("create hidden dir");

        let nested_note = nested_dir.join("Roadmap.md");
        let hidden_note = hidden_dir.join("Hidden.md");
        fs::write(&nested_note, "# Roadmap\n\nBody").expect("write nested note");
        fs::write(&hidden_note, "# Hidden\n\nBody").expect("write hidden note");

        let mut index = NotesIndex::default();
        index.refresh(temp.path()).expect("refresh index");

        assert_eq!(index.entries.len(), 1);
        assert!(index.entries.contains_key(&nested_note));
        assert!(!index.entries.contains_key(&hidden_note));
    }
}
