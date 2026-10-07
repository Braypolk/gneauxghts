//! Contained local image assets, shared by rendering and semantic indexing.
use std::path::{Path, PathBuf};

pub(crate) fn resolve_asset_image_path(
    assets_dir: &Path,
    file_name: &str,
) -> Result<PathBuf, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Image asset name is empty".to_string());
    }

    let file_path = Path::new(trimmed);
    if trimmed.contains(['\\', ':'])
        || !file_path
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
    {
        return Err("Image asset path must be relative to the assets folder".to_string());
    }

    let asset_path = assets_dir.join(trimmed);
    if !asset_path.is_file() {
        return Err("Image asset was not found".to_string());
    }

    let root = assets_dir.canonicalize().map_err(|err| err.to_string())?;
    let canonical = asset_path.canonicalize().map_err(|err| err.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("Image asset is outside the assets folder".to_string());
    }
    Ok(canonical)
}
