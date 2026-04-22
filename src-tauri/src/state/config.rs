use super::persistence::migrate_legacy_ios_state_paths;
use crate::path_utils::collect_markdown_files_recursively;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(super) const NOTES_DIRECTORY_NAME: &str = "Gneauxghts";
pub(super) const VAULT_CONFIG_FILE_NAME: &str = ".gneauxghts-state.json";
pub(super) const FORGOTTEN_DIRECTORY_NAME: &str = ".forgotten";

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

pub(super) fn configured_app_data_dir() -> Result<Option<PathBuf>, String> {
    APP_DATA_DIR
        .lock()
        .map_err(|_| "App data directory lock poisoned".to_string())
        .map(|value| value.clone())
}

pub(super) fn configured_documents_dir() -> Result<Option<PathBuf>, String> {
    DOCUMENTS_DIR
        .lock()
        .map_err(|_| "Documents directory lock poisoned".to_string())
        .map(|value| value.clone())
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
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

fn vault_config_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join(VAULT_CONFIG_FILE_NAME))
}
