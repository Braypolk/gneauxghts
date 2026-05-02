use super::index_bridge::{
    read_indexed_note_from_path, remove_notes_index_entry, upsert_notes_index_entry,
};
use super::{current_time_millis, prepare_notes_dir, NoteSession};
use crate::{
    index::{build_indexed_note, AppState},
    note,
    state::{persist_note, read_state, touch_recent_note_id, validate_current_path, write_state},
};
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Clone, Debug)]
pub(crate) struct PersistNoteOutcome {
    pub(crate) session: Option<NoteSession>,
    pub(crate) persisted_path: Option<String>,
    pub(crate) persisted_markdown: Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) enum NotePersistenceMode {
    Save,
    Remember,
}

fn read_saved_markdown(persisted_path: Option<&str>) -> Result<Option<String>, String> {
    persisted_path
        .map(|path| std::fs::read_to_string(path).map_err(|err| err.to_string()))
        .transpose()
}

fn build_next_note(
    mode: NotePersistenceMode,
    persisted_path: Option<&str>,
    persisted_markdown: Option<&str>,
    original_markdown: &str,
    timestamp_millis: u64,
) -> Option<crate::index::IndexedNote> {
    match mode {
        NotePersistenceMode::Save => {
            persisted_path
                .zip(persisted_markdown)
                .map(|(path, markdown)| {
                    build_indexed_note(Path::new(path), markdown, timestamp_millis)
                })
        }
        NotePersistenceMode::Remember => persisted_path
            .map(|path| build_indexed_note(Path::new(path), original_markdown, timestamp_millis)),
    }
}

fn compute_sync_markdown(
    mode: NotePersistenceMode,
    persisted_markdown: Option<&str>,
    persisted_path: Option<&str>,
) -> Result<Option<String>, String> {
    match (mode, persisted_markdown, persisted_path) {
        (NotePersistenceMode::Save, markdown, _) => Ok(markdown.map(ToOwned::to_owned)),
        (NotePersistenceMode::Remember, _, Some(path)) => Ok(Some(
            std::fs::read_to_string(path).map_err(|err| err.to_string())?,
        )),
        (NotePersistenceMode::Remember, _, None) => Ok(None),
    }
}

fn file_stem_title(path: Option<&str>) -> Option<String> {
    path.and_then(|raw_path| Path::new(raw_path).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned())
}

fn build_saved_note_session(
    note_id: Option<String>,
    title: &str,
    markdown: &str,
    persisted_path: Option<String>,
    persisted_markdown: Option<&str>,
) -> NoteSession {
    let fallback_title = file_stem_title(persisted_path.as_deref()).unwrap_or_default();
    NoteSession {
        note_id,
        title: if fallback_title.is_empty() {
            title.trim().to_string()
        } else {
            fallback_title.clone()
        },
        markdown: persisted_markdown
            .map(|saved| note::extract_file_name_title_and_body(saved, &fallback_title).1)
            .unwrap_or_else(|| note::normalize_wikilink_markdown(markdown)),
        path: persisted_path,
    }
}

#[allow(dead_code)]
pub(crate) fn persist_note_session(
    state: &State<'_, AppState>,
    title: String,
    markdown: String,
    current_path: Option<String>,
    mode: NotePersistenceMode,
) -> Result<Option<NoteSession>, String> {
    Ok(persist_note_session_with_outcome(state, title, markdown, current_path, mode)?.session)
}

pub(crate) fn persist_note_session_with_outcome(
    state: &State<'_, AppState>,
    title: String,
    markdown: String,
    current_path: Option<String>,
    mode: NotePersistenceMode,
) -> Result<PersistNoteOutcome, String> {
    // Save is a hot path; the throttled forgotten-note cleanup runs from
    // explicit forgotten-note commands and at startup instead.
    let notes_dir = prepare_notes_dir(false)?;
    let current_path = validate_current_path(current_path, &notes_dir)?;
    let previous_note = current_path
        .as_deref()
        .map(read_indexed_note_from_path)
        .transpose()?
        .flatten();
    let persisted_path = match mode {
        NotePersistenceMode::Save => {
            persist_note(&notes_dir, &title, &markdown, current_path.as_deref())?
        }
        NotePersistenceMode::Remember => {
            if !title.trim().is_empty() || !markdown.trim().is_empty() || current_path.is_some() {
                persist_note(&notes_dir, &title, &markdown, current_path.as_deref())?
            } else {
                None
            }
        }
    };
    let timestamp_millis = current_time_millis()?;
    let persisted_markdown = match mode {
        NotePersistenceMode::Save => read_saved_markdown(persisted_path.as_deref())?,
        NotePersistenceMode::Remember => None,
    };
    let next_note = build_next_note(
        mode,
        persisted_path.as_deref(),
        persisted_markdown.as_deref(),
        &markdown,
        timestamp_millis,
    );

    let mut persisted_state = read_state(&notes_dir)?;
    persisted_state.last_opened_note_id = match mode {
        NotePersistenceMode::Save => next_note.as_ref().map(|note| note.note_id.clone()),
        NotePersistenceMode::Remember => None,
    };
    if let Some(note) = next_note.as_ref() {
        touch_recent_note_id(&mut persisted_state, note.note_id.clone());
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

    let removed_previous_path = current_path
        .as_deref()
        .filter(|previous_path| note_path_changed(previous_path, persisted_path.as_deref()));

    if let (Some(path), Some(next_note)) = (persisted_path.as_deref(), next_note.as_ref()) {
        upsert_notes_index_entry(state, PathBuf::from(path), next_note.clone())?;
    }
    if let Some(previous_path) = removed_previous_path {
        remove_notes_index_entry(state, previous_path)?;
    }

    let sync_markdown = compute_sync_markdown(
        mode,
        persisted_markdown.as_deref(),
        persisted_path.as_deref(),
    )?;

    if let (Some(path), Some(sync_markdown)) = (persisted_path.as_deref(), sync_markdown.as_deref())
    {
        state.semantic.queue_note_update(
            Path::new(path),
            sync_markdown.to_string(),
            timestamp_millis,
        )?;
    }
    if let Some(previous_path) = removed_previous_path {
        state.semantic.queue_delete_note(previous_path)?;
    }

    let session = match mode {
        NotePersistenceMode::Save => Some(build_saved_note_session(
            next_note.as_ref().map(|note| note.note_id.clone()),
            &title,
            &markdown,
            persisted_path.clone(),
            persisted_markdown.as_deref(),
        )),
        NotePersistenceMode::Remember => None,
    };

    Ok(PersistNoteOutcome {
        session,
        persisted_path,
        persisted_markdown: sync_markdown,
    })
}

fn note_path_changed(previous_path: &Path, next_path: Option<&str>) -> bool {
    let previous_raw_path = previous_path.to_string_lossy();
    next_path != Some(previous_raw_path.as_ref())
}
