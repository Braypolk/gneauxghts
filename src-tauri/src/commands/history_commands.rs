use crate::{
    commands::{note_persistence::build_note_session_from_mutation, NoteSession},
    index::AppState,
    services::note_timeline::{
        HistoryDiffComparison, HistoryModeDiff, HistoryModePage, HistoryModeRevision,
        HistoryRestorePreview, NoteIdentity, RevisionIdentity,
    },
};
use serde::Serialize;
use tauri::State;

const MISSING_NOTE_HISTORY_PAGE_SIZE: usize = 30;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionRestoreCommit {
    revision_id: String,
    session: NoteSession,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissingNoteSummary {
    note_id: String,
    path: String,
    title: String,
    file_name: String,
    missing_at_millis: u64,
    retention_days: u32,
    purge_at_millis: u64,
    timeline: HistoryModePage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveredMissingNote {
    note_id: String,
    restored_path: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

#[tauri::command]
pub(crate) fn list_missing_notes(
    state: State<'_, AppState>,
) -> Result<Vec<MissingNoteSummary>, String> {
    super::prepare_notes_dir_with_state(true, Some(&state))?;
    let timeline = state.note_timeline();
    timeline
        .missing_notes()?
        .into_iter()
        .map(|missing| {
            let page = timeline.missing_note_history_page(
                missing.note_id().clone(),
                None,
                MISSING_NOTE_HISTORY_PAGE_SIZE,
            )?;
            Ok(MissingNoteSummary {
                note_id: missing.note_id().as_str().to_string(),
                path: missing.path().to_string_lossy().into_owned(),
                title: missing.title().to_string(),
                file_name: missing
                    .path()
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                missing_at_millis: missing.missing_at_millis(),
                retention_days: missing.retention_days(),
                purge_at_millis: missing.purge_at_millis(),
                timeline: page,
            })
        })
        .collect()
}

#[tauri::command]
pub(crate) fn get_missing_note_history_page(
    state: State<'_, AppState>,
    note_id: String,
    cursor: String,
    limit: usize,
) -> Result<HistoryModePage, String> {
    let note_id = NoteIdentity::new(note_id.trim());
    if note_id.as_str().is_empty() {
        return Err("Missing Note history requires a Note Identity".to_string());
    }
    if cursor.trim().is_empty() {
        return Err("Missing Note history requires a continuation".to_string());
    }
    state
        .note_timeline()
        .missing_note_history_page(note_id, Some(cursor.trim()), limit)
}

#[tauri::command]
pub(crate) fn recover_missing_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<RecoveredMissingNote, String> {
    let note_id = NoteIdentity::new(note_id.trim());
    if note_id.as_str().is_empty() {
        return Err("Missing Note recovery requires a Note Identity".to_string());
    }
    let result = state
        .note_timeline()
        .recover_missing_note(note_id.clone())?;
    Ok(RecoveredMissingNote {
        note_id: note_id.as_str().to_string(),
        restored_path: result.receipt().path().to_string_lossy().into_owned(),
        title: result
            .receipt()
            .path()
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        commit_warning: result.commit_warning().cloned(),
    })
}

#[tauri::command]
pub(crate) fn delete_missing_notes(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
) -> Result<(), String> {
    let note_ids = note_ids
        .into_iter()
        .map(|note_id| NoteIdentity::new(note_id.trim()))
        .collect::<Vec<_>>();
    if note_ids.iter().any(|note_id| note_id.as_str().is_empty()) {
        return Err("Missing Note deletion requires Note Identities".to_string());
    }
    state
        .note_timeline()
        .purge_missing_notes(&note_ids, crate::time::current_time_millis()?)
}

fn history_access<'a>(
    state: &'a AppState,
    note_id: String,
) -> Result<crate::services::note_timeline::HistoryModeAccess<'a>, String> {
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err("History Mode requires a Note Identity".to_string());
    }
    Ok(state
        .note_timeline()
        .open_history_mode(NoteIdentity::new(note_id)))
}

#[tauri::command]
pub(crate) fn get_note_history_page(
    state: State<'_, AppState>,
    note_id: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<HistoryModePage, String> {
    history_access(&state, note_id)?.page(cursor.as_deref(), limit)
}

#[tauri::command]
pub(crate) fn get_note_history_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> Result<HistoryModeRevision, String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("History Mode requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?.revision(revision_id)
}

#[tauri::command]
pub(crate) fn get_note_history_diff(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    comparison: HistoryDiffComparison,
) -> Result<HistoryModeDiff, String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("History Mode requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?.diff(revision_id, comparison)
}

#[tauri::command]
pub(crate) fn preview_note_revision_restore(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> Result<HistoryRestorePreview, String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Version Restore requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?.restore_preview(revision_id)
}

#[tauri::command]
pub(crate) fn restore_note_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    expected_current_authored_content_hash: String,
    confirmed: bool,
) -> Result<VersionRestoreCommit, String> {
    if !confirmed {
        return Err("Version Restore requires explicit confirmation".to_string());
    }
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Version Restore requires a Revision Identity".to_string());
    }
    let restored = history_access(&state, note_id)?
        .confirm_restore(revision_id, &expected_current_authored_content_hash)?;
    let outcome = restored.mutation();
    outcome.report_degraded("Version Restore");
    Ok(VersionRestoreCommit {
        revision_id: restored.revision_id().as_str().to_string(),
        session: build_note_session_from_mutation(outcome),
    })
}

#[tauri::command]
pub(crate) fn name_note_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    label: String,
) -> Result<(), String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Naming history requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?
        .name_revision(&RevisionIdentity::from_persisted(revision_id), &label)
}

#[tauri::command]
pub(crate) fn remove_note_revision_name(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> Result<(), String> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err("Removing a history name requires a Revision Identity".to_string());
    }
    history_access(&state, note_id)?
        .remove_revision_name(&RevisionIdentity::from_persisted(revision_id))
}

#[tauri::command]
pub(crate) fn clear_note_history(
    state: State<'_, AppState>,
    note_id: String,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err("Clearing note history requires explicit confirmation".to_string());
    }
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err("Clearing note history requires a Note Identity".to_string());
    }
    state
        .note_timeline()
        .clear_note_history(&NoteIdentity::new(note_id))
        .map(|_| ())
}

#[tauri::command]
pub(crate) fn clear_vault_history(
    state: State<'_, AppState>,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err("Clearing vault history requires explicit confirmation".to_string());
    }
    let vault_root = crate::state::vault_root()?;
    state
        .note_timeline()
        .clear_vault_history(&vault_root)
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        services::note_timeline::VaultObservation,
        state::set_notes_root_override,
        test_support::{lock_test_env, TestDir},
    };
    use std::{fs, path::PathBuf};
    use tauri::Manager;

    fn test_context() -> tauri::Context<tauri::test::MockRuntime> {
        tauri::test::mock_context(tauri::test::noop_assets())
    }

    #[test]
    fn missing_note_history_pages_are_bounded_restart_stable_and_recoverable() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("missing-note-bounded-page-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf())
            .expect("initialize app data");
        let notes = TestDir::new("missing-note-bounded-page-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).expect("override notes root");
        crate::state::ensure_vault_scaffold(notes.path()).expect("create vault scaffold");
        crate::state::set_forgotten_note_retention_days(30).expect("set retention window");
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
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Deep missing note".to_string(),
            "Version 0".to_string(),
            None,
        )
        .expect("create note")
        .session
        .expect("created note session");
        let note_id = NoteIdentity::new(created.note_id.expect("created note identity"));
        let path = PathBuf::from(created.path.expect("created note path"));
        for version in 1..=35 {
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &state,
                "Deep missing note".to_string(),
                format!("Version {version}"),
                Some(path.to_string_lossy().into_owned()),
            )
            .expect("append revision");
        }
        let oldest_revision = state
            .note_timeline()
            .open_history_mode(note_id.clone())
            .revisions()
            .expect("read revisions")
            .first()
            .expect("oldest revision")
            .identity()
            .clone();
        state
            .note_timeline()
            .open_history_mode(note_id.clone())
            .name_revision(&oldest_revision, "Before external deletion")
            .expect("name oldest revision");
        crate::services::note_timeline::replace_one_revision_source_for_test(
            &note_id,
            &oldest_revision,
            "invalid-old-source",
        );
        fs::remove_file(&path).expect("remove note outside the app");
        let missing_at_millis = crate::time::current_time_millis().expect("current time") + 1;
        state
            .note_timeline()
            .observe(VaultObservation::missing(path.clone(), missing_at_millis))
            .expect("retain missing note");

        let missing = list_missing_notes(app.state()).expect("list missing notes");

        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].note_id, note_id.as_str());
        assert_eq!(missing[0].path, path.to_string_lossy());
        assert_eq!(missing[0].missing_at_millis, missing_at_millis);
        assert_eq!(missing[0].retention_days, 30);
        assert_eq!(missing[0].timeline.records().len(), 30);
        assert_eq!(
            serde_json::to_value(&missing[0].timeline).expect("serialize first page")["records"][0]
                ["eventKind"],
            "missing"
        );
        let cursor = missing[0]
            .timeline
            .next_cursor()
            .expect("bounded page continuation")
            .to_string();
        let first_page_ids = missing[0]
            .timeline
            .records()
            .iter()
            .map(|record| record.record_id().to_string())
            .collect::<std::collections::HashSet<_>>();
        crate::services::note_timeline::replace_one_revision_source_for_test(
            &note_id,
            &oldest_revision,
            "noteCreation",
        );

        drop(app);
        let restarted_state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .expect("construct restarted app state");
        let restarted_app = tauri::test::mock_builder()
            .manage(restarted_state)
            .build(test_context())
            .expect("build restarted test app");
        crate::services::note_timeline::reset_history_integrity_snapshot_count_for_test();

        let second_page = get_missing_note_history_page(
            restarted_app.state(),
            note_id.as_str().to_string(),
            cursor.clone(),
            MISSING_NOTE_HISTORY_PAGE_SIZE,
        )
        .expect("load older missing-note history");

        assert_eq!(
            crate::services::note_timeline::history_integrity_snapshot_count_for_test(),
            0,
            "bounded paging must not run the exhaustive restart integrity sweep"
        );
        assert_eq!(second_page.records().len(), 8);
        assert!(second_page.next_cursor().is_none());
        assert!(second_page
            .records()
            .iter()
            .all(|record| !first_page_ids.contains(record.record_id())));
        assert!(serde_json::to_string(&second_page)
            .expect("serialize older page")
            .contains("Before external deletion"));

        let mismatched = get_missing_note_history_page(
            restarted_app.state(),
            "another-note".to_string(),
            cursor.clone(),
            MISSING_NOTE_HISTORY_PAGE_SIZE,
        )
        .expect_err("reject continuation for another timeline");
        assert_eq!(
            mismatched,
            crate::services::note_timeline::MISSING_HISTORY_CURSOR_ERROR
        );

        restarted_app
            .state::<AppState>()
            .note_timeline()
            .reset_history(notes.path())
            .expect("reset development history");
        let stale = get_missing_note_history_page(
            restarted_app.state(),
            note_id.as_str().to_string(),
            cursor,
            MISSING_NOTE_HISTORY_PAGE_SIZE,
        )
        .expect_err("reject continuation from an older history generation");
        assert_eq!(
            stale,
            crate::services::note_timeline::MISSING_HISTORY_CURSOR_ERROR
        );

        let recovered = recover_missing_note(restarted_app.state(), note_id.as_str().to_string())
            .expect("recover Missing Note after paging and reset");
        assert!(PathBuf::from(recovered.restored_path).exists());
        set_notes_root_override(None).expect("clear notes root override");
    }
}
