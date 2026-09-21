use super::*;

#[cfg(test)]
thread_local! {
    static AFTER_SELECTION: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = Default::default();
}
#[cfg(test)]
pub(super) fn after_selection_once(callback: impl FnOnce() + 'static) {
    AFTER_SELECTION.with(|hook| *hook.borrow_mut() = Some(Box::new(callback)));
}

/// Evidence carries current text only; revision payloads and labels stay private.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevisionCitation {
    pub(crate) note_id: String,
    pub(crate) revision_id: String,
    pub(crate) at_millis: u64,
    // Absent in durable citations written before interval evidence existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) time_evidence: Option<RevisionTimeEvidence>,
    pub(crate) source: MutationSource,
    pub(crate) current_excerpt: String,
}

/// The matching range is activity evidence; the surrounding line is only
/// supporting current context and must not be described as edited in the period.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SurvivingActivityRange {
    pub(crate) location: String,
    pub(crate) line_number: usize,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) text: String,
    pub(crate) supporting_context: String,
    pub(crate) provenance: provenance::RangeProvenance,
    pub(crate) task: Option<TaskActivityContext>,
}

/// Current task facts, kept separate from the edited word's lineage. In
/// particular, changing task wording does not date its completion checkbox.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskActivityContext {
    text: String,
    text_truncated: bool,
    current_status: &'static str,
    status_marker_changed_in_period: Option<bool>,
    status_marker_time: Option<RevisionTimeEvidence>,
    status_marker_time_uncertain: bool,
    status_marker_restored_in_period: bool,
    matched_range_includes_status_marker: bool,
}

fn task_context(
    line: &provenance::ProvenanceLine,
    after: u64,
    before: u64,
) -> Option<(usize, TaskActivityContext)> {
    let (completed, text, _) = crate::index::parse_task_line(&line.text)?;
    let marker = line.text.len() - line.text.trim_start().len() + 3;
    let lineage = line.task_status_provenance.as_ref()?;
    // A replaced checkbox can preserve the authored range's introduction.
    // Its latest change dates the current marker; knownSince is never a fallback.
    let time = lineage
        .last_changed_at
        .as_ref()
        .and_then(|e| e.time_evidence);
    let uncertain = time.is_some_and(|t| {
        let (start, end) = t.bounds();
        t.uncertain() || (t.overlaps(after, before) && (start < after || end >= before))
    });
    Some((
        marker,
        TaskActivityContext {
            text: text.chars().take(240).collect(),
            text_truncated: text.chars().count() > 240,
            current_status: if completed { "completed" } else { "open" },
            // Search admits interval overlap, but this fact answers a stronger
            // question. A boundary-crossing interval cannot truthfully say yes.
            status_marker_changed_in_period: time
                .filter(|_| !uncertain)
                .map(|t| t.overlaps(after, before)),
            status_marker_time: time,
            status_marker_time_uncertain: uncertain,
            status_marker_restored_in_period: lineage
                .restored_at
                .as_ref()
                .and_then(|e| e.time_evidence)
                .is_some_and(|restored| {
                    restored.overlaps(after, before)
                        && time.is_none_or(|changed| {
                            changed.uncertain()
                                || restored.uncertain()
                                || changed.bounds().0 <= restored.bounds().1
                        })
                }),
            matched_range_includes_status_marker: false,
        },
    ))
}

fn surviving_ranges(
    current: &provenance::CurrentContentProvenance,
    after: u64,
    before: u64,
) -> Vec<SurvivingActivityRange> {
    let mut result = Vec::new();
    for (location, lines) in [("body", &current.body), ("properties", &current.properties)] {
        let mut offset = 0;
        for line in lines {
            let task = (location == "body")
                .then(|| task_context(line, after, before))
                .flatten();
            for range in &line.ranges {
                let p = &range.provenance;
                if [&p.introduced_at, &p.last_changed_at, &p.restored_at]
                    .into_iter()
                    .flatten()
                    .any(|e| e.time_evidence.is_some_and(|t| t.overlaps(after, before)))
                {
                    if let Some(text) = line.text.get(range.start..range.end) {
                        result.push(SurvivingActivityRange {
                            location: location.into(),
                            line_number: line.line_number,
                            start: offset + range.start,
                            end: offset + range.end,
                            text: text.into(),
                            supporting_context: line.text.clone(),
                            provenance: p.clone(),
                            task: task.as_ref().map(|(marker, context)| {
                                let mut context = context.clone();
                                context.matched_range_includes_status_marker =
                                    range.start <= *marker && *marker < range.end;
                                context
                            }),
                        });
                    }
                }
            }
            offset += line.text.len();
        }
    }
    result
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteActivity {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) current_excerpt: String,
    pub(crate) revision_count: usize,
    pub(crate) surviving_ranges: Vec<SurvivingActivityRange>,
    pub(crate) uncertain_time: bool,
    pub(crate) first_at_millis: u64,
    pub(crate) last_at_millis: u64,
    pub(crate) sources: Vec<MutationSource>,
    pub(crate) citations: Vec<RevisionCitation>,
}

impl CurrentContentItem for NoteActivity {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        CurrentContentIdentity::Note {
            note_id: Some(&self.note_id),
            note_path: Some(&self.note_path),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityPage {
    pub(crate) items: Vec<NoteActivity>,
    pub(crate) next_offset: Option<usize>,
}

fn records(
    store: &history_store::Store,
    note_id: &NoteIdentity,
) -> Result<Vec<history_store::BoundedTimelineRecord>, HistoryError> {
    let mut result = Vec::new();
    let mut cursor = None;
    loop {
        let Some(page) = history_store::bounded_timeline_page(store, note_id, cursor, 100)? else {
            break;
        };
        result.extend(page.records);
        cursor = page.next_record;
        if cursor.is_none() {
            break;
        }
    }
    Ok(result)
}

fn headers(
    store: &history_store::Store,
    note_id: &NoteIdentity,
) -> Result<Vec<NoteRevisionHeader>, HistoryError> {
    Ok(records(store, note_id)?
        .into_iter()
        .filter_map(|record| match record {
            history_store::BoundedTimelineRecord::Revision { header, .. } => Some(header),
            _ => None,
        })
        .collect())
}

fn citation(
    note_id: &NoteIdentity,
    header: &NoteRevisionHeader,
    excerpt: &str,
) -> RevisionCitation {
    RevisionCitation {
        note_id: note_id.0.clone(),
        revision_id: header.identity.0.clone(),
        at_millis: header.time_evidence.occurred_at_millis(),
        time_evidence: Some(header.time_evidence),
        source: header.source,
        current_excerpt: excerpt.chars().take(2_000).collect(),
    }
}

pub(super) fn read(
    access: &CurrentContentAccess<'_>,
    after: u64,
    before: u64,
    offset: usize,
    limit: usize,
) -> Result<ActivityPage, HistoryError> {
    if after >= before {
        return Err(HistoryError::Ineligible(
            "The activity period must be nonempty".into(),
        ));
    }
    let eligible_ids = || -> Result<Vec<String>, HistoryError> {
        let eligibility = access.eligibility()?;
        let mut ids: Vec<_> = eligibility
            .active_notes
            .keys()
            .filter(|id| eligibility.allows_note(Some(id.as_str()), None))
            .cloned()
            .collect();
        ids.sort();
        Ok(ids)
    };
    let (ids, selected, scanned, selection_version) = {
        let (_operation, _) = access.prepare_read().map_err(history_failure)?;
        let timeline = access.state.note_timeline();
        timeline.recover_retained_observations()?;
        timeline.ensure_history_recovered()?;
        let ids = eligible_ids()?;
        let selection_version = access.runtime.current_content_version()?;
        let limit = limit.clamp(1, 20);
        let mut selected = Vec::new();
        let mut scanned = offset.min(ids.len());
        // Cursor counts eligible note positions, including nonmatching/no-op notes.
        // Filtering or dropping a no-op cannot shift a later page past another note.
        for id in ids.iter().skip(scanned) {
            scanned += 1;
            let id = NoteIdentity::new(id);
            let retained_match = {
                access.runtime.ensure_note_ready(&id)?;
                headers(&access.runtime.store, &id)?
            }
            .iter()
            .any(|h| h.time_evidence.overlaps(after, before));
            let pending_match = history_store::pending_window(&access.runtime.store, &id)?
                .is_some_and(|w| w.evidence.time_evidence().overlaps(after, before));
            if retained_match || pending_match {
                let eligibility = access.eligibility()?;
                let Some(path) = eligibility.active_notes.get(id.as_str()) else {
                    continue;
                };
                let Ok(canonical) = fs::read_to_string(path) else {
                    continue;
                };
                let parsed = crate::note::parse_note(&canonical);
                if parsed.frontmatter.managed.as_ref().is_some_and(|m| {
                    m.id != id.as_str() || m.kind != crate::note::DocumentKind::Note
                }) || history_store::current_content_hash(&access.runtime.store, &id)?.as_deref()
                    != Some(history_store::authored_content_hash(&canonical).as_str())
                {
                    continue;
                }
                selected.push((id, path.clone(), canonical));
                if selected.len() == limit {
                    break;
                }
            }
        }
        if !access
            .runtime
            .current_content_is_current(selection_version)?
            || eligible_ids()? != ids
        {
            return Err(HistoryError::Stale(
                "Activity candidates changed; retry the page".into(),
            ));
        }
        (ids, selected, scanned, selection_version)
    };
    // Release the selection lease before acquiring the file owner. Close owns
    // that same owner while it drains leases.
    let (_operation, ids, selected, scanned, version) =
        crate::state::with_note_file_mutation(|| {
            let (_operation, _) = access.prepare_read().map_err(history_failure)?;
            if !access
                .runtime
                .current_content_is_current(selection_version)?
                || eligible_ids()? != ids
            {
                return Err(HistoryError::Stale(
                    "Activity candidates changed; retry the page".into(),
                ));
            }
            for (_, path, canonical) in &selected {
                if fs::read_to_string(path).ok().as_ref() != Some(canonical) {
                    return Err(HistoryError::Stale(
                        "Activity candidate bytes changed; retry the page".into(),
                    ));
                }
            }
            // Seal all candidates first: each boundary advances the shared mutation
            // generation. Snapshots taken before the final boundary would be stale.
            for (id, _, _) in &selected {
                access.finalize_evidence_target_owned(id)?;
            }
            let version = access.runtime.current_content_version()?;
            Ok::<_, HistoryError>((_operation, ids, selected, scanned, version))
        })?;
    #[cfg(test)]
    AFTER_SELECTION.with(|hook| {
        if let Some(callback) = hook.borrow_mut().take() {
            callback();
        }
    });
    let mut items = Vec::new();
    let mut snapshots = Vec::new();
    for (id, path, canonical) in &selected {
        if fs::read_to_string(path).ok().as_ref() != Some(canonical) {
            return Err(HistoryError::Stale(
                "Activity candidate bytes changed; retry the page".into(),
            ));
        }
        let read = match provenance::read_with_version(access, &id) {
            Ok(Some(read)) => read,
            Ok(None) => {
                return Err(HistoryError::Stale(
                    "Activity candidate became ineligible; retry the page".into(),
                ))
            }
            Err(error) => return Err(error),
        };
        let current = &read.current;
        let revisions: Vec<_> = {
            access.runtime.ensure_note_ready(&id)?;
            headers(&access.runtime.store, &id)?
        }
        .into_iter()
        .filter(|h| h.time_evidence.overlaps(after, before))
        .collect();
        if revisions.is_empty() {
            snapshots.push(read);
            continue;
        }
        let eligibility = access.eligibility()?;
        let Some(path) = eligibility.active_notes.get(id.as_str()) else {
            return Err(HistoryError::Stale(
                "Activity candidate became ineligible".into(),
            ));
        };
        let excerpt: String = current
            .body
            .iter()
            .flat_map(|line| line.text.chars())
            .take(2_000)
            .collect();
        let mut sources = Vec::new();
        for header in &revisions {
            if !sources.contains(&header.source) {
                sources.push(header.source);
            }
        }
        items.push(NoteActivity {
            note_id: id.0.clone(),
            note_path: path.to_string_lossy().into_owned(),
            title: current.title.clone(),
            current_excerpt: excerpt.clone(),
            revision_count: revisions.len(),
            surviving_ranges: surviving_ranges(current, after, before),
            uncertain_time: revisions.iter().any(|h| h.time_evidence.uncertain()),
            first_at_millis: revisions
                .iter()
                .map(|h| h.time_evidence.bounds().0)
                .min()
                .unwrap(),
            last_at_millis: revisions
                .iter()
                .map(|h| h.time_evidence.bounds().1)
                .max()
                .unwrap(),
            sources,
            citations: revisions
                .iter()
                .take(20)
                .map(|header| citation(&id, header, &excerpt))
                .collect(),
        });
        snapshots.push(read);
    }
    if eligible_ids()? != ids
        || !access.runtime.current_content_is_current(version)?
        || selected
            .iter()
            .any(|(_, path, canonical)| fs::read_to_string(path).ok().as_ref() != Some(canonical))
        || snapshots
            .iter()
            .any(|read| !read.is_current(access).unwrap_or(false))
    {
        return Err(HistoryError::Stale(
            "Activity changed; retry the page".into(),
        ));
    }
    Ok(ActivityPage {
        items,
        next_offset: (scanned < ids.len()).then_some(scanned),
    })
}

pub(super) fn current_citations(
    access: &CurrentContentAccess<'_>,
    citations: &[RevisionCitation],
) -> Result<Vec<RevisionCitation>, HistoryError> {
    // Delivery/branch hydration must not create an Editing Window boundary.
    // Validate against canonical captured bytes, which may be a pending endpoint,
    // and retained immutable headers independently of the provenance projection.
    let (_operation, _) = access.prepare_read().map_err(history_failure)?;
    let timeline = access.state.note_timeline();
    timeline
        .runtime
        .with_observation_replay(|| {
            timeline.replay_retained_observations(None)?;
            timeline.ensure_history_recovered()
        })
        .map_err(history_failure)?;
    let version = access.runtime.current_content_version()?;
    let mut grouped = HashMap::<&str, Vec<&RevisionCitation>>::new();
    for citation in citations {
        grouped.entry(&citation.note_id).or_default().push(citation);
    }
    let mut candidates = Vec::new();
    let mut snapshots = Vec::new();
    for (note_id, group) in grouped {
        let id = NoteIdentity::new(note_id);
        let eligibility = access.eligibility()?;
        if !eligibility.allows_note(Some(note_id), None) {
            continue;
        }
        let path = eligibility.active_notes[note_id].clone();
        let Ok(canonical) = fs::read_to_string(&path) else {
            continue;
        };
        let parsed = crate::note::parse_note(&canonical);
        if parsed
            .frontmatter
            .managed
            .as_ref()
            .is_some_and(|m| m.id != note_id || m.kind != crate::note::DocumentKind::Note)
            || history_store::current_content_hash(&access.runtime.store, &id)?.as_deref()
                != Some(history_store::authored_content_hash(&canonical).as_str())
        {
            continue;
        }
        let title = path.file_stem().unwrap_or_default().to_string_lossy();
        let authored = history_store::authored_content(&canonical);
        let retained = {
            access.runtime.ensure_note_ready(&id)?;
            headers(&access.runtime.store, &id)?
        };
        for citation in group {
            let excerpt = &citation.current_excerpt;
            let present = authored.body.contains(excerpt)
                || authored
                    .unmanaged_frontmatter
                    .as_deref()
                    .unwrap_or_default()
                    .contains(excerpt)
                || title.contains(excerpt);
            if present
                && retained.iter().any(|h| {
                    h.identity.as_str() == citation.revision_id
                        && h.source == citation.source
                        && h.time_evidence.occurred_at_millis() == citation.at_millis
                        && citation.time_evidence == Some(h.time_evidence)
                })
            {
                candidates.push(citation.clone());
            }
        }
        snapshots.push((note_id.to_string(), path, canonical));
    }
    for (id, path, canonical) in snapshots {
        if fs::read_to_string(&path).ok().as_ref() != Some(&canonical)
            || !access.eligibility()?.allows_note(Some(&id), path.to_str())
        {
            candidates.retain(|citation| citation.note_id != id);
        }
    }
    if !access.runtime.current_content_is_current(version)? {
        candidates.clear();
    }
    Ok(candidates)
}
