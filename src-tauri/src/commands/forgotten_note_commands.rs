use super::index_bridge::{
    read_indexed_note_from_path, remove_notes_index_entry, upsert_notes_index_entry,
};
use super::{current_time_millis, ForgottenNoteSummary, RestoredForgottenNote};
use crate::{
    index::{build_indexed_note, AppState},
    note,
    path_utils::unique_path_in_dir,
    state::{
        forgotten_notes_root, read_state, validate_current_path, write_state,
        PersistedForgottenNote,
    },
};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

const FORGOTTEN_DAY_MILLIS: u64 = 24 * 60 * 60 * 1000;

#[tauri::command]
pub(crate) fn forget_note(
    state: State<'_, AppState>,
    current_path: Option<String>,
    retention_days: u32,
) -> Result<Option<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir(true)?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    let mut persisted_state = read_state(&notes_dir)?;

    if let Some(note_path) = current_path.as_ref() {
        validate_retention_days(retention_days)?;
        let previous_note = read_indexed_note_from_path(note_path)?;
        let forgotten_dir = forgotten_notes_root(&notes_dir);
        fs::create_dir_all(&forgotten_dir).map_err(|err| err.to_string())?;
        let forgotten_path = resolve_forgotten_target_path(&notes_dir, note_path);
        let forgotten_at_millis = current_time_millis()?;
        let forgotten_at_rfc3339 = note::current_timestamp_rfc3339()?;
        let purge_at_millis = forgotten_at_millis
            .saturating_add(u64::from(retention_days).saturating_mul(FORGOTTEN_DAY_MILLIS));
        let note_markdown = fs::read_to_string(note_path).map_err(|err| err.to_string())?;
        let forgotten_markdown = note::prepare_note_markdown(
            &note_markdown,
            Some(&note_markdown),
            Some(Some(forgotten_at_rfc3339)),
        )?
        .0;

        if note_path.exists() {
            crate::vault_watcher::record_self_save(note_path);
            crate::vault_watcher::record_self_save(&forgotten_path);
            fs::rename(note_path, &forgotten_path).map_err(|err| err.to_string())?;
            fs::write(&forgotten_path, &forgotten_markdown).map_err(|err| err.to_string())?;
        }

        super::reconcile_note_task_timestamps(
            &mut persisted_state,
            Some(note_path.as_path()),
            previous_note.as_ref(),
            None,
            None,
            current_time_millis()?,
        );
        let raw_path = note_path.to_string_lossy().into_owned();
        let note_id = previous_note
            .as_ref()
            .map(|note| note.note_id.clone())
            .or_else(|| note::note_id_from_path_or_markdown(Some(note_path), &note_markdown))
            .unwrap_or_default();
        if persisted_state.last_opened_note_id.as_deref() == Some(note_id.as_str()) {
            persisted_state.last_opened_note_id = None;
        }
        persisted_state
            .recent_note_ids
            .retain(|existing_note_id| existing_note_id != &note_id);
        persisted_state
            .forgotten_notes
            .push(PersistedForgottenNote {
                forgotten_path: forgotten_path.to_string_lossy().into_owned(),
                original_path: raw_path.clone(),
                title: previous_note
                    .as_ref()
                    .map(|note| note.title.clone())
                    .unwrap_or_else(|| {
                        note_path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned()
                    }),
                forgotten_at_millis,
                purge_after_days: retention_days,
                purge_at_millis,
            });
        state.semantic.queue_delete_note(note_path)?;
        let summary = build_forgotten_note_summary(
            persisted_state
                .forgotten_notes
                .last()
                .expect("forgotten note just inserted"),
        );
        write_state(&notes_dir, &persisted_state)?;
        remove_notes_index_entry(&state, note_path)?;
        return Ok(Some(summary));
    }

    write_state(&notes_dir, &persisted_state)?;
    Ok(None)
}

#[tauri::command]
pub(crate) fn list_forgotten_notes() -> Result<Vec<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir(true)?;

    let mut forgotten_notes = read_state(&notes_dir)?.forgotten_notes;
    forgotten_notes.sort_by(|left, right| {
        right
            .forgotten_at_millis
            .cmp(&left.forgotten_at_millis)
            .then_with(|| left.title.cmp(&right.title))
    });

    Ok(forgotten_notes
        .iter()
        .map(build_forgotten_note_summary)
        .collect())
}

#[tauri::command]
pub(crate) fn restore_forgotten_notes(
    state: State<'_, AppState>,
    forgotten_paths: Vec<String>,
) -> Result<Vec<RestoredForgottenNote>, String> {
    let notes_dir = super::prepare_notes_dir(true)?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut persisted_state = read_state(&notes_dir)?;
    let mut restored_notes = Vec::new();
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes.remove(index);
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if !forgotten_path.is_file() {
            write_state(&notes_dir, &persisted_state)?;
            continue;
        }

        let restored_path =
            resolve_restore_target_path(&notes_dir, Path::new(&forgotten_note.original_path));
        let markdown = fs::read_to_string(&forgotten_path).map_err(|err| err.to_string())?;
        let restored_markdown =
            note::prepare_note_markdown(&markdown, Some(&markdown), Some(None))?.0;
        let timestamp_millis = current_time_millis()?;
        crate::vault_watcher::record_self_save(&forgotten_path);
        crate::vault_watcher::record_self_save(&restored_path);
        fs::rename(&forgotten_path, &restored_path).map_err(|err| err.to_string())?;
        fs::write(&restored_path, &restored_markdown).map_err(|err| err.to_string())?;

        let note = build_indexed_note(&restored_path, &restored_markdown, timestamp_millis);
        upsert_notes_index_entry(&state, restored_path.clone(), note)?;
        state
            .semantic
            .queue_note_update(&restored_path, restored_markdown, timestamp_millis)?;

        restored_notes.push(RestoredForgottenNote {
            forgotten_path: forgotten_note.forgotten_path,
            restored_path: restored_path.to_string_lossy().into_owned(),
            title: forgotten_note.title,
        });
        write_state(&notes_dir, &persisted_state)?;
    }

    Ok(restored_notes)
}

#[tauri::command]
pub(crate) fn delete_forgotten_notes(forgotten_paths: Vec<String>) -> Result<(), String> {
    let notes_dir = super::prepare_notes_dir(true)?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(());
    }

    let mut persisted_state = read_state(&notes_dir)?;
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes.remove(index);
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if forgotten_path.exists() {
            fs::remove_file(&forgotten_path).map_err(|err| err.to_string())?;
        }
        write_state(&notes_dir, &persisted_state)?;
    }

    Ok(())
}

fn validate_retention_days(retention_days: u32) -> Result<(), String> {
    match retention_days {
        1 | 7 | 30 => Ok(()),
        _ => Err("Unsupported forgotten note retention window".to_string()),
    }
}

pub(super) fn build_forgotten_note_summary(
    forgotten_note: &PersistedForgottenNote,
) -> ForgottenNoteSummary {
    ForgottenNoteSummary {
        forgotten_path: forgotten_note.forgotten_path.clone(),
        original_path: forgotten_note.original_path.clone(),
        title: forgotten_note.title.clone(),
        file_name: Path::new(&forgotten_note.original_path)
            .file_stem()
            .unwrap_or_else(|| OsStr::new("untitled"))
            .to_string_lossy()
            .into_owned(),
        forgotten_at_millis: forgotten_note.forgotten_at_millis,
        purge_after_days: forgotten_note.purge_after_days,
        purge_at_millis: forgotten_note.purge_at_millis,
    }
}

fn validate_forgotten_path_inputs(
    forgotten_paths: Vec<String>,
    notes_dir: &Path,
) -> Result<HashSet<String>, String> {
    let forgotten_root = forgotten_notes_root(notes_dir);
    let mut selected = HashSet::new();

    for raw_path in forgotten_paths {
        let path = PathBuf::from(&raw_path);
        if !path.starts_with(&forgotten_root) {
            return Err("Forgotten note path is outside the forgotten notes directory".to_string());
        }
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err("Forgotten note path is not a markdown file".to_string());
        }
        selected.insert(raw_path);
    }

    Ok(selected)
}

fn resolve_forgotten_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    unique_path_in_dir(
        &forgotten_notes_root(notes_dir),
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
        "Untitled Note",
    )
}

fn resolve_restore_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    if original_path.parent() == Some(notes_dir) && !original_path.exists() {
        return original_path.to_path_buf();
    }

    unique_path_in_dir(
        notes_dir,
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
        "Untitled Note",
    )
}

pub(super) fn cleanup_expired_forgotten_notes(notes_dir: &Path) -> Result<(), String> {
    let now = current_time_millis()?;
    let mut persisted_state = read_state(notes_dir)?;
    let original_len = persisted_state.forgotten_notes.len();
    let mut kept_notes = Vec::with_capacity(original_len);

    for forgotten_note in persisted_state.forgotten_notes.drain(..) {
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        if forgotten_note.purge_at_millis <= now {
            if forgotten_path.exists() {
                fs::remove_file(&forgotten_path).map_err(|err| err.to_string())?;
            }
            continue;
        }
        kept_notes.push(forgotten_note);
    }

    if kept_notes.len() != original_len {
        persisted_state.forgotten_notes = kept_notes;
        write_state(notes_dir, &persisted_state)?;
    }

    Ok(())
}
