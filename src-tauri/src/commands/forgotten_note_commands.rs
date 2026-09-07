use super::{current_time_millis, ForgottenNoteSummary, RestoredForgottenNote};
pub(super) use crate::services::note_timeline::resolve_forgotten_target_path;
#[cfg(test)]
use crate::services::note_timeline::{LifecyclePublicationFailure, NoteIdentity};
use crate::{
    chat::ChatService,
    index::{build_indexed_note, AppState},
    note,
    services::note_timeline::{MutationWarningStage, NoteMutationWarning},
    state::{
        db_finish_forgetting, db_insert_forgotten_note, db_remove_forgotten_note,
        forgotten_notes_root, read_state, read_unpruned_state, validate_current_path,
        ForgottenItemKind, PersistedForgottenNote,
    },
};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[cfg(test)]
use crate::services::note_timeline::{
    forgotten_note_identity, prepare_forgotten_note_markdown, publish_note_move,
    resolve_restore_target_path, AFTER_FORGET_METADATA_STAGED, BEFORE_FORGOTTEN_PUBLICATION,
};
#[cfg(test)]
static BEFORE_FORGOTTEN_PURGE: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>> =
    std::sync::Mutex::new(None);

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
pub(crate) async fn forget_note<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    current_path: Option<String>,
    retention_days: u32,
) -> Result<Option<ForgottenNoteSummary>, String> {
    super::on_app_worker(app.clone(), move |state| {
        forget_note_with_state(state, current_path, retention_days)
    })
    .await?
}

pub(crate) fn forget_note_with_state(
    state: &AppState,
    current_path: Option<String>,
    retention_days: u32,
) -> Result<Option<ForgottenNoteSummary>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(state))?;

    let current_path = validate_current_path(current_path, &notes_dir)?;
    if let Some(note_path) = current_path.as_ref() {
        let (forgotten_note, commit_warning) = state
            .note_timeline()
            .forget_note(note_path, retention_days)
            .map_err(|error| error.to_string())?;
        let mut summary = build_forgotten_note_summary(&forgotten_note);
        summary.commit_warning = commit_warning;
        return Ok(Some(summary));
    }

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

    let forgotten_note = PersistedForgottenNote {
        note_id: None,
        forgotten_path: forgotten_path.to_string_lossy().into_owned(),
        original_path: original_path.to_string_lossy().into_owned(),
        title: title.to_string(),
        forgotten_at_millis,
        purge_after_days: retention_days,
        purge_at_millis,
        kind: ForgottenItemKind::Chat,
        conversation_id: Some(conversation_id.to_string()),
    };
    db_insert_forgotten_note(&forgotten_note)?;
    let mut summary = build_forgotten_note_summary(&forgotten_note);
    if let Err(error) = db_finish_forgetting(&forgotten_note) {
        merge_lifecycle_warning(
            &mut summary.commit_warning,
            MutationWarningStage::DirtyRecovery,
            "The chat was forgotten, but navigation bookkeeping is awaiting retry",
            error,
        );
    }
    Ok(summary)
}

#[tauri::command]
pub(crate) async fn list_forgotten_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ForgottenNoteSummary>, String> {
    super::on_app_worker(app, move |state| {
        let notes_dir = super::prepare_notes_dir_with_state(true, Some(state))?;

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
    })
    .await?
}

#[tauri::command]
pub(crate) async fn restore_forgotten_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    forgotten_paths: Vec<String>,
) -> Result<Vec<RestoredForgottenNote>, String> {
    super::on_app_worker(app.clone(), move |state| {
        let chat_service = app
            .try_state::<ChatService>()
            .ok_or_else(|| "Application state unavailable".to_string())?;
        restore_forgotten_notes_with_state(state, &chat_service, forgotten_paths)
    })
    .await?
}

pub(crate) fn restore_forgotten_notes_with_state(
    state: &AppState,
    chat_service: &ChatService,
    forgotten_paths: Vec<String>,
) -> Result<Vec<RestoredForgottenNote>, String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(state))?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut restored_notes = Vec::new();
    for forgotten_note in read_state(&notes_dir)?
        .forgotten_notes
        .into_iter()
        .filter(|item| selected_paths.contains(&item.forgotten_path))
    {
        let forgotten_path = PathBuf::from(&forgotten_note.forgotten_path);
        let (restored_path, commit_warning) = match forgotten_note.kind {
            ForgottenItemKind::Note => {
                let Some(restored) = state
                    .note_timeline()
                    .recover_forgotten_note(&forgotten_note)
                    .map_err(|error| error.to_string())?
                else {
                    continue;
                };
                restored
            }
            ForgottenItemKind::Chat => {
                if !forgotten_path.is_dir() {
                    db_remove_forgotten_note(&forgotten_note)?;
                    continue;
                }
                let conversation_id = forgotten_note
                    .conversation_id
                    .as_deref()
                    .ok_or_else(|| "Forgotten chat is missing its conversation id".to_string())?;
                let original_path = PathBuf::from(&forgotten_note.original_path);
                let (relocation, metadata_warning) = crate::state::with_note_file_mutation(|| {
                    if !crate::state::db_forgotten_note_matches(&forgotten_note)? {
                        return Err("The forgotten item changed before recovery".to_string());
                    }
                    let relocation = chat_service.restore_conversation_folder(
                        conversation_id,
                        &forgotten_path,
                        &original_path,
                    )?;
                    let warning = db_remove_forgotten_note(&forgotten_note).err().map(|error| {
                        NoteMutationWarning::single(
                            MutationWarningStage::DirtyRecovery,
                            "The chat was recovered, but recovery bookkeeping is awaiting retry".to_string(),
                            error,
                        )
                    });
                    Ok::<_, String>((relocation, warning))
                })?;
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
                    super::chat_commands::sync_chat_recall(chat_service, state, conversation_id)
                {
                    eprintln!(
                        "restored chat semantic recall update failed for {conversation_id}: {error}"
                    );
                }
                (original_path, metadata_warning)
            }
        };

        let restored_note = RestoredForgottenNote {
            forgotten_path: forgotten_note.forgotten_path,
            restored_path: restored_path.to_string_lossy().into_owned(),
            title: forgotten_note.title,
            kind: forgotten_item_kind_name(&forgotten_note.kind).to_string(),
            conversation_id: forgotten_note.conversation_id,
            commit_warning,
        };
        restored_notes.push(restored_note);
    }

    Ok(restored_notes)
}

#[tauri::command]
pub(crate) async fn delete_forgotten_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    forgotten_paths: Vec<String>,
) -> Result<(), String> {
    super::on_app_worker(app.clone(), move |state| {
        let chat_service = app
            .try_state::<ChatService>()
            .ok_or_else(|| "Application state unavailable".to_string())?;
        delete_forgotten_notes_with_state(state, &chat_service, forgotten_paths)
    })
    .await?
}

pub(crate) fn delete_forgotten_notes_with_state(
    state: &AppState,
    chat_service: &ChatService,
    forgotten_paths: Vec<String>,
) -> Result<(), String> {
    let notes_dir = super::prepare_notes_dir_with_state(true, Some(state))?;

    let selected_paths = validate_forgotten_path_inputs(forgotten_paths, &notes_dir)?;
    if selected_paths.is_empty() {
        return Ok(());
    }

    for forgotten_note in read_unpruned_state(&notes_dir)?
        .forgotten_notes
        .into_iter()
        .filter(|item| selected_paths.contains(&item.forgotten_path))
    {
        purge_forgotten_item(
            state,
            &forgotten_note,
            current_time_millis()?,
            |conversation_id| chat_service.delete_archived_conversation(conversation_id),
        )?;
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

pub(super) fn cleanup_expired_forgotten_notes(
    notes_dir: &Path,
    state: &AppState,
) -> Result<(), String> {
    state.note_timeline().recover_lifecycle_publications()?;
    let now = current_time_millis()?;
    state.note_timeline().purge_expired_missing_notes(now)?;
    for forgotten_note in read_unpruned_state(notes_dir)?.forgotten_notes {
        let forgotten_path = Path::new(&forgotten_note.forgotten_path);
        let active_path = Path::new(&forgotten_note.original_path);
        let recovered = crate::state::with_note_file_mutation(|| {
            if forgotten_note.kind == ForgottenItemKind::Note
                && !forgotten_path.exists()
                && active_path.is_file()
                && path_has_note_identity(state, active_path, forgotten_note.note_id.as_deref())
            {
                db_remove_forgotten_note(&forgotten_note)?;
                Ok::<_, String>(true)
            } else {
                Ok(false)
            }
        })?;
        if recovered {
            continue;
        }
        if forgotten_note.purge_at_millis <= now {
            purge_forgotten_item(state, &forgotten_note, now, |conversation_id| {
                ChatService::delete_persisted_conversation(
                    &crate::state::vault_data_dir()?,
                    conversation_id,
                )
            })?;
        }
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
    #[cfg(test)]
    {
        let hook = BEFORE_FORGOTTEN_PURGE.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
    }
    if forgotten_note.kind == ForgottenItemKind::Note {
        state
            .note_timeline()
            .purge_selected_forgotten_note(forgotten_note, occurred_at_millis)?;
        Ok(())
    } else {
        crate::state::with_note_file_mutation(|| {
            if !crate::state::db_forgotten_note_matches(forgotten_note)? {
                return Err("The forgotten item changed before deletion".to_string());
            }
            if let Some(conversation_id) = forgotten_note.conversation_id.as_deref() {
                delete_conversation(conversation_id)?;
            }
            if forgotten_path.exists() {
                remove_forgotten_item_path(&forgotten_path, &forgotten_note.kind)?;
            }
            db_remove_forgotten_note(forgotten_note)?;
            Ok(())
        })
    }
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
    use crate::state::{db_set_forgotten_original_path, write_state, write_unpruned_state};
    use crate::{
        services::note_timeline::{
            corrupt_note_revision_payload_for_test, HistoryDiffComparison, HistoryHealthState,
            LifecycleEventKind, MutationSource,
        },
        state::set_notes_root_override,
        test_support::{lock_test_env, TestDir},
    };
    use tauri::Manager;

    fn test_context() -> tauri::Context<tauri::test::MockRuntime> {
        tauri::test::mock_context(tauri::test::noop_assets())
    }

    #[test]
    fn a_save_committed_after_forget_read_is_not_replaced_by_stale_lifecycle_bytes() {
        let _guard = lock_test_env();
        let data = TestDir::new("concurrent-save-forget-data");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        let notes = TestDir::new("concurrent-save-forget-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let app = tauri::test::mock_builder()
            .manage(
                AppState::new(
                    crate::semantic::SemanticState::new_disabled("disabled"),
                    crate::app::EventBus::disabled(),
                )
                .unwrap(),
            )
            .build(test_context())
            .unwrap();
        let state = app.state::<AppState>();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Save then forget".into(),
            "Before".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let path = created.path.unwrap();
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        *BEFORE_FORGOTTEN_PUBLICATION.lock().unwrap() = Some(Box::new(move || {
            read_tx.send(()).unwrap();
            release_rx
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
        }));
        std::thread::scope(|scope| {
            let forgetting = scope.spawn(|| forget_note_with_state(&state, Some(path.clone()), 7));
            read_rx
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                "Save then forget".into(),
                "Newer committed typing".into(),
                Some(path.clone()),
            )
            .unwrap();
            let committed = fs::read(&path).unwrap();
            release_tx.send(()).unwrap();
            assert!(forgetting
                .join()
                .unwrap()
                .unwrap_err()
                .contains("note changed"));
            assert_eq!(fs::read(&path).unwrap(), committed);
        });
        assert!(read_unpruned_state(notes.path())
            .unwrap()
            .forgotten_notes
            .is_empty());
        assert_eq!(
            crate::services::note_timeline::retained_observation_count_for_test(),
            0
        );
        set_notes_root_override(None).unwrap();
    }

    #[test]
    fn restored_note_and_history_survive_a_purge_selected_before_recovery() {
        let _guard = lock_test_env();
        for (cleanup, forget_again) in [(false, false), (true, false), (false, true), (true, true)]
        {
            let data = TestDir::new("restore-stale-purge-data");
            crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
            let notes = TestDir::new("restore-stale-purge-notes");
            set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
            crate::state::ensure_vault_scaffold(notes.path()).unwrap();
            let service =
                ChatService::new(notes.path().to_path_buf(), notes.path().join(".gneauxghts"))
                    .unwrap();
            let app = tauri::test::mock_builder()
                .manage(service)
                .manage(
                    AppState::new(
                        crate::semantic::SemanticState::new_disabled("disabled"),
                        crate::app::EventBus::disabled(),
                    )
                    .unwrap(),
                )
                .build(test_context())
                .unwrap();
            let state = app.state::<AppState>();
            let chat = app.state::<ChatService>();
            let created = crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                "Retain restored history".into(),
                "Retained body".into(),
                None,
            )
            .unwrap()
            .unwrap();
            let note_id = NoteIdentity::new(created.note_id.unwrap());
            let forgotten = forget_note_with_state(&state, created.path, 7)
                .unwrap()
                .unwrap();
            if cleanup {
                let mut expired = read_unpruned_state(notes.path()).unwrap();
                expired.forgotten_notes[0].forgotten_at_millis = 0;
                expired.forgotten_notes[0].purge_at_millis = 1;
                write_unpruned_state(&expired).unwrap();
            }
            let (selected_tx, selected_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            *BEFORE_FORGOTTEN_PURGE.lock().unwrap() = Some(Box::new(move || {
                selected_tx.send(()).unwrap();
                release_rx
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .unwrap();
            }));
            std::thread::scope(|scope| {
                let deleting = scope.spawn(|| {
                    if cleanup {
                        cleanup_expired_forgotten_notes(notes.path(), &state)
                    } else {
                        delete_forgotten_notes_with_state(
                            &state,
                            &chat.clone(),
                            vec![forgotten.forgotten_path.clone()],
                        )
                    }
                });
                selected_rx
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .unwrap();
                let restored = restore_forgotten_notes_with_state(
                    &state,
                    &chat.clone(),
                    vec![forgotten.forgotten_path.clone()],
                )
                .unwrap();
                let retained_path = if forget_again {
                    let forgotten_again =
                        forget_note_with_state(&state, Some(restored[0].restored_path.clone()), 30)
                            .unwrap()
                            .unwrap();
                    assert_eq!(forgotten_again.forgotten_path, forgotten.forgotten_path);
                    forgotten_again.forgotten_path
                } else {
                    restored[0].restored_path.clone()
                };
                let committed = fs::read(&retained_path).unwrap();
                release_tx.send(()).unwrap();
                let error = deleting.join().unwrap().unwrap_err();
                assert!(
                    error.contains(if forget_again {
                        "changed before deletion"
                    } else {
                        "moved or was recovered"
                    }),
                    "{error}"
                );
                assert_eq!(fs::read(&retained_path).unwrap(), committed);
                if forget_again {
                    let retained = read_unpruned_state(notes.path()).unwrap();
                    assert_eq!(retained.forgotten_notes.len(), 1);
                    assert_eq!(retained.forgotten_notes[0].purge_after_days, 30);
                    restore_forgotten_notes_with_state(
                        &state,
                        &chat.clone(),
                        vec![retained_path.clone()],
                    )
                    .unwrap();
                }
                assert!(!state
                    .note_timeline()
                    .open_history_mode(note_id.clone())
                    .revisions()
                    .unwrap()
                    .is_empty());
                assert!(state
                    .note_timeline()
                    .open_history_mode(note_id.clone())
                    .lifecycle_events()
                    .unwrap()
                    .iter()
                    .any(|event| event.kind() == LifecycleEventKind::Recovered));
            });
            set_notes_root_override(None).unwrap();
        }
    }

    #[test]
    fn restored_chat_survives_a_stale_selected_or_expired_purge() {
        let _guard = lock_test_env();
        for (cleanup, archive_again) in [(false, false), (true, false), (false, true), (true, true)]
        {
            let data = TestDir::new("restore-stale-chat-purge-data");
            crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
            let notes = TestDir::new("restore-stale-chat-purge-notes");
            set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
            crate::state::ensure_vault_scaffold(notes.path()).unwrap();
            let service =
                ChatService::new(notes.path().to_path_buf(), notes.path().join(".gneauxghts"))
                    .unwrap();
            let conversation = service
                .create_conversation(Some("Keep restored conversation".into()), None)
                .unwrap();
            let app = tauri::test::mock_builder()
                .manage(service)
                .manage(
                    AppState::new(
                        crate::semantic::SemanticState::new_disabled("disabled"),
                        crate::app::EventBus::disabled(),
                    )
                    .unwrap(),
                )
                .build(test_context())
                .unwrap();
            let state = app.state::<AppState>();
            let chat = app.state::<ChatService>();
            let forgotten = super::super::chat_commands::archive_conversation_with_state(
                &chat.clone(),
                &state,
                conversation.summary.id.clone(),
                true,
                7,
            )
            .unwrap()
            .unwrap();
            if cleanup {
                let mut expired = read_unpruned_state(notes.path()).unwrap();
                expired.forgotten_notes[0].forgotten_at_millis = 0;
                expired.forgotten_notes[0].purge_at_millis = 1;
                write_unpruned_state(&expired).unwrap();
            }
            let (selected_tx, selected_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            *BEFORE_FORGOTTEN_PURGE.lock().unwrap() = Some(Box::new(move || {
                selected_tx.send(()).unwrap();
                release_rx
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .unwrap();
            }));
            std::thread::scope(|scope| {
                let deleting = scope.spawn(|| {
                    if cleanup {
                        cleanup_expired_forgotten_notes(notes.path(), &state)
                    } else {
                        delete_forgotten_notes_with_state(
                            &state,
                            &chat.clone(),
                            vec![forgotten.forgotten_path.clone()],
                        )
                    }
                });
                selected_rx
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .unwrap();
                let restored = restore_forgotten_notes_with_state(
                    &state,
                    &chat.clone(),
                    vec![forgotten.forgotten_path.clone()],
                )
                .unwrap();
                let retained_path = if archive_again {
                    let archived = super::super::chat_commands::archive_conversation_with_state(
                        &chat.clone(),
                        &state,
                        conversation.summary.id.clone(),
                        true,
                        30,
                    )
                    .unwrap()
                    .unwrap();
                    assert_eq!(archived.forgotten_path, forgotten.forgotten_path);
                    archived.forgotten_path
                } else {
                    restored[0].restored_path.clone()
                };
                release_tx.send(()).unwrap();
                assert!(deleting
                    .join()
                    .unwrap()
                    .unwrap_err()
                    .contains("changed before deletion"));
                assert!(Path::new(&retained_path).is_dir());
                let retained = chat.get_conversation(&conversation.summary.id).unwrap();
                assert_eq!(
                    retained.summary.status,
                    if archive_again { "archived" } else { "active" }
                );
                let records = read_unpruned_state(notes.path()).unwrap().forgotten_notes;
                assert_eq!(records.len(), usize::from(archive_again));
                if archive_again {
                    assert_eq!(records[0].purge_after_days, 30);
                }
            });
            set_notes_root_override(None).unwrap();
        }
    }

    #[test]
    fn concurrent_archive_and_failed_forget_preserve_only_owned_metadata_and_navigation() {
        let _guard = lock_test_env();
        let data = TestDir::new("concurrent-forgotten-data");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        let notes = TestDir::new("concurrent-forgotten-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let service =
            ChatService::new(notes.path().to_path_buf(), notes.path().join(".gneauxghts")).unwrap();
        let conversation = service
            .create_conversation(Some("Concurrent archive".into()), None)
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(service)
            .manage(
                AppState::new(
                    crate::semantic::SemanticState::new_disabled("disabled"),
                    crate::app::EventBus::disabled(),
                )
                .unwrap(),
            )
            .build(test_context())
            .unwrap();
        let state = app.state::<AppState>();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Failed forget".into(),
            "Keep canonical prose".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let path = created.path.unwrap();
        let original = fs::read(&path).unwrap();
        crate::state::db_mark_note_opened(created.note_id.as_deref().unwrap()).unwrap();
        let (staged_tx, staged_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        *AFTER_FORGET_METADATA_STAGED.lock().unwrap() = Some(Box::new(move || {
            staged_tx.send(()).unwrap();
            release_rx
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
        }));
        let summary = std::thread::scope(|scope| {
            let failed = scope.spawn(|| forget_note_with_state(&state, Some(path.clone()), 7));
            staged_rx
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
            let (cleanup_tx, cleanup_rx) = std::sync::mpsc::channel();
            let cleanup_state = state.clone();
            let cleanup_root = notes.path();
            let cleanup = scope.spawn(move || {
                let result = cleanup_expired_forgotten_notes(cleanup_root, &cleanup_state);
                cleanup_tx.send(()).unwrap();
                result
            });
            assert!(cleanup_rx
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_err());
            let (archive_tx, archive_rx) = std::sync::mpsc::channel();
            let archive_state = state.clone();
            let archive_chat = app.state::<ChatService>();
            let archive_id = conversation.summary.id.clone();
            let archive = scope.spawn(move || {
                let result = super::super::chat_commands::archive_conversation_with_state(
                    &archive_chat,
                    &archive_state,
                    archive_id,
                    true,
                    7,
                );
                archive_tx.send(()).unwrap();
                result
            });
            assert!(archive_rx
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_err());
            crate::state::db_mark_note_opened("concurrent-selection").unwrap();
            crate::state::db_set_note_pinned("concurrent-pin", true).unwrap();
            crate::state::db_set_note_hidden("concurrent-hidden", true).unwrap();
            crate::state::db_set_note_collapsed("concurrent-collapsed", true).unwrap();
            crate::state::db_set_note_order(&["concurrent-order".into()]).unwrap();
            crate::state::db_set_last_chat_location(
                "concurrent-chat",
                Some("context"),
                Some("context.md"),
            )
            .unwrap();
            crate::state::inject_note_publication_failure_once();
            release_tx.send(()).unwrap();
            assert!(failed
                .join()
                .unwrap()
                .unwrap_err()
                .contains("injected note publication failure"));
            cleanup.join().unwrap().unwrap();
            archive.join().unwrap().unwrap().unwrap()
        });
        let after = read_unpruned_state(notes.path()).unwrap();
        assert_eq!(after.forgotten_notes.len(), 1);
        assert_eq!(
            after.forgotten_notes[0].forgotten_path,
            summary.forgotten_path
        );
        assert_eq!(
            after.last_opened_note_id.as_deref(),
            Some("concurrent-selection")
        );
        assert_eq!(after.recent_note_ids[0], "concurrent-selection");
        assert_eq!(after.pinned_note_ids, ["concurrent-pin"]);
        assert_eq!(after.hidden_note_ids, ["concurrent-hidden"]);
        assert_eq!(after.collapsed_note_ids, ["concurrent-collapsed"]);
        assert_eq!(after.note_order_note_ids, ["concurrent-order"]);
        assert_eq!(
            after.last_chat_conversation_id.as_deref(),
            Some("concurrent-chat")
        );
        assert_eq!(after.last_chat_context_note_id.as_deref(), Some("context"));
        assert_eq!(
            after.last_chat_context_note_path.as_deref(),
            Some("context.md")
        );
        assert_eq!(fs::read(path).unwrap(), original);
        set_notes_root_override(None).unwrap();
    }

    #[test]
    fn a_destination_created_after_move_planning_is_never_overwritten() {
        let dir = TestDir::new("concurrent-restore-destination");
        let source = dir.path().join("source.md");
        let target = dir.path().join("target.md");
        fs::write(&source, "source").unwrap();
        fs::write(&target, "concurrent recovery").unwrap();
        assert!(matches!(
            publish_note_move(&source, &target, "new", "source"),
            Err(LifecyclePublicationFailure::NotPublished(_))
        ));
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        assert_eq!(fs::read_to_string(&target).unwrap(), "concurrent recovery");
    }

    #[test]
    fn stale_forgotten_rollback_and_startup_pruning_preserve_newer_rows_and_selection() {
        let _guard = lock_test_env();
        let data = TestDir::new("scoped-forgotten-data");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        let notes = TestDir::new("scoped-forgotten-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let entry = PersistedForgottenNote {
            note_id: Some("old".into()),
            forgotten_path: "forgotten.md".into(),
            original_path: "original.md".into(),
            title: "Owned row".into(),
            forgotten_at_millis: 1,
            purge_after_days: 7,
            purge_at_millis: 100,
            kind: ForgottenItemKind::Note,
            conversation_id: None,
        };
        db_insert_forgotten_note(&entry).unwrap();
        db_set_forgotten_original_path(&entry, "replacement.md").unwrap();
        assert!(!db_remove_forgotten_note(&entry).unwrap());
        assert!(db_set_forgotten_original_path(&entry, "obsolete.md").is_err());
        crate::state::db_mark_note_opened("old").unwrap();
        let previous = read_unpruned_state(notes.path()).unwrap();
        let mut pruned = previous.clone();
        pruned.last_opened_note_id = None;
        pruned.recent_note_ids.clear();
        crate::state::db_mark_note_opened("new-selection").unwrap();
        crate::state::db_prune_recent_state(&previous, &pruned).unwrap();
        crate::state::db_record_session_restore("old").unwrap();
        let after = read_unpruned_state(notes.path()).unwrap();
        assert_eq!(after.last_opened_note_id.as_deref(), Some("new-selection"));
        assert_eq!(after.recent_note_ids, ["new-selection"]);
        assert_eq!(after.forgotten_notes[0].original_path, "replacement.md");
        set_notes_root_override(None).unwrap();
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
            state
                .note_timeline()
                .finalize_editing_window(&note_id)
                .unwrap();
            let access = state.note_timeline().open_history_mode(note_id.clone());
            let revisions = access.revisions().expect("read active revisions");
            assert_eq!(
                revisions
                    .iter()
                    .map(|revision| revision.source())
                    .collect::<Vec<_>>(),
                vec![MutationSource::NoteCreation, MutationSource::Editor]
            );
            let first_revision = revisions[0].identity().as_str().to_string();

            let summary = forget_note_with_state(
                &app.state(),
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
            let access = restarted.note_timeline().open_history_mode(note_id.clone());
            assert!(access
                .page(None, 50)
                .unwrap_err()
                .to_string()
                .contains("Recover"));
            assert!(access
                .revision(first_revision)
                .unwrap_err()
                .to_string()
                .contains("Recover"));
        }

        let (recovered_id, original_path, recovered_from, first_revision) = retained.remove(1);
        fs::write(&original_path, "Unrelated current note").expect("reuse original path");
        let restored = restore_forgotten_notes_with_state(
            &restarted_app.state(),
            &restarted_app.state(),
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
        let recovered_access = restarted
            .note_timeline()
            .open_history_mode(recovered_id.clone());
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
            let access = restarted.note_timeline().open_history_mode(note_id);
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
    fn history_reset_rebaselines_a_forgotten_note_for_recovery_after_restart() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("forgotten-reset-recovery-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let notes = TestDir::new("forgotten-reset-recovery-notes");
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
            "Reset forgotten history".to_string(),
            "Earlier body".to_string(),
            None,
        )
        .expect("create note")
        .expect("created note session");
        let note_id = NoteIdentity::new(created.note_id.expect("note identity"));
        let active_path = PathBuf::from(created.path.expect("active path"));
        crate::commands::note_persistence::persist_note_session_with_outcome(
            app.state::<AppState>().inner(),
            "Reset forgotten history".to_string(),
            "Current retained body".to_string(),
            Some(active_path.to_string_lossy().into_owned()),
        )
        .expect("append current revision");
        let forgotten = forget_note_with_state(
            &app.state(),
            Some(active_path.to_string_lossy().into_owned()),
            30,
        )
        .expect("forget note")
        .expect("forgotten note summary");
        let forgotten_path = PathBuf::from(&forgotten.forgotten_path);
        let retained_deadline = forgotten.purge_at_millis;
        fs::write(&forgotten_path, "Current retained body")
            .expect("damage only the forgotten note's managed metadata");
        let damaged_forgotten_bytes = fs::read(&forgotten_path).expect("read damaged note");
        corrupt_note_revision_payload_for_test(&note_id);
        let app_state = app.state::<AppState>();
        let timeline = app_state.note_timeline();
        assert_eq!(
            timeline
                .history_health()
                .expect("detect corruption")
                .state(),
            HistoryHealthState::Corrupt
        );

        let reset = timeline
            .reset_corrupt_history(notes.path(), true)
            .expect("reset and rebuild history");

        assert_eq!(reset.initialization().discovered_notes(), 1);
        assert_eq!(reset.initialization().baseline_revisions(), 1);
        assert_eq!(
            fs::read(&forgotten_path).expect("read untouched forgotten note"),
            damaged_forgotten_bytes
        );
        assert!(app
            .state::<AppState>()
            .note_timeline()
            .open_history_mode(note_id.clone())
            .page(None, 50)
            .expect_err("forgotten timeline remains gated")
            .to_string()
            .contains("Recover"));
        drop(app);

        let restarted_state = AppState::new(
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
            .manage(restarted_state)
            .manage(chat_service)
            .build(test_context())
            .expect("build restarted test app");
        let retained = read_unpruned_state(notes.path()).expect("read forgotten state");
        assert_eq!(retained.forgotten_notes.len(), 1);
        assert_eq!(
            retained.forgotten_notes[0].note_id.as_deref(),
            Some(note_id.as_str())
        );
        assert_eq!(
            retained.forgotten_notes[0].forgotten_path,
            forgotten.forgotten_path
        );
        assert_eq!(
            retained.forgotten_notes[0].purge_at_millis,
            retained_deadline
        );

        let restored = restore_forgotten_notes_with_state(
            &restarted_app.state(),
            &restarted_app.state(),
            vec![forgotten_path.to_string_lossy().into_owned()],
        )
        .expect("recover forgotten note");
        assert_eq!(restored.len(), 1);
        let restored_path = PathBuf::from(&restored[0].restored_path);
        let restarted_state = restarted_app.state::<AppState>();
        let access = restarted_state.note_timeline().open_history_mode(note_id);
        let revisions = access.revisions().expect("read rebuilt revisions");
        assert_eq!(revisions.len(), 1);
        assert_eq!(
            revisions[0].source(),
            MutationSource::BaselineInitialization
        );
        assert_eq!(
            access
                .reconstruct(revisions[0].identity())
                .expect("reconstruct rebuilt baseline")
                .body(),
            "Current retained body"
        );
        assert_eq!(
            access
                .lifecycle_events()
                .expect("read rebuilt lifecycle")
                .into_iter()
                .map(|event| event.kind())
                .collect::<Vec<_>>(),
            vec![LifecycleEventKind::Forgotten, LifecycleEventKind::Recovered]
        );
        access
            .diff(
                revisions[0].identity().as_str(),
                HistoryDiffComparison::Current,
            )
            .expect("diff rebuilt baseline");
        access
            .restore_preview(revisions[0].identity().as_str())
            .expect("prepare Version Restore from rebuilt baseline");
        assert_eq!(
            crate::note::parse_note(
                &fs::read_to_string(restored_path).expect("read recovered canonical note")
            )
            .body,
            "Current retained body"
        );
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
        .expect("created note session");
        let note_id = NoteIdentity::new(created.note_id.expect("note identity"));
        let active_path = PathBuf::from(created.path.expect("active path"));
        let original_markdown = fs::read_to_string(&active_path).expect("read active note");
        crate::state::inject_note_publication_failure_once();

        let error = forget_note_with_state(
            &app.state(),
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
        let events = app
            .state::<AppState>()
            .note_timeline()
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
        .expect("created note session");
        let note_id = NoteIdentity::new(created.note_id.expect("note identity"));
        let active_path = PathBuf::from(created.path.expect("active path"));
        crate::services::note_timeline::inject_lifecycle_finalization_failure_once();

        let summary = forget_note_with_state(
            &app.state(),
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
        let app_state = app.state::<AppState>();
        let timeline = app_state.note_timeline();
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
                .expect_err("forgotten history stays gated")
                .to_string(),
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
