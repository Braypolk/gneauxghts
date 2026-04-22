use super::{
    store::normalize_base_url, AiModelOption, AiProviderKind, AiRunMetrics, IntegrateEditResponse,
    StoredAiJob, TargetNoteContext,
};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) struct ModelCompletion {
    pub(super) text: String,
    pub(super) model: String,
    pub(super) usage: UsageTotals,
}

#[derive(Clone, Debug, Default)]
pub(super) struct UsageTotals {
    pub(super) prompt_tokens: Option<u64>,
    pub(super) completion_tokens: Option<u64>,
    pub(super) total_tokens: Option<u64>,
}

pub(super) trait GenerationProvider {
    fn complete_json(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<ModelCompletion, String>;
    fn provider_kind(&self) -> AiProviderKind;
}

pub(super) struct OpenAiCompatibleProvider {
    client: Client,
    base_url: String,
    model: String,
    api_key: String,
}

pub(super) fn build_ai_http_client(
    connect_timeout_secs: u64,
    request_timeout_secs: u64,
) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(connect_timeout_secs))
        .timeout(std::time::Duration::from_secs(request_timeout_secs))
        .build()
        .map_err(|err| err.to_string())
}

pub(super) fn openai_compatible_endpoint(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    format!("{trimmed}/{trimmed_path}")
}

pub(super) fn build_provider(
    settings: &super::StoredAiSettings,
) -> Result<Box<dyn GenerationProvider + Send + Sync>, String> {
    match settings.provider_kind {
        AiProviderKind::OpenAiCompatible => {
            let api_key = settings
                .api_key
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "Set an API key in Settings before using AI remember modes.".to_string()
                })?;
            if settings.model.trim().is_empty() {
                return Err("Set a model in Settings before using AI remember modes.".to_string());
            }
            Ok(Box::new(OpenAiCompatibleProvider {
                client: build_ai_http_client(
                    super::AI_CONNECT_TIMEOUT_SECS,
                    super::AI_COMPLETION_TIMEOUT_SECS,
                )?,
                base_url: normalize_base_url(&settings.base_url),
                model: settings.model.clone(),
                api_key,
            }))
        }
        AiProviderKind::LlamaServer => Err(
            "The local llama-server generation provider is reserved for future support."
                .to_string(),
        ),
    }
}

impl GenerationProvider for OpenAiCompatibleProvider {
    fn complete_json(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<ModelCompletion, String> {
        let response = self
            .client
            .post(openai_compatible_endpoint(
                self.base_url.as_str(),
                "chat/completions",
            ))
            .bearer_auth(&self.api_key)
            .json(&json!({
                "model": self.model,
                "response_format": { "type": "text" },
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ]
            }))
            .send()
            .map_err(|err| err.to_string())?;

        if !response.status().is_success() {
            return Err(response
                .text()
                .unwrap_or_else(|_| "Model request failed".to_string()));
        }

        let body: Value = response.json().map_err(|err| err.to_string())?;
        let content = extract_completion_text(&body)?;
        let model = body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(self.model.as_str())
            .to_string();
        Ok(ModelCompletion {
            text: content,
            model,
            usage: UsageTotals {
                prompt_tokens: body
                    .get("usage")
                    .and_then(|usage| usage.get("prompt_tokens"))
                    .and_then(Value::as_u64),
                completion_tokens: body
                    .get("usage")
                    .and_then(|usage| usage.get("completion_tokens"))
                    .and_then(Value::as_u64),
                total_tokens: body
                    .get("usage")
                    .and_then(|usage| usage.get("total_tokens"))
                    .and_then(Value::as_u64),
            },
        })
    }

    fn provider_kind(&self) -> AiProviderKind {
        AiProviderKind::OpenAiCompatible
    }
}

pub(super) fn fetch_openai_compatible_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<AiModelOption>, String> {
    let client = build_ai_http_client(
        super::AI_CONNECT_TIMEOUT_SECS,
        super::AI_MODEL_LIST_TIMEOUT_SECS,
    )?;
    let response = client
        .get(openai_compatible_endpoint(base_url, "models"))
        .bearer_auth(api_key)
        .send()
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(response
            .text()
            .unwrap_or_else(|_| "Model discovery failed".to_string()));
    }

    let body: Value = response.json().map_err(|err| err.to_string())?;
    let mut models = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Model response did not include a data array.".to_string())?
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter(|id| !id.trim().is_empty())
        .map(|id| AiModelOption { id: id.to_string() })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

pub(super) fn extract_completion_text(body: &Value) -> Result<String, String> {
    let Some(choice) = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    else {
        return Err("Model response did not include any choices.".to_string());
    };

    let Some(message) = choice.get("message") else {
        return Err("Model response did not include a message.".to_string());
    };

    if let Some(content) = message
        .get("content")
        .and_then(Value::as_str)
        .filter(|content| !content.trim().is_empty())
    {
        return Ok(content.to_string());
    }

    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        let mut text = String::new();
        for part in parts {
            if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                text.push_str(part_text);
            }
        }
        if !text.trim().is_empty() {
            return Ok(text);
        }
    }

    if message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(
            "Model returned reasoning text but no final assistant content. Choose a non-thinking model or disable reasoning output in the server."
                .to_string(),
        );
    }

    Err("Model response did not include text content.".to_string())
}

pub(super) fn usage_to_metrics(usage: UsageTotals) -> AiRunMetrics {
    AiRunMetrics {
        elapsed_millis: 0,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
    }
}

pub(super) fn parse_model_json<T>(value: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let trimmed = value.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .and_then(|rest| rest.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|rest| rest.strip_suffix("```"))
        })
        .map(str::trim)
        .unwrap_or(trimmed);
    let candidate = extract_first_json_value(without_fence).unwrap_or(without_fence);
    serde_json::from_str(candidate).map_err(|err| err.to_string())
}

pub(super) fn parse_integrate_edit_response(
    value: &str,
    job: &StoredAiJob,
    targets: &[TargetNoteContext],
) -> Result<IntegrateEditResponse, String> {
    let trimmed = value.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .and_then(|rest| rest.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|rest| rest.strip_suffix("```"))
        })
        .map(str::trim)
        .unwrap_or(trimmed);
    let candidate = extract_first_json_value(without_fence).unwrap_or(without_fence);
    let mut root: Value = serde_json::from_str(candidate).map_err(|err| err.to_string())?;

    let mut known_paths = HashMap::<String, (String, String)>::new();
    known_paths.insert(
        job.source.path.clone(),
        (job.source.content_hash.clone(), job.source.title.clone()),
    );
    for target in targets {
        known_paths.insert(
            target.path.clone(),
            (target.content_hash.clone(), target.title.clone()),
        );
    }

    if let Some(changes) = root.get_mut("changes").and_then(Value::as_array_mut) {
        for change in changes {
            let Some(object) = change.as_object_mut() else {
                continue;
            };
            let kind = object
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string);

            if kind == "updateNote" {
                if !object.contains_key("newMarkdown") {
                    if let Some(markdown) = object.remove("markdown") {
                        object.insert("newMarkdown".to_string(), markdown);
                    }
                }
                if let Some(path) = path.as_ref() {
                    if let Some((content_hash, title)) = known_paths.get(path) {
                        if !object.contains_key("baseContentHash") {
                            object.insert(
                                "baseContentHash".to_string(),
                                Value::String(content_hash.clone()),
                            );
                        }
                        if !object.contains_key("newTitle")
                            || object
                                .get("newTitle")
                                .and_then(Value::as_str)
                                .is_some_and(|value| value.trim().is_empty())
                        {
                            object.insert("newTitle".to_string(), Value::String(title.clone()));
                        }
                    }
                }
            } else if kind == "deleteNote" {
                if let Some(path) = path.as_ref() {
                    if let Some((content_hash, _)) = known_paths.get(path) {
                        if !object.contains_key("baseContentHash") {
                            object.insert(
                                "baseContentHash".to_string(),
                                Value::String(content_hash.clone()),
                            );
                        }
                    }
                }
            }
        }
    }

    serde_json::from_value(root).map_err(|err| err.to_string())
}

fn extract_first_json_value(value: &str) -> Option<&str> {
    let start = value.char_indices().find_map(|(index, ch)| match ch {
        '{' | '[' => Some((index, ch)),
        _ => None,
    })?;
    let (start_index, opening) = start;
    let closing = match opening {
        '{' => '}',
        '[' => ']',
        _ => return None,
    };

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in value[start_index..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' if opening == '{' => depth += 1,
            '[' if opening == '[' => depth += 1,
            ch if ch == closing => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end_index = start_index + index + ch.len_utf8();
                    return Some(value[start_index..end_index].trim());
                }
            }
            _ => {}
        }
    }

    None
}
