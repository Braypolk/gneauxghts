use super::*;
use crate::services::evidence::{query::ActivityRange, SearchMode, SearchRequest};

#[derive(Clone)]
pub(super) struct ReadEvidenceTool(pub(super) AgentToolContext);
#[derive(Clone)]
pub(super) struct FindNotesTool(pub(super) AgentToolContext);

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum FindResult {
    #[default]
    Passages,
    Notes,
}

type ReadEvidenceArgs = crate::services::evidence::ReadRequest;

impl AgentToolContext {
    pub(crate) fn query_anchor_label(&self) -> String {
        let mut label = self
            .evidence
            .lock()
            .map(|e| e.anchor.label())
            .unwrap_or_else(|_| "Unavailable".into());
        if let Some(context) = &self.date_time_context {
            label.push_str(&context.prompt_context());
        }
        label.push_str("\n");
        label.push_str(crate::chat::date_time::REFERENCE_GUIDANCE);
        label
    }
    pub(super) fn admit_passages(
        &self,
        sources: Vec<(crate::services::evidence::PassageCitation, PathBuf, String)>,
    ) -> Result<(), String> {
        // Remember evidence use before later exclusions can remove its source cards.
        if !sources.is_empty() {
            self.service
                .mark_current_history_use(&self.assistant_message_id, &self.run_id)?;
        }
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
        references.prepare(payload, &sources)?;
        let delivered: Vec<_> = payload["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                sources
                    .iter()
                    .filter_map(|source| source.passage.as_ref())
                    .find(|passage| item["evidenceId"].as_str() == Some(passage.id.as_str()))
                    .cloned()
            })
            .collect();
        drop(references);
        drop(sources);
        self.evidence
            .lock()
            .map_err(|_| "Evidence unavailable")?
            .record_delivery(&delivered);
        self.prepare_evidence_references(payload)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn render_passage_references(&self, text: &str) -> Result<String, String> {
        let sources = self.sources(); // Reapply current exclusions, scope and canonical validation.
        let references = self
            .passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?;
        Ok(references.render(text, &sources))
    }

    pub(crate) fn render_structured_answer(
        &self,
        text: &str,
    ) -> Result<(String, Vec<ChatSource>), String> {
        let sources = self.sources();
        let references = self
            .passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?;
        crate::chat::structured_answer::render(text, &references, &sources)
    }

    pub(super) fn admit_context(&self, text: &str, max: usize) -> Result<String, AgentToolError> {
        self.evidence
            .lock()
            .map_err(|_| AgentToolError::unavailable("Evidence unavailable"))?
            .admit_context(text, max)
            .map_err(AgentToolError::from)
    }

    pub(super) fn context_coverage(
        &self,
        note_id: &str,
        scope: &str,
        complete: bool,
    ) -> Result<String, AgentToolError> {
        let mut coverage = json!({"scope":scope,"complete":complete});
        if !complete {
            coverage["nextRead"] = json!({"purpose":"answer","note_id":note_id});
        }
        let metadata = format!("coverage: {}\n", coverage);
        if self.admit_context(&metadata, metadata.len())?.len() != metadata.len() {
            return Err(AgentToolError::evidence_budget());
        }
        Ok(metadata)
    }

    pub(super) fn record_body_context(
        &self,
        note_id: &str,
        raw: &str,
        excerpt: &str,
        start: Option<usize>,
    ) -> Result<(), AgentToolError> {
        self.evidence
            .lock()
            .map_err(|_| AgentToolError::unavailable("Evidence unavailable"))?
            .record_body_context(note_id, raw, excerpt, start);
        Ok(())
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
        self.validate_note_references(allowed.as_ref(), &excluded)?;
        let state = self.host.state().ok_or("Notes index unavailable")?;
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
            if excluded.contains(id) || allowed.as_ref().is_some_and(|ids| !ids.contains(id)) {
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
    result: Option<FindResult>,
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
    fn schema() -> Value {
        json!({"type":"object","properties":{
            "query":{"type":"string","description":"Match content; history matches changed text, not titles. Omit for all activity, then narrow by returned noteId."},
            "include_history":{"type":"boolean","description":"Include retained added/removed, even superseded lines. Requires activity_range; not current status. With query use literal/regex."},
            "mode":{"type":"string","enum":["hybrid","lexical","literal","regex"]},
            "activity_range":ActivityRange::schema(),
            "folder":{"type":"string"},"note_ids":{"type":"array","items":{"type":"string"}},
            "cursor":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":20}
        },"additionalProperties":false})
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
impl Tool for FindNotesTool {
    const NAME: &'static str = "find_notes";
    type Error = AgentToolError;
    type Args = SearchArgs;
    type Output = Value;
    fn description(&self) -> String {
        "Discover passages by topic/text; result=notes returns one representative passage per note and requires activity_range. Previews are not citable; reuse prior reads or read_notes purpose=answer. alreadyRead is prior text overlap, not provenance. Use returned IDs/folders, never topics as folders. For recorded activity use include_history and activity_range; timestamps, backlog and note counts do not establish work. Ranges filter text changes, not deadlines or event dates: omit them to find events in unchanged/later-authored text. For current deadlines try literal @due. Continue with cursor only; result and filters are retained.".into()
    }
    fn parameters(&self) -> Value {
        let mut schema = SearchArgs::schema();
        schema["properties"]["result"] = json!({"type":"string","enum":["passages","notes"],"description":"Default passages; notes groups recorded activity by note and requires activity_range. Omit on continuation."});
        schema
    }
    async fn call(&self, _: &mut ToolContext, args: SearchArgs) -> Result<Value, AgentToolError> {
        let distinct = if let Some(cursor) = args.cursor.as_deref() {
            if args.result.is_some() {
                return Err(AgentToolError::invalid(
                    "Continue with cursor only; result and filters are retained",
                ));
            }
            self.0
                .evidence
                .lock()
                .map_err(|_| AgentToolError::unavailable("Evidence unavailable"))?
                .search_is_distinct(cursor)
                .map_err(AgentToolError::from)?
        } else {
            args.result.unwrap_or_default() == FindResult::Notes
        };
        if distinct && args.cursor.is_none() && args.activity_range.is_none() {
            return Err(AgentToolError::invalid(
                "result=notes requires activity_range",
            ));
        }
        search(self.0.clone(), args, distinct).await
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
        let state = context.host.state().ok_or("Notes index unavailable")?;
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
        context.prepare_evidence_references(&mut result)?;
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
        "Read evidence IDs or a known canonical note; continue with cursor only. Cite returned [S#] references; the app builds links. activity_range assesses temporal support separately from meaning: qualify uncertainty; never attribute not_established passages or supporting context to that period. Resolve actor, event date, negation and status before answering. Coverage excludes cleared history and discarded Editing Window states, and cannot establish a complete real-world record.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{
            "cursor":{"type":"string","description":"Continuation handle; use alone."},
            "note_id":{"type":"string","description":"Known canonical note ID; bounded current pages, no pending proposals."},
            "include_provenance":{"type":"boolean","description":"Default false. Expand only for lineage; validation, timing and activitySupport are always included."},
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
            let state = context.host.state().ok_or("Notes index unavailable")?;
            let (mut payload, sources) = {
                let mut evidence = context
                    .evidence
                    .lock()
                    .map_err(|_| "Evidence unavailable")?;
                let mut args = args;
                if args.evidence_ids.len() > 8 {
                    return Err(AgentToolError::invalid(
                        "Read at most eight evidence IDs per selection",
                    ));
                }
                args.evidence_ids = context.resolve_evidence_ids(args.evidence_ids)?;
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
