use super::index_bridge::upsert_notes_index_entry_for_save;
use crate::{
    chat::{ChatAgentProposal, ChatService, VaultAccess},
    index::build_indexed_note,
    index::AppState,
    proposals::{
        commit_note_creation, commit_note_review as commit_review, preview_note_change,
        preview_note_creation, CommitNoteReviewResult, CreationProposalPreview, ProposalPreview,
        ProposedTextEdit,
    },
    state::notes_root,
    time::current_time_millis,
};
use std::{fs, path::Path};
use tauri::State;

#[tauri::command]
pub(crate) fn preview_note_change_proposal(
    path: String,
    edits: Vec<ProposedTextEdit>,
) -> Result<ProposalPreview, String> {
    let notes_dir = notes_root()?;
    preview_note_change(&notes_dir, &path, &edits)
}

#[tauri::command]
pub(crate) fn preview_note_creation_proposal(
    title: String,
    markdown: String,
) -> Result<CreationProposalPreview, String> {
    preview_note_creation(&notes_root()?, &title, &markdown)
}

#[tauri::command]
pub(crate) fn commit_note_review(
    state: State<'_, AppState>,
    path: String,
    expected_base_hash: String,
    markdown: String,
) -> Result<CommitNoteReviewResult, String> {
    let notes_dir = notes_root()?;
    let result = commit_review(&notes_dir, path, expected_base_hash, markdown)?;
    if let Some(applied) = result.applied.as_ref() {
        let saved = applied
            .path
            .as_deref()
            .and_then(|path| refresh_saved_note_best_effort(&state, Path::new(path)));
        if let Some((note_id, title, revision)) = saved {
            state
                .events
                .note_saved(Some(note_id), applied.path.clone(), title, revision);
        }
    }
    Ok(result)
}

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
    let result = if proposal.kind == "update" {
        let preview: ProposalPreview = serde_json::from_value(proposal.preview.clone())
            .map_err(|error| format!("Stored proposal preview is invalid: {error}"))?;
        commit_review(
            &notes_dir,
            preview.note_path,
            proposal
                .base_hash
                .clone()
                .unwrap_or(preview.base_content_hash),
            markdown.unwrap_or(preview.proposed_editor_markdown),
        )?
    } else if proposal.kind == "create" {
        #[derive(serde::Deserialize)]
        struct CreatePayload {
            title: String,
            markdown: String,
        }
        let payload: CreatePayload = serde_json::from_value(proposal.payload.clone())
            .map_err(|error| format!("Stored creation proposal is invalid: {error}"))?;
        commit_note_creation(
            &notes_dir,
            payload.title,
            markdown.unwrap_or(payload.markdown),
        )?
    } else {
        return Err("Unsupported proposal kind".to_string());
    };
    let resolution = if result.status == "committed" {
        "committed"
    } else {
        "conflict"
    };
    let _ = service.resolve_agent_proposal(&proposal_id, resolution)?;
    refresh_applied_change(&state, &result);
    Ok(result)
}

#[tauri::command]
pub(crate) fn dismiss_agent_proposal(
    service: State<'_, ChatService>,
    proposal_id: String,
) -> Result<ChatAgentProposal, String> {
    service.resolve_agent_proposal(&proposal_id, "dismissed")
}

fn refresh_applied_change(state: &State<'_, AppState>, result: &CommitNoteReviewResult) {
    let Some(applied) = result.applied.as_ref() else {
        return;
    };
    let saved = applied
        .path
        .as_deref()
        .and_then(|path| refresh_saved_note_best_effort(state, Path::new(path)));
    if let Some((note_id, title, revision)) = saved {
        state
            .events
            .note_saved(Some(note_id), applied.path.clone(), title, revision);
    }
}

/// Secondary save-side work must never turn a completed atomic write into a
/// failed review. Return metadata only when enough work succeeded to emit the
/// same useful event shape as an ordinary save.
fn refresh_saved_note_best_effort(
    state: &State<'_, AppState>,
    path: &Path,
) -> Option<(String, String, u64)> {
    refresh_saved_note_best_effort_at(state, path, current_time_millis().unwrap_or(0))
}

fn refresh_saved_note_best_effort_at(
    state: &State<'_, AppState>,
    path: &Path,
    timestamp: u64,
) -> Option<(String, String, u64)> {
    let markdown = fs::read_to_string(path).ok()?;
    let indexed_note = build_indexed_note(path, &markdown, timestamp);
    let note_id = indexed_note.note_id.clone();
    let title = indexed_note.title.clone();
    let _ = upsert_notes_index_entry_for_save(state, path.to_path_buf(), indexed_note);
    let _ = state.semantic.queue_note_update(path, markdown, timestamp);
    let revision = state
        .notes_index
        .lock()
        .ok()
        .map(|index| index.revision())
        .unwrap_or(0);
    Some((note_id, title, revision))
}
