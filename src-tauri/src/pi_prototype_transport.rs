//! One inference per dispatch. Pi owns model/tool sequencing and retry policy.
use futures_util::StreamExt;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::{HashMap, VecDeque}, sync::{atomic::{AtomicBool, Ordering}, Arc, Condvar, Mutex}, time::{Duration, Instant}};
use tauri::{ipc::Channel, Manager};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct NativeTransport {
    requests: Mutex<Requests>,
    settled: Condvar,
}

#[derive(Default)]
struct Requests {
    stopped: bool,
    active: HashMap<String, CancellationToken>,
    admissions: HashMap<String, FrozenRequest>,
    // Cancellation can reach native code before the inference IPC is scheduled.
    cancelled: VecDeque<(String, Instant)>,
}

// Never serialize/debug the endpoint or credential into the webview or diagnostics.
#[derive(Clone)]
struct FrozenRequest {
    public: ProviderAdmission,
    endpoint: String,
    credential: Option<String>,
    wire_reasoning: Option<String>,
    admitted_at: Instant,
    web_dispatched: Arc<AtomicBool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdmittedConfiguration {
    local_base_url: Option<String>,
    capabilities: Option<AdmittedCapabilities>,
    web_access: Option<crate::chat_domain::WebAccess>,
    #[serde(default)] force_web_search: bool,
}

#[derive(Deserialize)]
pub(crate) struct AdmittedCapabilities {
    tools: bool,
    images: bool,
    audio: bool,
    video: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderAdmission {
    id: String,
    provider: String,
    model: String,
    reasoning_effort: String,
    service_tier: String,
    tools: bool,
    images: bool,
    audio: bool,
    video: bool,
    files: bool,
    accepted_mime_types: Vec<String>,
    enable_web: bool,
    require_web: bool,
}

impl NativeTransport {
    // Only native context policy may inspect this routing/credential tuple.
    // Never serialize it into the webview or diagnostics.
    pub(crate) fn metadata_configuration(&self, admission_id: &str) -> Option<(String, String, Option<String>)> {
        let requests = self.requests.lock().ok()?;
        if requests.stopped { return None; }
        let config = requests.admissions.get(admission_id)?;
        if config.public.provider != "local" || config.admitted_at.elapsed() >= Duration::from_secs(3600) { return None; }
        let base = config.endpoint.strip_suffix("/chat/completions")?;
        Some((base.to_owned(), config.public.model.clone(), config.credential.clone()))
    }

    pub(crate) fn cancel_for_policy_change(&self) -> Result<(), String> {
        let requests = self.requests.lock().map_err(|_| "Transport lock poisoned")?;
        for token in requests.active.values() { token.cancel(); }
        Ok(())
    }

    pub(crate) fn quiesce_for_restart(&self) -> Result<(), String> {
        let mut requests = self.requests.lock().map_err(|_| "Transport lock poisoned")?;
        requests.stopped = true;
        for token in requests.active.values() { token.cancel(); }
        requests.admissions.clear();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !requests.active.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err("Native inference did not settle before restart".into()); }
            requests = self.settled.wait_timeout(requests, remaining).map_err(|_| "Transport wait poisoned")?.0;
        }
        Ok(())
    }

    pub(crate) fn resume_after_failed_restart(&self) -> Result<(), String> {
        self.requests.lock().map_err(|_| "Transport lock poisoned")?.stopped = false;
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Frame {
    Headers { status: u16, content_type: String },
    Chunk { bytes: Vec<u8> },
    Done,
}

fn fixture_endpoint(base: &str, provider: &str) -> Result<String, String> {
    let url = url::Url::parse(base).map_err(|_| "Invalid fixture URL")?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() {
        return Err("Pi fixture must be an explicit IPv4 loopback HTTP URL".into());
    }
    Ok(format!("{}/{}", base.trim_end_matches('/'), if provider == "openai" { "openai/v1/responses" } else { "local/v1/chat/completions" }))
}

fn inference_endpoint(provider: &str, local_base_url: &str, hosted_base_url: &str) -> Result<String, String> {
    if provider == "local" {
        crate::provider_config::validate_local_base_url(local_base_url)?;
        Ok(format!("{}/chat/completions", local_base_url.trim().trim_end_matches('/')))
    } else {
        Ok(format!("{}/responses", hosted_base_url.trim_end_matches('/')))
    }
}

#[tauri::command]
pub(crate) async fn pi_admit_provider_request(app: tauri::AppHandle, provider: String, model: String,
    reasoning_effort: String, service_tier: String, configuration: Option<AdmittedConfiguration>) -> Result<ProviderAdmission, String> {
    if !matches!(provider.as_str(), "local" | "openai") || model.trim().is_empty()
        || model.len() > 256 || model.chars().any(char::is_control)
        || !crate::provider_config::local_reasoning::valid_option(&reasoning_effort)
        || !matches!(service_tier.as_str(), "standard" | "flex") {
        return Err("Invalid Pi provider configuration".into());
    }
    let fixture = std::env::var("PI_PROTOTYPE_HTTP_FIXTURE").ok();
    let domain = app.state::<crate::chat_domain::ChatDomain>();
    let settings = domain.get_settings()?;
    // Explicit Retry can restore the original non-secret routing snapshot after
    // restart. Validate it exactly as Settings; credentials never cross this seam.
    let local_base_url = configuration.as_ref().and_then(|config| config.local_base_url.as_deref())
        .unwrap_or(&settings.local_base_url);
    if provider == "local" { crate::provider_config::validate_local_base_url(local_base_url)?; }
    // Reads only the separately installed Pi application's secure-storage namespace.
    let credential = if fixture.is_some() { None } else { crate::secrets::read_provider_api_key(&app, &provider)? };
    if fixture.is_none() && provider == "openai" && credential.is_none() {
        return Err("Add an OpenAI API key in Pi Settings".into());
    }
    let endpoint = if let Some(base) = fixture.as_deref() { fixture_endpoint(base, &provider)? }
        else { inference_endpoint(&provider, local_base_url, &crate::provider_config::openai_api_base_url()?)? };
    let (tools, images, audio, video, wire_reasoning) = if fixture.is_some() {
        if !matches!(model.as_str(), "pi-native-fixture" | "pi-native-fixture-b") { return Err("Unknown fixture model".into()); }
        if !matches!(reasoning_effort.as_str(), "off" | "medium") { return Err("Fixture reasoning option unsupported".into()); }
        let caps = configuration.as_ref().and_then(|config| config.capabilities.as_ref());
        (true, caps.is_some_and(|caps| caps.images), caps.is_some_and(|caps| caps.audio), caps.is_some_and(|caps| caps.video), None)
    } else if provider == "local" {
        let current_caps = domain.local_model_capabilities(&model)?;
        let caps = configuration.as_ref().and_then(|config| config.capabilities.as_ref());
        let metadata = crate::provider_config::local_reasoning::discover(local_base_url, credential.as_deref(), &model).await;
        if let Some(metadata) = metadata.as_ref() {
            if !metadata.options.contains(&reasoning_effort) { return Err("Selected model does not support this reasoning option".into()); }
        } else if !matches!(reasoning_effort.as_str(), "off" | "none") {
            // No server metadata means no invented reasoning controls.
            return Err("Reasoning options unavailable; choose off or refresh model capabilities".into());
        }
        let wire = if metadata.is_none() { Some("none".to_string()) } else {
            crate::provider_config::local_reasoning::wire_effort(metadata.as_ref(), Some(&reasoning_effort)).map(str::to_owned)
        };
        (caps.map_or(current_caps.tools, |caps| caps.tools),
            caps.map_or(current_caps.images, |caps| caps.images),
            caps.map_or(current_caps.audio, |caps| caps.audio),
            caps.map_or(current_caps.video, |caps| caps.video), wire)
    } else {
        if !matches!(reasoning_effort.as_str(), "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") {
            return Err("Unsupported Responses reasoning option".into());
        }
        let caps = configuration.as_ref().and_then(|config| config.capabilities.as_ref());
        (caps.is_none_or(|caps| caps.tools), caps.is_none_or(|caps| caps.images),
            caps.is_some_and(|caps| caps.audio), caps.is_some_and(|caps| caps.video),
            (reasoning_effort != "off").then(|| reasoning_effort.clone()))
    };
    let require_web = configuration.as_ref().is_some_and(|config| config.force_web_search);
    if provider == "local" && require_web { return Err("Web search is unavailable with local models".into()); }
    let web_access = configuration.as_ref().and_then(|config| config.web_access.as_ref()).unwrap_or(&settings.web_access);
    let enable_web = provider == "openai" && (require_web || *web_access == crate::chat_domain::WebAccess::Auto);
    let multimodal = ["gpt-4o", "gpt-4.1", "gpt-5", "o3", "o4"].iter().any(|prefix| model.to_ascii_lowercase().starts_with(prefix));
    // Fixtures deliberately support the entire existing modality matrix. Live
    // Responses audio/video remain unavailable, regardless of webview input.
    let is_fixture = fixture.is_some();
    let files = provider == "local" || multimodal || is_fixture;
    let images = if provider == "openai" && !is_fixture { images && multimodal } else { images };
    let audio = provider == "local" && audio;
    let video = provider == "local" && video;
    let accepted_mime_types = attachment_mime_types(images, audio, video, files, provider == "openai" && (multimodal || is_fixture));
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| "Unable to admit native request")?;
    let public = ProviderAdmission { id: nonce.iter().map(|byte| format!("{byte:02x}")).collect(), provider, model,
        reasoning_effort, service_tier, tools, images, audio, video, files, accepted_mime_types, enable_web, require_web };
    let transport = app.state::<NativeTransport>();
    let mut requests = transport.requests.lock().map_err(|_| "Transport lock poisoned")?;
    if requests.stopped { return Err("Pi transport is stopping".into()); }
    requests.admissions.retain(|_, value| value.admitted_at.elapsed() < Duration::from_secs(3600));
    if requests.admissions.len() >= 128 { return Err("Too many admitted Pi requests".into()); }
    requests.admissions.insert(public.id.clone(), FrozenRequest { public: public.clone(), endpoint, credential, wire_reasoning, admitted_at: Instant::now(), web_dispatched: Arc::default() });
    Ok(public)
}

#[tauri::command]
pub(crate) fn pi_release_provider_request(transport: tauri::State<'_, NativeTransport>, admission_id: String) -> Result<(), String> {
    transport.requests.lock().map_err(|_| "Transport lock poisoned")?.admissions.remove(&admission_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn pi_cancel_fetch(transport: tauri::State<'_, NativeTransport>, id: String) -> Result<(), String> {
    let mut requests = transport.requests.lock().map_err(|_| "Transport lock poisoned")?;
    if let Some(token) = requests.active.get(&id) { token.cancel(); }
    else {
        requests.cancelled.retain(|(_, at)| at.elapsed() < Duration::from_secs(60));
        if requests.cancelled.len() >= 256 { return Err("Cancellation registry full".into()); }
        requests.cancelled.push_back((id, Instant::now()));
    }
    Ok(())
}

const MAX_ATTACHMENTS: usize = 10;
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES: usize = 25 * 1024 * 1024;
const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];
const AUDIO_TYPES: &[&str] = &["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac", "audio/mp4", "audio/x-m4a"];
const VIDEO_TYPES: &[&str] = &["video/avi", "video/x-msvideo", "video/mp4", "video/mpeg", "video/quicktime", "video/webm"];
const TEXT_TYPES: &[&str] = &["text/plain", "text/markdown", "text/csv", "text/html", "text/css", "text/javascript", "text/x-python", "application/json", "application/xml", "application/rtf"];

fn attachment_mime_types(images: bool, audio: bool, video: bool, files: bool, pdf: bool) -> Vec<String> {
    IMAGE_TYPES.iter().filter(|_| images)
        .chain(AUDIO_TYPES.iter().filter(|_| audio))
        .chain(VIDEO_TYPES.iter().filter(|_| video))
        .chain(TEXT_TYPES.iter().filter(|_| files))
        .copied().chain(pdf.then_some("application/pdf")).map(str::to_owned).collect()
}

// No Debug implementation: this value contains raw user attachment bytes.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PiAttachment {
    #[serde(default)] id: Option<String>,
    kind: String,
    name: String,
    mime_type: String,
    size_bytes: usize,
    data_base64: String,
}

fn validate_attachments(attachments: Vec<PiAttachment>, config: &ProviderAdmission) -> Result<Vec<PiAttachment>, String> {
    if attachments.len() > MAX_ATTACHMENTS { return Err("Attach up to 10 files per message".into()); }
    let mut total = 0usize;
    let mut ids = std::collections::HashSet::new();
    attachments.into_iter().map(|mut item| {
        item.mime_type = item.mime_type.trim().to_ascii_lowercase();
        let image = IMAGE_TYPES.contains(&item.mime_type.as_str());
        if !config.accepted_mime_types.contains(&item.mime_type)
            || (image && !config.images)
            || (AUDIO_TYPES.contains(&item.mime_type.as_str()) && !config.audio)
            || (VIDEO_TYPES.contains(&item.mime_type.as_str()) && !config.video)
            || ((!image && !item.mime_type.starts_with("audio/") && !item.mime_type.starts_with("video/")) && !config.files) {
            return Err("The selected model cannot accept this attachment type".into());
        }
        if item.kind != if image { "image" } else { "file" } { return Err("Invalid attachment metadata".into()); }
        if item.data_base64.len() > (MAX_ATTACHMENT_BYTES * 4 / 3) + 8 { return Err("An attachment is larger than 10 MB".into()); }
        let decoded = BASE64_STANDARD.decode(&item.data_base64).map_err(|_| "Invalid attachment data")?;
        if decoded.len() != item.size_bytes || decoded.len() > MAX_ATTACHMENT_BYTES { return Err("Invalid attachment size".into()); }
        if TEXT_TYPES.contains(&item.mime_type.as_str()) { std::str::from_utf8(&decoded).map_err(|_| "Attachment is not valid UTF-8 text")?; }
        total = total.checked_add(decoded.len()).ok_or("Attachment size exceeds the allowed limit")?;
        if total > MAX_ATTACHMENT_TOTAL_BYTES { return Err("Attachments can total up to 25 MB per message".into()); }
        item.name = item.name.trim().chars().filter(|ch| !ch.is_control()).take(255).collect();
        if item.name.is_empty() { item.name = "Attachment".into(); }
        if let Some(id) = &item.id {
            if id.is_empty() || id.len() > 100 || !id.bytes().all(|ch| ch.is_ascii_alphanumeric() || ch == b'-') { return Err("Invalid attachment identity".into()); }
        } else {
            let mut nonce = [0u8; 16];
            getrandom::fill(&mut nonce).map_err(|_| "Unable to identify attachment")?;
            item.id = Some(format!("pi-attachment-{}", nonce.iter().map(|byte| format!("{byte:02x}")).collect::<String>()));
        }
        if !ids.insert(item.id.clone()) { return Err("Duplicate attachment identity".into()); }
        Ok(item)
    }).collect()
}

#[tauri::command]
pub(crate) fn pi_prepare_attachments(transport: tauri::State<'_, NativeTransport>, admission_id: String,
    attachments: Vec<PiAttachment>) -> Result<Vec<PiAttachment>, String> {
    let requests = transport.requests.lock().map_err(|_| "Transport lock poisoned")?;
    if requests.stopped { return Err("Pi transport is stopping".into()); }
    let config = requests.admissions.get(&admission_id)
        .filter(|config| config.admitted_at.elapsed() < Duration::from_secs(3600))
        .ok_or("Missing or expired explicit Pi request admission")?;
    validate_attachments(attachments, &config.public)
}

fn append_attachments(body: &mut Value, provider: &str, attachments: &[PiAttachment]) -> Result<(), String> {
    if attachments.is_empty() { return Ok(()); }
    let messages = body.get_mut(if provider == "openai" { "input" } else { "messages" })
        .and_then(Value::as_array_mut).ok_or("Inference requires messages for attachments")?;
    let user = messages.iter_mut().rev().find(|message| message["role"] == "user").ok_or("Attachment user message is unavailable")?;
    let content = user.get_mut("content").ok_or("Attachment user content is unavailable")?;
    if let Some(text) = content.as_str() {
        *content = serde_json::json!([{"type":if provider == "openai" {"input_text"} else {"text"},"text":text}]);
    }
    let parts = content.as_array_mut().ok_or("Invalid attachment user content")?;
    let text_type = if provider == "openai" { "input_text" } else { "text" };
    for item in attachments {
        parts.push(serde_json::json!({"type":text_type,"text":format!("Attached {}: {}", item.kind, item.name)}));
        let data_url = || format!("data:{};base64,{}",item.mime_type,item.data_base64);
        let part = if item.kind == "image" {
            if provider == "openai" { serde_json::json!({"type":"input_image","detail":"auto","image_url":data_url()}) }
            else { serde_json::json!({"type":"image_url","image_url":{"url":data_url(),"detail":"auto"}}) }
        } else if item.mime_type == "application/pdf" {
            if provider != "openai" { return Err("PDF attachments are unavailable with local models".into()); }
            serde_json::json!({"type":"input_file","filename":item.name,"file_data":data_url()})
        } else if item.mime_type.starts_with("audio/") {
            if provider != "local" { return Err("Audio attachments are unavailable with this provider".into()); }
            let format = match item.mime_type.as_str() {
                "audio/wav" | "audio/x-wav" => "wav", "audio/mpeg" | "audio/mp3" => "mp3",
                "audio/aiff" => "aiff", "audio/aac" => "aac", "audio/ogg" => "ogg",
                "audio/flac" => "flac", "audio/mp4" | "audio/x-m4a" => "m4a", _ => return Err("Unsupported audio attachment".into()),
            };
            serde_json::json!({"type":"input_audio","input_audio":{"data":item.data_base64,"format":format}})
        } else if item.mime_type.starts_with("video/") {
            if provider != "local" { return Err("Video attachments are unavailable with this provider".into()); }
            serde_json::json!({"type":"video_url","video_url":{"url":data_url()}})
        } else {
            let bytes = BASE64_STANDARD.decode(&item.data_base64).map_err(|_| "Invalid attachment data")?;
            let text = String::from_utf8(bytes).map_err(|_| "Attachment is not valid UTF-8 text")?;
            serde_json::json!({"type":text_type,"text":text})
        };
        parts.push(part);
    }
    Ok(())
}

fn configure_body(body: &mut Value, config: &FrozenRequest) -> Result<(), String> {
    configure_inference_body(body, config, "answer")
}

fn configure_inference_body(body: &mut Value, config: &FrozenRequest, purpose: &str) -> Result<(), String> {
    if !matches!(purpose, "answer" | "researchSelection" | "summary") { return Err("Invalid inference purpose".into()); }
    let object = body.as_object_mut().ok_or("Inference JSON must be an object")?;
    if object.get("model").and_then(Value::as_str) != Some(config.public.model.as_str()) {
        return Err("Inference model differs from admitted turn".into());
    }
    if object.get("stream") != Some(&Value::Bool(true)) { return Err("Pi inference requires streaming".into()); }
    if (!config.public.tools || purpose == "summary") && object.get("tools").and_then(Value::as_array).is_some_and(|tools| !tools.is_empty()) {
        return Err("Selected model does not support tools".into());
    }
    if config.public.provider == "local" {
        let messages = object.get("messages").and_then(Value::as_array).ok_or("Compatible inference requires messages")?;
        if messages.iter().enumerate().any(|(i,m)| m["role"] == "developer" || (i > 0 && m["role"] == "system")) {
            return Err("Compatible inference requires a single opening system message".into());
        }
        object.remove("service_tier");
        object.remove("reasoning_effort");
        object.remove("reasoning");
        object.remove("enable_thinking");
        object.remove("thinking");
        object.remove("chat_template_kwargs");
        if let Some(effort) = &config.wire_reasoning { object.insert("reasoning_effort".into(), effort.clone().into()); }
    } else {
        object.remove("reasoning");
        if let Some(effort) = &config.wire_reasoning { object.insert("reasoning".into(), serde_json::json!({"effort":effort})); }
        object.insert("service_tier".into(), if config.public.service_tier == "flex" { "flex" } else { "default" }.into());
    }
    // The native boundary owns hosted tool policy, rather than trusting a hook
    // or a caller-provided tool_choice. Non-answer inference never gains web.
    if let Some(tools) = object.get_mut("tools").and_then(Value::as_array_mut) {
        tools.retain(|tool| !matches!(tool["type"].as_str(), Some("web_search" | "web_search_preview")));
    }
    if object.get("tool_choice").is_some_and(|choice| matches!(choice["type"].as_str(), Some("web_search" | "web_search_preview"))) {
        object.remove("tool_choice");
    }
    if purpose == "answer" && config.public.enable_web {
        let tools = object.entry("tools").or_insert_with(|| Value::Array(Vec::new())).as_array_mut().ok_or("Invalid inference tools")?;
        tools.push(serde_json::json!({"type":"web_search"}));
        if config.public.require_web && !config.web_dispatched.swap(true, Ordering::Relaxed) {
            object.insert("tool_choice".into(), serde_json::json!({"type":"web_search"}));
        }
    }
    if purpose == "summary" && config.public.provider == "local" {
        object.remove("reasoning_effort");
        object.insert("reasoning_effort".into(), "none".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn pi_fetch(app: tauri::AppHandle, id: String, provider: String, admission_id: String,
    body: String, frames: Channel<Frame>, attachments: Option<Vec<PiAttachment>>, purpose: Option<String>) -> Result<(), String> {
    if body.len() > 262_144 || id.is_empty() || id.len() > 80 { return Err("Invalid Pi inference request".into()); }
    let mut body: Value = serde_json::from_str(&body).map_err(|_| "Invalid inference JSON")?;
    let token = CancellationToken::new();
    let config = {
        let transport = app.state::<NativeTransport>();
        let mut requests = transport.requests.lock().map_err(|_| "Transport lock poisoned")?;
        if requests.stopped { return Err("Pi transport is stopping".into()); }
        requests.cancelled.retain(|(_, at)| at.elapsed() < Duration::from_secs(60));
        if requests.cancelled.iter().any(|(cancelled, _)| cancelled == &id) { return Err("Native inference cancelled before admission".into()); }
        let config = requests.admissions.get(&admission_id).filter(|c| c.public.provider == provider)
            .cloned().ok_or("Missing or expired explicit Pi request admission")?;
        if requests.active.len() >= 4 || requests.active.contains_key(&id) { return Err("Inference already active or transport full".into()); }
        // Decode and bind bytes before reserving the inference or consuming the
        // initial forced-search selection. No external path is accepted.
        let attachments = validate_attachments(attachments.unwrap_or_default(), &config.public)?;
        append_attachments(&mut body, &config.public.provider, &attachments)?;
        configure_inference_body(&mut body, &config, purpose.as_deref().unwrap_or("answer"))?;
        requests.active.insert(id.clone(), token.clone());
        config
    };
    let crash_scope = body[if provider == "openai" { "input" } else { "messages" }].as_array()
        .and_then(|history| history.iter().rev().find(|message| message["role"] == "user"))
        .and_then(|message| crate::pi_prototype_faults::armed("transport-completed", &message["content"].to_string()));
    let operation = async {
        let mut request = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15)).build().map_err(|_| "Unable to configure native transport")?
            .post(&config.endpoint).json(&body);
        if let Some(key) = config.credential.as_ref() { request = request.bearer_auth(key); }
        let response = request.send().await.map_err(|_| "Native provider connection failed")?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) { return Err(format!("Native provider HTTP {status}")); }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        if !content_type.starts_with("text/event-stream") { return Err("Native provider did not return SSE".into()); }
        frames.send(Frame::Headers { status, content_type }).map_err(|_| "Webview disconnected")?;
        let mut stream = response.bytes_stream();
        let mut bytes_received = 0;
        let mut terminal_barrier = crate::pi_prototype_faults::TerminalBarrier::default();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|_| "Native provider stream failed")?;
            bytes_received += bytes.len();
            if bytes_received > 8_388_608 { return Err("Prototype provider response exceeds bound".into()); }
            if crash_scope.is_some() {
                for event in terminal_barrier.push(&bytes)? { frames.send(Frame::Chunk { bytes: event }).map_err(|_| "Webview disconnected")?; }
            } else { frames.send(Frame::Chunk { bytes: bytes.to_vec() }).map_err(|_| "Webview disconnected")?; }
        }
        if let Some(scope) = &crash_scope {
            if !terminal_barrier.is_complete() { return Err("Synthetic terminal completion was not observed".into()); }
            crate::pi_prototype_faults::crash("transport-completed", scope, serde_json::json!({"httpCompleted":true,"terminalDelivered":false,"withheldEvents":terminal_barrier.withheld_events,"bytesReceived":bytes_received,"provider":provider}))?;
        }
        frames.send(Frame::Done).map_err(|_| "Webview disconnected")?;
        Ok(())
    };
    let result = tokio::select! {
        _ = token.cancelled() => Err("Native inference cancelled".into()),
        value = tokio::time::timeout(Duration::from_secs(900), operation) =>
            value.unwrap_or_else(|_| Err("Native inference deadline exceeded".into())),
    };
    let transport = app.state::<NativeTransport>();
    transport.requests.lock().map_err(|_| "Transport lock poisoned")?.active.remove(&id);
    transport.settled.notify_all();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frozen(provider: &str, model: &str) -> FrozenRequest {
        FrozenRequest { public: ProviderAdmission { id: "opaque".into(), provider: provider.into(), model: model.into(),
            reasoning_effort: "brief".into(), service_tier: "flex".into(), tools: true, images: false, audio: false, video: false, files: true, accepted_mime_types: attachment_mime_types(false, false, false, true, provider == "openai"), enable_web: false, require_web: false },
            endpoint: "http://127.0.0.1:1443/frozen-endpoint".into(), credential: None,
            wire_reasoning: Some("brief".into()), admitted_at: Instant::now(), web_dispatched: Arc::default() }
    }

    #[test]
    fn pi_retry_snapshot_keeps_original_endpoint_after_settings_change() {
        let original = inference_endpoint("local", "http://127.0.0.1:1111/v1", "https://api.openai.com/v1").unwrap();
        let changed = inference_endpoint("local", "http://127.0.0.1:2222/v1", "https://api.openai.com/v1").unwrap();
        let mut admitted = frozen("local", "model-a");
        admitted.endpoint = original.clone();
        assert_ne!(admitted.endpoint, changed);
        assert_eq!(admitted.endpoint, original);
        assert!(inference_endpoint("local", "http://credential@127.0.0.1:1111/v1", "").is_err());
    }

    #[test]
    fn pi_provider_frozen_configuration_applies_to_both_protocols_and_switches() {
        for provider in ["local", "openai"] {
            for model in ["model-a", "model-b"] {
                let config = frozen(provider, model);
                let mut body = json!({"model":model,"stream":true,"messages":[{"role":"system","content":"opening"},{"role":"user","content":"hello"}],
                    "reasoning_effort":"different","reasoning":{"effort":"different"},"service_tier":"different"});
                configure_body(&mut body, &config).unwrap();
                if provider == "local" {
                    assert_eq!(body["reasoning_effort"], "brief");
                    assert!(body.get("service_tier").is_none());
                } else {
                    assert_eq!(body["reasoning"]["effort"], "brief");
                    assert_eq!(body["service_tier"], "flex");
                }
                assert_eq!(body["model"], model);
            }
        }
    }

    #[test]
    fn pi_provider_rejects_model_switch_during_turn_and_unsupported_tools() {
        let mut config = frozen("local", "admitted-model");
        let mut body = json!({"model":"later-model","stream":true,"messages":[]});
        assert!(configure_body(&mut body, &config).unwrap_err().contains("admitted turn"));
        body["model"] = "admitted-model".into();
        config.public.tools = false;
        body["tools"] = json!([{"type":"function"}]);
        assert!(configure_body(&mut body, &config).unwrap_err().contains("support tools"));
        body["tools"] = json!([]);
        body["messages"] = json!([{"role":"user"},{"role":"system"}]);
        assert!(configure_body(&mut body, &config).unwrap_err().contains("opening system"));
    }

    #[test]
    fn pi_fixture_endpoint_rejects_credentials_remote_hosts_and_redirect_parameters() {
        assert_eq!(fixture_endpoint("http://127.0.0.1:1443", "openai").unwrap(), "http://127.0.0.1:1443/openai/v1/responses");
        for base in ["http://localhost:1443", "https://127.0.0.1:1443", "http://key@127.0.0.1:1443", "http://127.0.0.1:1443?key=value", "http://192.168.0.1:1443"] {
            assert!(fixture_endpoint(base, "local").is_err());
        }
    }

    fn attachment(mime: &str, bytes: &[u8]) -> PiAttachment {
        PiAttachment { id: None, kind: if mime.starts_with("image/") { "image" } else { "file" }.into(),
            name: " sample ".into(), mime_type: mime.into(), size_bytes: bytes.len(), data_base64: BASE64_STANDARD.encode(bytes) }
    }

    #[test]
    fn pi_attachment_admission_checks_bytes_capabilities_and_stable_retry_identity() {
        let config = frozen("local", "model");
        let valid = validate_attachments(vec![attachment("text/plain", b"exact content")], &config.public).unwrap();
        assert_eq!(valid[0].name, "sample");
        assert_eq!(BASE64_STANDARD.decode(&valid[0].data_base64).unwrap(), b"exact content");
        let id = valid[0].id.clone();
        assert_eq!(validate_attachments(valid, &config.public).unwrap()[0].id, id);
        let mut invalid = attachment("text/plain", b"hello");
        invalid.size_bytes = 2;
        assert!(validate_attachments(vec![invalid], &config.public).err().unwrap().contains("size"));
        assert!(validate_attachments(vec![attachment("text/plain", &[0xff])], &config.public).is_err());
        assert!(validate_attachments(vec![attachment("application/pdf", b"pdf")], &config.public).is_err());
        assert!(validate_attachments(vec![attachment("image/png", b"image")], &config.public).is_err());
        let mut invalid = attachment("text/plain", b"hello");
        invalid.data_base64 = "!raw-invalid!".into();
        assert!(validate_attachments(vec![invalid], &config.public).is_err());
        let mut invalid = attachment("text/plain", b"hello"); invalid.kind = "image".into();
        assert!(validate_attachments(vec![invalid], &config.public).is_err());
        assert!(validate_attachments((0..11).map(|_| attachment("text/plain", b"x")).collect(), &config.public).is_err());
        let chunk = vec![b'x'; 9 * 1024 * 1024];
        assert!(validate_attachments((0..3).map(|_| attachment("text/plain", &chunk)).collect(), &config.public).is_err());
    }

    #[test]
    fn pi_attachment_wire_preserves_supported_media_and_exact_text() {
        for provider in ["local", "openai"] {
            let mut config = frozen(provider, "model");
            config.public.images = true;
            config.public.audio = provider == "local";
            config.public.video = provider == "local";
            config.public.accepted_mime_types = attachment_mime_types(true, config.public.audio, config.public.video, true, provider == "openai");
            let mut items = vec![attachment("text/markdown", "# exact éclair".as_bytes()), attachment("image/png", b"image bytes")];
            if provider == "openai" { items.push(attachment("application/pdf", b"%PDF exact")); }
            else { items.push(attachment("audio/wav", b"audio")); items.push(attachment("video/mp4", b"video")); }
            let items = validate_attachments(items, &config.public).unwrap();
            let mut body = if provider == "openai" { json!({"input":[{"role":"user","content":[{"type":"input_text","text":"question"}]}]}) }
                else { json!({"messages":[{"role":"user","content":"question"}]}) };
            append_attachments(&mut body, provider, &items).unwrap();
            let parts = if provider == "openai" { &body["input"][0]["content"] } else { &body["messages"][0]["content"] };
            assert_eq!(parts[2]["text"], "# exact éclair");
            assert!(parts.to_string().contains(&BASE64_STANDARD.encode(b"image bytes")));
            if provider == "openai" { assert_eq!(parts[6]["type"], "input_file"); assert_eq!(parts[6]["file_data"], format!("data:application/pdf;base64,{}",BASE64_STANDARD.encode(b"%PDF exact"))); }
            else { assert_eq!(parts[6]["input_audio"]["format"], "wav"); assert_eq!(parts[8]["video_url"]["url"], format!("data:video/mp4;base64,{}",BASE64_STANDARD.encode(b"video"))); }
        }
    }

    #[test]
    fn pi_forced_search_releases_selection_for_tools_and_formatter_continuation() {
        let mut config = frozen("openai", "model");
        config.public.enable_web = true; config.public.require_web = true;
        let base = json!({"model":"model","stream":true,"input":[],"tools":[{"type":"function","name":"formatter"}]});
        // Summaries/workers cannot consume the answer's initial hosted selection.
        let mut worker = base.clone(); configure_inference_body(&mut worker, &config, "researchSelection").unwrap();
        assert_eq!(worker["tools"].as_array().unwrap().len(), 1);
        for index in 0..3 {
            let mut body = base.clone(); configure_inference_body(&mut body, &config, "answer").unwrap();
            assert_eq!(body["tools"][0]["name"], "formatter");
            assert_eq!(body["tools"][1]["type"], "web_search");
            if index == 0 { assert_eq!(body["tool_choice"]["type"], "web_search"); }
            else { assert!(body.get("tool_choice").is_none()); }
        }
        let mut summary = base.clone();
        assert!(configure_inference_body(&mut summary, &config, "summary").is_err());
        summary["tools"] = json!([]); configure_inference_body(&mut summary, &config, "summary").unwrap();
        assert!(summary["tools"].as_array().unwrap().is_empty());
    }

    #[test]
    fn pi_transport_policy_change_cancels_and_restart_joins_active_work() {
        let transport = std::sync::Arc::new(NativeTransport::default());
        let token = CancellationToken::new();
        transport.requests.lock().unwrap().active.insert("request".into(), token.clone());
        transport.cancel_for_policy_change().unwrap();
        assert!(token.is_cancelled());
        let worker = transport.clone();
        let settled = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(10));
            worker.requests.lock().unwrap().active.clear();
            worker.settled.notify_all();
        });
        transport.quiesce_for_restart().unwrap();
        assert!(transport.requests.lock().unwrap().stopped);
        transport.resume_after_failed_restart().unwrap();
        assert!(!transport.requests.lock().unwrap().stopped);
        settled.join().unwrap();
    }
}
