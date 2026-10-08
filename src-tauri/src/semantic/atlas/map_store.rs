//! Durable map memory. Derived semantic caches may disappear without erasing places or names.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(super) struct MapState {
    pub format_version: u32,
    pub generation: String,
    pub model: String,
    pub artifact_path: PathBuf,
    pub dependencies: Option<AtlasDependencies>,
    pub target_epoch: u64,
    pub published_at_millis: u64,
    pub nodes: Vec<MapNote>,
    pub clouds: Vec<MapCloud>,
    pub name_revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct MapNote {
    pub identity: String,
    pub path: String,
    pub position: [f32; 2],
    pub cloud: Option<String>,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct MapCloud {
    pub id: String,
    pub parent: Option<String>,
    pub family: Option<String>,
    pub members: Vec<String>,
    pub prototype: Vec<f32>,
    #[serde(default)]
    pub theme_prototype: Vec<f32>,
    pub position: [f32; 2],
    pub color: [u8; 4],
    pub hull: Vec<[f32; 2]>,
    pub radius: f32,
    pub user_name: Option<String>,
    pub auto_name: Option<String>,
    pub name_prototype: Vec<f32>,
    pub active: bool,
    pub evidence: String,
    pub observations: u32,
    pub visible_since: u64,
    pub promoted_at: Option<u64>,
    pub promotion_ready: bool,
    #[serde(default)]
    pub merge_target: Option<String>,
    #[serde(default)]
    pub merge_observations: u32,
    #[serde(default)]
    pub merge_evidence: String,
}

#[derive(Serialize, Deserialize)]
struct Head {
    current: String,
    previous: Option<String>,
}

pub(crate) struct AtlasMapStore {
    root: PathBuf,
    pub(crate) admission: Mutex<()>,
    epoch: AtomicU64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasCloudName {
    pub(crate) cloud_id: String,
    pub(crate) user_name: Option<String>,
    pub(crate) label: Option<String>,
    pub(crate) name_revision: u64,
}

impl AtlasMapStore {
    pub(crate) fn new(vault_data: &Path) -> Self {
        Self {
            root: vault_data.join("atlas-map"),
            admission: Mutex::new(()),
            epoch: AtomicU64::new(0),
        }
    }

    fn head_path(&self, key: AtlasGenerationKey) -> PathBuf {
        self.root.join(format!(
            "head-{}.json",
            key.chat_visibility.signature_value()
        ))
    }

    pub(super) fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }
    pub(crate) fn invalidate_jobs(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }

    // The caller holds admission for read-modify-write operations.
    pub(super) fn load(&self, key: AtlasGenerationKey) -> Result<Option<MapState>, String> {
        let path = self.head_path(key);
        if !path.exists() {
            return Ok(None);
        }
        let head: Head = read(&path)?;
        for name in [&Some(head.current), &head.previous].into_iter().flatten() {
            if Path::new(name).file_name().and_then(|v| v.to_str()) != Some(name.as_str()) {
                return Err("Invalid Atlas map generation path".into());
            }
            if let Ok(state) = read::<MapState>(&self.root.join(name)) {
                if state.format_version == 1 && valid_state(&state) {
                    return Ok(Some(state));
                }
            }
        }
        Err(
            "Atlas map memory could not be recovered. Retained map files have been preserved."
                .into(),
        )
    }

    pub(super) fn save(&self, key: AtlasGenerationKey, state: &MapState) -> Result<(), String> {
        if !valid_state(state) {
            return Err("Invalid Atlas map geometry".into());
        }
        let path = self.head_path(key);
        let previous = if path.exists() {
            let head: Head = read(&path)?;
            std::iter::once(head.current)
                .chain(head.previous)
                .find(|name| {
                    Path::new(name).file_name().and_then(|v| v.to_str()) == Some(name.as_str())
                        && read::<MapState>(&self.root.join(name))
                            .is_ok_and(|s| s.format_version == 1 && valid_state(&s))
                })
        } else {
            None
        };
        let name = format!("map-{}.json", opaque_id()?);
        super::publication::atomic_write_json(&self.root.join(&name), state)?;
        super::publication::atomic_write_json(
            &path,
            &Head {
                current: name,
                previous,
            },
        )?;
        let _ = self.collect_metadata();
        Ok(())
    }

    fn collect_metadata(&self) -> Result<(), String> {
        let mut retain = HashSet::new();
        for visibility in [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ] {
            let path = self.head_path(AtlasGenerationKey {
                chat_visibility: visibility,
            });
            if path.exists() {
                let head: Head = read(&path)?;
                retain.insert(head.current);
                retain.extend(head.previous);
            }
        }
        for entry in std::fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("map-") && name.ends_with(".json") && !retain.contains(&name) {
                // Metadata collection cannot undo a committed head.
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(())
    }

    pub(super) fn referenced_artifacts(&self, cache: &Path) -> Result<HashSet<String>, String> {
        let mut files = HashSet::new();
        for visibility in [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ] {
            let path = self.head_path(AtlasGenerationKey {
                chat_visibility: visibility,
            });
            if !path.exists() {
                continue;
            }
            let head: Head = read(&path)?;
            for name in std::iter::once(head.current).chain(head.previous) {
                if let Ok(state) = read::<MapState>(&self.root.join(name)) {
                    if state.artifact_path.parent() == Some(cache) {
                        if let Some(file) = state.artifact_path.file_name() {
                            files.insert(file.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        Ok(files)
    }

    pub(crate) fn rename(
        &self,
        key: AtlasGenerationKey,
        id: &str,
        name: Option<String>,
    ) -> Result<AtlasCloudName, String> {
        let name = name.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        if name.as_ref().is_some_and(|v| {
            v.chars().count() > 80
                || v.chars()
                    .any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}')
        }) {
            return Err("Use a single-line cloud name of at most 80 characters.".into());
        }
        let _guard = self
            .admission
            .lock()
            .map_err(|_| "Atlas map admission unavailable")?;
        let mut state = self.load(key)?.ok_or("This map has no saved clouds yet")?;
        let cloud = state
            .clouds
            .iter_mut()
            .find(|c| c.active && c.id == id)
            .ok_or("This cloud is no longer present")?;
        cloud.user_name = name.clone();
        let label = name.clone().or_else(|| cloud.auto_name.clone());
        state.name_revision += 1;
        self.save(key, &state)?;
        Ok(AtlasCloudName {
            cloud_id: id.into(),
            user_name: name,
            label,
            name_revision: state.name_revision,
        })
    }

    pub(super) fn overlay(state: &MapState, response: &mut VaultAtlasResponse) {
        response.name_revision = state.name_revision;
        for cloud in &mut response.clouds {
            if let Some(saved) = state.clouds.iter().find(|c| c.active && c.id == cloud.id) {
                cloud.user_name = saved.user_name.clone();
                cloud.family_id = saved.family.clone();
                cloud.family_name = saved
                    .family
                    .as_ref()
                    .and_then(|id| state.clouds.iter().find(|c| &c.id == id))
                    .and_then(|c| c.user_name.clone().or_else(|| c.auto_name.clone()));
                if let Some(name) = saved.user_name.as_ref().or(saved.auto_name.as_ref()) {
                    cloud.label = Some(name.clone());
                    cloud.label_source = if saved.user_name.is_some() {
                        "user"
                    } else {
                        "topic"
                    }
                    .into();
                }
            }
        }
    }
}

fn valid_state(state: &MapState) -> bool {
    let mut ids = HashSet::new();
    state
        .nodes
        .iter()
        .all(|n| n.position.iter().all(|v| v.is_finite()))
        && state.clouds.iter().all(|c| {
            ids.insert(&c.id)
                && c.position.iter().all(|v| v.is_finite())
                && c.radius.is_finite()
                && c.hull.iter().flatten().all(|v| v.is_finite())
                && c.prototype
                    .iter()
                    .chain(&c.theme_prototype)
                    .chain(&c.name_prototype)
                    .all(|v| v.is_finite())
        })
}

fn read<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

pub(super) fn opaque_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub(super) fn identity(note_id: Option<&str>, path: &str) -> String {
    note_id
        .filter(|id| !id.is_empty())
        .map(|id| format!("identity:{id}"))
        .unwrap_or_else(|| format!("path:{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDir;
    use std::fs;
    #[test]
    fn recovery_keeps_last_valid_generation_after_a_second_failure() {
        let temp = TestDir::new("map-recovery");
        let store = AtlasMapStore::new(temp.path());
        let key = AtlasGenerationKey::default();
        let mut state = MapState {
            format_version: 1,
            generation: "a".into(),
            ..Default::default()
        };
        store.save(key, &state).unwrap();
        state.generation = "b".into();
        store.save(key, &state).unwrap();
        let head: Head = read(&store.head_path(key)).unwrap();
        fs::write(store.root.join(head.current), b"broken").unwrap();
        assert_eq!(store.load(key).unwrap().unwrap().generation, "a");
        state.generation = "c".into();
        store.save(key, &state).unwrap();
        let head: Head = read(&store.head_path(key)).unwrap();
        fs::write(store.root.join(head.current), b"broken").unwrap();
        assert_eq!(store.load(key).unwrap().unwrap().generation, "a");
    }
}
