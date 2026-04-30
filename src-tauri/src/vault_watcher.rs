use crate::{
    index::AppState,
    state::{is_forgotten_note_path, notes_root},
    time::current_time_millis,
};
use notify::{
    event::ModifyKind, Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode,
    Watcher,
};
use serde::Serialize;
use std::{collections::HashSet, fs, path::Path};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const VAULT_NOTE_CHANGED_EVENT: &str = "vault-note-changed";

#[allow(dead_code)]
pub(crate) struct VaultWatcherHandle {
    watcher: RecommendedWatcher,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultNoteChangeEvent {
    note_path: String,
    deleted: bool,
}

pub(crate) fn start_vault_watcher(app_handle: AppHandle) -> Result<VaultWatcherHandle, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;
    let callback_handle = app_handle.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            if let Err(error) = handle_watch_result(&callback_handle, result) {
                eprintln!("vault watcher error: {error}");
            }
        },
        NotifyConfig::default(),
    )
    .map_err(|err| err.to_string())?;
    watcher
        .watch(&notes_dir, RecursiveMode::Recursive)
        .map_err(|err| err.to_string())?;
    Ok(VaultWatcherHandle { watcher })
}

fn handle_watch_result(
    app_handle: &AppHandle,
    result: notify::Result<Event>,
) -> Result<(), String> {
    let event = match result {
        Ok(event) => event,
        Err(error) => return Err(error.to_string()),
    };
    if !should_process_watch_event(&event.kind) {
        return Ok(());
    }

    let notes_dir = notes_root()?;
    let Some(state) = app_handle.try_state::<AppState>() else {
        return Ok(());
    };
    let mut seen_paths = HashSet::new();

    for path in event.paths {
        if !seen_paths.insert(path.clone()) || !is_watchable_markdown_path(&path, &notes_dir) {
            continue;
        }
        handle_watched_path_change(app_handle, &state, &notes_dir, &path)?;
    }

    Ok(())
}

fn should_process_watch_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Remove(_)
    )
}

fn is_watchable_markdown_path(path: &Path, notes_dir: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        && !is_forgotten_note_path(path, notes_dir)
}

fn handle_watched_path_change(
    app_handle: &AppHandle,
    state: &AppState,
    notes_dir: &Path,
    path: &Path,
) -> Result<(), String> {
    let deleted = !path.exists() || is_forgotten_note_path(path, notes_dir);

    if deleted {
        state.semantic.queue_delete_note(path)?;
    } else {
        let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
        state
            .semantic
            .queue_note_update(path, markdown, current_time_millis()?)?;
    }

    state.mark_notes_index_dirty(path, "watcher")?;
    app_handle
        .emit(
            VAULT_NOTE_CHANGED_EVENT,
            VaultNoteChangeEvent {
                note_path: path.to_string_lossy().into_owned(),
                deleted,
            },
        )
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_watchable_markdown_path, should_process_watch_event};
    use notify::{
        event::{CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind, RenameMode},
        EventKind,
    };
    use std::path::Path;

    #[test]
    fn ignores_metadata_only_changes() {
        assert!(!should_process_watch_event(&EventKind::Modify(
            ModifyKind::Metadata(MetadataKind::Any),
        )));
    }

    #[test]
    fn keeps_processing_content_and_lifecycle_changes() {
        assert!(should_process_watch_event(&EventKind::Create(
            CreateKind::Any,
        )));
        assert!(should_process_watch_event(&EventKind::Modify(
            ModifyKind::Data(DataChange::Any),
        )));
        assert!(should_process_watch_event(&EventKind::Modify(
            ModifyKind::Name(RenameMode::Any),
        )));
        assert!(should_process_watch_event(&EventKind::Modify(
            ModifyKind::Any,
        )));
        assert!(should_process_watch_event(&EventKind::Remove(
            RemoveKind::Any,
        )));
    }

    #[test]
    fn ignores_forgotten_note_paths() {
        let notes_dir = Path::new("/tmp/Gneauxghts");
        let forgotten_note = Path::new("/tmp/Gneauxghts/.forgotten/Archived Note.md");
        let active_note = Path::new("/tmp/Gneauxghts/Active Note.md");

        assert!(!is_watchable_markdown_path(forgotten_note, notes_dir));
        assert!(is_watchable_markdown_path(active_note, notes_dir));
    }
}
