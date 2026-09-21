use crate::{
    commands::{note_persistence::build_note_session_from_mutation, NoteSession},
    index::AppState,
    services::note_timeline::{
        HistoryDiffComparison, HistoryError, HistoryModeDiff, HistoryModePage, HistoryModeRevision,
        HistoryRestorePreview, NoteIdentity, RevisionIdentity,
    },
};
use serde::Serialize;
#[cfg(feature = "e2e-wdio")]
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
    AlreadyCurrent,
}

impl HistoryCommandErrorState {
    #[cfg(test)]
    const ALL: [Self; 7] = [
        Self::Unavailable,
        Self::Corrupt,
        Self::Stale,
        Self::Ineligible,
        Self::Missing,
        Self::InvalidRequest,
        Self::AlreadyCurrent,
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
            HistoryCommandErrorState::AlreadyCurrent => (
                "This revision already matches the note's current content. Choose a different revision.",
                HistoryRecoveryAction::CorrectRequest,
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

    pub(crate) fn unavailable(operation: &str, cause: impl Into<String>) -> Self {
        Self::from_history_error(operation, HistoryError::Unavailable(cause.into()))
    }

    pub(crate) fn from_history_error(operation: &str, error: HistoryError) -> Self {
        let (state, cause) = match error {
            HistoryError::AlreadyCurrent(cause) => {
                (HistoryCommandErrorState::AlreadyCurrent, cause)
            }
            HistoryError::Unavailable(cause) => (HistoryCommandErrorState::Unavailable, cause),
            HistoryError::Corrupt(cause) => (HistoryCommandErrorState::Corrupt, cause),
            HistoryError::Stale(cause) => (HistoryCommandErrorState::Stale, cause),
            HistoryError::Ineligible(cause) => (HistoryCommandErrorState::Ineligible, cause),
            HistoryError::Missing(cause) => (HistoryCommandErrorState::Missing, cause),
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

fn command_error(operation: &'static str) -> impl FnOnce(HistoryError) -> HistoryCommandError {
    move |error| HistoryCommandError::from_history_error(operation, error)
}

fn unavailable_command_error(
    operation: &'static str,
) -> impl FnOnce(String) -> HistoryCommandError {
    move |cause| {
        HistoryCommandError::from_history_error(operation, HistoryError::Unavailable(cause))
    }
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
pub(crate) async fn list_missing_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> HistoryCommandResult<Vec<MissingNoteSummary>> {
    super::on_app_worker(app, move |state| {
        super::prepare_notes_dir_with_state(true, state)
            .map_err(unavailable_command_error("list_missing_notes"))?;
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
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("list_missing_notes", error))?
}

#[tauri::command]
pub(crate) async fn get_missing_note_history_page<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    cursor: String,
    limit: usize,
) -> HistoryCommandResult<HistoryModePage> {
    super::on_app_worker(app, move |state| {
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
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("get_missing_note_history_page", error))?
}

#[tauri::command]
pub(crate) async fn recover_missing_note<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
) -> HistoryCommandResult<RecoveredMissingNote> {
    super::on_app_worker(app, move |state| {
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
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("recover_missing_note", error))?
}

#[tauri::command]
pub(crate) async fn delete_missing_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_ids: Vec<String>,
) -> HistoryCommandResult<()> {
    super::on_app_worker(app, move |state| {
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
                crate::time::current_time_millis()
                    .map_err(unavailable_command_error("delete_missing_notes"))?,
            )
            .map_err(command_error("delete_missing_notes"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("delete_missing_notes", error))?
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

#[cfg(feature = "e2e-wdio")]
#[tauri::command]
pub(crate) fn e2e_advance_window_clock(state: State<'_, AppState>, millis: u64) {
    state.note_timeline().advance_window_clock_for_e2e(millis);
}

#[tauri::command]
pub(crate) async fn finalize_note_editing_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
) -> HistoryCommandResult<()> {
    super::on_app_worker(app, move |state| {
        let note_id = note_id.trim();
        if note_id.is_empty() {
            return Err(HistoryCommandError::invalid_request(
                "finalize_note_editing_window",
                "A Note Identity is required",
            ));
        }
        state
            .note_timeline()
            .finalize_editing_window(&NoteIdentity::new(note_id))
            .map_err(command_error("finalize_note_editing_window"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("finalize_note_editing_window", error))?
}

#[tauri::command]
pub(crate) async fn get_note_history_page<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    cursor: Option<String>,
    limit: usize,
) -> HistoryCommandResult<HistoryModePage> {
    super::on_app_worker(app, move |state| {
        history_access(state, note_id, "get_note_history_page")?
            .page(cursor.as_deref(), limit)
            .map_err(command_error("get_note_history_page"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("get_note_history_page", error))?
}

#[tauri::command]
pub(crate) async fn get_note_history_context<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
    cursor: Option<String>,
) -> HistoryCommandResult<HistoryModePage> {
    super::on_app_worker(app, move |state| {
        let revision_id = revision_id.trim();
        if revision_id.is_empty() {
            return Err(HistoryCommandError::invalid_request(
                "get_note_history_context",
                "History Mode requires a Revision Identity",
            ));
        }
        history_access(state, note_id, "get_note_history_context")?
            .revision_context(revision_id, cursor.as_deref())
            .map_err(command_error("get_note_history_context"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("get_note_history_context", error))?
}

#[tauri::command]
pub(crate) async fn get_note_history_revision<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
) -> HistoryCommandResult<HistoryModeRevision> {
    super::on_app_worker(app, move |state| {
        let revision_id = revision_id.trim();
        if revision_id.is_empty() {
            return Err(HistoryCommandError::invalid_request(
                "get_note_history_revision",
                "History Mode requires a Revision Identity",
            ));
        }
        history_access(state, note_id, "get_note_history_revision")?
            .revision(revision_id)
            .map_err(command_error("get_note_history_revision"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("get_note_history_revision", error))?
}

#[tauri::command]
pub(crate) async fn get_note_history_diff<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
    comparison: HistoryDiffComparison,
) -> HistoryCommandResult<HistoryModeDiff> {
    super::on_app_worker(app, move |state| {
        let revision_id = revision_id.trim();
        if revision_id.is_empty() {
            return Err(HistoryCommandError::invalid_request(
                "get_note_history_diff",
                "History Mode requires a Revision Identity",
            ));
        }
        history_access(state, note_id, "get_note_history_diff")?
            .diff(revision_id, comparison)
            .map_err(command_error("get_note_history_diff"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("get_note_history_diff", error))?
}

#[tauri::command]
pub(crate) async fn preview_note_revision_restore<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
) -> HistoryCommandResult<HistoryRestorePreview> {
    super::on_app_worker(app, move |state| {
        let revision_id = revision_id.trim();
        if revision_id.is_empty() {
            return Err(HistoryCommandError::invalid_request(
                "preview_note_revision_restore",
                "Version Restore requires a Revision Identity",
            ));
        }
        history_access(state, note_id, "preview_note_revision_restore")?
            .restore_preview(revision_id)
            .map_err(command_error("preview_note_revision_restore"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("preview_note_revision_restore", error))?
}

#[tauri::command]
pub(crate) async fn restore_note_revision<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
    expected_current_authored_content_hash: String,
    confirmed: bool,
) -> HistoryCommandResult<VersionRestoreCommit> {
    super::on_app_worker(app, move |state| {
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
        let restored = history_access(state, note_id, "restore_note_revision")?
            .confirm_restore(revision_id, &expected_current_authored_content_hash)
            .map_err(command_error("restore_note_revision"))?;
        let outcome = restored.mutation();
        outcome.report_degraded("Version Restore");
        Ok(VersionRestoreCommit {
            revision_id: restored.revision_id().as_str().to_string(),
            session: build_note_session_from_mutation(outcome),
        })
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("restore_note_revision", error))?
}

#[tauri::command]
pub(crate) async fn name_note_revision<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
    label: String,
) -> HistoryCommandResult<()> {
    super::on_app_worker(app, move |state| {
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
        history_access(state, note_id, "name_note_revision")?
            .name_revision(&RevisionIdentity::from_persisted(revision_id), &label)
            .map_err(command_error("name_note_revision"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("name_note_revision", error))?
}

#[tauri::command]
pub(crate) async fn remove_note_revision_name<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    revision_id: String,
) -> HistoryCommandResult<()> {
    super::on_app_worker(app, move |state| {
        let revision_id = revision_id.trim();
        if revision_id.is_empty() {
            return Err(HistoryCommandError::invalid_request(
                "remove_note_revision_name",
                "Removing a history name requires a Revision Identity",
            ));
        }
        history_access(state, note_id, "remove_note_revision_name")?
            .remove_revision_name(&RevisionIdentity::from_persisted(revision_id))
            .map_err(command_error("remove_note_revision_name"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("remove_note_revision_name", error))?
}

#[tauri::command]
pub(crate) async fn clear_note_history<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    note_id: String,
    confirmed: bool,
) -> HistoryCommandResult<()> {
    super::on_app_worker(app, move |state| {
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
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("clear_note_history", error))?
}

#[tauri::command]
pub(crate) async fn clear_vault_history<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    confirmed: bool,
) -> HistoryCommandResult<()> {
    super::on_app_worker(app, move |state| {
        if !confirmed {
            return Err(HistoryCommandError::invalid_request(
                "clear_vault_history",
                "Clearing vault history requires explicit confirmation",
            ));
        }
        let vault_root = state.running_vault().root();
        state
            .note_timeline()
            .clear_vault_history(vault_root)
            .map(|_| ())
            .map_err(command_error("clear_vault_history"))
    })
    .await
    .map_err(|error| HistoryCommandError::unavailable("clear_vault_history", error))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        services::note_timeline::{
            damage_retained_revision_for_test, BaselineInitializationPhase, HistoryHealthState,
            HistoryIntegrityState, HistoryModeRevisionTimeKind, HistoryTestDamage,
            LifecycleEventKind, MutationSource, NoteHistoryHealthState, VaultObservation,
        },
        state::set_notes_root_override,
        test_support::{load_json_fixture, lock_test_env, TestDir},
    };
    use std::{fs, path::PathBuf};
    use tauri::{async_runtime::block_on, Manager};

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
                HistoryModeRevisionTimeKind::EditingWindow,
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
    }

    #[test]
    fn readiness_command_fixture_matches_serialized_states_and_snapshot() {
        use crate::services::note_timeline::{HistoryReadiness, HistoryReadinessState};
        let fixture = load_json_fixture("contracts/history-readiness-contract.json");
        assert_eq!(
            fixture["states"],
            serialize_contract([
                HistoryReadinessState::RecoveryPending,
                HistoryReadinessState::TargetVerificationPending,
                HistoryReadinessState::Ready,
                HistoryReadinessState::Unavailable,
                HistoryReadinessState::Corrupt,
            ])
        );
        assert_eq!(
            fixture["snapshot"],
            serialize_contract(HistoryReadiness {
                scope: "runtime-scope".into(),
                revision: 2,
                note_id: None,
                state: HistoryReadinessState::RecoveryPending,
                verified_notes: 3,
                total_notes: None,
                background_complete: false,
                background_unavailable: false,
            })
        );
    }

    #[test]
    fn blocked_publication_worker_leaves_readiness_ipc_runnable() {
        use std::{sync::mpsc, time::Duration};
        let _guard = lock_test_env();
        let f = ErrorFixture::new();
        let app = tauri::test::mock_builder()
            .manage(
                AppState::new(
                    crate::semantic::SemanticState::new_disabled("disabled"),
                    crate::app::EventBus::disabled(),
                )
                .unwrap(),
            )
            .invoke_handler(tauri::generate_handler![
                crate::commands::get_history_readiness
            ])
            .build(test_context())
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let (entered, started) = mpsc::channel();
        let (observed, observation) = mpsc::channel();
        let handle = app.handle().clone();
        let path = f.path.clone();
        let original = fs::read(&path).unwrap();
        // Hold the real canonical mutation owner. The shared command worker
        // must be running (and unable to publish) before observing cheap IPC.
        let (save, ready, unchanged) = crate::state::with_note_file_mutation(|| {
            let save =
                tauri::async_runtime::spawn(crate::commands::on_app_worker(handle, move |state| {
                    entered.send(()).unwrap();
                    crate::commands::note_persistence::persist_note_session_with_outcome(
                        state,
                        "Typed errors".into(),
                        "After contention".into(),
                        Some(path),
                    )
                }));
            let entered = started.recv_timeout(Duration::from_secs(5));
            let note_id = f.note_id.clone();
            let ipc = std::thread::spawn(move || {
                let response = tauri::test::get_ipc_response(
                    &webview,
                    tauri::webview::InvokeRequest {
                        cmd: "get_history_readiness".into(),
                        callback: tauri::ipc::CallbackFn(0),
                        error: tauri::ipc::CallbackFn(1),
                        url: "tauri://localhost".parse().unwrap(),
                        body: tauri::ipc::InvokeBody::Json(serde_json::json!({"noteId": note_id})),
                        headers: Default::default(),
                        invoke_key: tauri::test::INVOKE_KEY.to_string(),
                    },
                );
                let _ = observed
                    .send(response.map(|body| body.deserialize::<serde_json::Value>().unwrap()));
            });
            let ready = observation.recv_timeout(Duration::from_secs(5));
            let unchanged = fs::read(&f.path).unwrap() == original;
            Ok::<_, String>((save, (entered, ready, ipc), unchanged))
        })
        .unwrap();
        // Release contention before assertions so a failed check cannot strand
        // a worker or poison the shared file owner for subsequent tests.
        let result = block_on(save).unwrap().unwrap().unwrap();
        ready.2.join().unwrap();
        ready.0.expect("publication worker started");
        assert!(unchanged);
        assert_eq!(
            ready
                .1
                .expect("cheap IPC responded while publication was blocked")
                .unwrap()["noteId"],
            f.note_id
        );
        assert_eq!(result.unwrap().markdown, "After contention");
        set_notes_root_override(None).unwrap();
    }

    #[test]
    fn canonical_bootstrap_and_fallback_do_not_admit_or_verify_history() {
        let _guard = lock_test_env();
        let f = ErrorFixture::new();
        crate::state::db_mark_note_opened(&f.note_id).unwrap();
        damage_retained_revision_for_test(&f.revision_id, HistoryTestDamage::Payload);
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
        let counts = crate::services::note_timeline::history_scan_counts_for_test();
        let before =
            crate::commands::get_history_readiness(app.state(), Some(f.note_id.clone())).unwrap();
        assert_eq!(
            before.state,
            crate::services::note_timeline::HistoryReadinessState::RecoveryPending
        );
        let bootstrap = block_on(crate::commands::bootstrap_app(app.handle().clone())).unwrap();
        assert_eq!(
            serde_json::to_value(bootstrap).unwrap()["noteSession"]["markdown"],
            "After"
        );
        let fallback = block_on(crate::commands::load_note_session(app.handle().clone())).unwrap();
        assert_eq!(fallback.markdown, "After");
        let after =
            crate::commands::get_history_readiness(app.state(), Some(f.note_id.clone())).unwrap();
        assert_eq!(after.state, before.state);
        assert_eq!(
            crate::services::note_timeline::history_scan_counts_for_test(),
            counts
        );
        assert!(crate::commands::get_history_readiness(app.state(), Some(" ".into())).is_err());
        assert_eq!(
            crate::commands::get_history_readiness(app.state(), None)
                .unwrap()
                .note_id,
            None
        );
        set_notes_root_override(None).unwrap();
    }

    #[test]
    fn matching_revision_restore_prescribes_a_different_revision_not_note_recovery() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("matching-restore-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = TestDir::new("matching-restore-notes");
        set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("disabled"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(test_context())
            .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &app.state(),
            "Matching revision".into(),
            "Already current".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let note_id = created.note_id.unwrap();
        let history = app.state::<AppState>();
        let revisions = history
            .note_timeline()
            .open_history_mode(NoteIdentity::new(&note_id))
            .revisions()
            .unwrap();
        let revision_id = revisions[0].identity().as_str().to_string();
        let preview = block_on(preview_note_revision_restore(
            app.handle().clone(),
            note_id.clone(),
            revision_id.clone(),
        ))
        .unwrap();
        let error = block_on(restore_note_revision(
            app.handle().clone(),
            note_id.clone(),
            revision_id,
            preview.current_authored_content_hash().to_string(),
            true,
        ))
        .unwrap_err();
        assert_eq!(
            serialize_contract(error),
            serde_json::json!({
                "state": "alreadyCurrent",
                "message": "This revision already matches the note's current content. Choose a different revision.",
                "recoveryAction": "correctRequest"
            })
        );
        assert_eq!(
            history
                .note_timeline()
                .open_history_mode(NoteIdentity::new(note_id))
                .revisions()
                .unwrap()
                .len(),
            1
        );
        set_notes_root_override(None).unwrap();
    }

    struct ErrorFixture {
        app: tauri::App<tauri::test::MockRuntime>,
        note_id: String,
        path: String,
        revision_id: String,
        _data: TestDir,
        _notes: TestDir,
    }

    impl ErrorFixture {
        fn new() -> Self {
            let data = TestDir::new("typed-history-error-data");
            crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
            let notes = TestDir::new("typed-history-error-notes");
            set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
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
            let created = crate::commands::note_persistence::persist_note_session_with_outcome(
                &app.state(),
                "Typed errors".into(),
                "Before".into(),
                None,
            )
            .unwrap()
            .unwrap();
            let note_id = created.note_id.unwrap();
            let path = created.path.unwrap();
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &app.state(),
                "Typed errors".into(),
                "After".into(),
                Some(path.clone()),
            )
            .unwrap();
            block_on(finalize_note_editing_window(
                app.handle().clone(),
                note_id.clone(),
            ))
            .unwrap();
            block_on(get_note_history_page(
                app.handle().clone(),
                note_id.clone(),
                None,
                30,
            ))
            .unwrap();
            let revision_id = app
                .state::<AppState>()
                .note_timeline()
                .open_history_mode(NoteIdentity::new(&note_id))
                .revisions()
                .unwrap()
                .last()
                .unwrap()
                .identity()
                .as_str()
                .to_owned();
            Self {
                app,
                note_id,
                path,
                revision_id,
                _data: data,
                _notes: notes,
            }
        }

        fn revision(&self) -> HistoryCommandResult<HistoryModeRevision> {
            block_on(get_note_history_revision(
                self.app.handle().clone(),
                self.note_id.clone(),
                self.revision_id.clone(),
            ))
        }
    }

    #[test]
    fn production_history_failures_do_not_rescan_and_recovery_remains_retryable() {
        use crate::services::note_timeline::{
            history_scan_counts_for_test, inject_history_recovery_failure_once,
        };
        let _guard = lock_test_env();
        let f = ErrorFixture::new();
        let before = history_scan_counts_for_test();
        let invalid = block_on(get_note_history_revision(
            f.app.handle().clone(),
            f.note_id.clone(),
            "".into(),
        ))
        .unwrap_err();
        let missing = block_on(get_note_history_revision(
            f.app.handle().clone(),
            f.note_id.clone(),
            "absent".into(),
        ))
        .unwrap_err();
        let stale = block_on(get_note_history_page(
            f.app.handle().clone(),
            f.note_id.clone(),
            Some("invalid-cursor".into()),
            30,
        ))
        .unwrap_err();
        assert_eq!(
            invalid,
            HistoryCommandError::for_state(HistoryCommandErrorState::InvalidRequest)
        );
        assert_eq!(
            missing,
            HistoryCommandError::for_state(HistoryCommandErrorState::Missing)
        );
        assert_eq!(
            stale,
            HistoryCommandError::for_state(HistoryCommandErrorState::Stale)
        );
        assert_eq!(history_scan_counts_for_test(), before);

        // A fresh runtime verifies its target after retryable recovery, without a whole-vault scan.
        let restarted = tauri::test::mock_builder()
            .manage(
                AppState::new(
                    crate::semantic::SemanticState::new_disabled("disabled"),
                    crate::app::EventBus::disabled(),
                )
                .unwrap(),
            )
            .build(test_context())
            .unwrap();
        inject_history_recovery_failure_once();
        let unavailable = block_on(get_note_history_revision(
            restarted.handle().clone(),
            f.note_id.clone(),
            f.revision_id.clone(),
        ))
        .unwrap_err();
        assert_eq!(
            unavailable,
            HistoryCommandError::for_state(HistoryCommandErrorState::Unavailable)
        );
        let attested = history_scan_counts_for_test();
        assert_eq!(attested, before);
        block_on(get_note_history_revision(
            restarted.handle().clone(),
            f.note_id.clone(),
            f.revision_id.clone(),
        ))
        .unwrap();
        assert_eq!(history_scan_counts_for_test(), attested);
        let verified = crate::services::note_timeline::history_note_verification_count_for_test();
        block_on(get_note_history_revision(
            restarted.handle().clone(),
            f.note_id.clone(),
            f.revision_id.clone(),
        ))
        .unwrap();
        assert_eq!(
            crate::services::note_timeline::history_note_verification_count_for_test(),
            verified,
            "a subsequent history read reuses the target proof"
        );
        fs::rename(&f.path, format!("{}.held", f.path)).unwrap();
        f.app
            .state::<AppState>()
            .note_timeline()
            .observe(VaultObservation::missing(
                PathBuf::from(&f.path),
                crate::time::current_time_millis().unwrap(),
            ))
            .unwrap();
        let ineligible = f.revision().unwrap_err();
        assert_eq!(
            ineligible,
            HistoryCommandError::for_state(HistoryCommandErrorState::Ineligible)
        );
        assert_eq!(history_scan_counts_for_test(), attested);

        set_notes_root_override(None).unwrap();
    }

    #[test]
    fn production_history_reads_preserve_and_latch_corruption_after_attestation() {
        use crate::services::note_timeline::history_scan_counts_for_test;
        let _guard = lock_test_env();
        for damage in [
            HistoryTestDamage::Payload,
            HistoryTestDamage::WindowEvidence,
            HistoryTestDamage::ReciprocalEvidence,
            HistoryTestDamage::PayloadVersion,
            HistoryTestDamage::DatabaseBytes,
            HistoryTestDamage::DeltaLength,
            HistoryTestDamage::Lineage,
            HistoryTestDamage::Predecessor,
            HistoryTestDamage::Ancestry,
        ] {
            let f = ErrorFixture::new();
            let before = history_scan_counts_for_test();
            damage_retained_revision_for_test(&f.revision_id, damage);
            let error = if damage == HistoryTestDamage::Ancestry {
                block_on(get_note_history_diff(
                    f.app.handle().clone(),
                    f.note_id.clone(),
                    f.revision_id.clone(),
                    HistoryDiffComparison::Parent,
                ))
                .unwrap_err()
            } else if matches!(
                damage,
                HistoryTestDamage::WindowEvidence
                    | HistoryTestDamage::ReciprocalEvidence
                    | HistoryTestDamage::Lineage
                    | HistoryTestDamage::Predecessor
            ) {
                block_on(get_note_history_page(
                    f.app.handle().clone(),
                    f.note_id.clone(),
                    None,
                    30,
                ))
                .unwrap_err()
            } else {
                f.revision().unwrap_err()
            };
            assert_eq!(
                error,
                HistoryCommandError::for_state(HistoryCommandErrorState::Corrupt),
                "{damage:?}"
            );
            assert_eq!(
                history_scan_counts_for_test(),
                before,
                "read-time classification must not scan: {damage:?}"
            );
            // Latching makes even a later header-only read reject before returning data.
            let latched = block_on(get_note_history_page(
                f.app.handle().clone(),
                f.note_id.clone(),
                None,
                30,
            ))
            .unwrap_err();
            assert_eq!(
                latched.state,
                HistoryCommandErrorState::Corrupt,
                "{damage:?}"
            );
            let original = fs::read(&f.path).unwrap();
            assert!(
                crate::commands::note_persistence::persist_note_session_with_outcome(
                    &f.app.state(),
                    "Typed errors".into(),
                    "Must not publish".into(),
                    Some(f.path.clone()),
                )
                .is_err()
            );
            assert_eq!(fs::read(&f.path).unwrap(), original);
            assert_eq!(history_scan_counts_for_test(), before);
            set_notes_root_override(None).unwrap();
        }
    }

    #[test]
    fn current_content_history_reads_latch_corruption_before_chat_can_flatten_errors() {
        use crate::services::note_timeline::{
            history_scan_counts_for_test, AllowedScope, RevisionCitation,
        };
        let _guard = lock_test_env();
        for reader in ["provenance", "activity", "citations"] {
            let f = ErrorFixture::new();
            let before = history_scan_counts_for_test();
            damage_retained_revision_for_test(&f.revision_id, HistoryTestDamage::Source);
            let state = f.app.state::<AppState>();
            let timeline = state.note_timeline();
            let access = timeline.current_content(AllowedScope::vault());
            let error = match reader {
                "provenance" => access.provenance(&NoteIdentity::new(&f.note_id)).err(),
                "activity" => access.activity(0, u64::MAX, 0, 30).err(),
                "citations" => access
                    .current_citations(&[RevisionCitation {
                        note_id: f.note_id.clone(),
                        revision_id: f.revision_id.clone(),
                        at_millis: 0,
                        time_evidence: None,
                        source: MutationSource::Editor,
                        current_excerpt: "After".into(),
                    }])
                    .err(),
                _ => unreachable!(),
            }
            .expect("damaged retained header must fail current-content delivery");
            assert!(
                matches!(error, HistoryError::Corrupt(_)),
                "{reader}: {error}"
            );
            let bytes = fs::read(&f.path).unwrap();
            assert!(
                crate::commands::note_persistence::persist_note_session_with_outcome(
                    &state,
                    "Typed errors".into(),
                    "Must not publish".into(),
                    Some(f.path.clone()),
                )
                .is_err()
            );
            assert_eq!(fs::read(&f.path).unwrap(), bytes);
            assert_eq!(history_scan_counts_for_test(), before);
            set_notes_root_override(None).unwrap();
        }
    }

    #[test]
    fn production_missing_note_reads_latch_corruption_before_another_note_can_save() {
        use crate::services::note_timeline::history_scan_counts_for_test;
        let _guard = lock_test_env();
        let f = ErrorFixture::new();
        let other = crate::commands::note_persistence::persist_note_session_with_outcome(
            &f.app.state(),
            "Unrelated".into(),
            "Keep".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let other_path = other.path.unwrap();
        let original = fs::read(&other_path).unwrap();
        fs::rename(&f.path, format!("{}.held", f.path)).unwrap();
        f.app
            .state::<AppState>()
            .note_timeline()
            .observe(VaultObservation::missing(
                PathBuf::from(&f.path),
                crate::time::current_time_millis().unwrap(),
            ))
            .unwrap();
        let before = history_scan_counts_for_test();
        damage_retained_revision_for_test(&f.revision_id, HistoryTestDamage::Payload);
        let error = block_on(list_missing_notes(f.app.handle().clone())).unwrap_err();
        assert_eq!(
            error,
            HistoryCommandError::for_state(HistoryCommandErrorState::Corrupt)
        );
        assert!(
            crate::commands::note_persistence::persist_note_session_with_outcome(
                &f.app.state(),
                "Unrelated".into(),
                "Must not publish".into(),
                Some(other_path.clone()),
            )
            .is_err()
        );
        assert_eq!(fs::read(other_path).unwrap(), original);
        assert_eq!(history_scan_counts_for_test(), before);
        set_notes_root_override(None).unwrap();
    }

    #[test]
    fn timeline_command_errors_preserve_diagnostics_only_in_logs() {
        let cause =
            "Prepare query SELECT payload at /vault/.gneauxghts/history.sqlite3: corrupt payload";
        let error = HistoryCommandError::from_history_error(
            "get_note_history_revision",
            HistoryError::Corrupt(cause.to_string()),
        );
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
    fn typed_timeline_errors_map_to_closed_product_states() {
        for (error, expected) in [
            (
                HistoryError::Unavailable("unable to open database file".to_string()),
                HistoryCommandErrorState::Unavailable,
            ),
            (
                HistoryError::Corrupt("damaged retained data".to_string()),
                HistoryCommandErrorState::Corrupt,
            ),
            (
                HistoryError::Stale("expired continuation".to_string()),
                HistoryCommandErrorState::Stale,
            ),
            (
                HistoryError::Ineligible("recovery required".to_string()),
                HistoryCommandErrorState::Ineligible,
            ),
            (
                HistoryError::Missing("revision removed".to_string()),
                HistoryCommandErrorState::Missing,
            ),
        ] {
            assert_eq!(
                HistoryCommandError::from_history_error("test_operation", error).state,
                expected
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
            state
                .note_timeline()
                .finalize_editing_window(&note_id)
                .unwrap();
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

        let missing =
            block_on(list_missing_notes(app.handle().clone())).expect("list missing notes");

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

        let second_page = block_on(get_missing_note_history_page(
            restarted_app.handle().clone(),
            note_id.as_str().to_string(),
            cursor.clone(),
            MISSING_NOTE_HISTORY_PAGE_SIZE,
        ))
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

        let mismatched = block_on(get_missing_note_history_page(
            restarted_app.handle().clone(),
            "another-note".to_string(),
            cursor.clone(),
            MISSING_NOTE_HISTORY_PAGE_SIZE,
        ))
        .expect_err("reject continuation for another timeline");
        assert_eq!(mismatched.state, HistoryCommandErrorState::Stale);

        restarted_app
            .state::<AppState>()
            .note_timeline()
            .reset_history(notes.path())
            .expect("reset development history");
        let stale = block_on(get_missing_note_history_page(
            restarted_app.handle().clone(),
            note_id.as_str().to_string(),
            cursor,
            MISSING_NOTE_HISTORY_PAGE_SIZE,
        ))
        .expect_err("reject continuation from an older history generation");
        assert_eq!(stale.state, HistoryCommandErrorState::Stale);

        let recovered = block_on(recover_missing_note(
            restarted_app.handle().clone(),
            note_id.as_str().to_string(),
        ))
        .expect("recover Missing Note after paging and reset");
        assert!(PathBuf::from(recovered.restored_path).exists());
        set_notes_root_override(None).expect("clear notes root override");
    }
}
