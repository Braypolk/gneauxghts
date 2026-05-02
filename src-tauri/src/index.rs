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
    /// Phase 5: bounded cache of recent draft bodies keyed by `(path, hash)`.
    /// Frontend sends only `hash` for keystroke-driven requests; backend
    /// re-uses the body it captured from the most recent request that did
    /// include the body, keeping the IPC payload small.
    draft_cache: Mutex<DraftCache>,
}

#[derive(Default)]
pub(crate) struct DraftCache {
    /// Bounded map of `(path, hash) -> body`. We only need to remember the
    /// last few drafts: the active note's most recent body plus a couple of
    /// adjacent revisions to absorb out-of-order requests.
    entries: std::collections::VecDeque<(String, String, String)>,
}

const DRAFT_CACHE_MAX_ENTRIES: usize = 6;

impl DraftCache {
    fn cache_key(path: Option<&str>, hash: &str) -> String {
        format!("{}|{}", path.unwrap_or(""), hash)
    }

    pub(crate) fn get(&self, path: Option<&str>, hash: &str) -> Option<String> {
        let key = Self::cache_key(path, hash);
        self.entries
            .iter()
            .find(|(cached_key, _, _)| cached_key == &key)
            .map(|(_, _, body)| body.clone())
    }

    pub(crate) fn put(&mut self, path: Option<&str>, hash: &str, body: String) {
        let key = Self::cache_key(path, hash);
        self.entries.retain(|(cached_key, _, _)| cached_key != &key);
        self.entries.push_back((key, hash.to_string(), body));
        while self.entries.len() > DRAFT_CACHE_MAX_ENTRIES {
            self.entries.pop_front();
        }
    }
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

enum PendingIndexUpdate {
    Upsert(PathBuf, IndexedNote),
    Remove(PathBuf),
}

impl AppState {
    pub(crate) fn new(semantic: SemanticState) -> Result<Self, String> {
        Ok(Self {
            notes_index: Mutex::new(NotesIndex::default()),
            lexical: Arc::new(LexicalIndex::new()?),
            semantic: Arc::new(semantic),
            interactive_invalidation: Mutex::new(InteractiveInvalidationState::default()),
            draft_cache: Mutex::new(DraftCache::default()),
        })
    }

    /// Phase 5: resolve the markdown body for a draft reference.
    ///
    /// - If `body_not_needed` is set, returns `None` (caller doesn't require it).
    /// - If the request inlines the body, the cache is updated and the body is
    ///   returned.
    /// - Otherwise the cache is consulted by `(path, hash)`. A cache miss
    ///   returns an explicit error so the frontend can retry with the body.
    pub(crate) fn resolve_draft_body(
        &self,
        draft: &crate::commands::DraftRef,
    ) -> Result<Option<String>, String> {
        if draft.body_not_needed {
            return Ok(None);
        }

        if let Some(body) = draft.body.as_ref() {
            if let Some(hash) = draft.hash.as_deref() {
                let mut cache = self
                    .draft_cache
                    .lock()
                    .map_err(|_| "Draft cache lock poisoned".to_string())?;
                cache.put(draft.path.as_deref(), hash, body.clone());
            }
            return Ok(Some(body.clone()));
        }

        let Some(hash) = draft.hash.as_deref() else {
            return Ok(None);
        };

        let cache = self
            .draft_cache
            .lock()
            .map_err(|_| "Draft cache lock poisoned".to_string())?;
        match cache.get(draft.path.as_deref(), hash) {
            Some(body) => Ok(Some(body)),
            None => Err(format!(
                "draft-cache-miss:{}",
                draft.path.as_deref().unwrap_or("")
            )),
        }
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
        let dirty_paths = {
            let mut invalidation = self
                .interactive_invalidation
                .lock()
                .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
            *invalidation
                .refresh_source_counts
                .entry(source.to_string())
                .or_insert(0) += 1;
            invalidation.dirty_paths.drain().collect::<Vec<_>>()
        };

        let had_dirty_paths = !dirty_paths.is_empty();
        let mut changed = false;
        let mut used_full_refresh = false;

        if had_dirty_paths {
            let existing_signatures = {
                let index = self
                    .notes_index
                    .lock()
                    .map_err(|_| "Search index lock poisoned".to_string())?;
                dirty_paths
                    .iter()
                    .filter_map(|path| {
                        index
                            .entries
                            .get(path)
                            .map(|note| (path.clone(), note.signature.clone()))
                    })
                    .collect::<HashMap<_, _>>()
            };
            let updates = collect_dirty_updates(dirty_paths, &existing_signatures)?;
            // Phase 5 write-through: mirror dirty updates into the lexical
            // index before they land in `notes_index`, so search no longer
            // needs to clone+resync the full entries map on every query.
            for update in &updates {
                match update {
                    PendingIndexUpdate::Upsert(path, note) => {
                        self.lexical.upsert_note(path, note)?;
                    }
                    PendingIndexUpdate::Remove(path) => {
                        self.lexical.remove_note(path)?;
                    }
                }
            }
            {
                let mut index = self
                    .notes_index
                    .lock()
                    .map_err(|_| "Search index lock poisoned".to_string())?;
                changed = index.apply_pending_updates(updates);
                index.mark_refreshed(changed);
            }
            let mut invalidation = self
                .interactive_invalidation
                .lock()
                .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
            invalidation.incremental_update_count =
                invalidation.incremental_update_count.wrapping_add(1);
        } else {
            let stale = {
                let index = self
                    .notes_index
                    .lock()
                    .map_err(|_| "Search index lock poisoned".to_string())?;
                index
                    .last_refresh_at
                    .is_none_or(|last_refresh_at| last_refresh_at.elapsed() >= max_age)
            };
            if stale {
                let existing_signatures = {
                    let index = self
                        .notes_index
                        .lock()
                        .map_err(|_| "Search index lock poisoned".to_string())?;
                    index
                        .entries
                        .iter()
                        .map(|(path, note)| (path.clone(), note.signature.clone()))
                        .collect::<HashMap<_, _>>()
                };
                let (updates, seen_paths) =
                    collect_refresh_updates(notes_dir, &existing_signatures)?;
                // Phase 5 write-through: incrementally update the lexical
                // mirror for every changed/added entry, and remove stale
                // entries that disappeared from disk.
                for (path, note) in &updates {
                    self.lexical.upsert_note(path, note)?;
                }
                let stale_lexical_paths: Vec<PathBuf> = existing_signatures
                    .keys()
                    .filter(|path| !seen_paths.contains(*path))
                    .cloned()
                    .collect();
                for path in stale_lexical_paths {
                    self.lexical.remove_note(&path)?;
                }
                {
                    let mut index = self
                        .notes_index
                        .lock()
                        .map_err(|_| "Search index lock poisoned".to_string())?;
                    changed = index.apply_refresh_updates(updates, seen_paths);
                }
                let mut invalidation = self
                    .interactive_invalidation
                    .lock()
                    .map_err(|_| "Interactive invalidation lock poisoned".to_string())?;
                invalidation.full_refresh_count = invalidation.full_refresh_count.wrapping_add(1);
                used_full_refresh = true;
            }
        }

        let revision = self
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?
            .revision();
        let epoch = self
            .interactive_invalidation
            .lock()
            .map_err(|_| "Interactive invalidation lock poisoned".to_string())?
            .epoch;
        Ok(InteractiveRefreshOutcome {
            revision,
            changed,
            used_full_refresh,
            epoch,
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
    by_id: HashMap<String, PathBuf>,
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
    /// 1-based line number in the editor body (`strip_leading_title_heading(strip_frontmatter(file))`).
    pub(crate) editor_line_number: Option<usize>,
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
    pub(crate) fn upsert_note(&mut self, path: PathBuf, note: IndexedNote) -> bool {
        if self
            .entries
            .get(&path)
            .is_some_and(|existing_note| existing_note.signature() == note.signature())
        {
            return false;
        }

        self.insert_entry(path, note);
        self.last_refresh_at = Some(Instant::now());
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn remove_note(&mut self, path: &Path) -> bool {
        if self.remove_entry(path).is_none() {
            return false;
        }
        self.last_refresh_at = Some(Instant::now());
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn path_for_note_id(&self, note_id: &str) -> Option<&PathBuf> {
        self.by_id.get(note_id)
    }

    pub(crate) fn get_note_by_note_id(&self, note_id: &str) -> Option<(&PathBuf, &IndexedNote)> {
        self.by_id
            .get(note_id)
            .and_then(|path| self.entries.get(path).map(|note| (path, note)))
    }

    fn insert_entry(&mut self, path: PathBuf, note: IndexedNote) {
        if let Some(previous) = self.entries.get(&path) {
            if previous.note_id != note.note_id {
                let stale = self.by_id.get(&previous.note_id).cloned();
                if stale.as_deref() == Some(path.as_path()) {
                    self.by_id.remove(&previous.note_id);
                }
            }
        }
        self.by_id.insert(note.note_id.clone(), path.clone());
        self.entries.insert(path, note);
    }

    fn remove_entry(&mut self, path: &Path) -> Option<IndexedNote> {
        let removed = self.entries.remove(path)?;
        if self.by_id.get(&removed.note_id).map(PathBuf::as_path) == Some(path) {
            self.by_id.remove(&removed.note_id);
        }
        Some(removed)
    }

    fn apply_pending_updates(&mut self, updates: Vec<PendingIndexUpdate>) -> bool {
        let mut changed = false;
        for update in updates {
            match update {
                PendingIndexUpdate::Upsert(path, note) => {
                    self.insert_entry(path, note);
                    changed = true;
                }
                PendingIndexUpdate::Remove(path) => {
                    changed = self.remove_entry(&path).is_some() || changed;
                }
            }
        }
        changed
    }

    fn apply_refresh_updates(
        &mut self,
        updates: Vec<(PathBuf, IndexedNote)>,
        seen_paths: HashSet<PathBuf>,
    ) -> bool {
        let mut changed = false;
        for (path, note) in updates {
            self.insert_entry(path, note);
            changed = true;
        }

        let stale_paths = self
            .entries
            .keys()
            .filter(|path| !seen_paths.contains(*path))
            .cloned()
            .collect::<Vec<_>>();
        for stale_path in stale_paths {
            changed = self.remove_entry(&stale_path).is_some() || changed;
        }

        self.mark_refreshed(changed);
        changed
    }

    fn mark_refreshed(&mut self, changed: bool) {
        self.last_refresh_at = Some(Instant::now());
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
    }
}

fn collect_dirty_updates(
    dirty_paths: Vec<PathBuf>,
    existing_signatures: &HashMap<PathBuf, FileSignature>,
) -> Result<Vec<PendingIndexUpdate>, String> {
    let mut updates = Vec::new();

    for path in dirty_paths {
        if is_note_file(&path) {
            let signature = read_file_signature(&path)?;
            if existing_signatures
                .get(&path)
                .is_some_and(|existing_signature| existing_signature == &signature)
            {
                continue;
            }
            updates.push(PendingIndexUpdate::Upsert(
                path.clone(),
                load_indexed_note(&path, signature)?,
            ));
        } else {
            updates.push(PendingIndexUpdate::Remove(path));
        }
    }

    Ok(updates)
}

fn collect_refresh_updates(
    notes_dir: &Path,
    existing_signatures: &HashMap<PathBuf, FileSignature>,
) -> Result<(Vec<(PathBuf, IndexedNote)>, HashSet<PathBuf>), String> {
    let mut seen_paths = HashSet::new();
    let mut updates = Vec::new();

    for path in collect_markdown_files_recursively(notes_dir)? {
        seen_paths.insert(path.clone());
        let signature = read_file_signature(&path)?;
        let should_reload = existing_signatures
            .get(&path)
            .map(|existing_signature| existing_signature != &signature)
            .unwrap_or(true);

        if should_reload {
            updates.push((path.clone(), load_indexed_note(&path, signature)?));
        }
    }

    Ok((updates, seen_paths))
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

    let normalized_body;
    let body = if body.contains("\r\n") {
        normalized_body = body.replace("\r\n", "\n");
        normalized_body.as_str()
    } else {
        body
    };

    for line in body.lines() {
        if line.trim().is_empty() {
            if let Some(paragraph) = finalize_paragraph(&current_lines, paragraph_number) {
                paragraph_number += 1;
                paragraphs.push(paragraph);
            }
            current_lines.clear();
            continue;
        }

        current_lines.push(line.trim());
    }

    if let Some(paragraph) = finalize_paragraph(&current_lines, paragraph_number) {
        paragraphs.push(paragraph);
    }

    paragraphs
}

fn finalize_paragraph(lines: &[&str], paragraph_index: usize) -> Option<IndexedParagraph> {
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
    let normalized_markdown;
    let normalized = if markdown.contains("\r\n") {
        normalized_markdown = markdown.replace("\r\n", "\n");
        normalized_markdown.as_str()
    } else {
        markdown
    };
    let lines = normalized.lines().collect::<Vec<_>>();
    let first_content_index = lines.iter().position(|line| !line.trim().is_empty());
    let editor_line_numbers = build_editor_line_number_map(&lines, first_content_index);
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
            let file_line = line_index + 1;
            tasks.push(IndexedTask {
                section_label: section_label.clone(),
                text,
                completed,
                depth: task_depth(indentation_width, &mut indent_levels),
                line_number: file_line,
                editor_line_number: editor_line_numbers[line_index],
            });
        }
    }

    tasks
}

fn build_editor_line_number_map(
    lines: &[&str],
    first_content_index: Option<usize>,
) -> Vec<Option<usize>> {
    let mut editor_line_numbers = vec![None; lines.len()];
    let mut body_start_index = 0usize;

    if lines.first().is_some_and(|line| *line == "---") {
        if let Some(closing_index) = lines
            .iter()
            .enumerate()
            .skip(1)
            .find_map(|(index, line)| (*line == "---").then_some(index))
        {
            body_start_index = closing_index + 1;
            if lines
                .get(body_start_index)
                .is_some_and(|line| line.trim().is_empty())
            {
                body_start_index += 1;
            }
        }
    }

    let first_body_content_index = lines
        .iter()
        .enumerate()
        .skip(body_start_index)
        .find_map(|(index, line)| (!line.trim().is_empty()).then_some(index));
    let stripped_heading_index = first_body_content_index
        .or(first_content_index.filter(|&index| index >= body_start_index))
        .filter(|&index| lines[index].trim().starts_with("# "));
    let stripped_heading_blank_index = stripped_heading_index.and_then(|index| {
        let next_index = index + 1;
        (next_index < lines.len() && lines[next_index].trim().is_empty()).then_some(next_index)
    });

    let mut editor_line_number = 1usize;
    for (index, editor_line) in editor_line_numbers
        .iter_mut()
        .enumerate()
        .skip(body_start_index)
    {
        if Some(index) == stripped_heading_index || Some(index) == stripped_heading_blank_index {
            continue;
        }

        *editor_line = Some(editor_line_number);
        editor_line_number += 1;
    }

    editor_line_numbers
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
    use super::{
        build_indexed_note, build_tasks, collect_dirty_updates, collect_refresh_updates,
        read_file_signature, toggle_task_in_markdown, NotesIndex,
    };
    use crate::test_support::{fixture_path, load_fixture, load_json_fixture, TestDir};
    use serde_json::json;
    use std::{collections::HashMap, fs};

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
                "editorLineNumber": task.editor_line_number,
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
    fn build_tasks_maps_editor_lines_without_matching_duplicate_text() {
        let markdown = "\
---
gneauxghts:
  id: 01TEST
---

# Duplicate Tasks

- [ ] Review search ranking
- [ ] Another task
- [ ] Review search ranking
";

        let tasks = build_tasks(markdown);

        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].line_number, 8);
        assert_eq!(tasks[0].editor_line_number, Some(1));
        assert_eq!(tasks[2].line_number, 10);
        assert_eq!(tasks[2].editor_line_number, Some(3));
    }

    #[test]
    fn build_tasks_maps_crlf_editor_lines() {
        let markdown = "# Tasks\r\n\r\n- [ ] First\r\n- [x] Second\r\n";

        let tasks = build_tasks(markdown);

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].line_number, 3);
        assert_eq!(tasks[0].editor_line_number, Some(1));
        assert_eq!(tasks[1].line_number, 4);
        assert_eq!(tasks[1].editor_line_number, Some(2));
    }

    #[test]
    fn dirty_update_skips_unchanged_file_signatures() {
        let temp = TestDir::new("index-dirty-unchanged");
        let note_path = temp.path().join("Stable.md");
        fs::write(&note_path, "# Stable\n\n- [ ] Ship").expect("write note");
        let signature = read_file_signature(&note_path).expect("read signature");
        let mut existing_signatures = HashMap::new();
        existing_signatures.insert(note_path.clone(), signature);

        let updates =
            collect_dirty_updates(vec![note_path], &existing_signatures).expect("collect updates");

        assert!(updates.is_empty());
    }

    #[test]
    fn full_refresh_collects_no_updates_for_unchanged_signatures() {
        let temp = TestDir::new("index-refresh-unchanged");
        let note_path = temp.path().join("Stable.md");
        fs::write(&note_path, "# Stable\n\nBody").expect("write note");
        let signature = read_file_signature(&note_path).expect("read signature");
        let mut existing_signatures = HashMap::new();
        existing_signatures.insert(note_path.clone(), signature);

        let (updates, seen_paths) =
            collect_refresh_updates(temp.path(), &existing_signatures).expect("collect refresh");

        assert!(updates.is_empty());
        assert!(seen_paths.contains(&note_path));
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
        let (updates, seen_paths) =
            collect_refresh_updates(temp.path(), &HashMap::new()).expect("collect refresh updates");
        index.apply_refresh_updates(updates, seen_paths);

        assert_eq!(index.entries.len(), 1);
        assert!(index.entries.contains_key(&nested_note));
        assert!(!index.entries.contains_key(&hidden_note));
    }
}
