use super::{
    forgotten_note_commands::{register_forgotten_chat_folder, resolve_forgotten_target_path},
    index_bridge::remove_notes_index_entry,
    prepare_notes_dir, INTERACTIVE_INDEX_REFRESH_MAX_AGE,
};
use crate::{
    agent_tools::ActiveNoteSnapshot,
    chat::{
        ChatAttachmentInput, ChatConversation, ChatConversationSummary, ChatExcerpt, ChatGrant,
        ChatNotePolicy, ChatRequest, ChatRequestAccepted, ChatRunContextItem, ChatService,
        ChatSettings, LocalModelCapabilitySelection, VaultAccess,
    },
    index::AppState,
    note::DocumentKind,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatKeyStatus {
    provider: String,
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatNoteCandidate {
    note_id: String,
    note_path: String,
    title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatContextSuggestion {
    note_id: String,
    title: String,
    section_label: Option<String>,
    excerpt: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
    block_anchor: Option<String>,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatContextSuggestionResponse {
    status: String,
    reason: Option<String>,
    items: Vec<ChatContextSuggestion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSuggestContextRequest {
    conversation_id: Option<String>,
    vault_access: VaultAccess,
    query: String,
    exclude_note_id: Option<String>,
    #[serde(default = "default_context_suggestion_limit")]
    limit: usize,
}

fn default_context_suggestion_limit() -> usize {
    4
}

const CONTEXT_DRAFT_WEIGHT: f32 = 1.0;
const CONTEXT_GENERATED_WEIGHT: f32 = 0.5;
const CONTEXT_ACTIVE_NOTE_WEIGHT: f32 = 0.2;
const MAX_CONTEXT_SIGNAL_CHARS: usize = 2_400;

struct WeightedContextCandidate {
    item: crate::services::retrieval::VaultRetrievalItem,
    weighted_score: f32,
    best_contribution: f32,
    best_priority: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateConversationRequest {
    title: Option<String>,
    access: Option<VaultAccess>,
    provider: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
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
    #[serde(default)]
    selected_context: Vec<ChatContextSelectionInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatContextSelectionInput {
    note_id: String,
    section_label: Option<String>,
    start_line: Option<usize>,
    end_line: Option<usize>,
    block_anchor: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateConversationProviderRequest {
    provider: String,
    model: String,
    reasoning_effort: String,
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

const CURATED_OPENAI_CHAT_MODELS: &[&str] = &[
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
];

fn curated_openai_models(models: Vec<OpenAiModel>) -> Vec<LocalModel> {
    let by_id = models
        .into_iter()
        .map(|model| (model.id.clone(), model))
        .collect::<std::collections::HashMap<_, _>>();
    CURATED_OPENAI_CHAT_MODELS
        .iter()
        .filter_map(|id| by_id.get(*id))
        .map(|model| LocalModel {
            id: model.id.clone(),
            owned_by: model.owned_by.clone(),
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatModelCapabilities {
    images: bool,
    audio: bool,
    video: bool,
    files: bool,
    accepted_mime_types: Vec<String>,
    tools: bool,
    default_reasoning_effort: Option<String>,
}

const IMAGE_MIME_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
const AUDIO_MIME_TYPES: &[&str] = &[
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/aiff",
    "audio/aac",
    "audio/ogg",
    "audio/flac",
    "audio/mp4",
    "audio/x-m4a",
];
const VIDEO_MIME_TYPES: &[&str] = &[
    "video/avi",
    "video/x-msvideo",
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/webm",
];
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

fn accepted_mime_types(
    images: bool,
    audio: bool,
    video: bool,
    files: bool,
    pdf: bool,
) -> Vec<String> {
    IMAGE_MIME_TYPES
        .iter()
        .copied()
        .filter(|_| images)
        .chain(AUDIO_MIME_TYPES.iter().copied().filter(|_| audio))
        .chain(VIDEO_MIME_TYPES.iter().copied().filter(|_| video))
        .chain(TEXT_FILE_MIME_TYPES.iter().copied().filter(|_| files))
        .chain(["application/pdf"].into_iter().filter(|_| pdf))
        .map(str::to_string)
        .collect()
}

fn model_capabilities(
    service: &ChatService,
    provider: &str,
    model: &str,
) -> Result<ChatModelCapabilities, String> {
    match provider.trim() {
        "openai" => {
            let multimodal = openai_supports_attachments(model);
            Ok(ChatModelCapabilities {
                images: multimodal,
                audio: false,
                video: false,
                files: multimodal,
                accepted_mime_types: accepted_mime_types(
                    multimodal, false, false, multimodal, multimodal,
                ),
                tools: true,
                default_reasoning_effort: None,
            })
        }
        "local" => {
            let selection = service.local_model_capabilities(model)?;
            Ok(ChatModelCapabilities {
                images: selection.images,
                audio: selection.audio,
                video: selection.video,
                // Text files are decoded locally and supplied as text content.
                files: true,
                accepted_mime_types: accepted_mime_types(
                    selection.images,
                    selection.audio,
                    selection.video,
                    true,
                    false,
                ),
                tools: selection.tools,
                default_reasoning_effort: Some(selection.reasoning_effort),
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
        .any(|attachment| attachment.mime_type.starts_with("audio/"))
        && !capabilities.audio
    {
        return Err("The selected model does not accept audio input".to_string());
    }
    if attachments
        .iter()
        .any(|attachment| attachment.mime_type.starts_with("video/"))
        && !capabilities.video
    {
        return Err("The selected model does not accept video input".to_string());
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
pub(crate) fn chat_get_key_status(
    app: AppHandle,
    provider: String,
) -> Result<ChatKeyStatus, String> {
    Ok(ChatKeyStatus {
        configured: crate::secrets::has_provider_api_key(&app, &provider)?,
        provider,
    })
}

#[tauri::command]
pub(crate) fn chat_set_api_key(
    app: AppHandle,
    provider: String,
    api_key: String,
) -> Result<ChatKeyStatus, String> {
    let configured = !api_key.trim().is_empty();
    crate::secrets::set_provider_api_key(&app, &provider, &api_key)?;
    Ok(ChatKeyStatus {
        provider,
        configured,
    })
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
        request.reasoning_effort,
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
pub(crate) fn chat_branch_from_message(
    service: State<'_, ChatService>,
    message_id: String,
) -> Result<ChatConversation, String> {
    service.branch_from_message(&message_id)
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
    service.update_conversation_provider(
        &conversation_id,
        &request.provider,
        &request.model,
        &request.reasoning_effort,
    )
}

#[tauri::command]
pub(crate) async fn chat_list_local_models(
    app: AppHandle,
    base_url: String,
) -> Result<Vec<LocalModel>, String> {
    crate::agent_runtime::ensure_local_desktop()?;
    crate::agent_runtime::validate_local_base_url(&base_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Unable to configure local model client: {error}"))?;
    let mut request = client.get(format!("{}/models", base_url.trim_end_matches('/')));
    if let Some(api_key) = crate::secrets::read_provider_api_key(&app, "local")? {
        request = request.bearer_auth(api_key);
    }
    let models = request
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
pub(crate) async fn chat_list_openai_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
    let api_key = crate::secrets::read_provider_api_key(&app, "openai")?
        .ok_or_else(|| "Add an OpenAI API key in Settings".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Unable to configure OpenAI model client: {error}"))?;
    let response = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("Unable to check available OpenAI models: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "OpenAI model availability returned {}",
            response.status()
        ));
    }
    let models = response
        .json::<OpenAiModelsResponse>()
        .await
        .map_err(|error| format!("Unable to read available OpenAI models: {error}"))?;
    Ok(curated_openai_models(models.data))
}

#[tauri::command]
pub(crate) fn chat_get_model_capabilities(
    service: State<'_, ChatService>,
    provider: String,
    model: String,
) -> Result<ChatModelCapabilities, String> {
    model_capabilities(&service, &provider, &model)
}

#[tauri::command]
pub(crate) fn chat_set_local_model_capabilities(
    service: State<'_, ChatService>,
    model: String,
    capabilities: LocalModelCapabilitySelection,
) -> Result<LocalModelCapabilitySelection, String> {
    service.set_local_model_capabilities(&model, capabilities)
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
        crate::services::retrieval::VaultDateFilters::default(),
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

fn truncate_context_signal(value: &str) -> String {
    value
        .trim()
        .chars()
        .take(MAX_CONTEXT_SIGNAL_CHARS)
        .collect()
}

fn generated_context_query(conversation: Option<&ChatConversation>) -> Option<String> {
    let mut remaining = MAX_CONTEXT_SIGNAL_CHARS;
    let mut messages = Vec::new();
    for message in conversation
        .into_iter()
        .flat_map(|conversation| conversation.messages.iter().rev())
        .filter(|message| {
            message.role == "assistant"
                && message.status == "completed"
                && !message.content.trim().is_empty()
        })
        .take(3)
    {
        if remaining == 0 {
            break;
        }
        let content = message
            .content
            .trim()
            .chars()
            .take(remaining)
            .collect::<String>();
        remaining = remaining.saturating_sub(content.chars().count());
        messages.push(content);
    }
    messages.reverse();
    (!messages.is_empty()).then(|| messages.join("\n\n"))
}

fn active_note_context_query(
    state: &AppState,
    note_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(note_id) = note_id else {
        return Ok(None);
    };
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index lock poisoned".to_string())?;
    let Some((_, note)) = index.get_note_by_note_id(note_id) else {
        return Ok(None);
    };
    let mut query = note.title.clone();
    for paragraph in &note.paragraphs {
        if query.chars().count() >= MAX_CONTEXT_SIGNAL_CHARS {
            break;
        }
        if !query.is_empty() {
            query.push('\n');
        }
        let remaining = MAX_CONTEXT_SIGNAL_CHARS.saturating_sub(query.chars().count());
        query.extend(paragraph.text.chars().take(remaining));
    }
    let query = truncate_context_signal(&query);
    Ok((!query.is_empty()).then_some(query))
}

fn merge_context_candidates(
    candidates: &mut HashMap<String, WeightedContextCandidate>,
    items: Vec<crate::services::retrieval::VaultRetrievalItem>,
    weight: f32,
    priority: u8,
    excluded_note_id: Option<&str>,
) {
    for item in items {
        if excluded_note_id == Some(item.note_id.as_str()) {
            continue;
        }
        let contribution = item.score * weight;
        match candidates.entry(item.note_id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(WeightedContextCandidate {
                    item,
                    weighted_score: contribution,
                    best_contribution: contribution,
                    best_priority: priority,
                });
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let candidate = entry.get_mut();
                candidate.weighted_score += contribution;
                if contribution > candidate.best_contribution
                    || (contribution == candidate.best_contribution
                        && priority > candidate.best_priority)
                {
                    candidate.item = item;
                    candidate.best_contribution = contribution;
                    candidate.best_priority = priority;
                }
            }
        }
    }
}

fn finish_context_candidates(
    candidates: HashMap<String, WeightedContextCandidate>,
    limit: usize,
) -> Vec<crate::services::retrieval::VaultRetrievalItem> {
    let mut candidates = candidates.into_values().collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .weighted_score
            .total_cmp(&left.weighted_score)
            .then_with(|| right.best_priority.cmp(&left.best_priority))
            .then_with(|| left.item.title.cmp(&right.item.title))
    });
    candidates
        .into_iter()
        .take(limit)
        .map(|candidate| candidate.item)
        .collect()
}

#[tauri::command]
pub(crate) fn chat_suggest_context(
    service: State<'_, ChatService>,
    state: State<'_, AppState>,
    request: ChatSuggestContextRequest,
) -> Result<ChatContextSuggestionResponse, String> {
    let conversation = request
        .conversation_id
        .as_deref()
        .map(|id| service.get_conversation(id))
        .transpose()?;
    let access = conversation
        .as_ref()
        .map(|chat| chat.summary.access.clone())
        .unwrap_or(request.vault_access);
    if access == VaultAccess::None {
        return Ok(ChatContextSuggestionResponse {
            status: "unavailable".to_string(),
            reason: Some("Vault access is off for this chat.".to_string()),
            items: Vec::new(),
        });
    }
    let query = request.query.trim().to_string();
    if query.split_whitespace().count() < 2 {
        return Ok(ChatContextSuggestionResponse {
            status: "insufficientContent".to_string(),
            reason: Some("Write a little more to find related notes.".to_string()),
            items: Vec::new(),
        });
    }
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "chat_suggest_context",
    )?;
    let excluded = service.excluded_note_ids()?;
    let excluded_note_id = request.exclude_note_id.as_deref();
    let limit = request.limit.clamp(1, 8);
    let candidate_limit = limit
        .saturating_mul(3)
        .saturating_add(usize::from(excluded_note_id.is_some()))
        .clamp(1, 20);
    let generated_query = generated_context_query(conversation.as_ref());
    let active_note_query = if excluded_note_id.is_some_and(|note_id| excluded.contains(note_id)) {
        None
    } else {
        active_note_context_query(&state, excluded_note_id)?
    };
    let mut candidates = HashMap::new();
    for (signal, weight, priority) in [
        (Some(query), CONTEXT_DRAFT_WEIGHT, 3),
        (generated_query, CONTEXT_GENERATED_WEIGHT, 2),
        (active_note_query, CONTEXT_ACTIVE_NOTE_WEIGHT, 1),
    ] {
        let Some(signal) = signal.filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        let retrieved = crate::services::retrieval::retrieve_vault_notes(
            &state,
            &truncate_context_signal(&signal),
            candidate_limit,
            None,
            &excluded,
            crate::services::retrieval::VaultDateFilters::default(),
        )?;
        merge_context_candidates(
            &mut candidates,
            retrieved,
            weight,
            priority,
            excluded_note_id,
        );
    }
    let items = finish_context_candidates(candidates, limit)
        .into_iter()
        .map(|item| ChatContextSuggestion {
            note_id: item.note_id,
            title: item.title,
            section_label: (!item.section_label.trim().is_empty()).then_some(item.section_label),
            excerpt: item.excerpt,
            start_line: item.start_line,
            end_line: item.end_line,
            block_anchor: item.block_anchor,
            reason: "related".to_string(),
        })
        .collect::<Vec<_>>();
    Ok(ChatContextSuggestionResponse {
        status: "ready".to_string(),
        reason: items
            .is_empty()
            .then(|| "No related notes found.".to_string()),
        items,
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
    )?;
    validate_model_accepts_attachments(&request.attachments, &capabilities)?;
    let _foreground_guard = state.foreground_guard();
    let selected_context = resolve_selected_context(
        &service,
        &state,
        &conversation.summary.access,
        &request.selected_context,
    )?;
    service.begin_request(
        ChatRequest::New {
            conversation_id: request.conversation_id,
            content: request.content,
            attachments: request.attachments,
            force_web_search: request.force_web_search,
            active_note: request.active_note,
            selected_context,
        },
        app,
    )
}

fn resolve_selected_context(
    service: &ChatService,
    state: &AppState,
    access: &VaultAccess,
    selected: &[ChatContextSelectionInput],
) -> Result<Vec<ChatRunContextItem>, String> {
    const MAX_SELECTED_CONTEXT: usize = 8;
    const MAX_CONTEXT_CHARS: usize = 12_000;
    if selected.len() > MAX_SELECTED_CONTEXT {
        return Err(format!(
            "Include up to {MAX_SELECTED_CONTEXT} notes per message"
        ));
    }
    if selected.is_empty() {
        return Ok(Vec::new());
    }
    if access == &VaultAccess::None {
        return Err("Enable vault access before including note context".to_string());
    }
    let notes_dir = prepare_notes_dir(false)?;
    state.ensure_interactive_index(
        &notes_dir,
        INTERACTIVE_INDEX_REFRESH_MAX_AGE,
        "chat_resolve_selected_context",
    )?;
    let excluded = service.excluded_note_ids()?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index lock poisoned".to_string())?;
    let mut resolved_notes = Vec::new();
    let mut seen = HashSet::new();
    for item in selected {
        if !seen.insert(item.note_id.clone()) {
            continue;
        }
        if excluded.contains(&item.note_id) {
            return Err("An included note is excluded from AI".to_string());
        }
        let (path, indexed) = index
            .get_note_by_note_id(&item.note_id)
            .ok_or_else(|| "An included note is no longer available".to_string())?;
        resolved_notes.push((item.clone(), path.clone(), indexed.title.clone()));
    }
    drop(index);

    resolved_notes
        .into_iter()
        .map(|(item, path, title)| {
            let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
            let body = crate::note::strip_frontmatter(&raw);
            let lines = body.lines().collect::<Vec<_>>();
            let start_line = item.start_line.unwrap_or(1).max(1);
            let requested_end = item.end_line.unwrap_or(lines.len()).max(start_line);
            let mut excerpt = String::new();
            let mut actual_end = start_line.saturating_sub(1);
            for (index, line) in lines
                .iter()
                .enumerate()
                .skip(start_line.saturating_sub(1))
                .take(requested_end.saturating_sub(start_line) + 1)
            {
                let separator = usize::from(!excerpt.is_empty());
                if excerpt.chars().count() + separator + line.chars().count() > MAX_CONTEXT_CHARS {
                    break;
                }
                if separator > 0 {
                    excerpt.push('\n');
                }
                excerpt.push_str(line);
                actual_end = index + 1;
            }
            if excerpt.trim().is_empty() || actual_end < start_line {
                return Err(format!(
                    "The selected section of ‘{title}’ is no longer available"
                ));
            }
            Ok(ChatRunContextItem {
                note_id: item.note_id,
                note_path: path
                    .strip_prefix(&notes_dir)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .into_owned(),
                title,
                section_label: item.section_label,
                excerpt,
                content_hash: crate::semantic::db::content_hash(&raw),
                reason: item
                    .reason
                    .filter(|reason| matches!(reason.as_str(), "related" | "explicit"))
                    .unwrap_or_else(|| "explicit".to_string()),
                start_line: Some(start_line),
                end_line: Some(actual_end),
                block_anchor: item.block_anchor,
            })
        })
        .collect()
}

#[tauri::command]
pub(crate) fn chat_cancel_request(
    service: State<'_, ChatService>,
    request_id: String,
) -> Result<(), String> {
    service.cancel_request(&request_id)
}

#[tauri::command]
pub(crate) fn chat_decide_permission(
    service: State<'_, ChatService>,
    command: crate::agent_permissions::AgentPermissionDecisionCommand,
) -> Result<crate::agent_permissions::AgentPermissionResolution, String> {
    service.decide_agent_permission(command)
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
    )?;
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

    fn context_candidate(
        note_id: &str,
        title: &str,
        score: f32,
    ) -> crate::services::retrieval::VaultRetrievalItem {
        crate::services::retrieval::VaultRetrievalItem {
            note_id: note_id.to_string(),
            note_path: PathBuf::from(format!("{title}.md")),
            title: title.to_string(),
            excerpt: title.to_string(),
            section_label: String::new(),
            score,
            lexical_score: Some(score),
            semantic_score: None,
            start_line: Some(1),
            end_line: Some(1),
            block_anchor: None,
            created_at_millis: 1,
            updated_at_millis: 1,
        }
    }

    #[test]
    fn related_context_weights_draft_above_generated_content_above_active_note() {
        let mut candidates = HashMap::new();
        merge_context_candidates(
            &mut candidates,
            vec![context_candidate("draft", "Draft", 1.0)],
            CONTEXT_DRAFT_WEIGHT,
            3,
            None,
        );
        merge_context_candidates(
            &mut candidates,
            vec![context_candidate("generated", "Generated", 1.0)],
            CONTEXT_GENERATED_WEIGHT,
            2,
            None,
        );
        merge_context_candidates(
            &mut candidates,
            vec![context_candidate("active", "Active", 1.0)],
            CONTEXT_ACTIVE_NOTE_WEIGHT,
            1,
            None,
        );

        let ranked = finish_context_candidates(candidates, 3);
        assert_eq!(
            ranked
                .into_iter()
                .map(|item| item.note_id)
                .collect::<Vec<_>>(),
            vec!["draft", "generated", "active"]
        );
    }

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
            audio: false,
            video: false,
            files: true,
            accepted_mime_types: accepted_mime_types(false, false, false, true, false),
            tools: true,
            default_reasoning_effort: None,
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

    #[test]
    fn openai_availability_keeps_only_curated_chat_models_in_product_order() {
        let models = curated_openai_models(vec![
            OpenAiModel {
                id: "text-embedding-3-large".to_string(),
                owned_by: Some("openai".to_string()),
            },
            OpenAiModel {
                id: "gpt-5.6-terra".to_string(),
                owned_by: Some("openai".to_string()),
            },
            OpenAiModel {
                id: "gpt-5.6-sol".to_string(),
                owned_by: Some("openai".to_string()),
            },
        ]);

        assert_eq!(
            models.into_iter().map(|model| model.id).collect::<Vec<_>>(),
            vec!["gpt-5.6-sol", "gpt-5.6-terra"]
        );
    }
}
