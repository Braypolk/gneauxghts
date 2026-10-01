use crate::services::tool_outcome::{FailureCode, ToolError};
pub(crate) mod inventory;
pub(crate) mod query;
mod reads;
pub(crate) use reads::ReadRequest;
// Current evidence: local retrieval, scope, ranking, cursors and canonical
// validation live here. NoteTimeline alone reconstructs temporal provenance.
use crate::{
    index::AppState,
    note::{self, DocumentKind},
    services::note_timeline::{
        AllowedScope, CurrentContentIdentity, CurrentContentItem, RevisionCitation,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

const WORK_LIMIT: usize = 4096;
pub(crate) const EVIDENCE_BYTES: usize = 24_000;
pub(crate) const READ_BYTES: usize = 6_000;
const PREVIEW_BYTES: usize = 480;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct SearchRequest {
    #[serde(skip)]
    pub(crate) cancelled: Option<tokio_util::sync::CancellationToken>,
    pub(crate) query: String,
    pub(crate) include_history: bool,
    pub(crate) activity_range: Option<query::ActivityRange>,
    pub(crate) mode: SearchMode,
    pub(crate) note_ids: Option<Vec<String>>,
    pub(crate) folder: Option<String>,
    pub(crate) after: Option<u64>,
    pub(crate) before: Option<u64>,
    pub(crate) range_timezone: Option<String>,
    pub(crate) cursor: Option<String>,
    pub(crate) limit: Option<usize>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SearchMode {
    #[default]
    Hybrid,
    Lexical,
    Literal,
    Regex,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PassageCitation {
    pub(crate) id: String,
    pub(crate) note_id: String,
    pub(crate) content_hash: String,
    pub(crate) location: String,
    /// UTF-8 offsets in current content, or historical.content_revision_id when present.
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) excerpt: String,
    #[serde(default)]
    pub(crate) revisions: Vec<RevisionCitation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) historical: Option<crate::services::note_timeline::HistoricalPassage>,
}
#[derive(Clone)]
struct Candidate {
    citation: PassageCitation,
    path: PathBuf,
    title: String,
    section: String,
    score: f32,
    provenance: Option<Value>,
    context: String,
    task: Option<Value>,
}
impl CurrentContentItem for Candidate {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.citation.note_id),
            note_path: self.path.to_str(),
        }
    }
}
#[derive(Serialize, Deserialize)]
struct SearchBinding {
    request: SearchRequest,
    meaning: Value,
}
#[derive(Default)]
pub(crate) struct EvidenceSession {
    pub(crate) anchor: query::QueryAnchor,
    candidates: HashMap<String, Candidate>,
    searches: HashMap<String, (String, String, Vec<String>, Value)>,
    admitted: HashMap<String, PassageCitation>,
    used_bytes: Arc<AtomicUsize>,
    sequence: usize,
    blocked_reads: HashSet<String>,
    read_continuations: HashMap<String, reads::ReadContinuation>,
    search_continuations: HashMap<String, (SearchRequest, bool)>,
}

pub(crate) fn bounded(text: &str, bytes: usize) -> String {
    let mut end = bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].into()
}
fn hash(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}
fn check_cancelled(request: &SearchRequest) -> Result<(), ToolError> {
    if request.cancelled.as_ref().is_some_and(|c| c.is_cancelled()) {
        return Err(ToolError::cancelled());
    }
    Ok(())
}
pub(crate) fn canonical_content_hash(raw: &str) -> String {
    let parsed = note::parse_note(raw);
    hash(&serde_json::to_string(&(parsed.body, parsed.frontmatter.raw_other)).unwrap_or_default())
}
fn body_at(raw: &str, title: &str, location: &str) -> String {
    match location {
        "title" => title.into(),
        "properties" => note::parse_note(raw)
            .frontmatter
            .raw_other
            .unwrap_or_default(),
        _ => note::parse_note(raw).body.to_string(),
    }
}

#[cfg(test)]
pub(crate) fn resolve_period(request: &mut SearchRequest) -> Result<Option<Value>, ToolError> {
    resolve_period_at(request, &query::QueryAnchor::default())
}
pub(crate) fn resolve_period_at(
    request: &mut SearchRequest,
    anchor: &query::QueryAnchor,
) -> Result<Option<Value>, ToolError> {
    if let Some(range) = request.activity_range.take() {
        if request.after.is_some() || request.before.is_some() {
            return Err(ToolError::invalid(
                "Use activity_range instead of internal numeric bounds",
            ));
        }
        let resolved = range.resolve(anchor)?;
        request.after = Some(resolved.after);
        request.before = Some(resolved.before);
        request.range_timezone = Some(resolved.timezone.clone());
    }
    if request.after.is_none() && request.before.is_none() {
        return Ok(None);
    }
    let after = request.after.unwrap_or(0);
    let before = request.before.unwrap_or(u64::MAX);
    if after >= before {
        return Err(ToolError::invalid(
            "The activity period must be nonempty [after,before)",
        ));
    }
    Ok(Some(
        json!({"after":after,"before":before,"timezone":request.range_timezone.as_deref().unwrap_or(&anchor.timezone),"basis":if request.include_history {"retained_authored_changes"} else {"surviving_content_activity"}}),
    ))
}

pub(crate) fn scope_ids(
    state: &AppState,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
    request: &SearchRequest,
) -> Result<HashSet<String>, ToolError> {
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?;
    Ok(index
        .entries
        .iter()
        .filter(|(path, n)| {
            n.document_kind == DocumentKind::Note
                && allowed.is_none_or(|ids| ids.contains(&n.note_id))
                && !excluded.contains(&n.note_id)
                && request
                    .note_ids
                    .as_ref()
                    .is_none_or(|ids| ids.contains(&n.note_id))
                && request.folder.as_ref().is_none_or(|folder| {
                    path.strip_prefix(state.running_vault().root())
                        .ok()
                        .is_some_and(|p| p.starts_with(folder))
                })
        })
        .map(|(_, n)| n.note_id.clone())
        .collect())
}

// Bind every search cursor to scope and current canonical versions. New matches,
// removals and policy changes invalidate rather than shift an offset silently.
fn fingerprint(state: &AppState, ids: &HashSet<String>) -> Result<String, ToolError> {
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?;
    let mut keys = Vec::new();
    for id in ids {
        if let Some((path, n)) = index.get_note_by_note_id(id) {
            let signature = fs::metadata(path)
                .ok()
                .map(|m| (m.len(), m.modified().ok()));
            keys.push(format!(
                "{}:{}:{}:{:?}",
                id,
                path.display(),
                n.canonical_digest(),
                signature
            ));
        }
    }
    keys.sort();
    Ok(hash(&keys.join("\n")))
}

impl EvidenceSession {
    pub(crate) fn normalize_request(
        &self,
        request: &mut SearchRequest,
    ) -> Result<Option<query::ResolvedPeriod>, ToolError> {
        let Some(range) = request.activity_range.take() else {
            return Ok(None);
        };
        if request.after.is_some() || request.before.is_some() {
            return Err(ToolError::invalid(
                "Use activity_range instead of internal numeric bounds",
            ));
        }
        let resolved = range.resolve(&self.anchor)?;
        request.after = Some(resolved.after);
        request.before = Some(resolved.before);
        request.range_timezone = Some(resolved.timezone.clone());
        Ok(Some(resolved))
    }
    pub(crate) fn fork(&self) -> Self {
        Self {
            anchor: self.anchor.clone(),
            candidates: self.candidates.clone(),
            used_bytes: self.used_bytes.clone(),
            ..Default::default()
        }
    }
    pub(crate) fn fork_for_period(&self, temporal: bool) -> Self {
        let mut fork = self.fork();
        if temporal {
            fork.candidates.clear();
        }
        fork
    }
    pub(crate) fn accept_selected(
        &mut self,
        worker: &Self,
        ids: &[String],
        delivered: &[(PassageCitation, PathBuf, String)],
    ) {
        for id in ids {
            if let Some(c) = worker.candidates.get(id) {
                self.candidates.insert(id.clone(), c.clone());
            }
        }
        for (citation, _, _) in delivered {
            if ids.contains(&citation.id) {
                self.admit(citation.clone());
            }
        }
    }
    fn admit(&mut self, citation: PassageCitation) {
        let prior = self
            .admitted
            .entry(citation.id.clone())
            .or_insert_with(|| citation.clone());
        // A later provenance page can add proofs to the same passage identity.
        // Retain every delivered proof, including those from earlier pages.
        for proof in citation.revisions {
            if !prior.revisions.contains(&proof) {
                prior.revisions.push(proof);
            }
        }
    }
    fn used(&self) -> usize {
        self.used_bytes.load(Ordering::SeqCst)
    }
    fn reserve(&self, bytes: usize) -> bool {
        self.used_bytes
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |used| {
                used.checked_add(bytes)
                    .filter(|next| *next <= EVIDENCE_BYTES)
            })
            .is_ok()
    }
    pub(crate) fn admit_context(&mut self, text: &str, max: usize) -> Result<String, ToolError> {
        let remaining = EVIDENCE_BYTES.saturating_sub(self.used());
        if remaining == 0 {
            return Err(ToolError::evidence_budget());
        }
        let text = bounded(text, max.min(remaining));
        if !self.reserve(text.len()) {
            return Err(ToolError::evidence_budget());
        }
        Ok(text)
    }

    pub(crate) fn search(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        request: SearchRequest,
    ) -> Result<Value, ToolError> {
        self.search_inner(state, allowed, excluded, request, false)
    }
    fn search_inner(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        mut request: SearchRequest,
        collect_only: bool,
    ) -> Result<Value, ToolError> {
        let resolved = self.normalize_request(&mut request)?;
        check_cancelled(&request)?;
        if !collect_only && self.used() >= EVIDENCE_BYTES {
            return Err(ToolError::evidence_budget());
        }
        if request
            .note_ids
            .as_ref()
            .is_some_and(|ids| ids.len() > WORK_LIMIT)
            || self.searches.len() >= 32
        {
            return Err(ToolError::work_budget(
                "Search scope or session work budget exceeded",
            ));
        }
        if request.query.len() > 1024 {
            return Err(ToolError::invalid("Query exceeds 1024 bytes"));
        }
        let ids = scope_ids(state, allowed, excluded, &request)?;
        let version = fingerprint(state, &ids)?;
        let limit = request.limit.unwrap_or(8).clamp(1, 20);
        let mut binding = request.clone();
        binding.cursor = None;
        binding.limit = None;
        let binding = serde_json::to_string(&SearchBinding {
            request: binding,
            meaning: serde_json::to_value(&resolved).map_err(|e| e.to_string())?,
        })
        .map_err(|e| e.to_string())?;
        if let Some(cursor) = &request.cursor {
            let (key, offset) = cursor
                .rsplit_once(':')
                .ok_or_else(|| ToolError::invalid("Invalid search cursor"))?;
            let offset: usize = offset
                .parse()
                .map_err(|_| ToolError::invalid("Invalid search cursor"))?;
            let (old_version, old_binding, result_ids, coverage) = self
                .searches
                .get(key)
                .ok_or_else(|| ToolError::stale("Search cursor expired; search again"))?
                .clone();
            if version != old_version || binding != old_binding {
                return Err(ToolError::stale("Search cursor is stale; search again"));
            }
            if result_ids.iter().any(|id| {
                self.candidates.get(id).is_none_or(|c| {
                    validate_citation(state, &c.citation, Some(&ids), excluded).is_none()
                })
            }) {
                return Err(ToolError::stale(
                    "Search cursor evidence is stale; search again",
                ));
            }
            return self.page(key, &result_ids, offset, limit, coverage);
        }
        let period = resolve_period_at(&mut request, &self.anchor)?;
        if request.query.trim().is_empty() && period.is_none() {
            return Err(ToolError::invalid("Provide a query or an activity period"));
        }
        let mut candidates = Vec::new();
        let mut gaps = Vec::<String>::new();
        let mut semantic = "not_requested".to_string();
        let mut lexical = "not_requested".to_string();
        let mut inspected = 0;
        if request.include_history {
            if period.is_none() {
                return Err(ToolError::invalid(
                    "include_history requires activity_range",
                ));
            }
            if !request.query.is_empty()
                && !matches!(request.mode, SearchMode::Literal | SearchMode::Regex)
            {
                return Err(ToolError::invalid("Historical changes support literal or regex content matching; omit query to discover all changes"));
            }
            let pattern = if request.mode == SearchMode::Regex {
                Some(
                    regex::RegexBuilder::new(&request.query)
                        .size_limit(1_000_000)
                        .build()
                        .map_err(|_| ToolError::invalid("Invalid regex"))?,
                )
            } else {
                None
            };
            let timeline = state.note_timeline();
            let scope = AllowedScope::policy(Some(&ids), excluded);
            let access = timeline.activity_history(scope);
            let mut sorted_ids: Vec<_> = ids.iter().collect();
            sorted_ids.sort();
            for id in sorted_ids {
                check_cancelled(&request)?;
                if inspected >= WORK_LIMIT || candidates.len() >= WORK_LIMIT {
                    gaps.push("Historical activity work budget exhausted".into());
                    break;
                }
                inspected += 1;
                let (changes, complete) = match access.changes(
                    &crate::services::note_timeline::NoteIdentity::new(id),
                    request.after.unwrap_or(0),
                    request.before.unwrap_or(u64::MAX),
                ) {
                    Ok(changes) => changes,
                    Err(_) => {
                        gaps.push("Some retained history is unavailable".into());
                        continue;
                    }
                };
                if !complete {
                    gaps.push("Some retained history exceeds the work budget".into());
                }
                let (path, title) = {
                    let index = state.notes_index.lock().map_err(|_| "Notes unavailable")?;
                    let (path, note) = index.get_note_by_note_id(id).ok_or("Note unavailable")?;
                    (path.clone(), note.title.clone())
                };
                let raw = fs::read_to_string(&path).map_err(|_| "Note unavailable")?;
                let current_hash = canonical_content_hash(&raw);
                for change in changes {
                    if !request.query.is_empty()
                        && !pattern.as_ref().map_or_else(
                            || change.text.contains(&request.query),
                            |r| r.is_match(&change.text),
                        )
                    {
                        continue;
                    }
                    let mut start = change.start;
                    for text in passage_slices(&change.text) {
                        if candidates.len() >= WORK_LIMIT {
                            gaps.push("Historical passage budget exhausted".into());
                            break;
                        }
                        let proof = change.proof.clone();
                        let reference = hash(&format!(
                            "history:{id}:{}:{}:{}:{start}:{}:{current_hash}",
                            proof.revision_id,
                            proof.change_kind,
                            change.location,
                            text.len()
                        ));
                        candidates.push(Candidate {
                            citation: PassageCitation {
                                id: reference,
                                note_id: id.clone(),
                                content_hash: current_hash.clone(),
                                location: change.location.clone(),
                                start,
                                end: start + text.len(),
                                excerpt: text.into(),
                                revisions: vec![RevisionCitation {
                                    note_id: id.clone(),
                                    revision_id: proof.revision_id.clone(),
                                    at_millis: proof.recorded_at_millis(),
                                    time_evidence: Some(proof.time_evidence),
                                    source: proof.source,
                                    current_excerpt: text.into(),
                                }],
                                historical: Some(proof.clone()),
                            },
                            path: path.clone(),
                            title: title.clone(),
                            section: "Retained change (line granularity)".into(),
                            score: 1.0,
                            provenance: Some(json!({"kind":"retained_change", "change":proof})),
                            context: String::new(),
                            task: None,
                        });
                        start += text.len();
                    }
                    if start - change.start < change.text.len() {
                        gaps.push("Some retained changed lines exceed the passage budget".into());
                    }
                }
            }
        } else if period.is_some() {
            // Resolve content with the same matcher before bounded timeline work.
            // This temporary session never sends its previews to either model.
            let mut matching = Self::default();
            let activity_ids = if request.query.trim().is_empty() {
                ids.clone()
            } else {
                let mut content_request = request.clone();
                content_request.after = None;
                content_request.before = None;
                content_request.activity_range = None;
                content_request.range_timezone = None;
                content_request.cursor = None;
                let content = matching.search(state, Some(&ids), excluded, content_request)?;
                lexical = content["coverage"]["lexical"]
                    .as_str()
                    .unwrap_or("unavailable")
                    .into();
                semantic = content["coverage"]["semantic"]
                    .as_str()
                    .unwrap_or("unavailable")
                    .into();
                if let Some(items) = content["coverage"]["gaps"].as_array() {
                    gaps.extend(items.iter().filter_map(Value::as_str).map(str::to_owned));
                }
                matching
                    .candidates
                    .values()
                    .map(|c| c.citation.note_id.clone())
                    .collect()
            };
            let access = state.note_timeline();
            let access =
                access.current_content(AllowedScope::policy(Some(&activity_ids), excluded));
            let mut offset = 0;
            loop {
                check_cancelled(&request)?;
                let page = match access.activity(
                    request.after.unwrap_or(0),
                    request.before.unwrap_or(u64::MAX),
                    offset,
                    8,
                ) {
                    Ok(page) => page,
                    Err(_) => {
                        gaps.push("Current activity is pending or unavailable; retry after history recovery".into());
                        break;
                    }
                };
                inspected += page.items.len();
                for item in page.items {
                    for range in item.surviving_ranges {
                        if range.text.trim().is_empty() {
                            continue;
                        }
                        if !request.query.trim().is_empty()
                            && !matching.candidates.values().any(|c| {
                                c.citation.note_id == item.note_id
                                    && c.citation.location == range.location
                                    && c.citation.start < range.end
                                    && c.citation.end > range.start
                            })
                        {
                            continue;
                        }
                        let revisions: Vec<_> = [
                            &range.provenance.introduced_at,
                            &range.provenance.last_changed_at,
                            &range.provenance.restored_at,
                        ]
                        .into_iter()
                        .flatten()
                        .filter_map(|e| {
                            Some(RevisionCitation {
                                note_id: item.note_id.clone(),
                                revision_id: e.record_id.clone(),
                                at_millis: e.at_millis,
                                time_evidence: e.time_evidence,
                                source: e.source?,
                                current_excerpt: range.text.clone(),
                            })
                        })
                        .collect();
                        if revisions.is_empty() {
                            gaps.push(
                                "Some activity has no validated retained range evidence".into(),
                            );
                            continue;
                        }
                        let mut offset = range.start;
                        for text in passage_slices(&range.text) {
                            if candidates.len() >= WORK_LIMIT {
                                gaps.push("Activity passage budget exhausted".into());
                                break;
                            }
                            if let Some(mut candidate) = make_candidate_at(
                                state,
                                &item.note_id,
                                text,
                                &range.location,
                                "Activity",
                                1.0,
                                Some(offset),
                            ) {
                                candidate.citation.revisions = revisions
                                    .iter()
                                    .cloned()
                                    .map(|mut r| {
                                        r.current_excerpt = text.into();
                                        r
                                    })
                                    .collect();
                                candidate.provenance = serde_json::to_value(&range.provenance).ok();
                                candidate.context =
                                    bounded(&range.supporting_context, PREVIEW_BYTES);
                                candidate.task = range
                                    .task
                                    .as_ref()
                                    .and_then(|task| serde_json::to_value(task).ok());
                                candidates.push(candidate);
                            } else {
                                gaps.push("Some surviving activity ranges changed".into());
                            }
                            offset += text.len();
                        }
                    }
                }
                match page.next_offset {
                    Some(next) if next < WORK_LIMIT && candidates.len() < WORK_LIMIT => {
                        offset = next
                    }
                    Some(_) => {
                        gaps.push(
                            "Activity work budget exhausted; narrow the scope or period".into(),
                        );
                        break;
                    }
                    None => break,
                }
            }
        } else {
            let mut ranked = Vec::new();
            if let Ok(index) = state.notes_index.lock() {
                if !state.lexical.evidence_is_current(&index.entries, &ids) {
                    gaps.push("Lexical indexing is pending for some scoped notes".into());
                }
            }
            if matches!(request.mode, SearchMode::Literal | SearchMode::Regex) {
                let regex = if request.mode == SearchMode::Regex {
                    Some(
                        regex::RegexBuilder::new(&request.query)
                            .size_limit(1_000_000)
                            .build()
                            .map_err(|_| {
                                ToolError::invalid("Invalid or oversized regular expression")
                            })?,
                    )
                } else {
                    None
                };
                let index = state
                    .notes_index
                    .lock()
                    .map_err(|_| "Notes index unavailable")?;
                let mut entries: Vec<_> = index
                    .entries
                    .iter()
                    .filter(|(_, n)| ids.contains(&n.note_id))
                    .map(|(p, n)| (p.clone(), n.note_id.clone()))
                    .collect();
                drop(index);
                entries.sort_by(|a, b| a.1.cmp(&b.1));
                let mut work = 0;
                'notes: for (path, id) in entries {
                    check_cancelled(&request)?;
                    inspected += 1;
                    let raw = match fs::read_to_string(path) {
                        Ok(raw) => raw,
                        Err(_) => {
                            gaps.push("A scoped note could not be read".into());
                            continue;
                        }
                    };
                    let parsed = note::parse_note(&raw);
                    let body = parsed.body;
                    work += body.len();
                    if work > 8_000_000 {
                        gaps.push("Literal search work budget exhausted".into());
                        break;
                    }
                    let hits: Box<dyn Iterator<Item = (usize, usize)> + '_> =
                        if let Some(r) = &regex {
                            Box::new(r.find_iter(&body).map(|m| (m.start(), m.end())))
                        } else {
                            Box::new(
                                body.match_indices(&request.query)
                                    .map(|(i, t)| (i, i + t.len())),
                            )
                        };
                    for (start, end) in hits {
                        if candidates.len() >= WORK_LIMIT {
                            gaps.push("Literal match budget exhausted".into());
                            break 'notes;
                        }
                        let mut left = start.saturating_sub(480);
                        while !body.is_char_boundary(left) {
                            left += 1;
                        }
                        let mut right = (end + 480).min(body.len()).min(left + 2400);
                        while !body.is_char_boundary(right) {
                            right -= 1;
                        }
                        if right < end {
                            gaps.push("A match exceeds one passage; narrow the pattern".into());
                        }
                        if let Some(c) = make_candidate_at(
                            state,
                            &id,
                            &body[left..right],
                            "body",
                            "Exact match",
                            1.0,
                            Some(left),
                        ) {
                            candidates.push(c);
                        }
                    }
                }
                lexical = "ready".into();
            } else {
                match state
                    .lexical
                    .evidence_matches(&request.query, &ids, WORK_LIMIT)
                {
                    Ok((items, count)) => {
                        ranked = items;
                        lexical = "ready".into();
                        if count > WORK_LIMIT {
                            gaps.push("Lexical candidate budget exhausted".into());
                        }
                    }
                    Err(_) => {
                        lexical = "error".into();
                        gaps.push("Lexical index unavailable".into());
                    }
                }
            }
            ranked.sort_by(|a, b| {
                b.3.total_cmp(&a.3)
                    .then_with(|| a.0.cmp(&b.0))
                    .then_with(|| a.1.cmp(&b.1))
            });
            for (rank, (id, text, section, _)) in ranked.into_iter().enumerate() {
                let raw = state.notes_index.lock().ok().and_then(|index| {
                    index
                        .get_note_by_note_id(&id)
                        .and_then(|(p, _)| fs::read_to_string(p).ok())
                });
                let Some(raw) = raw else {
                    gaps.push("An indexed note is unavailable".into());
                    continue;
                };
                let body = note::parse_note(&raw).body;
                let Some((start, end)) = current_text_range(&body, &text) else {
                    gaps.push("An indexed passage changed or was ambiguous".into());
                    continue;
                };
                let mut offset = start;
                for text in passage_slices(&body[start..end]) {
                    let relevant = request
                        .query
                        .split_whitespace()
                        .any(|term| text.to_lowercase().contains(&term.to_lowercase()));
                    let score = reciprocal_rank(rank) * if relevant { 1.1 } else { 1.0 };
                    if let Some(c) =
                        make_candidate_at(state, &id, text, "body", &section, score, Some(offset))
                    {
                        candidates.push(c);
                    } else {
                        gaps.push("An indexed passage changed".into());
                    }
                    offset += text.len();
                    if candidates.len() >= WORK_LIMIT {
                        gaps.push("Passage work budget exhausted".into());
                        break;
                    }
                }
                if candidates.len() >= WORK_LIMIT {
                    break;
                }
            }
            if request.mode == SearchMode::Hybrid {
                let status = state.semantic.get_status();
                semantic = match status {
                    Ok(s) if !s.settings.semantic_search_enabled => "disabled",
                    Ok(s) if !s.model_available || !s.ann_index_loaded => "warming",
                    Ok(s) if s.last_error.is_some() => "degraded",
                    Ok(_) => "ready",
                    Err(_) => "unavailable",
                }
                .into();
                if semantic == "ready" || semantic == "degraded" {
                    gaps.push(
                        "Semantic retrieval is approximate; exhaustive coverage is not guaranteed"
                            .into(),
                    );
                    let mut semantic_seen = HashSet::new();
                    let mut width = 64;
                    loop {
                        check_cancelled(&request)?;
                        match state
                            .semantic
                            .semantic_matches_for_text(&request.query, None, width)
                        {
                            Ok(items) => {
                                let count = items.len();
                                let mut rank = 0;
                                for item in items {
                                    let id = state.notes_index.lock().ok().and_then(|index| {
                                        index
                                            .entries
                                            .get(&PathBuf::from(&item.note_path))
                                            .map(|n| n.note_id.clone())
                                    });
                                    let Some(id) = id.filter(|id| ids.contains(id)) else {
                                        continue;
                                    };
                                    if item.document_kind != DocumentKind::Note {
                                        continue;
                                    }
                                    if let Some(c) = make_candidate(
                                        state,
                                        &id,
                                        &item.match_text,
                                        "body",
                                        &item.section_label,
                                        reciprocal_rank(rank),
                                    ) {
                                        // Keep one score per retrieval source while widening.
                                        if semantic_seen.insert(c.citation.id.clone()) {
                                            if let Some(old) =
                                                candidates.iter_mut().find(|old| overlaps(old, &c))
                                            {
                                                old.score += c.score;
                                            } else {
                                                candidates.push(c);
                                            }
                                        }
                                        rank += 1;
                                    }
                                }
                                if count < width {
                                    break;
                                }
                                if width >= WORK_LIMIT {
                                    gaps.push("Semantic candidate coverage is incomplete".into());
                                    break;
                                }
                                width = (width * 4).min(WORK_LIMIT);
                            }
                            Err(_) => {
                                semantic = "error".into();
                                gaps.push(
                                    "Semantic retrieval failed; lexical results remain available"
                                        .into(),
                                );
                                break;
                            }
                        }
                    }
                }
            }
        }
        if inspected == 0 {
            inspected = candidates
                .iter()
                .map(|c| &c.citation.note_id)
                .collect::<HashSet<_>>()
                .len();
        }
        let mut merged: HashMap<String, Candidate> = HashMap::new();
        for c in candidates {
            merged
                .entry(c.citation.id.clone())
                .and_modify(|old| old.score += c.score)
                .or_insert(c);
        }
        let mut candidates: Vec<_> = merged.into_values().collect();
        candidates.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.citation.id.cmp(&b.citation.id))
        });
        let mut distinct: Vec<Candidate> = Vec::new();
        for candidate in candidates {
            if let Some(old) = distinct.iter_mut().find(|old| overlaps(old, &candidate)) {
                // A title-only match must not displace the containing passage.
                if candidate.citation.start <= old.citation.start
                    && candidate.citation.end >= old.citation.end
                {
                    let score = old.score.max(candidate.score);
                    *old = candidate;
                    old.score = score;
                }
            } else {
                distinct.push(candidate);
            }
        }
        distinct.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.citation.id.cmp(&b.citation.id))
        });
        let mut candidates = distinct;
        let timeline = state.note_timeline();
        candidates = timeline
            .current_content(AllowedScope::policy(Some(&ids), excluded))
            .read(|| Ok(candidates))?;
        candidates
            .retain(|c| validate_citation(state, &c.citation, Some(&ids), excluded).is_some());
        check_cancelled(&request)?;
        match semantic.as_str() {
            "disabled" => {
                gaps.push("Semantic search is disabled; results use lexical search only".into())
            }
            "warming" => {
                gaps.push("Semantic search is warming up; results use lexical search only".into())
            }
            "unavailable" => gaps.push(
                "Semantic availability could not be checked; results use lexical search only"
                    .into(),
            ),
            "degraded" => {
                gaps.push("Semantic search is degraded; semantic coverage may be incomplete".into())
            }
            _ => {}
        }
        gaps.sort();
        gaps.dedup();
        // Activity finalization advances timeline state but not canonical bytes.
        if fingerprint(state, &ids)? != version {
            return Err(ToolError::stale("Content changed during search; retry"));
        }
        self.sequence += 1;
        let key = format!("s{}", self.sequence);
        let result_ids: Vec<_> = candidates.iter().map(|c| c.citation.id.clone()).collect();
        for c in candidates {
            self.candidates.insert(c.citation.id.clone(), c);
        }
        let coverage = json!({"historyScope":if request.include_history {"Retained body and property line changes; excludes discarded within-window states, cleared history, title and lifecycle events"} else {"Current content only; activity dates apply to surviving ranges"},"lexical":lexical,"semantic":semantic,"notesInspected":inspected,"notesInspectedMeaning":"Current documents inspected, not the number searched by the lexical index; lexical queries cover the scoped index","notesInScope":ids.len(),"candidatesMatched":result_ids.len(),"gaps":gaps,"complete":gaps.is_empty() && semantic != "error" && semantic != "warming" && semantic != "unavailable" && semantic != "degraded" && semantic != "disabled", "period":period,"scope":{"noteIds":request.note_ids,"folder":request.folder},"budget":{"evidenceBytes":EVIDENCE_BYTES,"usedBytes":self.used()}});
        self.searches.insert(
            key.clone(),
            (version, binding, result_ids.clone(), coverage.clone()),
        );
        if collect_only {
            return Ok(json!({"searchKey":key,"coverage":coverage,"resolvedQuery":resolved}));
        }
        let mut result = self.page(&key, &result_ids, 0, limit, coverage)?;
        result["resolvedQuery"] = serde_json::to_value(resolved).map_err(|e| e.to_string())?;
        Ok(result)
    }

    fn page(
        &mut self,
        key: &str,
        ids: &[String],
        offset: usize,
        limit: usize,
        coverage: Value,
    ) -> Result<Value, ToolError> {
        if offset > ids.len() {
            return Err(ToolError::invalid("Invalid search offset"));
        }
        let mut items = Vec::new();
        let mut next = offset;
        for id in ids.iter().skip(offset).take(limit) {
            let c = self.candidates[id].clone();
            let preview = bounded(&c.citation.excerpt, PREVIEW_BYTES);
            if !self.reserve(
                preview.len()
                    + c.title.len().min(240)
                    + c.section.len().min(160)
                    + c.task.as_ref().map_or(0, |task| task.to_string().len())
                    + 256,
            ) {
                break;
            }
            next += 1;
            self.admit(c.citation.clone());
            items.push(json!({"evidenceId":id,"noteId":c.citation.note_id,"title":bounded(&c.title,240),"section":bounded(&c.section,160),"preview":preview,"score":c.score,"location":c.citation.location,"hasTemporalEvidence":c.provenance.is_some(),"sourceKind":if c.citation.historical.is_some() {"retained_note_change"} else {"current_note"},"historical":c.citation.historical,"task":c.task}));
        }
        Ok(
            json!({"status":"ready","items":items,"nextCursor":(next<ids.len()).then(|| format!("{key}:{next}")),"truncated":next<ids.len(),"budgetExhausted":next==offset && next<ids.len(),"delivery":{"complete":next>=ids.len(),"hasMore":next<ids.len()},"coverage":coverage}),
        )
    }

    #[cfg(test)]
    pub(crate) fn read(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        ids: &[String],
        include_provenance: bool,
    ) -> Result<(Value, Vec<(PassageCitation, PathBuf, String)>), ToolError> {
        self.read_page(state, allowed, excluded, ids, include_provenance, 0)
    }
    #[cfg(test)]
    pub(crate) fn read_page(
        &mut self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        ids: &[String],
        include_provenance: bool,
        provenance_offset: usize,
    ) -> Result<(Value, Vec<(PassageCitation, PathBuf, String)>), ToolError> {
        if ids.len() > 8 {
            return Err(ToolError::invalid(
                "Read at most eight evidence IDs per call",
            ));
        }
        self.deliver_read(
            state,
            allowed,
            excluded,
            reads::ReadContinuation::selection(ids, include_provenance, provenance_offset),
            reads::ReadPresentation::Normal,
        )
    }
    fn prepare_read_item(
        &self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
        id: &str,
        include_provenance: bool,
        provenance_offset: usize,
    ) -> Result<(Value, PassageCitation, PathBuf, String), ToolError> {
        let mut c = self
            .candidates
            .get(id)
            .ok_or_else(|| ToolError::invalid("Unknown evidence ID; search first"))?
            .clone();
        let mut next_provenance_offset = None;
        if include_provenance
            && c.provenance.is_none()
            && c.citation.historical.is_none()
            && c.citation.location != "title"
        {
            let timeline = state.note_timeline();
            let access = timeline.current_content(AllowedScope::policy(allowed, excluded));
            let current = access
                .provenance(&crate::services::note_timeline::NoteIdentity::new(
                    &c.citation.note_id,
                ))
                .map_err(|_| ToolError::provenance("Current provenance is pending or unavailable"))?
                .ok_or_else(|| ToolError::provenance("Current provenance is unavailable"))?;
            let lines = if c.citation.location == "properties" {
                &current.properties
            } else {
                &current.body
            };
            let mut offset = 0;
            // Group equal provenance across disjoint ranges before paging;
            // otherwise per-word lineage repeats the same dates excessively.
            let mut groups: Vec<(Value, Vec<Value>, Vec<RevisionCitation>)> = Vec::new();
            for line in lines {
                for range in &line.ranges {
                    let start = offset + range.start;
                    let end = offset + range.end;
                    if start >= c.citation.end || end <= c.citation.start {
                        continue;
                    }
                    let p = &range.provenance;
                    let value = serde_json::to_value(p).map_err(|e| e.to_string())?;
                    let span =
                        json!({"start":start.max(c.citation.start),"end":end.min(c.citation.end)});
                    if let Some((_, spans, _)) = groups.iter_mut().find(|(v, _, _)| *v == value) {
                        spans.push(span);
                    } else {
                        let proofs = [&p.introduced_at, &p.last_changed_at, &p.restored_at]
                            .into_iter()
                            .flatten()
                            .chain(std::iter::once(&p.known_since))
                            .filter_map(|e| {
                                Some(RevisionCitation {
                                    note_id: c.citation.note_id.clone(),
                                    revision_id: e.record_id.clone(),
                                    at_millis: e.at_millis,
                                    time_evidence: e.time_evidence,
                                    source: e.source?,
                                    current_excerpt: c.citation.excerpt.clone(),
                                })
                            })
                            .collect();
                        groups.push((value, vec![span], proofs));
                    }
                }
                offset += line.text.len();
            }
            let mut ranges = Vec::new();
            let mut provenance_bytes = 0;
            for (index, (provenance, spans, proofs)) in
                groups.into_iter().enumerate().skip(provenance_offset)
            {
                let entry = json!({"ranges":spans,"provenance":provenance});
                let size = entry.to_string().len();
                if provenance_bytes + size > 2800 {
                    if ranges.is_empty() {
                        return Err(ToolError::provenance(
                            "A provenance group exceeds the read budget; use a narrower passage",
                        ));
                    }
                    next_provenance_offset = Some(index);
                    break;
                }
                provenance_bytes += size;
                ranges.push(entry);
                c.citation.revisions.extend(proofs);
            }
            c.provenance = Some(json!(ranges));
        }
        let Some((path, title)) = validate_citation(state, &c.citation, allowed, excluded) else {
            return Err(ToolError::stale(
                "Evidence changed or is no longer allowed; search again",
            ));
        };
        let task_dates = if c.citation.location == "body" && c.citation.historical.is_none() {
            let raw = fs::read_to_string(&path)
                .map_err(|_| ToolError::stale("Note changed while reading task deadlines"))?;
            if canonical_content_hash(&raw) != c.citation.content_hash {
                return Err(ToolError::stale(
                    "Note changed while reading task deadlines",
                ));
            }
            Some(crate::services::task_dates::passage_task_dates(
                &body_at(&raw, &title, "body"),
                c.citation.start,
                c.citation.end,
            ))
        } else {
            None
        };
        let mut item = json!({"evidenceId":id,"noteId":c.citation.note_id,"title":title,"location":c.citation.location,"start":c.citation.start,"end":c.citation.end,"contentHash":c.citation.content_hash,"excerpt":c.citation.excerpt,"supportingContext":c.context,"provenance":c.provenance,"task":c.task,"sourceKind":if c.citation.historical.is_some() {"retained_note_change"} else {"current_note"},"historical":c.citation.historical,"evidenceRole":if c.citation.historical.is_some() || c.section == "Activity" {"changed_passage"} else {"current_context"},"nextProvenanceOffset":next_provenance_offset,"citation":format!("[{}](passage:{id})",title)});
        if let Some(metadata) = task_dates.filter(|value| !value.is_null()) {
            item["taskDates"] = metadata;
        }
        Ok((item, c.citation, path, title))
    }

    pub(crate) fn is_current(
        &self,
        state: &AppState,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
    ) -> bool {
        let mut versions = HashMap::<Vec<String>, String>::new();
        self.admitted
            .values()
            .all(|c| validate_citation(state, c, allowed, excluded).is_some())
            && self.searches.values().all(|(version, binding, _, _)| {
                let Some(ids) = serde_json::from_str::<SearchBinding>(binding)
                    .ok()
                    .and_then(|r| scope_ids(state, allowed, excluded, &r.request).ok())
                else {
                    return false;
                };
                let mut key: Vec<_> = ids.iter().cloned().collect();
                key.sort();
                // Only share disk work within this validation pass. The next
                // boundary must observe edits and permission changes again.
                let current = if let Some(current) = versions.get(&key) {
                    current
                } else {
                    let Ok(current) = fingerprint(state, &ids) else {
                        return false;
                    };
                    versions.entry(key).or_insert(current)
                };
                current == version
            })
    }
}

fn overlaps(a: &Candidate, b: &Candidate) -> bool {
    let (a, b) = (&a.citation, &b.citation);
    a.note_id == b.note_id
        && a.historical == b.historical
        && a.location == b.location
        && a.end.min(b.end).saturating_sub(a.start.max(b.start)) * 2
            > (a.end - a.start).min(b.end - b.start)
}
fn passage_slices(text: &str) -> Vec<&str> {
    let mut slices = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + 2400).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        slices.push(&text[start..end]);
        start = end;
        if slices.len() >= WORK_LIMIT {
            break;
        }
    }
    slices
}

fn reciprocal_rank(rank: usize) -> f32 {
    1.0 / (60.0 + rank as f32 + 1.0)
}

// Tantivy paragraphs collapse whitespace for ranking. Recover exact canonical
// bytes with a correspondence map; never deliver the normalized index string.
fn current_text_range(body: &str, excerpt: &str) -> Option<(usize, usize)> {
    let exact: Vec<_> = body.match_indices(excerpt).take(2).collect();
    if exact.len() == 1 {
        return Some((exact[0].0, exact[0].0 + excerpt.len()));
    }
    if exact.len() > 1 {
        return None;
    }
    let mut normalized = String::new();
    let mut ranges: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut was_space = false;
    for (offset, ch) in body.char_indices() {
        if ch.is_whitespace() && was_space {
            if let Some(last) = ranges.last_mut() {
                last.3 = offset + ch.len_utf8();
            }
            continue;
        }
        let before = normalized.len();
        normalized.push(if ch.is_whitespace() { ' ' } else { ch });
        ranges.push((before, normalized.len(), offset, offset + ch.len_utf8()));
        was_space = ch.is_whitespace();
    }
    let needle = excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
    if needle.is_empty() {
        return None;
    }
    let hits: Vec<_> = normalized.match_indices(&needle).take(2).collect();
    if hits.len() != 1 {
        return None;
    }
    let start = hits[0].0;
    let end = start + needle.len();
    Some((
        ranges.iter().find(|r| r.0 == start)?.2,
        ranges.iter().find(|r| r.1 == end)?.3,
    ))
}

fn make_candidate(
    state: &AppState,
    id: &str,
    excerpt: &str,
    location: &str,
    section: &str,
    score: f32,
) -> Option<Candidate> {
    make_candidate_at(state, id, excerpt, location, section, score, None)
}
fn make_candidate_at(
    state: &AppState,
    id: &str,
    excerpt: &str,
    location: &str,
    section: &str,
    score: f32,
    exact_start: Option<usize>,
) -> Option<Candidate> {
    if excerpt.trim().is_empty() {
        return None;
    }
    let (path, title) = {
        let index = state.notes_index.lock().ok()?;
        let (p, n) = index.get_note_by_note_id(id)?;
        (p.clone(), n.title.clone())
    };
    let raw = fs::read_to_string(&path).ok()?;
    let body = body_at(&raw, &title, location);
    // Paragraphs can be arbitrarily long. Split into bounded exact passages;
    // initial candidate takes a bounded prefix without splitting UTF-8.
    let excerpt = bounded(excerpt, 2400);
    let (start, end) = if let Some(start) = exact_start {
        let end = start.checked_add(excerpt.len())?;
        if body.get(start..end)? != excerpt {
            return None;
        }
        (start, end)
    } else {
        current_text_range(&body, &excerpt)?
    };
    let excerpt = bounded(&body[start..end], 2400);
    let end = start + excerpt.len();
    let content_hash = canonical_content_hash(&raw);
    let reference = hash(&format!("{id}:{content_hash}:{location}:{start}:{end}"));
    Some(Candidate {
        citation: PassageCitation {
            historical: None,
            id: reference,
            note_id: id.into(),
            content_hash,
            location: location.into(),
            start,
            end,
            excerpt,
            revisions: vec![],
        },
        path,
        title,
        section: section.into(),
        score,
        provenance: None,
        context: String::new(),
        task: None,
    })
}

pub(crate) fn editor_passage_navigation(
    raw: &str,
    title: &str,
    passage: &PassageCitation,
) -> (String, Option<Value>) {
    let (_, markdown) = note::extract_file_name_title_and_body(raw, title);
    let body = note::parse_note(raw).body;
    let selection = (|| {
        if passage.location != "body" {
            return None;
        }
        let base = body.find(&markdown)?;
        let start = passage.start.checked_sub(base)?;
        let end = passage.end.checked_sub(base)?;
        if markdown.get(start..end)? != passage.excerpt {
            return None;
        }
        Some(
            json!({"anchor":markdown[..start].encode_utf16().count(),"head":markdown[..end].encode_utf16().count()}),
        )
    })();
    (markdown, selection)
}

pub(crate) fn validate_citation(
    state: &AppState,
    citation: &PassageCitation,
    allowed: Option<&HashSet<String>>,
    excluded: &HashSet<String>,
) -> Option<(PathBuf, String)> {
    if excluded.contains(&citation.note_id)
        || allowed.is_some_and(|ids| !ids.contains(&citation.note_id))
    {
        return None;
    }
    let (path, title) = {
        let index = state.notes_index.lock().ok()?;
        let (p, n) = index.get_note_by_note_id(&citation.note_id)?;
        if n.document_kind != DocumentKind::Note {
            return None;
        }
        (p.clone(), n.title.clone())
    };
    let raw = fs::read_to_string(&path).ok()?;
    if note::parse_note(&raw)
        .frontmatter
        .managed
        .as_ref()
        .is_some_and(|m| m.id != citation.note_id || m.kind != DocumentKind::Note)
    {
        return None;
    }
    if canonical_content_hash(&raw) != citation.content_hash {
        return None;
    }
    if let Some(proof) = &citation.historical {
        let timeline = state.note_timeline();
        let access = timeline.activity_history(AllowedScope::policy(allowed, excluded));
        return access
            .validate(
                &crate::services::note_timeline::NoteIdentity::new(&citation.note_id),
                proof,
                &citation.location,
                citation.start,
                citation.end,
                &citation.excerpt,
            )
            .ok()?
            .then_some((path, title));
    }
    if body_at(&raw, &title, &citation.location).get(citation.start..citation.end)?
        != citation.excerpt
    {
        return None;
    }
    let timeline = state.note_timeline();
    let access = timeline.current_content(AllowedScope::policy(allowed, excluded));
    let target = Candidate {
        citation: citation.clone(),
        path: path.clone(),
        title: title.clone(),
        section: String::new(),
        score: 0.0,
        provenance: None,
        context: String::new(),
        task: None,
    };
    if access.read(|| Ok(vec![target])).ok()?.is_empty() {
        return None;
    }
    if !citation.revisions.is_empty()
        && access.current_citations(&citation.revisions).ok()?.len() != citation.revisions.len()
    {
        return None;
    }
    if fs::read_to_string(&path).ok().as_deref() != Some(raw.as_str()) {
        return None;
    }
    Some((path, title))
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_evaluation;
