//! Single-inference HTTP transport only. Pi owns all model/tool coordination.
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::{collections::{HashMap, VecDeque}, sync::Mutex, time::{Duration, Instant}};
use tauri::{ipc::Channel, Manager};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct NativeTransport(Mutex<Requests>);

#[derive(Default)]
struct Requests {
    active: HashMap<String, CancellationToken>,
    // A cancellation IPC may arrive before its inference IPC is scheduled.
    cancelled: VecDeque<(String, Instant)>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Frame {
    Headers { status: u16, content_type: String },
    Chunk { bytes: Vec<u8> },
    Done,
}

#[tauri::command]
pub(crate) fn pi_cancel_fetch(transport: tauri::State<'_, NativeTransport>, id: String) -> Result<(), String> {
    let mut requests = transport.0.lock().map_err(|_| "Transport lock poisoned")?;
    if let Some(token) = requests.active.get(&id) {
        token.cancel();
    } else {
        requests.cancelled.retain(|(_, at)| at.elapsed() < Duration::from_secs(60));
        if requests.cancelled.len() >= 256 { return Err("Cancellation registry full".into()); }
        requests.cancelled.push_back((id, Instant::now()));
    }
    Ok(())
}

fn endpoint(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    if let Ok(base) = std::env::var("PI_PROTOTYPE_HTTP_FIXTURE") {
        let url = url::Url::parse(&base).map_err(|_| "Invalid fixture URL")?;
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || !url.username().is_empty() || url.password().is_some() {
            return Err("Pi fixture must be an explicit IPv4 loopback HTTP URL".into());
        }
        return Ok(format!("{}/{}", base.trim_end_matches('/'), if provider == "openai" { "openai/v1/responses" } else { "local/v1/chat/completions" }));
    }
    match provider {
        "openai" => Ok("https://api.openai.com/v1/responses".into()),
        "local" => {
            let base = app.state::<crate::chat::ChatService>().get_settings()?.local_base_url;
            crate::agent_runtime::validate_local_base_url(&base)?;
            Ok(format!("{}/chat/completions", base.trim_end_matches('/')))
        }
        _ => Err("Unsupported Pi provider".into()),
    }
}

#[tauri::command]
pub(crate) async fn pi_fetch(app: tauri::AppHandle, id: String, provider: String, body: String, frames: Channel<Frame>) -> Result<(), String> {
    if !matches!(provider.as_str(), "openai" | "local") || body.len() > 262_144 || id.len() > 80 {
        return Err("Invalid Pi inference request".into());
    }
    let body: Value = serde_json::from_str(&body).map_err(|_| "Invalid inference JSON")?;
    let endpoint = endpoint(&app, &provider)?;
    let token = CancellationToken::new();
    {
        let transport = app.state::<NativeTransport>();
        let mut requests = transport.0.lock().map_err(|_| "Transport lock poisoned")?;
        requests.cancelled.retain(|(_, at)| at.elapsed() < Duration::from_secs(60));
        if requests.cancelled.iter().any(|(cancelled, _)| cancelled == &id) {
            return Err("Native inference cancelled before admission".into());
        }
        if requests.active.len() >= 4 || requests.active.contains_key(&id) { return Err("Inference already active or transport full".into()); }
        requests.active.insert(id.clone(), token.clone());
    }
    let operation = async {
        let mut request = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?
            .post(endpoint).json(&body);
        if std::env::var_os("PI_PROTOTYPE_HTTP_FIXTURE").is_none() {
            if let Some(key) = crate::secrets::read_provider_api_key(&app, &provider)? {
                request = request.bearer_auth(key);
            } else if provider == "openai" {
                return Err("Configure the prototype's OpenAI key in native secure storage".into());
            }
        }
        let response = request.send().await.map_err(|_| "Native provider connection failed")?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) { return Err(format!("Native provider HTTP {status}")); }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()).unwrap_or("text/event-stream").to_string();
        frames.send(Frame::Headers { status, content_type }).map_err(|_| "Webview disconnected")?;
        let mut stream = response.bytes_stream();
        let mut bytes_received = 0;
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|_| "Native provider stream failed")?;
            bytes_received += bytes.len();
            if bytes_received > 8_388_608 { return Err("Prototype provider response exceeds bound".into()); }
            frames.send(Frame::Chunk { bytes: bytes.to_vec() }).map_err(|_| "Webview disconnected")?;
        }
        frames.send(Frame::Done).map_err(|_| "Webview disconnected")?;
        Ok(())
    };
    let result = tokio::select! {
        _ = token.cancelled() => Err("Native inference cancelled".into()),
        value = tokio::time::timeout(Duration::from_secs(900), operation) =>
            value.unwrap_or_else(|_| Err("Native inference deadline exceeded".into())),
    };
    app.state::<NativeTransport>().0.lock().map_err(|_| "Transport lock poisoned")?.active.remove(&id);
    result
}
