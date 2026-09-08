use crate::path_utils::collect_markdown_files_recursively;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const NOTES_DIRECTORY_NAME: &str = "Gneauxghts";
/// Default vault folder name inside the iOS Documents container.
pub(crate) const DEFAULT_IOS_VAULT_NAME: &str = "Notes";
pub(super) const VAULT_CONFIG_FILE_NAME: &str = ".gneauxghts-state.json";
pub(super) const FORGOTTEN_DIRECTORY_NAME: &str = ".forgotten";

/// Vault-local directory holding portable durable state and caches. Lives
/// directly inside the notes root so a vault folder is self-contained and
/// movable. Hidden (dot-prefixed) so the markdown walker skips it.
pub(crate) const VAULT_DATA_DIR_NAME: &str = ".gneauxghts";
/// Disposable, rebuildable caches (HNSW snapshot, lexical/graph sidecars).
pub(crate) const VAULT_CACHE_DIR_NAME: &str = "cache";
/// Portable vault manifest filename, inside the vault data dir.
pub(crate) const VAULT_MANIFEST_FILE_NAME: &str = "vault.json";
/// Current manifest schema version. Bump when the manifest shape changes.
pub(crate) const VAULT_MANIFEST_SCHEMA_VERSION: u32 = 2;

static APP_DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static DOCUMENTS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Fixture-only composition input for the startup vault root. When set, it
/// takes precedence over the persisted vault config before `RunningVault` is
/// constructed. It never changes an already-composed running vault.
static NOTES_ROOT_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);
#[cfg(test)]
static FAIL_NEXT_CONFIG_PUBLICATION: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[derive(Debug)]
pub(crate) struct RunningVault {
    root: PathBuf,
    data_dir: PathBuf,
    app_local_observation_dir: PathBuf,
}

impl RunningVault {
    pub(crate) fn resolve(app_local_observation_dir: PathBuf) -> Result<Self, String> {
        let root = prepare_vault_root(&selected_notes_root()?, false)?;
        let data_dir = vault_data_dir_for(&root);
        fs::create_dir_all(&app_local_observation_dir).map_err(|err| err.to_string())?;
        let app_local_observation_dir =
            fs::canonicalize(app_local_observation_dir).map_err(|err| err.to_string())?;
        Ok(Self {
            root,
            data_dir,
            app_local_observation_dir,
        })
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub(crate) fn app_local_observation_dir(&self) -> &Path {
        &self.app_local_observation_dir
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultConfig {
    pub(crate) notes_root: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultInfo {
    pub(crate) running_path: String,
    pub(crate) selected_path: String,
    pub(crate) default_path: String,
    pub(crate) forgotten_path: String,
    pub(crate) is_default: bool,
    pub(crate) note_count: usize,
    pub(crate) requires_restart: bool,
    pub(crate) can_configure_path: bool,
    /// When true, the UI may open an OS folder picker for any path.
    /// When false (iOS), selection is limited to folders under
    /// [`vault_container_path`].
    pub(crate) can_pick_arbitrary_path: bool,
    /// Documents container that holds vault folders on iOS; `None` on desktop.
    pub(crate) vault_container_path: Option<String>,
    pub(crate) path_configuration_note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultFolderInfo {
    pub(crate) name: String,
    pub(crate) path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateVaultFolderResult {
    pub(crate) created_path: String,
    pub(crate) folders: Vec<VaultFolderInfo>,
}

fn selected_notes_root() -> Result<PathBuf, String> {
    if let Some(override_root) = NOTES_ROOT_OVERRIDE
        .lock()
        .map_err(|_| "Notes root override lock poisoned".to_string())?
        .clone()
    {
        return Ok(override_root);
    }

    configured_selected_root()
}

fn configured_selected_root() -> Result<PathBuf, String> {
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

/// Resolve the startup selection. Operational code must use
/// [`RunningVault::root`] after composition instead of rereading this value.
#[cfg(test)]
pub(crate) fn notes_root() -> Result<PathBuf, String> {
    selected_notes_root()
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

/// Override startup vault selection for disposable tests and E2E composition.
/// Passing `None` restores persisted-config resolution. This input is consumed
/// only when constructing `RunningVault`; it is not a runtime switching seam.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn set_notes_root_override(path: Option<PathBuf>) -> Result<(), String> {
    let mut stored = NOTES_ROOT_OVERRIDE
        .lock()
        .map_err(|_| "Notes root override lock poisoned".to_string())?;
    *stored = path;
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
        if uses_vault_container() {
            return Ok(documents_dir.join(DEFAULT_IOS_VAULT_NAME));
        }

        return Ok(documents_dir.join(NOTES_DIRECTORY_NAME));
    }

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
    #[cfg(test)]
    if FAIL_NEXT_CONFIG_PUBLICATION.swap(false, std::sync::atomic::Ordering::AcqRel) {
        return Err("Injected vault config publication failure".to_string());
    }
    let path = vault_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let serialized = serde_json::to_vec_pretty(config).map_err(|err| err.to_string())?;
    let temporary = path.with_extension(format!(
        "tmp-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|err| err.to_string())?;
        file.write_all(&serialized).map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;
        fs::rename(&temporary, &path).map_err(|err| err.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub(crate) fn stage_notes_root(
    running: &RunningVault,
    path: Option<&Path>,
) -> Result<VaultInfo, String> {
    let mut info = current_vault_info(running)?;
    let (notes_root, requested) = match path {
        Some(path) => (Some(path), path.to_path_buf()),
        None => (None, default_notes_root()?),
    };
    let selected = prepare_vault_root(&requested, true)?;
    let notes_root = notes_root.map(|_| selected.to_string_lossy().into_owned());

    write_vault_config(&VaultConfig { notes_root })?;
    info.selected_path = selected.to_string_lossy().into_owned();
    info.requires_restart = selected != running.root;
    Ok(info)
}

pub(crate) fn current_vault_info(running: &RunningVault) -> Result<VaultInfo, String> {
    let current_path = running.root();
    let default_path = default_notes_root()?;
    let default_identity = canonical_path_identity(&default_path)?;
    let forgotten_path = forgotten_notes_root(&current_path);
    let note_count = collect_markdown_files_recursively(&current_path)?.len();
    let selected_path = canonical_path_identity(&configured_selected_root()?)?;
    let vault_container_path =
        vault_container_dir()?.map(|path| path.to_string_lossy().into_owned());

    Ok(VaultInfo {
        running_path: current_path.to_string_lossy().into_owned(),
        selected_path: selected_path.to_string_lossy().into_owned(),
        default_path: default_path.to_string_lossy().into_owned(),
        forgotten_path: forgotten_path.to_string_lossy().into_owned(),
        is_default: running.root == default_identity,
        note_count,
        requires_restart: selected_path != running.root,
        can_configure_path: true,
        can_pick_arbitrary_path: can_pick_arbitrary_vault_path(),
        vault_container_path,
        path_configuration_note: vault_path_configuration_note(),
    })
}

fn prepare_vault_root(path: &Path, scaffold: bool) -> Result<PathBuf, String> {
    if uses_vault_container() {
        let container = vault_container_dir()?.ok_or_else(|| {
            "Documents container is not available for vault selection.".to_string()
        })?;
        validate_vault_path_in_container(path, &container)?;
    }
    if path.exists() && !path.is_dir() {
        return Err("Vault path must be a folder".to_string());
    }
    fs::create_dir_all(path).map_err(|err| err.to_string())?;
    let canonical = fs::canonicalize(path).map_err(|err| err.to_string())?;
    if scaffold {
        crate::services::note_timeline::ensure_vault_scaffold(&canonical)
            .map_err(|error| error.to_string())?;
    }
    Ok(canonical)
}

#[cfg(test)]
pub(crate) fn inject_vault_config_publication_failure_once() {
    FAIL_NEXT_CONFIG_PUBLICATION.store(true, std::sync::atomic::Ordering::Release);
}

fn canonical_path_identity(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|err| err.to_string());
    }
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    env::current_dir()
        .map(|directory| directory.join(path))
        .map_err(|err| err.to_string())
}

/// Documents container that holds selectable vault folders (iOS only).
pub(crate) fn vault_container_dir() -> Result<Option<PathBuf>, String> {
    if !uses_vault_container() {
        return Ok(None);
    }
    configured_documents_dir()
}

/// List immediate non-hidden child directories of the vault container.
pub(crate) fn list_vault_folders() -> Result<Vec<VaultFolderInfo>, String> {
    let Some(container) = vault_container_dir()? else {
        return Ok(Vec::new());
    };
    list_vault_folders_in(&container)
}

/// Create a vault folder under the Documents container and return the updated list.
pub(crate) fn create_vault_folder(name: &str) -> Result<CreateVaultFolderResult, String> {
    let container = vault_container_dir()?.ok_or_else(|| {
        "Vault folders can only be created inside the iPhone Documents container.".to_string()
    })?;
    create_vault_folder_in(&container, name)
}

pub(crate) fn list_vault_folders_in(container: &Path) -> Result<Vec<VaultFolderInfo>, String> {
    fs::create_dir_all(container).map_err(|err| err.to_string())?;
    let mut folders = Vec::new();
    let entries = fs::read_dir(container).map_err(|err| err.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        folders.push(VaultFolderInfo {
            name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    folders.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(folders)
}

pub(crate) fn create_vault_folder_in(
    container: &Path,
    name: &str,
) -> Result<CreateVaultFolderResult, String> {
    let sanitized = sanitize_vault_folder_name(name)?;
    fs::create_dir_all(container).map_err(|err| err.to_string())?;
    let created_path = container.join(&sanitized);
    if created_path.exists() {
        if !created_path.is_dir() {
            return Err(format!(
                "A file named \"{sanitized}\" already exists in the vault container."
            ));
        }
    } else {
        fs::create_dir(&created_path).map_err(|err| err.to_string())?;
    }
    ensure_vault_directories(&created_path)?;
    Ok(CreateVaultFolderResult {
        created_path: created_path.to_string_lossy().into_owned(),
        folders: list_vault_folders_in(container)?,
    })
}

/// Validate that `path` is an immediate child of `container` (not the container
/// itself, not nested deeper, not outside). Works whether or not `path` exists.
pub(crate) fn validate_vault_path_in_container(
    path: &Path,
    container: &Path,
) -> Result<(), String> {
    fs::create_dir_all(container).map_err(|err| err.to_string())?;
    let container = fs::canonicalize(container)
        .map_err(|err| format!("Unable to resolve vault container path: {err}"))?;

    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return Err(
            "Vault path must be a named folder inside the Documents container.".to_string(),
        );
    };
    sanitize_vault_folder_name(name)?;

    let Some(parent) = path.parent() else {
        return Err("Vault path must be a folder inside the Documents container.".to_string());
    };
    if parent.as_os_str().is_empty() {
        return Err("Vault path must be a folder inside the Documents container.".to_string());
    }

    let parent = if parent.exists() {
        fs::canonicalize(parent)
            .map_err(|err| format!("Unable to resolve vault parent path: {err}"))?
    } else {
        return Err(
            "Vault folders must be immediate children of Files > On My iPhone > Gneauxghts."
                .to_string(),
        );
    };

    if parent != container {
        return Err(
            "Vault folders must be immediate children of Files > On My iPhone > Gneauxghts."
                .to_string(),
        );
    }

    if path.exists() {
        let canonical = fs::canonicalize(path).map_err(|err| err.to_string())?;
        if canonical == container {
            return Err(
                "The Documents container itself cannot be used as a vault. Choose or create a folder inside it."
                    .to_string(),
            );
        }
        if canonical.parent() != Some(container.as_path()) {
            return Err(
                "Vault folders must be immediate children of Files > On My iPhone > Gneauxghts."
                    .to_string(),
            );
        }
    }

    Ok(())
}

pub(crate) fn sanitize_vault_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Vault name cannot be empty.".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Vault name is invalid.".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Vault names cannot start with a period.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("Vault name cannot contain path separators.".to_string());
    }
    if Path::new(trimmed).components().count() != 1 {
        return Err("Vault name must be a single folder name.".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn forgotten_notes_root(notes_dir: &Path) -> PathBuf {
    notes_dir.join(FORGOTTEN_DIRECTORY_NAME)
}

// ---------------------------------------------------------------------------
// Portable vault path abstraction
//
// All vault-local durable state and caches live under `<vault>/.gneauxghts`.
// Production callers derive these paths from the composed RunningVault. The
// no-argument root/data aliases below remain test-only compatibility helpers.
// ---------------------------------------------------------------------------

/// The active vault root (the notes directory). Alias of [`notes_root`].
#[cfg(test)]
pub(crate) fn vault_root() -> Result<PathBuf, String> {
    notes_root()
}

/// `<vault>/.gneauxghts` — portable durable state and caches.
pub(crate) fn vault_data_dir_for(vault_root: &Path) -> PathBuf {
    vault_root.join(VAULT_DATA_DIR_NAME)
}

/// `<vault>/.gneauxghts` for the active vault.
#[cfg(test)]
pub(crate) fn vault_data_dir() -> Result<PathBuf, String> {
    Ok(vault_data_dir_for(&vault_root()?))
}

/// `<vault>/.gneauxghts/cache` — disposable, rebuildable caches.
pub(crate) fn vault_cache_dir_for(vault_root: &Path) -> PathBuf {
    vault_data_dir_for(vault_root).join(VAULT_CACHE_DIR_NAME)
}

/// `<vault>/.gneauxghts/vault.json` — portable vault manifest.
pub(crate) fn vault_manifest_path_for(vault_root: &Path) -> PathBuf {
    vault_data_dir_for(vault_root).join(VAULT_MANIFEST_FILE_NAME)
}

/// Portable, vault-local manifest. Travels with the vault folder so a vault
/// can be identified across machines and app versions. Caches and DBs are
/// rebuildable/migratable; the manifest is the stable identity record.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultManifest {
    /// Stable, opaque vault identifier. Generated once on first scaffold.
    pub(crate) vault_id: String,
    /// Manifest schema version (see [`VAULT_MANIFEST_SCHEMA_VERSION`]).
    pub(crate) schema_version: u32,
    /// Storage-neutral selector for the active Note Timeline store.
    pub(crate) history_format: String,
    /// Monotonic generation selected for the active history store.
    pub(crate) history_generation: u64,
    /// App version that created the manifest, for diagnostics.
    pub(crate) app_version: String,
    /// Unix millis when the vault data dir was first scaffolded.
    pub(crate) created_at_millis: i64,
    /// Unix millis of the most recent scaffold/open touch.
    pub(crate) updated_at_millis: i64,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Derive an opaque, stable vault id without pulling in a uuid dependency.
/// Mixes wall-clock nanos, the vault path, and the process id through
/// blake3 so collisions across freshly-scaffolded vaults are vanishingly
/// unlikely. The value is persisted in the manifest, so it only needs to be
/// unique at creation time.
fn generate_vault_id(vault_root: &Path) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let mut hasher = blake3::Hasher::new();
    hasher.update(&nanos.to_le_bytes());
    hasher.update(&std::process::id().to_le_bytes());
    hasher.update(vault_root.to_string_lossy().as_bytes());
    let hex = hasher.finalize().to_hex();
    format!("vlt_{}", &hex.as_str()[..24])
}

/// Read the manifest for a vault if present and parseable.
pub(crate) fn read_vault_manifest_for(vault_root: &Path) -> Result<Option<VaultManifest>, String> {
    let path = vault_manifest_path_for(vault_root);
    if !path.is_file() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|err| format!("vault manifest parse: {err}"))
}

fn write_vault_manifest_for(vault_root: &Path, manifest: &VaultManifest) -> Result<(), String> {
    let path = vault_manifest_path_for(vault_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(manifest).map_err(|err| err.to_string())?;
    let temporary =
        path.with_file_name(format!(".vault-{}.tmp", crate::note::generate_unique_id()));
    fs::write(&temporary, serialized).map_err(|err| err.to_string())?;
    if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}

pub(crate) fn advance_vault_history_generation(
    vault_root: &Path,
    history_format: &str,
    initial_generation: u64,
) -> Result<(u64, u64), String> {
    let mut manifest = read_vault_manifest_for(vault_root)?
        .map(Ok)
        .unwrap_or_else(|| {
            ensure_vault_scaffold_for_history(vault_root, history_format, initial_generation)
        })?;
    let previous_generation = manifest.history_generation;
    manifest.history_generation = previous_generation
        .checked_add(1)
        .ok_or_else(|| "Note Timeline history generation is exhausted".to_string())?;
    manifest.history_format = history_format.to_string();
    manifest.updated_at_millis = now_millis();
    write_vault_manifest_for(vault_root, &manifest)?;
    Ok((previous_generation, manifest.history_generation))
}

/// Ensure the `.gneauxghts` data + cache directories exist for a vault and
/// that a manifest is present. Idempotent: an existing manifest keeps its
/// `vault_id` and `created_at_millis`, only bumping `updated_at_millis` (and
/// `app_version`/`schema_version` if they drifted). Returns the manifest.
pub(crate) fn ensure_vault_scaffold_for_history(
    vault_root: &Path,
    initial_history_format: &str,
    initial_history_generation: u64,
) -> Result<VaultManifest, String> {
    ensure_vault_directories(vault_root)?;

    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let now = now_millis();
    let manifest = match read_vault_manifest_for(vault_root)? {
        Some(existing) => VaultManifest {
            vault_id: existing.vault_id,
            schema_version: VAULT_MANIFEST_SCHEMA_VERSION,
            history_format: existing.history_format,
            history_generation: existing.history_generation,
            app_version,
            created_at_millis: existing.created_at_millis,
            updated_at_millis: now,
        },
        None => VaultManifest {
            vault_id: generate_vault_id(vault_root),
            schema_version: VAULT_MANIFEST_SCHEMA_VERSION,
            history_format: initial_history_format.to_string(),
            history_generation: initial_history_generation,
            app_version,
            created_at_millis: now,
            updated_at_millis: now,
        },
    };
    write_vault_manifest_for(vault_root, &manifest)?;
    Ok(manifest)
}

fn ensure_vault_directories(vault_root: &Path) -> Result<(), String> {
    fs::create_dir_all(vault_data_dir_for(vault_root)).map_err(|err| err.to_string())?;
    let cache_dir = vault_cache_dir_for(vault_root);
    fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
    // Reserve the rebuildable sidecar cache subdirs that the layout calls for.
    // The lexical index is currently RAM-only, so this may stay empty; creating
    // it keeps the on-disk layout stable if it starts persisting.
    fs::create_dir_all(cache_dir.join("lexical")).map_err(|err| err.to_string())?;
    fs::create_dir_all(cache_dir.join("graph")).map_err(|err| err.to_string())?;
    Ok(())
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

/// iOS uses the sandboxed Documents directory as a vault *container*; vaults
/// are immediate child folders. Desktop may pick any folder.
fn uses_vault_container() -> bool {
    cfg!(target_os = "ios")
}

fn can_pick_arbitrary_vault_path() -> bool {
    !uses_vault_container()
}

fn vault_path_configuration_note() -> Option<String> {
    if can_pick_arbitrary_vault_path() {
        None
    } else {
        Some(
            "On iPhone, vault folders live in Files > On My iPhone > Gneauxghts. Create or select a folder there for your notes."
                .to_string(),
        )
    }
}

fn vault_config_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join(VAULT_CONFIG_FILE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{lock_test_env, TestDir};

    #[test]
    fn vault_paths_derive_from_vault_root() {
        let root = PathBuf::from("/tmp/MyVault");
        assert_eq!(vault_data_dir_for(&root), root.join(".gneauxghts"));
        assert_eq!(
            vault_cache_dir_for(&root),
            root.join(".gneauxghts").join("cache")
        );
        assert_eq!(
            vault_manifest_path_for(&root),
            root.join(".gneauxghts").join("vault.json")
        );
    }

    #[test]
    fn ensure_vault_scaffold_creates_dirs_and_manifest() {
        let _guard = lock_test_env();
        let vault = TestDir::new("config-scaffold");
        let root = vault.path();

        let manifest =
            ensure_vault_scaffold_for_history(root, "fixture-history-v1", 7).expect("scaffold");

        assert!(vault_data_dir_for(root).is_dir());
        assert!(vault_cache_dir_for(root).is_dir());
        assert!(vault_cache_dir_for(root).join("lexical").is_dir());
        assert!(vault_cache_dir_for(root).join("graph").is_dir());
        assert!(vault_manifest_path_for(root).is_file());
        assert!(manifest.vault_id.starts_with("vlt_"));
        assert_eq!(manifest.schema_version, VAULT_MANIFEST_SCHEMA_VERSION);
        assert_eq!(manifest.history_format, "fixture-history-v1");
        assert_eq!(manifest.history_generation, 7);
        assert!(manifest.created_at_millis > 0);
        assert!(manifest.updated_at_millis >= manifest.created_at_millis);
    }

    #[test]
    fn ensure_vault_scaffold_is_idempotent_and_stable_id() {
        let _guard = lock_test_env();
        let vault = TestDir::new("config-scaffold-idempotent");
        let root = vault.path();

        let first = ensure_vault_scaffold_for_history(root, "fixture-history-v1", 7)
            .expect("scaffold first");
        let second = ensure_vault_scaffold_for_history(root, "ignored-history-v2", 8)
            .expect("scaffold second");

        // Identity is stable across re-scaffolds; only updated_at moves.
        assert_eq!(first.vault_id, second.vault_id);
        assert_eq!(first.created_at_millis, second.created_at_millis);
        assert!(second.updated_at_millis >= first.updated_at_millis);

        let on_disk = read_vault_manifest_for(root)
            .expect("read manifest")
            .expect("manifest present");
        assert_eq!(on_disk.vault_id, first.vault_id);
    }

    #[test]
    fn notes_root_override_takes_precedence() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("config-override-appdata");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("set app data");
        let vault = TestDir::new("config-override-vault");

        set_notes_root_override(Some(vault.path().to_path_buf())).expect("set override");
        assert_eq!(notes_root().expect("notes root"), vault.path());
        assert_eq!(
            vault_data_dir().expect("vault data dir"),
            vault.path().join(".gneauxghts")
        );

        set_notes_root_override(None).expect("clear override");
    }

    #[cfg(unix)]
    #[test]
    fn running_vault_canonicalizes_missing_root_and_observation_aliases() {
        let _guard = lock_test_env();
        let fixture = TestDir::new("config-running-vault-canonical");
        let real_parent = fixture.path().join("real-parent");
        fs::create_dir_all(&real_parent).expect("create real parent");
        let parent_alias = fixture.path().join("parent-alias");
        std::os::unix::fs::symlink(&real_parent, &parent_alias).expect("alias parent");
        let requested_root = parent_alias.join("new-vault");

        let real_observation_dir = fixture.path().join("real-observation");
        fs::create_dir_all(&real_observation_dir).expect("create real observation dir");
        let observation_alias = fixture.path().join("observation-alias");
        std::os::unix::fs::symlink(&real_observation_dir, &observation_alias)
            .expect("alias observation dir");

        set_notes_root_override(Some(requested_root.clone())).expect("set startup selection");
        let running = RunningVault::resolve(observation_alias).expect("compose running vault");

        let expected_root =
            fs::canonicalize(real_parent.join("new-vault")).expect("canonical created root");
        assert!(requested_root.is_dir());
        assert_eq!(running.root(), expected_root);
        assert_eq!(running.data_dir(), expected_root.join(VAULT_DATA_DIR_NAME));
        assert_eq!(
            running.app_local_observation_dir(),
            fs::canonicalize(real_observation_dir).expect("canonical observation dir")
        );

        set_notes_root_override(None).expect("clear startup selection");
    }

    #[test]
    fn sanitize_vault_folder_name_rejects_invalid_names() {
        assert_eq!(sanitize_vault_folder_name("  Work  ").expect("ok"), "Work");
        assert!(sanitize_vault_folder_name("").is_err());
        assert!(sanitize_vault_folder_name("   ").is_err());
        assert!(sanitize_vault_folder_name(".").is_err());
        assert!(sanitize_vault_folder_name("..").is_err());
        assert!(sanitize_vault_folder_name(".hidden").is_err());
        assert!(sanitize_vault_folder_name("a/b").is_err());
        assert!(sanitize_vault_folder_name("a\\b").is_err());
    }

    #[test]
    fn validate_vault_path_accepts_immediate_child_and_rejects_others() {
        let _guard = lock_test_env();
        let container = TestDir::new("config-vault-container");
        let container_path = container.path();
        let allowed = container_path.join("Notes");
        fs::create_dir_all(&allowed).expect("create Notes");

        validate_vault_path_in_container(&allowed, container_path).expect("Notes ok");
        validate_vault_path_in_container(&container_path.join("Work"), container_path)
            .expect("new child ok");

        assert!(validate_vault_path_in_container(container_path, container_path).is_err());
        assert!(validate_vault_path_in_container(&allowed.join("nested"), container_path).is_err());

        let outside = TestDir::new("config-vault-outside");
        assert!(validate_vault_path_in_container(outside.path(), container_path).is_err());
        assert!(
            validate_vault_path_in_container(&outside.path().join("Escape"), container_path)
                .is_err()
        );
    }

    #[test]
    fn list_and_create_vault_folders_in_container() {
        let _guard = lock_test_env();
        let container = TestDir::new("config-vault-list-create");
        let container_path = container.path();
        fs::create_dir_all(container_path.join(".hidden")).expect("hidden");
        fs::write(container_path.join("readme.txt"), "x").expect("file");

        let created = create_vault_folder_in(container_path, "Personal").expect("create");
        assert!(created.created_path.ends_with("Personal"));
        assert!(vault_data_dir_for(Path::new(&created.created_path)).is_dir());

        let folders = list_vault_folders_in(container_path).expect("list");
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Personal");

        create_vault_folder_in(container_path, "../escape").expect_err("reject escape");
        create_vault_folder_in(container_path, "nested/path").expect_err("reject nested");
    }

    #[test]
    fn ios_default_notes_root_uses_notes_child_when_documents_configured() {
        let _guard = lock_test_env();
        let documents = TestDir::new("config-ios-default-docs");
        initialize_documents_dir(documents.path().to_path_buf()).expect("set documents");

        let default = default_notes_root().expect("default");
        if cfg!(target_os = "ios") {
            assert_eq!(default, documents.path().join(DEFAULT_IOS_VAULT_NAME));
            assert_eq!(
                vault_container_dir().expect("container").as_deref(),
                Some(documents.path())
            );
        } else {
            assert_eq!(default, documents.path().join(NOTES_DIRECTORY_NAME));
            assert_eq!(vault_container_dir().expect("container"), None);
        }
    }
}
