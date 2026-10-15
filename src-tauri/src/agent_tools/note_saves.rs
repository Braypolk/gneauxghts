//! Promotion and refinement share ChatService's versioned proposal boundary.
use super::*;

pub(super) fn draft_schema() -> Value {
    json!({"type":"object","properties":{"proposal_id":{"type":["string","null"]},"start_line":{"type":["integer","null"],"minimum":1},"max_chars":{"type":["integer","null"],"minimum":1,"maximum":6000}},"additionalProperties":false})
}
pub(super) fn chat_schema() -> Value {
    json!({"type":"object","properties":{"message_id":{"type":["string","null"]}},"additionalProperties":false})
}
pub(super) fn save_schema() -> Value {
    json!({"type":"object","properties":{
      "message_id":{"type":["string","null"]},"target_note_id":{"type":["string","null"]},
      "heading":{"type":["string","null"]},"title":{"type":["string","null"]},"path":{"type":["string","null"]},
      "selection":{"anyOf":[{"type":"null"},{"type":"object","properties":{"text":{"type":"string"},"markdown":{"type":"string"},"occurrence":{"type":["integer","null"],"minimum":0}},"required":["text","markdown"],"additionalProperties":false}]}
    },"additionalProperties":false})
}
pub(super) fn refine_schema(context: &AgentToolContext) -> Value {
    json!({"type":"object","properties":{"proposal_id":{"type":"string"},"expected_version":{"type":"integer","minimum":0},"markdown":{"type":["string","null"]},"edits":{"anyOf":[{"type":"null"},ProposeNoteEditsTool(context.clone()).parameters()["properties"]["edits"].clone()]}},"required":["proposal_id","expected_version"],"additionalProperties":false})
}

// Only owner-authored validation messages are safe model feedback. Storage and
// dependency diagnostics keep the shared redaction contract.
fn promotion_error(message: String) -> AgentToolError {
    match message.as_str() {
        "The destination heading is missing or ambiguous; specify a unique heading." => {
            AgentToolError::invalid(
                "The destination heading is missing or ambiguous; specify a unique heading.",
            )
        }
        "Choose a completed assistant answer." => {
            AgentToolError::invalid("Choose a completed assistant answer.")
        }
        "That destination is not allowed." => {
            AgentToolError::invalid("That destination is not allowed.")
        }
        "The destination note is unavailable." => {
            AgentToolError::unavailable("The destination note is unavailable.")
        }
        "The draft changed during generation. Read its latest version before refining."
        | "The draft changed; read it again." => AgentToolError::stale(
            "The draft changed during generation. Read its latest version before refining.",
        ),
        "That review is already resolved." => {
            AgentToolError::invalid("That review is already resolved.")
        }
        "The selection formatting does not match its text. Select the passage again." => {
            AgentToolError::invalid(
                "The selection formatting does not match its text. Select the passage again.",
            )
        }
        "Select a unique contiguous passage from the completed answer." => {
            AgentToolError::invalid("Select a unique contiguous passage from the completed answer.")
        }
        "The selected occurrence no longer belongs to this answer." => {
            AgentToolError::invalid("The selected occurrence no longer belongs to this answer.")
        }
        _ => AgentToolError::from(message),
    }
}

impl AgentToolContext {
    fn editable_draft(
        &self,
        id: &str,
    ) -> Result<crate::chat::note_proposals::ProposalDraft, AgentToolError> {
        let proposal = self.service.get_agent_proposal(id)?;
        if proposal.conversation_id != self.conversation_id || self.access == VaultAccess::None {
            return Err(AgentToolError::invalid(
                "That draft is unavailable in this chat",
            ));
        }
        if let Some(note) = proposal.note_id.as_deref() {
            if !self.allowed(note)? {
                return Err(AgentToolError::invalid("Destination access was revoked."));
            }
        }
        self.service.proposal_draft(id).map_err(promotion_error)
    }
    pub(super) fn read_draft(
        &self,
        id: Option<String>,
        start_line: Option<usize>,
        max_chars: Option<usize>,
    ) -> Result<Value, AgentToolError> {
        self.check_cancelled()?;
        let Some(id) = id else {
            let pending = self
                .service
                .list_pending_agent_proposals(&self.conversation_id)?;
            let start = start_line.unwrap_or(1).max(1) - 1;
            let total = pending.len();
            return Ok(
                json!({"startLine":start+1,"nextStartLine":(start+20<total).then_some(start+21),"pendingDrafts":pending.into_iter().skip(start).take(20).map(|p|json!({"proposalId":p.id,"title":p.title,"kind":p.kind})).collect::<Vec<_>>() }),
            );
        };
        let draft = self.editable_draft(&id)?;
        let lines = draft.markdown.lines().collect::<Vec<_>>();
        let start = start_line.unwrap_or(1).max(1);
        let limit = max_chars.unwrap_or(3000).clamp(1, 6000);
        let mut content = String::new();
        let mut end = start - 1;
        for (i, line) in lines.iter().enumerate().skip(start - 1) {
            if line.chars().count() > limit {
                return Err(AgentToolError::invalid(
                    "This draft line exceeds the editing page size.",
                ));
            }
            if content.chars().count() + line.chars().count() + 1 > limit && !content.is_empty() {
                break;
            }
            if !content.is_empty() {
                content.push('\n');
            }
            content.push_str(line);
            end = i + 1;
        }
        let hash = content_hash(&draft.markdown);
        self.record_read(&format!("proposal:{id}"), &hash, start, end, lines.len());
        Ok(
            json!({"status":"ready","proposalId":id,"version":draft.version,"title":draft.title,"path":draft.path,"content":content,"contentHash":hash,"startLine":start,"endLine":end,"hasMore":end<lines.len(),"pendingChanges":true,"evidenceMeaning":"Unapproved working content for explicit refinement, not authoritative note evidence."}),
        )
    }
    pub(super) fn read_chat_answer(&self, id: Option<String>) -> Result<Value, AgentToolError> {
        self.check_cancelled()?;
        let conversation = self.service.get_conversation(&self.conversation_id)?;
        let answer = conversation
            .messages
            .iter()
            .rev()
            .find(|m| {
                m.role == "assistant"
                    && m.status == "complete"
                    && id.as_ref().is_none_or(|id| id == &m.id)
            })
            .ok_or_else(|| AgentToolError::invalid("Choose a completed answer in this chat."))?;
        Ok(
            json!({"messageId":answer.id,"markdown":answer.content,"meaning":"Authored chat content for faithful transfer only; old note claims and citations are not current evidence."}),
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn save_chat_answer(
        &self,
        id: Option<String>,
        selection: Option<crate::chat::note_proposals::SaveSelection>,
        target: Option<String>,
        heading: Option<String>,
        title: Option<String>,
        path: Option<String>,
    ) -> Result<Value, AgentToolError> {
        self.check_cancelled()?;
        if let Some(target) = target.as_deref() {
            if !self.allowed(target)? {
                return Err(AgentToolError::invalid("That destination is not allowed."));
            }
        }
        let conversation = self.service.get_conversation(&self.conversation_id)?;
        let id = id
            .or_else(|| {
                conversation
                    .messages
                    .iter()
                    .rev()
                    .find(|m| m.role == "assistant" && m.status == "complete")
                    .map(|m| m.id.clone())
            })
            .ok_or_else(|| AgentToolError::invalid("Choose a completed answer in this chat."))?;
        let proposal = self
            .service
            .prepare_note_save_target(
                &self.conversation_id,
                &id,
                None,
                selection.as_ref(),
                target.as_deref(),
                heading.as_deref(),
                title.as_deref(),
                path.as_deref(),
            )
            .map_err(promotion_error)?;
        if proposal.status == "committed" {
            return Ok(
                json!({"status":"already_saved","proposalId":proposal.id,"noteId":proposal.payload["committedNoteId"]}),
            );
        }
        let proposal = self
            .service
            .mark_requested_review(&proposal.id, &self.run_id)?;
        self.emit_proposal(&proposal);
        Ok(json!({"status":"pending_review","proposalId":proposal.id,"title":proposal.title}))
    }
    pub(super) fn refine_chat_draft(
        &self,
        id: String,
        version: i64,
        markdown: Option<String>,
        edits: Option<Vec<ProposedTextEdit>>,
    ) -> Result<Value, AgentToolError> {
        self.check_cancelled()?;
        let draft = self.editable_draft(&id)?;
        if draft.version != version {
            return Err(AgentToolError::stale(
                "The draft changed during generation. Read its latest version before refining.",
            ));
        }
        let revised = match (markdown, edits) {
            (Some(body), None) => {
                let coverage = self
                    .read_coverage
                    .lock()
                    .map_err(|_| AgentToolError::internal("Read coverage lock poisoned"))?;
                if !coverage
                    .get(&format!("proposal:{id}"))
                    .is_some_and(|c| c.complete_for(&content_hash(&draft.markdown)))
                {
                    return Err(AgentToolError::invalid(
                        "Read every current draft page before supplying its complete body.",
                    ));
                }
                body
            }
            (None, Some(edits)) => {
                let coverage = self
                    .read_coverage
                    .lock()
                    .map_err(|_| AgentToolError::internal("Read coverage lock poisoned"))?;
                if !coverage
                    .get(&format!("proposal:{id}"))
                    .is_some_and(|c| c.content_hash == content_hash(&draft.markdown))
                {
                    return Err(AgentToolError::invalid(
                        "Read the current draft before refining it.",
                    ));
                }
                crate::proposals::apply_proposed_text_edits(&draft.markdown, &edits)?
            }
            _ => {
                return Err(AgentToolError::invalid(
                    "Supply targeted edits or one complete draft body.",
                ))
            }
        };
        let proposal = self
            .service
            .refine_proposal_draft(&id, version, &revised, &self.run_id)
            .map_err(promotion_error)?;
        self.emit_proposal(&proposal);
        Ok(
            json!({"status":"pending_review","proposalId":id,"title":proposal.title,"version":version+1}),
        )
    }
}
