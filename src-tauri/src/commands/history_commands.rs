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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryCommandErrorState {
    Unavailable,
    Corrupt,
    Stale,
    Ineligible,
    Missing,
    InvalidRequest,
}

impl HistoryCommandErrorState {
    #[cfg(test)]
    const ALL: [Self; 6] = [
        Self::Unavailable,
        Self::Corrupt,
        Self::Stale,
        Self::Ineligible,
        Self::Missing,
        Self::InvalidRequest,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryRecoveryAction {
    Retry,
    Refresh,
    RecoverNote,
    BackUpAndReset,
    CorrectRequest,
}

impl HistoryRecoveryAction {
    #[cfg(test)]
    const ALL: [Self; 5] = [
        Self::Retry,
        Self::Refresh,
        Self::RecoverNote,
        Self::BackUpAndReset,
        Self::CorrectRequest,
    ];
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryCommandError {
    state: HistoryCommandErrorState,
    message: &'static str,
    recovery_action: HistoryRecoveryAction,
}

impl HistoryCommandError {
    fn for_state(state: HistoryCommandErrorState) -> Self {
        let (message, recovery_action) = match state {
            HistoryCommandErrorState::Unavailable => (
                "History is unavailable right now.",
                HistoryRecoveryAction::Retry,
            ),
            HistoryCommandErrorState::Corrupt => (
                "History data is damaged and must be reset before it can be used.",
                HistoryRecoveryAction::BackUpAndReset,
            ),
            HistoryCommandErrorState::Stale => (
                "History changed before this action finished.",
                HistoryRecoveryAction::Refresh,
            ),
            HistoryCommandErrorState::Ineligible => (
                "This note must be recovered before its history can be used.",
                HistoryRecoveryAction::RecoverNote,
            ),
            HistoryCommandErrorState::Missing => (
                "The requested history item is no longer available.",
                HistoryRecoveryAction::Refresh,
            ),
            HistoryCommandErrorState::InvalidRequest => (
                "The history request is invalid.",
                HistoryRecoveryAction::CorrectRequest,
            ),
        };
        Self {
            state,
            message,
            recovery_action,
        }
    }

    pub(crate) fn invalid_request(operation: &str, cause: impl AsRef<str>) -> Self {
        Self::with_cause(operation, HistoryCommandErrorState::InvalidRequest, cause)
    }

    pub(crate) fn from_cause(operation: &str, cause: impl AsRef<str>) -> Self {
        let cause = cause.as_ref();
        let normalized = cause.to_ascii_lowercase();
        let state = if [
            "corrupt",
            "integrity",
            "lineage",
            "payload",
            "delta",
            "hash mismatch",
            "unknown stored",
            "did not reconstruct",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
        {
            HistoryCommandErrorState::Corrupt
        } else if [
            "cursor",
            "continuation",
            "changed after",
            "changed while",
            "stale",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
        {
            HistoryCommandErrorState::Stale
        } else if [
            "recover the missing note",
            "recover the forgotten note",
            "already matches current authored content",
            "available only when history is corrupt or unavailable",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
        {
            HistoryCommandErrorState::Ineligible
        } else if [
            "unknown note revision",
            "does not belong to this note timeline",
            "has no current path",
            "has no current authored state",
            "no retained revision",
            "no longer available",
            "deadline expired",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
        {
            HistoryCommandErrorState::Missing
        } else {
            HistoryCommandErrorState::Unavailable
        };
        Self::with_cause(operation, state, cause)
    }

    fn with_cause(
        operation: &str,
        state: HistoryCommandErrorState,
        cause: impl AsRef<str>,
    ) -> Self {
        eprintln!(
            "Note Timeline command `{operation}` failed: {}",
            cause.as_ref()
        );
        Self::for_state(state)
    }
}

pub(crate) type HistoryCommandResult<T> = Result<T, HistoryCommandError>;

fn command_error(operation: &'static str) -> impl FnOnce(String) -> HistoryCommandError {
    move |cause| HistoryCommandError::from_cause(operation, cause)
}

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
) -> HistoryCommandResult<Vec<MissingNoteSummary>> {
    super::prepare_notes_dir_with_state(true, Some(&state))
        .map_err(command_error("list_missing_notes"))?;
    let timeline = state.note_timeline();
    timeline
        .missing_notes()
        .map_err(command_error("list_missing_notes"))?
        .into_iter()
        .map(|missing| {
            let page = timeline
                .missing_note_history_page(
                    missing.note_id().clone(),
                    None,
                    MISSING_NOTE_HISTORY_PAGE_SIZE,
                )
                .map_err(command_error("list_missing_notes"))?;
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
) -> HistoryCommandResult<HistoryModePage> {
    let note_id = NoteIdentity::new(note_id.trim());
    if note_id.as_str().is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "get_missing_note_history_page",
            "Missing Note history requires a Note Identity",
        ));
    }
    if cursor.trim().is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "get_missing_note_history_page",
            "Missing Note history requires a continuation",
        ));
    }
    state
        .note_timeline()
        .missing_note_history_page(note_id, Some(cursor.trim()), limit)
        .map_err(command_error("get_missing_note_history_page"))
}

#[tauri::command]
pub(crate) fn recover_missing_note(
    state: State<'_, AppState>,
    note_id: String,
) -> HistoryCommandResult<RecoveredMissingNote> {
    let note_id = NoteIdentity::new(note_id.trim());
    if note_id.as_str().is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "recover_missing_note",
            "Missing Note recovery requires a Note Identity",
        ));
    }
    let result = state
        .note_timeline()
        .recover_missing_note(note_id.clone())
        .map_err(command_error("recover_missing_note"))?;
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
) -> HistoryCommandResult<()> {
    let note_ids = note_ids
        .into_iter()
        .map(|note_id| NoteIdentity::new(note_id.trim()))
        .collect::<Vec<_>>();
    if note_ids.iter().any(|note_id| note_id.as_str().is_empty()) {
        return Err(HistoryCommandError::invalid_request(
            "delete_missing_notes",
            "Missing Note deletion requires Note Identities",
        ));
    }
    state
        .note_timeline()
        .purge_missing_notes(
            &note_ids,
            crate::time::current_time_millis().map_err(command_error("delete_missing_notes"))?,
        )
        .map_err(command_error("delete_missing_notes"))
}

fn history_access<'a>(
    state: &'a AppState,
    note_id: String,
    operation: &'static str,
) -> HistoryCommandResult<crate::services::note_timeline::HistoryModeAccess<'a>> {
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            operation,
            "History Mode requires a Note Identity",
        ));
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
) -> HistoryCommandResult<HistoryModePage> {
    history_access(&state, note_id, "get_note_history_page")?
        .page(cursor.as_deref(), limit)
        .map_err(command_error("get_note_history_page"))
}

#[tauri::command]
pub(crate) fn get_note_history_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> HistoryCommandResult<HistoryModeRevision> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "get_note_history_revision",
            "History Mode requires a Revision Identity",
        ));
    }
    history_access(&state, note_id, "get_note_history_revision")?
        .revision(revision_id)
        .map_err(command_error("get_note_history_revision"))
}

#[tauri::command]
pub(crate) fn get_note_history_diff(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    comparison: HistoryDiffComparison,
) -> HistoryCommandResult<HistoryModeDiff> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "get_note_history_diff",
            "History Mode requires a Revision Identity",
        ));
    }
    history_access(&state, note_id, "get_note_history_diff")?
        .diff(revision_id, comparison)
        .map_err(command_error("get_note_history_diff"))
}

#[tauri::command]
pub(crate) fn preview_note_revision_restore(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> HistoryCommandResult<HistoryRestorePreview> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "preview_note_revision_restore",
            "Version Restore requires a Revision Identity",
        ));
    }
    history_access(&state, note_id, "preview_note_revision_restore")?
        .restore_preview(revision_id)
        .map_err(command_error("preview_note_revision_restore"))
}

#[tauri::command]
pub(crate) fn restore_note_revision(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
    expected_current_authored_content_hash: String,
    confirmed: bool,
) -> HistoryCommandResult<VersionRestoreCommit> {
    if !confirmed {
        return Err(HistoryCommandError::invalid_request(
            "restore_note_revision",
            "Version Restore requires explicit confirmation",
        ));
    }
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "restore_note_revision",
            "Version Restore requires a Revision Identity",
        ));
    }
    if expected_current_authored_content_hash.trim().is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "restore_note_revision",
            "Version Restore confirmation requires its preview hash",
        ));
    }
    let restored = history_access(&state, note_id, "restore_note_revision")?
        .confirm_restore(revision_id, &expected_current_authored_content_hash)
        .map_err(command_error("restore_note_revision"))?;
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
) -> HistoryCommandResult<()> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "name_note_revision",
            "Naming history requires a Revision Identity",
        ));
    }
    if label.trim().is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "name_note_revision",
            "A Named Revision label cannot be empty",
        ));
    }
    history_access(&state, note_id, "name_note_revision")?
        .name_revision(&RevisionIdentity::from_persisted(revision_id), &label)
        .map_err(command_error("name_note_revision"))
}

#[tauri::command]
pub(crate) fn remove_note_revision_name(
    state: State<'_, AppState>,
    note_id: String,
    revision_id: String,
) -> HistoryCommandResult<()> {
    let revision_id = revision_id.trim();
    if revision_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "remove_note_revision_name",
            "Removing a history name requires a Revision Identity",
        ));
    }
    history_access(&state, note_id, "remove_note_revision_name")?
        .remove_revision_name(&RevisionIdentity::from_persisted(revision_id))
        .map_err(command_error("remove_note_revision_name"))
}

#[tauri::command]
pub(crate) fn clear_note_history(
    state: State<'_, AppState>,
    note_id: String,
    confirmed: bool,
) -> HistoryCommandResult<()> {
    if !confirmed {
        return Err(HistoryCommandError::invalid_request(
            "clear_note_history",
            "Clearing note history requires explicit confirmation",
        ));
    }
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err(HistoryCommandError::invalid_request(
            "clear_note_history",
            "Clearing note history requires a Note Identity",
        ));
    }
    state
        .note_timeline()
        .clear_note_history(&NoteIdentity::new(note_id))
        .map(|_| ())
        .map_err(command_error("clear_note_history"))
}

#[tauri::command]
pub(crate) fn clear_vault_history(
    state: State<'_, AppState>,
    confirmed: bool,
) -> HistoryCommandResult<()> {
    if !confirmed {
        return Err(HistoryCommandError::invalid_request(
            "clear_vault_history",
            "Clearing vault history requires explicit confirmation",
        ));
    }
    let vault_root = crate::state::vault_root().map_err(command_error("clear_vault_history"))?;
    state
        .note_timeline()
        .clear_vault_history(&vault_root)
        .map(|_| ())
        .map_err(command_error("clear_vault_history"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        services::note_timeline::{
            BaselineInitializationPhase, HistoryHealthState, HistoryIntegrityState,
            HistoryModeRevisionTimeKind, LifecycleEventKind, MutationSource,
            NoteHistoryHealthState, VaultObservation,
        },
        state::set_notes_root_override,
        test_support::{load_json_fixture, lock_test_env, TestDir},
    };
    use std::{fs, path::PathBuf};
    use tauri::Manager;

    fn test_context() -> tauri::Context<tauri::test::MockRuntime> {
        tauri::test::mock_context(tauri::test::noop_assets())
    }

    fn serialize_contract<T: Serialize>(values: T) -> serde_json::Value {
        serde_json::to_value(values).expect("serialize contract states")
    }

    #[test]
    fn timeline_command_fixture_matches_every_serialized_rust_state() {
        let fixture = load_json_fixture("contracts/timeline-command-contract.json");
        assert_eq!(
            fixture["mutationSources"],
            serialize_contract([
                MutationSource::Editor,
                MutationSource::TaskAction,
                MutationSource::AcceptedChatProposal,
                MutationSource::ExternalEdit,
                MutationSource::VersionRestore,
                MutationSource::NoteCreation,
                MutationSource::BaselineInitialization,
                MutationSource::RecoveryReconciliation,
            ])
        );
        assert_eq!(
            fixture["lifecycleKinds"],
            serialize_contract([
                LifecycleEventKind::Created,
                LifecycleEventKind::Renamed,
                LifecycleEventKind::Moved,
                LifecycleEventKind::Forgotten,
                LifecycleEventKind::Recovered,
                LifecycleEventKind::Missing,
                LifecycleEventKind::Reattached,
                LifecycleEventKind::Purged,
            ])
        );
        assert_eq!(
            fixture["timeKinds"],
            serialize_contract([
                HistoryModeRevisionTimeKind::KnownSince,
                HistoryModeRevisionTimeKind::Committed,
                HistoryModeRevisionTimeKind::Observed,
            ])
        );
        assert_eq!(
            fixture["historyHealthStates"],
            serialize_contract([
                HistoryHealthState::Healthy,
                HistoryHealthState::Initializing,
                HistoryHealthState::Degraded,
                HistoryHealthState::Warning,
                HistoryHealthState::Unavailable,
                HistoryHealthState::Corrupt,
            ])
        );
        assert_eq!(
            fixture["noteHistoryHealthStates"],
            serialize_contract([
                NoteHistoryHealthState::Healthy,
                NoteHistoryHealthState::Initializing,
                NoteHistoryHealthState::Degraded,
                NoteHistoryHealthState::Unavailable,
                NoteHistoryHealthState::Corrupt,
            ])
        );
        assert_eq!(
            fixture["historyIntegrityStates"],
            serialize_contract([
                HistoryIntegrityState::Verified,
                HistoryIntegrityState::Unavailable,
                HistoryIntegrityState::Corrupt,
            ])
        );
        assert_eq!(
            fixture["baselineInitializationPhases"],
            serialize_contract([
                BaselineInitializationPhase::NotStarted,
                BaselineInitializationPhase::Initializing,
                BaselineInitializationPhase::Complete,
                BaselineInitializationPhase::Degraded,
            ])
        );
        assert_eq!(
            fixture["commandErrorStates"],
            serialize_contract(HistoryCommandErrorState::ALL)
        );
        assert_eq!(
            fixture["recoveryActions"],
            serialize_contract(HistoryRecoveryAction::ALL)
        );
        assert_eq!(
            fixture["commandErrors"],
            serialize_contract(HistoryCommandErrorState::ALL.map(HistoryCommandError::for_state))
        );
        assert_eq!(
            fixture["cursors"]["initial"],
            serialize_contract(Option::<String>::None)
        );
        assert_eq!(
            fixture["cursors"]["continuation"],
            serialize_contract(Some("opaque-timeline-cursor"))
        );

        fn require_exhaustive_contract_matches(
            source: MutationSource,
            lifecycle: LifecycleEventKind,
            time: HistoryModeRevisionTimeKind,
            health: HistoryHealthState,
            note_health: NoteHistoryHealthState,
            integrity: HistoryIntegrityState,
            initialization: BaselineInitializationPhase,
            recovery: HistoryRecoveryAction,
        ) {
            match source {
                MutationSource::Editor
                | MutationSource::TaskAction
                | MutationSource::AcceptedChatProposal
                | MutationSource::ExternalEdit
                | MutationSource::VersionRestore
                | MutationSource::NoteCreation
                | MutationSource::BaselineInitialization
                | MutationSource::RecoveryReconciliation => {}
            }
            match lifecycle {
                LifecycleEventKind::Created
                | LifecycleEventKind::Renamed
                | LifecycleEventKind::Moved
                | LifecycleEventKind::Forgotten
                | LifecycleEventKind::Recovered
                | LifecycleEventKind::Missing
                | LifecycleEventKind::Reattached
                | LifecycleEventKind::Purged => {}
            }
            match time {
                HistoryModeRevisionTimeKind::KnownSince
                | HistoryModeRevisionTimeKind::Committed
                | HistoryModeRevisionTimeKind::Observed => {}
            }
            match health {
                HistoryHealthState::Healthy
                | HistoryHealthState::Initializing
                | HistoryHealthState::Degraded
                | HistoryHealthState::Warning
                | HistoryHealthState::Unavailable
                | HistoryHealthState::Corrupt => {}
            }
            match note_health {
                NoteHistoryHealthState::Healthy
                | NoteHistoryHealthState::Initializing
                | NoteHistoryHealthState::Degraded
                | NoteHistoryHealthState::Unavailable
                | NoteHistoryHealthState::Corrupt => {}
            }
            match integrity {
                HistoryIntegrityState::Verified
                | HistoryIntegrityState::Unavailable
                | HistoryIntegrityState::Corrupt => {}
            }
            match initialization {
                BaselineInitializationPhase::NotStarted
                | BaselineInitializationPhase::Initializing
                | BaselineInitializationPhase::Complete
                | BaselineInitializationPhase::Degraded => {}
            }
            match recovery {
                HistoryRecoveryAction::Retry
                | HistoryRecoveryAction::Refresh
                | HistoryRecoveryAction::RecoverNote
                | HistoryRecoveryAction::BackUpAndReset
                | HistoryRecoveryAction::CorrectRequest => {}
            }
        }

        require_exhaustive_contract_matches(
            MutationSource::Editor,
            LifecycleEventKind::Created,
            HistoryModeRevisionTimeKind::KnownSince,
            HistoryHealthState::Healthy,
            NoteHistoryHealthState::Healthy,
            HistoryIntegrityState::Verified,
            BaselineInitializationPhase::NotStarted,
            HistoryRecoveryAction::Retry,
        );
    }

    #[test]
    fn timeline_command_errors_preserve_diagnostics_only_in_logs() {
        let cause =
            "Prepare query SELECT payload at /vault/.gneauxghts/history.sqlite3: corrupt payload";
        let error = HistoryCommandError::from_cause("get_note_history_revision", cause);
        let serialized = serde_json::to_string(&error).expect("serialize command error");

        assert_eq!(error.state, HistoryCommandErrorState::Corrupt);
        assert!(!serialized.contains("SELECT"));
        assert!(!serialized.contains("/vault"));
        assert!(!serialized.contains("sqlite"));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&serialized).expect("parse command error"),
            serde_json::json!({
                "state": "corrupt",
                "message": "History data is damaged and must be reset before it can be used.",
                "recoveryAction": "backUpAndReset"
            })
        );
    }

    #[test]
    fn timeline_command_causes_map_to_closed_product_states() {
        for (cause, expected) in [
            (
                "unable to open database file",
                HistoryCommandErrorState::Unavailable,
            ),
            (
                "Note Revision payload did not reconstruct",
                HistoryCommandErrorState::Corrupt,
            ),
            (
                "History page cursor is no longer available",
                HistoryCommandErrorState::Stale,
            ),
            (
                "Recover the missing note before accessing its Note Timeline",
                HistoryCommandErrorState::Ineligible,
            ),
            ("Unknown Note Revision", HistoryCommandErrorState::Missing),
        ] {
            assert_eq!(
                HistoryCommandError::from_cause("test_operation", cause).state,
                expected,
                "unexpected command state for {cause}"
            );
        }
        assert_eq!(
            HistoryCommandError::invalid_request("test_operation", "missing Note Identity").state,
            HistoryCommandErrorState::InvalidRequest
        );
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
        assert_eq!(mismatched.state, HistoryCommandErrorState::Stale);

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
        assert_eq!(stale.state, HistoryCommandErrorState::Stale);

        let recovered = recover_missing_note(restarted_app.state(), note_id.as_str().to_string())
            .expect("recover Missing Note after paging and reset");
        assert!(PathBuf::from(recovered.restored_path).exists());
        set_notes_root_override(None).expect("clear notes root override");
    }
}
