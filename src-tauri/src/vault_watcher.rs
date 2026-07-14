use crate::{
    app::AppData,
    chat::ChatService,
    index::AppState,
    semantic::db::content_hash,
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
    sync::{Condvar, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

/// Quiet window: once watcher events stop arriving for a path burst, wait this
/// long with no new events before flushing the batch. Coalesces editor saves,
/// sync pulls, and bulk operations (git checkout, find-and-replace) into a
/// single indexing pass instead of one job per file event.
const DEBOUNCE_QUIET_WINDOW: Duration = Duration::from_millis(300);

/// Maximum time a path may sit dirty before we flush regardless of ongoing
/// activity. Guarantees forward progress during a continuous event stream that
/// never goes quiet for [`DEBOUNCE_QUIET_WINDOW`].
const DEBOUNCE_MAX_WAIT: Duration = Duration::from_millis(2_000);

/// Adaptive reconcile bounds. The background full-vault sweep catches events the
/// OS watcher dropped. It runs frequently right after activity (when drift is
/// most likely) and backs off toward [`RECONCILE_INTERVAL_MAX`] while the vault
/// is quiet, keeping idle overhead low on large vaults.
const RECONCILE_INTERVAL_MIN: Duration = Duration::from_secs(15);
const RECONCILE_INTERVAL_MAX: Duration = Duration::from_secs(300);
/// How recently activity must have occurred for the reconcile loop to stay at
/// its tightest interval. After this much idle time it begins backing off.
const RECONCILE_ACTIVE_WINDOW: Duration = Duration::from_secs(120);

/// Window during which a watcher event for a path written by this app is
/// treated as a self-save and ignored. The watcher would otherwise re-read
/// the file, queue a redundant semantic indexing job, mark the in-memory
/// index dirty, and emit a frontend event for our own write.
const SELF_SAVE_DEDUPE_WINDOW: Duration = Duration::from_millis(2_500);

#[derive(Clone, Debug)]
struct ExpectedSelfSave {
    recorded_at: Instant,
    /// Managed writers register the exact bytes they intend to publish. A
    /// later external edit to the same path must never be hidden merely
    /// because it happened inside the de-duplication window.
    content_hash: Option<String>,
}

static RECENT_SELF_SAVES: Mutex<Option<HashMap<PathBuf, ExpectedSelfSave>>> = Mutex::new(None);

/// Mark `path` as recently written by the app itself. Subsequent watcher
/// events that arrive within [`SELF_SAVE_DEDUPE_WINDOW`] for the same path
/// are skipped.
pub(crate) fn record_self_save(path: &Path) {
    record_expected_self_save(path, None);
}

/// Register a managed write before it reaches the filesystem. Watcher events
/// are suppressed only while the file still has this exact content hash.
pub(crate) fn record_self_save_with_hash(path: &Path, content_hash: String) {
    record_expected_self_save(path, Some(content_hash));
}

fn record_expected_self_save(path: &Path, content_hash: Option<String>) {
    let now = Instant::now();
    let Ok(mut guard) = RECENT_SELF_SAVES.lock() else {
        return;
    };
    let entry = guard.get_or_insert_with(HashMap::new);
    prune_self_save_map(entry, now);
    entry.insert(
        path.to_path_buf(),
        ExpectedSelfSave {
            recorded_at: now,
            content_hash,
        },
    );
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
    if let Some(expected) = entry.get(path) {
        if now.duration_since(expected.recorded_at) <= SELF_SAVE_DEDUPE_WINDOW {
            if let Some(expected_hash) = expected.content_hash.as_deref() {
                let matches = fs::read_to_string(path)
                    .ok()
                    .is_some_and(|markdown| content_hash(&markdown) == expected_hash);
                if !matches {
                    // A different hash is an external change, even when it
                    // races immediately behind our own write.
                    entry.remove(path);
                    return false;
                }
            }
            // Leave the entry in place: a single save on disk often produces
            // multiple `notify` events (Create + Modify(Data) + Modify(Any))
            // and we want to swallow all of them inside the window.
            return true;
        }
    }
    false
}

fn prune_self_save_map(entry: &mut HashMap<PathBuf, ExpectedSelfSave>, now: Instant) {
    entry.retain(|_, expected| now.duration_since(expected.recorded_at) <= SELF_SAVE_DEDUPE_WINDOW);
}

/// Shared queue of paths touched by the watcher, drained by the debounce
/// thread. `first_seen`/`last_event` drive the quiet-window vs. max-wait
/// flush decision; `last_activity` feeds the adaptive reconcile interval.
#[derive(Default)]
struct DirtyState {
    paths: HashSet<PathBuf>,
    first_seen: Option<Instant>,
    last_event: Option<Instant>,
    last_activity: Option<Instant>,
}

struct DirtyQueue {
    state: Mutex<DirtyState>,
    signal: Condvar,
}

impl DirtyQueue {
    fn new() -> Self {
        Self {
            state: Mutex::new(DirtyState::default()),
            signal: Condvar::new(),
        }
    }

    fn push<I: IntoIterator<Item = PathBuf>>(&self, paths: I) {
        let now = Instant::now();
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let mut added = false;
        for path in paths {
            state.paths.insert(path);
            added = true;
        }
        if added {
            state.first_seen.get_or_insert(now);
            state.last_event = Some(now);
            state.last_activity = Some(now);
            self.signal.notify_all();
        }
    }

    /// Most recent moment a watcher event was observed, used by the reconcile
    /// loop to decide how aggressively to sweep.
    fn last_activity(&self) -> Option<Instant> {
        self.state.lock().ok().and_then(|state| state.last_activity)
    }
}

#[allow(dead_code)]
pub(crate) struct VaultWatcherHandle {
    watcher: RecommendedWatcher,
}

pub(crate) fn start_vault_watcher(app_handle: AppHandle) -> Result<VaultWatcherHandle, String> {
    let notes_dir = notes_root()?;
    fs::create_dir_all(&notes_dir).map_err(|err| err.to_string())?;

    let queue = std::sync::Arc::new(DirtyQueue::new());

    let callback_queue = queue.clone();
    let callback_notes_dir = notes_dir.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            collect_watch_result(&callback_queue, &callback_notes_dir, result);
        },
        NotifyConfig::default(),
    )
    .map_err(|err| err.to_string())?;
    watcher
        .watch(&notes_dir, RecursiveMode::Recursive)
        .map_err(|err| err.to_string())?;

    spawn_debounce_flush_loop(app_handle.clone(), queue.clone());
    spawn_background_reconcile_loop(app_handle, queue);
    Ok(VaultWatcherHandle { watcher })
}

/// Watcher callback: cheap. Filter events and record dirty paths only; all
/// disk reads and index queueing happen later on the debounce thread so a
/// burst never blocks the notify thread.
fn collect_watch_result(queue: &DirtyQueue, notes_dir: &Path, result: notify::Result<Event>) {
    let event = match result {
        Ok(event) => event,
        Err(error) => {
            eprintln!("vault watcher error: {error}");
            return;
        }
    };
    if !should_process_watch_event(&event.kind) {
        return;
    }

    let mut batch = Vec::new();
    let mut seen = HashSet::new();
    for path in event.paths {
        if !seen.insert(path.clone()) || !is_watchable_markdown_path(&path, notes_dir) {
            continue;
        }
        if consume_self_save(&path) {
            // The app just wrote this file itself; the in-memory index has
            // already been updated and the semantic queue already has the
            // post-save markdown. Skip the redundant reread and event
            // amplification.
            continue;
        }
        batch.push(path);
    }
    if !batch.is_empty() {
        queue.push(batch);
    }
}

/// Debounce thread: waits for a burst of watcher events to settle, then flushes
/// the whole batch in one pass (with rename detection) so the foreground and
/// the embedding server see coalesced work.
fn spawn_debounce_flush_loop(app_handle: AppHandle, queue: std::sync::Arc<DirtyQueue>) {
    thread::spawn(move || loop {
        let paths = wait_for_flushable_batch(&queue);
        if paths.is_empty() {
            continue;
        }
        let notes_dir = match notes_root() {
            Ok(dir) => dir,
            Err(_) => continue,
        };
        if let Err(error) = flush_dirty_batch(&app_handle, &notes_dir, paths) {
            eprintln!("vault flush error: {error}");
        }
    });
}

/// Block until a batch is ready to flush per the debounce policy, then take it.
fn wait_for_flushable_batch(queue: &DirtyQueue) -> Vec<PathBuf> {
    let mut state = match queue.state.lock() {
        Ok(state) => state,
        Err(_) => return Vec::new(),
    };

    loop {
        if state.paths.is_empty() {
            // Nothing pending: wait indefinitely for the next event.
            state = match queue.signal.wait(state) {
                Ok(state) => state,
                Err(_) => return Vec::new(),
            };
            continue;
        }

        let now = Instant::now();
        let quiet_for = state
            .last_event
            .map(|stamp| now.duration_since(stamp))
            .unwrap_or(DEBOUNCE_QUIET_WINDOW);
        let waited_total = state
            .first_seen
            .map(|stamp| now.duration_since(stamp))
            .unwrap_or(Duration::ZERO);

        if quiet_for >= DEBOUNCE_QUIET_WINDOW || waited_total >= DEBOUNCE_MAX_WAIT {
            state.first_seen = None;
            state.last_event = None;
            return state.paths.drain().collect();
        }

        // Sleep just long enough to re-check the earlier of the two deadlines.
        let until_quiet = DEBOUNCE_QUIET_WINDOW.saturating_sub(quiet_for);
        let until_max = DEBOUNCE_MAX_WAIT.saturating_sub(waited_total);
        let timeout = until_quiet.min(until_max).max(Duration::from_millis(10));
        let (next_state, _) = match queue.signal.wait_timeout(state, timeout) {
            Ok(pair) => pair,
            Err(_) => return Vec::new(),
        };
        state = next_state;
    }
}

/// Categorized view of a flushed batch after reading disk state.
struct ResolvedBatch {
    /// Paths that still exist on disk, with their current content.
    present: Vec<(PathBuf, String, u64)>,
    /// Paths that no longer exist (or were forgotten).
    removed: Vec<PathBuf>,
}

fn flush_dirty_batch(
    app_handle: &AppHandle,
    notes_dir: &Path,
    paths: Vec<PathBuf>,
) -> Result<(), String> {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return Ok(());
    };
    state.semantic.report_user_activity();

    let resolved = resolve_batch(notes_dir, paths)?;
    let mut ordinary_present = Vec::new();
    let mut ordinary_removed = Vec::new();

    // Managed projection paths are authoritative in ai.sqlite3. External
    // edits/deletes become classified conflicts and never enter the generic
    // note, task, or semantic pipelines.
    for (path, markdown, modified_millis) in resolved.present {
        let owner = app_handle
            .try_state::<ChatService>()
            .and_then(|chat| chat.projection_owner_for_path(&path).ok().flatten());
        if let Some(chat_id) = owner {
            if let Some(chat) = app_handle.try_state::<ChatService>() {
                let _ = chat.mark_projection_detached(&chat_id);
            }
            if let Some(app_data) = app_handle.try_state::<AppData>() {
                let kind = crate::note::document_kind(&markdown);
                app_data.events.vault_document_changed(
                    &path,
                    false,
                    kind,
                    "externalChatProjection",
                    Some(chat_id.clone()),
                );
                app_data
                    .events
                    .chat_projection_conflict(chat_id, &path, false);
            }
            continue;
        }
        ordinary_present.push((path, markdown, modified_millis));
    }
    for path in resolved.removed {
        let owner = app_handle
            .try_state::<ChatService>()
            .and_then(|chat| chat.projection_owner_for_path(&path).ok().flatten());
        if let Some(chat_id) = owner {
            if let Some(chat) = app_handle.try_state::<ChatService>() {
                let _ = chat.mark_projection_detached(&chat_id);
            }
            if let Some(app_data) = app_handle.try_state::<AppData>() {
                app_data.events.vault_document_changed(
                    &path,
                    true,
                    if path
                        .file_name()
                        .is_some_and(|name| name == "Conversation.md")
                    {
                        crate::note::DocumentKind::ChatIndex
                    } else {
                        crate::note::DocumentKind::ChatTranscript
                    },
                    "externalChatProjection",
                    Some(chat_id.clone()),
                );
                app_data
                    .events
                    .chat_projection_conflict(chat_id, &path, true);
            }
            continue;
        }
        ordinary_removed.push(path);
    }
    let resolved = ResolvedBatch {
        present: ordinary_present,
        removed: ordinary_removed,
    };

    // Rename detection: pair a removed path with a present path that has the
    // same content hash. Content-identical move => re-key existing embeddings
    // instead of delete + re-embed.
    let mut present_by_hash: HashMap<String, Vec<usize>> = HashMap::new();
    let mut present_content_hash: Vec<String> = Vec::with_capacity(resolved.present.len());
    for (_, markdown, _) in &resolved.present {
        present_content_hash.push(content_hash(markdown));
    }
    for (index, hash) in present_content_hash.iter().enumerate() {
        present_by_hash.entry(hash.clone()).or_default().push(index);
    }

    let mut present_consumed = vec![false; resolved.present.len()];
    let mut removed_consumed = vec![false; resolved.removed.len()];

    // For each removed path, try to find a matching present path by the
    // content hash the removed note had when last indexed.
    for (removed_index, removed_path) in resolved.removed.iter().enumerate() {
        let Some(old_hash) = stored_content_hash(&state, removed_path) else {
            continue;
        };
        let Some(candidates) = present_by_hash.get(&old_hash) else {
            continue;
        };
        let Some(&present_index) = candidates.iter().find(|&&i| !present_consumed[i]) else {
            continue;
        };

        let (new_path, markdown, modified_millis) = &resolved.present[present_index];
        state.semantic.queue_note_move(
            removed_path,
            new_path,
            markdown.clone(),
            *modified_millis,
        )?;
        // The in-memory/lexical index is path-keyed too: drop the old entry
        // and refresh the new one.
        state.mark_notes_index_dirty(removed_path, "watcher-move")?;
        state.mark_notes_index_dirty(new_path, "watcher-move")?;
        if let Some(app_data) = app_handle.try_state::<AppData>() {
            app_data.events.vault_note_changed(removed_path, true);
            app_data.events.vault_note_changed(new_path, false);
        }

        present_consumed[present_index] = true;
        removed_consumed[removed_index] = true;
    }

    // Remaining present paths are plain creates/updates.
    for (index, (path, markdown, modified_millis)) in resolved.present.iter().enumerate() {
        if present_consumed[index] {
            continue;
        }
        if !crate::note::semantic_recall_eligible(markdown) {
            state.semantic.queue_delete_note(path)?;
        } else {
            state
                .semantic
                .queue_note_update(path, markdown.clone(), *modified_millis)?;
        }
        state.mark_notes_index_dirty(path, "watcher")?;
        if let Some(app_data) = app_handle.try_state::<AppData>() {
            app_data.events.vault_note_changed(path, false);
        }
    }

    // Remaining removed paths are genuine deletes.
    for (index, path) in resolved.removed.iter().enumerate() {
        if removed_consumed[index] {
            continue;
        }
        state.semantic.queue_delete_note(path)?;
        state.mark_notes_index_dirty(path, "watcher")?;
        if let Some(app_data) = app_handle.try_state::<AppData>() {
            app_data.events.vault_note_changed(path, true);
        }
    }

    Ok(())
}

fn resolve_batch(notes_dir: &Path, paths: Vec<PathBuf>) -> Result<ResolvedBatch, String> {
    let mut present = Vec::new();
    let mut removed = Vec::new();
    for path in paths {
        let deleted = !path.exists() || is_forgotten_note_path(&path, notes_dir);
        if deleted {
            removed.push(path);
            continue;
        }
        let markdown = match fs::read_to_string(&path) {
            Ok(markdown) => markdown,
            // A read failure (e.g. an in-flight sync placeholder) is treated as
            // "not ready"; the reconcile loop will retry it later.
            Err(_) => continue,
        };
        let modified_millis = current_time_millis()?;
        present.push((path, markdown, modified_millis));
    }
    Ok(ResolvedBatch { present, removed })
}

/// Look up the content hash the index currently has stored for a path, used to
/// match a removed note against a content-identical newly-present note.
fn stored_content_hash(state: &AppState, path: &Path) -> Option<String> {
    state.semantic.stored_content_hash(path)
}

/// Periodic full-vault rescan that runs entirely off the request path.
/// Catches up on file-system events the OS watcher dropped (e.g. on
/// network shares, large bursts) without ever blocking a search or focus
/// command. The interval adapts: tight right after activity, backing off
/// toward [`RECONCILE_INTERVAL_MAX`] while the vault is quiet. The thread is
/// detached: it lives for the rest of the process and exits naturally when the
/// host process tears down.
fn spawn_background_reconcile_loop(app_handle: AppHandle, queue: std::sync::Arc<DirtyQueue>) {
    thread::spawn(move || loop {
        thread::sleep(next_reconcile_interval(queue.last_activity()));
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

/// Choose the next sleep duration for the reconcile loop. Stays at
/// [`RECONCILE_INTERVAL_MIN`] while activity is recent, then grows linearly
/// toward [`RECONCILE_INTERVAL_MAX`] the longer the vault stays idle.
fn next_reconcile_interval(last_activity: Option<Instant>) -> Duration {
    let Some(last_activity) = last_activity else {
        // No activity observed yet this session: sweep at the relaxed cadence.
        return RECONCILE_INTERVAL_MAX;
    };
    let idle = last_activity.elapsed();
    if idle <= RECONCILE_ACTIVE_WINDOW {
        return RECONCILE_INTERVAL_MIN;
    }
    // Linear backoff: each ACTIVE_WINDOW of additional idleness adds the
    // minimum interval, capped at the maximum.
    let extra_windows = idle.as_secs() / RECONCILE_ACTIVE_WINDOW.as_secs().max(1);
    let scaled = RECONCILE_INTERVAL_MIN
        .as_secs()
        .saturating_mul(extra_windows.saturating_add(1));
    Duration::from_secs(scaled.clamp(
        RECONCILE_INTERVAL_MIN.as_secs(),
        RECONCILE_INTERVAL_MAX.as_secs(),
    ))
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

#[cfg(test)]
mod tests {
    use super::{
        consume_self_save, is_watchable_markdown_path, next_reconcile_interval,
        record_self_save_with_hash, should_process_watch_event, RECONCILE_INTERVAL_MAX,
        RECONCILE_INTERVAL_MIN,
    };
    use notify::{
        event::{CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind, RenameMode},
        EventKind,
    };
    use std::{
        path::Path,
        time::{Duration, Instant},
    };

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

    #[test]
    fn reconcile_interval_is_tight_after_recent_activity() {
        let just_now = Instant::now();
        assert_eq!(
            next_reconcile_interval(Some(just_now)),
            RECONCILE_INTERVAL_MIN
        );
    }

    #[test]
    fn reconcile_interval_backs_off_when_idle() {
        let long_ago = Instant::now() - Duration::from_secs(3_600);
        assert_eq!(
            next_reconcile_interval(Some(long_ago)),
            RECONCILE_INTERVAL_MAX
        );
    }

    #[test]
    fn reconcile_interval_relaxed_without_activity() {
        assert_eq!(next_reconcile_interval(None), RECONCILE_INTERVAL_MAX);
    }

    #[test]
    fn managed_self_save_suppression_requires_the_registered_hash() {
        let path =
            std::env::temp_dir().join(format!("gneauxghts-self-save-{}.md", std::process::id()));
        let managed = "managed bytes";
        std::fs::write(&path, managed).expect("write managed content");
        record_self_save_with_hash(&path, crate::semantic::db::content_hash(managed));
        assert!(consume_self_save(&path));
        assert!(consume_self_save(&path));
        std::fs::write(&path, "external edit").expect("write external edit");
        assert!(!consume_self_save(&path));
        let _ = std::fs::remove_file(path);
    }
}
