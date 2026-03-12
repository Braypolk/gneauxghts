use crate::index::is_note_file;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

const NOTES_DIRECTORY_NAME: &str = "Gneauxghts";
const STATE_FILE_NAME: &str = ".gneauxghts-state.json";
const DEFAULT_NOTE_NAME: &str = "Untitled Note";
const MAX_FILE_STEM_LENGTH: usize = 80;
const MAX_RECENT_NOTES: usize = 20;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedState {
    pub(crate) last_opened_path: Option<String>,
    #[serde(default)]
    pub(crate) recent_paths: Vec<String>,
    #[serde(default)]
    pub(crate) hidden_task_keys: Vec<String>,
    #[serde(default)]
    pub(crate) hidden_note_paths: Vec<String>,
    #[serde(default)]
    pub(crate) note_order: Vec<String>,
    #[serde(default)]
    pub(crate) collapsed_note_paths: Vec<String>,
}

pub(crate) fn notes_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Unable to determine the home directory".to_string())?;
    Ok(home.join("Documents").join(NOTES_DIRECTORY_NAME))
}

pub(crate) fn read_state(notes_dir: &Path) -> Result<PersistedState, String> {
    let path = state_path(notes_dir);
    if !path.is_file() {
        return Ok(PersistedState::default());
    }

    let contents = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut state: PersistedState =
        serde_json::from_str(&contents).map_err(|err| err.to_string())?;
    prune_recent_paths(&mut state, notes_dir);
    dedupe_hidden_task_keys(&mut state);
    prune_hidden_note_paths(&mut state, notes_dir);
    prune_note_order(&mut state, notes_dir);
    prune_collapsed_note_paths(&mut state, notes_dir);
    Ok(state)
}

pub(crate) fn write_state(notes_dir: &Path, state: &PersistedState) -> Result<(), String> {
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

pub(crate) fn prune_recent_paths(state: &mut PersistedState, notes_dir: &Path) {
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

pub(crate) fn touch_recent_path(state: &mut PersistedState, path: &Path) {
    let raw_path = path.to_string_lossy().into_owned();
    state
        .recent_paths
        .retain(|existing_path| existing_path != &raw_path);
    state.recent_paths.insert(0, raw_path);
    state.recent_paths.truncate(MAX_RECENT_NOTES);
}

pub(crate) fn push_unique(items: &mut Vec<String>, value: String) {
    if items.iter().any(|existing_value| existing_value == &value) {
        return;
    }

    items.push(value);
}

pub(crate) fn validate_current_path(
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

pub(crate) fn is_valid_note_path(path: &Path, notes_dir: &Path) -> bool {
    is_path_in_notes_dir(path, notes_dir) && is_note_file(path)
}

pub(crate) fn persist_note(
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

pub(crate) fn derive_file_stem(markdown: &str) -> String {
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

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn state_path(notes_dir: &Path) -> PathBuf {
    notes_dir.join(STATE_FILE_NAME)
}

fn dedupe_hidden_task_keys(state: &mut PersistedState) {
    let mut seen = HashSet::new();
    state
        .hidden_task_keys
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

fn is_path_in_notes_dir(path: &Path, notes_dir: &Path) -> bool {
    path.starts_with(notes_dir)
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
