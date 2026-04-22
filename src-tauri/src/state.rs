use crate::{
    index::is_note_file, note, path_utils::collect_markdown_files_recursively,
    sync::SYNC_DB_FILE_NAME,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
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
const APP_STATE_SINGLETON_ID: i64 = 1;

static APP_DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static DOCUMENTS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

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
    pub(crate) can_configure_path: bool,
    pub(crate) path_configuration_note: Option<String>,
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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedState {
    pub(crate) last_opened_note_id: Option<String>,
    #[serde(default)]
    pub(crate) recent_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) hidden_task_keys: Vec<String>,
    #[serde(default)]
    pub(crate) hidden_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) note_order_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) collapsed_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) task_timestamps: HashMap<String, PersistedTaskTimestamps>,
    #[serde(default)]
    pub(crate) forgotten_notes: Vec<PersistedForgottenNote>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPersistedState {
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
    #[serde(default)]
    task_timestamps: HashMap<String, PersistedTaskTimestamps>,
    #[serde(default)]
    forgotten_notes: Vec<PersistedForgottenNote>,
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

pub(crate) fn initialize_documents_dir(documents_dir: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&documents_dir).map_err(|err| err.to_string())?;
    let mut stored = DOCUMENTS_DIR
        .lock()
        .map_err(|_| "Documents directory lock poisoned".to_string())?;
    *stored = Some(documents_dir);
    Ok(())
}

pub(crate) fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = configured_app_data_dir()? {
        return Ok(path);
    }

    let home = home_dir().ok_or_else(|| "Unable to determine the home directory".to_string())?;
    let fallback = home.join(".local").join("share").join("Gneauxghts");
    fs::create_dir_all(&fallback).map_err(|err| err.to_string())?;
    Ok(fallback)
}

pub(crate) fn default_notes_root() -> Result<PathBuf, String> {
    if let Some(documents_dir) = configured_documents_dir()? {
        if cfg!(target_os = "ios") {
            return Ok(documents_dir);
        }

        return Ok(documents_dir.join(NOTES_DIRECTORY_NAME));
    }

    let home = home_dir().ok_or_else(|| "Unable to determine the home directory".to_string())?;
    Ok(home.join("Documents").join(NOTES_DIRECTORY_NAME))
}

pub(crate) fn migrate_legacy_ios_notes_dir() -> Result<(), String> {
    if !cfg!(target_os = "ios") {
        return Ok(());
    }

    let Some(documents_dir) = configured_documents_dir()? else {
        return Ok(());
    };
    let legacy_dir = documents_dir.join(NOTES_DIRECTORY_NAME);
    if !legacy_dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(&legacy_dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source = entry.path();
        let target = documents_dir.join(entry.file_name());
        if target.exists() {
            continue;
        }

        fs::rename(&source, &target).map_err(|err| err.to_string())?;
    }

    let is_empty = fs::read_dir(&legacy_dir)
        .map_err(|err| err.to_string())?
        .next()
        .is_none();
    if is_empty {
        fs::remove_dir(&legacy_dir).map_err(|err| err.to_string())?;
    }

    migrate_legacy_ios_state_paths(&documents_dir, &legacy_dir)?;

    Ok(())
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
    if !supports_custom_vault_paths() {
        let default_path = default_notes_root()?;
        if path.is_some_and(|candidate| candidate != default_path.as_path()) {
            return Err("Custom vault paths are not available on iPhone builds yet.".to_string());
        }

        write_vault_config(&VaultConfig { notes_root: None })?;
        return current_vault_info();
    }

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
    let note_count = collect_markdown_files_recursively(&current_path)?.len();

    Ok(VaultInfo {
        current_path: current_path.to_string_lossy().into_owned(),
        default_path: default_path.to_string_lossy().into_owned(),
        forgotten_path: forgotten_path.to_string_lossy().into_owned(),
        is_default: current_path == default_path,
        note_count,
        requires_restart: supports_custom_vault_paths(),
        can_configure_path: supports_custom_vault_paths(),
        path_configuration_note: vault_path_configuration_note(),
    })
}

pub(crate) fn forgotten_notes_root(notes_dir: &Path) -> PathBuf {
    notes_dir.join(FORGOTTEN_DIRECTORY_NAME)
}

pub(crate) fn read_state(notes_dir: &Path) -> Result<PersistedState, String> {
    let mut state = read_unpruned_state(notes_dir)?;
    prune_state_in_place(&mut state, notes_dir);
    Ok(state)
}

pub(crate) fn write_state(notes_dir: &Path, state: &PersistedState) -> Result<(), String> {
    let mut state = state.clone();
    prune_state_in_place(&mut state, notes_dir);
    let mut connection = open_state_database()?;
    write_state_to_database(&mut connection, &state)?;
    cleanup_legacy_state_files(notes_dir)?;
    Ok(())
}

fn prune_state_in_place(state: &mut PersistedState, notes_dir: &Path) {
    prune_recent_note_ids(state, notes_dir);
    dedupe_hidden_task_keys(state);
    prune_hidden_note_ids(state, notes_dir);
    prune_note_order_note_ids(state, notes_dir);
    prune_collapsed_note_ids(state, notes_dir);
    prune_forgotten_notes(state, notes_dir);
}

pub(crate) fn prune_recent_note_ids(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.recent_note_ids.retain(|note_id| {
        resolve_note_path_by_id(notes_dir, note_id)
            .map(|path| path.is_some() && seen.insert(note_id.clone()))
            .unwrap_or(false)
    });
    state.recent_note_ids.truncate(MAX_RECENT_NOTES);

    if state.last_opened_note_id.as_ref().is_some_and(|note_id| {
        resolve_note_path_by_id(notes_dir, note_id)
            .map(|path| path.is_none())
            .unwrap_or(true)
    }) {
        state.last_opened_note_id = None;
    }
}

pub(crate) fn touch_recent_note_id(state: &mut PersistedState, note_id: String) {
    state
        .recent_note_ids
        .retain(|existing_note_id| existing_note_id != &note_id);
    state.recent_note_ids.insert(0, note_id);
    state.recent_note_ids.truncate(MAX_RECENT_NOTES);
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

pub(crate) fn resolve_note_id_from_path(path: &Path) -> Result<String, String> {
    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    note::note_id_from_path_or_markdown(Some(path), &markdown)
        .ok_or_else(|| "Unable to determine note id".to_string())
}

pub(crate) fn resolve_note_path_by_id(
    notes_dir: &Path,
    note_id: &str,
) -> Result<Option<PathBuf>, String> {
    for path in collect_markdown_files_recursively(notes_dir)? {
        if !is_valid_note_path(&path, notes_dir) {
            continue;
        }
        let Ok(markdown) = fs::read_to_string(&path) else {
            continue;
        };
        if note::note_id_from_path_or_markdown(Some(&path), &markdown).as_deref() == Some(note_id) {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

pub(crate) fn is_forgotten_note_path(path: &Path, notes_dir: &Path) -> bool {
    path.starts_with(forgotten_notes_root(notes_dir))
}

pub(crate) fn persist_note(
    notes_dir: &Path,
    title: &str,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<String>, String> {
    let normalized_markdown = note::normalize_wikilink_markdown(markdown);

    if title.trim().is_empty() && normalized_markdown.trim().is_empty() {
        let target_path =
            resolve_target_path(notes_dir, title, &normalized_markdown, current_path)?;
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
    let prepared_markdown = note::prepare_note_markdown(
        &normalized_markdown,
        existing_markdown.as_deref(),
        Some(None),
    )?
    .0;
    let target_path = resolve_target_path(notes_dir, title, &prepared_markdown, current_path)?;
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

pub(crate) fn derive_file_stem_from_title_and_markdown(title: &str, markdown: &str) -> String {
    note::derive_file_stem_from_title_and_markdown(
        title,
        markdown,
        DEFAULT_NOTE_NAME,
        MAX_FILE_STEM_LENGTH,
    )
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn migrate_legacy_ios_state_paths(notes_dir: &Path, legacy_dir: &Path) -> Result<(), String> {
    let mut state =
        match read_unpruned_state_from_database()?.or(read_legacy_state_file(notes_dir)?) {
            Some(state) => state,
            None => return Ok(()),
        };
    let mut changed = false;

    for forgotten_note in &mut state.forgotten_notes {
        changed |=
            remap_string_path_prefix(&mut forgotten_note.forgotten_path, legacy_dir, notes_dir);
        changed |=
            remap_string_path_prefix(&mut forgotten_note.original_path, legacy_dir, notes_dir);
    }

    if !changed {
        return Ok(());
    }

    write_state(notes_dir, &state)
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

fn remap_string_path_prefix(raw_path: &mut String, from: &Path, to: &Path) -> bool {
    let candidate = Path::new(raw_path);
    let Ok(suffix) = candidate.strip_prefix(from) else {
        return false;
    };

    *raw_path = to.join(suffix).to_string_lossy().into_owned();
    true
}

fn open_state_database() -> Result<Connection, String> {
    let app_data_dir = app_data_dir()?;
    fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
    let connection =
        Connection::open(app_data_dir.join(SYNC_DB_FILE_NAME)).map_err(|err| err.to_string())?;
    ensure_state_schema(&connection)?;
    Ok(connection)
}

fn ensure_state_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_opened_path TEXT,
                last_opened_note_id TEXT
            );
            CREATE TABLE IF NOT EXISTS app_state_recent_paths (
                position INTEGER PRIMARY KEY,
                note_path TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS app_state_recent_note_ids (
                position INTEGER PRIMARY KEY,
                note_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS app_state_hidden_task_keys (
                task_key TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_hidden_note_paths (
                note_path TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_hidden_note_ids (
                note_id TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_note_order (
                position INTEGER PRIMARY KEY,
                note_path TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS app_state_note_order_note_ids (
                position INTEGER PRIMARY KEY,
                note_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS app_state_collapsed_note_paths (
                note_path TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_collapsed_note_ids (
                note_id TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_task_timestamps (
                task_key TEXT PRIMARY KEY,
                created_at_millis INTEGER NOT NULL,
                updated_at_millis INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_state_forgotten_notes (
                forgotten_path TEXT PRIMARY KEY,
                original_path TEXT NOT NULL,
                title TEXT NOT NULL,
                forgotten_at_millis INTEGER NOT NULL,
                purge_after_days INTEGER NOT NULL,
                purge_at_millis INTEGER NOT NULL
            );",
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn read_unpruned_state(notes_dir: &Path) -> Result<PersistedState, String> {
    if let Some(state) = read_unpruned_state_from_database()? {
        return Ok(state);
    }

    if let Some(state) = read_legacy_state_file(notes_dir)? {
        let mut connection = open_state_database()?;
        write_state_to_database(&mut connection, &state)?;
        cleanup_legacy_state_files(notes_dir)?;
        return Ok(state);
    }

    Ok(PersistedState::default())
}

fn read_unpruned_state_from_database() -> Result<Option<PersistedState>, String> {
    let connection = open_state_database()?;
    if !database_has_persisted_state(&connection)? {
        return Ok(None);
    }

    Ok(Some(read_state_from_database(&connection)?))
}

fn database_has_persisted_state(connection: &Connection) -> Result<bool, String> {
    let has_singleton = connection
        .query_row(
            "SELECT 1 FROM app_state WHERE id = ?1 LIMIT 1",
            params![APP_STATE_SINGLETON_ID],
            |_| Ok(true),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .unwrap_or(false);
    if has_singleton {
        return Ok(true);
    }

    for table in [
        "app_state_recent_note_ids",
        "app_state_recent_paths",
        "app_state_hidden_task_keys",
        "app_state_hidden_note_ids",
        "app_state_hidden_note_paths",
        "app_state_note_order_note_ids",
        "app_state_note_order",
        "app_state_collapsed_note_ids",
        "app_state_collapsed_note_paths",
        "app_state_task_timestamps",
        "app_state_forgotten_notes",
    ] {
        let query = format!("SELECT 1 FROM {table} LIMIT 1");
        let has_rows = connection
            .query_row(&query, [], |_| Ok(true))
            .optional()
            .map_err(|err| err.to_string())?
            .unwrap_or(false);
        if has_rows {
            return Ok(true);
        }
    }

    Ok(false)
}

fn read_state_from_database(connection: &Connection) -> Result<PersistedState, String> {
    let mut last_opened_note_id = connection
        .query_row(
            "SELECT last_opened_note_id FROM app_state WHERE id = ?1",
            params![APP_STATE_SINGLETON_ID],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .flatten();
    if last_opened_note_id.is_none() {
        let legacy_last_opened_path = connection
            .query_row(
                "SELECT last_opened_path FROM app_state WHERE id = ?1",
                params![APP_STATE_SINGLETON_ID],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .flatten();
        last_opened_note_id = legacy_last_opened_path
            .as_deref()
            .map(Path::new)
            .map(resolve_note_id_from_path)
            .transpose()?;
    }

    let recent_note_ids = read_note_ids_with_legacy_path_fallback(
        connection,
        "SELECT note_id FROM app_state_recent_note_ids ORDER BY position",
        "SELECT note_path FROM app_state_recent_paths ORDER BY position",
        read_ordered_string_column,
    )?;
    let hidden_task_keys = read_string_column(
        connection,
        "SELECT task_key FROM app_state_hidden_task_keys ORDER BY task_key",
    )?;
    let hidden_note_ids = read_note_ids_with_legacy_path_fallback(
        connection,
        "SELECT note_id FROM app_state_hidden_note_ids ORDER BY note_id",
        "SELECT note_path FROM app_state_hidden_note_paths ORDER BY note_path",
        read_string_column,
    )?;
    let note_order_note_ids = read_note_ids_with_legacy_path_fallback(
        connection,
        "SELECT note_id FROM app_state_note_order_note_ids ORDER BY position",
        "SELECT note_path FROM app_state_note_order ORDER BY position",
        read_ordered_string_column,
    )?;
    let collapsed_note_ids = read_note_ids_with_legacy_path_fallback(
        connection,
        "SELECT note_id FROM app_state_collapsed_note_ids ORDER BY note_id",
        "SELECT note_path FROM app_state_collapsed_note_paths ORDER BY note_path",
        read_string_column,
    )?;

    let mut task_timestamps = HashMap::new();
    let mut statement = connection
        .prepare(
            "SELECT task_key, created_at_millis, updated_at_millis
             FROM app_state_task_timestamps",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PersistedTaskTimestamps {
                    created_at_millis: read_u64_column(row, 1)?,
                    updated_at_millis: read_u64_column(row, 2)?,
                },
            ))
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        let (task_key, timestamps) = row.map_err(|err| err.to_string())?;
        task_timestamps.insert(task_key, timestamps);
    }

    let mut forgotten_notes = Vec::new();
    let mut statement = connection
        .prepare(
            "SELECT forgotten_path, original_path, title, forgotten_at_millis, purge_after_days, purge_at_millis
             FROM app_state_forgotten_notes",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(PersistedForgottenNote {
                forgotten_path: row.get(0)?,
                original_path: row.get(1)?,
                title: row.get(2)?,
                forgotten_at_millis: read_u64_column(row, 3)?,
                purge_after_days: read_u32_column(row, 4)?,
                purge_at_millis: read_u64_column(row, 5)?,
            })
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        forgotten_notes.push(row.map_err(|err| err.to_string())?);
    }

    Ok(PersistedState {
        last_opened_note_id,
        recent_note_ids,
        hidden_task_keys,
        hidden_note_ids,
        note_order_note_ids,
        collapsed_note_ids,
        task_timestamps,
        forgotten_notes,
    })
}

fn read_string_column(connection: &Connection, query: &str) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare(query).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn read_ordered_string_column(connection: &Connection, query: &str) -> Result<Vec<String>, String> {
    read_string_column(connection, query)
}

fn read_note_ids_with_legacy_path_fallback(
    connection: &Connection,
    note_id_query: &str,
    legacy_path_query: &str,
    reader: fn(&Connection, &str) -> Result<Vec<String>, String>,
) -> Result<Vec<String>, String> {
    let note_ids = reader(connection, note_id_query)?;
    if note_ids.is_empty() {
        return Ok(resolve_note_ids_from_paths(&reader(
            connection,
            legacy_path_query,
        )?));
    }

    Ok(note_ids)
}

fn resolve_note_ids_from_paths(paths: &[String]) -> Vec<String> {
    let mut note_ids = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        let note_id = Path::new(path)
            .is_file()
            .then(|| resolve_note_id_from_path(Path::new(path)))
            .transpose()
            .ok()
            .flatten();
        if let Some(note_id) = note_id {
            if seen.insert(note_id.clone()) {
                note_ids.push(note_id);
            }
        }
    }
    note_ids
}

fn write_state_to_database(
    connection: &mut Connection,
    state: &PersistedState,
) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|err| err.to_string())?;

    transaction
        .execute(
            "INSERT INTO app_state (id, last_opened_path, last_opened_note_id)
             VALUES (?1, NULL, ?2)
             ON CONFLICT(id) DO UPDATE
             SET last_opened_path = NULL,
                 last_opened_note_id = excluded.last_opened_note_id",
            params![APP_STATE_SINGLETON_ID, state.last_opened_note_id.as_deref()],
        )
        .map_err(|err| err.to_string())?;

    transaction
        .execute("DELETE FROM app_state_recent_note_ids", [])
        .map_err(|err| err.to_string())?;
    for (index, note_id) in state.recent_note_ids.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO app_state_recent_note_ids (position, note_id) VALUES (?1, ?2)",
                params![to_i64(index)?, note_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM app_state_recent_paths", [])
        .map_err(|err| err.to_string())?;

    transaction
        .execute("DELETE FROM app_state_hidden_task_keys", [])
        .map_err(|err| err.to_string())?;
    for task_key in &state.hidden_task_keys {
        transaction
            .execute(
                "INSERT INTO app_state_hidden_task_keys (task_key) VALUES (?1)",
                params![task_key],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute("DELETE FROM app_state_hidden_note_ids", [])
        .map_err(|err| err.to_string())?;
    for note_id in &state.hidden_note_ids {
        transaction
            .execute(
                "INSERT INTO app_state_hidden_note_ids (note_id) VALUES (?1)",
                params![note_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM app_state_hidden_note_paths", [])
        .map_err(|err| err.to_string())?;

    transaction
        .execute("DELETE FROM app_state_note_order_note_ids", [])
        .map_err(|err| err.to_string())?;
    for (index, note_id) in state.note_order_note_ids.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO app_state_note_order_note_ids (position, note_id) VALUES (?1, ?2)",
                params![to_i64(index)?, note_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM app_state_note_order", [])
        .map_err(|err| err.to_string())?;

    transaction
        .execute("DELETE FROM app_state_collapsed_note_ids", [])
        .map_err(|err| err.to_string())?;
    for note_id in &state.collapsed_note_ids {
        transaction
            .execute(
                "INSERT INTO app_state_collapsed_note_ids (note_id) VALUES (?1)",
                params![note_id],
            )
            .map_err(|err| err.to_string())?;
    }
    transaction
        .execute("DELETE FROM app_state_collapsed_note_paths", [])
        .map_err(|err| err.to_string())?;

    transaction
        .execute("DELETE FROM app_state_task_timestamps", [])
        .map_err(|err| err.to_string())?;
    for (task_key, timestamps) in &state.task_timestamps {
        transaction
            .execute(
                "INSERT INTO app_state_task_timestamps (
                    task_key,
                    created_at_millis,
                    updated_at_millis
                 ) VALUES (?1, ?2, ?3)",
                params![
                    task_key,
                    to_i64(timestamps.created_at_millis)?,
                    to_i64(timestamps.updated_at_millis)?
                ],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute("DELETE FROM app_state_forgotten_notes", [])
        .map_err(|err| err.to_string())?;
    for forgotten_note in &state.forgotten_notes {
        transaction
            .execute(
                "INSERT INTO app_state_forgotten_notes (
                    forgotten_path,
                    original_path,
                    title,
                    forgotten_at_millis,
                    purge_after_days,
                    purge_at_millis
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    forgotten_note.forgotten_path.as_str(),
                    forgotten_note.original_path.as_str(),
                    forgotten_note.title.as_str(),
                    to_i64(forgotten_note.forgotten_at_millis)?,
                    i64::from(forgotten_note.purge_after_days),
                    to_i64(forgotten_note.purge_at_millis)?
                ],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction.commit().map_err(|err| err.to_string())
}

fn read_legacy_state_file(notes_dir: &Path) -> Result<Option<PersistedState>, String> {
    for path in legacy_state_paths(notes_dir)? {
        if !path.is_file() {
            continue;
        }

        let contents = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        if let Ok(state) = serde_json::from_str::<PersistedState>(&contents) {
            return Ok(Some(state));
        }

        let legacy_state: LegacyPersistedState =
            serde_json::from_str(&contents).map_err(|err| err.to_string())?;
        return Ok(Some(PersistedState {
            last_opened_note_id: legacy_state
                .last_opened_path
                .as_deref()
                .map(Path::new)
                .map(resolve_note_id_from_path)
                .transpose()?,
            recent_note_ids: resolve_note_ids_from_paths(&legacy_state.recent_paths),
            hidden_task_keys: legacy_state.hidden_task_keys,
            hidden_note_ids: resolve_note_ids_from_paths(&legacy_state.hidden_note_paths),
            note_order_note_ids: resolve_note_ids_from_paths(&legacy_state.note_order),
            collapsed_note_ids: resolve_note_ids_from_paths(&legacy_state.collapsed_note_paths),
            task_timestamps: legacy_state.task_timestamps,
            forgotten_notes: legacy_state.forgotten_notes,
        }));
    }

    Ok(None)
}

fn cleanup_legacy_state_files(notes_dir: &Path) -> Result<(), String> {
    for path in legacy_state_paths(notes_dir)? {
        if path.is_file() {
            fs::remove_file(path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn legacy_state_paths(notes_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    if let Some(app_data_dir) = configured_app_data_dir()? {
        paths.push(app_data_dir.join(STATE_FILE_NAME));
    }
    let notes_path = notes_dir.join(STATE_FILE_NAME);
    if !paths.iter().any(|path| path == &notes_path) {
        paths.push(notes_path);
    }
    Ok(paths)
}

fn read_u64_column(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(index)?;
    u64::try_from(value).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(err),
        )
    })
}

fn read_u32_column(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u32> {
    let value = row.get::<_, i64>(index)?;
    u32::try_from(value).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(err),
        )
    })
}

fn to_i64<T>(value: T) -> Result<i64, String>
where
    T: TryInto<i64>,
    <T as TryInto<i64>>::Error: std::fmt::Display,
{
    value.try_into().map_err(|err| err.to_string())
}

fn supports_custom_vault_paths() -> bool {
    !cfg!(target_os = "ios")
}

fn vault_path_configuration_note() -> Option<String> {
    if supports_custom_vault_paths() {
        None
    } else {
        Some("On iPhone, notes are stored in Files > On My iPhone > Gneauxghts.".to_string())
    }
}

fn configured_documents_dir() -> Result<Option<PathBuf>, String> {
    DOCUMENTS_DIR
        .lock()
        .map_err(|_| "Documents directory lock poisoned".to_string())
        .map(|value| value.clone())
}

fn dedupe_hidden_task_keys(state: &mut PersistedState) {
    let mut seen = HashSet::new();
    state
        .hidden_task_keys
        .retain(|task_key| !task_key.is_empty() && seen.insert(task_key.clone()));
}

fn prune_hidden_note_ids(state: &mut PersistedState, notes_dir: &Path) {
    prune_note_id_list(&mut state.hidden_note_ids, notes_dir);
}

fn prune_note_order_note_ids(state: &mut PersistedState, notes_dir: &Path) {
    prune_note_id_list(&mut state.note_order_note_ids, notes_dir);
}

fn prune_collapsed_note_ids(state: &mut PersistedState, notes_dir: &Path) {
    prune_note_id_list(&mut state.collapsed_note_ids, notes_dir);
}

fn prune_note_id_list(note_ids: &mut Vec<String>, notes_dir: &Path) {
    let mut seen = HashSet::new();
    note_ids.retain(|note_id| {
        resolve_note_path_by_id(notes_dir, note_id)
            .map(|path| path.is_some() && seen.insert(note_id.clone()))
            .unwrap_or(false)
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
    title: &str,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    if title.trim().is_empty() && markdown.trim().is_empty() {
        return Ok(current_path.map(Path::to_path_buf));
    }

    let file_stem = derive_file_stem_from_title_and_markdown(title, markdown);
    let target_dir = current_path
        .and_then(Path::parent)
        .filter(|parent| parent.starts_with(notes_dir))
        .unwrap_or(notes_dir);
    let preferred_path = target_dir.join(format!("{file_stem}.md"));

    if current_path.is_some_and(|path| path == preferred_path) || !preferred_path.exists() {
        return Ok(Some(preferred_path));
    }

    if let Some(existing_path) = current_path {
        if existing_path.exists() && existing_path.file_name() == preferred_path.file_name() {
            return Ok(Some(existing_path.to_path_buf()));
        }
    }

    for suffix in 2.. {
        let candidate = target_dir.join(format!("{file_stem} {suffix}.md"));
        if current_path.is_some_and(|path| path == candidate) || !candidate.exists() {
            return Ok(Some(candidate));
        }
    }

    Err("Unable to determine a target path for the note".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        derive_file_stem, derive_file_stem_from_title_and_markdown, forgotten_notes_root,
        initialize_app_data_dir, legacy_state_paths, persist_note, read_state,
        resolve_note_id_from_path, write_state, PersistedForgottenNote, PersistedState,
        PersistedTaskTimestamps,
    };
    use crate::test_support::{TestDir, TEST_ENV_GUARD};
    use std::{collections::HashMap, fs};

    #[test]
    fn derive_file_stem_sanitizes_invalid_characters_and_truncates() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
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
    fn derive_file_stem_prefers_explicit_title() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-derive-title");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");

        let stem = derive_file_stem_from_title_and_markdown("  Title From Input  ", "Body text");
        assert_eq!(stem, "Title From Input");
    }

    #[test]
    fn persist_note_renames_existing_file_when_title_changes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-persist");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-persist-note");
        let notes_dir = temp.path();
        let original_path = notes_dir.join("First Note.md");
        fs::write(&original_path, "Old content").expect("write original note");

        let saved_path = persist_note(
            notes_dir,
            "Second Note",
            "Fresh content",
            Some(original_path.as_path()),
        )
        .expect("persist note")
        .expect("saved path");

        let renamed_path = notes_dir.join("Second Note.md");
        assert_eq!(saved_path, renamed_path.to_string_lossy());
        assert!(!original_path.exists());
        let saved_markdown = fs::read_to_string(&renamed_path).expect("read renamed note");
        assert!(saved_markdown.contains("gneauxghts:"));
        assert!(saved_markdown.ends_with("Fresh content"));
    }

    #[test]
    fn persist_note_keeps_existing_nested_folder_when_title_changes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-persist-nested");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-persist-note-nested");
        let notes_dir = temp.path();
        let nested_dir = notes_dir.join("Projects");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        let original_path = nested_dir.join("First Note.md");
        fs::write(&original_path, "Old content").expect("write original note");

        let saved_path = persist_note(
            notes_dir,
            "Second Note",
            "Fresh content",
            Some(original_path.as_path()),
        )
        .expect("persist note")
        .expect("saved path");

        let renamed_path = nested_dir.join("Second Note.md");
        assert_eq!(saved_path, renamed_path.to_string_lossy());
        assert!(!original_path.exists());
        assert!(renamed_path.exists());
    }

    #[test]
    fn resolve_note_path_by_id_finds_nested_notes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-resolve-nested");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-resolve-note-nested");
        let notes_dir = temp.path();
        let nested_dir = notes_dir.join("Projects");
        let hidden_dir = notes_dir.join(".obsidian");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::create_dir_all(&hidden_dir).expect("create hidden dir");

        let nested_note = nested_dir.join("Roadmap.md");
        let hidden_note = hidden_dir.join("Ignore.md");
        fs::write(&nested_note, "# Roadmap\n\nBody").expect("write nested note");
        fs::write(&hidden_note, "# Ignore\n\nBody").expect("write hidden note");
        let note_id = resolve_note_id_from_path(&nested_note).expect("note id");

        let resolved = super::resolve_note_path_by_id(notes_dir, &note_id).expect("resolve path");

        assert_eq!(resolved, Some(nested_note));
    }

    #[test]
    fn read_state_prunes_invalid_paths_and_dedupes_entries() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-prune");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-pruning");
        let notes_dir = temp.path();
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let forgotten_dir = forgotten_notes_root(notes_dir);
        fs::create_dir_all(&forgotten_dir).expect("create forgotten dir");
        let live_forgotten_note = forgotten_dir.join("Live Note.md");
        fs::write(&live_forgotten_note, "# Live Note\n\nBody").expect("write forgotten note");
        let stale_forgotten_note = forgotten_dir.join("Missing Note.md");
        let live_note_id = resolve_note_id_from_path(&live_note).expect("live note id");

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
                last_opened_note_id: Some("missing-note".to_string()),
                recent_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                hidden_task_keys: vec![String::new(), "task-1".to_string(), "task-1".to_string()],
                hidden_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                note_order_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                collapsed_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
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
        assert_eq!(state.last_opened_note_id, None);
        assert_eq!(state.recent_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.hidden_task_keys, vec!["task-1".to_string()]);
        assert_eq!(state.hidden_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.note_order_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.collapsed_note_ids, vec![live_note_id]);
        assert_eq!(state.task_timestamps.len(), 1);
        assert_eq!(state.forgotten_notes.len(), 1);
        assert_eq!(
            state.forgotten_notes[0].forgotten_path,
            live_forgotten_note.to_string_lossy()
        );
    }

    #[test]
    fn read_state_migrates_legacy_json_into_sqlite() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-migrate");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-migrate");
        let notes_dir = temp.path();
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let live_note_id = resolve_note_id_from_path(&live_note).expect("live note id");

        let legacy_paths = legacy_state_paths(notes_dir).expect("legacy state paths");
        let legacy_path = legacy_paths.first().cloned().expect("legacy state path");
        let legacy_state = PersistedState {
            last_opened_note_id: Some(live_note_id.clone()),
            recent_note_ids: vec![live_note_id.clone()],
            hidden_task_keys: vec!["task-1".to_string()],
            hidden_note_ids: vec![live_note_id.clone()],
            note_order_note_ids: vec![live_note_id.clone()],
            collapsed_note_ids: vec![live_note_id.clone()],
            task_timestamps: HashMap::from([(
                "task-1".to_string(),
                PersistedTaskTimestamps {
                    created_at_millis: 10,
                    updated_at_millis: 20,
                },
            )]),
            forgotten_notes: Vec::new(),
        };
        let serialized =
            serde_json::to_string_pretty(&legacy_state).expect("serialize legacy state");
        fs::write(&legacy_path, serialized).expect("write legacy state");

        let migrated = read_state(notes_dir).expect("migrate state");
        assert_eq!(
            migrated.last_opened_note_id,
            legacy_state.last_opened_note_id
        );
        assert_eq!(migrated.recent_note_ids, legacy_state.recent_note_ids);
        assert_eq!(migrated.hidden_task_keys, legacy_state.hidden_task_keys);
        assert_eq!(migrated.hidden_note_ids, legacy_state.hidden_note_ids);
        assert_eq!(
            migrated.note_order_note_ids,
            legacy_state.note_order_note_ids
        );
        assert_eq!(migrated.collapsed_note_ids, legacy_state.collapsed_note_ids);
        assert_eq!(migrated.task_timestamps.len(), 1);
        assert!(!legacy_path.exists());

        let persisted = read_state(notes_dir).expect("read migrated state");
        assert_eq!(
            persisted.last_opened_note_id,
            legacy_state.last_opened_note_id
        );
        assert_eq!(persisted.recent_note_ids, legacy_state.recent_note_ids);
        assert_eq!(persisted.hidden_task_keys, legacy_state.hidden_task_keys);
    }
}
