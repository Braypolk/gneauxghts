//! Native settings and domain authority commands. Pi owns conversation/task APIs.
use super::prepare_notes_dir;
use crate::{
    chat_domain::{
        ChatDefaults, ChatDomain, ChatNotePolicy, ChatSettings, LocalModelCapabilitySelection,
    },
    index::AppState,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatKeyStatus {
    provider: String,
    configured: bool,
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

// Catalog order and IDs come from Pi in the frontend; native discovery owns credentials.
fn available_openai_models(models: Vec<OpenAiModel>, model_ids: &[String]) -> Vec<LocalModel> {
    let by_id = models
        .into_iter()
        .map(|model| (model.id.clone(), model))
        .collect::<std::collections::HashMap<_, _>>();
    model_ids
        .iter()
        .filter_map(|id| by_id.get(id))
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    reasoning_options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_reasoning_default: Option<String>,
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
    service: &ChatDomain,
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
                reasoning_options: Vec::new(),
                server_reasoning_default: None,
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
                reasoning_options: Vec::new(),
                server_reasoning_default: None,
            })
        }
        other => Err(format!("Unsupported chat provider '{other}'")),
    }
}

#[tauri::command]
pub(crate) fn chat_get_settings(service: State<'_, ChatDomain>) -> Result<ChatSettings, String> {
    service.get_settings()
}

#[tauri::command]
pub(crate) fn chat_set_defaults(
    service: State<'_, ChatDomain>,
    defaults: ChatDefaults,
) -> Result<ChatSettings, String> {
    service.set_defaults(defaults)
}

#[tauri::command]
pub(crate) fn chat_get_composer_draft(
    service: State<'_, ChatDomain>,
    slot: String,
) -> Result<String, String> {
    service.get_composer_draft(&slot)
}

#[tauri::command]
pub(crate) fn chat_set_composer_draft(
    service: State<'_, ChatDomain>,
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
pub(crate) async fn chat_list_local_models(
    app: AppHandle,
    base_url: String,
) -> Result<Vec<LocalModel>, String> {
    crate::provider_config::ensure_compatible_chat_supported()?;
    crate::provider_config::validate_local_base_url(&base_url)?;
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
pub(crate) async fn chat_list_openai_models(
    app: AppHandle,
    model_ids: Vec<String>,
) -> Result<Vec<LocalModel>, String> {
    let (credential, method) = crate::chatgpt_auth::resolve(&app).await?;
    let api_key = credential
        .ok_or_else(|| "Add an OpenAI API key or sign in with ChatGPT in Settings".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Unable to configure OpenAI model client: {error}"))?;
    let response = client
        .get(format!(
            "{}/models",
            crate::provider_config::openai_api_base_url()?.trim_end_matches('/')
        ))
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|error| format!("Unable to check available OpenAI models: {error}"))?;
    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::UNAUTHORIZED
            && method == crate::chatgpt_auth::AuthMethod::Chatgpt
        {
            crate::chatgpt_auth::recover_rejected_access(&app, &api_key).await?;
        }
        return Err(format!(
            "OpenAI model availability returned {}",
            response.status()
        ));
    }
    let models = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Unable to read available OpenAI models: {error}"))?;
    if method == crate::chatgpt_auth::AuthMethod::Chatgpt {
        subscription_models(&models)
    } else {
        let models: OpenAiModelsResponse =
            serde_json::from_value(models).map_err(|_| "Unable to read available OpenAI models")?;
        Ok(available_openai_models(models.data, &model_ids))
    }
}

fn subscription_models(value: &serde_json::Value) -> Result<Vec<LocalModel>, String> {
    let models = value["models"]
        .as_array()
        .ok_or("Unable to read your ChatGPT model catalog")?;
    Ok(models
        .iter()
        .filter(|model| model["visibility"] == "list")
        .filter_map(|model| {
            let id = model["slug"].as_str()?.trim();
            (!id.is_empty()).then(|| LocalModel {
                id: id.into(),
                owned_by: Some("openai".into()),
            })
        })
        .collect())
}

#[cfg(test)]
mod model_discovery_tests {
    use super::*;

    #[test]
    fn account_availability_intersects_the_supplied_pi_catalog_in_catalog_order() {
        let response: OpenAiModelsResponse = serde_json::from_value(serde_json::json!({
            "data": [
                { "id": "gpt-6-luna", "owned_by": "openai" },
                { "id": "text-embedding-3-small", "owned_by": "openai" },
                { "id": "gpt-6.1-sol", "owned_by": "system" }
            ]
        }))
        .unwrap();
        let catalog = ["gpt-6.1-sol", "unavailable-model", "gpt-6-luna"].map(String::from);
        let available = available_openai_models(response.data, &catalog);
        assert_eq!(
            available
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["gpt-6.1-sol", "gpt-6-luna"]
        );
        assert_eq!(available[0].owned_by.as_deref(), Some("system"));
    }

    #[test]
    fn subscription_discovery_keeps_visible_account_models_outside_the_pi_catalog() {
        let models = subscription_models(&serde_json::json!({ "models": [
            { "slug": "account-model", "visibility": "list" },
            { "slug": "hidden-model", "visibility": "hide" },
            { "slug": " ", "visibility": "list" }
        ] }))
        .unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "account-model");
    }
}

#[tauri::command]
pub(crate) async fn chat_get_model_capabilities(
    app: AppHandle,
    service: State<'_, ChatDomain>,
    provider: String,
    model: String,
    base_url: Option<String>,
) -> Result<ChatModelCapabilities, String> {
    let mut capabilities = model_capabilities(&service, &provider, &model)?;
    if provider.trim() == "local" {
        let base = base_url.unwrap_or(service.get_settings()?.local_base_url);
        crate::provider_config::validate_local_base_url(&base)?;
        let key = crate::secrets::read_provider_api_key(&app, "local")?;
        if let Some(reasoning) =
            crate::provider_config::local_reasoning::discover(&base, key.as_deref(), &model).await
        {
            capabilities.default_reasoning_effort = reasoning
                .selected(
                    capabilities
                        .default_reasoning_effort
                        .as_deref()
                        .unwrap_or(""),
                )
                .map(str::to_string);
            capabilities.server_reasoning_default = reasoning.selected("").map(str::to_string);
            capabilities.reasoning_options = reasoning.options;
        }
    }
    Ok(capabilities)
}

#[tauri::command]
pub(crate) fn chat_set_local_model_capabilities(
    service: State<'_, ChatDomain>,
    model: String,
    capabilities: LocalModelCapabilitySelection,
) -> Result<LocalModelCapabilitySelection, String> {
    service.set_local_model_capabilities(&model, capabilities)
}

#[tauri::command]
pub(crate) fn chat_list_note_policies(
    service: State<'_, ChatDomain>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatNotePolicy>, String> {
    let _foreground_guard = state.foreground_guard();
    let notes_dir = prepare_notes_dir(&state, false)?;
    state.ensure_interactive_index(&notes_dir, "chat_list_note_policies")?;
    let mut policies = service.list_note_policies()?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index lock poisoned".to_string())?;
    for policy in &mut policies {
        // Missing notes retain a usable identity even without catalog display metadata.
        if policy.title.is_empty() {
            policy.title = policy.note_id.clone();
        }
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

use crate::pi_chat::authority::{
    AuthoritySnapshot, AuthorityStore, ConversationBinding, DomainResult, ReadPolicy,
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExclusionResult {
    retired_authority_ids: Vec<String>,
}
fn changed(app: &AppHandle, ids: Vec<String>) -> DomainResult<ExclusionResult> {
    app.state::<crate::pi_chat::transport::NativeTransport>()
        .cancel_authorities(&ids)?;
    let result = ExclusionResult {
        retired_authority_ids: ids,
    };
    app.emit(
        "pi-chat-authority-changed",
        serde_json::json!({"retiredAuthorityIds":result.retired_authority_ids}),
    )
    .ok();
    Ok(result)
}
fn change_exclusion(
    app: &AppHandle,
    note_id: &str,
    excluded: bool,
) -> DomainResult<ExclusionResult> {
    let ids = app
        .state::<AuthorityStore>()
        .set_exclusion(note_id, excluded)?;
    app.state::<crate::pi_chat::transport::NativeTransport>()
        .cancel_authorities(&ids)?;
    let result = ExclusionResult {
        retired_authority_ids: ids,
    };
    app.emit("pi-chat-authority-changed",serde_json::json!({"retiredAuthorityIds":result.retired_authority_ids,"noteId":note_id,"excluded":excluded})).ok();
    Ok(result)
}
#[tauri::command]
pub(crate) fn pi_chat_bind_authority(
    state: State<'_, AppState>,
    store: State<'_, AuthorityStore>,
    binding: ConversationBinding,
    read: ReadPolicy,
) -> DomainResult<AuthoritySnapshot> {
    if let Some(existing) = store.snapshot_for_binding(&binding)? {
        return Ok(existing);
    }
    crate::pi_chat::notes::validate_attachments(&state, &store, &read)?;
    store.bind(binding, read)
}
#[tauri::command]
pub(crate) fn pi_chat_authority(
    store: State<'_, AuthorityStore>,
    authority_id: String,
) -> DomainResult<AuthoritySnapshot> {
    store.snapshot(&authority_id)
}
#[tauri::command]
pub(crate) fn pi_chat_validate_authority(
    store: State<'_, AuthorityStore>,
    authority_id: String,
    conversation_id: u64,
    provider_session_id: String,
) -> DomainResult<()> {
    store.validate_binding(
        &authority_id,
        &ConversationBinding {
            conversation_id,
            provider_session_id,
        },
    )?;
    Ok(())
}
#[tauri::command]
pub(crate) fn pi_chat_set_read_policy(
    app: AppHandle,
    authority_id: String,
    expected_revision: u64,
    read: ReadPolicy,
) -> DomainResult<AuthoritySnapshot> {
    crate::pi_chat::notes::validate_attachments(
        &app.state::<AppState>(),
        &app.state::<AuthorityStore>(),
        &read,
    )?;
    let snapshot =
        app.state::<AuthorityStore>()
            .set_read(&authority_id, expected_revision, read)?;
    // Every revision cancels old leases; only restriction retires the model context.
    app.state::<crate::pi_chat::transport::NativeTransport>()
        .cancel_authorities(&[authority_id.clone()])?;
    if snapshot.retired {
        changed(&app, vec![authority_id])?;
    }
    Ok(snapshot)
}
#[tauri::command]
pub(crate) fn pi_chat_retire_authority(
    app: AppHandle,
    authority_id: String,
    expected_revision: u64,
) -> DomainResult<()> {
    app.state::<AuthorityStore>()
        .retire(&authority_id, expected_revision)?;
    changed(&app, vec![authority_id])?;
    Ok(())
}
#[tauri::command]
pub(crate) fn pi_chat_set_exclusion(
    app: AppHandle,
    note_id: String,
    excluded: bool,
) -> DomainResult<ExclusionResult> {
    change_exclusion(&app, &note_id, excluded)
}

/// Settings discovery is host-only; it issues no model evidence or read capability.
#[tauri::command]
pub(crate) fn chat_search_policy_notes(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    let notes_dir = prepare_notes_dir(&state, false)?;
    state.ensure_interactive_index(&notes_dir, "chat_search_policy_notes")?;
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?;
    let query = query.trim().to_lowercase();
    Ok(index.entries.iter().filter(|(_,note)|note.title.to_lowercase().contains(&query)).take(limit.unwrap_or(12).min(50))
        .map(|(path,note)|serde_json::json!({"noteId":note.note_id,"title":note.title,"notePath":path.strip_prefix(&notes_dir).unwrap_or(path).to_string_lossy()})).collect())
}
