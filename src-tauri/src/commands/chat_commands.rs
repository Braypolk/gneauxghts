use crate::{
    chat::{
        self, ChatConversation, ChatConversationSummary, ChatExcerpt, ChatGrant, ChatMode,
        ChatRequestAccepted, ChatService, ChatSettings, ChatSource, VaultAccess,
    },
    index::AppState,
    note::{self, DocumentKind},
};
use serde::{Deserialize, Serialize};
use std::{cmp::Reverse, collections::HashSet, fs};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatKeyStatus {
    configured: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateConversationRequest {
    title: Option<String>,
    mode: Option<ChatMode>,
    access: Option<VaultAccess>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendMessageRequest {
    conversation_id: String,
    content: String,
    #[serde(default)]
    use_web_search: bool,
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
pub(crate) fn chat_get_key_status() -> Result<ChatKeyStatus, String> {
    Ok(ChatKeyStatus {
        configured: chat::api_key_status()?,
    })
}

#[tauri::command]
pub(crate) fn chat_set_api_key(api_key: String) -> Result<ChatKeyStatus, String> {
    chat::set_api_key(&api_key)?;
    chat_get_key_status()
}

#[tauri::command]
pub(crate) fn chat_create_conversation(
    service: State<'_, ChatService>,
    request: CreateConversationRequest,
) -> Result<ChatConversation, String> {
    service.create_conversation(request.title, request.mode, request.access)
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
    conversation_id: String,
    archived: bool,
) -> Result<(), String> {
    service.archive_conversation(&conversation_id, archived)
}

#[tauri::command]
pub(crate) fn chat_update_conversation_policy(
    service: State<'_, ChatService>,
    conversation_id: String,
    mode: ChatMode,
    access: VaultAccess,
) -> Result<ChatConversation, String> {
    service.update_conversation_policy(&conversation_id, mode, access)
}

#[tauri::command]
pub(crate) fn chat_send_message(
    app: AppHandle,
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    request: SendMessageRequest,
) -> Result<ChatRequestAccepted, String> {
    let conversation = service.get_conversation(&request.conversation_id)?;
    let sources = build_context_sources(&service, &state, &conversation, &request.content)?;
    service.begin_request(
        &request.conversation_id,
        &request.content,
        sources,
        request.use_web_search,
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
pub(crate) fn chat_retry_message(
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
        .ok_or_else(|| "Only failed or interrupted assistant messages can be retried".to_string())?;
    if assistant.status != "error" && assistant.status != "cancelled" {
        return Err("Only failed or interrupted assistant messages can be retried".to_string());
    }
    let user = conversation
        .messages
        .iter()
        .rev()
        .find(|message| message.ordinal < assistant.ordinal && message.role == "user")
        .ok_or_else(|| "The original user message is missing".to_string())?;
    let sources = build_context_sources(&service, &state, &conversation, &user.content)?;
    service.begin_request(
        &conversation_id,
        &user.content,
        sources,
        conversation.summary.mode == ChatMode::Research,
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
    excerpt_id: String,
) -> Result<ChatExcerpt, String> {
    service.set_excerpt_remembered(&excerpt_id, true)
}

#[tauri::command]
pub(crate) fn chat_unremember_excerpt(
    service: State<'_, ChatService>,
    excerpt_id: String,
) -> Result<ChatExcerpt, String> {
    service.set_excerpt_remembered(&excerpt_id, false)
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
pub(crate) fn chat_resolve_projection_conflict(
    service: State<'_, ChatService>,
    conversation_id: String,
    action: String,
) -> Result<Option<String>, String> {
    service.resolve_projection_conflict(&conversation_id, &action)
}

fn build_context_sources(
    service: &ChatService,
    state: &AppState,
    conversation: &ChatConversation,
    query: &str,
) -> Result<Vec<ChatSource>, String> {
    if conversation.summary.access == VaultAccess::None {
        return Ok(Vec::new());
    }
    let allowed = if conversation.summary.access == VaultAccess::Limited {
        Some(service.granted_note_ids()?)
    } else {
        None
    };
    let query_terms = query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| term.len() > 2)
        .map(|term| term.to_lowercase())
        .collect::<HashSet<_>>();
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index lock poisoned".to_string())?;
    let mut candidates = index
        .entries
        .iter()
        .filter_map(|(path, indexed)| {
            if allowed.as_ref().is_some_and(|ids| !ids.contains(&indexed.note_id)) {
                return None;
            }
            let markdown = fs::read_to_string(path).ok()?;
            if note::document_kind(&markdown) != DocumentKind::Note {
                return None;
            }
            let haystack = format!(
                "{} {}",
                indexed.title_lower,
                indexed
                    .paragraphs
                    .iter()
                    .map(|paragraph| paragraph.text_lower.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            let score = if query_terms.is_empty() {
                1
            } else {
                query_terms.iter().filter(|term| haystack.contains(term.as_str())).count()
            };
            if score == 0 && allowed.is_none() {
                return None;
            }
            Some((score, path.clone(), indexed.note_id.clone(), indexed.title.clone(), markdown))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(score, ..)| Reverse(*score));
    candidates.truncate(8);
    Ok(candidates
        .into_iter()
        .map(|(_, path, note_id, title, markdown)| ChatSource {
            kind: "note".to_string(),
            note_id: Some(note_id),
            note_path: path
                .strip_prefix(&service_notes_root(service))
                .unwrap_or(&path)
                .to_str()
                .map(str::to_string),
            title,
            excerpt: note::strip_frontmatter(&markdown).chars().take(4_000).collect(),
            url: None,
            anchor: None,
        })
        .collect())
}

fn service_notes_root(_service: &ChatService) -> std::path::PathBuf {
    crate::state::notes_root().unwrap_or_default()
}
