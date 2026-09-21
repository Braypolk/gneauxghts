use super::*;
use crate::services::evidence::SearchRequest;

#[derive(Clone)]
pub(super) struct SearchEvidenceTool(pub(super) AgentToolContext);
#[derive(Clone)]
pub(super) struct ReadEvidenceTool(pub(super) AgentToolContext);
#[derive(Deserialize)]
pub(super) struct ReadEvidenceArgs {
    pub(super) evidence_ids: Vec<String>,
    #[serde(default)]
    pub(super) include_provenance: bool,
    #[serde(default)]
    pub(super) provenance_offset: usize,
}

impl AgentToolContext {
    pub(crate) fn bind_query_calendar(&self, question: &str) -> Result<(), String> {
        self.evidence
            .lock()
            .map_err(|_| "Evidence unavailable")?
            .requested_calendar =
            crate::services::evidence::query::RequestedCalendar::from_question(question);
        Ok(())
    }
    pub(crate) fn query_is_blocked(&self) -> bool {
        self.query_failures.load(Ordering::SeqCst) > 1
    }
    pub(crate) fn query_anchor_label(&self) -> String {
        self.evidence
            .lock()
            .map(|e| format!("{} ({}){}", e.anchor.instant.to_rfc3339(), e.anchor.timezone,
                e.requested_calendar.as_ref().map(|c| format!("\nWhen using interpretation, the user's single relative calendar phrase requires period {}. Do not calculate explicit dates.", json!({"kind":"calendar","unit":c.unit,"offset":c.offset}))).unwrap_or_default()))
            .unwrap_or_else(|_| "Unavailable".into())
    }
    pub(crate) fn read_is_blocked(&self, args: &str) -> bool {
        serde_json::from_str::<ReadEvidenceArgs>(args)
            .ok()
            .is_some_and(|args| {
                self.evidence.lock().is_ok_and(|e| {
                    e.read_is_blocked(
                        &args.evidence_ids,
                        args.include_provenance,
                        args.provenance_offset,
                    )
                })
            })
    }
    pub(crate) fn set_previous_query(&self, details: &Value) -> Result<(), String> {
        let predicates = details["resolved"]["intent"]["time"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let periods = details["resolved"]["periods"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let previous = predicates
            .into_iter()
            .zip(periods)
            .filter_map(|(predicate, period)| {
                Some((
                    serde_json::from_value(predicate["role"].clone()).ok()?,
                    serde_json::from_value(period).ok()?,
                ))
            })
            .collect();
        self.evidence
            .lock()
            .map_err(|_| "Evidence unavailable")?
            .anchor
            .previous = previous;
        Ok(())
    }
    pub(crate) fn has_inventory(&self) -> bool {
        self.inventory.lock().is_ok_and(|v| v.is_some())
    }
    pub(crate) fn render_inventory(
        &self,
        inventory: &crate::services::evidence::InventoryResult,
    ) -> Result<String, String> {
        self.validate_context()?;
        self.passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?
            .render_inventory(inventory, &self.sources())
    }
    pub(crate) fn inventory_result(
        &self,
    ) -> Result<Option<crate::services::evidence::InventoryResult>, String> {
        self.check_cancelled()?;
        self.validate_context()?;
        Ok(self
            .inventory
            .lock()
            .map_err(|_| "Inventory unavailable")?
            .clone())
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
    pub(crate) fn enable_source_first(&mut self) -> Result<(), String> {
        self.source_first = true;
        self.passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?
            .enable_source_first();
        Ok(())
    }

    pub(crate) fn render_source_first(&self, text: &str) -> Result<String, String> {
        let sources = self.sources();
        self.passage_references
            .lock()
            .map_err(|_| "Citations unavailable")?
            .render_source_first(text, &sources)
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
            .map_err(|_| AgentToolError("Evidence unavailable".into()))?
            .admit_context(text, max)
            .map_err(AgentToolError)
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
impl Tool for SearchEvidenceTool {
    const NAME: &'static str = "search_evidence";
    type Error = AgentToolError;
    type Args = SearchRequest;
    type Output = Value;
    fn description(&self) -> String {
        format!("Find current allowed evidence using the query contract below. Repeat the same interpretation and scope with nextCursor. query/period/after/before cannot accompany interpretation. Removed prose is unavailable. {}", crate::services::evidence::query::instructions())
    }
    fn parameters(&self) -> Value {
        let mut schema = crate::services::evidence::query::schema();
        if let Some(calendar) = self
            .0
            .evidence
            .lock()
            .ok()
            .and_then(|e| e.requested_calendar.clone())
        {
            schema["properties"]["time"]["items"]["properties"]["period"] = json!({"type":"object","required":["kind","unit","offset"],"additionalProperties":false,"properties":{"kind":{"const":"calendar"},"unit":{"const":calendar.unit},"offset":{"const":calendar.offset},"full":{"type":"boolean"}}});
        }
        json!({"type":"object","properties":{
        "interpretation":schema,
        "query":{"type":"string"},"mode":{"type":"string","enum":["hybrid","lexical","literal","regex"]},
        "period":{"type":"string","enum":["this_week"]},"after":{"type":"integer","minimum":0},"before":{"type":"integer","minimum":0},
        "folder":{"type":"string"},"note_ids":{"type":"array","items":{"type":"string"}},"cursor":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":20}},"additionalProperties":false})
    }
    async fn call(
        &self,
        _: &mut ToolContext,
        mut args: SearchRequest,
    ) -> Result<Value, AgentToolError> {
        args.cancelled = self
            .0
            .cancellation
            .lock()
            .map_err(|_| AgentToolError("Cancellation unavailable".into()))?
            .clone();
        self.0.activity(
            if args.period.is_some() || args.after.is_some() || args.before.is_some() {
                "Checking dates"
            } else {
                "Searching notes"
            },
        );
        self.0
            .service
            .mark_current_history_use(&self.0.assistant_message_id, &self.0.run_id)
            .map_err(AgentToolError)?;
        let context = self.0.clone();
        run_blocking_tool(move || {
            context.check_cancelled()?;
            let (allowed, excluded) = context.evidence_scope()?;
            let state = context
                .app
                .try_state::<AppState>()
                .ok_or("Notes index unavailable")?;
            let validation: Result<Option<crate::services::evidence::query::ResolvedQuery>, String> = (|| {
                let session = context.evidence.lock().map_err(|_| "Evidence unavailable")?;
                if let Some(calendar) = &session.requested_calendar {
                    // Only constrain structured queries. Legacy searches for semantic
                    // evidence remain available without inventing an edit cutoff.
                    if args.interpretation.is_some() { calendar.validate(args.interpretation.as_ref())?; }
                }
                let resolved = session.normalize_request(&mut args.clone())?;
                Ok(resolved)
            })();
            let resolved = match validation {
                Ok(resolved) => resolved,
                Err(message) => {
                    context.emit_agent_event(AgentEvent::QueryResolved {details:json!({"primary":false,"worker":context.research_only,"submitted":args,"stage":"interpretation","code":"invalid_arguments","message":message})});
                    let previous = context.query_failures.fetch_add(1, Ordering::SeqCst);
                    if previous > 0 { return Err(format!("Query interpretation remains invalid: {message}")); }
                    return Ok(json!({"status":"invalid_arguments","message":message,"retryable":true,"correctionsRemaining":1}));
                }
            };
            let primary = !context.research_only && resolved.is_some() && !context.primary_query_recorded.swap(true,Ordering::SeqCst);
            let trace = json!({"primary":primary,"worker":context.research_only,"submitted":args,"resolved":resolved,"anchor":context.evidence.lock().map_err(|_| "Evidence unavailable")?.anchor});
            context.emit_agent_event(AgentEvent::QueryResolved { details:trace.clone() });
            if let Some(resolved) = resolved.as_ref().filter(|r| r.workflow == "note_inventory" && !context.research_only) {
                let (inventory, mut payload, sources) = context.evidence.lock().map_err(|_| "Evidence unavailable")?
                    .inventory(&state, allowed.as_ref(), &excluded, args, resolved.clone())?;
                context.check_cancelled()?;
                if (allowed, excluded) != context.evidence_scope()? { return Err("Note policy changed; search again".into()); }
                context.admit_passages(sources)?;
                context.prepare_passage_references(&mut payload)?;
                let diagnostic = json!({"status":"inventory_complete","resolvedQuery":inventory.query,"notesReturned":inventory.rows.len(),"coverageComplete":inventory.complete,"gaps":inventory.gaps,"budgets":inventory.budgets});
                let mut completed_trace = trace;
                completed_trace["inventory"] = diagnostic.clone();
                completed_trace["continuation"] = json!(inventory.continuation);
                context.emit_agent_event(AgentEvent::QueryResolved { details:completed_trace });
                *context.inventory.lock().map_err(|_| "Inventory unavailable")? = Some(inventory);
                return Ok(diagnostic);
            }
            // Resolve first, then enforce inherited worker activity constraints. Never
            // confuse an event-date predicate with an inherited text-activity period.
            if let Some(scope) = &context.worker_period {
                let mut effective = args.clone();
                context.evidence.lock().map_err(|_| "Evidence unavailable")?.normalize_request(&mut effective)?;
                if scope.after.is_some() || scope.before.is_some() {
                    if effective.after.is_some_and(|v| Some(v) != scope.after) || effective.before.is_some_and(|v| Some(v) != scope.before) {
                        return Err("Research query conflicts with its inherited activity period".into());
                    }
                    effective.after = scope.after; effective.before = scope.before; effective.period = None;
                }
                effective.folder = scope.folder.clone().or(effective.folder);
                args = effective;
            }
            let mut result = context
                .evidence
                .lock()
                .map_err(|_| "Evidence unavailable")?
                .search(&state, allowed.as_ref(), &excluded, args)?;
            if resolved.is_some() { result["resolvedQuery"] = serde_json::to_value(&resolved).map_err(|e|e.to_string())?; }
            context.check_cancelled()?;
            if (allowed, excluded) != context.evidence_scope()? {
                return Err("Note policy changed; search again".into());
            }
            if let Some(items) = result["items"].as_array() {
                for item in items {
                    if let Some(id) = item["noteId"].as_str() {
                        context.surface(id);
                    }
                }
            }
            Ok(result)
        })
        .await
    }
}
impl Tool for ReadEvidenceTool {
    const NAME: &'static str = "read_evidence";
    type Error = AgentToolError;
    type Args = ReadEvidenceArgs;
    type Output = Value;
    fn description(&self) -> String {
        "Read up to eight selected evidence IDs, bounded to 1500 estimated tokens per call and 6000 per run. Returns exact current passages, separately labeled supporting context, authoritative provenance and short citation references such as [S1]. Cite only these references; the app constructs their links. Baseline knownSince is not creation time. Use only returned citation references and preserve uncertainty; a note edit is not proof of real-world completion. Partial reads report truncationReason and retryable. Empty limited reads do not mean no evidence exists. Never repeat identical arguments when retryable=false; use admitted evidence with partial coverage. For nextProvenanceOffset, repeat one evidence ID with include_provenance=true and provenance_offset to continue its dates, independently of search cursors.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"provenance_offset":{"type":"integer","minimum":0},"include_provenance":{"type":"boolean","description":"Read authoritative current range dates, including baseline uncertainty"},"evidence_ids":{"type":"array","maxItems":8,"items":{"type":"string"}}},"required":["evidence_ids"],"additionalProperties":false})
    }
    async fn call(
        &self,
        _: &mut ToolContext,
        args: ReadEvidenceArgs,
    ) -> Result<Value, AgentToolError> {
        self.0.activity("Reading selected passages");
        let context = self.0.clone();
        run_blocking_tool(move || {
            context.check_cancelled()?;
            let (allowed, excluded) = context.evidence_scope()?;
            let state = context
                .app
                .try_state::<AppState>()
                .ok_or("Notes index unavailable")?;
            let (mut payload, sources) = context
                .evidence
                .lock()
                .map_err(|_| "Evidence unavailable")?
                .read_page(
                    &state,
                    allowed.as_ref(),
                    &excluded,
                    &args.evidence_ids,
                    args.include_provenance,
                    args.provenance_offset,
                )?;
            context.check_cancelled()?;
            if (allowed, excluded) != context.evidence_scope()? {
                return Err("Note policy changed; search again".into());
            }
            context.admit_passages(sources)?;
            context.prepare_passage_references(&mut payload)?;
            Ok(payload)
        })
        .await
    }
}
