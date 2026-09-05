use super::*;

/// Evidence carries current text only; revision payloads and labels stay private.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevisionCitation {
    pub(crate) note_id: String,
    pub(crate) revision_id: String,
    pub(crate) at_millis: u64,
    pub(crate) source: MutationSource,
    pub(crate) current_excerpt: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteActivity {
    pub(crate) note_id: String,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) current_excerpt: String,
    pub(crate) revision_count: usize,
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
    note_id: &NoteIdentity,
) -> Result<Vec<history_store::BoundedTimelineRecord>, HistoryError> {
    let mut result = Vec::new();
    let mut cursor = None;
    loop {
        let Some(page) = history_store::bounded_timeline_page(note_id, cursor, 100)? else {
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

fn headers(note_id: &NoteIdentity) -> Result<Vec<NoteRevisionHeader>, HistoryError> {
    Ok(records(note_id)?
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
    if after > before {
        return Err(HistoryError::Ineligible(
            "The activity period ends before it starts".into(),
        ));
    }
    let (_operation, _) = access.prepare_read().map_err(history_failure)?;
    let mut ids: Vec<_> = access.eligibility()?.active_notes.keys().cloned().collect();
    ids.sort();
    let mut items = Vec::new();
    let mut snapshots = HashMap::new();
    for id in ids {
        let id = NoteIdentity::new(id);
        if !access.scope.allows(&id) {
            continue;
        }
        let read = match provenance::read_with_version(access, &id) {
            Ok(Some(current)) => current,
            Ok(None) | Err(HistoryError::Stale(_)) => continue,
            Err(error) => return Err(error),
        };
        let current = &read.current;
        let revisions: Vec<_> = headers(&id)?
            .into_iter()
            .filter(|header| {
                let at = header.time_evidence.occurred_at_millis();
                at >= after && at <= before
            })
            .collect();
        if revisions.is_empty() {
            continue;
        }
        let eligibility = access.eligibility()?;
        let Some(path) = eligibility.active_notes.get(id.as_str()) else {
            continue;
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
            first_at_millis: revisions
                .iter()
                .map(|h| h.time_evidence.occurred_at_millis())
                .min()
                .unwrap(),
            last_at_millis: revisions
                .iter()
                .map(|h| h.time_evidence.occurred_at_millis())
                .max()
                .unwrap(),
            sources,
            citations: revisions
                .iter()
                .take(20)
                .map(|header| citation(&id, header, &excerpt))
                .collect(),
        });
        snapshots.insert(id.0, read);
    }
    items.retain(|item| {
        snapshots
            .get(&item.note_id)
            .is_some_and(|read| read.is_current(access).unwrap_or(false))
    });
    let limit = limit.clamp(1, 20);
    let next_offset =
        (items.len() > offset.saturating_add(limit)).then(|| offset.saturating_add(limit));
    Ok(ActivityPage {
        items: items.into_iter().skip(offset).take(limit).collect(),
        next_offset,
    })
}

/// Bind only evidence attached to the delivered current ranges. This cannot be
/// used to request an arbitrary historical excerpt or a revision payload.
pub(super) fn provenance_citations(
    access: &CurrentContentAccess<'_>,
    current: &provenance::CurrentContentProvenance,
) -> Result<Vec<RevisionCitation>, HistoryError> {
    let id = NoteIdentity::new(current.note_id.clone());
    let headers = headers(&id)?;
    let mut citations = Vec::new();
    for line in current.body.iter().chain(&current.properties) {
        for range in &line.ranges {
            let p = &range.provenance;
            for evidence in [
                p.introduced_at.as_ref(),
                p.last_changed_at.as_ref(),
                p.restored_at.as_ref(),
                Some(&p.known_since),
            ]
            .into_iter()
            .flatten()
            {
                if let Some(header) = headers
                    .iter()
                    .find(|h| h.identity.as_str() == evidence.record_id)
                {
                    if !citations
                        .iter()
                        .any(|c: &RevisionCitation| c.revision_id == header.identity.as_str())
                    {
                        citations.push(citation(&id, header, &line.text[range.start..range.end]));
                    }
                }
            }
        }
    }
    // A title Lifecycle Event points to its preceding revision in timeline
    // order. Wall-clock order may disagree with external observation evidence.
    let ordered = records(&id)?;
    let title_record = &current.title_provenance.known_since.record_id;
    let title_index = ordered.iter().position(|record| match record {
        history_store::BoundedTimelineRecord::Revision { header, .. } => {
            header.identity.as_str() == title_record
        }
        history_store::BoundedTimelineRecord::LifecycleEvent(event) => {
            event.identity.0.as_str() == title_record
        }
    });
    let supporting = title_index.and_then(|index| {
        ordered[index..].iter().find_map(|record| match record {
            history_store::BoundedTimelineRecord::Revision { header, .. } => Some(header),
            _ => None,
        })
    });
    if let Some(header) = supporting {
        if !citations
            .iter()
            .any(|c| c.revision_id == header.identity.as_str())
        {
            citations.push(citation(&id, header, &current.title));
        }
    }
    if !access
        .eligibility()?
        .allows_note(Some(&current.note_id), None)
    {
        citations.clear();
    }
    Ok(citations)
}

pub(super) fn current_citations(
    access: &CurrentContentAccess<'_>,
    citations: &[RevisionCitation],
) -> Result<Vec<RevisionCitation>, HistoryError> {
    let mut grouped = HashMap::<&str, Vec<&RevisionCitation>>::new();
    for citation in citations {
        grouped.entry(&citation.note_id).or_default().push(citation);
    }
    let mut candidates = Vec::new();
    let mut snapshots = Vec::new();
    for (note_id, group) in grouped {
        let id = NoteIdentity::new(note_id.to_string());
        let read = match provenance::read_with_version(access, &id) {
            Ok(Some(read)) => read,
            _ => continue,
        };
        let body: String = read
            .current
            .body
            .iter()
            .map(|line| line.text.as_str())
            .collect();
        let properties: String = read
            .current
            .properties
            .iter()
            .map(|line| line.text.as_str())
            .collect();
        let retained = headers(&id)?;
        for citation in group {
            let excerpt = &citation.current_excerpt;
            let present = body.contains(excerpt)
                || properties.contains(excerpt)
                || read.current.title.contains(excerpt);
            if present
                && retained.iter().any(|h| {
                    h.identity.as_str() == citation.revision_id
                        && h.source == citation.source
                        && h.time_evidence.occurred_at_millis() == citation.at_millis
                })
            {
                candidates.push(citation.clone());
            }
        }
        snapshots.push(read);
    }
    for read in snapshots {
        if !read.is_current(access)? {
            candidates.retain(|citation| citation.note_id != read.current.note_id);
        }
    }
    Ok(candidates)
}
