use super::{
    forgotten_note_commands::{register_forgotten_chat_folder, resolve_forgotten_target_path},
    index_bridge::remove_notes_index_entry,
    prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    agent_tools::ActiveNoteSnapshot,
    chat::{
        ChatAttachmentInput, ChatConversation, ChatConversationSummary, ChatExcerpt, ChatGrant,
        ChatNotePolicy, ChatRequest, ChatRequestAccepted, ChatService, ChatSettings, VaultAccess,
    },
    index::AppState,
    note::DocumentKind,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatKeyStatus {
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatNoteCandidate {
    note_id: String,
    note_path: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateConversationRequest {
    title: Option<String>,
    access: Option<VaultAccess>,
    provider: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendMessageRequest {
    conversation_id: String,
    content: String,
    #[serde(default)]
    attachments: Vec<ChatAttachmentInput>,
    #[serde(default)]
    force_web_search: bool,
    active_note: Option<ActiveNoteSnapshot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateConversationProviderRequest {
    provider: String,
    model: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalModel {
    id: String,
    owned_by: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    #[serde(default)]
    data: Vec<OpenAiModel>,
}

#[derive(Deserialize)]
struct OpenAiModel {
    id: String,
    owned_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatModelCapabilities {
    images: bool,
    files: bool,
    accepted_mime_types: Vec<String>,
}

const IMAGE_MIME_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
const TEXT_FILE_MIME_TYPES: &[&str] = &[
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "text/css",
    "text/javascript",
    "text/x-python",
    "application/json",
    "application/xml",
    "application/rtf",
];

fn openai_supports_attachments(model: &str) -> bool {
    let model = model.trim().to_ascii_lowercase();
    ["gpt-4o", "gpt-4.1", "gpt-5", "o3", "o4"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

fn accepted_mime_types(images: bool, files: bool, pdf: bool) -> Vec<String> {
    IMAGE_MIME_TYPES
        .iter()
        .copied()
        .filter(|_| images)
        .chain(TEXT_FILE_MIME_TYPES.iter().copied().filter(|_| files))
        .chain(["application/pdf"].into_iter().filter(|_| pdf))
        .map(str::to_string)
        .collect()
}

async fn model_capabilities(
    _service: &ChatService,
    provider: &str,
    model: &str,
) -> Result<ChatModelCapabilities, String> {
    match provider.trim() {
        "openai" => {
            let multimodal = openai_supports_attachments(model);
            Ok(ChatModelCapabilities {
                images: multimodal,
                files: multimodal,
                accepted_mime_types: accepted_mime_types(multimodal, multimodal, multimodal),
            })
        }
        "local" => {
            Ok(ChatModelCapabilities {
                // The OpenAI-compatible model-listing contract does not
                // advertise vision support. Stay conservative until the app
                // has an explicit per-model capability setting.
                images: false,
                // Text files are decoded locally and supplied as text content.
                files: true,
                accepted_mime_types: accepted_mime_types(false, true, false),
            })
        }
        other => Err(format!("Unsupported chat provider '{other}'")),
    }
}

fn validate_model_accepts_attachments(
    attachments: &[ChatAttachmentInput],
    capabilities: &ChatModelCapabilities,
) -> Result<(), String> {
    if attachments
        .iter()
        .any(|attachment| attachment.kind == "image")
        && !capabilities.images
    {
        return Err("The selected model does not accept image input".to_string());
    }
    if attachments
        .iter()
        .any(|attachment| attachment.kind == "file")
        && !capabilities.files
    {
        return Err("The selected model does not accept file input".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn chat_get_settings(service: State<'_, ChatService>) -> Result<ChatSettings, String> {
    service.get_settings()
}

#[tauri::command]
pub(crate) fn chat_set_settings(
    service: State<'_, ChatService>,
    settings: ChatSettings,
) -> Result<ChatSettings, String> {
    service.set_settings(settings)
}

#[tauri::command]
pub(crate) fn chat_get_composer_draft(
    service: State<'_, ChatService>,
    slot: String,
) -> Result<String, String> {
    service.get_composer_draft(&slot)
}

#[tauri::command]
pub(crate) fn chat_set_composer_draft(
    service: State<'_, ChatService>,
    slot: String,
    body: String,
) -> Result<(), String> {
    service.set_composer_draft(&slot, &body)
}

#[tauri::command]
pub(crate) fn chat_get_key_status(app: AppHandle) -> Result<ChatKeyStatus, String> {
    Ok(ChatKeyStatus {
        configured: crate::secrets::has_openai_api_key(&app)?,
    })
}

#[tauri::command]
pub(crate) fn chat_set_api_key(app: AppHandle, api_key: String) -> Result<ChatKeyStatus, String> {
    let configured = !api_key.trim().is_empty();
    crate::secrets::set_openai_api_key(&app, &api_key)?;
    Ok(ChatKeyStatus { configured })
}

#[tauri::command]
pub(crate) fn chat_create_conversation(
    service: State<'_, ChatService>,
    request: CreateConversationRequest,
) -> Result<ChatConversation, String> {
    service.create_conversation_with_config(
        request.title,
        request.access,
        request.provider,
        request.model,
    )
}

#[tauri::command]
pub(crate) fn chat_list_conversations(
    service: State<'_, ChatService>,
) -> Result<Vec<ChatConversationSummary>, String> {
    service.list_conversations()
}

#[tauri::command]
pub(crate) fn chat_get_conversation(
    service: State<'_, ChatService>,
    conversation_id: String,
) -> Result<ChatConversation, String> {
    service.mark_projection_detached_if_needed(&conversation_id)?;
    service.get_conversation(&conversation_id)
}

#[tauri::command]
pub(crate) fn chat_rename_conversation(
    service: State<'_, ChatService>,
    conversation_id: String,
    title: String,
) -> Result<ChatConversation, String> {
    service.rename_conversation(&conversation_id, &title)
}

#[tauri::command]
pub(crate) fn chat_archive_conversation(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    conversation_id: String,
    archived: bool,
    retention_days: u32,
) -> Result<Option<super::ForgottenNoteSummary>, String> {
    if !archived {
        return Err("Restore forgotten chats from Settings → Forgotten Items".to_string());
    }

    let notes_dir = prepare_notes_dir(true)?;
    let snapshot = service.forgotten_folder_snapshot(&conversation_id)?;
    if snapshot.archived {
        return Ok(None);
    }
    let forgotten_root = crate::state::forgotten_notes_root(&notes_dir);
    std::fs::create_dir_all(&forgotten_root).map_err(|error| error.to_string())?;
    let forgotten_path = resolve_forgotten_target_path(&notes_dir, &snapshot.original_path);
    let relocation = service.archive_conversation_folder(&conversation_id, &forgotten_path)?;
    let forgotten_summary = match register_forgotten_chat_folder(
        &notes_dir,
        &snapshot.original_path,
        &forgotten_path,
        &snapshot.title,
        &conversation_id,
        retention_days,
    ) {
        Ok(summary) => summary,
        Err(error) => {
            let _ = service.restore_conversation_folder(
                &conversation_id,
                &forgotten_path,
                &snapshot.original_path,
            );
            return Err(error);
        }
    };
    for path in relocation.previous_paths {
        if let Err(error) = state.semantic.queue_delete_note(&path) {
            eprintln!(
                "chat projection semantic-index removal failed for {}: {error}",
                path.display()
            );
        }
        if let Err(error) = remove_notes_index_entry(&state, &path) {
            eprintln!(
                "chat projection derived-index removal failed for {}: {error}",
                path.display()
            );
        }
    }
    Ok(Some(forgotten_summary))
}

#[tauri::command]
pub(crate) fn chat_update_conversation_policy(
    service: State<'_, ChatService>,
    conversation_id: String,
    access: VaultAccess,
) -> Result<ChatConversation, String> {
    service.update_conversation_policy(&conversation_id, access)
}

#[tauri::command]
pub(crate) fn chat_update_conversation_provider(
    service: State<'_, ChatService>,
    conversation_id: String,
    request: UpdateConversationProviderRequest,
) -> Result<ChatConversation, String> {
    service.update_conversation_provider(&conversation_id, &request.provider, &request.model)
}

#[tauri::command]
pub(crate) async fn chat_list_local_models(base_url: String) -> Result<Vec<LocalModel>, String> {
    crate::agent_runtime::ensure_local_desktop()?;
    crate::agent_runtime::validate_local_base_url(&base_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Unable to configure local model client: {error}"))?;
    let models = client
        .get(format!("{}/models", base_url.trim_end_matches('/')))
        .send()
        .await
        .map_err(|error| format!("Unable to reach the local model server: {error}"))?;
    if !models.status().is_success() {
        return Err(format!("Local model server returned {}", models.status()));
    }
    let response = models
        .json::<OpenAiModelsResponse>()
        .await
        .map_err(|error| format!("Unable to read local models: {error}"))?;
    let mut available = response
        .data
        .into_iter()
        .map(|model| LocalModel {
            id: model.id,
            owned_by: model.owned_by,
        })
        .collect::<Vec<_>>();
    available.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(available)
}

#[tauri::command]
pub(crate) async fn chat_get_model_capabilities(
    service: State<'_, ChatService>,
    provider: String,
    model: String,
) -> Result<ChatModelCapabilities, String> {
    model_capabilities(&service, &provider, &model).await
}

#[tauri::command]
pub(crate) fn chat_set_note_excluded(
    service: State<'_, ChatService>,
    note_id: String,
    title: String,
    excluded: bool,
) -> Result<(), String> {
    service.set_note_excluded(&note_id, &title, excluded)
}

#[tauri::command]
pub(crate) fn chat_list_pending_proposals(
    service: State<'_, ChatService>,
    conversation_id: String,
) -> Result<Vec<crate::chat::ChatAgentProposal>, String> {
    service.list_pending_agent_proposals(&conversation_id)
}

#[tauri::command]
pub(crate) fn chat_list_note_policies(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatNotePolicy>, String> {
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "chat_list_note_policies",
    )?;
    let mut policies = service.list_note_policies()?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index lock poisoned".to_string())?;
    for policy in &mut policies {
        let Some((path, note)) = index.get_note_by_note_id(&policy.note_id) else {
            continue;
        };
        policy.title = note.title.clone();
        policy.note_path = Some(
            path.strip_prefix(&notes_dir)
                .unwrap_or(path)
                .to_string_lossy()
                .into_owned(),
        );
    }
    Ok(policies)
}

#[tauri::command]
pub(crate) fn chat_search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ChatNoteCandidate>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "chat_search_notes",
    )?;
    crate::services::retrieval::retrieve_vault_notes(
        &state,
        query,
        limit.unwrap_or(12).clamp(1, 20),
        None,
        &HashSet::new(),
        None,
        None,
    )
    .map(|items| {
        items
            .into_iter()
            .map(|item| ChatNoteCandidate {
                note_id: item.note_id,
                note_path: item
                    .note_path
                    .strip_prefix(&notes_dir)
                    .unwrap_or(&item.note_path)
                    .to_string_lossy()
                    .into_owned(),
                title: item.title,
            })
            .collect()
    })
}

#[tauri::command]
pub(crate) async fn chat_send_message(
    app: AppHandle,
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    request: SendMessageRequest,
) -> Result<ChatRequestAccepted, String> {
    let conversation = service.get_conversation(&request.conversation_id)?;
    let capabilities = model_capabilities(
        &service,
        &conversation.summary.provider,
        &conversation.summary.model,
    )
    .await?;
    validate_model_accepts_attachments(&request.attachments, &capabilities)?;
    let _foreground_guard = state.foreground_guard();
    service.begin_request(
        ChatRequest::New {
            conversation_id: request.conversation_id,
            content: request.content,
            attachments: request.attachments,
            force_web_search: request.force_web_search,
            active_note: request.active_note,
        },
        app,
    )
}

#[tauri::command]
pub(crate) fn chat_cancel_request(
    service: State<'_, ChatService>,
    request_id: String,
) -> Result<(), String> {
    service.cancel_request(&request_id)
}

#[tauri::command]
pub(crate) async fn chat_retry_message(
    app: AppHandle,
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    conversation_id: String,
    message_id: String,
) -> Result<ChatRequestAccepted, String> {
    let conversation = service.get_conversation(&conversation_id)?;
    let assistant = conversation
        .messages
        .iter()
        .find(|message| message.id == message_id && message.role == "assistant")
        .ok_or_else(|| {
            "Only failed or interrupted assistant messages can be retried".to_string()
        })?;
    if assistant.status != "error" && assistant.status != "cancelled" {
        return Err("Only failed or interrupted assistant messages can be retried".to_string());
    }
    let user = conversation
        .messages
        .iter()
        .rev()
        .find(|message| message.ordinal < assistant.ordinal && message.role == "user")
        .ok_or_else(|| "The original user message is missing".to_string())?;
    let capabilities = model_capabilities(
        &service,
        &conversation.summary.provider,
        &conversation.summary.model,
    )
    .await?;
    let retry_attachments = user
        .attachments
        .iter()
        .map(|attachment| ChatAttachmentInput {
            kind: attachment.kind.clone(),
            name: attachment.name.clone(),
            mime_type: attachment.mime_type.clone(),
            size_bytes: attachment.size_bytes,
            data_base64: attachment.data_base64.clone(),
        })
        .collect::<Vec<_>>();
    validate_model_accepts_attachments(&retry_attachments, &capabilities)?;
    let _foreground_guard = state.foreground_guard();
    service.begin_request(
        ChatRequest::Retry {
            conversation_id,
            user_message_id: user.id.clone(),
            failed_assistant_message_id: message_id,
        },
        app,
    )
}

#[tauri::command]
pub(crate) fn chat_create_excerpt(
    service: State<'_, ChatService>,
    conversation_id: String,
    message_id: String,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
    selected_text: Option<String>,
) -> Result<ChatExcerpt, String> {
    if let Some(selected_text) = selected_text {
        return service.create_excerpt_from_selection(
            &conversation_id,
            &message_id,
            &selected_text,
            start_offset.zip(end_offset),
        );
    }
    let (start_offset, end_offset) = start_offset
        .zip(end_offset)
        .ok_or_else(|| "Select a valid non-empty passage".to_string())?;
    service.create_excerpt(&conversation_id, &message_id, start_offset, end_offset)
}

#[tauri::command]
pub(crate) fn chat_remember_excerpt(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    excerpt_id: String,
) -> Result<ChatExcerpt, String> {
    let _foreground_guard = state.foreground_guard();
    let excerpt = service.set_excerpt_remembered(&excerpt_id, true)?;
    sync_chat_recall(&service, &state, &excerpt.conversation_id)?;
    crate::commands::emit_semantic_status_changed(&state);
    emit_chat_recall_changed(&service, &state, &excerpt.conversation_id)?;
    Ok(excerpt)
}

#[tauri::command]
pub(crate) fn chat_unremember_excerpt(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    excerpt_id: String,
) -> Result<ChatExcerpt, String> {
    let _foreground_guard = state.foreground_guard();
    let excerpt = service.set_excerpt_remembered(&excerpt_id, false)?;
    sync_chat_recall(&service, &state, &excerpt.conversation_id)?;
    crate::commands::emit_semantic_status_changed(&state);
    emit_chat_recall_changed(&service, &state, &excerpt.conversation_id)?;
    Ok(excerpt)
}

pub(super) fn sync_chat_recall(
    service: &ChatService,
    state: &AppState,
    conversation_id: &str,
) -> Result<(), String> {
    let recall = service.recall_document(conversation_id)?;
    state.semantic.queue_chat_recall(
        &recall.path,
        recall.title,
        recall.excerpts,
        recall.modified_millis,
    )
}

fn emit_chat_recall_changed(
    service: &ChatService,
    state: &AppState,
    conversation_id: &str,
) -> Result<(), String> {
    state.events.vault_document_changed(
        &service.recall_document(conversation_id)?.path,
        false,
        DocumentKind::ChatIndex,
        "chatRecall",
        Some(conversation_id.to_string()),
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn chat_list_grants(service: State<'_, ChatService>) -> Result<Vec<ChatGrant>, String> {
    service.list_grants()
}

#[tauri::command]
pub(crate) fn chat_grant_note(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), String> {
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index lock poisoned".to_string())?;
    let (_, note) = index
        .get_note_by_note_id(&note_id)
        .ok_or_else(|| "That note no longer exists".to_string())?;
    service.grant_note(&note_id, &note.title)
}

#[tauri::command]
pub(crate) fn chat_revoke_note(
    service: State<'_, ChatService>,
    note_id: String,
) -> Result<(), String> {
    service.revoke_note(&note_id)
}

#[tauri::command]
pub(crate) fn chat_find_conversation_by_projection_path(
    service: State<'_, ChatService>,
    note_path: String,
) -> Result<Option<String>, String> {
    let path = PathBuf::from(note_path);
    let absolute_path = if path.is_absolute() {
        path
    } else {
        service.notes_root().join(path)
    };
    service.projection_owner_for_path(&absolute_path)
}

#[tauri::command]
pub(crate) fn chat_resolve_projection_conflict(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    conversation_id: String,
    action: String,
) -> Result<Option<String>, String> {
    let converted = service.resolve_projection_conflict(&conversation_id, &action)?;
    let projection = service.recall_document(&conversation_id)?.path;
    state.events.vault_document_changed(
        &projection,
        false,
        DocumentKind::ChatIndex,
        "chatProjectionConflictResolved",
        Some(conversation_id),
    );
    Ok(converted)
}

#[cfg(test)]
mod attachment_capability_tests {
    use super::*;

    #[test]
    fn openai_attachment_support_is_conservative_for_unknown_models() {
        assert!(openai_supports_attachments("gpt-5.6-terra"));
        assert!(openai_supports_attachments("gpt-4o-mini"));
        assert!(!openai_supports_attachments("text-only-custom-model"));
    }

    #[test]
    fn capability_validation_rejects_images_for_text_only_models() {
        let capabilities = ChatModelCapabilities {
            images: false,
            files: true,
            accepted_mime_types: accepted_mime_types(false, true, false),
        };
        let attachment = ChatAttachmentInput {
            kind: "image".to_string(),
            name: "shot.png".to_string(),
            mime_type: "image/png".to_string(),
            size_bytes: 1,
            data_base64: "AA==".to_string(),
        };
        assert!(validate_model_accepts_attachments(&[attachment], &capabilities).is_err());
    }
}
