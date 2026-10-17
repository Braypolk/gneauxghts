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
        assert_eq!(wire_effort(None, Some("none")), None);
        let meta = from_models(&models(json!(["off", "on"]), "off"), "custom-model").unwrap();
        assert_eq!(meta.options, ["off"]);
        assert_eq!(wire_effort(Some(&meta), Some("on")), Some("none"));
    }
}
