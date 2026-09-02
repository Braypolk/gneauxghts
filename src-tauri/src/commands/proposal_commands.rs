use crate::{
    chat::{ChatAgentProposal, ChatService, VaultAccess},
    index::AppState,
    proposals::{
        commit_note_creation_at_path, commit_note_review as commit_review,
        plan_agent_creation_commit, plan_agent_update_commit, CommitNoteReviewResult,
        ProposalPreview,
    },
    services::note_timeline::{NoteMutation, NoteTimeline},
    state::notes_root,
};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub(crate) fn commit_agent_proposal(
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
    let commit_result = if proposal.kind == "update" {
        commit_review(
            &notes_dir,
            intent.target_path.to_string_lossy().into_owned(),
            expected_base_hash.expect("update proposal base hash was parsed"),
            committed_markdown.clone(),
        )
    } else {
        commit_note_creation_at_path(
            &notes_dir,
            &intent.target_path,
            create_title.expect("creation proposal title was parsed"),
            committed_markdown.clone(),
        )
    };
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
    synchronize_applied_change(&state, &result, committed_markdown);
    Ok(result)
}

#[tauri::command]
pub(crate) fn dismiss_agent_proposal(
    service: State<'_, ChatService>,
    proposal_id: String,
) -> Result<ChatAgentProposal, String> {
    service.resolve_agent_proposal(&proposal_id, "dismissed")
}

fn synchronize_applied_change(
    state: &State<'_, AppState>,
    result: &CommitNoteReviewResult,
    fallback_markdown: String,
) {
    let Some(applied) = result.applied.as_ref() else {
        return;
    };
    let Some(path) = applied.path.as_deref() else {
        return;
    };
    let outcome = NoteTimeline::new(state).mutate(NoteMutation::accepted_chat_proposal(
        PathBuf::from(path),
        applied.previous_path.as_deref().map(PathBuf::from),
        fallback_markdown,
    ));
    outcome.report_degraded("proposal commit");
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
