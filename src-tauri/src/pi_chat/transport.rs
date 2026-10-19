//! Native endpoint/credential transport. Pi AI owns protocol conversion and parsing.
use super::authority::{
    AuthorityLease, AuthorityStore, ConversationBinding, DomainError, DomainResult,
};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct NativeTransport {
    requests: Mutex<Requests>,
    settled: Condvar,
    // Observed capabilities only, never credentials or permission. Refreshed at model
    // registration/reopen and the one unknown-capacity bootstrap observation.
    model_reasoning: Mutex<
        HashMap<(String, String), Option<crate::provider_config::local_reasoning::ModelReasoning>>,
    >,
}
#[derive(Default)]
struct Requests {
    stopped: bool,
    active: HashMap<String, ActiveRequest>,
    cancelled: VecDeque<(String, Instant)>,
}
struct ActiveRequest {
    authority_id: String,
    token: CancellationToken,
}
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Frame {
    Headers { status: u16, content_type: String },
    Chunk { bytes: Vec<u8> },
    Done,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelConfiguration {
    provider: String,
    model: String,
    context_window: Option<u64>,
    max_tokens: Option<u64>,
    images: bool,
    tools: bool,
    reasoning_effort: String,
    reasoning_wire_effort: Option<String>,
}
struct RequestConfiguration {
    endpoint: String,
    credential: Option<String>,
    reasoning: Option<String>,
    service_tier: String,
    tools: bool,
    subscription: bool,
}
fn transport_error(code: &str, message: &str) -> DomainError {
    DomainError::new(code, message)
}

impl NativeTransport {
    pub(crate) fn cancel_authorities(&self, ids: &[String]) -> DomainResult<()> {
        let requests = self
            .requests
            .lock()
            .map_err(|_| transport_error("transport", "Native transport is unavailable."))?;
        for active in requests.active.values() {
            if ids.contains(&active.authority_id) {
                active.token.cancel();
            }
        }
        Ok(())
    }
    pub(crate) fn quiesce_for_restart(&self) -> Result<(), String> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| "Transport lock poisoned")?;
        requests.stopped = true;
        for active in requests.active.values() {
            active.token.cancel();
        }
        let deadline = Instant::now() + Duration::from_secs(20);
        while !requests.active.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Native inference did not settle before restart".into());
            }
            requests = self
                .settled
                .wait_timeout(requests, remaining)
                .map_err(|_| "Transport wait poisoned")?
                .0;
        }
        Ok(())
    }
    pub(crate) fn resume_after_failed_restart(&self) -> Result<(), String> {
        self.requests
            .lock()
            .map_err(|_| "Transport lock poisoned")?
            .stopped = false;
        Ok(())
    }
}
fn valid_model(provider: &str, model: &str) -> DomainResult<()> {
    if !matches!(provider, "local" | "openai")
        || model.trim().is_empty()
        || model.len() > 256
        || model.chars().any(char::is_control)
    {
        return Err(transport_error(
            "invalid_model",
            "Invalid provider or model configuration.",
        ));
    }
    Ok(())
}
fn hosted_reasoning(effort: &str) -> Option<String> {
    (!matches!(effort, "off" | "none")).then(|| effort.to_string())
}
async fn configuration(
    app: &tauri::AppHandle,
    provider: &str,
    model: &str,
) -> DomainResult<RequestConfiguration> {
    valid_model(provider, model)?;
    let settings = app
        .state::<crate::chat_domain::ChatDomain>()
        .get_settings()
        .map_err(|_| transport_error("settings", "Chat settings are unavailable."))?;
    let (credential, subscription) = if provider == "openai" {
        let (credential, method) = crate::chatgpt_auth::resolve(app).await.map_err(|_| {
            transport_error(
                "credential",
                "The selected OpenAI credential is unavailable. Check Settings.",
            )
        })?;
        (
            credential,
            method == crate::chatgpt_auth::AuthMethod::Chatgpt,
        )
    } else {
        (
            crate::secrets::read_provider_api_key(app, provider).map_err(|_| {
                transport_error(
                    "credential",
                    "Unable to read the configured native credential.",
                )
            })?,
            false,
        )
    };
    if provider == "openai" && credential.is_none() {
        return Err(transport_error(
            "credential",
            "Add an OpenAI API key in Settings.",
        ));
    }
    let (endpoint, reasoning, tools) = if provider == "local" {
        crate::provider_config::validate_local_base_url(&settings.local_base_url)
            .map_err(|_| transport_error("endpoint", "The local model endpoint is invalid."))?;
        let domain = app.state::<crate::chat_domain::ChatDomain>();
        let caps = domain
            .local_model_capabilities(model)
            .map_err(|_| transport_error("settings", "Local model settings are unavailable."))?;
        let cache_key = (settings.local_base_url.clone(), model.to_string());
        let cached = app
            .state::<NativeTransport>()
            .model_reasoning
            .lock()
            .map_err(|_| transport_error("transport", "Native model metadata is unavailable."))?
            .get(&cache_key)
            .cloned();
        let metadata = match cached {
            Some(observed) => observed,
            None => {
                let observed = crate::provider_config::local_reasoning::discover(
                    &settings.local_base_url,
                    credential.as_deref(),
                    model,
                )
                .await;
                app.state::<NativeTransport>()
                    .model_reasoning
                    .lock()
                    .map_err(|_| {
                        transport_error("transport", "Native model metadata is unavailable.")
                    })?
                    .insert(cache_key, observed.clone());
                observed
            }
        };
        let reasoning = crate::provider_config::local_reasoning::wire_effort(
            metadata.as_ref(),
            Some(&caps.reasoning_effort),
        )
        .map(str::to_owned);
        (
            format!(
                "{}/chat/completions",
                settings.local_base_url.trim().trim_end_matches('/')
            ),
            reasoning,
            caps.tools,
        )
    } else {
        (
            format!(
                "{}/responses",
                crate::provider_config::openai_api_base_url()
                    .map_err(|_| transport_error(
                        "endpoint",
                        "The hosted model endpoint is unavailable."
                    ))?
                    .trim_end_matches('/')
            ),
            hosted_reasoning(&settings.reasoning_effort),
            true,
        )
    };
    Ok(RequestConfiguration {
        endpoint,
        credential,
        reasoning,
        service_tier: settings.service_tier.as_str().into(),
        tools,
        subscription,
    })
}

/// Only an actual loaded instance establishes a local context window. Advertised maxima are not loaded capacity.
fn loaded_capacity(value: &Value, model: &str) -> Option<u64> {
    let mut found = Vec::new();
    for entry in value["models"].as_array()? {
        for instance in entry["loaded_instances"].as_array().into_iter().flatten() {
            if entry["key"] == model || instance["id"] == model {
                found.push(
                    instance["config"]["context_length"]
                        .as_u64()
                        .filter(|n| *n > 0),
                );
            }
        }
    }
    if found.len() == 1 {
        found[0]
    } else {
        None
    }
}

#[tauri::command]
pub(crate) async fn pi_chat_model_configuration(
    app: tauri::AppHandle,
    provider: String,
    model: String,
) -> DomainResult<ModelConfiguration> {
    valid_model(&provider, &model)?;
    let domain = app.state::<crate::chat_domain::ChatDomain>();
    let settings = domain
        .get_settings()
        .map_err(|_| transport_error("settings", "Chat settings are unavailable."))?;
    if provider == "local" {
        crate::provider_config::validate_local_base_url(&settings.local_base_url)
            .map_err(|_| transport_error("endpoint", "The local model endpoint is invalid."))?;
        let credential = crate::secrets::read_provider_api_key(&app, "local").map_err(|_| {
            transport_error(
                "credential",
                "Unable to read the configured native credential.",
            )
        })?;
        let caps = domain
            .local_model_capabilities(&model)
            .map_err(|_| transport_error("settings", "Local model settings are unavailable."))?;
        let observed = crate::provider_config::model_metadata::ModelMetadataClient::new()
            .fetch(&settings.local_base_url, credential.as_deref())
            .await;
        let metadata = observed
            .as_ref()
            .and_then(|value| crate::provider_config::local_reasoning::from_models(value, &model));
        let selected = metadata
            .as_ref()
            .and_then(|data| data.selected(&caps.reasoning_effort))
            .unwrap_or("off")
            .to_string();
        let reasoning_wire_effort = crate::provider_config::local_reasoning::wire_effort(
            metadata.as_ref(),
            Some(&caps.reasoning_effort),
        )
        .map(str::to_owned);
        app.state::<NativeTransport>()
            .model_reasoning
            .lock()
            .map_err(|_| transport_error("transport", "Native model metadata is unavailable."))?
            .insert((settings.local_base_url, model.clone()), metadata);
        Ok(ModelConfiguration {
            context_window: observed
                .as_ref()
                .and_then(|value| loaded_capacity(value, &model)),
            provider,
            model,
            max_tokens: None,
            images: caps.images,
            tools: caps.tools,
            reasoning_effort: selected,
            reasoning_wire_effort,
        })
    } else {
        // Hosted catalog limits are populated from Pi AI's pinned catalog in the WebView.
        Ok(ModelConfiguration {
            provider,
            model,
            context_window: None,
            max_tokens: None,
            images: true,
            tools: true,
            reasoning_wire_effort: hosted_reasoning(&settings.reasoning_effort),
            reasoning_effort: settings.reasoning_effort,
        })
    }
}
fn configure_body(
    body: &mut Value,
    provider: &str,
    model: &str,
    configuration: &RequestConfiguration,
) -> DomainResult<()> {
    let object = body
        .as_object_mut()
        .ok_or_else(|| transport_error("invalid_request", "Inference JSON must be an object."))?;
    if object.get("model").and_then(Value::as_str) != Some(model)
        || object.get("stream") != Some(&Value::Bool(true))
    {
        return Err(transport_error(
            "invalid_request",
            "The inference configuration does not match the selected model.",
        ));
    }
    // This final normalization is mandatory even when Pi serialized the native
    // model's options: the WebView body is untrusted and settings may have changed.
    // Endpoint and authorization headers are supplied only by dispatch below.
    for key in ["endpoint", "base_url", "api_key", "headers"] {
        object.remove(key);
    }
    for key in [
        "reasoning_effort",
        "reasoning",
        "enable_thinking",
        "thinking",
        "chat_template_kwargs",
    ] {
        object.remove(key);
    }
    if provider == "local" {
        object.remove("service_tier");
        if let Some(reasoning) = &configuration.reasoning {
            object.insert("reasoning_effort".into(), reasoning.clone().into());
        }
    } else {
        if let Some(reasoning) = &configuration.reasoning {
            object.insert("reasoning".into(), serde_json::json!({"effort":reasoning}));
        }
        // Pi 1.3.0 Responses streamSimple does not forward serviceTier; current
        // native settings also override any stale or caller-selected tier.
        object.insert(
            "service_tier".into(),
            if configuration.service_tier == "flex" {
                "flex"
            } else {
                "default"
            }
            .into(),
        );
    }
    // No hosted built-in actions or arbitrary wire-level tools are configured by this transport.
    if object.contains_key("functions") || object.contains_key("function_call") {
        return Err(transport_error(
            "unsupported_tool",
            "Only application note tools are available.",
        ));
    }
    if let Some(value) = object.get("tools") {
        let tools = value.as_array().ok_or_else(|| {
            transport_error(
                "unsupported_tool",
                "Only application note tools are available.",
            )
        })?;
        if !configuration.tools && !tools.is_empty() {
            return Err(transport_error(
                "unsupported_tools",
                "The selected model does not support tools.",
            ));
        }
        if tools.iter().any(|tool| tool["type"] != "function") {
            return Err(transport_error(
                "unsupported_tool",
                "Only application note tools are available.",
            ));
        }
    }
    if let Some(choice) = object.get("tool_choice") {
        if !configuration.tools && choice.as_str() != Some("none") {
            return Err(transport_error(
                "unsupported_tools",
                "The selected model does not support tools.",
            ));
        }
        if !matches!(choice.as_str(), Some("auto" | "none" | "required"))
            && choice["type"] != "function"
        {
            return Err(transport_error(
                "unsupported_tool",
                "Only application note tools are available.",
            ));
        }
    }
    if configuration.subscription {
        configure_subscription_body(object)?;
    } else if provider == "openai" {
        // A conversation can continue after an explicit billing-method switch.
        // Pi retains call namespaces; match our static declarations on this route.
        for item in object
            .get_mut("input")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            if item["type"] == "function_call" && item["namespace"] == "gneauxghts_notes" {
                if let Some(item) = item.as_object_mut() {
                    item.remove("namespace");
                }
            }
        }
    }
    Ok(())
}

fn configure_subscription_body(object: &mut serde_json::Map<String, Value>) -> DomainResult<()> {
    // Pi's subscription mode already omits these. Recheck at the native boundary
    // because callers can be stale/untrusted and billing mode can change mid-turn.
    for key in [
        "background",
        "conversation",
        "max_output_tokens",
        "max_tool_calls",
        "metadata",
        "moderation",
        "multi_agent",
        "prompt",
        "prompt_cache_retention",
        "prompt_cache_options",
        "safety_identifier",
        "temperature",
        "top_logprobs",
        "top_p",
        "truncation",
        "user",
        "previous_response_id",
        "service_tier",
    ] {
        object.remove(key);
    }
    object.insert("store".into(), false.into());
    let input = object
        .get_mut("input")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            transport_error(
                "invalid_request",
                "Subscription requests require complete conversation input.",
            )
        })?;
    for item in input.iter_mut() {
        if item["type"] == "configuration_update" {
            return Err(transport_error(
                "invalid_request",
                "The selected subscription request needs a new attempt.",
            ));
        }
        if item["role"] == "system" {
            item["role"] = "developer".into();
        }
        if item["type"] == "function_call"
            && matches!(
                item["name"].as_str(),
                Some("search_notes" | "read_note" | "edit_note" | "create_note")
            )
        {
            item["namespace"] = "gneauxghts_notes".into();
        }
    }
    // Subscription inference accepts function tools grouped in a namespace.
    // Pi still owns each schema, parsing and the returned call's namespace.
    if let Some(tools) = object.remove("tools") {
        if tools.as_array().is_some_and(|tools| !tools.is_empty()) {
            object.insert("tools".into(), serde_json::json!([{"type":"namespace", "name":"gneauxghts_notes", "description":"Read and update authorized vault notes", "tools":tools}]));
        }
    }
    if let Some(choice) = object.get_mut("tool_choice").and_then(Value::as_object_mut) {
        choice.insert("namespace".into(), "gneauxghts_notes".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn pi_chat_cancel_fetch(
    transport: tauri::State<'_, NativeTransport>,
    id: String,
) -> DomainResult<()> {
    let mut requests = transport
        .requests
        .lock()
        .map_err(|_| transport_error("transport", "Native transport is unavailable."))?;
    if let Some(active) = requests.active.get(&id) {
        active.token.cancel();
    } else {
        requests
            .cancelled
            .retain(|(_, at)| at.elapsed() < Duration::from_secs(60));
        // Only bounded recent cancellation identities are retained, never conversations or scheduler state.
        if requests.cancelled.len() >= 1024 {
            requests.cancelled.pop_front();
        }
        requests.cancelled.push_back((id, Instant::now()));
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn pi_chat_fetch(
    app: tauri::AppHandle,
    id: String,
    authority_id: String,
    conversation_id: u64,
    provider_session_id: String,
    provider: String,
    model: String,
    body: String,
    frames: Channel<Frame>,
) -> DomainResult<()> {
    if body.len() > 16 * 1024 * 1024 || id.is_empty() || id.len() > 80 {
        return Err(transport_error(
            "invalid_request",
            "Invalid inference request.",
        ));
    }
    let authority = app.state::<AuthorityStore>();
    let lease = authority.validate_binding(
        &authority_id,
        &ConversationBinding {
            conversation_id,
            provider_session_id,
        },
    )?;
    let config = configuration(&app, &provider, &model).await?;
    let mut body: Value = serde_json::from_str(&body)
        .map_err(|_| transport_error("invalid_request", "Invalid inference JSON."))?;
    configure_body(&mut body, &provider, &model, &config)?;
    authority.validate_lease(&lease)?;
    let token = CancellationToken::new();
    {
        let transport = app.state::<NativeTransport>();
        let mut requests = transport
            .requests
            .lock()
            .map_err(|_| transport_error("transport", "Native transport is unavailable."))?;
        if requests.stopped {
            return Err(transport_error("closing", "Chat is closing."));
        }
        requests
            .cancelled
            .retain(|(_, at)| at.elapsed() < Duration::from_secs(60));
        if requests
            .cancelled
            .iter()
            .any(|(cancelled, _)| cancelled == &id)
        {
            return Err(transport_error("cancelled", "Native inference cancelled"));
        }
        if requests.active.contains_key(&id) {
            return Err(transport_error(
                "duplicate_request",
                "This inference is already active.",
            ));
        }
        requests.active.insert(
            id.clone(),
            ActiveRequest {
                authority_id,
                token: token.clone(),
            },
        );
    }
    let operation = dispatch(&app, &lease, &config, &body, &frames);
    let result = tokio::select! {_ = token.cancelled()=>Err(transport_error("cancelled","Native inference cancelled")), result=operation=>result};
    let transport = app.state::<NativeTransport>();
    if let Ok(mut requests) = transport.requests.lock() {
        requests.active.remove(&id);
        transport.settled.notify_all();
    }
    result
}
/// Preserve standard recovery categories, never return provider-controlled text.
fn provider_http_failure(status: u16, bytes: &[u8]) -> DomainError {
    let body: Value = serde_json::from_slice(bytes).unwrap_or(Value::Null);
    let error = body.get("error").unwrap_or(&body);
    let code = error
        .get("code")
        .or_else(|| error.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .or_else(|| std::str::from_utf8(bytes).ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let overflow = matches!(
        code.as_str(),
        "context_length_exceeded"
            | "context_window_exceeded"
            | "prompt_too_long"
            | "request_too_large"
    ) || message.contains("exceeds the context window")
        || message.contains("maximum context length")
        || message.contains("prompt is too long")
        || message.contains("prompt too long")
        || message.contains("exceeds the available context size")
        || message.contains("greater than the context length")
        || message.contains("requested token count exceeds")
        || message.contains("configured context size");
    if overflow {
        return transport_error(
            "provider_context_overflow",
            "The request exceeds the model context window.",
        );
    }
    if matches!(
        code.as_str(),
        "insufficient_quota"
            | "billing_hard_limit_reached"
            | "usage_limit_reached"
            | "subscription_sharing_usage_limit_exceeded"
    ) {
        return transport_error(
            "provider_limit",
            "The model account cannot accept this request.",
        );
    }
    if status == 429 {
        return transport_error(
            "provider_rate_limit",
            "The model server asked to retry later.",
        );
    }
    if status == 401 {
        return transport_error(
            "credential",
            "The selected OpenAI credential needs attention in Settings.",
        );
    }
    if status == 408 || status >= 500 {
        return transport_error(
            "provider_transient",
            "The model server is temporarily unavailable.",
        );
    }
    transport_error(
        "provider_http",
        &format!("The model server rejected the request (HTTP {status})."),
    )
}

async fn dispatch(
    app: &tauri::AppHandle,
    lease: &AuthorityLease,
    configuration: &RequestConfiguration,
    body: &Value,
    frames: &Channel<Frame>,
) -> DomainResult<()> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| transport_error("transport", "Unable to configure native transport."))?;
    let mut request = client.post(&configuration.endpoint).json(body);
    if let Some(key) = &configuration.credential {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| transport_error("connection", "Native provider connection failed"))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        // Error bodies are untrusted and may echo prompts or credentials. Inspect only
        // bounded bytes natively, then return a canonical recovery category.
        let mut stream = response.bytes_stream();
        let mut error_bytes = Vec::new();
        let read = async {
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(value) => value,
                    Err(_) => break,
                };
                if error_bytes.len() + chunk.len() > 65536 {
                    break;
                }
                error_bytes.extend_from_slice(&chunk);
            }
        };
        let _ = tokio::time::timeout(Duration::from_secs(5), read).await;
        let failure = provider_http_failure(status, &error_bytes);
        if status == 401 && configuration.subscription {
            if let Some(rejected) = &configuration.credential {
                // Confirm terminal revocation before making sign-in available;
                // transient refresh errors leave the saved connection intact.
                let _ = crate::chatgpt_auth::recover_rejected_access(app, rejected).await;
            }
        }
        app.state::<AuthorityStore>().validate_lease(lease)?;
        let message = match failure.code.as_str() {
            "provider_context_overflow" => "prompt is too long",
            "provider_limit" => "insufficient_quota",
            "provider_rate_limit" => "rate limit exceeded",
            "provider_transient" => "service unavailable",
            _ => "The model server rejected the request",
        };
        let bytes = serde_json::to_vec(
            &serde_json::json!({"error":{"code":failure.code,"message":message}}),
        )
        .map_err(|_| transport_error("protocol", "Unable to encode provider failure."))?;
        frames
            .send(Frame::Headers {
                status,
                content_type: "application/json".into(),
            })
            .map_err(|_| transport_error("disconnected", "WebView disconnected."))?;
        frames
            .send(Frame::Chunk { bytes })
            .map_err(|_| transport_error("disconnected", "WebView disconnected."))?;
        frames
            .send(Frame::Done)
            .map_err(|_| transport_error("disconnected", "WebView disconnected."))?;
        return Ok(());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // The request already requires streaming. Some subscription responses omit
    // Content-Type despite carrying valid SSE. Forward the actual header and
    // bytes; Pi's provider parser validates events and terminal completion.
    let authority = app.state::<AuthorityStore>();
    authority.validate_lease(lease)?;
    frames
        .send(Frame::Headers {
            status,
            content_type,
        })
        .map_err(|_| transport_error("disconnected", "WebView disconnected."))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes =
            chunk.map_err(|_| transport_error("stream", "Native provider stream failed"))?;
        authority.validate_lease(lease)?;
        frames
            .send(Frame::Chunk {
                bytes: bytes.to_vec(),
            })
            .map_err(|_| transport_error("disconnected", "WebView disconnected."))?;
    }
    authority.validate_lease(lease)?;
    frames
        .send(Frame::Done)
        .map_err(|_| transport_error("disconnected", "WebView disconnected."))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn request_configuration(
        reasoning: Option<&str>,
        tier: &str,
        tools: bool,
    ) -> RequestConfiguration {
        RequestConfiguration {
            endpoint: "http://native.invalid/v1".into(),
            credential: Some("native-only".into()),
            reasoning: reasoning.map(str::to_owned),
            service_tier: tier.into(),
            tools,
            subscription: false,
        }
    }
    #[test]
    fn local_outgoing_reasoning_uses_only_advertised_choices_and_defaults() {
        for (options, default, requested, expected) in [
            (json!(["off", "on"]), "on", "off", Some("none")),
            (json!(["off", "on"]), "on", "on", None),
            (json!(["off", "on"]), "on", "medium", None),
            (
                json!(["off", "brief", "deep"]),
                "deep",
                "brief",
                Some("brief"),
            ),
            (
                json!(["off", "brief", "deep"]),
                "deep",
                "medium",
                Some("deep"),
            ),
            (json!(["off", "on"]), "off", "on", Some("none")),
            (json!(["off", "bad value"]), "off", "off", None),
            (Value::Null, "off", "none", None),
        ] {
            let metadata = json!({"models":[{"key":"m","capabilities":{"reasoning":{"allowed_options":options,"default":default}}}]});
            let metadata = crate::provider_config::local_reasoning::from_models(&metadata, "m");
            let reasoning = crate::provider_config::local_reasoning::wire_effort(
                metadata.as_ref(),
                Some(requested),
            );
            assert_eq!(reasoning, expected);
            let mut body = json!({"model":"m","stream":true,"reasoning_effort":"tampered","reasoning":{"effort":"tampered"},
                "thinking":"tampered","enable_thinking":true,"chat_template_kwargs":{"enable_thinking":true},"service_tier":"flex"});
            configure_body(
                &mut body,
                "local",
                "m",
                &request_configuration(reasoning, "flex", true),
            )
            .unwrap();
            assert_eq!(
                body.get("reasoning_effort").and_then(Value::as_str),
                expected
            );
            for key in [
                "reasoning",
                "thinking",
                "enable_thinking",
                "chat_template_kwargs",
                "service_tier",
            ] {
                assert!(body.get(key).is_none());
            }
        }
    }
    #[test]
    fn subscription_requests_keep_history_and_strict_schemas_in_supported_namespaces() {
        let mut configuration = request_configuration(Some("high"), "flex", true);
        configuration.subscription = true;
        let schema = json!({"type":"object","additionalProperties":false,"required":["noteId","quote"],"properties":{"noteId":{"type":"string"},"quote":{"anyOf":[{"type":"string"},{"type":"null"}]}}});
        let tool = json!({"type":"function","name":"read_note","strict":true,"parameters":schema});
        let mut body = json!({"model":"m","stream":true,"store":true,"max_output_tokens":100,"temperature":0.3,"previous_response_id":"old","metadata":{"secret":"caller"},"tools":[tool.clone()],"tool_choice":{"type":"function","name":"read_note"},"input":[{"type":"message","role":"system","content":"rules"},{"type":"function_call","name":"read_note","namespace":"gneauxghts_notes","call_id":"call-1","arguments":"{}"},{"type":"function_call_output","call_id":"call-1","output":"note text"}]});
        configure_body(&mut body, "openai", "m", &configuration).unwrap();
        for key in [
            "max_output_tokens",
            "temperature",
            "previous_response_id",
            "metadata",
            "service_tier",
        ] {
            assert!(body.get(key).is_none(), "{key}");
        }
        assert_eq!(body["store"], false);
        assert_eq!(body["tools"][0]["type"], "namespace");
        assert_eq!(body["tools"][0]["name"], "gneauxghts_notes");
        assert_eq!(body["tools"][0]["tools"][0], tool);
        assert_eq!(body["tool_choice"]["namespace"], "gneauxghts_notes");
        assert_eq!(body["input"][0]["role"], "developer");
        assert_eq!(body["input"][1]["namespace"], "gneauxghts_notes");
        assert_eq!(body["input"][2]["output"], "note text");
        assert_eq!(body["reasoning"]["effort"], "high");
    }
    #[test]
    fn hosted_outgoing_reasoning_and_tier_use_current_native_settings() {
        for effort in ["off", "none", "low", "high"] {
            for (tier, wire_tier) in [("standard", "default"), ("flex", "flex")] {
                let reasoning = hosted_reasoning(effort);
                let mut body = json!({"model":"m","stream":true,"reasoning":{"effort":"tampered","summary":"detailed"},
                "reasoning_effort":"tampered","enable_thinking":true,"thinking":"tampered","chat_template_kwargs":{},"service_tier":"priority"});
                configure_body(
                    &mut body,
                    "openai",
                    "m",
                    &request_configuration(reasoning.as_deref(), tier, true),
                )
                .unwrap();
                assert_eq!(
                    body.get("reasoning"),
                    reasoning
                        .as_ref()
                        .map(|value| json!({"effort":value}))
                        .as_ref()
                );
                assert_eq!(body["service_tier"], wire_tier);
                for key in [
                    "reasoning_effort",
                    "enable_thinking",
                    "thinking",
                    "chat_template_kwargs",
                ] {
                    assert!(body.get(key).is_none());
                }
            }
        }
    }
    #[test]
    fn tampered_model_stream_transport_and_tools_cannot_override_native_contract() {
        for provider in ["local", "openai"] {
            for tampered in [
                json!({"model":"other","stream":true}),
                json!({"model":"m","stream":false}),
                json!({"model":"m"}),
            ] {
                assert_eq!(
                    configure_body(
                        &mut tampered.clone(),
                        provider,
                        "m",
                        &request_configuration(None, "standard", true)
                    )
                    .unwrap_err()
                    .code,
                    "invalid_request"
                );
            }
            for mut body in [
                json!({"model":"m","stream":true,"tools":[{"type":"web_search"}]}),
                json!({"model":"m","stream":true,"tools":{}}),
                json!({"model":"m","stream":true,"functions":[]}),
                json!({"model":"m","stream":true,"function_call":"auto"}),
                json!({"model":"m","stream":true,"tool_choice":{"type":"web_search"}}),
            ] {
                assert_eq!(
                    configure_body(
                        &mut body,
                        provider,
                        "m",
                        &request_configuration(None, "standard", true)
                    )
                    .unwrap_err()
                    .code,
                    "unsupported_tool"
                );
            }
            let tool = if provider == "local" {
                json!({"type":"function","function":{"name":"read_note","parameters":{}}})
            } else {
                json!({"type":"function","name":"read_note","parameters":{}})
            };
            let mut body = json!({"model":"m","stream":true,"tools":[tool],"tool_choice":"auto"});
            assert_eq!(
                configure_body(
                    &mut body,
                    provider,
                    "m",
                    &request_configuration(None, "standard", false)
                )
                .unwrap_err()
                .code,
                "unsupported_tools"
            );
            configure_body(
                &mut body,
                provider,
                "m",
                &request_configuration(None, "standard", true),
            )
            .unwrap();
            let mut body = json!({"model":"m","stream":true,"tool_choice":{"type":"function","name":"read_note"}});
            assert_eq!(
                configure_body(
                    &mut body,
                    provider,
                    "m",
                    &request_configuration(None, "standard", false)
                )
                .unwrap_err()
                .code,
                "unsupported_tools"
            );
            let config = request_configuration(None, "standard", true);
            let mut body = json!({"model":"m","stream":true,"endpoint":"caller","base_url":"caller","api_key":"caller","headers":{"Authorization":"caller"}});
            configure_body(&mut body, provider, "m", &config).unwrap();
            for key in ["endpoint", "base_url", "api_key", "headers"] {
                assert!(body.get(key).is_none());
            }
            assert_eq!(config.endpoint, "http://native.invalid/v1");
            assert_eq!(config.credential.as_deref(), Some("native-only"));
        }
    }
    #[test]
    fn http_errors_preserve_only_safe_recovery_categories() {
        assert_eq!(
            provider_http_failure(
                400,
                br#"{"error":{"code":"context_length_exceeded","message":"secret prompt"}}"#
            )
            .code,
            "provider_context_overflow"
        );
        assert_eq!(provider_http_failure(400,br#"{"error":{"message":"tokens to keep from the initial prompt is greater than the context length"}}"#).code,"provider_context_overflow");
        assert_eq!(
            provider_http_failure(
                429,
                br#"{"error":{"code":"insufficient_quota","message":"secret credential"}}"#
            )
            .code,
            "provider_limit"
        );
        assert_eq!(
            provider_http_failure(429, b"secret credential").code,
            "provider_rate_limit"
        );
        assert_eq!(
            provider_http_failure(503, b"secret credential").code,
            "provider_transient"
        );
        let rejected = provider_http_failure(401, br#"{"error":{"message":"secret credential"}}"#);
        assert_eq!(rejected.code, "credential");
        assert!(!rejected.message.contains("secret"));
    }
    #[test]
    fn capacity_requires_exact_unambiguous_loaded_instance() {
        let metadata = json!({"models":[{"key":"m","max_context_length":262144,"loaded_instances":[{"id":"instance","config":{"context_length":129280}}]}]});
        assert_eq!(loaded_capacity(&metadata, "m"), Some(129280));
        assert_eq!(loaded_capacity(&metadata, "instance"), Some(129280));
        assert_eq!(
            loaded_capacity(
                &json!({"models":[{"key":"m","max_context_length":262144,"loaded_instances":[]}]}),
                "m"
            ),
            None
        );
        assert_eq!(
            loaded_capacity(
                &json!({"models":[{"key":"m","loaded_instances":[{"id":"a","config":{"context_length":1000}},{"id":"b","config":{"context_length":2000}}]}]}),
                "m"
            ),
            None
        );
    }
    #[test]
    fn native_configuration_keeps_endpoint_and_credentials_out_of_inference_body() {
        let configuration = RequestConfiguration {
            endpoint: "http://private.invalid/v1/chat/completions".into(),
            credential: Some("private-credential".into()),
            reasoning: None,
            service_tier: "standard".into(),
            tools: true,
            subscription: false,
        };
        let mut body = json!({"model":"m","stream":true,"messages":[{"role":"user","content":"hello"}],"reasoning_effort":"medium"});
        configure_body(&mut body, "local", "m", &configuration).unwrap();
        assert!(body.get("reasoning_effort").is_none());
        assert!(!body.to_string().contains("private"));
        body["model"] = "other".into();
        assert_eq!(
            configure_body(&mut body, "local", "m", &configuration)
                .unwrap_err()
                .code,
            "invalid_request"
        );
    }
}
