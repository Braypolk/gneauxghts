use crate::{
    chat::{ChatAgentProposal, ChatService, VaultAccess},
    index::AppState,
    proposals::{
        plan_agent_creation_commit, plan_agent_update_commit, AppliedNoteChange,
        CommitNoteReviewResult, ProposalPreview,
    },
    services::note_timeline::{HistoryError, MutationSource, NoteIdentity},
};
use tauri::{Manager, State};

#[tauri::command]
pub(crate) async fn commit_agent_proposal<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    proposal_id: String,
    markdown: Option<String>,
) -> Result<CommitNoteReviewResult, String> {
    super::on_app_worker(app.clone(), move |state| {
        let service = app
            .try_state::<ChatService>()
            .ok_or_else(|| "Application state unavailable".to_string())?;
        commit_agent_proposal_with_state(state, &service, proposal_id, markdown)
    })
    .await?
}

pub(crate) fn commit_agent_proposal_with_state(
    state: &AppState,
    service: &ChatService,
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
    let notes_dir = state.running_vault().root().to_path_buf();
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
    let commit_result = (|| -> Result<CommitNoteReviewResult, String> {
        let timeline = state.note_timeline();
        let outcome = if proposal.kind == "update" {
            let mut base_conflict = false;
            match timeline.edit_note(
                MutationSource::AcceptedChatProposal,
                &intent.target_path,
                retained_identity.as_ref(),
                |current| {
                    if crate::semantic::db::content_hash(current)
                        != *expected_base_hash.as_ref().expect("update hash")
                    {
                        base_conflict = true;
                        return Err(HistoryError::Stale("Note changed on disk.".into()));
                    }
                    Ok(committed_markdown.clone())
                },
            ) {
                Ok(outcome) => Some(outcome),
                Err(HistoryError::Stale(_)) if base_conflict => None,
                Err(error) => return Err(error.to_string()),
            }
        } else {
            if create_title
                .as_deref()
                .expect("creation title")
                .trim()
                .is_empty()
            {
                return Err("A title is required for a new note.".into());
            }
            timeline.create_note_at(
                MutationSource::AcceptedChatProposal,
                &intent.target_path,
                &committed_markdown,
            )?
        };
        let Some(outcome) = outcome else {
            return Ok(CommitNoteReviewResult {
                status: "conflict".into(),
                applied: None,
                note_id: None,
                commit_warning: None,
                message: Some(
                    if proposal.kind == "update" {
                        "Note changed on disk."
                    } else {
                        "The proposed creation path is now occupied; review the proposal again."
                    }
                    .into(),
                ),
            });
        };
        outcome.report_degraded("proposal commit");
        Ok(CommitNoteReviewResult {
            status: "committed".into(),
            applied: Some(AppliedNoteChange {
                kind: if proposal.kind == "update" {
                    "updateNote"
                } else {
                    "createNote"
                }
                .into(),
                path: Some(outcome.path().to_string_lossy().into_owned()),
                previous_path: (proposal.kind == "update")
                    .then(|| intent.target_path.to_string_lossy().into_owned()),
            }),
            note_id: Some(outcome.note_id().as_str().into()),
            message: None,
            commit_warning: outcome.warning().cloned(),
        })
    })();
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
    #[test]
    fn proposal_publication_returns_history_finalization_warning() {
        let fixture = crate::test_support::TestVault::new("proposal-warning");
        crate::services::note_timeline::inject_history_finalization_failure_once();
        let outcome = fixture
            .state
            .note_timeline()
            .create_note_at(
                MutationSource::AcceptedChatProposal,
                &fixture.notes.path().join("Proposal.md"),
                "proposal content",
            )
            .unwrap()
            .unwrap();
        assert!(!outcome.note_id().as_str().is_empty());
        assert!(outcome
            .warning()
            .unwrap()
            .issues()
            .iter()
            .any(|issue| issue.stage()
                == crate::services::note_timeline::MutationWarningStage::HistoryFinalization));
    }
}
