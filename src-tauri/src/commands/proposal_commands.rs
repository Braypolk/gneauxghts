use crate::{
    chat::{ChatAgentProposal, ChatService, VaultAccess},
    commands::history_commands::{tag_history_cause, take_history_cause, HistoryCommandError},
    index::AppState,
    proposals::{
        commit_prepared_note_creation_at_path, commit_prepared_note_review,
        plan_agent_creation_commit, plan_agent_update_commit, CommitNoteReviewResult,
        ProposalPreview,
    },
    services::note_timeline::{MutationSource, NoteIdentity, NoteMutation, PreparedHistoryIntent},
    state::{notes_root, with_note_file_mutation},
};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalCommitError {
    message: &'static str,
    recovery_action: &'static str,
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "domain", content = "failure", rename_all = "camelCase")]
pub(crate) enum ProposalCommitCommandError {
    History(HistoryCommandError),
    Proposal(ProposalCommitError),
}

fn proposal_commit_error(cause: String) -> ProposalCommitCommandError {
    if let Some(history_cause) = take_history_cause(&cause) {
        ProposalCommitCommandError::History(HistoryCommandError::from_cause(
            "commit_agent_proposal",
            history_cause,
        ))
    } else {
        eprintln!("Proposal commit command failed: {cause}");
        ProposalCommitCommandError::Proposal(ProposalCommitError {
            message: "The proposal could not be committed right now.",
            recovery_action: "retry",
        })
    }
}

#[tauri::command]
pub(crate) fn commit_agent_proposal(
    state: State<'_, AppState>,
    service: State<'_, ChatService>,
    proposal_id: String,
    markdown: Option<String>,
) -> Result<CommitNoteReviewResult, ProposalCommitCommandError> {
    commit_agent_proposal_inner(state, service, proposal_id, markdown)
        .map_err(proposal_commit_error)
}

fn commit_agent_proposal_inner(
    state: State<'_, AppState>,
    service: State<'_, ChatService>,
    proposal_id: String,
    markdown: Option<String>,
) -> Result<CommitNoteReviewResult, String> {
    let proposal = service.get_agent_proposal(&proposal_id)?;
    if proposal.status != "pending" && proposal.status != "conflict" {
        return Err("That proposal is no longer unresolved".to_string());
    }
    let conversation = service.get_conversation(&proposal.conversation_id)?;
    if proposal.kind == "update" {
        let note_id = proposal
            .note_id
            .as_deref()
            .ok_or_else(|| "The update proposal has no note target".to_string())?;
        if !service.note_is_allowed(&conversation.summary.access, note_id)? {
            return Err("That note is no longer allowed by the conversation policy".to_string());
        }
    } else if proposal.kind == "create" && conversation.summary.access == VaultAccess::None {
        return Err("Vault access is disabled for this conversation".to_string());
    }
    let notes_dir = notes_root()?;
    let (plan, committed_markdown, create_title, expected_base_hash) = if proposal.kind == "update"
    {
        let preview: ProposalPreview = serde_json::from_value(proposal.preview.clone())
            .map_err(|error| format!("Stored proposal preview is invalid: {error}"))?;
        let committed_markdown = markdown.unwrap_or(preview.proposed_editor_markdown);
        let plan = plan_agent_update_commit(&notes_dir, &preview.note_path, &committed_markdown)?;
        (
            plan,
            committed_markdown,
            None,
            Some(
                proposal
                    .base_hash
                    .clone()
                    .unwrap_or(preview.base_content_hash),
            ),
        )
    } else if proposal.kind == "create" {
        #[derive(serde::Deserialize)]
        struct CreatePayload {
            title: String,
            markdown: String,
        }
        let payload: CreatePayload = serde_json::from_value(proposal.payload.clone())
            .map_err(|error| format!("Stored creation proposal is invalid: {error}"))?;
        let committed_markdown = markdown.unwrap_or(payload.markdown);
        let suggested_path = proposal
            .suggested_path
            .as_deref()
            .ok_or_else(|| "The creation proposal has no target path".to_string())?;
        let plan = plan_agent_creation_commit(&notes_dir, suggested_path, &committed_markdown)?;
        (plan, committed_markdown, Some(payload.title), None)
    } else {
        return Err("Unsupported proposal kind".to_string());
    };
    let intent = service.begin_agent_proposal_commit(
        &proposal_id,
        &plan.target_path,
        &plan.intended_editor_content_hash,
    )?;
    let retained_identity = (proposal.kind == "update")
        .then(|| proposal.note_id.as_deref().map(NoteIdentity::new))
        .flatten();
    let commit_result = with_note_file_mutation(|| {
        let timeline = state.note_timeline();
        let prepared = timeline
            .prepare_revision_publication(
                MutationSource::AcceptedChatProposal,
                &intent.target_path,
                (proposal.kind == "update").then_some(intent.target_path.as_path()),
                retained_identity.as_ref(),
                &committed_markdown,
            )
            .map_err(tag_history_cause)?;
        let publication_result = if proposal.kind == "update" {
            commit_prepared_note_review(
                &notes_dir,
                intent.target_path.to_string_lossy().into_owned(),
                expected_base_hash
                    .clone()
                    .expect("update proposal base hash was parsed"),
                &prepared,
            )
        } else {
            commit_prepared_note_creation_at_path(
                &notes_dir,
                &intent.target_path,
                create_title
                    .clone()
                    .expect("creation proposal title was parsed"),
                &prepared,
            )
        };
        let mut result = match publication_result {
            Ok(result) => result,
            Err(publication_error) => {
                let (_, history_intent) = prepared.into_parts();
                return Err(history_intent.abandon_after_publication_failure(publication_error));
            }
        };
        if result.applied.is_none() {
            let (_, history_intent) = prepared.into_parts();
            history_intent.abandon().map_err(tag_history_cause)?;
            return Ok(result);
        }
        let (committed_markdown, history_intent) = prepared.into_parts();
        let synchronization =
            synchronize_applied_change(&state, &result, history_intent, committed_markdown);
        result.note_id = Some(synchronization.note_id);
        result.commit_warning = synchronization.commit_warning;
        Ok(result)
    });
    let result = match commit_result {
        Ok(result) => result,
        Err(error) => {
            converge_agent_proposal_status(&service, &proposal_id, "conflict", false)?;
            return Err(error);
        }
    };
    let resolution = if result.status == "committed" {
        "committed"
    } else {
        "conflict"
    };
    converge_agent_proposal_status(&service, &proposal_id, resolution, result.applied.is_some())?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn dismiss_agent_proposal(
    service: State<'_, ChatService>,
    proposal_id: String,
) -> Result<ChatAgentProposal, String> {
    service.resolve_agent_proposal(&proposal_id, "dismissed")
}

struct ProposalSynchronization {
    note_id: String,
    commit_warning: Option<crate::services::note_timeline::NoteMutationWarning>,
}

fn synchronize_applied_change(
    state: &AppState,
    result: &CommitNoteReviewResult,
    history_intent: PreparedHistoryIntent,
    fallback_markdown: String,
) -> ProposalSynchronization {
    let applied = result
        .applied
        .as_ref()
        .expect("proposal synchronization requires a committed change");
    let path = applied
        .path
        .as_deref()
        .expect("committed proposal change requires a canonical path");
    let outcome = state
        .note_timeline()
        .mutate(NoteMutation::accepted_chat_proposal(
            history_intent,
            PathBuf::from(path),
            applied.previous_path.as_deref().map(PathBuf::from),
            fallback_markdown,
        ));
    outcome.report_degraded("proposal commit");
    ProposalSynchronization {
        note_id: outcome.note_id().as_str().to_string(),
        commit_warning: outcome.warning().cloned(),
    }
}

fn converge_agent_proposal_status(
    service: &ChatService,
    proposal_id: &str,
    intended_status: &str,
    canonical_bytes_committed: bool,
) -> Result<(), String> {
    if service
        .finish_agent_proposal_commit(proposal_id, intended_status)
        .is_ok()
    {
        return Ok(());
    }

    let recovery = service.recover_agent_proposal_commit(proposal_id);
    let recovered_status = service
        .get_agent_proposal(proposal_id)
        .ok()
        .map(|proposal| proposal.status);
    if recovery.is_ok() && recovered_status.as_deref() == Some(intended_status) {
        return Ok(());
    }

    let detail = match (recovery, recovered_status) {
        (Err(error), _) => error,
        (Ok(_), Some(status)) => format!("recovery resolved proposal as {status}"),
        (Ok(_), None) => "proposal status could not be reloaded after recovery".to_string(),
    };
    if canonical_bytes_committed {
        eprintln!(
            "proposal {proposal_id} committed canonical note bytes but durable status synchronization degraded: {detail}"
        );
        Ok(())
    } else {
        Err(format!(
            "Proposal filesystem commit did not complete, and status synchronization failed: {detail}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::EventBus,
        semantic::SemanticState,
        services::note_timeline::{inject_history_finalization_failure_once, MutationWarningStage},
    };
    use std::fs;

    #[test]
    fn proposal_commit_errors_keep_chat_and_history_owners_separate() {
        let history = proposal_commit_error(tag_history_cause(
            "History page cursor changed while committing".to_string(),
        ));
        assert_eq!(
            serde_json::to_value(history).expect("serialize history failure"),
            serde_json::json!({
                "domain": "history",
                "failure": {
                    "state": "stale",
                    "message": "History changed before this action finished.",
                    "recoveryAction": "refresh"
                }
            })
        );

        let proposal =
            proposal_commit_error("SELECT proposal FROM /private/chat.sqlite3 failed".to_string());
        let serialized = serde_json::to_string(&proposal).expect("serialize proposal failure");
        assert!(serialized.contains("The proposal could not be committed right now."));
        assert!(!serialized.contains("SELECT"));
        assert!(!serialized.contains("/private"));
    }

    #[test]
    fn proposal_synchronization_returns_history_finalization_warning() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("proposal-warning-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("proposal-warning-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let path = notes.path().join("Proposal.md");
        let prepared = state
            .note_timeline()
            .prepare_revision_publication(
                MutationSource::AcceptedChatProposal,
                &path,
                None,
                None,
                "proposal content",
            )
            .unwrap();
        let (canonical, history_intent) = prepared.into_parts();
        fs::write(&path, &canonical).unwrap();
        let result = CommitNoteReviewResult {
            status: "committed".to_string(),
            applied: Some(crate::proposals::AppliedNoteChange {
                kind: "createNote".to_string(),
                path: Some(path.to_string_lossy().into_owned()),
                previous_path: None,
            }),
            note_id: None,
            message: None,
            commit_warning: None,
        };
        inject_history_finalization_failure_once();

        let synchronization =
            synchronize_applied_change(&state, &result, history_intent, canonical);

        assert!(!synchronization.note_id.is_empty());
        assert!(synchronization
            .commit_warning
            .unwrap()
            .issues()
            .iter()
            .any(|issue| issue.stage() == MutationWarningStage::HistoryFinalization));
        crate::state::set_notes_root_override(None).unwrap();
    }
}
