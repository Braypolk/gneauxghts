use super::*;
use crate::services::evidence::{query::ActivityRange, SearchMode, SearchRequest};

#[derive(Clone)]
pub(super) struct SearchEvidenceTool(pub(super) AgentToolContext);
#[derive(Clone)]
pub(super) struct ReadEvidenceTool(pub(super) AgentToolContext);
#[derive(Clone)]
pub(super) struct ListNoteActivityTool(pub(super) AgentToolContext);
type ReadEvidenceArgs = crate::services::evidence::ReadRequest;

impl AgentToolContext {
    pub(crate) fn query_anchor_label(&self) -> String {
        self.evidence
            .lock()
            .map(|e| e.anchor.label())
            .unwrap_or_else(|_| "Unavailable".into())
    }
    pub(super) fn admit_passages(
        &self,
        sources: Vec<(crate::services::evidence::PassageCitation, PathBuf, String)>,
    ) -> Result<(), String> {
        let mut target = self.sources.lock().map_err(|_| "Sources unavailable")?;
        for (citation, path, title) in sources {
            self.surface(&citation.note_id);
            crate::chat::citations::admit_passage(
                &mut target,
                citation,
                relative_path(self.service.notes_root(), &path),
                title,
            );
        }
        Ok(())
    }
    /// Called only on read results after their exact sources have been admitted.
    pub(super) fn prepare_passage_references(&self, payload: &mut Value) -> Result<(), String> {
        let sources = self.sources.lock().map_err(|_| "Sources unavailable")?;
        let mut references = self
            .passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?;
        references.prepare(payload, &sources)
    }

    pub(crate) fn render_passage_references(&self, text: &str) -> Result<String, String> {
        let sources = self.sources(); // Reapply current exclusions, scope and canonical validation.
        let references = self
            .passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?;
        Ok(references.render(text, &sources))
    }

    pub(super) fn admit_context(&self, text: &str, max: usize) -> Result<String, AgentToolError> {
        self.evidence
            .lock()
            .map_err(|_| AgentToolError::unavailable("Evidence unavailable"))?
            .admit_context(text, max)
            .map_err(AgentToolError::from)
    }

    pub(crate) fn evidence_scope(
        &self,
    ) -> Result<(Option<HashSet<String>>, HashSet<String>), String> {
        let allowed = super::current_history::allowed_note_ids(
            &self.access,
            &self.service.granted_note_ids()?,
            &self.run_grants,
        );
        let allowed = match &self.worker_scope {
            Some(scope) => Some(
                scope
                    .iter()
                    .filter(|id| allowed.as_ref().is_none_or(|ids| ids.contains(*id)))
                    .cloned()
                    .collect(),
            ),
            None => allowed,
        };
        Ok((allowed, self.service.excluded_note_ids()?))
    }
    pub(crate) fn validate_context(&self) -> Result<(), String> {
        let (allowed, excluded) = self.evidence_scope()?;
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or("Notes index unavailable")?;
        if !self
            .evidence
            .lock()
            .map_err(|_| "Evidence unavailable")?
            .is_current(&state, allowed.as_ref(), &excluded)
        {
            return Err(
                "Current note evidence changed during this answer. Search again to verify it."
                    .into(),
            );
        }
        let versions = self
            .context_versions
            .lock()
            .map_err(|_| "Context unavailable")?;
        for (id, expected) in versions.iter() {
            if !self.allowed(id).map_err(|e| e.to_string())? {
                return Err("Note access changed during this answer".into());
            }
            let (path, _, _) = self.resolve_note(id).map_err(|e| e.to_string())?;
            let raw = fs::read(path).map_err(|_| "Current note unavailable")?;
            if blake3::hash(&raw).to_hex().as_str() != expected {
                return Err("Note context changed; retry for current evidence".into());
            }
        }
        Ok(())
    }
}
/// Tool-facing inputs deliberately exclude internal numeric bounds and workflow
/// interpretations. Search and research share the same explicit range contract.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct SearchArgs {
    query: String,
    include_history: bool,
    mode: SearchMode,
    activity_range: Option<ActivityRange>,
    note_ids: Option<Vec<String>>,
    folder: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}
impl SearchArgs {
    fn schema(require_range: bool) -> Value {
        let mut schema = json!({"type":"object","properties":{
            "query":{"type":"string","description":"Content to match. Historical filters match changed text, not note titles. Omit to discover all activity in activity_range, then narrow by returned noteId metadata."},
            "include_history":{"type":"boolean","description":"For activity questions, include retained added/removed lines, even when superseded. Requires activity_range. Historical content is not current status. With query, use literal or regex mode."},
            "mode":{"type":"string","enum":["hybrid","lexical","literal","regex"]},
            "activity_range":ActivityRange::schema(),
            "folder":{"type":"string"},"note_ids":{"type":"array","items":{"type":"string"}},
            "cursor":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":20}
        },"additionalProperties":false});
        if require_range {
            schema["anyOf"] = json!([{"required":["activity_range"]},{"required":["cursor"]}]);
        }
        schema
    }
    fn into_request(self) -> Result<SearchRequest, AgentToolError> {
        if self.limit.is_some_and(|limit| !(1..=20).contains(&limit)) {
            return Err(AgentToolError::invalid("limit must be between 1 and 20"));
        }
        Ok(SearchRequest {
            query: self.query,
            include_history: self.include_history,
            mode: self.mode,
            activity_range: self.activity_range,
            note_ids: self.note_ids,
            folder: self.folder,
            cursor: self.cursor,
            limit: self.limit,
            ..Default::default()
        })
    }
}
impl Tool for SearchEvidenceTool {
    const NAME: &'static str = "search_evidence";
    type Error = AgentToolError;
    type Args = SearchArgs;
    type Output = Value;
    fn description(&self) -> String {
        "Find allowed current passages by content and optional explicit activity range. Returns bounded previews, evidence IDs, task facts, coverage and continuation; read selected IDs with read_evidence before citing. Activity filters date surviving text changes, not real-world events or deadlines. Omit the activity filter when those changes are not the question. Combine with other searches and tools as needed. Set include_history with an activity_range to discover retained added/removed lines, including superseded text. Continue with cursor only.".into()
    }
    fn parameters(&self) -> Value {
        SearchArgs::schema(false)
    }
    async fn call(&self, _: &mut ToolContext, args: SearchArgs) -> Result<Value, AgentToolError> {
        search(self.0.clone(), args, false).await
    }
}
impl Tool for ListNoteActivityTool {
    const NAME: &'static str = "list_note_activity";
    type Error = AgentToolError;
    type Args = SearchArgs;
    type Output = Value;
    fn description(&self) -> String {
        "Discover distinct allowed notes with surviving recorded changes in an explicit activity_range, optionally matching content or scope. Returns one representative evidence ID and preview per note, per-page counts, coverage and continuation. These are intermediate results: read selected evidence IDs, search related content or tasks, and continue working. Counts describe notes with surviving text activity, not completed work. Read evidence before citing; use search_evidence for additional passages within a note. Set include_history for retained changes. Continue with cursor only. This is note discovery, not all changed passages; search each relevant scope with the range to retrieve additional changes.".into()
    }
    fn parameters(&self) -> Value {
        SearchArgs::schema(true)
    }
    async fn call(&self, _: &mut ToolContext, args: SearchArgs) -> Result<Value, AgentToolError> {
        if args.activity_range.is_none() && args.cursor.is_none() {
            return Err(AgentToolError::invalid(
                "list_note_activity requires an explicit activity_range",
            ));
        }
        search(self.0.clone(), args, true).await
    }
}
fn apply_research_scope(
    request: &mut SearchRequest,
    scope: &SearchRequest,
) -> Result<(), AgentToolError> {
    if scope
        .after
        .is_some_and(|lower| request.after.is_some_and(|v| v < lower))
        || scope
            .before
            .is_some_and(|upper| request.before.is_some_and(|v| v > upper))
    {
        return Err(AgentToolError::invalid(
            "Research query exceeds its inherited activity range",
        ));
    }
    request.include_history |= scope.include_history;
    request.after = request.after.or(scope.after);
    request.before = request.before.or(scope.before);
    request.range_timezone = request
        .range_timezone
        .clone()
        .or_else(|| scope.range_timezone.clone());
    // evidence_scope already intersects the parent's allowed IDs. A child may
    // further narrow its folder or IDs, but never expand that underlying scope.
    request.folder = request.folder.clone().or_else(|| scope.folder.clone());
    Ok(())
}

fn apply_research_read_scope(
    args: &mut crate::services::evidence::ReadRequest,
    scope: Option<&SearchRequest>,
    evidence: &crate::services::evidence::EvidenceSession,
) -> Result<(), AgentToolError> {
    let Some(scope) = scope else {
        return Ok(());
    };
    // A continuation already owns the validated options of its first read.
    if args.cursor.is_some() {
        return Ok(());
    }
    args.activity_range = args
        .activity_range
        .clone()
        .or_else(|| scope.activity_range.clone());
    let mut bounds = SearchRequest {
        activity_range: args.activity_range.clone(),
        ..Default::default()
    };
    evidence.normalize_request(&mut bounds)?;
    apply_research_scope(&mut bounds, scope)
}

async fn search(
    context: AgentToolContext,
    args: SearchArgs,
    distinct_notes: bool,
) -> Result<Value, AgentToolError> {
    let mut request = if let Some(cursor) = args.cursor.as_deref() {
        if !args.query.is_empty()
            || args.activity_range.is_some()
            || args.note_ids.is_some()
            || args.folder.is_some()
            || args.include_history
            || args.limit.is_some()
            || args.mode != SearchMode::Hybrid
        {
            return Err(AgentToolError::invalid(
                "Continue with cursor only; the backend retains all filters",
            ));
        }
        context
            .evidence
            .lock()
            .map_err(|_| AgentToolError::unavailable("Evidence unavailable"))?
            .resume_search(cursor, distinct_notes)
            .map_err(AgentToolError::from)?
    } else {
        args.clone().into_request().map_err(AgentToolError::from)?
    };
    request.cancelled = context
        .cancellation
        .lock()
        .map_err(|_| AgentToolError::unavailable("Cancellation unavailable"))?
        .clone();
    context.activity(if request.activity_range.is_some() {
        "Checking note activity"
    } else {
        "Searching notes"
    });
    context
        .service
        .mark_current_history_use(&context.assistant_message_id, &context.run_id)
        .map_err(AgentToolError::from)?;
    run_blocking_tool(move || {
        context.check_cancelled()?;
        let (allowed, excluded) = context.evidence_scope()?;
        let state = context
            .app
            .try_state::<AppState>()
            .ok_or("Notes index unavailable")?;
        let submitted_range = request.activity_range.clone();
        let mut resolved = context
            .evidence
            .lock()
            .map_err(|_| "Evidence unavailable")?
            .normalize_request(&mut request)?;
        if let Some(scope) = &context.worker_period {
            apply_research_scope(&mut request, scope)?;
        }
        if resolved.is_none() {
            resolved = request.after.zip(request.before).map(|(after, before)| {
                crate::services::evidence::query::ResolvedPeriod {
                    after,
                    before,
                    timezone: request
                        .range_timezone
                        .clone()
                        .unwrap_or_else(|| "UTC".into()),
                    label: "Inherited activity range".into(),
                }
            });
        }
        let mut result = {
            let mut evidence = context
                .evidence
                .lock()
                .map_err(|_| "Evidence unavailable")?;
            let mut saved_request = request.clone();
            // Preserve the original explicit range so continuation resolves to
            // the same label and inventory signature as the initial call.
            if let Some(range) = &submitted_range {
                saved_request.activity_range = Some(range.clone());
                saved_request.after = None;
                saved_request.before = None;
            }
            let result = if distinct_notes {
                let period = resolved.clone().or_else(|| {
                    Some(crate::services::evidence::query::ResolvedPeriod {
                        after: request.after?,
                        before: request.before?,
                        timezone: request.range_timezone.clone().unwrap_or_default(),
                        label: "Continued activity range".into(),
                    })
                });
                evidence.activity_page(
                    &state,
                    allowed.as_ref(),
                    &excluded,
                    request,
                    period.ok_or("Activity range is required")?,
                )?
            } else {
                evidence.search(&state, allowed.as_ref(), &excluded, request)?
            };
            evidence.remember_search(&result, saved_request, distinct_notes);
            result
        };
        if let Some(period) = &resolved {
            result["resolvedRange"] = serde_json::to_value(period).map_err(|e| e.to_string())?;
        }
        context.check_cancelled()?;
        if (allowed, excluded) != context.evidence_scope()? {
            return Err(AgentToolError::stale("Note policy changed; search again"));
        }
        if let Some(items) = result["items"].as_array() {
            for item in items {
                if let Some(id) = item["noteId"].as_str() {
                    context.surface(id);
                }
            }
        }
        let primary = !context.research_only
            && resolved.is_some()
            && !context.primary_query_recorded.swap(true, Ordering::SeqCst);
        let capability = if distinct_notes {
            "list_note_activity"
        } else {
            "search_evidence"
        };
        context.emit_agent_event(AgentEvent::QueryResolved {
            details: json!({
                "primary": primary,
                "worker": context.research_only,
                "capability": capability,
                "submitted": args,
                "resolved": resolved,
                "continuation": result["nextCursor"],
                "result": {
                    "itemsReturned": result["items"].as_array().map_or(0, Vec::len),
                    "notesReturned": result["notesReturned"],
                    "pageOffset": result["pageOffset"],
                    "coverageComplete": result["coverage"]["complete"]
                }
            }),
        });
        Ok(result)
    })
    .await
}

impl Tool for ReadEvidenceTool {
    const NAME: &'static str = "read_evidence";
    type Error = AgentToolError;
    type Args = ReadEvidenceArgs;
    type Output = Value;
    fn description(&self) -> String {
        "Read selected evidence IDs or a known canonical note; continue with cursor only. Returns exact passages, sourceKind, citations, provenance, and explicit delivery gaps. Pass activity_range to check whether each selected changed passage supports that interval; supported/uncertain/not_established describe temporal support, not semantic truth or accomplishment. Historical excerpts describe recorded added/removed lines, never current status; read the current note or related evidence before recommending actions. Unchanged surrounding context is not activity. Cite only returned references. Prior assistant answers and working copies are not primary evidence. Read failures include recovery actions; missing completion evidence means unknown, not definitely open.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{
            "cursor":{"type":"string","description":"Continue a previous read using only this handle."},
            "note_id":{"type":"string","description":"Read a known canonical note, including bounded pages of current content. Does not read pending proposals."},
            "include_provenance":{"type":"boolean","description":"Expand per-range lineage when inspecting provenance; defaults to false. Canonical validation, historical timing and activitySupport are always returned without expansion."},
            "activity_range":ActivityRange::schema(),
            "evidence_ids":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string"}}},
            "oneOf":[{"required":["evidence_ids"]},{"required":["note_id"]},{"required":["cursor"]}],"additionalProperties":false})
    }
    async fn call(
        &self,
        _: &mut ToolContext,
        args: ReadEvidenceArgs,
    ) -> Result<Value, AgentToolError> {
        if args.note_id.is_some()
            && self
                .0
                .worker_period
                .as_ref()
                .is_some_and(|scope| scope.after.is_some() || scope.before.is_some())
        {
            return Err(AgentToolError::invalid("A period-scoped research worker must read its discovered change evidence. The parent can read the canonical note separately to check current status."));
        }
        self.0.activity("Reading selected passages");
        let context = self.0.clone();
        run_blocking_tool(move || {
            context.check_cancelled()?;
            let (allowed, excluded) = context.evidence_scope()?;
            let state = context
                .app
                .try_state::<AppState>()
                .ok_or("Notes index unavailable")?;
            let (mut payload, sources) = {
                let mut evidence = context
                    .evidence
                    .lock()
                    .map_err(|_| "Evidence unavailable")?;
                let mut args = args;
                apply_research_read_scope(&mut args, context.worker_period.as_ref(), &evidence)?;
                evidence.read_request(&state, allowed.as_ref(), &excluded, args)?
            };
            context.check_cancelled()?;
            if (allowed, excluded) != context.evidence_scope()? {
                return Err(AgentToolError::stale("Note policy changed; search again"));
            }
            context.admit_passages(sources)?;
            context.prepare_passage_references(&mut payload)?;
            Ok(payload)
        })
        .await
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;
    #[test]
    fn worker_reads_inherit_the_range_and_cannot_widen_it_or_reset_continuations() {
        let evidence = crate::services::evidence::EvidenceSession::default();
        let range = ActivityRange {
            start: "2026-09-21".into(),
            end: "2026-09-28".into(),
            timezone: Some("UTC".into()),
        };
        let mut scope = SearchRequest {
            activity_range: Some(range.clone()),
            ..Default::default()
        };
        evidence.normalize_request(&mut scope).unwrap();
        scope.activity_range = Some(range);
        let mut read = crate::services::evidence::ReadRequest {
            evidence_ids: vec!["discovered".into()],
            ..Default::default()
        };
        apply_research_read_scope(&mut read, Some(&scope), &evidence).unwrap();
        assert_eq!(read.activity_range.as_ref().unwrap().start, "2026-09-21");
        assert_eq!(read.activity_range.as_ref().unwrap().end, "2026-09-28");
        read.activity_range.as_mut().unwrap().start = "2026-09-20".into();
        assert!(apply_research_read_scope(&mut read, Some(&scope), &evidence).is_err());
        read.activity_range.as_mut().unwrap().start = "2026-09-22".into();
        apply_research_read_scope(&mut read, Some(&scope), &evidence).unwrap();
        let mut continuation = crate::services::evidence::ReadRequest {
            cursor: Some("issued-cursor".into()),
            ..Default::default()
        };
        apply_research_read_scope(&mut continuation, Some(&scope), &evidence).unwrap();
        assert!(
            continuation.activity_range.is_none(),
            "Cursor owns its previously validated options"
        );
        let mut parent_read = crate::services::evidence::ReadRequest::default();
        apply_research_read_scope(&mut parent_read, None, &evidence).unwrap();
        assert!(
            parent_read.activity_range.is_none(),
            "Parent queries remain independently configurable"
        );
    }
    #[test]
    fn research_can_narrow_but_never_widen_inherited_filters() {
        let scope = SearchRequest {
            after: Some(100),
            before: Some(200),
            folder: Some("projects".into()),
            range_timezone: Some("UTC".into()),
            ..Default::default()
        };
        let mut inherited = SearchRequest::default();
        apply_research_scope(&mut inherited, &scope).unwrap();
        assert_eq!((inherited.after, inherited.before), (Some(100), Some(200)));
        assert_eq!(inherited.range_timezone.as_deref(), Some("UTC"));
        let mut narrow = SearchRequest {
            after: Some(120),
            before: Some(150),
            folder: Some("projects/client".into()),
            ..Default::default()
        };
        apply_research_scope(&mut narrow, &scope).unwrap();
        assert_eq!((narrow.after, narrow.before), (Some(120), Some(150)));
        assert_eq!(narrow.folder.as_deref(), Some("projects/client"));
        for (after, before) in [(99, 150), (120, 201)] {
            let mut wide = SearchRequest {
                after: Some(after),
                before: Some(before),
                ..Default::default()
            };
            assert!(apply_research_scope(&mut wide, &scope).is_err());
        }
    }
    #[test]
    fn search_inputs_allow_independent_configuration_and_reject_workflow_shortcuts() {
        let args: SearchArgs = serde_json::from_value(json!({
            "query":"approval", "mode":"literal", "note_ids":["n"],
            "activity_range":{"start":"2025-02-13","end":"2026-08-19","timezone":"UTC"}
        }))
        .unwrap();
        let request = args.into_request().unwrap();
        assert_eq!(request.query, "approval");
        assert_eq!(request.note_ids.unwrap(), vec!["n"]);
        assert!(request.activity_range.is_some());
        for rejected in [
            json!({"period":"this_week"}),
            json!({"interpretation":{}}),
            json!({"after":123,"before":456}),
        ] {
            assert!(serde_json::from_value::<SearchArgs>(rejected).is_err());
        }
        let invalid: SearchArgs = serde_json::from_value(json!({"query":"a","limit":0})).unwrap();
        assert!(invalid.into_request().is_err());
    }
}
