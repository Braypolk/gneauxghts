//! Server-advertised reasoning choices and the compatible transport mapping.
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ModelReasoning {
    pub(crate) options: Vec<String>,
    pub(crate) default: Option<String>,
}

pub(crate) fn valid_option(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
}

impl ModelReasoning {
    pub(crate) fn selected(&self, requested: &str) -> Option<&str> {
        self.options
            .iter()
            .find(|option| option.as_str() == requested)
            .map(String::as_str)
            .or(self.default.as_deref())
            .or_else(|| self.options.first().map(String::as_str))
    }
}

pub(crate) fn from_models(value: &Value, model: &str) -> Option<ModelReasoning> {
    let models = value.get("models")?.as_array()?;
    let instance_matches = |entry: &&Value| {
        entry
            .get("loaded_instances")
            .and_then(Value::as_array)
            .is_some_and(|instances| {
                instances
                    .iter()
                    .any(|instance| instance["id"].as_str() == Some(model))
            })
    };
    let mut matches = models.iter().filter(instance_matches);
    let entry = if let Some(entry) = matches.next() {
        if matches.next().is_some() {
            return None;
        }
        entry
    } else {
        let mut matches = models.iter().filter(|entry| {
            entry["key"].as_str() == Some(model)
                || entry
                    .get("variants")
                    .and_then(Value::as_array)
                    .is_some_and(|variants| {
                        variants
                            .iter()
                            .any(|variant| variant.as_str() == Some(model))
                    })
        });
        let entry = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        entry
    };
    let reasoning = entry.get("capabilities")?.get("reasoning")?;
    let raw_options = reasoning.get("allowed_options")?.as_array()?;
    if raw_options.len() > 32 {
        return None;
    }
    let mut options = Vec::new();
    for option in raw_options {
        let option = option.as_str()?;
        if !valid_option(option) {
            return None;
        }
        if !options.iter().any(|prior| prior == option) {
            options.push(option.to_string());
        }
    }
    let default = reasoning
        .get("default")
        .and_then(Value::as_str)
        .filter(|value| options.iter().any(|option| option == value))
        .map(str::to_string);
    // Chat Completions rejects literal `on`. Omitting the override preserves
    // enabled reasoning with the server's default budget. A default-off server
    // cannot offer this choice through that transport without misrepresenting it.
    if default
        .as_deref()
        .is_none_or(|value| matches!(value, "off" | "none"))
    {
        options.retain(|option| option != "on");
    }
    (!options.is_empty()).then_some(ModelReasoning { options, default })
}

pub(crate) async fn discover(base: &str, key: Option<&str>, model: &str) -> Option<ModelReasoning> {
    let value = super::model_metadata::ModelMetadataClient::new()
        .fetch(base, key)
        .await?;
    from_models(&value, model.trim())
}

pub(crate) fn wire_effort<'a>(
    metadata: Option<&'a ModelReasoning>,
    requested: Option<&str>,
) -> Option<&'a str> {
    // Internal callers can explicitly disable reasoning for bounded summaries.
    if requested == Some("none") {
        return Some("none");
    }
    let selected = metadata?.selected(requested?)?;
    match selected {
        "off" => Some("none"),
        "on" => None,
        value => Some(value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn models(options: Value, default: &str) -> Value {
        json!({"models":[{"key":"custom-model","loaded_instances":[{"id":"loaded-alias"}],
            "capabilities":{"reasoning":{"allowed_options":options,"default":default}}}]})
    }

    #[test]
    fn advertised_toggle_replaces_old_medium_and_maps_off_without_unsupported_values() {
        let meta = from_models(&models(json!(["off", "on"]), "on"), "loaded-alias").unwrap();
        assert_eq!(meta.options, ["off", "on"]);
        assert_eq!(meta.selected("medium"), Some("on"));
        assert_eq!(wire_effort(Some(&meta), Some("medium")), None);
        assert_eq!(wire_effort(Some(&meta), Some("on")), None);
        assert_eq!(wire_effort(Some(&meta), Some("off")), Some("none"));
    }

    #[test]
    fn arbitrary_advertised_levels_and_defaults_do_not_depend_on_model_names() {
        let meta = from_models(
            &models(json!(["off", "brief", "deep", "deep"]), "deep"),
            "custom-model",
        )
        .unwrap();
        assert_eq!(meta.options, ["off", "brief", "deep"]);
        assert_eq!(wire_effort(Some(&meta), Some("medium")), Some("deep"));
        assert_eq!(wire_effort(Some(&meta), Some("brief")), Some("brief"));
        assert_eq!(
            from_models(&models(json!(["on"]), "on"), "unrelated-model"),
            None
        );
    }

    #[test]
    fn unavailable_or_invalid_metadata_never_invents_levels() {
        assert_eq!(
            from_models(&json!({"data":[{"id":"qwen3.8"}]}), "qwen3.8"),
            None
        );
        assert_eq!(
            from_models(&models(json!(["off", "bad value"]), "off"), "custom-model"),
            None
        );
        assert_eq!(wire_effort(None, Some("medium")), None);
        assert_eq!(wire_effort(None, Some("none")), Some("none"));
        let meta = from_models(&models(json!(["off", "on"]), "off"), "custom-model").unwrap();
        assert_eq!(meta.options, ["off"]);
        assert_eq!(wire_effort(Some(&meta), Some("on")), Some("none"));
    }

    #[cfg(not(feature = "pi-prototype"))]
    #[test]
    fn production_runtime_discovers_options_and_sends_only_compatible_overrides() {
        use crate::agent_runtime::{
            AgentProvider, AgentRuntime, AgentRuntimeObserver, AgentRuntimeRequest,
        };
        use rig_core::completion::Message;
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::Arc;
        use tokio_util::sync::CancellationToken;
        for (setting, advertised, expected) in [
            ("medium", models(json!(["off", "on"]), "on"), None),
            ("off", models(json!(["off", "on"]), "on"), Some("none")),
            (
                "medium",
                models(json!(["off", "low", "xhigh"]), "xhigh"),
                Some("xhigh"),
            ),
            ("medium", json!({"models":[]}), None),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let base = format!("http://{}/v1", listener.local_addr().unwrap());
            let (tx, rx) = std::sync::mpsc::channel();
            let server = std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
                while std::time::Instant::now() < deadline {
                    let Ok((mut socket, _)) = listener.accept() else {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                        continue;
                    };
                    socket
                        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                        .unwrap();
                    let mut bytes = Vec::new();
                    let header_end = loop {
                        let mut chunk = [0; 4096];
                        let count = socket.read(&mut chunk).unwrap();
                        assert!(count > 0);
                        bytes.extend_from_slice(&chunk[..count]);
                        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                            break end + 4;
                        }
                    };
                    let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
                    let post = headers.starts_with("POST /v1/chat/completions ");
                    assert!(headers
                        .to_ascii_lowercase()
                        .contains("authorization: bearer test-key"));
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    while bytes.len() < header_end + length {
                        let mut chunk = [0; 4096];
                        let count = socket.read(&mut chunk).unwrap();
                        assert!(count > 0);
                        bytes.extend_from_slice(&chunk[..count]);
                    }
                    let body = if post {
                        tx.send(
                            serde_json::from_slice::<Value>(
                                &bytes[header_end..header_end + length],
                            )
                            .unwrap(),
                        )
                        .unwrap();
                        "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"custom-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"OK\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"custom-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\ndata: [DONE]\n\n".to_string()
                    } else {
                        assert!(headers.starts_with("GET /api/v1/models "));
                        advertised.to_string()
                    };
                    write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", if post { "text/event-stream" } else { "application/json" }, body.len(), body).unwrap();
                    if post {
                        return;
                    }
                }
                panic!("Runtime did not send a completion request");
            });
            tauri::async_runtime::block_on(async {
                let response = tokio::time::timeout(
                    std::time::Duration::from_secs(8),
                    AgentRuntime::run(
                        AgentRuntimeRequest {
                            provider: AgentProvider::Local,
                            model: "custom-model".into(),
                            api_key: Some("test-key".into()),
                            local_base_url: base,
                            preamble: "Answer briefly".into(),
                            output_schema: None,
                            prompt: Message::user("Say OK"),
                            history: vec![],
                            enable_web: false,
                            require_web: false,
                            flex: false,
                            reasoning_effort: Some(setting.into()),
                        },
                        None,
                        AgentRuntimeObserver {
                            evidence_context: None,
                            permissions: None,
                            cancelled: CancellationToken::new(),
                            on_event: Arc::new(|_| {}),
                        },
                        crate::agent_guardrails::AgentRunGuard::new(Default::default()),
                    ),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(response.output, "OK");
            });
            server.join().unwrap();
            let wire = rx.recv().unwrap();
            assert_eq!(
                wire.get("reasoning_effort").and_then(Value::as_str),
                expected
            );
        }
    }
}
