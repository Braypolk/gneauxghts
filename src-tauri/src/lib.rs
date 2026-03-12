use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::State;

const NOTES_DIRECTORY_NAME: &str = "Gneauxghts";
const STATE_FILE_NAME: &str = ".gneauxghts-state.json";
const DEFAULT_NOTE_NAME: &str = "Untitled Note";
const MAX_FILE_STEM_LENGTH: usize = 80;
const MAX_SEARCH_RESULTS: usize = 12;
const MAX_RECENT_NOTES: usize = 20;
const MAX_EXCERPT_LENGTH: usize = 180;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSession {
    markdown: String,
    path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextRange {
    start: usize,
    end: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSearchResult {
    note_path: Option<String>,
    file_name: String,
    section_label: String,
    excerpt: String,
    highlight_ranges: Vec<TextRange>,
    match_text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SearchMode {
    Current,
    All,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TaskFilter {
    Open,
    Completed,
    All,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    last_opened_path: Option<String>,
    #[serde(default)]
    recent_paths: Vec<String>,
    #[serde(default)]
    hidden_task_keys: Vec<String>,
    #[serde(default)]
    hidden_note_paths: Vec<String>,
    #[serde(default)]
    note_order: Vec<String>,
    #[serde(default)]
    collapsed_note_paths: Vec<String>,
}

#[derive(Default)]
struct AppState {
    notes_index: Mutex<NotesIndex>,
}

#[derive(Default)]
struct NotesIndex {
    entries: HashMap<PathBuf, IndexedNote>,
}

#[derive(Clone, PartialEq, Eq)]
struct FileSignature {
    modified_millis: u128,
    len: u64,
}

#[derive(Clone)]
struct IndexedParagraph {
    section_label: String,
    text: String,
    text_lower: String,
    paragraph_index: Option<usize>,
}

#[derive(Clone)]
struct IndexedTask {
    section_label: Option<String>,
    text: String,
    completed: bool,
    depth: usize,
    line_number: usize,
}

#[derive(Clone)]
struct IndexedNote {
    signature: FileSignature,
    title: String,
    title_lower: String,
    file_name: String,
    file_name_lower: String,
    paragraphs: Vec<IndexedParagraph>,
    tasks: Vec<IndexedTask>,
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

struct ScoredSearchResult {
    score: usize,
    result: NoteSearchResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskListItem {
    task_key: String,
    note_path: String,
    file_name: String,
    note_title: String,
    section_label: Option<String>,
    text: String,
    completed: bool,
    hidden: bool,
    note_hidden: bool,
    note_collapsed: bool,
    depth: usize,
    line_number: usize,
}

#[tauri::command]
fn load_note_session() -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let mut state = read_state(&notes_dir)?;
    let Some(last_opened_path) = state.last_opened_path.clone() else {
        return Ok(NoteSession {
            markdown: String::new(),
            path: None,
        });
    };

    let note_path = PathBuf::from(last_opened_path);
    if !is_valid_note_path(&note_path, &notes_dir) {
        state.last_opened_path = None;
        state.recent_paths.retain(|path| PathBuf::from(path) != note_path);
        write_state(&notes_dir, &state)?;
        return Ok(NoteSession {
            markdown: String::new(),
            path: None,
        });
    }

    touch_recent_path(&mut state, &note_path);
    write_state(&notes_dir, &state)?;
    read_note_session_from_path(&note_path)
}

#[tauri::command]
fn open_note(path: String) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let note_path = validate_current_path(Some(path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;

    let mut state = read_state(&notes_dir)?;
    state.last_opened_path = Some(note_path.to_string_lossy().into_owned());
    touch_recent_path(&mut state, &note_path);
    write_state(&notes_dir, &state)?;

    read_note_session_from_path(&note_path)
}

#[tauri::command]
fn save_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<NoteSession, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let saved_path = persist_note(&notes_dir, &markdown, current_path.as_deref())?;

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = saved_path.clone();
    if let Some(saved_path) = saved_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(saved_path));
    }
    write_state(&notes_dir, &persisted_state)?;
    refresh_notes_index(&state, &notes_dir)?;

    Ok(NoteSession {
        markdown,
        path: saved_path,
    })
}

#[tauri::command]
fn remember_note(
    state: State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let remembered_path = if !markdown.trim().is_empty() || current_path.is_some() {
        persist_note(&notes_dir, &markdown, current_path.as_deref())?
    } else {
        None
    };

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = None;
    if let Some(remembered_path) = remembered_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(remembered_path));
    }
    write_state(&notes_dir, &persisted_state)?;
    refresh_notes_index(&state, &notes_dir)
}

#[tauri::command]
fn forget_note(state: State<'_, AppState>, current_path: Option<String>) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;

    if let Some(note_path) = current_path.as_ref() {
        if note_path.exists() {
            fs::remove_file(note_path).map_err(|err| err.to_string())?;
        }

        let raw_path = note_path.to_string_lossy().into_owned();
        if persisted_state.last_opened_path.as_deref() == Some(raw_path.as_str()) {
            persisted_state.last_opened_path = None;
        }
        persisted_state.recent_paths.retain(|path| path != &raw_path);
    }

    write_state(&notes_dir, &persisted_state)?;
    refresh_notes_index(&state, &notes_dir)
}

#[tauri::command]
fn list_recent_notes(
    state: State<'_, AppState>,
    limit: usize,
    current_path: Option<String>,
    current_markdown: String,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let current_override = build_current_override(current_path.as_deref(), &current_markdown);
    let mut persisted_state = read_state(&notes_dir)?;
    prune_recent_paths(&mut persisted_state, &notes_dir);
    write_state(&notes_dir, &persisted_state)?;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(&notes_dir)?;

    let recent_results = persisted_state
        .recent_paths
        .iter()
        .filter_map(|raw_path| {
            let path = PathBuf::from(raw_path);
            let note = if current_path.as_deref() == Some(path.as_path()) {
                current_override.as_ref().or_else(|| index.entries.get(&path))
            } else {
                index.entries.get(&path)
            }?;

            Some(build_recent_result(Some(path.as_path()), note))
        })
        .take(limit.min(3))
        .collect();

    Ok(recent_results)
}

#[tauri::command]
fn list_tasks(state: State<'_, AppState>, filter: TaskFilter) -> Result<Vec<TaskListItem>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let persisted_state = read_state(&notes_dir)?;
    let hidden_task_keys = persisted_state.hidden_task_keys.into_iter().collect::<HashSet<_>>();
    let hidden_note_paths = persisted_state.hidden_note_paths.into_iter().collect::<HashSet<_>>();
    let collapsed_note_paths = persisted_state
        .collapsed_note_paths
        .into_iter()
        .collect::<HashSet<_>>();
    let note_order = persisted_state.note_order;

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(&notes_dir)?;

    let mut tasks = Vec::new();

    for (path, note) in &index.entries {
        for task in &note.tasks {
            let matches_filter = match filter {
                TaskFilter::Open => !task.completed,
                TaskFilter::Completed => task.completed,
                TaskFilter::All => true,
            };

            if !matches_filter {
                continue;
            }

            tasks.push(TaskListItem {
                task_key: task_key(path, task),
                note_path: path.to_string_lossy().into_owned(),
                file_name: note.file_name.clone(),
                note_title: note.title.clone(),
                section_label: task.section_label.clone(),
                text: task.text.clone(),
                completed: task.completed,
                hidden: hidden_task_keys.contains(&task_key(path, task)),
                note_hidden: hidden_note_paths.contains(&path.to_string_lossy().into_owned()),
                note_collapsed: collapsed_note_paths.contains(&path.to_string_lossy().into_owned()),
                depth: task.depth,
                line_number: task.line_number,
            });
        }
    }

    let note_order_index = note_order
        .iter()
        .enumerate()
        .map(|(index, path)| (path.as_str(), index))
        .collect::<HashMap<_, _>>();

    tasks.sort_by(|left, right| {
        let left_note_rank = note_order_index.get(left.note_path.as_str()).copied();
        let right_note_rank = note_order_index.get(right.note_path.as_str()).copied();

        match (left_note_rank, right_note_rank) {
            (Some(left_rank), Some(right_rank)) => left_rank.cmp(&right_rank),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
            .then_with(|| left.note_title.to_lowercase().cmp(&right.note_title.to_lowercase()))
            .then_with(|| left.line_number.cmp(&right.line_number))
            .then_with(|| left.text.to_lowercase().cmp(&right.text.to_lowercase()))
    });

    Ok(tasks)
}

#[tauri::command]
fn set_task_hidden(task_key: String, hidden: bool) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let mut state = read_state(&notes_dir)?;
    if hidden {
        push_unique(&mut state.hidden_task_keys, task_key);
    } else {
        state.hidden_task_keys.retain(|existing_key| existing_key != &task_key);
    }
    write_state(&notes_dir, &state)
}

#[tauri::command]
fn set_note_hidden(note_path: String, hidden: bool) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let validated_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let raw_path = validated_path.to_string_lossy().into_owned();

    let mut state = read_state(&notes_dir)?;
    if hidden {
        push_unique(&mut state.hidden_note_paths, raw_path);
    } else {
        state.hidden_note_paths.retain(|existing_path| existing_path != &raw_path);
    }
    write_state(&notes_dir, &state)
}

#[tauri::command]
fn set_note_collapsed(note_path: String, collapsed: bool) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let validated_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let raw_path = validated_path.to_string_lossy().into_owned();

    let mut state = read_state(&notes_dir)?;
    if collapsed {
        push_unique(&mut state.collapsed_note_paths, raw_path);
    } else {
        state
            .collapsed_note_paths
            .retain(|existing_path| existing_path != &raw_path);
    }
    write_state(&notes_dir, &state)
}

#[tauri::command]
fn set_note_order(note_paths: Vec<String>) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let mut normalized_paths = Vec::new();
    let mut seen = HashSet::new();

    for note_path in note_paths {
        let Some(validated_path) = validate_current_path(Some(note_path), &notes_dir)? else {
            continue;
        };

        if !is_valid_note_path(&validated_path, &notes_dir) {
            continue;
        }

        let raw_path = validated_path.to_string_lossy().into_owned();
        if seen.insert(raw_path.clone()) {
            normalized_paths.push(raw_path);
        }
    }

    let mut state = read_state(&notes_dir)?;
    state.note_order = normalized_paths;
    write_state(&notes_dir, &state)
}

#[tauri::command]
fn toggle_task(
    state: State<'_, AppState>,
    note_path: String,
    line_number: usize,
    task_text: String,
) -> Result<(), String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let note_path = validate_current_path(Some(note_path), &notes_dir)?
        .ok_or_else(|| "Missing note path".to_string())?;
    let markdown = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let updated_markdown = toggle_task_in_markdown(&markdown, line_number, &task_text)?;
    fs::write(&note_path, updated_markdown).map_err(|err| err.to_string())?;
    refresh_notes_index(&state, &notes_dir)
}

#[tauri::command]
fn search_notes(
    state: State<'_, AppState>,
    query: String,
    mode: SearchMode,
    current_path: Option<String>,
    current_markdown: String,
) -> Result<Vec<NoteSearchResult>, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

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
    let current_override = build_current_override(current_path.as_deref(), &current_markdown);

    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(&notes_dir)?;

    let mut candidates = Vec::new();

    match mode {
        SearchMode::Current => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path.as_deref(),
                    current_note,
                    &normalized_query,
                    &query_terms,
                ));
            }
        }
        SearchMode::All => {
            if let Some(current_note) = current_override.as_ref() {
                candidates.extend(search_note(
                    current_path.as_deref(),
                    current_note,
                    &normalized_query,
                    &query_terms,
                ));
            }

            for (path, note) in &index.entries {
                if current_path.as_deref() == Some(path.as_path()) {
                    continue;
                }

                candidates.extend(search_note(
                    Some(path.as_path()),
                    note,
                    &normalized_query,
                    &query_terms,
                ));
            }
        }
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.result.file_name.cmp(&right.result.file_name))
            .then_with(|| left.result.section_label.cmp(&right.result.section_label))
            .then_with(|| left.result.note_path.cmp(&right.result.note_path))
    });
    candidates.truncate(MAX_SEARCH_RESULTS);

    Ok(candidates.into_iter().map(|candidate| candidate.result).collect())
}

fn notes_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Unable to determine the home directory".to_string())?;
    Ok(home.join("Documents").join(NOTES_DIRECTORY_NAME))
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn state_path(notes_dir: &Path) -> PathBuf {
    notes_dir.join(STATE_FILE_NAME)
}

fn read_state(notes_dir: &Path) -> Result<PersistedState, String> {
    let path = state_path(notes_dir);
    if !path.is_file() {
        return Ok(PersistedState::default());
    }

    let contents = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut state: PersistedState = serde_json::from_str(&contents).map_err(|err| err.to_string())?;
    prune_recent_paths(&mut state, notes_dir);
    dedupe_hidden_task_keys(&mut state);
    prune_hidden_note_paths(&mut state, notes_dir);
    prune_note_order(&mut state, notes_dir);
    prune_collapsed_note_paths(&mut state, notes_dir);
    Ok(state)
}

fn write_state(notes_dir: &Path, state: &PersistedState) -> Result<(), String> {
    let mut state = PersistedState {
        last_opened_path: state.last_opened_path.clone(),
        recent_paths: state.recent_paths.clone(),
        hidden_task_keys: state.hidden_task_keys.clone(),
        hidden_note_paths: state.hidden_note_paths.clone(),
        note_order: state.note_order.clone(),
        collapsed_note_paths: state.collapsed_note_paths.clone(),
    };
    prune_recent_paths(&mut state, notes_dir);
    dedupe_hidden_task_keys(&mut state);
    prune_hidden_note_paths(&mut state, notes_dir);
    prune_note_order(&mut state, notes_dir);
    prune_collapsed_note_paths(&mut state, notes_dir);
    let serialized = serde_json::to_string_pretty(&state).map_err(|err| err.to_string())?;
    fs::write(state_path(notes_dir), serialized).map_err(|err| err.to_string())
}

fn prune_recent_paths(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.recent_paths.retain(|raw_path| {
        let path = PathBuf::from(raw_path);
        is_valid_note_path(&path, notes_dir) && seen.insert(raw_path.clone())
    });
    state.recent_paths.truncate(MAX_RECENT_NOTES);

    if state
        .last_opened_path
        .as_ref()
        .is_some_and(|raw_path| !is_valid_note_path(Path::new(raw_path), notes_dir))
    {
        state.last_opened_path = None;
    }
}

fn dedupe_hidden_task_keys(state: &mut PersistedState) {
    let mut seen = HashSet::new();
    state.hidden_task_keys
        .retain(|task_key| !task_key.is_empty() && seen.insert(task_key.clone()));
}

fn prune_hidden_note_paths(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.hidden_note_paths.retain(|raw_path| {
        let path = PathBuf::from(raw_path);
        is_valid_note_path(&path, notes_dir) && seen.insert(raw_path.clone())
    });
}

fn prune_note_order(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.note_order.retain(|raw_path| {
        let path = PathBuf::from(raw_path);
        is_valid_note_path(&path, notes_dir) && seen.insert(raw_path.clone())
    });
}

fn prune_collapsed_note_paths(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.collapsed_note_paths.retain(|raw_path| {
        let path = PathBuf::from(raw_path);
        is_valid_note_path(&path, notes_dir) && seen.insert(raw_path.clone())
    });
}

fn touch_recent_path(state: &mut PersistedState, path: &Path) {
    let raw_path = path.to_string_lossy().into_owned();
    state.recent_paths.retain(|existing_path| existing_path != &raw_path);
    state.recent_paths.insert(0, raw_path);
    state.recent_paths.truncate(MAX_RECENT_NOTES);
}

fn push_unique(items: &mut Vec<String>, value: String) {
    if items.iter().any(|existing_value| existing_value == &value) {
        return;
    }

    items.push(value);
}

fn read_note_session_from_path(note_path: &Path) -> Result<NoteSession, String> {
    let markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
    Ok(NoteSession {
        markdown,
        path: Some(note_path.to_string_lossy().into_owned()),
    })
}

fn validate_current_path(
    current_path: Option<String>,
    notes_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(current_path) = current_path else {
        return Ok(None);
    };

    let path = PathBuf::from(current_path);
    if !is_path_in_notes_dir(&path, notes_dir) {
        return Err("Current note path is outside the notes directory".to_string());
    }

    Ok(Some(path))
}

fn is_path_in_notes_dir(path: &Path, notes_dir: &Path) -> bool {
    path.starts_with(notes_dir)
}

fn is_valid_note_path(path: &Path, notes_dir: &Path) -> bool {
    is_path_in_notes_dir(path, notes_dir) && is_note_file(path)
}

fn persist_note(
    notes_dir: &Path,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<String>, String> {
    let target_path = resolve_target_path(notes_dir, markdown, current_path)?;
    let Some(target_path) = target_path else {
        return Ok(None);
    };

    if let Some(existing_path) = current_path {
        if existing_path != target_path && existing_path.exists() {
            fs::rename(existing_path, &target_path).map_err(|err| err.to_string())?;
        }
    }

    fs::write(&target_path, markdown).map_err(|err| err.to_string())?;
    Ok(Some(target_path.to_string_lossy().into_owned()))
}

fn resolve_target_path(
    notes_dir: &Path,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    if markdown.trim().is_empty() {
        return Ok(current_path.map(Path::to_path_buf));
    }

    let file_stem = derive_file_stem(markdown);
    let preferred_path = notes_dir.join(format!("{file_stem}.md"));

    if current_path.is_some_and(|path| path == preferred_path) || !preferred_path.exists() {
        return Ok(Some(preferred_path));
    }

    if let Some(existing_path) = current_path {
        if existing_path.exists() && existing_path.file_name() == preferred_path.file_name() {
            return Ok(Some(existing_path.to_path_buf()));
        }
    }

    for suffix in 2.. {
        let candidate = notes_dir.join(format!("{file_stem} {suffix}.md"));
        if current_path.is_some_and(|path| path == candidate) || !candidate.exists() {
            return Ok(Some(candidate));
        }
    }

    Err("Unable to determine a target path for the note".to_string())
}

fn derive_file_stem(markdown: &str) -> String {
    let first_line = markdown
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or(DEFAULT_NOTE_NAME);

    let heading_trimmed = first_line
        .trim_start_matches('#')
        .trim()
        .trim_matches('`')
        .trim_matches('*')
        .trim_matches('_');

    let mut cleaned = OsString::new();
    let mut last_was_space = false;

    for ch in heading_trimmed.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            _ => ch,
        };

        if mapped.is_control() {
            continue;
        }

        if mapped.is_whitespace() {
            if last_was_space {
                continue;
            }
            cleaned.push(" ");
            last_was_space = true;
            continue;
        }

        cleaned.push(mapped.to_string());
        last_was_space = false;
    }

    let cleaned = cleaned.to_string_lossy().trim().to_string();
    if cleaned.is_empty() {
        return DEFAULT_NOTE_NAME.to_string();
    }

    cleaned.chars().take(MAX_FILE_STEM_LENGTH).collect()
}

fn refresh_notes_index(state: &AppState, notes_dir: &Path) -> Result<(), String> {
    let mut index = state
        .notes_index
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    index.refresh(notes_dir)
}

impl NotesIndex {
    fn refresh(&mut self, notes_dir: &Path) -> Result<(), String> {
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

fn is_note_file(path: &Path) -> bool {
    path.is_file() && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn read_file_signature(path: &Path) -> Result<FileSignature, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();

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

fn build_current_override(current_path: Option<&Path>, markdown: &str) -> Option<IndexedNote> {
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

fn build_indexed_note_with_signature(
    path: Option<&Path>,
    markdown: &str,
    signature: FileSignature,
) -> IndexedNote {
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
        if remaining_lines.first().is_some_and(|line| line.trim().is_empty()) {
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
    let rest = trimmed.strip_prefix("* ").or_else(|| trimmed.strip_prefix("- "))?;
    let (completed, text) = if let Some(text) = rest.strip_prefix("[ ]") {
        (false, text)
    } else if let Some(text) = rest.strip_prefix("[x]").or_else(|| rest.strip_prefix("[X]")) {
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
    while indent_levels.last().is_some_and(|level| *level > indentation_width) {
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

fn task_key(note_path: &Path, task: &IndexedTask) -> String {
    format!(
        "{}::{}::{}::{}",
        note_path.to_string_lossy(),
        task.line_number,
        task.section_label.as_deref().unwrap_or_default(),
        task.text.to_lowercase()
    )
}

fn toggle_task_in_markdown(markdown: &str, line_number: usize, task_text: &str) -> Result<String, String> {
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
    } else if let Some(rest) = rest.strip_prefix("[x]").or_else(|| rest.strip_prefix("[X]")) {
        format!("[ ]{rest}")
    } else {
        return None;
    };

    *line = format!("{indentation}{bullet}{toggled_rest}");
    Some(())
}

fn normalize_search_text(value: &str) -> String {
    collapse_whitespace(value).to_lowercase()
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn search_note(
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

fn score_search_candidate(
    candidate: SearchCandidate<'_>,
    normalized_query: &str,
    query_terms: &[&str],
) -> Option<ScoredSearchResult> {
    let haystack = format!(
        "{}\n{}\n{}",
        candidate.note.file_name_lower, candidate.note.title_lower, candidate.paragraph.text_lower
    );

    if query_terms.iter().any(|term| !haystack.contains(term)) {
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

    let search_match = find_best_match(candidate.paragraph, normalized_query, query_terms)?;
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
            note_path: candidate
                .note_path
                .map(|path| path.to_string_lossy().into_owned()),
            file_name: candidate.note.file_name.clone(),
            section_label: candidate.paragraph.section_label.clone(),
            excerpt,
            highlight_ranges,
            match_text: search_match.match_text,
        },
    })
}

fn find_best_match(
    paragraph: &IndexedParagraph,
    normalized_query: &str,
    query_terms: &[&str],
) -> Option<SearchMatch> {
    if let Some(match_offset) = paragraph.text_lower.find(normalized_query) {
        return Some(SearchMatch {
            match_text: normalized_query.to_string(),
            match_offset,
        });
    }

    query_terms
        .iter()
        .filter_map(|term| paragraph.text_lower.find(term).map(|match_offset| (*term, match_offset)))
        .min_by_key(|(_, match_offset)| *match_offset)
        .map(|(term, match_offset)| SearchMatch {
            match_text: term.to_string(),
            match_offset,
        })
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

fn build_recent_result(note_path: Option<&Path>, note: &IndexedNote) -> NoteSearchResult {
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
        note_path: note_path.map(|path| path.to_string_lossy().into_owned()),
        file_name: note.file_name.clone(),
        section_label,
        excerpt,
        highlight_ranges: Vec::new(),
        match_text: String::new(),
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_note_session,
            open_note,
            save_note,
            remember_note,
            forget_note,
            list_recent_notes,
            list_tasks,
            set_note_collapsed,
            set_note_hidden,
            set_note_order,
            set_task_hidden,
            toggle_task,
            search_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
