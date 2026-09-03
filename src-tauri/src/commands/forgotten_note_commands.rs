use super::index_bridge::read_indexed_note_from_path;
use super::{current_time_millis, ForgottenNoteSummary, RestoredForgottenNote};
use crate::{
    chat::ChatService,
    index::{build_indexed_note, AppState},
    note,
    path_utils::unique_path_in_dir,
    services::note_timeline::{
        LifecyclePublicationFailure, MutationWarningStage, NoteIdentity, NoteLifecycleOperation,
        NoteMutationWarning, NoteTimeline,
    },
    state::{
        forgotten_notes_root, read_state, read_unpruned_state, validate_current_path, write_state,
        write_unpruned_state, ForgottenItemKind, PersistedForgottenNote,
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
pub(crate) fn get_forgotten_note_retention_days() -> Result<u32, String> {
    crate::state::forgotten_note_retention_days()
}

#[tauri::command]
pub(crate) fn set_forgotten_note_retention_days(retention_days: u32) -> Result<(), String> {
    crate::state::set_forgotten_note_retention_days(retention_days)
}

#[tauri::command]
pub(crate) fn forget_note(
    state: State<'_, AppState>,
    current_path: Option<String>,
    retention_days: u32,
) -> Result<Option<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

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
        let note_markdown =
            NoteTimeline::new(&state).prepare_publication(Some(note_path), None, &note_markdown)?;
        let (forgotten_markdown, note_id) =
            prepare_forgotten_note_markdown(&note_markdown, forgotten_at_rfc3339)?;
        let previous_persisted_state = persisted_state.clone();
        let raw_path = note_path.to_string_lossy().into_owned();
        if persisted_state.last_opened_note_id.as_deref() == Some(note_id.as_str()) {
            persisted_state.last_opened_note_id = None;
        }
        persisted_state
            .recent_note_ids
            .retain(|existing_note_id| existing_note_id != &note_id);
        persisted_state
            .forgotten_notes
            .push(PersistedForgottenNote {
                note_id: Some(note_id.clone()),
                forgotten_path: forgotten_path.to_string_lossy().into_owned(),
                original_path: raw_path,
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
                kind: ForgottenItemKind::Note,
                conversation_id: None,
            });
        write_unpruned_state(&persisted_state)?;

        let timeline = NoteTimeline::new(&state);
        let publication = timeline.publish_lifecycle(
            NoteLifecycleOperation::forgotten(
                NoteIdentity::new(note_id.clone()),
                note_path.clone(),
                forgotten_path.clone(),
                forgotten_at_millis,
            ),
            &forgotten_markdown,
            || {
                let expected_move = crate::vault_watcher::record_expected_move(
                    note_path,
                    &forgotten_path,
                    &forgotten_markdown,
                );
                publish_note_move(
                    note_path,
                    &forgotten_path,
                    &forgotten_markdown,
                    &note_markdown,
                )?;
                expected_move.commit();
                Ok(())
            },
        );
        let publication = match publication {
            Ok(publication) => publication,
            Err(error) => {
                return Err(match write_unpruned_state(&previous_persisted_state) {
                    Ok(()) => error,
                    Err(rollback_error) => format!(
                        "{error}; additionally failed to roll back forgotten-note state: {rollback_error}"
                    ),
                });
            }
        };
        let commit_warning = publication.commit_warning().cloned();
        let mut summary = build_forgotten_note_summary(
            persisted_state
                .forgotten_notes
                .last()
                .expect("forgotten note just inserted"),
        );
        summary.commit_warning = commit_warning;
        return Ok(Some(summary));
    }

    write_state(&notes_dir, &persisted_state)?;
    Ok(None)
}

pub(super) fn register_forgotten_chat_folder(
    notes_dir: &Path,
    original_path: &Path,
    forgotten_path: &Path,
    title: &str,
    conversation_id: &str,
    retention_days: u32,
) -> Result<ForgottenNoteSummary, String> {
    validate_retention_days(retention_days)?;
    if !original_path.starts_with(notes_dir)
        || original_path.starts_with(forgotten_notes_root(notes_dir))
    {
        return Err("Forgotten note restore path is outside the notes directory".to_string());
    }
    if !forgotten_path.is_dir()
        || !forgotten_path.starts_with(forgotten_notes_root(notes_dir))
        || conversation_id.trim().is_empty()
    {
        return Err("Forgotten chat folder is invalid".to_string());
    }
    let forgotten_at_millis = current_time_millis()?;
    let purge_at_millis = forgotten_at_millis
        .saturating_add(u64::from(retention_days).saturating_mul(FORGOTTEN_DAY_MILLIS));

    let mut persisted_state = read_state(notes_dir)?;
    if persisted_state.last_chat_conversation_id.as_deref() == Some(conversation_id) {
        persisted_state.last_chat_conversation_id = None;
        persisted_state.last_chat_context_note_id = None;
        persisted_state.last_chat_context_note_path = None;
    }
    persisted_state
        .forgotten_notes
        .push(PersistedForgottenNote {
            note_id: None,
            forgotten_path: forgotten_path.to_string_lossy().into_owned(),
            original_path: original_path.to_string_lossy().into_owned(),
            title: title.to_string(),
            forgotten_at_millis,
            purge_after_days: retention_days,
            purge_at_millis,
            kind: ForgottenItemKind::Chat,
            conversation_id: Some(conversation_id.to_string()),
        });
    let summary = build_forgotten_note_summary(
        persisted_state
            .forgotten_notes
            .last()
            .expect("forgotten note just inserted"),
    );
    write_state(notes_dir, &persisted_state)?;
    Ok(summary)
}

#[tauri::command]
pub(crate) fn list_forgotten_notes(
    state: State<'_, AppState>,
) -> Result<Vec<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

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
    chat_service: State<'_, ChatService>,
    forgotten_paths: Vec<String>,
) -> Result<Vec<RestoredForgottenNote>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

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

        let forgotten_note = persisted_state.forgotten_notes[index].clone();
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        let stored_item_exists = match forgotten_note.kind {
            ForgottenItemKind::Note => forgotten_path.is_file(),
            ForgottenItemKind::Chat => forgotten_path.is_dir(),
        };
        if !stored_item_exists {
            persisted_state.forgotten_notes.remove(index);
            write_state(&notes_dir, &persisted_state)?;
            continue;
        }

        let (restored_path, commit_warning) = match forgotten_note.kind {
            ForgottenItemKind::Note => {
                let restored_path = resolve_restore_target_path(
                    &notes_dir,
                    Path::new(&forgotten_note.original_path),
                );
                let markdown =
                    fs::read_to_string(&forgotten_path).map_err(|err| err.to_string())?;
                let retained_identity = forgotten_note.note_id.as_deref().map(NoteIdentity::new);
                let markdown = NoteTimeline::new(&state).prepare_publication(
                    None,
                    retained_identity.as_ref(),
                    &markdown,
                )?;
                let restored_markdown =
                    note::prepare_note_markdown(&markdown, Some(&markdown), Some(None))?.0;
                let timestamp_millis = current_time_millis()?;
                let retained_note_id =
                    note::note_id_from_path_or_markdown(Some(&forgotten_path), &restored_markdown)
                        .ok_or_else(|| "Forgotten note is missing its Note Identity".to_string())?;
                let previous_original_path =
                    persisted_state.forgotten_notes[index].original_path.clone();
                persisted_state.forgotten_notes[index].original_path =
                    restored_path.to_string_lossy().into_owned();
                write_unpruned_state(&persisted_state)?;
                let timeline = NoteTimeline::new(&state);
                let publication = timeline.publish_lifecycle(
                    NoteLifecycleOperation::recovered(
                        NoteIdentity::new(retained_note_id),
                        forgotten_path.clone(),
                        restored_path.clone(),
                        timestamp_millis,
                    ),
                    &restored_markdown,
                    || {
                        let expected_move = crate::vault_watcher::record_expected_move(
                            &forgotten_path,
                            &restored_path,
                            &restored_markdown,
                        );
                        publish_note_move(
                            &forgotten_path,
                            &restored_path,
                            &restored_markdown,
                            &markdown,
                        )?;
                        expected_move.commit();
                        Ok(())
                    },
                );
                let publication = match publication {
                    Ok(publication) => publication,
                    Err(error) => {
                        persisted_state.forgotten_notes[index].original_path =
                            previous_original_path;
                        return Err(match write_unpruned_state(&persisted_state) {
                            Ok(()) => error,
                            Err(rollback_error) => format!(
                                "{error}; additionally failed to roll back forgotten-note recovery state: {rollback_error}"
                            ),
                        });
                    }
                };
                let commit_warning = publication.commit_warning().cloned();
                (restored_path, commit_warning)
            }
            ForgottenItemKind::Chat => {
                let conversation_id = forgotten_note
                    .conversation_id
                    .as_deref()
                    .ok_or_else(|| "Forgotten chat is missing its conversation id".to_string())?;
                let original_path = PathBuf::from(&forgotten_note.original_path);
                let relocation = chat_service.restore_conversation_folder(
                    conversation_id,
                    &forgotten_path,
                    &original_path,
                )?;
                for path in &relocation.current_paths {
                    let markdown = fs::read_to_string(path).map_err(|error| error.to_string())?;
                    let note = build_indexed_note(path, &markdown, current_time_millis()?);
                    if let Err(error) = state.upsert_managed_chat_projection(path.clone(), note) {
                        eprintln!(
                            "restored chat projection index update failed for {}: {error}",
                            path.display()
                        );
                        let _ = state.mark_notes_index_dirty(path, "restored-chat-retry");
                    }
                }
                if let Err(error) =
                    super::chat_commands::sync_chat_recall(&chat_service, &state, conversation_id)
                {
                    eprintln!(
                        "restored chat semantic recall update failed for {conversation_id}: {error}"
                    );
                }
                (original_path, None)
            }
        };

        let mut restored_note = RestoredForgottenNote {
            forgotten_path: forgotten_note.forgotten_path,
            restored_path: restored_path.to_string_lossy().into_owned(),
            title: forgotten_note.title,
            kind: forgotten_item_kind_name(&forgotten_note.kind).to_string(),
            conversation_id: forgotten_note.conversation_id,
            commit_warning,
        };
        persisted_state.forgotten_notes.remove(index);
        if let Err(error) = write_unpruned_state(&persisted_state) {
            merge_lifecycle_warning(
                &mut restored_note.commit_warning,
                MutationWarningStage::DirtyRecovery,
                "The item was recovered, but recovery bookkeeping is awaiting retry",
                error,
            );
        }
        restored_notes.push(restored_note);
    }

    Ok(restored_notes)
}

#[tauri::command]
pub(crate) fn delete_forgotten_notes(
    state: State<'_, AppState>,
    chat_service: State<'_, ChatService>,
    forgotten_paths: Vec<String>,
) -> Result<(), String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(&state))?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(());
    }

    let mut persisted_state = read_unpruned_state(&notes_dir)?;
    let mut index = 0usize;

    while index < persisted_state.forgotten_notes.len() {
        if !selected_paths.contains(&persisted_state.forgotten_notes[index].forgotten_path) {
            index += 1;
            continue;
        }

        let forgotten_note = persisted_state.forgotten_notes.remove(index);
        purge_forgotten_item(
            &state,
            &forgotten_note,
            current_time_millis()?,
            |conversation_id| chat_service.delete_archived_conversation(conversation_id),
        )?;
        write_unpruned_state(&persisted_state)?;
    }

    Ok(())
}

fn validate_retention_days(retention_days: u32) -> Result<(), String> {
    match retention_days {
        1 | 7 | 30 => Ok(()),
        _ => Err("Unsupported forgotten note retention window".to_string()),
    }
}

fn prepare_forgotten_note_markdown(
    note_markdown: &str,
    forgotten_at_rfc3339: String,
) -> Result<(String, String), String> {
    let (forgotten_markdown, metadata) = note::prepare_note_markdown(
        note_markdown,
        Some(note_markdown),
        Some(Some(forgotten_at_rfc3339)),
    )?;
    Ok((forgotten_markdown, metadata.id))
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
        kind: forgotten_item_kind_name(&forgotten_note.kind).to_string(),
        conversation_id: forgotten_note.conversation_id.clone(),
        commit_warning: None,
    }
}

fn merge_lifecycle_warning(
    warning: &mut Option<NoteMutationWarning>,
    stage: MutationWarningStage,
    message: &str,
    issue: String,
) {
    let next = NoteMutationWarning::single(stage, message.to_string(), issue);
    match warning {
        Some(warning) => warning.merge(next),
        None => *warning = Some(next),
    }
}

fn publish_note_move(
    source: &Path,
    target: &Path,
    canonical_markdown: &str,
    rollback_markdown: &str,
) -> Result<(), LifecyclePublicationFailure> {
    fs::rename(source, target)
        .map_err(|error| LifecyclePublicationFailure::not_published(error.to_string()))?;
    if let Err(error) = crate::state::atomic_write_note(target, canonical_markdown.as_bytes()) {
        let rollback = fs::rename(target, source).and_then(|_| {
            crate::state::atomic_write_note(source, rollback_markdown.as_bytes())
                .map_err(std::io::Error::other)
        });
        return Err(match rollback {
            Ok(()) => LifecyclePublicationFailure::not_published(error),
            Err(rollback_error) => LifecyclePublicationFailure::indeterminate(format!(
                "{error}; additionally failed to roll back the lifecycle file move: {rollback_error}"
            )),
        });
    }
    Ok(())
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
        if path == forgotten_root {
            return Err("The forgotten items directory cannot be selected".to_string());
        }
        selected.insert(raw_path);
    }

    Ok(selected)
}

pub(super) fn resolve_forgotten_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
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

pub(super) fn cleanup_expired_forgotten_notes(
    notes_dir: &Path,
    state: &AppState,
) -> Result<(), String> {
    NoteTimeline::new(state).recover_lifecycle_publications()?;
    let now = current_time_millis()?;
    NoteTimeline::new(state).purge_expired_missing_notes(now)?;
    let mut persisted_state = read_unpruned_state(notes_dir)?;
    let original_len = persisted_state.forgotten_notes.len();
    let mut kept_notes = Vec::with_capacity(original_len);

    for forgotten_note in persisted_state.forgotten_notes.drain(..) {
        let forgotten_path = Path::new(&forgotten_note.forgotten_path);
        let active_path = Path::new(&forgotten_note.original_path);
        if forgotten_note.kind == ForgottenItemKind::Note
            && !forgotten_path.exists()
            && active_path.is_file()
            && path_has_note_identity(state, active_path, forgotten_note.note_id.as_deref())
        {
            continue;
        }
        if forgotten_note.purge_at_millis <= now {
            purge_forgotten_item(state, &forgotten_note, now, |conversation_id| {
                ChatService::delete_persisted_conversation(
                    &crate::state::vault_data_dir()?,
                    conversation_id,
                )
            })?;
            continue;
        }
        kept_notes.push(forgotten_note);
    }

    if kept_notes.len() != original_len {
        persisted_state.forgotten_notes = kept_notes;
        write_unpruned_state(&persisted_state)?;
    }

    Ok(())
}

fn path_has_note_identity(state: &AppState, path: &Path, expected_note_id: Option<&str>) -> bool {
    let Some(expected_note_id) = expected_note_id.filter(|note_id| !note_id.trim().is_empty())
    else {
        return false;
    };
    state
        .indexed_note_identity(path)
        .ok()
        .flatten()
        .as_deref()
        .is_some_and(|note_id| note_id == expected_note_id)
        || fs::read_to_string(path)
            .ok()
            .and_then(|markdown| note::note_id_from_path_or_markdown(Some(path), &markdown))
            .as_deref()
            == Some(expected_note_id)
}

fn purge_forgotten_item(
    state: &AppState,
    forgotten_note: &PersistedForgottenNote,
    occurred_at_millis: u64,
    delete_conversation: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
    let forgotten_note_id = forgotten_note_identity(forgotten_note, &forgotten_path);
    if let Some(conversation_id) = forgotten_note.conversation_id.as_deref() {
        delete_conversation(conversation_id)?;
    }
    if let Some(note_id) = forgotten_note_id {
        NoteTimeline::new(state).lifecycle(NoteLifecycleOperation::purged(
            note_id,
            forgotten_path,
            occurred_at_millis,
        ))?;
        Ok(())
    } else if forgotten_path.exists() {
        remove_forgotten_item_path(&forgotten_path, &forgotten_note.kind)
    } else {
        Ok(())
    }
}

fn forgotten_note_identity(
    forgotten_note: &PersistedForgottenNote,
    forgotten_path: &Path,
) -> Option<NoteIdentity> {
    if forgotten_note.kind != ForgottenItemKind::Note {
        return None;
    }
    if let Some(note_id) = forgotten_note
        .note_id
        .as_deref()
        .filter(|note_id| !note_id.trim().is_empty())
    {
        return Some(NoteIdentity::new(note_id));
    }
    let markdown = fs::read_to_string(forgotten_path).ok()?;
    note::note_id_from_path_or_markdown(Some(forgotten_path), &markdown).map(NoteIdentity::new)
}

fn forgotten_item_kind_name(kind: &ForgottenItemKind) -> &'static str {
    match kind {
        ForgottenItemKind::Note => "note",
        ForgottenItemKind::Chat => "chat",
    }
}

fn remove_forgotten_item_path(path: &Path, kind: &ForgottenItemKind) -> Result<(), String> {
    match kind {
        ForgottenItemKind::Note => fs::remove_file(path).map_err(|error| error.to_string()),
        ForgottenItemKind::Chat => fs::remove_dir_all(path).map_err(|error| error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        services::note_timeline::MutationSource,
        state::set_notes_root_override,
        test_support::{lock_test_env, TestDir},
    };
    use tauri::Manager;

    fn test_context() -> tauri::Context<tauri::test::MockRuntime> {
        tauri::test::mock_context(tauri::test::noop_assets())
    }

    #[test]
    fn forgotten_note_timelines_survive_each_retention_window_and_restart_until_expiry() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("forgotten-timeline-retention-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let notes = TestDir::new("forgotten-timeline-retention-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).expect("override notes root");
        crate::state::ensure_vault_scaffold(notes.path()).expect("create vault scaffold");
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("construct app state");
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(test_context())
            .expect("build test app");
        let state = app.state::<AppState>();
        let mut retained = Vec::new();

        for retention_days in [1, 7, 30] {
            let title = format!("Retain for {retention_days} days");
            let created = crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                title.clone(),
                "Earlier retained body".to_string(),
                None,
            )
            .expect("create retained note")
            .session
            .expect("created note session");
            let note_id = NoteIdentity::new(created.note_id.expect("created note identity"));
            let active_path = PathBuf::from(created.path.expect("created note path"));
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                title.clone(),
                "Current retained body".to_string(),
                Some(active_path.to_string_lossy().into_owned()),
            )
            .expect("append retained revision");
            let access = NoteTimeline::new(&state).open_history_mode(note_id.clone());
            let revisions = access.revisions().expect("read active revisions");
            assert_eq!(
                revisions
                    .iter()
                    .map(|revision| revision.source())
                    .collect::<Vec<_>>(),
                vec![MutationSource::NoteCreation, MutationSource::Editor]
            );
            let first_revision = revisions[0].identity().as_str().to_string();

            let summary = forget_note(
                app.state(),
                Some(active_path.to_string_lossy().into_owned()),
                retention_days,
            )
            .expect("forget note")
            .expect("forgotten note summary");
            assert_eq!(summary.purge_after_days, retention_days);
            assert_eq!(
                summary.purge_at_millis - summary.forgotten_at_millis,
                u64::from(retention_days) * FORGOTTEN_DAY_MILLIS
            );
            assert_eq!(state.indexed_note_identity(&active_path).unwrap(), None);
            retained.push((
                note_id,
                active_path,
                PathBuf::from(summary.forgotten_path),
                first_revision,
            ));
        }
        assert_eq!(
            read_unpruned_state(notes.path())
                .expect("read forgotten state")
                .forgotten_notes
                .iter()
                .map(|note| note.purge_after_days)
                .collect::<Vec<_>>(),
            vec![1, 7, 30]
        );
        drop(app);

        let restarted = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("restart app state");
        let chat_service = ChatService::new(
            notes.path().to_path_buf(),
            crate::state::vault_data_dir().expect("resolve vault data"),
        )
        .expect("construct chat service");
        let restarted_app = tauri::test::mock_builder()
            .manage(restarted)
            .manage(chat_service)
            .build(test_context())
            .expect("build restarted test app");
        let restarted = restarted_app.state::<AppState>();
        cleanup_expired_forgotten_notes(notes.path(), restarted.inner())
            .expect("retain unexpired forgotten notes");
        let after_restart = read_unpruned_state(notes.path()).expect("read retained state");
        assert_eq!(
            after_restart
                .forgotten_notes
                .iter()
                .map(|note| note.purge_after_days)
                .collect::<Vec<_>>(),
            vec![1, 7, 30]
        );
        for (note_id, _, forgotten_path, first_revision) in &retained {
            assert!(forgotten_path.is_file());
            let access = NoteTimeline::new(&restarted).open_history_mode(note_id.clone());
            assert!(access.page(None, 50).unwrap_err().contains("Recover"));
            assert!(access
                .revision(first_revision)
                .unwrap_err()
                .contains("Recover"));
        }

        let (recovered_id, original_path, recovered_from, first_revision) = retained.remove(1);
        fs::write(&original_path, "Unrelated current note").expect("reuse original path");
        let restored = restore_forgotten_notes(
            restarted_app.state(),
            restarted_app.state(),
            vec![recovered_from.to_string_lossy().into_owned()],
        )
        .expect("recover forgotten note");
        assert_eq!(restored.len(), 1);
        let restored_path = PathBuf::from(&restored[0].restored_path);
        assert_ne!(restored_path, original_path);
        assert_eq!(
            fs::read_to_string(&original_path).expect("read reused path"),
            "Unrelated current note"
        );
        assert_eq!(
            note::note_id_from_path_or_markdown(
                Some(&restored_path),
                &fs::read_to_string(&restored_path).expect("read recovered note"),
            )
            .as_deref(),
            Some(recovered_id.as_str())
        );
        let recovered_access =
            NoteTimeline::new(&restarted).open_history_mode(recovered_id.clone());
        assert_eq!(recovered_access.revisions().unwrap().len(), 2);
        assert_eq!(
            recovered_access.revision(&first_revision).unwrap().body(),
            "Earlier retained body"
        );

        let mut expired = read_unpruned_state(notes.path()).expect("read recovered state");
        for forgotten_note in &mut expired.forgotten_notes {
            forgotten_note.purge_at_millis = 0;
        }
        write_unpruned_state(&expired).expect("expire forgotten notes");
        cleanup_expired_forgotten_notes(notes.path(), restarted.inner())
            .expect("purge expired forgotten notes");

        assert!(read_unpruned_state(notes.path())
            .expect("read purged state")
            .forgotten_notes
            .is_empty());
        for (note_id, _, forgotten_path, _) in retained {
            assert!(!forgotten_path.exists());
            let access = NoteTimeline::new(&restarted).open_history_mode(note_id);
            assert!(access
                .page(None, 50)
                .expect("read purged timeline")
                .records()
                .is_empty());
        }
        assert!(restored_path.is_file());
        assert_eq!(recovered_access.revisions().unwrap().len(), 2);
        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn forgotten_note_recovery_never_overwrites_a_reused_original_path() {
        let root = TestDir::new("forgotten-note-recovery-collision");
        let original_path = root.path().join("Recovered.md");
        fs::write(&original_path, "Unrelated current note").expect("occupy original path");

        let restored_path = resolve_restore_target_path(root.path(), &original_path);

        assert_ne!(restored_path, original_path);
        assert_eq!(
            fs::read_to_string(&original_path).expect("read occupied path"),
            "Unrelated current note"
        );
        assert!(!restored_path.exists());
    }

    #[test]
    fn failed_forgotten_publication_rolls_back_file_state_and_lifecycle_intent() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("forgotten-publication-rollback-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let notes = TestDir::new("forgotten-publication-rollback-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).expect("override notes root");
        crate::state::ensure_vault_scaffold(notes.path()).expect("create vault scaffold");
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("construct app state");
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(test_context())
            .expect("build test app");
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            app.state::<AppState>().inner(),
            "Rollback forgotten publication".to_string(),
            "Still active".to_string(),
            None,
        )
        .expect("create note")
        .session
        .expect("created note session");
        let note_id = NoteIdentity::new(created.note_id.expect("note identity"));
        let active_path = PathBuf::from(created.path.expect("active path"));
        let original_markdown = fs::read_to_string(&active_path).expect("read active note");
        crate::state::inject_note_publication_failure_once();

        let error = forget_note(
            app.state(),
            Some(active_path.to_string_lossy().into_owned()),
            7,
        )
        .expect_err("forget publication should fail");

        assert!(error.contains("injected note publication failure"));
        assert_eq!(
            fs::read_to_string(&active_path).expect("read rolled-back note"),
            original_markdown
        );
        assert!(read_unpruned_state(notes.path())
            .expect("read rolled-back state")
            .forgotten_notes
            .is_empty());
        assert_eq!(
            crate::services::note_timeline::retained_observation_count_for_test(),
            0
        );
        let events = NoteTimeline::new(app.state::<AppState>().inner())
            .open_history_mode(note_id)
            .lifecycle_events()
            .expect("read lifecycle events");
        assert_eq!(events.len(), 1);
        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn committed_forget_surfaces_and_recovers_deferred_lifecycle_finalization() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("forgotten-finalization-recovery-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let notes = TestDir::new("forgotten-finalization-recovery-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).expect("override notes root");
        crate::state::ensure_vault_scaffold(notes.path()).expect("create vault scaffold");
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("construct app state");
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(test_context())
            .expect("build test app");
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            app.state::<AppState>().inner(),
            "Deferred forgotten lifecycle".to_string(),
            "Retained body".to_string(),
            None,
        )
        .expect("create note")
        .session
        .expect("created note session");
        let note_id = NoteIdentity::new(created.note_id.expect("note identity"));
        let active_path = PathBuf::from(created.path.expect("active path"));
        crate::services::note_timeline::inject_lifecycle_finalization_failure_once();

        let summary = forget_note(
            app.state(),
            Some(active_path.to_string_lossy().into_owned()),
            7,
        )
        .expect("forget remains committed")
        .expect("forgotten summary");

        assert!(summary
            .commit_warning
            .as_ref()
            .is_some_and(|warning| warning
                .issues()
                .iter()
                .any(|issue| issue.stage() == MutationWarningStage::HistoryFinalization)));
        assert_eq!(
            crate::services::note_timeline::retained_observation_count_for_test(),
            1
        );
        let timeline = NoteTimeline::new(app.state::<AppState>().inner());
        timeline
            .recover_lifecycle_publications()
            .expect("retry lifecycle publication");
        assert_eq!(
            crate::services::note_timeline::retained_observation_count_for_test(),
            0
        );
        assert_eq!(
            timeline
                .open_history_mode(note_id)
                .lifecycle_events()
                .expect_err("forgotten history stays gated"),
            "Recover the forgotten note before accessing its Note Timeline"
        );
        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn chat_folder_uses_the_forgotten_item_recovery_lifecycle() {
        let _guard = lock_test_env();
        let root = TestDir::new("forgotten-chat-folder");
        set_notes_root_override(Some(root.path().to_path_buf())).expect("override notes root");
        let original_path = root.path().join("Chats").join("2026-07-28-chat");
        let forgotten_path = root.path().join(".forgotten").join("2026-07-28-chat");
        fs::create_dir_all(&forgotten_path).expect("create forgotten chat folder");
        fs::write(forgotten_path.join("Conversation.md"), "# Release planning")
            .expect("write conversation index");
        fs::write(forgotten_path.join("Part 001.md"), "## You\n\nShip it")
            .expect("write transcript part");

        let summary = register_forgotten_chat_folder(
            root.path(),
            &original_path,
            &forgotten_path,
            "Release planning",
            "conversation-1",
            7,
        )
        .expect("register forgotten chat folder");

        assert!(forgotten_path.starts_with(root.path().join(".forgotten")));
        assert!(forgotten_path.is_dir());
        assert_eq!(summary.original_path, original_path.to_string_lossy());
        assert_eq!(summary.purge_after_days, 7);
        assert_eq!(summary.kind, "chat");
        assert_eq!(summary.conversation_id.as_deref(), Some("conversation-1"));

        let persisted_state = read_state(root.path()).expect("read forgotten note state");
        assert_eq!(persisted_state.forgotten_notes.len(), 1);
        assert_eq!(
            persisted_state.forgotten_notes[0].forgotten_path,
            forgotten_path.to_string_lossy()
        );
        assert_eq!(
            persisted_state.forgotten_notes[0].kind,
            ForgottenItemKind::Chat
        );

        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn expired_chat_folder_deletes_the_archive_and_conversation_history() {
        let _guard = lock_test_env();
        let root = TestDir::new("expired-forgotten-chat-folder");
        set_notes_root_override(Some(root.path().to_path_buf())).expect("override notes root");
        let data_dir = root.path().join(".gneauxghts");
        fs::create_dir_all(&data_dir).expect("create vault data");
        let service =
            ChatService::new(root.path().to_path_buf(), data_dir).expect("create chat service");
        let conversation = service
            .create_conversation(Some("Temporary chat".to_string()), None)
            .expect("create conversation");
        let snapshot = service
            .forgotten_folder_snapshot(&conversation.summary.id)
            .expect("load folder snapshot");
        let forgotten_root = forgotten_notes_root(root.path());
        fs::create_dir_all(&forgotten_root).expect("create forgotten root");
        let forgotten_path = resolve_forgotten_target_path(root.path(), &snapshot.original_path);
        service
            .archive_conversation_folder(&conversation.summary.id, &forgotten_path)
            .expect("archive conversation folder");
        register_forgotten_chat_folder(
            root.path(),
            &snapshot.original_path,
            &forgotten_path,
            &snapshot.title,
            &conversation.summary.id,
            1,
        )
        .expect("register forgotten chat");

        let mut persisted_state = read_state(root.path()).expect("read forgotten state");
        persisted_state.forgotten_notes[0].forgotten_at_millis = 0;
        persisted_state.forgotten_notes[0].purge_at_millis = 0;
        write_state(root.path(), &persisted_state).expect("expire forgotten chat");

        let app_data = TestDir::new("expired-forgotten-chat-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("construct app state");
        cleanup_expired_forgotten_notes(root.path(), &state).expect("clean up expired chat");

        assert!(!forgotten_path.exists());
        assert!(service.get_conversation(&conversation.summary.id).is_err());
        assert!(read_state(root.path())
            .expect("read cleaned state")
            .forgotten_notes
            .is_empty());

        set_notes_root_override(None).expect("clear notes root override");
    }

    #[test]
    fn persisted_identity_survives_an_unreadable_forgotten_note() {
        let forgotten_note = PersistedForgottenNote {
            forgotten_path: "/vault/.forgotten/Missing.md".to_string(),
            original_path: "/vault/Missing.md".to_string(),
            title: "Missing".to_string(),
            forgotten_at_millis: 10,
            purge_after_days: 7,
            purge_at_millis: 20,
            kind: ForgottenItemKind::Note,
            conversation_id: None,
            note_id: Some("forgotten-note-1".to_string()),
        };

        assert_eq!(
            forgotten_note_identity(&forgotten_note, Path::new(&forgotten_note.forgotten_path)),
            Some(NoteIdentity::new("forgotten-note-1"))
        );
    }

    #[test]
    fn forgetting_an_unmanaged_note_uses_the_generated_managed_identity() {
        let (forgotten_markdown, note_id) = prepare_forgotten_note_markdown(
            "# Existing note\n\nBody",
            "2026-09-01T12:00:00.000Z".to_string(),
        )
        .expect("prepare forgotten note");

        assert!(!note_id.is_empty());
        assert_eq!(
            note::parse_note(&forgotten_markdown)
                .frontmatter
                .managed
                .map(|metadata| metadata.id),
            Some(note_id)
        );
    }

    #[test]
    fn forget_and_recovery_preserve_the_same_managed_note_identity() {
        let original =
            "---\ngneauxghts:\n  id: lifecycle-note-1\n  kind: note\n---\n\nLifecycle body";
        let (forgotten_markdown, forgotten_id) =
            prepare_forgotten_note_markdown(original, "2026-09-01T12:00:00.000Z".to_string())
                .expect("prepare forgotten note");
        let restored_markdown =
            note::prepare_note_markdown(&forgotten_markdown, Some(&forgotten_markdown), Some(None))
                .expect("prepare recovered note")
                .0;

        assert_eq!(forgotten_id, "lifecycle-note-1");
        assert_eq!(
            note::note_id_from_path_or_markdown(None, &restored_markdown).as_deref(),
            Some("lifecycle-note-1")
        );
        assert!(note::parse_note(&restored_markdown)
            .frontmatter
            .managed
            .expect("managed metadata")
            .trashed_at
            .is_none());
    }

    #[test]
    fn damaged_metadata_uses_catalog_identity_through_forget_and_recovery() {
        // The timeline prepares this canonical input before lifecycle
        // metadata transformation and the original atomic publication.
        let repaired = "---\ngneauxghts:\n  id: known-before-damage\n  kind: note\n---\n\nAuthored content without managed metadata";
        let (forgotten_markdown, forgotten_id) =
            prepare_forgotten_note_markdown(repaired, "2026-09-01T12:00:00.000Z".to_string())
                .expect("prepare damaged forgotten note");
        assert_eq!(forgotten_id, "known-before-damage");

        let recovered =
            note::prepare_note_markdown(&forgotten_markdown, Some(&forgotten_markdown), Some(None))
                .expect("recover damaged forgotten note")
                .0;
        assert_eq!(
            note::parse_note(&recovered)
                .frontmatter
                .managed
                .expect("recovered managed metadata")
                .id,
            "known-before-damage"
        );
    }
}
