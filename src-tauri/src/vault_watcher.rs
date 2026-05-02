use crate::{
    app::AppData,
    index::AppState,
    state::{is_forgotten_note_path, notes_root},
    time::current_time_millis,
};
use notify::{
    event::ModifyKind, Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode,
    Watcher,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

/// How often the background reconciliation loop sweeps the vault on disk
/// to catch any events the file-system watcher may have missed. The
/// foreground hot path (search/recents/wikilinks) never blocks on this
/// scan; it only consumes the watcher dirty-path queue.
const BACKGROUND_RECONCILE_INTERVAL: Duration = Duration::from_secs(60);

/// Window during which a watcher event for a path written by this app is
/// treated as a self-save and ignored. The watcher would otherwise re-read
/// the file, queue a redundant semantic indexing job, mark the in-memory
/// index dirty, and emit a frontend event for our own write.
const SELF_SAVE_DEDUPE_WINDOW: Duration = Duration::from_millis(2_500);

static RECENT_SELF_SAVES: Mutex<Option<HashMap<PathBuf, Instant>>> = Mutex::new(None);

/// Mark `path` as recently written by the app itself. Subsequent watcher
/// events that arrive within [`SELF_SAVE_DEDUPE_WINDOW`] for the same path
/// are skipped.
pub(crate) fn record_self_save(path: &Path) {
    let now = Instant::now();
    let Ok(mut guard) = RECENT_SELF_SAVES.lock() else {
        return;
    };
    let entry = guard.get_or_insert_with(HashMap::new);
    prune_self_save_map(entry, now);
    entry.insert(path.to_path_buf(), now);
}

fn consume_self_save(path: &Path) -> bool {
    let now = Instant::now();
    let Ok(mut guard) = RECENT_SELF_SAVES.lock() else {
        return false;
    };
    let Some(entry) = guard.as_mut() else {
        return false;
    };
    prune_self_save_map(entry, now);
    if let Some(stamp) = entry.get(path) {
        if now.duration_since(*stamp) <= SELF_SAVE_DEDUPE_WINDOW {
            // Leave the entry in place: a single save on disk often produces
            // multiple `notify` events (Create + Modify(Data) + Modify(Any))
            // and we want to swallow all of them inside the window.
            return true;
        }
    }
    false
}

fn prune_self_save_map(entry: &mut HashMap<PathBuf, Instant>, now: Instant) {
    entry.retain(|_, stamp| now.duration_since(*stamp) <= SELF_SAVE_DEDUPE_WINDOW);
}

#[allow(dead_code)]
pub(crate) struct VaultWatcherHandle {
    watcher: RecommendedWatcher,
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
    spawn_background_reconcile_loop(app_handle);
    Ok(VaultWatcherHandle { watcher })
}

/// Periodic full-vault rescan that runs entirely off the request path.
/// Catches up on file-system events the OS watcher dropped (e.g. on
/// network shares, large bursts) without ever blocking a search or focus
/// command. The thread is detached: it lives for the rest of the
/// process and exits naturally when the host process tears down.
fn spawn_background_reconcile_loop(app_handle: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(BACKGROUND_RECONCILE_INTERVAL);
        let Some(state) = app_handle.try_state::<crate::index::AppState>() else {
            continue;
        };
        let Ok(notes_dir) = notes_root() else {
            continue;
        };
        if !notes_dir.exists() {
            continue;
        }
        if let Err(error) = state.reconcile_full_vault_scan(&notes_dir) {
            eprintln!("vault reconcile error: {error}");
        }
    });
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
        if consume_self_save(&path) {
            // The app just wrote this file itself; the in-memory index has
            // already been updated and the semantic queue already has the
            // post-save markdown. Skip the redundant reread and event
            // amplification.
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
    if let Some(app_data) = app_handle.try_state::<AppData>() {
        app_data.events.vault_note_changed(path, deleted);
    }
    Ok(())
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
