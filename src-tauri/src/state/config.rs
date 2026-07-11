use crate::path_utils::collect_markdown_files_recursively;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const NOTES_DIRECTORY_NAME: &str = "Gneauxghts";
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
pub(crate) const VAULT_MANIFEST_SCHEMA_VERSION: u32 = 1;

static APP_DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static DOCUMENTS_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Process-wide override for the active vault root. When set, it takes
/// precedence over the persisted vault config. The startup path keeps using
/// the config file; this exists so tests can point the (now vault-local)
/// SQLite databases at an isolated temp directory, and as the seam a future
/// runtime vault-switch would flip.
static NOTES_ROOT_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

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
    if let Some(override_root) = NOTES_ROOT_OVERRIDE
        .lock()
        .map_err(|_| "Notes root override lock poisoned".to_string())?
        .clone()
    {
        return Ok(override_root);
    }

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

/// Override the active vault root for the current process. Primarily used by
/// tests to isolate the vault-local SQLite databases; passing `None` clears
/// the override so config-file resolution resumes. This is also the seam a
/// future in-process vault switch would drive.
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
        if cfg!(target_os = "ios") {
            return Ok(documents_dir);
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

// ---------------------------------------------------------------------------
// Portable vault path abstraction
//
// All vault-local durable state and caches live under `<vault>/.gneauxghts`.
// These helpers are the single source of truth for those paths so callers
// never hand-assemble `.gneauxghts/...` strings. `vault_root()` is an alias
// for `notes_root()`; the rest are derived from it.
// ---------------------------------------------------------------------------

/// The active vault root (the notes directory). Alias of [`notes_root`].
pub(crate) fn vault_root() -> Result<PathBuf, String> {
    notes_root()
}

/// `<vault>/.gneauxghts` — portable durable state and caches.
pub(crate) fn vault_data_dir_for(vault_root: &Path) -> PathBuf {
    vault_root.join(VAULT_DATA_DIR_NAME)
}

/// `<vault>/.gneauxghts` for the active vault.
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
    fs::write(&path, serialized).map_err(|err| err.to_string())
}

/// Ensure the `.gneauxghts` data + cache directories exist for a vault and
/// that a manifest is present. Idempotent: an existing manifest keeps its
/// `vault_id` and `created_at_millis`, only bumping `updated_at_millis` (and
/// `app_version`/`schema_version` if they drifted). Returns the manifest.
pub(crate) fn ensure_vault_scaffold(vault_root: &Path) -> Result<VaultManifest, String> {
    fs::create_dir_all(vault_data_dir_for(vault_root)).map_err(|err| err.to_string())?;
    let cache_dir = vault_cache_dir_for(vault_root);
    fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
    // Reserve the rebuildable sidecar cache subdirs that the layout calls for.
    // The lexical index is currently RAM-only, so this may stay empty; creating
    // it keeps the on-disk layout stable if it starts persisting.
    fs::create_dir_all(cache_dir.join("lexical")).map_err(|err| err.to_string())?;
    fs::create_dir_all(cache_dir.join("graph")).map_err(|err| err.to_string())?;

    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let now = now_millis();
    let manifest = match read_vault_manifest_for(vault_root)? {
        Some(existing) => VaultManifest {
            vault_id: existing.vault_id,
            schema_version: VAULT_MANIFEST_SCHEMA_VERSION,
            app_version,
            created_at_millis: existing.created_at_millis,
            updated_at_millis: now,
        },
        None => VaultManifest {
            vault_id: generate_vault_id(vault_root),
            schema_version: VAULT_MANIFEST_SCHEMA_VERSION,
            app_version,
            created_at_millis: now,
            updated_at_millis: now,
        },
    };
    write_vault_manifest_for(vault_root, &manifest)?;
    Ok(manifest)
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

        let manifest = ensure_vault_scaffold(root).expect("scaffold");

        assert!(vault_data_dir_for(root).is_dir());
        assert!(vault_cache_dir_for(root).is_dir());
        assert!(vault_cache_dir_for(root).join("lexical").is_dir());
        assert!(vault_cache_dir_for(root).join("graph").is_dir());
        assert!(vault_manifest_path_for(root).is_file());
        assert!(manifest.vault_id.starts_with("vlt_"));
        assert_eq!(manifest.schema_version, VAULT_MANIFEST_SCHEMA_VERSION);
        assert!(manifest.created_at_millis > 0);
        assert!(manifest.updated_at_millis >= manifest.created_at_millis);
    }

    #[test]
    fn ensure_vault_scaffold_is_idempotent_and_stable_id() {
        let _guard = lock_test_env();
        let vault = TestDir::new("config-scaffold-idempotent");
        let root = vault.path();

        let first = ensure_vault_scaffold(root).expect("scaffold first");
        let second = ensure_vault_scaffold(root).expect("scaffold second");

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
}
