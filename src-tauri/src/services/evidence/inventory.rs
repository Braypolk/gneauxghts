use super::*;
use crate::services::note_timeline::{MutationSource, RevisionTimeEvidence};
use query::ResolvedPeriod;

const INVENTORY_BYTES: usize = 256_000;
const INVENTORY_ROWS: usize = 50;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct InventoryActivity {
    pub(crate) evidence_id: String,
    pub(crate) start: u64,
    pub(crate) end: u64,
    pub(crate) uncertain: bool,
    pub(crate) clock_uncertain: bool,
    pub(crate) boundary_overlap: bool,
    pub(crate) source: MutationSource,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct InventoryRow {
    pub(crate) evidence_id: String,
    pub(crate) title: String,
    pub(crate) excerpt: String,
    pub(crate) supporting_context: String,
    pub(crate) activity: Vec<InventoryActivity>,
    pub(crate) uncertain: bool,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct InventoryResult {
    pub(crate) query: ResolvedPeriod,
    pub(crate) rows: Vec<InventoryRow>,
    pub(crate) page_offset: usize,
    pub(crate) complete: bool,
    pub(crate) gaps: Vec<String>,
    pub(crate) continuation: Option<String>,
    pub(crate) budgets: Value,
}

fn activity(c: &Candidate, after: u64, before: u64) -> Vec<InventoryActivity> {
    c.citation
        .revisions
        .iter()
        .filter_map(|r| {
            let t = r.time_evidence?;
            if matches!(t, RevisionTimeEvidence::Baseline { .. }) || !t.overlaps(after, before) {
                return None;
            }
            let (start, end) = t.bounds();
            Some(InventoryActivity {
                evidence_id: c.citation.id.clone(),
                start,
                end,
                uncertain: t.uncertain() || start < after || end >= before,
                clock_uncertain: t.uncertain(),
                boundary_overlap: (start < after && end >= after)
                    || (start < before && end >= before),
                source: r.source,
            })
        })
        .collect()
}

impl EvidenceSession {
    pub(crate) fn activity_page(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        mut request: SearchRequest,
        resolved: ResolvedPeriod,
    ) -> Result<Value, ToolError> {
        if self.used() >= EVIDENCE_BYTES {
            return Err(ToolError::evidence_budget());
        }
        request.limit = Some(request.limit.unwrap_or(8).clamp(1, 20));
        let include_history = request.include_history;
        let (inventory, _, _) = self.inventory(state, allowed, excluded, request, resolved)?;
        let items: Vec<_> = inventory
            .rows
            .iter()
            .map(|row| {
                let candidate = &self.candidates[&row.evidence_id];
                json!({"noteId":candidate.citation.note_id,"evidenceId":row.evidence_id,
                "title":bounded(&row.title,240),"preview":bounded(&row.excerpt,PREVIEW_BYTES),
                "exampleRecordedChange":row.activity.first(),"uncertain":row.uncertain})
            })
            .collect();
        let payload = json!({"status":"ready","items":items,"notesReturned":items.len(),
            "pageOffset":inventory.page_offset,"nextCursor":inventory.continuation,
            "coverage":inventory.budgets["retrieval"]["coverage"],
            "resolvedRange":inventory.query,
            "delivery":{"complete":inventory.continuation.is_none() && !inventory.budgets["stopReasons"].as_array().is_some_and(|reasons| reasons.iter().any(|r| r == "inventory_item_bytes")),"hasMore":inventory.continuation.is_some(),"limits":inventory.budgets["stopReasons"]},
            "historyScope":if include_history {"retained_changes"} else {"surviving_content"},
            "meaning":"One example change per note; read evidence before citing, and search the same note/range for all matching passages. Counts are per page, not accomplishments."});
        let size = serde_json::to_vec(&payload)
            .map_err(|e| e.to_string())?
            .len();
        if !self.reserve(size) {
            return Err(ToolError::evidence_budget());
        }
        Ok(payload)
    }

    pub(crate) fn inventory(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        mut request: SearchRequest,
        resolved: ResolvedPeriod,
    ) -> Result<
        (
            InventoryResult,
            Value,
            Vec<(PassageCitation, PathBuf, String)>,
        ),
        ToolError,
    > {
        let limit = request
            .limit
            .unwrap_or(INVENTORY_ROWS)
            .clamp(1, INVENTORY_ROWS);
        let cursor = request.cursor.take();
        let gathered = self.search_inner(state, allowed, excluded, request.clone(), true)?;
        let key = gathered["searchKey"]
            .as_str()
            .ok_or("Inventory search unavailable")?;
        let ids = self
            .searches
            .get(key)
            .ok_or("Inventory search unavailable")?
            .2
            .clone();
        let mut normalized = request.clone();
        self.normalize_request(&mut normalized)?;
        normalized.limit = None;
        let period = &resolved;
        let mut notes: HashMap<String, Vec<(Candidate, Vec<InventoryActivity>)>> = HashMap::new();
        for id in ids {
            let c = self.candidates[&id].clone();
            let times = activity(&c, period.after, period.before);
            if !times.is_empty() {
                notes
                    .entry(c.citation.note_id.clone())
                    .or_default()
                    .push((c, times));
            }
        }
        let mut notes: Vec<_> = notes.into_iter().collect();
        notes.sort_by(|a, b| {
            let latest = |n: &Vec<(Candidate, Vec<InventoryActivity>)>| {
                n.iter()
                    .flat_map(|(_, ts)| ts.iter().map(|t| t.end))
                    .max()
                    .unwrap_or(0)
            };
            latest(&b.1).cmp(&latest(&a.1)).then_with(|| a.0.cmp(&b.0))
        });
        let signature = hash(
            &serde_json::to_string(&(
                self.searches[key].0.clone(),
                &normalized,
                notes
                    .iter()
                    .map(|(id, candidates)| {
                        (
                            id,
                            candidates
                                .iter()
                                .map(|(c, _)| &c.citation)
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect::<Vec<_>>(),
                &resolved,
            ))
            .map_err(|e| e.to_string())?,
        );
        let offset = match cursor {
            None => 0,
            Some(cursor) => {
                let parts: Vec<_> = cursor.split(':').collect();
                if parts.len() != 3 || parts[0] != "inventory" || parts[1] != signature {
                    return Err(ToolError::stale("Inventory continuation is stale or belongs to another query; start a fresh search"));
                }
                parts[2]
                    .parse::<usize>()
                    .map_err(|_| "Invalid inventory continuation")?
            }
        };
        let mut gaps: Vec<String> = gathered["coverage"]["gaps"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        let mut complete = gathered["coverage"]["complete"] == true;
        let mut rows = Vec::new();
        let mut payload_items = Vec::new();
        let mut sources = Vec::new();
        let total = notes.len();
        if offset > total {
            return Err(ToolError::invalid("Invalid inventory continuation offset"));
        }
        let mut next_offset = offset;
        let mut inventory_bytes = 0;
        let mut stop_reasons = Vec::new();
        for (_, mut candidates) in notes.into_iter().skip(offset) {
            check_cancelled(&request)?;
            if rows.len() >= limit {
                complete = false;
                stop_reasons.push("display_rows");
                gaps.push("Display limit reached; continue for more notes".into());
                break;
            }
            // One witness establishes membership. Do not load every edit's
            // repeated context/provenance through the model-facing read budget.
            candidates.sort_by_key(|(c, ts)| {
                (
                    ts.iter().all(|t| t.uncertain),
                    std::cmp::Reverse(
                        ts.iter()
                            .filter(|t| !t.uncertain)
                            .map(|t| t.end)
                            .max()
                            .unwrap_or_else(|| ts.iter().map(|t| t.end).max().unwrap_or(0)),
                    ),
                    c.citation.id.clone(),
                )
            });
            let (c, times) = candidates
                .into_iter()
                .next()
                .ok_or("Inventory witness unavailable")?;
            // Show one representative time; retain the candidate’s full proof. The UI calls it
            // an example, never a complete edit history or an edit count.
            let time = times
                .into_iter()
                .min_by_key(|t| (t.uncertain, std::cmp::Reverse(t.end)))
                .ok_or("Inventory time evidence unavailable")?;
            let row = InventoryRow {
                evidence_id: c.citation.id.clone(),
                title: c.title.clone(),
                excerpt: bounded(&c.citation.excerpt, 480),
                supporting_context: bounded(&c.context, 480),
                uncertain: time.uncertain,
                activity: vec![time],
            };
            // Conservative serialized admission charge. The chat adapter also
            // stores excerpt/identity beside the citation; reserve a second full
            // citation plus metadata and framing so it cannot exceed this bound.
            let size = serde_json::to_vec(&(&row, &c.citation, &c.citation, &c.path, &c.title))
                .map_err(|e| e.to_string())?
                .len()
                + 512;
            if size > INVENTORY_BYTES {
                // Advance past an undeliverable row so continuation cannot loop
                // forever. The explicit gap prevents a false complete count.
                complete = false;
                stop_reasons.push("inventory_item_bytes");
                gaps.push("A note's supporting evidence exceeds the inventory allowance; narrow the date range for that note".into());
                next_offset += 1;
                continue;
            }
            if inventory_bytes + size > INVENTORY_BYTES {
                complete = false;
                stop_reasons.push("inventory_page_bytes");
                gaps.push("Inventory result allowance reached; continue for more notes".into());
                break;
            }
            let Some((path, title)) = validate_citation(state, &c.citation, allowed, excluded)
            else {
                return Err(ToolError::stale(
                    "Evidence changed or is no longer allowed; search again",
                ));
            };
            check_cancelled(&request)?;
            inventory_bytes += size;
            self.admit(c.citation.clone());
            payload_items.push(json!({"evidenceId":c.citation.id,"excerpt":c.citation.excerpt}));
            sources.push((c.citation, path, title));
            rows.push(row);
            next_offset += 1;
        }
        let continuation =
            (next_offset < total).then(|| format!("inventory:{signature}:{next_offset}"));
        if continuation.is_some() {
            complete = false;
        }
        if gathered["coverage"]["complete"] == false {
            stop_reasons.push("retrieval_coverage");
        }
        stop_reasons.sort();
        stop_reasons.dedup();
        let budgets = json!({
            "modelEvidence": {"usedBytes": self.used(), "limitBytes": EVIDENCE_BYTES},
            "inventory": {"usedBytes": inventory_bytes, "limitBytes": INVENTORY_BYTES, "accounting": "conservative serialized rows and sources allowance"},
            "display": {"rows": rows.len(), "limitRows": limit},
            "retrieval": {"candidateLimit": WORK_LIMIT, "coverage": gathered["coverage"]},
            "stopReasons": stop_reasons
        });
        gaps.sort();
        gaps.dedup();
        Ok((
            InventoryResult {
                query: resolved,
                rows,
                page_offset: offset,
                complete,
                gaps,
                continuation,
                budgets,
            },
            json!({"items":payload_items}),
            sources,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clock_uncertainty_does_not_imply_boundary_crossing() {
        for (start, end, clock, expected) in [
            (100, 200, true, false),
            (100, 350, true, true),
            (320, 350, true, false),
            (350, 410, false, true),
            (410, 450, true, false),
        ] {
            let c = Candidate {
                citation: PassageCitation {
                    historical: None,
                    id: "evidence".into(),
                    note_id: "note".into(),
                    content_hash: "hash".into(),
                    location: "body".into(),
                    start: 0,
                    end: 1,
                    excerpt: "x".into(),
                    revisions: vec![RevisionCitation {
                        note_id: "note".into(),
                        revision_id: "revision".into(),
                        at_millis: end,
                        source: MutationSource::Editor,
                        current_excerpt: "x".into(),
                        time_evidence: Some(RevisionTimeEvidence::EditingWindow {
                            version: 1,
                            first_wall_millis: start,
                            last_wall_millis: end,
                            min_wall_millis: start,
                            max_wall_millis: end,
                            clock_discontinuity: clock,
                        }),
                    }],
                },
                path: PathBuf::new(),
                title: "Note".into(),
                section: "Activity".into(),
                score: 1.0,
                provenance: None,
                context: String::new(),
                task: None,
            };
            let times = activity(&c, 300, 400);
            assert_eq!(times.len(), 1);
            assert_eq!(times[0].clock_uncertain, clock);
            assert_eq!(times[0].boundary_overlap, expected, "{start}..{end}");
        }
    }
}
