//! Test-only isolated changes to the model-visible presentation. The production
//! tools, admission, executed lifecycle and source validation always run normally.
use super::*;
use rig_core::completion::{
    message::{AssistantContent, ToolResultContent, UserContent},
    CompletionRequest,
};

pub(super) const ORIGINAL_SCOPE: &str = "Source scope: Answer questions about what a named note records from that note; check its complete canonical content before calling a detail unrecorded. Broader factual questions may use concrete relevant unread leads. Finish with supported answers and stated unknowns.";
pub(super) const REVISED_SCOPE: &str = "Source scope: A named note is a starting point for factual questions. Search related notes for unresolved facts and attribute their answers. When asked what a named note records, check its complete canonical content before calling a detail unrecorded there. Finish when requested facts are supported or gaps are stated.";
pub(super) const COVERAGE_DESCRIPTION: &str = "Only wholeNoteComplete establishes a complete current note in this read; nextReads supplies selectors when needed. ";

#[derive(Clone)]
pub(super) enum PresentationAblation {
    Coverage,
    References(AgentToolContext),
    Scope(&'static str),
}
impl PresentationAblation {
    fn payload(&self, value: &mut Value) {
        match self {
            Self::Coverage => {
                if let Some(coverage) = value["coverage"].as_object_mut() {
                    coverage.remove("wholeNoteComplete");
                    coverage.remove("nextReads");
                }
            }
            Self::References(context) => expand_selectors(value, context),
            Self::Scope(rule_text) => {
                if let Some(rules) = value["interpretationGuidance"].as_array_mut() {
                    for rule in rules {
                        if rule
                            .as_str()
                            .is_some_and(|s| s.starts_with("Source scope: "))
                        {
                            *rule = json!(rule_text);
                        }
                    }
                }
            }
        }
    }
    pub(super) fn apply(&self, request: &mut CompletionRequest) {
        if matches!(self, Self::Coverage) {
            for tool in &mut request.tools {
                tool.description = tool.description.replace(COVERAGE_DESCRIPTION, "");
            }
        }
        for message in request.chat_history.iter_mut() {
            match message {
                rig_core::completion::Message::Assistant(
                    rig_core::completion::AssistantMessage { content, .. },
                ) => {
                    if let Self::References(context) = self {
                        for part in content.iter_mut() {
                            if let AssistantContent::ToolCall(call) = part {
                                let mut arguments =
                                    Value::Object(std::mem::take(&mut call.function.arguments));
                                expand_selectors(&mut arguments, context);
                                call.function.arguments = arguments.as_object().unwrap().clone();
                            }
                        }
                    }
                }
                rig_core::completion::Message::User { content } => {
                    for part in content.iter_mut() {
                        if let UserContent::ToolResult(result) = part {
                            for part in result.content.iter_mut() {
                                match part {
                                    ToolResultContent::Json { value } => self.payload(value),
                                    ToolResultContent::Text(text) => {
                                        if let Ok(mut value) =
                                            serde_json::from_str::<Value>(&text.text)
                                        {
                                            self.payload(&mut value);
                                            text.text = value.to_string();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
fn expand_selectors(value: &mut Value, context: &AgentToolContext) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if key == "evidenceId" {
                    if let Some(id) = value.as_str() {
                        // Unknown/mistyped arguments stay visible as errors, not guessed.
                        if let Ok(canonical) = context.resolve_evidence_ids(vec![id.into()]) {
                            *value = json!(canonical[0]);
                        }
                    }
                } else if key == "evidence_ids" || key == "remainingEvidenceIds" {
                    if let Some(ids) = value.as_array_mut() {
                        for id in ids {
                            if let Some(reference) = id.as_str() {
                                if let Ok(canonical) =
                                    context.resolve_evidence_ids(vec![reference.into()])
                                {
                                    *id = json!(canonical[0]);
                                }
                            }
                        }
                    }
                } else {
                    expand_selectors(value, context);
                }
            }
        }
        Value::Array(items) => items
            .iter_mut()
            .for_each(|item| expand_selectors(item, context)),
        _ => {}
    }
}

#[test]
fn canonical_reference_ablation_changes_only_selector_fields() {
    let (_vault, context, id) = fixture();
    let mut found = tauri::async_runtime::block_on(
        FindNotesTool(context.clone()).call(
            &mut ToolContext::new(),
            serde_json::from_value(json!({"mode":"literal","query":"first line","note_ids":[id]}))
                .unwrap(),
        ),
    )
    .unwrap();
    let reference = found["items"][0]["evidenceId"].clone();
    let canonical = context
        .resolve_evidence_ids(vec![reference.as_str().unwrap().into()])
        .unwrap()
        .remove(0);
    let before = found.clone();
    expand_selectors(&mut found, &context);
    let mut expected = before;
    for item in expected["items"].as_array_mut().unwrap() {
        item["evidenceId"] = json!(
            context
                .resolve_evidence_ids(vec![item["evidenceId"].as_str().unwrap().into()])
                .unwrap()[0]
        );
    }
    assert_eq!(found, expected);
    let mut args = json!({"evidence_ids":[reference.clone(),reference.clone(),"Eunknown"],"excerpt":reference,"note_id":id,"citation":"[S1]"});
    let mut expected = args.clone();
    expected["evidence_ids"] = json!([canonical, canonical, "Eunknown"]);
    expand_selectors(&mut args, &context);
    assert_eq!(args, expected);
    assert!(context.sources().is_empty());
}
