//! Explicit evaluation command surface. No legacy conversation/run/proposal dispatch.
use super::prepare_notes_dir;
use crate::{
    chat_domain::{
        ChatDefaults, ChatDomain, ChatGrant, ChatNotePolicy, ChatSettings,
        LocalModelCapabilitySelection,
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

#[derive(Deserialize)]
struct CuratedChatModel {
    id: String,
}

fn curated_chat_models() -> &'static [CuratedChatModel] {
    static CATALOG: std::sync::OnceLock<Vec<CuratedChatModel>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../src/lib/contracts/chat-model-catalog.json"
        ))
        .expect("bundled chat model catalog must be valid")
    })
}

fn curated_openai_models(models: Vec<OpenAiModel>) -> Vec<LocalModel> {
    let by_id = models
        .into_iter()
        .map(|model| (model.id.clone(), model))
        .collect::<std::collections::HashMap<_, _>>();
    curated_chat_models()
        .iter()
        .filter_map(|entry| by_id.get(&entry.id))
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
pub(crate) fn chat_set_atlas_visibility(
    service: State<'_, ChatDomain>,
    visibility: String,
) -> Result<(), String> {
    service.set_atlas_visibility(&visibility)
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
pub(crate) async fn chat_list_openai_models(app: AppHandle) -> Result<Vec<LocalModel>, String> {
    let api_key = crate::secrets::read_provider_api_key(&app, "openai")?
        .ok_or_else(|| "Add an OpenAI API key in Settings".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Unable to configure OpenAI model client: {error}"))?;
    let response = client
        .get(format!(
            "{}/models",
            crate::provider_config::openai_api_base_url()?.trim_end_matches('/')
        ))
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
pub(crate) fn chat_set_note_excluded(
    app: AppHandle,
    service: State<'_, ChatDomain>,
    note_id: String,
    title: String,
    excluded: bool,
) -> Result<(), String> {
    service.set_note_excluded(&note_id, &title, excluded)?;
    policy_changed(&app)
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
pub(crate) fn chat_list_grants(service: State<'_, ChatDomain>) -> Result<Vec<ChatGrant>, String> {
    service.list_grants()
}

#[tauri::command]
pub(crate) fn chat_grant_note(
    app: AppHandle,
    service: State<'_, ChatDomain>,
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
    service.grant_note(&note_id, &note.title)?;
    policy_changed(&app)
}

#[tauri::command]
pub(crate) fn chat_revoke_note(
    app: AppHandle,
    service: State<'_, ChatDomain>,
    note_id: String,
) -> Result<(), String> {
    service.revoke_note(&note_id)?;
    policy_changed(&app)
}

fn policy_changed(app: &AppHandle) -> Result<(), String> {
    app.state::<crate::pi_prototype_transport::NativeTransport>()
        .cancel_for_policy_change()?;
    app.emit("pi-policy-changed", ()).map_err(|e| e.to_string())
}
