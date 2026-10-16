//! Native location mapping only. Known roots are bound to the surviving vault manifest;
//! authored Pi payloads, authorization, hashes and effect receipts are never rewritten.
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

pub(crate) struct Locations {
    root: PathBuf,
    roots: Vec<PathBuf>,
}
fn clean(path: &Path) -> bool {
    path.is_absolute()
        && path.parent().is_some()
        && path.components().all(|part| {
            matches!(
                part,
                Component::Prefix(_) | Component::RootDir | Component::Normal(_)
            )
        })
}
impl Locations {
    pub(crate) fn bind(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let manifest =
            crate::state::read_vault_manifest_for(&root)?.ok_or("Vault identity unavailable")?;
        let dir = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut db = Connection::open(dir.join("locations.sqlite")).map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS vault_locations(vault_id TEXT PRIMARY KEY, roots_json TEXT NOT NULL);").map_err(|e|e.to_string())?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT roots_json FROM vault_locations WHERE vault_id=?1",
                [&manifest.vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let mut roots: Vec<PathBuf> = previous
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        if roots.iter().any(|path| !clean(path)) {
            return Err("Invalid retained vault root".into());
        }
        if !roots.contains(&root) {
            roots.push(root.clone());
        }
        tx.execute("INSERT INTO vault_locations(vault_id,roots_json) VALUES(?1,?2) ON CONFLICT(vault_id) DO UPDATE SET roots_json=excluded.roots_json",
            params![manifest.vault_id,serde_json::to_string(&roots).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        roots.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
        Ok(Self { root, roots })
    }
    pub(crate) fn resolve(&self, path: &Path) -> Result<PathBuf, String> {
        if !clean(path) {
            return Err("Location is not an absolute vault path".into());
        }
        if path.starts_with(&self.root) {
            return Ok(path.to_path_buf());
        }
        for previous in &self.roots {
            if let Ok(relative) = path.strip_prefix(previous) {
                if relative.as_os_str().is_empty() {
                    return Err("A note location cannot be the vault root".into());
                }
                return Ok(self.root.join(relative));
            }
        }
        Err("Location belongs to an unknown vault root; choose its location again".into())
    }
    pub(crate) fn display_json(&self, mut value: serde_json::Value) -> serde_json::Value {
        // Only the existing native receipt's closed location fields are mapped.
        for pointer in ["/applied/path", "/applied/previousPath"] {
            if let Some(raw) = value.pointer(pointer).and_then(serde_json::Value::as_str) {
                if let Ok(path) = self.resolve(Path::new(raw)) {
                    *value.pointer_mut(pointer).unwrap() =
                        serde_json::json!(path.to_string_lossy());
                }
            }
        }
        value
    }
}
/// The persistent Pi database has one vault owner. This is a scope receipt,
/// not a copy of Pi sessions, messages, runs or review decisions.
fn bind_pi_owner(root: &Path) -> Result<(), String> {
    let manifest =
        crate::state::read_vault_manifest_for(root)?.ok_or("Vault identity unavailable")?;
    let dir = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut db = Connection::open(dir.join("locations.sqlite")).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS pi_vault_owner(id INTEGER PRIMARY KEY CHECK(id=1),vault_id TEXT NOT NULL);").map_err(|e|e.to_string())?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let owner: Option<String> = tx
        .query_row(
            "SELECT vault_id FROM pi_vault_owner WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if owner.as_deref().is_some_and(|id| id != manifest.vault_id) {
        return Err("Pi evaluation data belongs to another vault. Reopen its original vault or start with a fresh Pi evaluation data root.".into());
    }
    tx.execute(
        "INSERT OR IGNORE INTO pi_vault_owner(id,vault_id) VALUES(1,?1)",
        [&manifest.vault_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn pi_bind_vault_location(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::index::AppState>();
    bind_pi_owner(state.running_vault().root())?;
    Locations::bind(state.running_vault().root()).map(|_| ())
}
#[tauri::command]
pub(crate) fn pi_resolve_locations(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    if paths.len() > 10000 {
        return Err("Location batch exceeds bounds".into());
    }
    let locations = Locations::bind(app.state::<crate::index::AppState>().running_vault().root())?;
    paths
        .into_iter()
        .map(|path| {
            locations
                .resolve(Path::new(&path))
                .map(|value| value.to_string_lossy().into_owned())
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pi_data_owner_allows_same_identity_relocation_and_rejects_other_vaults() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("pi-owner-app");
        let old = crate::test_support::TestDir::new("pi-owner-old");
        let destination = crate::test_support::TestDir::new("pi-owner-new");
        let other = crate::test_support::TestDir::new("pi-owner-other");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::ensure_vault_scaffold(old.path()).unwrap();
        crate::state::ensure_vault_scaffold(other.path()).unwrap();
        bind_pi_owner(old.path()).unwrap();
        bind_pi_owner(old.path()).unwrap();
        assert!(bind_pi_owner(other.path())
            .unwrap_err()
            .contains("fresh Pi evaluation data root"));
        let moved = destination.path().join("Vault");
        fs::rename(old.path(), &moved).unwrap();
        bind_pi_owner(&moved).unwrap();
        assert!(bind_pi_owner(other.path()).is_err());
    }
    #[test]
    fn moved_manifest_rebinds_known_roots_but_a_different_vault_cannot() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("pi-location-app");
        let old = crate::test_support::TestDir::new("pi-location-old");
        let destination = crate::test_support::TestDir::new("pi-location-new");
        let other = crate::test_support::TestDir::new("pi-location-other");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::ensure_vault_scaffold(old.path()).unwrap();
        Locations::bind(old.path()).unwrap();
        let original = old.path().join("A.md");
        let moved = destination.path().join("Vault");
        fs::rename(old.path(), &moved).unwrap();
        assert_eq!(
            Locations::bind(&moved).unwrap().resolve(&original).unwrap(),
            moved.join("A.md")
        );
        crate::state::ensure_vault_scaffold(other.path()).unwrap();
        assert!(Locations::bind(other.path())
            .unwrap()
            .resolve(&original)
            .is_err());
    }
    #[test]
    fn only_proved_roots_relocate_and_authored_strings_are_untouched() {
        let locations = Locations {
            root: PathBuf::from("/new/vault"),
            roots: vec![PathBuf::from("/old/vault")],
        };
        assert_eq!(
            locations
                .resolve(Path::new("/old/vault/Folder/A.md"))
                .unwrap(),
            PathBuf::from("/new/vault/Folder/A.md")
        );
        for invalid in [
            "/unknown/A.md",
            "/old/vault/../Escape.md",
            "/old/vault",
            "relative.md",
        ] {
            assert!(locations.resolve(Path::new(invalid)).is_err());
        }
        let receipt = serde_json::json!({"applied":{"path":"/old/vault/A.md"},"committedMarkdown":"/old/vault/A.md"});
        let mapped = locations.display_json(receipt);
        assert_eq!(mapped["applied"]["path"], "/new/vault/A.md");
        assert_eq!(mapped["committedMarkdown"], "/old/vault/A.md");
    }
}
