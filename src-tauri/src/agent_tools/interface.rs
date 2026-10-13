//! Compact model interface; operation owners retain evidence and proposal policy.
use super::*;
use crate::services::evidence::{query::ActivityRange, ReadRequest};

#[derive(Clone)]
pub(super) struct ReadNotesTool(pub(super) AgentToolContext);

#[derive(Deserialize)]
#[serde(tag = "purpose", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ReadNotesArgs {
    Answer {
        note_id: Option<String>,
        evidence_ids: Option<Vec<String>>,
        cursor: Option<String>,
        include_provenance: Option<bool>,
        activity_range: Option<ActivityRange>,
    },
    Edit {
        note_id: String,
        start_line: Option<usize>,
        max_chars: Option<usize>,
    },
}

fn variant_schema(mut schema: Value, tag: &str, variant: &str) -> Value {
    schema["properties"][tag] = json!({"type":"string","enum":[variant]});
    if schema.get("required").is_none() {
        schema["required"] = json!([]);
    }
    schema["required"].as_array_mut().unwrap().push(json!(tag));
    schema
}

fn tagged_object_schema(tag: &str, variants: Vec<(&str, Value)>) -> Value {
    // Compatible servers require root properties even when oneOf fully
    // describes the object. Expose the union while keeping each closed branch
    // authoritative. Shared arguments can have different constraints (e.g.
    // create allows empty markdown, while replace requires a nonempty body).
    let tags: Vec<_> = variants.iter().map(|(name, _)| *name).collect();
    let mut arguments = std::collections::BTreeMap::<String, Vec<Value>>::new();
    let variants: Vec<_> = variants
        .iter()
        .map(|(name, schema)| {
            for (argument, schema) in schema["properties"].as_object().unwrap() {
                let choices = arguments.entry(argument.clone()).or_default();
                if !choices.contains(schema) {
                    choices.push(schema.clone());
                }
            }
            variant_schema(schema.clone(), tag, name)
        })
        .collect();
    let mut properties: serde_json::Map<String, Value> = arguments
        .into_iter()
        .map(|(argument, mut choices)| {
            let schema = if choices.len() == 1 {
                choices.remove(0)
            } else {
                json!({"anyOf": choices})
            };
            (argument, schema)
        })
        .collect();
    properties.insert(tag.into(), json!({"type":"string","enum":tags}));
    json!({"type":"object","properties":properties,"required":[tag],"oneOf":variants,"additionalProperties":false})
}

fn require_capability(
    context: &AgentToolContext,
    capability: Capability,
) -> Result<(), AgentToolError> {
    if context.capabilities.contains(capability) {
        Ok(())
    } else {
        Err(AgentToolError::unavailable(
            "This operation is unavailable in the current scope",
        ))
    }
}

impl Tool for ReadNotesTool {
    const NAME: &'static str = "read_notes";
    type Error = AgentToolError;
    type Args = ReadNotesArgs;
    type Output = Value;

    fn description(&self) -> String {
        let mut description = String::new();
        if self.0.capabilities.contains(Capability::Evidence) {
            description.push_str("purpose=answer: Read evidence IDs or a known canonical note; continue with purpose and cursor only. Copy each returned sourceId into final segment sources; citation is its Markdown label. evidenceId and noteId are retrieval selectors, not citation IDs. The app builds links. activity_range assesses temporal support separately from meaning: qualify uncertainty; never attribute not_established passages or supporting context to that period. Resolve actor, event date, negation and status. coverage.complete applies to coverage.scope across pages. Only wholeNoteComplete establishes a complete current note in this read; nextReads supplies selectors when needed. Coverage excludes cleared history and discarded Editing Window states; it is not a complete real-world record.");
        }
        if self.0.capabilities.contains(Capability::WorkingNotes) {
            description.push_str(" purpose=edit: Read bounded working-copy pages for reviewed changes; lines are 1-based. pendingChanges is unapproved content, not answer evidence. Use returned contentHash when proposing changes.");
        }
        description.trim().into()
    }

    fn parameters(&self) -> Value {
        let mut variants = Vec::new();
        if self.0.capabilities.contains(Capability::Evidence) {
            variants.push(("answer", ReadEvidenceTool(self.0.clone()).parameters()));
        }
        if self.0.capabilities.contains(Capability::WorkingNotes) {
            variants.push(("edit", ReadNoteTool(self.0.clone()).parameters()));
        }
        tagged_object_schema("purpose", variants)
    }

    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Value, AgentToolError> {
        match args {
            ReadNotesArgs::Answer {
                note_id,
                evidence_ids,
                cursor,
                include_provenance,
                activity_range,
            } => {
                require_capability(&self.0, Capability::Evidence)?;
                ReadEvidenceTool(self.0.clone())
                    .call(
                        context,
                        ReadRequest {
                            note_id,
                            evidence_ids: evidence_ids.unwrap_or_default(),
                            cursor,
                            include_provenance,
                            activity_range,
                        },
                    )
                    .await
            }
            ReadNotesArgs::Edit {
                note_id,
                start_line,
                max_chars,
            } => {
                require_capability(&self.0, Capability::WorkingNotes)?;
                ReadNoteTool(self.0.clone())
                    .call(
                        context,
                        ReadArgs {
                            note_id,
                            start_line,
                            max_chars,
                        },
                    )
                    .await
            }
        }
    }
}

#[derive(Clone)]
pub(super) struct ProposeNoteChangeTool(pub(super) AgentToolContext);

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum NoteChangeArgs {
    Edit {
        note_id: String,
        expected_content_hash: String,
        edits: Vec<ProposedTextEdit>,
    },
    Replace {
        note_id: String,
        expected_content_hash: String,
        markdown: String,
    },
    Create {
        title: String,
        markdown: String,
    },
}

impl Tool for ProposeNoteChangeTool {
    const NAME: &'static str = "propose_note_change";
    type Error = AgentToolError;
    type Args = NoteChangeArgs;
    type Output = Value;

    fn description(&self) -> String {
        "Stage a reviewed change; the user must Keep before disk changes. operation=edit applies targeted edits to a surfaced note. replace supplies its complete body: first read every current purpose=edit page in this run, including pendingChanges; retain all desired content and omit managed frontmatter. Both fold pending content into the combined preview. create stages a uniquely named new note. Submit through this tool. Deadlines: @due(YYYY-MM-DD), Gregorian years 0001-9999, on the exact checkbox line. Preserve unrelated/child text; when changing/removing a deadline consolidate only supported valid annotations on that line. No stored slash commands, due times or reminders.".into()
    }

    fn parameters(&self) -> Value {
        tagged_object_schema(
            "operation",
            vec![
                ("edit", ProposeNoteEditsTool(self.0.clone()).parameters()),
                (
                    "replace",
                    ProposeNoteRewriteTool(self.0.clone()).parameters(),
                ),
                ("create", ProposeCreateNoteTool(self.0.clone()).parameters()),
            ],
        )
    }

    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Value, AgentToolError> {
        require_capability(&self.0, Capability::Proposals)?;
        match args {
            NoteChangeArgs::Edit {
                note_id,
                expected_content_hash,
                edits,
            } => {
                ProposeNoteEditsTool(self.0.clone())
                    .call(
                        context,
                        EditArgs {
                            note_id,
                            expected_content_hash,
                            edits,
                        },
                    )
                    .await
            }
            NoteChangeArgs::Replace {
                note_id,
                expected_content_hash,
                markdown,
            } => {
                ProposeNoteRewriteTool(self.0.clone())
                    .call(
                        context,
                        RewriteArgs {
                            note_id,
                            expected_content_hash,
                            markdown,
                        },
                    )
                    .await
            }
            NoteChangeArgs::Create { title, markdown } => {
                ProposeCreateNoteTool(self.0.clone())
                    .call(context, CreateArgs { title, markdown })
                    .await
            }
        }
    }
}
