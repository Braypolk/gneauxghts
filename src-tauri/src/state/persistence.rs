use super::config::forgotten_notes_root;
use crate::{index::is_note_file, note, path_utils::collect_markdown_files_recursively};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

/// Strategy for resolving a note id to a path.
///
/// Hot command paths should pass [`NoteIdLookup::Index`] backed by the in-memory
/// notes index for O(1) lookups; the disk scan remains as a safe fallback for
/// startup or cold paths where the index has not been populated yet.
pub(crate) enum NoteIdLookup<'a> {
    Disk,
    /// Index-backed lookup. `is_warm` is true once the in-memory index has
    /// been populated by a full vault scan at least once. While the index
    /// is cold (e.g. immediately after launch, before the background
    /// prewarm thread has finished), `prune_state_in_place` retains
    /// unknown note ids instead of doing per-id disk walks — they will
    /// be pruned by the next call after the index warms up.
    Index {
        lookup: &'a (dyn Fn(&str) -> Option<PathBuf> + 'a),
        is_warm: bool,
    },
}

/// Outcome of a single id lookup. Distinct from `Option<PathBuf>` so the
/// pruning step can tell "id is genuinely missing — drop it" apart from
/// "index is cold and cannot confirm yet — retain for now". The prune
/// path only needs the verdict; the actual path is unused here.
enum NoteIdLookupOutcome {
    Found,
    Missing,
    Unknown,
}

impl<'a> NoteIdLookup<'a> {
    /// Lookup variant used by the prune path. When the index is cold,
    /// returns [`NoteIdLookupOutcome::Unknown`] for any id the index does
    /// not know about, so the caller retains the id rather than doing an
    /// O(N) disk walk to confirm it is missing.
    fn resolve_for_prune(
        &self,
        notes_dir: &Path,
        note_id: &str,
    ) -> Result<NoteIdLookupOutcome, String> {
        match self {
            NoteIdLookup::Disk => match resolve_note_path_by_id(notes_dir, note_id)? {
                Some(_) => Ok(NoteIdLookupOutcome::Found),
                None => Ok(NoteIdLookupOutcome::Missing),
            },
            NoteIdLookup::Index { lookup, is_warm } => {
                if let Some(path) = lookup(note_id) {
                    if is_valid_note_path(&path, notes_dir) {
                        return Ok(NoteIdLookupOutcome::Found);
                    }
                }
                if *is_warm {
                    Ok(NoteIdLookupOutcome::Missing)
                } else {
                    Ok(NoteIdLookupOutcome::Unknown)
                }
            }
        }
    }
}

pub(super) const DEFAULT_NOTE_NAME: &str = "Untitled Note";
pub(super) const MAX_FILE_STEM_LENGTH: usize = 80;
pub(super) const MAX_RECENT_NOTES: usize = 20;
pub(super) const APP_STATE_SINGLETON_ID: i64 = 1;
const APP_STATE_DB_FILE_NAME: &str = "app-state.sqlite3";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedForgottenNote {
    pub(crate) forgotten_path: String,
    pub(crate) original_path: String,
    pub(crate) title: String,
    pub(crate) forgotten_at_millis: u64,
    pub(crate) purge_after_days: u32,
    pub(crate) purge_at_millis: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedState {
    pub(crate) last_opened_note_id: Option<String>,
    #[serde(default)]
    pub(crate) recent_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) hidden_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) note_order_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) collapsed_note_ids: Vec<String>,
    #[serde(default)]
    pub(crate) forgotten_notes: Vec<PersistedForgottenNote>,
}

pub(crate) fn read_state(notes_dir: &Path) -> Result<PersistedState, String> {
    read_state_with_lookup(notes_dir, &NoteIdLookup::Disk)
}

pub(crate) fn read_state_with_lookup(
    notes_dir: &Path,
    lookup: &NoteIdLookup<'_>,
) -> Result<PersistedState, String> {
    let mut state = read_unpruned_state(notes_dir)?;
    prune_state_in_place(&mut state, notes_dir, lookup);
    Ok(state)
}

pub(crate) fn write_state(notes_dir: &Path, state: &PersistedState) -> Result<(), String> {
    write_state_with_lookup(notes_dir, state, &NoteIdLookup::Disk)
}

pub(crate) fn write_state_with_lookup(
    notes_dir: &Path,
    state: &PersistedState,
    lookup: &NoteIdLookup<'_>,
) -> Result<(), String> {
    let mut state = state.clone();
    prune_state_in_place(&mut state, notes_dir, lookup);
    write_state_to_database(&state)?;
    Ok(())
}

/// Row-scoped write of just the `last_opened_note_id` and the recent notes
/// ordering. Avoids the full app_state rewrite (which deletes/reinserts
/// hidden, note_order, collapsed, and forgotten rows on every note switch).
/// Used by `mark_note_opened` so rapid note switching does not contend on
/// SQLite for state that did not change.
pub(crate) fn write_last_opened_and_recents(state: &PersistedState) -> Result<(), String> {
    with_state_database(|connection| {
        let transaction = connection.transaction().map_err(|err| err.to_string())?;

        transaction
            .execute(
                "INSERT INTO app_state (id, last_opened_note_id)
                 VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE
                 SET last_opened_note_id = excluded.last_opened_note_id",
                params![APP_STATE_SINGLETON_ID, state.last_opened_note_id.as_deref()],
            )
            .map_err(|err| err.to_string())?;

        transaction
            .execute("DELETE FROM app_state_recent_note_ids", [])
            .map_err(|err| err.to_string())?;
        for (index, note_id) in state.recent_note_ids.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO app_state_recent_note_ids (position, note_id) VALUES (?1, ?2)",
                    params![to_i64(index)?, note_id],
                )
                .map_err(|err| err.to_string())?;
        }

        transaction.commit().map_err(|err| err.to_string())?;
        Ok(())
    })
}

pub(crate) fn prune_recent_note_ids(state: &mut PersistedState, notes_dir: &Path) -> bool {
    prune_recent_note_ids_with_lookup(state, notes_dir, &NoteIdLookup::Disk)
}

pub(crate) fn prune_recent_note_ids_with_lookup(
    state: &mut PersistedState,
    notes_dir: &Path,
    lookup: &NoteIdLookup<'_>,
) -> bool {
    let resolver = PruneResolver::new(lookup, notes_dir);
    prune_recent_note_ids_with_resolver(state, &resolver)
}

fn prune_recent_note_ids_with_resolver(
    state: &mut PersistedState,
    resolver: &PruneResolver<'_, '_>,
) -> bool {
    let original_len = state.recent_note_ids.len();
    let mut seen = HashSet::new();
    state
        .recent_note_ids
        .retain(|note_id| match resolver.resolve(note_id) {
            Ok(NoteIdLookupOutcome::Found) | Ok(NoteIdLookupOutcome::Unknown) => {
                seen.insert(note_id.clone())
            }
            Ok(NoteIdLookupOutcome::Missing) | Err(_) => false,
        });
    let mut changed = state.recent_note_ids.len() != original_len;
    if state.recent_note_ids.len() > MAX_RECENT_NOTES {
        state.recent_note_ids.truncate(MAX_RECENT_NOTES);
        changed = true;
    }

    if state.last_opened_note_id.as_ref().is_some_and(|note_id| {
        matches!(
            resolver.resolve(note_id),
            Ok(NoteIdLookupOutcome::Missing) | Err(_)
        )
    }) {
        state.last_opened_note_id = None;
        changed = true;
    }

    changed
}

pub(crate) fn touch_recent_note_id(state: &mut PersistedState, note_id: String) {
    state
        .recent_note_ids
        .retain(|existing_note_id| existing_note_id != &note_id);
    state.recent_note_ids.insert(0, note_id);
    state.recent_note_ids.truncate(MAX_RECENT_NOTES);
}

#[allow(dead_code)]
pub(crate) fn push_unique(items: &mut Vec<String>, value: String) {
    if items.iter().any(|existing_value| existing_value == &value) {
        return;
    }

    items.push(value);
}

pub(crate) fn validate_current_path(
    current_path: Option<String>,
    notes_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(current_path) = current_path else {
        return Ok(None);
    };

    let path = PathBuf::from(current_path);
    if !is_path_in_notes_dir(&path, notes_dir) {
        return Err("Current note path is outside the notes directory".to_string());
    }
    if is_forgotten_note_path(&path, notes_dir) {
        return Err("Current note path is inside the forgotten notes directory".to_string());
    }

    Ok(Some(path))
}

pub(crate) fn is_valid_note_path(path: &Path, notes_dir: &Path) -> bool {
    is_path_in_notes_dir(path, notes_dir)
        && !is_forgotten_note_path(path, notes_dir)
        && is_note_file(path)
}

pub(crate) fn resolve_note_id_from_path(path: &Path) -> Result<String, String> {
    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    note::note_id_from_path_or_markdown(Some(path), &markdown)
        .ok_or_else(|| "Unable to determine note id".to_string())
}

pub(crate) fn resolve_note_path_by_id(
    notes_dir: &Path,
    note_id: &str,
) -> Result<Option<PathBuf>, String> {
    for path in collect_markdown_files_recursively(notes_dir)? {
        if !is_valid_note_path(&path, notes_dir) {
            continue;
        }
        let Ok(markdown) = fs::read_to_string(&path) else {
            continue;
        };
        if note::note_id_from_path_or_markdown(Some(&path), &markdown).as_deref() == Some(note_id) {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

pub(crate) fn is_forgotten_note_path(path: &Path, notes_dir: &Path) -> bool {
    path.starts_with(forgotten_notes_root(notes_dir))
}

pub(crate) fn persist_note(
    notes_dir: &Path,
    title: &str,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<String>, String> {
    let normalized_markdown = note::normalize_wikilink_markdown(markdown);

    if title.trim().is_empty() && normalized_markdown.trim().is_empty() {
        let target_path =
            resolve_target_path(notes_dir, title, &normalized_markdown, current_path)?;
        let Some(target_path) = target_path else {
            return Ok(None);
        };

        if let Some(existing_path) = current_path {
            if existing_path != target_path && existing_path.exists() {
                crate::vault_watcher::record_self_save(existing_path);
                fs::rename(existing_path, &target_path).map_err(|err| err.to_string())?;
            }
        }

        crate::vault_watcher::record_self_save(&target_path);
        fs::write(&target_path, "").map_err(|err| err.to_string())?;
        return Ok(Some(target_path.to_string_lossy().into_owned()));
    }

    let existing_markdown = current_path
        .filter(|path| path.exists())
        .map(fs::read_to_string)
        .transpose()
        .map_err(|err| err.to_string())?;
    let prepared_markdown = note::prepare_note_markdown(
        &normalized_markdown,
        existing_markdown.as_deref(),
        Some(None),
    )?
    .0;
    let target_path = resolve_target_path(notes_dir, title, &prepared_markdown, current_path)?;
    let Some(target_path) = target_path else {
        return Ok(None);
    };

    if let Some(existing_path) = current_path {
        if existing_path != target_path && existing_path.exists() {
            crate::vault_watcher::record_self_save(existing_path);
            fs::rename(existing_path, &target_path).map_err(|err| err.to_string())?;
        }
    }

    crate::vault_watcher::record_self_save(&target_path);
    fs::write(&target_path, prepared_markdown).map_err(|err| err.to_string())?;
    Ok(Some(target_path.to_string_lossy().into_owned()))
}

pub(crate) fn derive_file_stem(markdown: &str) -> String {
    note::derive_file_stem(markdown, DEFAULT_NOTE_NAME, MAX_FILE_STEM_LENGTH)
}

pub(crate) fn derive_file_stem_from_title_and_markdown(title: &str, markdown: &str) -> String {
    note::derive_file_stem_from_title_and_markdown(
        title,
        markdown,
        DEFAULT_NOTE_NAME,
        MAX_FILE_STEM_LENGTH,
    )
}

fn prune_state_in_place(state: &mut PersistedState, notes_dir: &Path, lookup: &NoteIdLookup<'_>) {
    let resolver = PruneResolver::new(lookup, notes_dir);
    prune_recent_note_ids_with_resolver(state, &resolver);
    prune_note_id_list_with_resolver(&mut state.hidden_note_ids, &resolver);
    prune_note_id_list_with_resolver(&mut state.note_order_note_ids, &resolver);
    prune_note_id_list_with_resolver(&mut state.collapsed_note_ids, &resolver);
    prune_forgotten_notes(state, notes_dir);
}

fn prune_note_id_list_with_resolver(note_ids: &mut Vec<String>, resolver: &PruneResolver<'_, '_>) {
    let mut seen = HashSet::new();
    note_ids.retain(|note_id| match resolver.resolve(note_id) {
        Ok(NoteIdLookupOutcome::Found) | Ok(NoteIdLookupOutcome::Unknown) => {
            seen.insert(note_id.clone())
        }
        Ok(NoteIdLookupOutcome::Missing) | Err(_) => false,
    });
}

/// Per-`prune_state_in_place` call helper. For [`NoteIdLookup::Disk`] the
/// resolver builds a single `note_id -> path` map by walking the vault
/// once and reuses it for every id, avoiding the previous quadratic
/// behaviour where each prune call walked the vault and read every file
/// once per id in `recent_note_ids`/`hidden_note_ids`/etc.
struct PruneResolver<'lookup, 'dir> {
    lookup: &'lookup NoteIdLookup<'lookup>,
    notes_dir: &'dir Path,
    /// Batched note-id -> path map built lazily on first use when the
    /// active lookup is [`NoteIdLookup::Disk`]. Wrapped in a `OnceCell`
    /// so we pay the disk walk only when the prune actually needs it.
    disk_index: std::cell::OnceCell<Result<HashMap<String, PathBuf>, String>>,
}

impl<'lookup, 'dir> PruneResolver<'lookup, 'dir> {
    fn new(lookup: &'lookup NoteIdLookup<'lookup>, notes_dir: &'dir Path) -> Self {
        Self {
            lookup,
            notes_dir,
            disk_index: std::cell::OnceCell::new(),
        }
    }

    fn resolve(&self, note_id: &str) -> Result<NoteIdLookupOutcome, String> {
        match self.lookup {
            NoteIdLookup::Index { .. } => self.lookup.resolve_for_prune(self.notes_dir, note_id),
            NoteIdLookup::Disk => {
                let map = self
                    .disk_index
                    .get_or_init(|| collect_note_id_to_path_map(self.notes_dir))
                    .as_ref()
                    .map_err(|err| err.clone())?;
                if map.contains_key(note_id) {
                    Ok(NoteIdLookupOutcome::Found)
                } else {
                    Ok(NoteIdLookupOutcome::Missing)
                }
            }
        }
    }
}

fn collect_note_id_to_path_map(notes_dir: &Path) -> Result<HashMap<String, PathBuf>, String> {
    let mut map = HashMap::new();
    for path in collect_markdown_files_recursively(notes_dir)? {
        if !is_valid_note_path(&path, notes_dir) {
            continue;
        }
        let Ok(markdown) = fs::read_to_string(&path) else {
            continue;
        };
        if let Some(note_id) = note::note_id_from_path_or_markdown(Some(&path), &markdown) {
            map.entry(note_id).or_insert(path);
        }
    }
    Ok(map)
}

fn prune_forgotten_notes(state: &mut PersistedState, notes_dir: &Path) {
    let mut seen = HashSet::new();
    state.forgotten_notes.retain(|forgotten_note| {
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        let original_path = PathBuf::from(&forgotten_note.original_path);
        !forgotten_note.title.trim().is_empty()
            && forgotten_note.purge_after_days > 0
            && forgotten_note.purge_at_millis >= forgotten_note.forgotten_at_millis
            && forgotten_path.is_file()
            && is_forgotten_note_path(&forgotten_path, notes_dir)
            && is_path_in_notes_dir(&original_path, notes_dir)
            && !is_forgotten_note_path(&original_path, notes_dir)
            && seen.insert(forgotten_note.forgotten_path.clone())
    });
}

fn is_path_in_notes_dir(path: &Path, notes_dir: &Path) -> bool {
    path.starts_with(notes_dir)
}

fn resolve_target_path(
    notes_dir: &Path,
    title: &str,
    markdown: &str,
    current_path: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    if title.trim().is_empty() && markdown.trim().is_empty() {
        return Ok(current_path.map(Path::to_path_buf));
    }

    let file_stem = derive_file_stem_from_title_and_markdown(title, markdown);
    let target_dir = current_path
        .and_then(Path::parent)
        .filter(|parent| parent.starts_with(notes_dir))
        .unwrap_or(notes_dir);
    let preferred_path = target_dir.join(format!("{file_stem}.md"));

    if current_path.is_some_and(|path| path == preferred_path) || !preferred_path.exists() {
        return Ok(Some(preferred_path));
    }

    if let Some(existing_path) = current_path {
        if existing_path.exists() && existing_path.file_name() == preferred_path.file_name() {
            return Ok(Some(existing_path.to_path_buf()));
        }
    }

    for suffix in 2.. {
        let candidate = target_dir.join(format!("{file_stem} {suffix}.md"));
        if current_path.is_some_and(|path| path == candidate) || !candidate.exists() {
            return Ok(Some(candidate));
        }
    }

    Err("Unable to determine a target path for the note".to_string())
}

fn state_database_path() -> Result<PathBuf, String> {
    let app_data_dir = super::config::app_data_dir()?;
    fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
    Ok(app_data_dir.join(APP_STATE_DB_FILE_NAME))
}

struct StateDatabase {
    path: PathBuf,
    connection: Connection,
}

static STATE_DATABASE: Mutex<Option<StateDatabase>> = Mutex::new(None);

/// Returns a guarded long-lived connection to the app-state SQLite database.
///
/// The connection is created once and reused across calls so we do not pay
/// re-open + schema-check costs on every mutation. The cached entry is keyed
/// on the resolved database path so test runs that swap the configured app
/// data directory get a fresh connection automatically.
fn with_state_database<R, F>(action: F) -> Result<R, String>
where
    F: FnOnce(&mut Connection) -> Result<R, String>,
{
    with_state_database_internal(action)
}

/// Internal access to the long-lived app-state SQLite connection. The
/// `internal` suffix marks it as a sibling-module hook used by
/// [`super::task_projection`] which needs to share the same connection
/// to keep transactions / writes coherent.
pub(super) fn with_state_database_internal<R, F>(action: F) -> Result<R, String>
where
    F: FnOnce(&mut Connection) -> Result<R, String>,
{
    let database_path = state_database_path()?;
    let mut guard: MutexGuard<'_, Option<StateDatabase>> = STATE_DATABASE
        .lock()
        .map_err(|_| "App state database lock poisoned".to_string())?;
    let needs_open = guard
        .as_ref()
        .map(|entry| entry.path != database_path)
        .unwrap_or(true);
    if needs_open {
        let connection = Connection::open(&database_path).map_err(|err| err.to_string())?;
        ensure_state_schema(&connection)?;
        *guard = Some(StateDatabase {
            path: database_path,
            connection,
        });
    }
    let entry = guard.as_mut().expect("state database initialised");
    action(&mut entry.connection)
}

/// Idempotent re-entry to the schema bootstrap. Sibling modules (the
/// task projection) call this so they can layer their own DDL on top
/// of the bootstrapped tables without depending on this module's
/// open-once behaviour.
pub(super) fn ensure_state_schema_idempotent(connection: &Connection) -> Result<(), String> {
    ensure_state_schema(connection)
}

fn ensure_state_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_opened_note_id TEXT
            );
            CREATE TABLE IF NOT EXISTS app_state_recent_note_ids (
                position INTEGER PRIMARY KEY,
                note_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS app_state_hidden_note_ids (
                note_id TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_note_order_note_ids (
                position INTEGER PRIMARY KEY,
                note_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS app_state_collapsed_note_ids (
                note_id TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS app_state_forgotten_notes (
                forgotten_path TEXT PRIMARY KEY,
                original_path TEXT NOT NULL,
                title TEXT NOT NULL,
                forgotten_at_millis INTEGER NOT NULL,
                purge_after_days INTEGER NOT NULL,
                purge_at_millis INTEGER NOT NULL
            );",
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn read_unpruned_state(_notes_dir: &Path) -> Result<PersistedState, String> {
    if let Some(state) = read_unpruned_state_from_database()? {
        return Ok(state);
    }

    Ok(PersistedState::default())
}

fn read_unpruned_state_from_database() -> Result<Option<PersistedState>, String> {
    with_state_database(|connection| {
        if !database_has_persisted_state(connection)? {
            return Ok(None);
        }
        Ok(Some(read_state_from_database(connection)?))
    })
}

fn database_has_persisted_state(connection: &Connection) -> Result<bool, String> {
    let has_singleton = connection
        .query_row(
            "SELECT 1 FROM app_state WHERE id = ?1 LIMIT 1",
            params![APP_STATE_SINGLETON_ID],
            |_| Ok(true),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .unwrap_or(false);
    if has_singleton {
        return Ok(true);
    }

    for table in [
        "app_state_recent_note_ids",
        "app_state_hidden_note_ids",
        "app_state_note_order_note_ids",
        "app_state_collapsed_note_ids",
        "app_state_forgotten_notes",
    ] {
        let query = format!("SELECT 1 FROM {table} LIMIT 1");
        let has_rows = connection
            .query_row(&query, [], |_| Ok(true))
            .optional()
            .map_err(|err| err.to_string())?
            .unwrap_or(false);
        if has_rows {
            return Ok(true);
        }
    }

    Ok(false)
}

fn read_state_from_database(connection: &Connection) -> Result<PersistedState, String> {
    let last_opened_note_id = connection
        .query_row(
            "SELECT last_opened_note_id FROM app_state WHERE id = ?1",
            params![APP_STATE_SINGLETON_ID],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?
        .flatten();

    let recent_note_ids = read_ordered_string_column(
        connection,
        "SELECT note_id FROM app_state_recent_note_ids ORDER BY position",
    )?;
    let hidden_note_ids = read_string_column(
        connection,
        "SELECT note_id FROM app_state_hidden_note_ids ORDER BY note_id",
    )?;
    let note_order_note_ids = read_ordered_string_column(
        connection,
        "SELECT note_id FROM app_state_note_order_note_ids ORDER BY position",
    )?;
    let collapsed_note_ids = read_string_column(
        connection,
        "SELECT note_id FROM app_state_collapsed_note_ids ORDER BY note_id",
    )?;

    let mut forgotten_notes = Vec::new();
    let mut statement = connection
        .prepare(
            "SELECT forgotten_path, original_path, title, forgotten_at_millis, purge_after_days, purge_at_millis
             FROM app_state_forgotten_notes",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(PersistedForgottenNote {
                forgotten_path: row.get(0)?,
                original_path: row.get(1)?,
                title: row.get(2)?,
                forgotten_at_millis: read_u64_column(row, 3)?,
                purge_after_days: read_u32_column(row, 4)?,
                purge_at_millis: read_u64_column(row, 5)?,
            })
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        forgotten_notes.push(row.map_err(|err| err.to_string())?);
    }

    Ok(PersistedState {
        last_opened_note_id,
        recent_note_ids,
        hidden_note_ids,
        note_order_note_ids,
        collapsed_note_ids,
        forgotten_notes,
    })
}

fn read_string_column(connection: &Connection, query: &str) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare(query).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn read_ordered_string_column(connection: &Connection, query: &str) -> Result<Vec<String>, String> {
    read_string_column(connection, query)
}

fn write_state_to_database(state: &PersistedState) -> Result<(), String> {
    with_state_database(|connection| write_state_to_connection(connection, state))
}

fn write_state_to_connection(
    connection: &mut Connection,
    state: &PersistedState,
) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|err| err.to_string())?;

    transaction
        .execute(
            "INSERT INTO app_state (id, last_opened_note_id)
             VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE
             SET last_opened_note_id = excluded.last_opened_note_id",
            params![APP_STATE_SINGLETON_ID, state.last_opened_note_id.as_deref()],
        )
        .map_err(|err| err.to_string())?;

    transaction
        .execute("DELETE FROM app_state_recent_note_ids", [])
        .map_err(|err| err.to_string())?;
    for (index, note_id) in state.recent_note_ids.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO app_state_recent_note_ids (position, note_id) VALUES (?1, ?2)",
                params![to_i64(index)?, note_id],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute("DELETE FROM app_state_hidden_note_ids", [])
        .map_err(|err| err.to_string())?;
    for note_id in &state.hidden_note_ids {
        transaction
            .execute(
                "INSERT INTO app_state_hidden_note_ids (note_id) VALUES (?1)",
                params![note_id],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute("DELETE FROM app_state_note_order_note_ids", [])
        .map_err(|err| err.to_string())?;
    for (index, note_id) in state.note_order_note_ids.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO app_state_note_order_note_ids (position, note_id) VALUES (?1, ?2)",
                params![to_i64(index)?, note_id],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute("DELETE FROM app_state_collapsed_note_ids", [])
        .map_err(|err| err.to_string())?;
    for note_id in &state.collapsed_note_ids {
        transaction
            .execute(
                "INSERT INTO app_state_collapsed_note_ids (note_id) VALUES (?1)",
                params![note_id],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction
        .execute("DELETE FROM app_state_forgotten_notes", [])
        .map_err(|err| err.to_string())?;
    for forgotten_note in &state.forgotten_notes {
        transaction
            .execute(
                "INSERT INTO app_state_forgotten_notes (
                    forgotten_path,
                    original_path,
                    title,
                    forgotten_at_millis,
                    purge_after_days,
                    purge_at_millis
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    forgotten_note.forgotten_path.as_str(),
                    forgotten_note.original_path.as_str(),
                    forgotten_note.title.as_str(),
                    to_i64(forgotten_note.forgotten_at_millis)?,
                    i64::from(forgotten_note.purge_after_days),
                    to_i64(forgotten_note.purge_at_millis)?
                ],
            )
            .map_err(|err| err.to_string())?;
    }

    transaction.commit().map_err(|err| err.to_string())
}

// Row-scoped mutation helpers. These avoid the full DELETE + INSERT rewrite
// of the entire app-state tables for ordinary mutations like toggling a single
// hidden note id, touching a single recent entry, or upserting a single
// task-timestamp row. Some helpers are not yet called from the existing
// command surface but are kept here so subsequent migrations can swap their
// callers over without re-deriving the SQL.

#[allow(dead_code)]
pub(crate) fn db_set_last_opened_note_id(note_id: Option<&str>) -> Result<(), String> {
    with_state_database(|connection| {
        connection
            .execute(
                "INSERT INTO app_state (id, last_opened_note_id)
                 VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE
                 SET last_opened_note_id = excluded.last_opened_note_id",
                params![APP_STATE_SINGLETON_ID, note_id],
            )
            .map(|_| ())
            .map_err(|err| err.to_string())
    })
}

#[allow(dead_code)]
pub(crate) fn db_set_recent_note_ids(recent_note_ids: &[String]) -> Result<(), String> {
    with_state_database(|connection| {
        let transaction = connection.transaction().map_err(|err| err.to_string())?;
        transaction
            .execute("DELETE FROM app_state_recent_note_ids", [])
            .map_err(|err| err.to_string())?;
        for (index, note_id) in recent_note_ids.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO app_state_recent_note_ids (position, note_id) VALUES (?1, ?2)",
                    params![to_i64(index)?, note_id],
                )
                .map_err(|err| err.to_string())?;
        }
        transaction.commit().map_err(|err| err.to_string())
    })
}

pub(crate) fn db_set_note_hidden(note_id: &str, hidden: bool) -> Result<(), String> {
    with_state_database(|connection| {
        let result = if hidden {
            connection.execute(
                "INSERT OR IGNORE INTO app_state_hidden_note_ids (note_id) VALUES (?1)",
                params![note_id],
            )
        } else {
            connection.execute(
                "DELETE FROM app_state_hidden_note_ids WHERE note_id = ?1",
                params![note_id],
            )
        };
        result.map(|_| ()).map_err(|err| err.to_string())
    })
}

pub(crate) fn db_set_note_collapsed(note_id: &str, collapsed: bool) -> Result<(), String> {
    with_state_database(|connection| {
        let result = if collapsed {
            connection.execute(
                "INSERT OR IGNORE INTO app_state_collapsed_note_ids (note_id) VALUES (?1)",
                params![note_id],
            )
        } else {
            connection.execute(
                "DELETE FROM app_state_collapsed_note_ids WHERE note_id = ?1",
                params![note_id],
            )
        };
        result.map(|_| ()).map_err(|err| err.to_string())
    })
}

pub(crate) fn db_set_note_order(note_ids: &[String]) -> Result<(), String> {
    with_state_database(|connection| {
        let transaction = connection.transaction().map_err(|err| err.to_string())?;
        transaction
            .execute("DELETE FROM app_state_note_order_note_ids", [])
            .map_err(|err| err.to_string())?;
        for (index, note_id) in note_ids.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO app_state_note_order_note_ids (position, note_id) VALUES (?1, ?2)",
                    params![to_i64(index)?, note_id],
                )
                .map_err(|err| err.to_string())?;
        }
        transaction.commit().map_err(|err| err.to_string())
    })
}

#[allow(dead_code)]
pub(crate) fn db_insert_forgotten_note(
    forgotten_note: &PersistedForgottenNote,
) -> Result<(), String> {
    with_state_database(|connection| {
        connection
            .execute(
                "INSERT OR REPLACE INTO app_state_forgotten_notes (
                    forgotten_path,
                    original_path,
                    title,
                    forgotten_at_millis,
                    purge_after_days,
                    purge_at_millis
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    forgotten_note.forgotten_path.as_str(),
                    forgotten_note.original_path.as_str(),
                    forgotten_note.title.as_str(),
                    to_i64(forgotten_note.forgotten_at_millis)?,
                    i64::from(forgotten_note.purge_after_days),
                    to_i64(forgotten_note.purge_at_millis)?,
                ],
            )
            .map(|_| ())
            .map_err(|err| err.to_string())
    })
}

#[allow(dead_code)]
pub(crate) fn db_remove_forgotten_note(forgotten_path: &str) -> Result<(), String> {
    with_state_database(|connection| {
        connection
            .execute(
                "DELETE FROM app_state_forgotten_notes WHERE forgotten_path = ?1",
                params![forgotten_path],
            )
            .map(|_| ())
            .map_err(|err| err.to_string())
    })
}

fn read_u64_column(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(index)?;
    u64::try_from(value).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(err),
        )
    })
}

fn read_u32_column(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u32> {
    let value = row.get::<_, i64>(index)?;
    u32::try_from(value).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(err),
        )
    })
}

fn to_i64<T>(value: T) -> Result<i64, String>
where
    T: TryInto<i64>,
    <T as TryInto<i64>>::Error: std::fmt::Display,
{
    value.try_into().map_err(|err| err.to_string())
}
