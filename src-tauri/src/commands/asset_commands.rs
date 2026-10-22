use super::{
    on_app_worker, prepare_notes_dir, StoredImageAsset, ASSETS_DIRECTORY_NAME,
    DEFAULT_PASTED_IMAGE_NAME,
};
use crate::index::AppState;
use crate::path_utils::unique_path_in_dir;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::{
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// The renderer and importer share this list with the native dialog filter.
const IMAGE_ASSET_TYPES: &[(&str, &str)] = &[
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("gif", "image/gif"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("svg", "image/svg+xml"),
    ("webp", "image/webp"),
];

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedImageFile {
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

/// Selection and reading are one read-only operation. No renderer-provided path
/// is accepted, and importing still goes through the existing upload owner.
#[tauri::command]
pub(crate) async fn choose_image_files<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    _window: tauri::Window<R>,
) -> Result<Option<Vec<PickedImageFile>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let extensions = IMAGE_ASSET_TYPES
            .iter()
            .map(|(extension, _)| *extension)
            .collect::<Vec<_>>();
        let dialog = app.dialog().file();
        #[cfg(desktop)]
        let dialog = dialog.set_parent(&_window);
        let Some(paths) = dialog
            .set_title("Choose images")
            .add_filter("Images", &extensions)
            .blocking_pick_files()
        else {
            return Ok(None);
        };
        let images = paths
            .into_iter()
            .map(|path| {
                let path = path.into_path().map_err(|error| error.to_string())?;
                read_picked_image(&path)
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Some(images))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read_picked_image(path: &Path) -> Result<PickedImageFile, String> {
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "Selected image is missing a file name".to_string())?;
    let mime_type = asset_extension_from_name(name)
        .and_then(image_mime_from_extension)
        .ok_or_else(|| "Choose an AVIF, BMP, GIF, JPEG, PNG, SVG or WebP image".to_string())?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("Selected image is empty".into());
    }
    Ok(PickedImageFile {
        name: name.into(),
        mime_type: mime_type.into(),
        bytes,
    })
}

#[tauri::command]
pub(crate) async fn read_image_asset_fingerprint<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    file_name: String,
) -> Result<String, String> {
    on_app_worker(app, move |state| {
        let assets_dir = state.running_vault().root().join(ASSETS_DIRECTORY_NAME);
        image_asset_metadata(&assets_dir, &file_name).map(|(_, fingerprint)| fingerprint)
    })
    .await?
}

fn image_asset_metadata(assets_dir: &Path, file_name: &str) -> Result<(PathBuf, String), String> {
    let path = resolve_asset_image_path(&assets_dir, &file_name)?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_nanos();
    Ok((path, format!("{}:{modified}", metadata.len())))
}

/// Admit one contained asset, then let Tauri's async protocol deliver its bytes.
/// Metadata/versioning is resolved off the IPC executor; no image bytes cross JSON.
#[tauri::command]
pub(crate) async fn resolve_image_asset_url<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    webview: tauri::Webview<R>,
    file_name: String,
) -> Result<String, String> {
    let (path, fingerprint) = on_app_worker(app.clone(), move |state| {
        image_asset_metadata(
            &state.running_vault().root().join(ASSETS_DIRECTORY_NAME),
            &file_name,
        )
    })
    .await??;
    let url = webview
        .convert_file_src(&path, None)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    // Distinct versions must not reuse the WebView's old decoded image.
    Ok(format!("{url}?v={fingerprint}"))
}

#[tauri::command]
pub(crate) fn read_image_asset_data_url(
    state: tauri::State<'_, AppState>,
    file_name: String,
) -> Result<String, String> {
    let notes_dir = prepare_notes_dir(&state, false)?;
    let assets_dir = notes_dir.join(ASSETS_DIRECTORY_NAME);
    read_image_asset_data_url_from_assets_dir(&assets_dir, &file_name)
}

#[tauri::command]
pub(crate) fn store_pasted_image(
    state: tauri::State<'_, AppState>,
    bytes: Vec<u8>,
    original_name: Option<String>,
    mime_type: Option<String>,
) -> Result<StoredImageAsset, String> {
    if bytes.is_empty() {
        return Err("Pasted image is empty".to_string());
    }

    let notes_dir = prepare_notes_dir(&state, false)?;
    let assets_dir = notes_dir.join(ASSETS_DIRECTORY_NAME);
    fs::create_dir_all(&assets_dir).map_err(|err| err.to_string())?;

    let target_path = write_new_image_asset(
        &assets_dir,
        &bytes,
        original_name.as_deref(),
        mime_type.as_deref(),
    )?;

    Ok(StoredImageAsset {
        file_name: target_path
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| "Saved image is missing a file name".to_string())?
            .to_string(),
        file_path: target_path.to_string_lossy().into_owned(),
    })
}

fn write_new_image_asset(
    assets_dir: &Path,
    bytes: &[u8],
    original_name: Option<&str>,
    mime_type: Option<&str>,
) -> Result<PathBuf, String> {
    loop {
        let path = resolve_pasted_image_path(assets_dir, original_name, mime_type);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(error.to_string());
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
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

pub(super) use crate::asset_paths::resolve_asset_image_path;

pub(super) fn mime_type_from_asset_name(file_name: &str) -> &'static str {
    let extension = asset_extension_from_name(file_name).unwrap_or("png");
    image_mime_from_extension(extension).unwrap_or("application/octet-stream")
}

fn image_mime_from_extension(extension: &str) -> Option<&'static str> {
    IMAGE_ASSET_TYPES
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(extension))
        .map(|(_, mime)| *mime)
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
    let mime_type = mime_type.trim();
    if mime_type.eq_ignore_ascii_case("image/jpg") {
        return Some("jpg");
    }
    IMAGE_ASSET_TYPES
        .iter()
        .find(|(_, mime)| mime.eq_ignore_ascii_case(mime_type))
        .map(|(extension, _)| *extension)
}

#[cfg(test)]
mod helper_tests;
