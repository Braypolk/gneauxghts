use super::{
    current_time_millis, prepare_notes_dir, read_indexed_note_from_path, remove_notes_index_entry,
    upsert_notes_index_entry, NoteSession,
};
use crate::{
    index::{build_indexed_note, AppState},
    note,
    state::{persist_note, read_state, touch_recent_path, validate_current_path, write_state},
    sync,
};
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Clone, Copy)]
pub(super) enum NotePersistenceMode {
    Save,
    Remember,
}

pub(super) fn persist_note_session(
    state: &State<'_, AppState>,
    markdown: String,
    current_path: Option<String>,
    mode: NotePersistenceMode,
) -> Result<Option<NoteSession>, String> {
    let notes_dir = prepare_notes_dir(true)?;
    let current_path = validate_current_path(current_path, &notes_dir)?;
    let previous_note = current_path
        .as_deref()
        .map(read_indexed_note_from_path)
        .transpose()?
        .flatten();
    let persisted_path = match mode {
        NotePersistenceMode::Save => persist_note(&notes_dir, &markdown, current_path.as_deref())?,
        NotePersistenceMode::Remember => {
            if !markdown.trim().is_empty() || current_path.is_some() {
                persist_note(&notes_dir, &markdown, current_path.as_deref())?
            } else {
                None
            }
        }
    };
    let timestamp_millis = current_time_millis()?;
    let persisted_markdown = match mode {
        NotePersistenceMode::Save => persisted_path
            .as_deref()
            .map(|path| std::fs::read_to_string(path).map_err(|err| err.to_string()))
            .transpose()?,
        NotePersistenceMode::Remember => None,
    };
    let next_note = match mode {
        NotePersistenceMode::Save => persisted_path
            .as_deref()
            .zip(persisted_markdown.as_deref())
            .map(|(path, markdown)| {
                build_indexed_note(Path::new(path), markdown, timestamp_millis)
            }),
        NotePersistenceMode::Remember => persisted_path
            .as_deref()
            .map(|path| build_indexed_note(Path::new(path), &markdown, timestamp_millis)),
    };

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_path = match mode {
        NotePersistenceMode::Save => persisted_path.clone(),
        NotePersistenceMode::Remember => None,
    };
    if let Some(path) = persisted_path.as_ref() {
        touch_recent_path(&mut persisted_state, Path::new(path));
    }
    super::reconcile_note_task_timestamps(
        &mut persisted_state,
        current_path.as_deref(),
        previous_note.as_ref(),
        persisted_path.as_deref().map(Path::new),
        next_note.as_ref(),
        timestamp_millis,
    );
    write_state(&notes_dir, &persisted_state)?;

    if let (Some(path), Some(next_note)) = (persisted_path.as_deref(), next_note.as_ref()) {
        upsert_notes_index_entry(state, PathBuf::from(path), next_note.clone())?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        if note_path_changed(previous_path, persisted_path.as_deref()) {
            remove_notes_index_entry(state, previous_path)?;
        }
    }

    let sync_markdown = match (
        mode,
        persisted_markdown.as_deref(),
        persisted_path.as_deref(),
    ) {
        (NotePersistenceMode::Save, markdown, _) => markdown.map(ToOwned::to_owned),
        (NotePersistenceMode::Remember, _, Some(path)) => {
            Some(std::fs::read_to_string(path).map_err(|err| err.to_string())?)
        }
        (NotePersistenceMode::Remember, _, None) => None,
    };

    if let (Some(path), Some(sync_markdown)) = (persisted_path.as_deref(), sync_markdown.as_deref())
    {
        sync::mark_note_dirty(Path::new(path), sync_markdown)?;
        state.semantic.queue_note_update(
            Path::new(path),
            sync_markdown.to_string(),
            timestamp_millis,
        )?;
    }
    if let Some(previous_path) = current_path.as_deref() {
        if note_path_changed(previous_path, persisted_path.as_deref()) {
            state.semantic.queue_delete_note(previous_path)?;
        }
    }

    match mode {
        NotePersistenceMode::Save => Ok(Some(NoteSession {
            markdown: persisted_markdown
                .as_deref()
                .map(note::strip_frontmatter)
                .unwrap_or_else(|| note::normalize_wikilink_markdown(&markdown)),
            path: persisted_path,
        })),
        NotePersistenceMode::Remember => Ok(None),
    }
}

fn note_path_changed(previous_path: &Path, next_path: Option<&str>) -> bool {
    let previous_raw_path = previous_path.to_string_lossy();
    next_path != Some(previous_raw_path.as_ref())
}
