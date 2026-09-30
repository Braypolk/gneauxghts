//! Model-facing reads: selectors, continuations and explicit evidence support.
use super::*;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ReadRequest {
    pub(crate) evidence_ids: Vec<String>,
    pub(crate) note_id: Option<String>,
    pub(crate) cursor: Option<String>,
    pub(crate) include_provenance: Option<bool>,
    pub(crate) activity_range: Option<query::ActivityRange>,
}
#[derive(Clone)]
pub(super) struct ReadContinuation {
    pending: Vec<(String, usize)>,
    provenance: bool,
    range: Option<query::ResolvedPeriod>,
}

impl EvidenceSession {
    pub(crate) fn remember_search(
        &mut self,
        result: &Value,
        mut request: SearchRequest,
        distinct: bool,
    ) {
        if let Some(cursor) = result["nextCursor"].as_str() {
            request.cursor = Some(cursor.into());
            self.search_continuations
                .insert(cursor.into(), (request, distinct));
        }
    }
    pub(crate) fn resume_search(
        &self,
        cursor: &str,
        distinct: bool,
    ) -> Result<SearchRequest, ToolError> {
        let (request, kind) = self
            .search_continuations
            .get(cursor)
            .ok_or_else(|| ToolError::stale("Continuation expired; start a fresh search"))?;
        if *kind != distinct {
            return Err(ToolError::invalid("Continuation belongs to another tool"));
        }
        Ok(request.clone())
    }

    pub(crate) fn read_request(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        args: ReadRequest,
    ) -> Result<(Value, Vec<(PassageCitation, PathBuf, String)>), ToolError> {
        if self.read_continuations.len() >= 128 {
            return Err(ToolError::work_budget("Read continuation budget exhausted"));
        }
        let selectors = usize::from(!args.evidence_ids.is_empty())
            + usize::from(args.note_id.is_some())
            + usize::from(args.cursor.is_some());
        if selectors != 1 {
            return Err(ToolError::invalid(
                "Choose exactly one of evidence_ids, note_id, or cursor",
            ));
        }
        let continuation = if let Some(cursor) = args.cursor {
            if args.activity_range.is_some() || args.include_provenance.is_some() {
                return Err(ToolError::invalid(
                    "A continuation already retains its read options",
                ));
            }
            self.read_continuations
                .get(&cursor)
                .cloned()
                .ok_or_else(|| ToolError::stale("Read continuation expired; read again"))?
        } else {
            let range = args
                .activity_range
                .as_ref()
                .map(|r| r.resolve(&self.anchor))
                .transpose()?;
            let ids = if let Some(note_id) = args.note_id {
                let ids = scope_ids(
                    state,
                    allowed,
                    excluded,
                    &SearchRequest {
                        note_ids: Some(vec![note_id.clone()]),
                        ..Default::default()
                    },
                )?;
                if !ids.contains(&note_id) {
                    return Err(ToolError::unavailable("Note is unavailable or not allowed; use a discovered noteId, not a title or evidenceId"));
                }
                let (path, title) = {
                    let index = state.notes_index.lock().map_err(|_| "Notes unavailable")?;
                    let (path, note) = index
                        .get_note_by_note_id(&note_id)
                        .ok_or("Note unavailable")?;
                    (path.clone(), note.title.clone())
                };
                let raw = fs::read_to_string(path).map_err(|_| "Note unavailable")?;
                let mut ids = Vec::new();
                // Direct canonical reads preserve all body and unmanaged properties.
                for location in ["title", "properties", "body"] {
                    let body = body_at(&raw, &title, location);
                    let mut offset = 0;
                    for text in passage_slices(&body) {
                        let candidate = make_candidate_at(
                            state,
                            &note_id,
                            text,
                            location,
                            "Current note",
                            1.0,
                            Some(offset),
                        )
                        .ok_or_else(|| {
                            ToolError::stale(
                                "Canonical note changed while preparing the read; retry",
                            )
                        })?;
                        ids.push(candidate.citation.id.clone());
                        self.candidates
                            .entry(candidate.citation.id.clone())
                            .or_insert(candidate);
                        offset += text.len();
                    }
                    if offset < body.len() {
                        return Err(ToolError::read_capacity(
                            "Note exceeds bounded direct-read capacity; search focused passages",
                        ));
                    }
                }
                ids
            } else {
                if args.evidence_ids.len() > 8 {
                    return Err(ToolError::invalid(
                        "Read at most eight evidence IDs per selection",
                    ));
                }
                args.evidence_ids
            };
            ReadContinuation {
                pending: ids.into_iter().map(|id| (id, 0)).collect(),
                provenance: args.include_provenance.unwrap_or(false),
                range,
            }
        };
        self.deliver_read(
            state,
            allowed,
            excluded,
            continuation,
            ReadPresentation::Normal,
        )
    }

    pub(super) fn deliver_read(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        mut continuation: ReadContinuation,
        presentation: ReadPresentation,
    ) -> Result<(Value, Vec<(PassageCitation, PathBuf, String)>), ToolError> {
        let capacity = READ_BYTES.min(EVIDENCE_BYTES.saturating_sub(self.used()));
        let mut items = Vec::new();
        let mut sources = Vec::new();
        let mut failures = Vec::new();
        let mut reason = None;
        let mut first_error = None;
        let cursor = format!("read:{}", self.sequence + 1);
        while !continuation.pending.is_empty() && items.len() < 8 {
            let (id, offset) = continuation.pending[0].clone();
            let key = serde_json::to_string(&(
                std::slice::from_ref(&id),
                continuation.provenance,
                offset,
            ))
            .unwrap();
            let prepared = if self.blocked_reads.contains(&key) {
                Err(ToolError::read_capacity(
                    "This selection already exceeded read capacity; search a narrower passage",
                ))
            } else {
                self.prepare_read_item(
                    state,
                    allowed,
                    excluded,
                    &id,
                    continuation.provenance,
                    offset,
                )
            };
            let prepared = match prepared {
                Err(error) if error.code == FailureCode::ProvenanceUnavailable => self
                    .prepare_read_item(state, allowed, excluded, &id, false, 0)
                    .map(|(i, c, p, t)| (i, c, p, t, true)),
                other => other.map(|(i, c, p, t)| (i, c, p, t, false)),
            };
            let (mut item, citation, path, title, provenance_unavailable) = match prepared {
                Ok(value) => value,
                Err(error) => {
                    let mut failure = error.payload();
                    failure["evidenceId"] = json!(id);
                    let mut proposed = failures.clone();
                    proposed.push(failure);
                    if !items.is_empty()
                        && presentation
                            .payload(
                                &items,
                                &proposed,
                                Some(&cursor),
                                true,
                                Some("read_capacity"),
                            )
                            .to_string()
                            .len()
                            > capacity
                    {
                        reason = Some("read_capacity");
                        break;
                    }
                    failures = proposed;
                    first_error.get_or_insert(error);
                    continuation.pending.remove(0);
                    continue;
                }
            };
            let next = item["nextProvenanceOffset"].as_u64();
            item["provenanceCoverage"] = json!({"requested":continuation.provenance,"complete":next.is_none() && !provenance_unavailable && !item["provenance"].is_null(),"available":!provenance_unavailable && !item["provenance"].is_null()});
            item["activitySupport"] =
                self.activity_support_for(&citation, continuation.range.as_ref());
            let mut proposed = items.clone();
            proposed.push(item.clone());
            let more = continuation.pending.len() > 1 || next.is_some();
            let proposed_page = presentation.payload(
                &proposed,
                &failures,
                more.then_some(cursor.as_str()),
                more,
                Some("read_capacity"),
            );
            // Durable citation destinations are replaced with shorter run references after admission.
            if proposed_page.to_string().len() > capacity {
                reason = Some(if capacity < READ_BYTES {
                    "run_budget"
                } else {
                    "read_capacity"
                });
                if !items.is_empty() {
                    break;
                }
                self.blocked_reads.insert(key);
                let error = if capacity < READ_BYTES {
                    ToolError::evidence_budget()
                } else {
                    ToolError::read_capacity(
                        "This passage exceeds page capacity; search a narrower passage",
                    )
                };
                let mut failure = error.payload();
                failure["evidenceId"] = json!(id);
                failures.push(failure);
                first_error.get_or_insert(error);
                continuation.pending.remove(0);
                continue;
            }
            items.push(item);
            sources.push((citation, path, title));
            continuation.pending.remove(0);
            if let Some(next) = next {
                continuation.pending.insert(0, (id, next as usize));
                break;
            }
        }
        let more = !continuation.pending.is_empty() && !items.is_empty();
        if items.is_empty() {
            if let Some(error) = first_error {
                return Err(error);
            }
        }
        let mut payload = presentation.payload(
            &items,
            &failures,
            more.then_some(cursor.as_str()),
            more,
            reason,
        );
        let charge = payload.to_string().len();
        if charge > capacity || !self.reserve(charge) {
            return Err(ToolError::evidence_budget());
        }
        for (citation, _, _) in &sources {
            self.admit(citation.clone());
        }
        if more && matches!(presentation, ReadPresentation::Normal) {
            self.sequence += 1;
            self.read_continuations.insert(cursor, continuation);
        }
        payload["remainingEvidenceBytes"] = json!(EVIDENCE_BYTES.saturating_sub(self.used()));
        Ok((payload, sources))
    }

    pub(crate) fn read_research(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        ids: &[String],
        range: Option<query::ResolvedPeriod>,
        gaps: Vec<String>,
    ) -> Result<(Value, Vec<(PassageCitation, PathBuf, String)>), ToolError> {
        let mut continuation = ReadContinuation::selection(ids, false, 0);
        continuation.range = range;
        self.deliver_read(
            state,
            allowed,
            excluded,
            continuation,
            ReadPresentation::Research {
                selected: ids.to_vec(),
                gaps,
            },
        )
    }

    fn activity_support_for(
        &self,
        citation: &PassageCitation,
        range: Option<&query::ResolvedPeriod>,
    ) -> Value {
        let Some(range) = range else {
            return json!({"status":"not_requested"});
        };
        let Some(c) = self.candidates.get(&citation.id) else {
            return json!({"status":"not_established"});
        };
        // Provenance attached to a broad canonical read does not make the whole
        // excerpt a changed passage. Only change-discovery candidates can qualify.
        if c.citation.historical.is_none() && c.section != "Activity" {
            return json!({"status":"not_established","recovery":"search_changed_passages"});
        }
        let times: Vec<_> = citation
            .revisions
            .iter()
            .filter_map(|r| r.time_evidence)
            .filter(|t| {
                !matches!(
                    t,
                    crate::services::note_timeline::RevisionTimeEvidence::Baseline { .. }
                ) && t.overlaps(range.after, range.before)
            })
            .collect();
        let definite = times.iter().any(|t| {
            let (start, end) = t.bounds();
            !t.uncertain() && start >= range.after && end < range.before
        });
        json!({"status":if definite {"supported"} else if !times.is_empty() {"uncertain"} else {"not_established"}, "range":range,"matchingTimes":times,
            "meaning":"Recorded passage change only; does not prove who performed work or real-world completion"})
    }
}

impl ReadContinuation {
    pub(super) fn selection(ids: &[String], provenance: bool, offset: usize) -> Self {
        Self {
            pending: ids.iter().cloned().map(|id| (id, offset)).collect(),
            provenance,
            range: None,
        }
    }
}
fn read_payload(
    items: &[Value],
    failures: &[Value],
    cursor: Option<&str>,
    more: bool,
    reason: Option<&str>,
) -> Value {
    let notes = items
        .iter()
        .filter_map(|i| i["noteId"].as_str())
        .collect::<HashSet<_>>()
        .len();
    json!({"status":if items.is_empty() && !failures.is_empty() {"limited"} else if !failures.is_empty() {"partial"} else {"ready"},
        "items":items,"failures":failures,"nextCursor":cursor,"truncated":more,"truncationReason":reason,
        "notesRead":notes,"delivery":{"complete":!more && failures.is_empty(),"hasMore":more},
        "provenance":{"hasMore":items.iter().any(|i| !i["nextProvenanceOffset"].is_null())},
        "coverage":{"meaning":"Selected passages or one canonical note; does not claim all work or retained history"},
        "supportingContextMeaning":"Current context does not establish activity during the requested period",
        "statusMeaning":"Recorded status is not independent proof of real-world completion. Historical text requires a current-status check; an unchanged proposal is not an outstanding commitment",
        "remainingEvidenceBytes":24000})
}

// The complete parent-facing envelope is sized before evidence is charged or admitted.
pub(super) enum ReadPresentation {
    Normal,
    Research {
        selected: Vec<String>,
        gaps: Vec<String>,
    },
}
impl ReadPresentation {
    fn payload(
        &self,
        items: &[Value],
        failures: &[Value],
        cursor: Option<&str>,
        more: bool,
        reason: Option<&str>,
    ) -> Value {
        let mut page = read_payload(items, failures, cursor, more, reason);
        if let Self::Research { selected, gaps } = self {
            let delivered: HashSet<_> = items
                .iter()
                .filter_map(|i| i["evidenceId"].as_str())
                .collect();
            let remaining: Vec<_> = selected
                .iter()
                .filter(|id| !delivered.contains(id.as_str()))
                .collect();
            page["nextCursor"] = Value::Null;
            page["remainingEvidenceIds"] = json!(remaining);
            page["research"] = json!(true);
            page["gaps"] = json!(gaps);
            page["delivery"] = json!({"complete":remaining.is_empty() && failures.is_empty(),"hasMore":!remaining.is_empty(),"recovery":"read_remaining_evidence_ids"});
            page["status"] = json!(
                if remaining.is_empty() && failures.is_empty() && gaps.is_empty() {
                    "ready"
                } else {
                    "partial"
                }
            );
        }
        page
    }
}
