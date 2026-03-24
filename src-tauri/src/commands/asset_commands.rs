use super::{
    prepare_notes_dir, StoredImageAsset, ASSETS_DIRECTORY_NAME, DEFAULT_PASTED_IMAGE_NAME,
};
use crate::path_utils::unique_path_in_dir;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};

#[tauri::command]
pub(crate) fn read_image_asset_data_url(file_name: String) -> Result<String, String> {
    let notes_dir = prepare_notes_dir(false)?;
    let assets_dir = notes_dir.join(ASSETS_DIRECTORY_NAME);
    read_image_asset_data_url_from_assets_dir(&assets_dir, &file_name)
}

#[tauri::command]
pub(crate) fn store_pasted_image(
    bytes: Vec<u8>,
    original_name: Option<String>,
    mime_type: Option<String>,
) -> Result<StoredImageAsset, String> {
    if bytes.is_empty() {
        return Err("Pasted image is empty".to_string());
    }

    let notes_dir = prepare_notes_dir(false)?;
    let assets_dir = notes_dir.join(ASSETS_DIRECTORY_NAME);
    fs::create_dir_all(&assets_dir).map_err(|err| err.to_string())?;

    let target_path =
        resolve_pasted_image_path(&assets_dir, original_name.as_deref(), mime_type.as_deref());
    fs::write(&target_path, bytes).map_err(|err| err.to_string())?;

    Ok(StoredImageAsset {
        file_name: target_path
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| "Saved image is missing a file name".to_string())?
            .to_string(),
        file_path: target_path.to_string_lossy().into_owned(),
    })
}

pub(super) fn read_image_asset_data_url_from_assets_dir(
    assets_dir: &Path,
    file_name: &str,
) -> Result<String, String> {
    let asset_path = resolve_asset_image_path(assets_dir, file_name)?;
    let asset_bytes = fs::read(&asset_path).map_err(|err| err.to_string())?;
    let mime_type = mime_type_from_asset_name(file_name);
    Ok(format!(
        "data:{mime_type};base64,{}",
        BASE64_STANDARD.encode(asset_bytes)
    ))
}

pub(super) fn resolve_asset_image_path(
    assets_dir: &Path,
    file_name: &str,
) -> Result<PathBuf, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Image asset name is empty".to_string());
    }

    let file_path = Path::new(trimmed);
    if file_path.components().count() != 1
        || file_path.file_name().and_then(OsStr::to_str) != Some(trimmed)
    {
        return Err("Image asset path must be a file name".to_string());
    }

    let asset_path = assets_dir.join(trimmed);
    if !asset_path.is_file() {
        return Err("Image asset was not found".to_string());
    }

    Ok(asset_path)
}

pub(super) fn mime_type_from_asset_name(file_name: &str) -> &'static str {
    match asset_extension_from_name(file_name)
        .unwrap_or("png")
        .to_ascii_lowercase()
        .as_str()
    {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

pub(super) fn resolve_pasted_image_path(
    assets_dir: &Path,
    original_name: Option<&str>,
    mime_type: Option<&str>,
) -> PathBuf {
    let sanitized_stem = original_name
        .map(sanitize_asset_file_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| DEFAULT_PASTED_IMAGE_NAME.to_string());
    let extension = original_name
        .and_then(asset_extension_from_name)
        .or_else(|| mime_type.and_then(asset_extension_from_mime_type))
        .unwrap_or("png");

    unique_path_in_dir(
        assets_dir,
        OsStr::new(&format!("{sanitized_stem}.{extension}")),
        DEFAULT_PASTED_IMAGE_NAME,
    )
}

pub(super) fn sanitize_asset_file_stem(name: &str) -> String {
    let candidate = Path::new(name)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or(name)
        .trim();
    let mut sanitized = String::new();
    let mut previous_was_space = false;

    for ch in candidate.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            _ => ch,
        };

        if mapped.is_control() {
            continue;
        }

        if mapped.is_whitespace() {
            if previous_was_space {
                continue;
            }

            sanitized.push(' ');
            previous_was_space = true;
            continue;
        }

        sanitized.push(mapped);
        previous_was_space = false;
    }

    sanitized.trim().trim_matches('.').to_string()
}

fn asset_extension_from_name(name: &str) -> Option<&str> {
    Path::new(name)
        .extension()
        .and_then(OsStr::to_str)
        .map(str::trim)
        .filter(|extension| !extension.is_empty())
        .map(|extension| {
            if extension.eq_ignore_ascii_case("jpeg") {
                "jpg"
            } else {
                extension
            }
        })
}

pub(super) fn asset_extension_from_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/avif" => Some("avif"),
        "image/bmp" => Some("bmp"),
        "image/gif" => Some("gif"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/svg+xml" => Some("svg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}
