use super::{prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE};
use crate::{
    index::{normalize_search_text, AppState, IndexedNote},
    semantic::atlas::{AtlasHardLink, AtlasNoteMetadata, VaultAtlasResponse},
    state::db_load_note_activity,
};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use tauri::State;

#[tauri::command]
pub(crate) async fn get_vault_atlas(
    state: State<'_, AppState>,
) -> Result<VaultAtlasResponse, String> {
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "get_vault_atlas",
    )?;

    let (metadata, hard_links) = {
        let index = state
            .notes_index
            .lock()
            .map_err(|_| "Search index lock poisoned".to_string())?;
        let metadata = build_metadata(&index.entries);
        let hard_links = build_hard_links(&index.entries, &metadata);
        (metadata, hard_links)
    };
    let last_viewed_by_note_id = db_load_note_activity()?;
    let semantic = state.semantic.clone();

    tauri::async_runtime::spawn_blocking(move || {
        semantic.vault_atlas(metadata, hard_links, last_viewed_by_note_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn build_metadata(entries: &HashMap<PathBuf, IndexedNote>) -> HashMap<String, AtlasNoteMetadata> {
    entries
        .iter()
        .map(|(path, note)| {
            let note_path = path.to_string_lossy().into_owned();
            (
                note_path.clone(),
                AtlasNoteMetadata {
                    note_id: Some(note.note_id.clone()),
                    note_path,
                    file_name: note.file_name.clone(),
                    title: note.title.clone(),
                },
            )
        })
        .collect()
}

fn build_hard_links(
    entries: &HashMap<PathBuf, IndexedNote>,
    metadata: &HashMap<String, AtlasNoteMetadata>,
) -> Vec<AtlasHardLink> {
    let mut title_to_path = HashMap::<String, String>::new();
    for note in metadata.values() {
        for reference in [
            normalize_reference(&note.title),
            normalize_reference(&note.file_name),
            normalize_reference(
                Path::new(&note.file_name)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .as_ref(),
            ),
        ] {
            if !reference.is_empty() {
                title_to_path.insert(reference, note.note_path.clone());
            }
        }
    }

    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for (path, note) in entries {
        let source_note_path = path.to_string_lossy().into_owned();
        for target in extract_wikilink_targets(note) {
            let Some(target_note_path) = title_to_path.get(&normalize_reference(&target)) else {
                continue;
            };
            if target_note_path == &source_note_path {
                continue;
            }
            let key = if source_note_path <= *target_note_path {
                format!("{source_note_path}\0{target_note_path}")
            } else {
                format!("{target_note_path}\0{source_note_path}")
            };
            if !seen.insert(key) {
                continue;
            }
            links.push(AtlasHardLink {
                source_note_path: source_note_path.clone(),
                target_note_path: target_note_path.clone(),
            });
        }
    }
    links
}

fn extract_wikilink_targets(note: &IndexedNote) -> Vec<String> {
    let mut targets = Vec::new();
    for paragraph in &note.paragraphs {
        collect_wikilink_targets(&paragraph.text, &mut targets);
    }
    for task in &note.tasks {
        collect_wikilink_targets(&task.text, &mut targets);
    }
    targets
}

fn collect_wikilink_targets(text: &str, targets: &mut Vec<String>) {
    let mut remaining = text;
    while let Some(start) = remaining.find("[[") {
        let after_start = &remaining[start + 2..];
        let Some(end) = after_start.find("]]") else {
            break;
        };
        let raw = &after_start[..end];
        let target = raw
            .split_once('|')
            .map(|(target, _)| target)
            .unwrap_or(raw)
            .split_once('#')
            .map(|(target, _)| target)
            .unwrap_or(raw)
            .trim();
        if !target.is_empty() && !target.contains('/') && !target.contains('\\') {
            targets.push(target.to_string());
        }
        remaining = &after_start[end + 2..];
    }
}

fn normalize_reference(value: &str) -> String {
    let without_extension = value
        .trim()
        .strip_suffix(".md")
        .or_else(|| value.trim().strip_suffix(".MD"))
        .unwrap_or_else(|| value.trim());
    normalize_search_text(without_extension)
}
