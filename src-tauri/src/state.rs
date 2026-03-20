use crate::{index::is_note_file, note};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const NOTES_DIRECTORY_NAME: &str = "Gneauxghts";
const STATE_FILE_NAME: &str = ".gneauxghts-state.json";
const VAULT_CONFIG_FILE_NAME: &str = "vault-config.json";
const FORGOTTEN_DIRECTORY_NAME: &str = ".forgotten";
const DEFAULT_NOTE_NAME: &str = "Untitled Note";
const MAX_FILE_STEM_LENGTH: usize = 80;
const MAX_RECENT_NOTES: usize = 20;

static APP_DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultConfig {
    pub(crate) notes_root: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultInfo {
    pub(crate) current_path: String,
    pub(crate) default_path: String,
    pub(crate) forgotten_path: String,
    pub(crate) is_default: bool,
    pub(crate) note_count: usize,
    pub(crate) requires_restart: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedTaskTimestamps {
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedForgottenNote {
    pub(crate) forgotten_path: String,
    pub(crate) original_path: String,
    pub(crate) title: String,
    pub(crate) forgotten_at_millis: u64,
    pub(crate) purge_after_days: u32,
    pub(crate) purge_at_millis: u64,
}

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
    #[serde(default)]
    pub(crate) task_timestamps: HashMap<String, PersistedTaskTimestamps>,
    #[serde(default)]
    pub(crate) forgotten_notes: Vec<PersistedForgottenNote>,
}

pub(crate) fn notes_root() -> Result<PathBuf, String> {
    let config = read_vault_config()?;
    if let Some(notes_root) = config
        .notes_root
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return Ok(notes_root);
    }

    default_notes_root()
}

pub(crate) fn initialize_app_data_dir(app_data_dir: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
    let mut stored = APP_DATA_DIR
        .lock()
        .map_err(|_| "App data directory lock poisoned".to_string())?;
    *stored = Some(app_data_dir);
    Ok(())
}

pub(crate) fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = configured_app_data_dir()? {
        return Ok(path);
    }

    let home = home_dir().ok_or_else(|| "Unable to determine the home directory".to_string())?;
    let fallback = home
        .join(".local")
        .join("share")
        .join("Gneauxghts");
    fs::create_dir_all(&fallback).map_err(|err| err.to_string())?;
    Ok(fallback)
}

pub(crate) fn default_notes_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Unable to determine the home directory".to_string())?;
    Ok(home.join("Documents").join(NOTES_DIRECTORY_NAME))
}

pub(crate) fn read_vault_config() -> Result<VaultConfig, String> {
    let path = vault_config_path()?;
    if !path.is_file() {
        return Ok(VaultConfig::default());
    }

    let contents = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&contents).map_err(|err| err.to_string())
}

pub(crate) fn write_vault_config(config: &VaultConfig) -> Result<(), String> {
    let path = vault_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let serialized = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, serialized).map_err(|err| err.to_string())
}

pub(crate) fn set_notes_root(path: Option<&Path>) -> Result<VaultInfo, String> {
    let notes_root = match path {
        Some(path) => {
            fs::create_dir_all(path).map_err(|err| err.to_string())?;
            Some(path.to_string_lossy().into_owned())
        }
        None => None,
    };

    write_vault_config(&VaultConfig { notes_root })?;
    current_vault_info()
}

pub(crate) fn current_vault_info() -> Result<VaultInfo, String> {
    let current_path = notes_root()?;
    fs::create_dir_all(&current_path).map_err(|err| err.to_string())?;
    let default_path = default_notes_root()?;
    let forgotten_path = forgotten_notes_root(&current_path);
    let note_count = fs::read_dir(&current_path)
        .map_err(|err| err.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_note_file(path))
        .count();

    Ok(VaultInfo {
        current_path: current_path.to_string_lossy().into_owned(),
        default_path: default_path.to_string_lossy().into_owned(),
        forgotten_path: forgotten_path.to_string_lossy().into_owned(),
        is_default: current_path == default_path,
        note_count,
        requires_restart: true,
    })
}

pub(crate) fn forgotten_notes_root(notes_dir: &Path) -> PathBuf {
    notes_dir.join(FORGOTTEN_DIRECTORY_NAME)
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
    prune_forgotten_notes(&mut state, notes_dir);
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
        task_timestamps: state.task_timestamps.clone(),
        forgotten_notes: state.forgotten_notes.clone(),
    };
    prune_recent_paths(&mut state, notes_dir);
    dedupe_hidden_task_keys(&mut state);
    prune_hidden_note_paths(&mut state, notes_dir);
    prune_note_order(&mut state, notes_dir);
    prune_collapsed_note_paths(&mut state, notes_dir);
    prune_forgotten_notes(&mut state, notes_dir);
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
    if is_forgotten_note_path(&path, notes_dir) {
        return Err("Current note path is inside the forgotten notes directory".to_string());
    }

    Ok(Some(path))
}

pub(crate) fn is_valid_note_path(path: &Path, notes_dir: &Path) -> bool {
    is_path_in_notes_dir(path, notes_dir)
        && !is_forgotten_note_path(path, notes_dir)
        && is_note_file(path)
}

pub(crate) fn is_forgotten_note_path(path: &Path, notes_dir: &Path) -> bool {
    path.starts_with(forgotten_notes_root(notes_dir))
}

pub(crate) fn persist_note(
    notes_dir: &Path,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<String>, String> {
    if note::strip_frontmatter(markdown).trim().is_empty() {
        let target_path = resolve_target_path(notes_dir, markdown, current_path)?;
        let Some(target_path) = target_path else {
            return Ok(None);
        };

        if let Some(existing_path) = current_path {
            if existing_path != target_path && existing_path.exists() {
                fs::rename(existing_path, &target_path).map_err(|err| err.to_string())?;
            }
        }

        fs::write(&target_path, "").map_err(|err| err.to_string())?;
        return Ok(Some(target_path.to_string_lossy().into_owned()));
    }

    let existing_markdown = current_path
        .filter(|path| path.exists())
        .map(fs::read_to_string)
        .transpose()
        .map_err(|err| err.to_string())?;
    let prepared_markdown =
        note::prepare_note_markdown(markdown, existing_markdown.as_deref(), Some(None))?.0;
    let target_path = resolve_target_path(notes_dir, &prepared_markdown, current_path)?;
    let Some(target_path) = target_path else {
        return Ok(None);
    };

    if let Some(existing_path) = current_path {
        if existing_path != target_path && existing_path.exists() {
            fs::rename(existing_path, &target_path).map_err(|err| err.to_string())?;
        }
    }

    fs::write(&target_path, prepared_markdown).map_err(|err| err.to_string())?;
    Ok(Some(target_path.to_string_lossy().into_owned()))
}

pub(crate) fn derive_file_stem(markdown: &str) -> String {
    note::derive_file_stem(markdown, DEFAULT_NOTE_NAME, MAX_FILE_STEM_LENGTH)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn state_path(notes_dir: &Path) -> PathBuf {
    match configured_app_data_dir() {
        Ok(Some(path)) => path.join(STATE_FILE_NAME),
        _ => notes_dir.join(STATE_FILE_NAME),
    }
}

fn vault_config_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join(VAULT_CONFIG_FILE_NAME))
}

fn configured_app_data_dir() -> Result<Option<PathBuf>, String> {
    APP_DATA_DIR
        .lock()
        .map_err(|_| "App data directory lock poisoned".to_string())
        .map(|value| value.clone())
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

fn prune_forgotten_notes(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.forgotten_notes.retain(|forgotten_note| {
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        let original_path = PathBuf::from(&forgotten_note.original_path);
        !forgotten_note.title.trim().is_empty()
            && forgotten_note.purge_after_days > 0
            && forgotten_note.purge_at_millis >= forgotten_note.forgotten_at_millis
            && forgotten_path.is_file()
            && is_forgotten_note_path(&forgotten_path, notes_dir)
            && is_path_in_notes_dir(&original_path, notes_dir)
            && !is_forgotten_note_path(&original_path, notes_dir)
            && seen.insert(forgotten_note.forgotten_path.clone())
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

#[cfg(test)]
mod tests {
    use super::{
        derive_file_stem, forgotten_notes_root, initialize_app_data_dir, persist_note, read_state,
        write_state, PersistedForgottenNote, PersistedState, PersistedTaskTimestamps,
    };
    use crate::test_support::TestDir;
    use std::{collections::HashMap, fs};

    #[test]
    fn derive_file_stem_sanitizes_invalid_characters_and_truncates() {
        let app_data_dir = TestDir::new("state-app-data-derive");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let markdown =
            "#   Launch: /Alpha? *Plan* for <Agents> with a very long trailing title that should be trimmed nicely\n";
        let stem = derive_file_stem(markdown);

        assert!(!stem.contains('/'));
        assert!(!stem.contains('?'));
        assert!(!stem.contains('*'));
        assert!(!stem.contains('<'));
        assert!(stem.len() <= 80);
        assert!(stem.starts_with("Launch Alpha Plan for Agents"));
    }

    #[test]
    fn persist_note_renames_existing_file_when_title_changes() {
        let app_data_dir = TestDir::new("state-app-data-persist");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-persist-note");
        let notes_dir = temp.path();
        let original_path = notes_dir.join("First Note.md");
        fs::write(&original_path, "# First Note\n\nOld content").expect("write original note");

        let saved_path = persist_note(
            notes_dir,
            "# Second Note\n\nFresh content",
            Some(original_path.as_path()),
        )
        .expect("persist note")
        .expect("saved path");

        let renamed_path = notes_dir.join("Second Note.md");
        assert_eq!(saved_path, renamed_path.to_string_lossy());
        assert!(!original_path.exists());
        let saved_markdown = fs::read_to_string(&renamed_path).expect("read renamed note");
        assert!(saved_markdown.contains("gneauxghts:"));
        assert!(saved_markdown.ends_with("# Second Note\n\nFresh content"));
    }

    #[test]
    fn read_state_prunes_invalid_paths_and_dedupes_entries() {
        let app_data_dir = TestDir::new("state-app-data-prune");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-pruning");
        let notes_dir = temp.path();
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let stale_note = notes_dir.join("Missing Note.md");
        let forgotten_dir = forgotten_notes_root(notes_dir);
        fs::create_dir_all(&forgotten_dir).expect("create forgotten dir");
        let live_forgotten_note = forgotten_dir.join("Live Note.md");
        fs::write(&live_forgotten_note, "# Live Note\n\nBody").expect("write forgotten note");
        let stale_forgotten_note = forgotten_dir.join("Missing Note.md");

        let mut task_timestamps = HashMap::new();
        task_timestamps.insert(
            "task-1".to_string(),
            PersistedTaskTimestamps {
                created_at_millis: 1,
                updated_at_millis: 2,
            },
        );

        write_state(
            notes_dir,
            &PersistedState {
                last_opened_path: Some(stale_note.to_string_lossy().into_owned()),
                recent_paths: vec![
                    stale_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                ],
                hidden_task_keys: vec![String::new(), "task-1".to_string(), "task-1".to_string()],
                hidden_note_paths: vec![
                    stale_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                ],
                note_order: vec![
                    stale_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                ],
                collapsed_note_paths: vec![
                    stale_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                    live_note.to_string_lossy().into_owned(),
                ],
                task_timestamps,
                forgotten_notes: vec![
                    PersistedForgottenNote {
                        forgotten_path: stale_forgotten_note.to_string_lossy().into_owned(),
                        original_path: live_note.to_string_lossy().into_owned(),
                        title: "Missing forgotten".to_string(),
                        forgotten_at_millis: 10,
                        purge_after_days: 7,
                        purge_at_millis: 20,
                    },
                    PersistedForgottenNote {
                        forgotten_path: live_forgotten_note.to_string_lossy().into_owned(),
                        original_path: live_note.to_string_lossy().into_owned(),
                        title: "Live forgotten".to_string(),
                        forgotten_at_millis: 30,
                        purge_after_days: 7,
                        purge_at_millis: 40,
                    },
                    PersistedForgottenNote {
                        forgotten_path: live_forgotten_note.to_string_lossy().into_owned(),
                        original_path: live_note.to_string_lossy().into_owned(),
                        title: "Duplicate forgotten".to_string(),
                        forgotten_at_millis: 50,
                        purge_after_days: 7,
                        purge_at_millis: 60,
                    },
                ],
            },
        )
        .expect("write state");

        let state = read_state(notes_dir).expect("read state");
        let live_raw_path = live_note.to_string_lossy().into_owned();

        assert_eq!(state.last_opened_path, None);
        assert_eq!(state.recent_paths, vec![live_raw_path.clone()]);
        assert_eq!(state.hidden_task_keys, vec!["task-1".to_string()]);
        assert_eq!(state.hidden_note_paths, vec![live_raw_path.clone()]);
        assert_eq!(state.note_order, vec![live_raw_path.clone()]);
        assert_eq!(state.collapsed_note_paths, vec![live_raw_path]);
        assert_eq!(state.task_timestamps.len(), 1);
        assert_eq!(state.forgotten_notes.len(), 1);
        assert_eq!(
            state.forgotten_notes[0].forgotten_path,
            live_forgotten_note.to_string_lossy()
        );
    }
}
