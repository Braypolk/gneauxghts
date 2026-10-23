//! SQLite-backed task projection (read model).
//!
//! Markdown checkbox tasks remain the user-facing source of truth on
//! disk. This module owns a derived projection in `app-state.sqlite3`
//! that gives every task a stable internal `task_id`, plus the
//! denormalised columns the task list / recents UI needs to render
//! without walking every `IndexedNote` in the in-memory index.
//!
//! Callers reconcile a single note's tasks at every index upsert/remove
//! via [`reconcile_note_tasks`]. The reconciler matches new tasks
//! against the rows that previously belonged to the same note, reusing
//! `task_id` (and preserving `created_at_millis`) when the same
//! logical task survives across edits even if its position or text
//! shifted slightly.

use super::persistence::with_state_database_internal;
use crate::index::{task_key, IndexedNote, IndexedTask};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Outcome of reconciling a note's tasks against the projection.
/// Reported back to callers that need the affected task rows without
/// re-querying.
#[allow(dead_code)]
#[derive(Clone, Debug, Default)]
pub(crate) struct ReconcileOutcome {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) tasks: Vec<TaskRecord>,
}

/// A row from the `app_state_note_tasks` projection. Mirrors the
/// `TaskListItem` shape the existing frontend already consumes so the
/// public command surface keeps the same JSON contract.
#[derive(Clone, Debug)]
pub(crate) struct TaskRecord {
    pub(crate) task_id: String,
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) note_title: String,
    pub(crate) file_name: String,
    pub(crate) note_modified_millis: u64,
    pub(crate) task_key: String,
    pub(crate) section_label: Option<String>,
    pub(crate) text: String,
    pub(crate) completed: bool,
    pub(crate) hidden: bool,
    pub(crate) depth: usize,
    pub(crate) line_number: usize,
    pub(crate) editor_line_number: Option<usize>,
    pub(crate) created_at_millis: u64,
    pub(crate) updated_at_millis: u64,
}

/// Filter accepted by [`list_tasks_with_filters`]. Mirrors the public
/// `TaskFilter` enum in the command layer; kept as a separate type to
/// avoid pulling the public command types into the persistence layer.
#[derive(Clone, Copy, Debug)]
pub(crate) enum ProjectionFilter {
    Open,
    Completed,
    All,
}

pub(crate) fn ensure_task_projection_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_state_note_tasks (
                task_id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL,
                note_path TEXT NOT NULL,
                note_title TEXT NOT NULL,
                file_name TEXT NOT NULL,
                note_modified_millis INTEGER NOT NULL,
                task_key TEXT NOT NULL,
                section_label TEXT,
                text TEXT NOT NULL,
                text_lower TEXT NOT NULL,
                note_title_lower TEXT NOT NULL,
                completed INTEGER NOT NULL,
                hidden INTEGER NOT NULL DEFAULT 0,
                depth INTEGER NOT NULL,
                line_number INTEGER NOT NULL,
                editor_line_number INTEGER,
                created_at_millis INTEGER NOT NULL,
                updated_at_millis INTEGER NOT NULL,
                deleted_at_millis INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_note_tasks_note_id
                ON app_state_note_tasks (note_id) WHERE deleted_at_millis IS NULL;
            CREATE INDEX IF NOT EXISTS idx_note_tasks_task_key
                ON app_state_note_tasks (task_key) WHERE deleted_at_millis IS NULL;
            CREATE INDEX IF NOT EXISTS idx_note_tasks_completed
                ON app_state_note_tasks (completed) WHERE deleted_at_millis IS NULL;",
        )
        .map_err(|err| err.to_string())
}

/// Record an internal candidate for matching previous → next tasks
/// during reconciliation.
#[derive(Clone)]
struct PreviousTask {
    task_id: String,
    task_key: String,
    text_lower: String,
    section_label: Option<String>,
    completed: bool,
    depth: usize,
    line_number: usize,
    created_at_millis: u64,
    updated_at_millis: u64,
    hidden: bool,
}

#[derive(Clone)]
struct NextTask<'a> {
    task: &'a IndexedTask,
    text_lower: String,
    task_key: String,
}

fn collapse_whitespace(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    for segment in value.split_whitespace() {
        if !collapsed.is_empty() {
            collapsed.push(' ');
        }
        collapsed.push_str(segment);
    }
    collapsed
}

fn normalize_text(value: &str) -> String {
    let description = crate::services::task_dates::set_task_line_due_date(value, None)
        .unwrap_or_else(|_| value.to_string());
    collapse_whitespace(&description).to_lowercase()
}

fn generate_task_id(note_id: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let random = rand_u64();
    // 22 hex chars + a short note_id prefix keeps the value readable in
    // logs / SQL inspection tools while staying compact in the index.
    let prefix: String = note_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect();
    format!("t_{prefix}_{nanos:016x}{random:016x}")
}

fn rand_u64() -> u64 {
    use std::cell::Cell;
    use std::time::{SystemTime, UNIX_EPOCH};
    thread_local! {
        static STATE: Cell<u64> = const { Cell::new(0xDEAD_BEEF_CAFE_BABE) };
    }
    STATE.with(|cell| {
        let mut value = cell.get();
        if value == 0 {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos() as u64)
                .unwrap_or(1);
            value = nanos.wrapping_mul(0x2545_F491_4F6C_DD1D) ^ 0x9E37_79B9_7F4A_7C15;
        }
        // xorshift64
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        cell.set(value);
        value
    })
}

/// Reconcile a single note against the projection.
///
/// `next_note` is the freshly-parsed note (or `None` when the note was
/// deleted from disk). On a non-`None` value the reconciler upserts every
/// surviving task (preserving `task_id` + `created_at_millis` where
/// possible) and soft-deletes any rows that no longer correspond to a
/// task in the markdown.
pub(crate) fn reconcile_note_tasks(
    note_path: &Path,
    next_note: Option<&IndexedNote>,
    note_id: &str,
    timestamp_millis: u64,
) -> Result<ReconcileOutcome, String> {
    let note_path_string = note_path.to_string_lossy().into_owned();
    with_state_database_internal(|connection| {
        let transaction = connection.transaction().map_err(|err| err.to_string())?;
        let previous_tasks = load_previous_tasks(&transaction, note_id)?;
        let previous_lookup = PreviousTaskLookup::new(&previous_tasks);
        let mut used_previous_indexes: HashSet<usize> = HashSet::new();

        let next_tasks: Vec<NextTask<'_>> = match next_note {
            Some(note) => note
                .tasks
                .iter()
                .map(|task| NextTask {
                    text_lower: normalize_text(&task.text),
                    task_key: task_key(&note.note_id, task),
                    task,
                })
                .collect(),
            None => Vec::new(),
        };

        let mut surviving = Vec::with_capacity(next_tasks.len());

        if let Some(note) = next_note {
            let note_title = note.title.clone();
            let note_title_lower = note.title_lower.clone();
            let file_name = note.file_name.clone();
            let note_modified_millis = note.modified_millis;

            for next_task in &next_tasks {
                let matched_index = find_matching_previous_task_index(
                    &previous_lookup,
                    &used_previous_indexes,
                    next_task,
                );
                let (task_id, created_at_millis, was_completed, hidden, prev_updated) =
                    match matched_index {
                        Some(index) => {
                            used_previous_indexes.insert(index);
                            let previous = &previous_tasks[index];
                            (
                                previous.task_id.clone(),
                                previous.created_at_millis,
                                previous.completed,
                                previous.hidden,
                                Some(previous.updated_at_millis),
                            )
                        }
                        None => (
                            generate_task_id(&note.note_id),
                            timestamp_millis,
                            next_task.task.completed,
                            false,
                            None,
                        ),
                    };

                let updated_at_millis = match prev_updated {
                    Some(prev_updated) => {
                        if was_completed != next_task.task.completed {
                            timestamp_millis
                        } else {
                            prev_updated
                        }
                    }
                    None => timestamp_millis,
                };

                let record = TaskRecord {
                    task_id,
                    note_id: note.note_id.clone(),
                    note_path: note_path_string.clone(),
                    note_title: note_title.clone(),
                    file_name: file_name.clone(),
                    note_modified_millis,
                    task_key: next_task.task_key.clone(),
                    section_label: next_task.task.section_label.clone(),
                    text: next_task.task.text.clone(),
                    completed: next_task.task.completed,
                    hidden,
                    depth: next_task.task.depth,
                    line_number: next_task.task.line_number,
                    editor_line_number: next_task.task.editor_line_number,
                    created_at_millis,
                    updated_at_millis,
                };
                upsert_task_row(
                    &transaction,
                    &record,
                    &next_task.text_lower,
                    &note_title_lower,
                )?;
                surviving.push(record);
            }
        }

        for (index, previous) in previous_tasks.iter().enumerate() {
            if !used_previous_indexes.contains(&index) {
                soft_delete_task_row(&transaction, &previous.task_id, timestamp_millis)?;
            }
        }

        transaction.commit().map_err(|err| err.to_string())?;

        Ok(ReconcileOutcome {
            note_id: note_id.to_string(),
            note_path: note_path_string,
            tasks: surviving,
        })
    })
}

fn load_previous_tasks(
    connection: &Connection,
    note_id: &str,
) -> Result<Vec<PreviousTask>, String> {
    let mut statement = connection
        .prepare(
            "SELECT task_id, task_key, text_lower, section_label, completed, depth, line_number,
                    created_at_millis, updated_at_millis, hidden
             FROM app_state_note_tasks
             WHERE note_id = ?1 AND deleted_at_millis IS NULL",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map(params![note_id], |row| {
            Ok(PreviousTask {
                task_id: row.get::<_, String>(0)?,
                task_key: row.get::<_, String>(1)?,
                text_lower: row.get::<_, String>(2)?,
                section_label: row.get::<_, Option<String>>(3)?,
                completed: row.get::<_, i64>(4)? != 0,
                depth: row.get::<_, i64>(5)? as usize,
                line_number: row.get::<_, i64>(6)? as usize,
                created_at_millis: read_u64(row, 7)?,
                updated_at_millis: read_u64(row, 8)?,
                hidden: row.get::<_, i64>(9)? != 0,
            })
        })
        .map_err(|err| err.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|err| err.to_string())?);
    }
    Ok(result)
}

/// Candidate lists preserve previous-row order so nearest-line ties retain the
/// same identity as the linear policy. Keys borrow the loaded snapshot.
struct PreviousTaskLookup<'a> {
    previous: &'a [PreviousTask],
    by_key: HashMap<&'a str, Vec<usize>>,
    by_text: HashMap<&'a str, Vec<usize>>,
    by_line: HashMap<usize, Vec<usize>>,
}
impl<'a> PreviousTaskLookup<'a> {
    fn new(previous: &'a [PreviousTask]) -> Self {
        let mut lookup = Self {
            previous,
            by_key: HashMap::new(),
            by_text: HashMap::new(),
            by_line: HashMap::new(),
        };
        for (index, task) in previous.iter().enumerate() {
            lookup.by_key.entry(&task.task_key).or_default().push(index);
            lookup
                .by_text
                .entry(&task.text_lower)
                .or_default()
                .push(index);
            lookup
                .by_line
                .entry(task.line_number)
                .or_default()
                .push(index);
        }
        lookup
    }
    fn select(
        &self,
        candidates: Option<&Vec<usize>>,
        used: &HashSet<usize>,
        next: &NextTask<'_>,
        matches: impl Fn(&PreviousTask) -> bool,
    ) -> Option<usize> {
        candidates?
            .iter()
            .copied()
            .filter(|index| !used.contains(index) && matches(&self.previous[*index]))
            .min_by_key(|index| {
                self.previous[*index]
                    .line_number
                    .abs_diff(next.task.line_number)
            })
    }
}

fn find_matching_previous_task_index(
    lookup: &PreviousTaskLookup<'_>,
    used: &HashSet<usize>,
    next: &NextTask<'_>,
) -> Option<usize> {
    let text = lookup.by_text.get(next.text_lower.as_str());
    lookup
        .select(
            lookup.by_key.get(next.task_key.as_str()),
            used,
            next,
            |_| true,
        )
        .or_else(|| {
            lookup.select(text, used, next, |previous| {
                previous.section_label == next.task.section_label
                    && previous.depth == next.task.depth
            })
        })
        .or_else(|| {
            lookup.select(text, used, next, |previous| {
                previous.section_label == next.task.section_label
            })
        })
        .or_else(|| lookup.select(text, used, next, |_| true))
        .or_else(|| {
            lookup.select(
                lookup.by_line.get(&next.task.line_number),
                used,
                next,
                |_| true,
            )
        })
}

// Independent reference retained only for validating the indexed policy.
#[cfg(test)]
fn select_matching_previous_task_with<F>(
    previous_tasks: &[PreviousTask],
    used: &HashSet<usize>,
    next_task: &NextTask<'_>,
    predicate: F,
) -> Option<usize>
where
    F: Fn(&PreviousTask, &NextTask<'_>) -> bool,
{
    previous_tasks
        .iter()
        .enumerate()
        .filter(|(index, candidate)| !used.contains(index) && predicate(candidate, next_task))
        .min_by_key(|(_, candidate)| candidate.line_number.abs_diff(next_task.task.line_number))
        .map(|(index, _)| index)
}

#[cfg(test)]
fn find_matching_previous_task_index_linear(
    previous_tasks: &[PreviousTask],
    used: &HashSet<usize>,
    next_task: &NextTask<'_>,
) -> Option<usize> {
    select_matching_previous_task_with(previous_tasks, used, next_task, |previous, next| {
        previous.task_key == next.task_key
    })
    .or_else(|| {
        select_matching_previous_task_with(previous_tasks, used, next_task, |previous, next| {
            previous.text_lower == next.text_lower
                && previous.section_label == next.task.section_label
                && previous.depth == next.task.depth
        })
    })
    .or_else(|| {
        select_matching_previous_task_with(previous_tasks, used, next_task, |previous, next| {
            previous.text_lower == next.text_lower
                && previous.section_label == next.task.section_label
        })
    })
    .or_else(|| {
        select_matching_previous_task_with(previous_tasks, used, next_task, |previous, next| {
            previous.text_lower == next.text_lower
        })
    })
    .or_else(|| {
        // Last-ditch: match by exact line number when only one task lives
        // on that line previously. Lets us keep ID stability when text was
        // edited in place.
        select_matching_previous_task_with(previous_tasks, used, next_task, |previous, next| {
            previous.line_number == next.task.line_number
        })
    })
}

fn upsert_task_row(
    connection: &Connection,
    record: &TaskRecord,
    text_lower: &str,
    note_title_lower: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO app_state_note_tasks (
                task_id, note_id, note_path, note_title, file_name,
                note_modified_millis, task_key, section_label, text, text_lower,
                note_title_lower, completed, hidden, depth, line_number,
                editor_line_number, created_at_millis, updated_at_millis,
                deleted_at_millis
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, NULL)
             ON CONFLICT(task_id) DO UPDATE SET
                note_id = excluded.note_id,
                note_path = excluded.note_path,
                note_title = excluded.note_title,
                file_name = excluded.file_name,
                note_modified_millis = excluded.note_modified_millis,
                task_key = excluded.task_key,
                section_label = excluded.section_label,
                text = excluded.text,
                text_lower = excluded.text_lower,
                note_title_lower = excluded.note_title_lower,
                completed = excluded.completed,
                hidden = excluded.hidden,
                depth = excluded.depth,
                line_number = excluded.line_number,
                editor_line_number = excluded.editor_line_number,
                created_at_millis = excluded.created_at_millis,
                updated_at_millis = excluded.updated_at_millis,
                deleted_at_millis = NULL",
            params![
                record.task_id,
                record.note_id,
                record.note_path,
                record.note_title,
                record.file_name,
                to_i64(record.note_modified_millis)?,
                record.task_key,
                record.section_label,
                record.text,
                text_lower,
                note_title_lower,
                if record.completed { 1_i64 } else { 0_i64 },
                if record.hidden { 1_i64 } else { 0_i64 },
                record.depth as i64,
                record.line_number as i64,
                record.editor_line_number.map(|value| value as i64),
                to_i64(record.created_at_millis)?,
                to_i64(record.updated_at_millis)?,
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn soft_delete_task_row(
    connection: &Connection,
    task_id: &str,
    timestamp_millis: u64,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE app_state_note_tasks
             SET deleted_at_millis = ?1, updated_at_millis = ?1
             WHERE task_id = ?2 AND deleted_at_millis IS NULL",
            params![to_i64(timestamp_millis)?, task_id],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) fn set_hidden_for_task_id(task_id: &str, hidden: bool) -> Result<(), String> {
    with_state_database_internal(|connection| {
        connection
            .execute(
                "UPDATE app_state_note_tasks
                 SET hidden = ?1
                 WHERE task_id = ?2 AND deleted_at_millis IS NULL",
                params![if hidden { 1_i64 } else { 0_i64 }, task_id],
            )
            .map_err(|err| err.to_string())?;
        Ok(())
    })
}

/// Tear down (soft-delete) every task projection row associated with a
/// note path. Used when a note is deleted from disk.
pub(crate) fn delete_tasks_for_note_path(
    note_path: &Path,
    timestamp_millis: u64,
) -> Result<Vec<String>, String> {
    let path_string = note_path.to_string_lossy().into_owned();
    with_state_database_internal(|connection| {
        let mut note_ids = Vec::new();
        {
            let mut statement = connection
                .prepare(
                    "SELECT DISTINCT note_id FROM app_state_note_tasks
                     WHERE note_path = ?1 AND deleted_at_millis IS NULL",
                )
                .map_err(|err| err.to_string())?;
            let rows = statement
                .query_map(params![path_string.as_str()], |row| row.get::<_, String>(0))
                .map_err(|err| err.to_string())?;
            for row in rows {
                note_ids.push(row.map_err(|err| err.to_string())?);
            }
        }
        connection
            .execute(
                "UPDATE app_state_note_tasks
                 SET deleted_at_millis = ?1, updated_at_millis = ?1
                 WHERE note_path = ?2 AND deleted_at_millis IS NULL",
                params![to_i64(timestamp_millis)?, path_string],
            )
            .map_err(|err| err.to_string())?;
        Ok(note_ids)
    })
}

/// Read all live (non-deleted) projection rows for a note id.
pub(crate) fn load_tasks_for_note_id(note_id: &str) -> Result<Vec<TaskRecord>, String> {
    with_state_database_internal(|connection| {
        load_tasks_where(
            connection,
            "note_id = ?1 AND deleted_at_millis IS NULL
             ORDER BY line_number ASC",
            params![note_id],
        )
    })
}

pub(crate) fn load_task_by_id(task_id: &str) -> Result<Option<TaskRecord>, String> {
    let tasks = with_state_database_internal(|connection| {
        load_tasks_where(
            connection,
            "task_id = ?1 AND deleted_at_millis IS NULL
             LIMIT 1",
            params![task_id],
        )
    })?;
    Ok(tasks.into_iter().next())
}

/// Read live tasks ordered for the master list. The caller supplies the
/// `note_order_note_ids` so the SQL ORDER BY mirrors the previous
/// in-memory sort.
pub(crate) fn list_tasks_with_filter(
    filter: ProjectionFilter,
    note_order_note_ids: &[String],
    hidden_note_ids: &HashSet<String>,
    collapsed_note_ids: &HashSet<String>,
) -> Result<Vec<TaskRecord>, String> {
    let mut where_clause = String::from("deleted_at_millis IS NULL");
    match filter {
        ProjectionFilter::Open => where_clause.push_str(" AND completed = 0"),
        ProjectionFilter::Completed => where_clause.push_str(" AND completed = 1"),
        ProjectionFilter::All => {}
    }

    let order_index: HashMap<String, usize> = note_order_note_ids
        .iter()
        .enumerate()
        .map(|(index, note_id)| (note_id.clone(), index))
        .collect();

    let mut tasks = with_state_database_internal(|connection| {
        load_tasks_where(
            connection,
            &format!(
                "{where_clause} ORDER BY note_title_lower ASC, line_number ASC, text_lower ASC"
            ),
            [],
        )
    })?;

    tasks.sort_by(|left, right| {
        let left_rank = order_index
            .get(&left.note_id)
            .copied()
            .unwrap_or(usize::MAX);
        let right_rank = order_index
            .get(&right.note_id)
            .copied()
            .unwrap_or(usize::MAX);
        left_rank
            .cmp(&right_rank)
            .then_with(|| {
                left.note_title
                    .to_lowercase()
                    .cmp(&right.note_title.to_lowercase())
            })
            .then_with(|| left.line_number.cmp(&right.line_number))
            .then_with(|| left.text.to_lowercase().cmp(&right.text.to_lowercase()))
    });

    let _ = (hidden_note_ids, collapsed_note_ids); // applied by caller for `note_hidden`/`note_collapsed` flags
    Ok(tasks)
}

/// Read recent open tasks (top-N) for the focus loader.
pub(crate) fn list_recent_open_tasks(
    limit: usize,
    hidden_note_ids: &HashSet<String>,
) -> Result<Vec<TaskRecord>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    with_state_database_internal(|connection| {
        let mut statement = connection
            .prepare(&format!(
                "{TASK_SELECT}
                 WHERE deleted_at_millis IS NULL AND completed = 0 AND hidden = 0
                 ORDER BY updated_at_millis DESC, note_title_lower ASC, line_number DESC"
            ))
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], task_record_from_row)
            .map_err(|err| err.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            let task = row.map_err(|err| err.to_string())?;
            if hidden_note_ids.contains(&task.note_id) {
                continue;
            }
            result.push(task);
            // Hidden notes can have any number of recent tasks. Apply the
            // visible limit while streaming rather than guessing a SQL limit.
            if result.len() == limit {
                break;
            }
        }
        Ok(result)
    })
}

const TASK_SELECT: &str = "SELECT task_id, note_id, note_path, note_title, file_name,
    note_modified_millis, task_key, section_label, text, completed,
    hidden, depth, line_number, editor_line_number, created_at_millis, updated_at_millis
    FROM app_state_note_tasks";

fn load_tasks_where(
    connection: &Connection,
    where_and_order: &str,
    parameters: impl rusqlite::Params,
) -> Result<Vec<TaskRecord>, String> {
    let query = format!("{TASK_SELECT} WHERE {where_and_order}");
    let mut statement = connection.prepare(&query).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map(parameters, task_record_from_row)
        .map_err(|err| err.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())
}

fn task_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRecord> {
    Ok(TaskRecord {
        task_id: row.get(0)?,
        note_id: row.get(1)?,
        note_path: row.get(2)?,
        note_title: row.get(3)?,
        file_name: row.get(4)?,
        note_modified_millis: read_u64(row, 5)?,
        task_key: row.get(6)?,
        section_label: row.get(7)?,
        text: row.get(8)?,
        completed: row.get::<_, i64>(9)? != 0,
        hidden: row.get::<_, i64>(10)? != 0,
        depth: row.get::<_, i64>(11)? as usize,
        line_number: row.get::<_, i64>(12)? as usize,
        editor_line_number: row.get::<_, Option<i64>>(13)?.map(|value| value as usize),
        created_at_millis: read_u64(row, 14)?,
        updated_at_millis: read_u64(row, 15)?,
    })
}

fn read_u64(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(index)?;
    u64::try_from(value).map_err(|err| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::build_indexed_note;
    use crate::state::initialize_app_data_dir;
    use crate::test_support::{lock_test_env, TestDir};
    use std::path::PathBuf;

    struct ProjectionFixture {
        _storage: crate::state::AppStateStorage,
        _root: TestDir,
    }

    fn setup_app_data(label: &str) -> ProjectionFixture {
        let app_data = TestDir::new(label);
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("set app data dir");
        // app-state.sqlite3 (which backs the task projection) is now
        // vault-local; isolate it inside this test's temp dir.
        crate::state::set_notes_root_override(Some(app_data.path().to_path_buf()))
            .expect("override notes root");
        let storage =
            crate::state::AppStateStorage::bind(&crate::state::vault_data_dir().unwrap()).unwrap();
        ProjectionFixture {
            _storage: storage,
            _root: app_data,
        }
    }

    #[test]
    fn indexed_matching_preserves_linear_priority_used_rows_and_nearest_line_ties() {
        let mut seed = 0x42_u64;
        let mut draw = |bound: usize| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            ((seed >> 32) as usize) % bound
        };
        for scenario in 0..100 {
            let previous = (0..32)
                .map(|index| PreviousTask {
                    task_id: index.to_string(),
                    task_key: format!("key-{}", draw(8)),
                    text_lower: format!("text-{}", draw(6)),
                    section_label: (draw(3) != 0).then(|| format!("section-{}", draw(3))),
                    completed: draw(2) == 0,
                    depth: draw(3),
                    line_number: draw(24),
                    created_at_millis: 1,
                    updated_at_millis: 1,
                    hidden: draw(2) == 0,
                })
                .collect::<Vec<_>>();
            let lookup = PreviousTaskLookup::new(&previous);
            let mut used = (0..32).filter(|_| draw(4) == 0).collect::<HashSet<_>>();
            for step in 0..48 {
                let task = IndexedTask {
                    section_label: (draw(3) != 0).then(|| format!("section-{}", draw(4))),
                    text: format!("text-{}", draw(8)),
                    completed: false,
                    depth: draw(4),
                    line_number: draw(32),
                    editor_line_number: None,
                };
                let next = NextTask {
                    text_lower: task.text.clone(),
                    task_key: format!("key-{}", draw(16)),
                    task: &task,
                };
                let expected = find_matching_previous_task_index_linear(&previous, &used, &next);
                assert_eq!(
                    find_matching_previous_task_index(&lookup, &used, &next),
                    expected,
                    "scenario={scenario} step={step}"
                );
                if let Some(index) = expected {
                    used.insert(index);
                }
            }
        }
        // Equal-distance duplicate keys preserve the earlier stored row, even
        // when a lower-priority text candidate is closer to the requested line.
        let make = |key: &str, text: &str, line: usize| PreviousTask {
            task_id: line.to_string(),
            task_key: key.into(),
            text_lower: text.into(),
            section_label: None,
            completed: false,
            depth: 0,
            line_number: line,
            created_at_millis: 1,
            updated_at_millis: 1,
            hidden: false,
        };
        let previous = vec![
            make("key", "old", 4usize),
            make("key", "old", 6),
            make("other", "new", 5),
        ];
        let task = IndexedTask {
            section_label: None,
            text: "new".into(),
            completed: false,
            depth: 0,
            line_number: 5,
            editor_line_number: None,
        };
        let next = NextTask {
            task: &task,
            text_lower: "new".into(),
            task_key: "key".into(),
        };
        let lookup = PreviousTaskLookup::new(&previous);
        assert_eq!(
            find_matching_previous_task_index(&lookup, &HashSet::new(), &next),
            Some(0)
        );
        assert_eq!(
            find_matching_previous_task_index(&lookup, &HashSet::from([0]), &next),
            Some(1)
        );
        assert_eq!(
            find_matching_previous_task_index(&lookup, &HashSet::from([0, 1]), &next),
            Some(2)
        );
    }

    #[test]
    #[ignore = "diagnostic scale measurement; no machine-dependent acceptance threshold"]
    fn measure_stable_task_matching_candidate_work() {
        for count in [100, 1000] {
            let markdown = (0..count)
                .map(|n| format!("- [ ] Task {n}\n"))
                .collect::<String>();
            let note = build_indexed_note(Path::new("/notes/Scale.md"), &markdown, 1);
            let previous = note
                .tasks
                .iter()
                .map(|task| PreviousTask {
                    task_id: task.line_number.to_string(),
                    task_key: task_key(&note.note_id, task),
                    text_lower: normalize_text(&task.text),
                    section_label: task.section_label.clone(),
                    completed: false,
                    depth: task.depth,
                    line_number: task.line_number,
                    created_at_millis: 1,
                    updated_at_millis: 1,
                    hidden: false,
                })
                .collect::<Vec<_>>();
            let lookup = PreviousTaskLookup::new(&previous);
            let comparisons = std::cell::Cell::new(0usize);
            let mut indexed_elapsed = std::time::Duration::ZERO;
            let mut used = HashSet::new();
            let start = std::time::Instant::now();
            for (index, task) in note.tasks.iter().enumerate() {
                let next = NextTask {
                    task,
                    text_lower: normalize_text(&task.text),
                    task_key: task_key(&note.note_id, task),
                };
                let measured = select_matching_previous_task_with(
                    &previous,
                    &used,
                    &next,
                    |previous, next| {
                        comparisons.set(comparisons.get() + 1);
                        previous.task_key == next.task_key
                    },
                );
                assert_eq!(measured, Some(index));
                let indexed_start = std::time::Instant::now();
                let indexed = find_matching_previous_task_index(&lookup, &used, &next);
                indexed_elapsed += indexed_start.elapsed();
                assert_eq!(indexed, measured);
                assert_eq!(lookup.by_key[&*next.task_key].len(), 1);
                used.insert(index);
            }
            assert_eq!(comparisons.get(), count * (count + 1) / 2);
            eprintln!(
                "TASK_MATCH_DIAGNOSTIC tasks={count} key_comparisons={} linear_plus_indexed_debug_micros={} indexed_debug_micros={}",
                comparisons.get(),
                start.elapsed().as_micros(), indexed_elapsed.as_micros()
            );
        }
    }

    #[test]
    fn deadline_edits_reorder_external_refresh_and_moves_preserve_task_identity() {
        let _guard = lock_test_env();
        let _app_data = setup_app_data("task-projection-dates");
        let path = PathBuf::from("/notes/Project.md");
        let first = build_indexed_note(&path, "# Project\n\n- [ ] Alpha @due(2026-10-01)\n  - [ ] Child @due(2026-10-02)\n- [ ] Beta\n", 100);
        let initial = reconcile_note_tasks(&path, Some(&first), &first.note_id, 100).unwrap();
        let alpha_id = initial.tasks[0].task_id.clone();
        let child_id = initial.tasks[1].task_id.clone();
        let beta_id = initial.tasks[2].task_id.clone();
        let moved = PathBuf::from("/notes/Moved.md");
        let mut next = build_indexed_note(&moved, "# Project\n\n- [ ] Beta\n- [ ] Alpha @due(2026-10-03)\n  - [ ] Child @due(2026-10-02)\n", 200);
        next.note_id = first.note_id.clone();
        let after = reconcile_note_tasks(&moved, Some(&next), &next.note_id, 200).unwrap();
        assert_eq!(after.tasks[0].task_id, beta_id);
        assert_eq!(after.tasks[1].task_id, alpha_id);
        assert_eq!(after.tasks[2].task_id, child_id);
        assert_eq!(
            crate::services::task_dates::task_due_date(&after.tasks[1].text).as_deref(),
            Some("2026-10-03")
        );
        let reloaded = load_task_by_id(&alpha_id).unwrap().unwrap();
        assert_eq!(reloaded.note_path, moved.to_string_lossy());
        assert_eq!(reloaded.text, "Alpha @due(2026-10-03)");
    }

    #[test]
    fn reconcile_updates_completion_timestamp_only_when_completion_flips() {
        let _guard = lock_test_env();
        let _app_data = setup_app_data("task-projection-completion");

        let path = PathBuf::from("/notes/Ship.md");
        let open_first = build_indexed_note(&path, "# Ship\n\n- [ ] Ship beta\n", 100);
        let open_again = build_indexed_note(&path, "# Ship\n\n- [ ] Ship beta\n", 150);
        let completed = build_indexed_note(&path, "# Ship\n\n- [x] Ship beta\n", 200);

        reconcile_note_tasks(&path, Some(&open_first), &open_first.note_id, 100)
            .expect("first reconcile");
        let no_change = reconcile_note_tasks(&path, Some(&open_again), &open_again.note_id, 150)
            .expect("no change reconcile");
        assert_eq!(no_change.tasks[0].updated_at_millis, 100);

        let after_complete = reconcile_note_tasks(&path, Some(&completed), &completed.note_id, 200)
            .expect("complete reconcile");
        assert_eq!(after_complete.tasks[0].updated_at_millis, 200);
        assert!(after_complete.tasks[0].completed);
    }

    #[test]
    fn reconcile_soft_deletes_removed_tasks() {
        let _guard = lock_test_env();
        let _app_data = setup_app_data("task-projection-delete");

        let path = PathBuf::from("/notes/Cleanup.md");
        let note = build_indexed_note(&path, "# Cleanup\n\n- [ ] Keep\n- [ ] Remove me\n", 10);
        let after = build_indexed_note(&path, "# Cleanup\n\n- [ ] Keep\n", 20);

        reconcile_note_tasks(&path, Some(&note), &note.note_id, 10).expect("reconcile");
        let outcome = reconcile_note_tasks(&path, Some(&after), &after.note_id, 20)
            .expect("post-delete reconcile");
        assert_eq!(outcome.tasks.len(), 1);
        let live = load_tasks_for_note_id(&after.note_id).expect("load live");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].text, "Keep");
    }

    #[test]
    fn list_recent_open_tasks_skips_completed() {
        let _guard = lock_test_env();
        let _app_data = setup_app_data("task-projection-recent");

        let path = PathBuf::from("/notes/RecentList.md");
        let note = build_indexed_note(
            &path,
            "# RecentList\n\n- [ ] Open one\n- [x] Done\n- [ ] Open two\n",
            10,
        );
        reconcile_note_tasks(&path, Some(&note), &note.note_id, 10).expect("reconcile");

        let hidden_notes = HashSet::new();
        let recents = list_recent_open_tasks(10, &hidden_notes).expect("recents");
        assert_eq!(recents.len(), 2);
        assert!(recents.iter().all(|task| !task.completed));
    }

    #[test]
    fn recent_tasks_fill_visible_limit_beyond_hidden_notes_and_tasks() {
        let _guard = lock_test_env();
        let _app_data = setup_app_data("task-projection-recent-hidden");
        let visible_path = PathBuf::from("/notes/Visible.md");
        let visible = build_indexed_note(&visible_path, "- [ ] Older idea\n", 10);
        reconcile_note_tasks(&visible_path, Some(&visible), &visible.note_id, 10).unwrap();

        let hidden_markdown = (0..64)
            .map(|index| format!("- [ ] Hidden task {index}\n"))
            .collect::<String>();
        let hidden_note_path = PathBuf::from("/notes/Hidden note.md");
        let hidden_note = build_indexed_note(&hidden_note_path, &hidden_markdown, 20);
        reconcile_note_tasks(
            &hidden_note_path,
            Some(&hidden_note),
            &hidden_note.note_id,
            20,
        )
        .unwrap();
        let hidden_tasks_path = PathBuf::from("/notes/Hidden tasks.md");
        let hidden_tasks = build_indexed_note(&hidden_tasks_path, &hidden_markdown, 30);
        let projected = reconcile_note_tasks(
            &hidden_tasks_path,
            Some(&hidden_tasks),
            &hidden_tasks.note_id,
            30,
        )
        .unwrap();
        for task in projected.tasks {
            set_hidden_for_task_id(&task.task_id, true).unwrap();
        }

        let recents = list_recent_open_tasks(1, &HashSet::from([hidden_note.note_id])).unwrap();
        assert_eq!(recents.len(), 1);
        assert_eq!(recents[0].note_id, visible.note_id);
        assert_eq!(recents[0].text, "Older idea");
    }

    #[test]
    fn recent_tasks_preserve_recency_title_and_line_order_and_exact_limit() {
        let _guard = lock_test_env();
        let _app_data = setup_app_data("task-projection-recent-order");
        for (name, markdown, timestamp) in [
            ("Alpha", "- [ ] First\n- [ ] Second\n", 20),
            ("Beta", "- [ ] Third\n", 20),
            ("Newest", "- [ ] Latest\n", 30),
            ("Oldest", "- [ ] Earlier\n", 10),
        ] {
            let path = PathBuf::from(format!("/notes/{name}.md"));
            let note = build_indexed_note(&path, markdown, timestamp);
            reconcile_note_tasks(&path, Some(&note), &note.note_id, timestamp).unwrap();
        }
        let hidden_notes = HashSet::new();
        let recents = list_recent_open_tasks(3, &hidden_notes).unwrap();
        assert_eq!(
            recents
                .iter()
                .map(|task| task.text.as_str())
                .collect::<Vec<_>>(),
            ["Latest", "Second", "First"]
        );
        assert_eq!(list_recent_open_tasks(20, &hidden_notes).unwrap().len(), 5);
        assert!(list_recent_open_tasks(0, &hidden_notes).unwrap().is_empty());
    }
}
