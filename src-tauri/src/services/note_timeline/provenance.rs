use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProvenanceEvidence {
    pub(crate) record_id: String,
    pub(crate) at_millis: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) time_evidence: Option<RevisionTimeEvidence>,
    pub(crate) source: Option<MutationSource>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RangeProvenance {
    pub(crate) introduced_at: Option<ProvenanceEvidence>,
    pub(crate) last_changed_at: Option<ProvenanceEvidence>,
    pub(crate) restored_at: Option<ProvenanceEvidence>,
    pub(crate) known_since: ProvenanceEvidence,
}

/// Half-open UTF-8 byte offsets within the containing line's current text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProvenanceRange {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) provenance: RangeProvenance,
    #[serde(skip)]
    formatting: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProvenanceLine {
    pub(crate) line_number: usize,
    pub(crate) text: String,
    pub(crate) ranges: Vec<ProvenanceRange>,
    // Derived while replaying retained states. A checkbox's boolean status is
    // distinct from authored bytes: [x] -> [X] must not date a new completion.
    #[serde(skip)]
    pub(crate) task_status_provenance: Option<RangeProvenance>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurrentContentProvenance {
    pub(crate) note_id: String,
    pub(crate) body: Vec<ProvenanceLine>,
    pub(crate) properties: Vec<ProvenanceLine>,
    pub(crate) title: String,
    pub(crate) title_provenance: RangeProvenance,
}

impl RangeProvenance {
    fn revision(header: &NoteRevisionHeader) -> Self {
        let evidence = ProvenanceEvidence {
            record_id: header.identity.0.clone(),
            at_millis: header.time_evidence.occurred_at_millis(),
            time_evidence: Some(header.time_evidence),
            source: Some(header.source),
        };
        let known = !matches!(header.time_evidence, RevisionTimeEvidence::Baseline { .. });
        Self {
            introduced_at: known.then(|| evidence.clone()),
            last_changed_at: known.then(|| evidence.clone()),
            restored_at: None,
            known_since: evidence,
        }
    }
}

#[derive(Clone, Default)]
struct AuthoredProjection {
    body: Vec<ProvenanceLine>,
    properties: Vec<ProvenanceLine>,
}

pub(super) struct CurrentProvenanceRead {
    _operation: OperationGuard,
    pub(super) current: CurrentContentProvenance,
    pub(super) version: CurrentContentVersion,
    path: PathBuf,
    canonical: String,
}

impl CurrentProvenanceRead {
    pub(super) fn is_current(
        &self,
        access: &CurrentContentAccess<'_>,
    ) -> Result<bool, HistoryError> {
        Ok(
            fs::read_to_string(&self.path).ok().as_ref() == Some(&self.canonical)
                && access.runtime.current_content_is_current(self.version)?
                && access
                    .eligibility()?
                    .allows_note(Some(&self.current.note_id), self.path.to_str()),
        )
    }
}

// Only the current-content capability calls this reader. Eligibility is checked
// before touching history and again after reconstruction. The canonical bytes
// are checked on both sides so an uncaptured disk edit cannot expose old prose.
pub(super) fn read_with_version(
    access: &CurrentContentAccess<'_>,
    note_id: &NoteIdentity,
) -> Result<Option<CurrentProvenanceRead>, HistoryError> {
    let (_operation, _) = access.prepare_read().map_err(history_failure)?;
    if !access
        .eligibility()?
        .allows_note(Some(note_id.as_str()), None)
    {
        return Ok(None);
    }
    let timeline = access.state.note_timeline();
    timeline
        .runtime
        .with_observation_replay(|| {
            timeline.replay_retained_observations(None)?;
            timeline.ensure_history_recovered()
        })
        .map_err(history_failure)?;
    access.runtime.ensure_note_ready(note_id)?;
    let version = access.runtime.current_content_version()?;
    let eligibility = access.eligibility()?;
    if !eligibility.allows_note(Some(note_id.as_str()), None) {
        return Ok(None);
    }
    let path = &eligibility.active_notes[note_id.as_str()];
    let canonical = fs::read_to_string(path).map_err(|error| history_failure(error.to_string()))?;
    let parsed = crate::note::parse_note(&canonical);
    if parsed.frontmatter.managed.as_ref().is_some_and(|metadata| {
        metadata.id != note_id.as_str() || metadata.kind != crate::note::DocumentKind::Note
    }) {
        return Ok(None);
    }
    if history_store::current_content_hash(&access.runtime.store, note_id)?.as_deref()
        != Some(history_store::authored_content_hash(&canonical).as_str())
    {
        return Err(HistoryError::Stale(
            "Current content is awaiting timeline capture".into(),
        ));
    }
    // A concurrent save after the explicit boundary invalidates this read.
    // Never describe an older retained anchor as pending current prose.
    if history_store::pending_window(&access.runtime.store, note_id)?.is_some() {
        return Err(HistoryError::Stale(
            "Current content awaits Editing Window finalization".into(),
        ));
    }
    let mut records = Vec::new();
    let mut next = None;
    loop {
        let Some(page) =
            history_store::bounded_timeline_page(&access.runtime.store, note_id, next, 100)?
        else {
            break;
        };
        records.extend(page.records);
        next = page.next_record;
        if next.is_none() {
            break;
        }
    }
    records.reverse();
    let required_origins: HashSet<_> = records
        .iter()
        .filter_map(|record| match record {
            history_store::BoundedTimelineRecord::Revision { header, .. } => {
                header.restored_from.clone()
            }
            _ => None,
        })
        .collect();
    let mut projection = AuthoredProjection::default();
    let mut retained = HashMap::<RevisionIdentity, AuthoredProjection>::new();
    let mut title_provenance = None;
    for record in records {
        match record {
            history_store::BoundedTimelineRecord::Revision { header, .. } => {
                let content =
                    history_store::reconstruct(&access.runtime.store, note_id, &header.identity)?;
                let evidence = RangeProvenance::revision(&header);
                title_provenance.get_or_insert_with(|| evidence.clone());
                let origin = header.restored_from.as_ref();
                let selected = origin.and_then(|id| retained.get(id));
                if origin.is_some() && selected.is_none() {
                    return Err(HistoryError::Corrupt(
                        "Version Restore lineage is not retained before its revision".into(),
                    ));
                }
                projection = project_revision(&projection, &content, &header, selected)?;
                if required_origins.contains(&header.identity) {
                    retained.insert(header.identity, projection.clone());
                }
            }
            history_store::BoundedTimelineRecord::LifecycleEvent(event) => {
                let old_title = event.previous_path.as_deref().and_then(Path::file_stem);
                let new_title = event.path.as_deref().and_then(Path::file_stem);
                if event.kind == LifecycleEventKind::Created
                    || (old_title.is_some() && new_title.is_some() && old_title != new_title)
                {
                    let evidence = ProvenanceEvidence {
                        record_id: event.identity.0,
                        at_millis: event.occurred_at_millis,
                        time_evidence: None,
                        source: None,
                    };
                    title_provenance = Some(RangeProvenance {
                        introduced_at: Some(evidence.clone()),
                        last_changed_at: Some(evidence.clone()),
                        restored_at: None,
                        known_since: evidence,
                    });
                }
            }
        }
    }
    let Some(title_provenance) = title_provenance else {
        return Ok(None);
    };
    let still_canonical = fs::read_to_string(path).ok().as_ref() == Some(&canonical);
    if !still_canonical
        || !access.runtime.current_content_is_current(version)?
        || !access
            .eligibility()?
            .allows_note(Some(note_id.as_str()), path.to_str())
    {
        return Ok(None);
    }
    Ok(Some(CurrentProvenanceRead {
        current: CurrentContentProvenance {
            note_id: note_id.0.clone(),
            body: projection.body,
            properties: projection.properties,
            title: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            title_provenance,
        },
        version,
        path: path.clone(),
        canonical,
        _operation,
    }))
}

/// Parser offsets include multiline block and inline formatting context. Carry
/// context privately alongside each range so a delimiter edit updates the prose
/// it formats even when those prose bytes have not changed.
fn apply_formatting(lines: &mut [ProvenanceLine], text: &str, evidence: &RangeProvenance) {
    use pulldown_cmark::{Event, Options, Parser};
    let options =
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS;
    let mut stack = Vec::new();
    let mut spans = Vec::new();
    for (event, range) in Parser::new_ext(text, options).into_offset_iter() {
        match event {
            Event::Start(tag) => stack.push(format!("{tag:?}")),
            Event::End(_) => {
                stack.pop();
            }
            Event::Text(_) | Event::Code(_) | Event::InlineMath(_) => {
                let mut context = stack.clone();
                if matches!(event, Event::Code(_)) {
                    context.push("InlineCode".into());
                }
                spans.push((range, context));
            }
            _ => {}
        }
    }
    let mut offset = 0;
    let mut span_index = 0;
    for line in lines {
        let mut result = Vec::new();
        for range in &line.ranges {
            let mut position = offset + range.start;
            let end = offset + range.end;
            while position < end {
                while spans
                    .get(span_index)
                    .is_some_and(|(span, _)| span.end <= position)
                {
                    span_index += 1;
                }
                let (next, formatting) = match spans.get(span_index) {
                    Some((span, context)) if span.start <= position => {
                        (end.min(span.end), context.clone())
                    }
                    Some((span, _)) => (end.min(span.start), Vec::new()),
                    None => (end, Vec::new()),
                };
                let mut provenance = range.provenance.clone();
                if formatting != range.formatting && provenance.known_since != evidence.known_since
                {
                    provenance.last_changed_at = evidence.last_changed_at.clone();
                }
                result.push(ProvenanceRange {
                    start: position - offset,
                    end: next - offset,
                    provenance,
                    formatting,
                });
                position = next;
            }
        }
        offset += line.text.len();
        line.ranges = result;
    }
}

fn project_revision(
    previous: &AuthoredProjection,
    content: &ReconstructedNoteRevision,
    header: &NoteRevisionHeader,
    selected: Option<&AuthoredProjection>,
) -> Result<AuthoredProjection, HistoryError> {
    let evidence = RangeProvenance::revision(header);
    let mut result = AuthoredProjection {
        body: project_lines(&previous.body, &content.body, &evidence),
        properties: project_lines(
            &previous.properties,
            content.unmanaged_frontmatter.as_deref().unwrap_or_default(),
            &evidence,
        ),
    };
    apply_formatting(&mut result.body, &content.body, &evidence);
    if header.source == MutationSource::VersionRestore {
        if let Some(selected) = selected {
            if lines_text(&selected.body) != content.body
                || lines_text(&selected.properties)
                    != content.unmanaged_frontmatter.as_deref().unwrap_or_default()
            {
                return Err(HistoryError::Corrupt(
                    "Version Restore lineage content mismatch".into(),
                ));
            }
            restore_ranges(&mut result.body, &selected.body, &evidence);
            restore_ranges(&mut result.properties, &selected.properties, &evidence);
        } else {
            // Pre-reference restores prove return time but cannot identify which
            // identical historical state was selected. Never invent that lineage.
            for line in result.body.iter_mut().chain(&mut result.properties) {
                if let Some(status) = &mut line.task_status_provenance {
                    if status.last_changed_at == evidence.last_changed_at {
                        status.introduced_at = None;
                        status.last_changed_at = None;
                        status.restored_at = Some(evidence.known_since.clone());
                    }
                }
                for range in &mut line.ranges {
                    if range.provenance.last_changed_at == evidence.last_changed_at {
                        range.provenance.introduced_at = None;
                        range.provenance.last_changed_at = None;
                        range.provenance.restored_at = Some(evidence.known_since.clone());
                    }
                }
            }
        }
    }
    Ok(result)
}

fn lines_text(lines: &[ProvenanceLine]) -> String {
    lines.iter().map(|line| line.text.as_str()).collect()
}

fn restore_ranges(
    current: &mut [ProvenanceLine],
    selected: &[ProvenanceLine],
    evidence: &RangeProvenance,
) {
    for (line, origin) in current.iter_mut().zip(selected) {
        if line
            .task_status_provenance
            .as_ref()
            .is_some_and(|status| status.last_changed_at == evidence.last_changed_at)
        {
            line.task_status_provenance =
                origin.task_status_provenance.clone().map(|mut status| {
                    status.restored_at = Some(evidence.known_since.clone());
                    status
                });
        }
        let mut ranges = Vec::new();
        for range in &line.ranges {
            if range.provenance.last_changed_at == evidence.last_changed_at {
                for old in &origin.ranges {
                    let start = range.start.max(old.start);
                    let end = range.end.min(old.end);
                    if start < end {
                        let mut provenance = old.provenance.clone();
                        provenance.restored_at = Some(evidence.known_since.clone());
                        ranges.push(ProvenanceRange {
                            start,
                            end,
                            provenance,
                            formatting: old.formatting.clone(),
                        });
                    }
                }
            } else {
                ranges.push(range.clone());
            }
        }
        line.ranges = ranges;
    }
}

/// Unique complete lines prove movement between adjacent retained states.
/// Duplicate correspondence is deliberately discarded when a state changes.
fn project_lines(
    old: &[ProvenanceLine],
    text: &str,
    evidence: &RangeProvenance,
) -> Vec<ProvenanceLine> {
    if lines_text(old) == text {
        return old.to_vec();
    }
    // A final newline is a separator, not a different prose line identity.
    // Otherwise Myers can pair an unterminated old last line with a newly
    // appended paragraph and transfer its lineage to unrelated new words.
    let before: Vec<&str> = old
        .iter()
        .map(|line| line.text.strip_suffix('\n').unwrap_or(&line.text))
        .collect();
    let after: Vec<&str> = text.split_inclusive('\n').collect();
    let after_keys: Vec<&str> = after
        .iter()
        .map(|line| line.strip_suffix('\n').unwrap_or(line))
        .collect();
    let mut result: Vec<_> = after
        .iter()
        .enumerate()
        .map(|(index, text)| ProvenanceLine {
            line_number: index + 1,
            text: (*text).into(),
            task_status_provenance: crate::index::parse_task_line(text).map(|_| evidence.clone()),
            ranges: vec![ProvenanceRange {
                start: 0,
                end: text.len(),
                provenance: evidence.clone(),
                formatting: Vec::new(),
            }],
        })
        .collect();
    let old_unique = unique_positions(&before);
    let new_unique = unique_positions(&after_keys);
    for (index, text) in after_keys.iter().enumerate() {
        if let (Some(Some(previous)), Some(Some(_))) = (old_unique.get(text), new_unique.get(text))
        {
            result[index].ranges = if old[*previous].text == after[index] {
                old[*previous].ranges.clone()
            } else {
                let mut ranges = slice_ranges(&old[*previous].ranges, 0, text.len(), 0);
                if after[index].len() > text.len() {
                    ranges.push(ProvenanceRange {
                        start: text.len(),
                        end: after[index].len(),
                        provenance: evidence.clone(),
                        formatting: Vec::new(),
                    });
                }
                ranges
            };
            result[index].task_status_provenance = old[*previous].task_status_provenance.clone();
        }
    }
    for op in capture_diff_slices(Algorithm::Myers, &before, &after_keys) {
        if let DiffOp::Replace {
            old_index,
            old_len,
            new_index,
            new_len,
        } = op
        {
            let old_block = &before[old_index..old_index + old_len];
            let new_block = &after_keys[new_index..new_index + new_len];
            let old_words: Vec<_> = old_block.iter().flat_map(|line| words(line)).collect();
            let new_words: Vec<_> = new_block.iter().flat_map(|line| words(line)).collect();
            let old_word_positions = unique_positions(&old_words);
            let new_word_positions = unique_positions(&new_words);
            let candidates: Vec<Vec<usize>> = new_block
                .iter()
                .map(|line| {
                    old_block
                        .iter()
                        .enumerate()
                        .filter_map(|(index, previous)| {
                            let matched = words(line).iter().any(|word| {
                                !word.trim().is_empty()
                                    && old_word_positions.get(word).is_some_and(Option::is_some)
                                    && new_word_positions.get(word).is_some_and(Option::is_some)
                                    && words(previous).contains(word)
                            });
                            (matched || (old_len == 1 && new_len == 1)).then_some(index)
                        })
                        .collect()
                })
                .collect();
            for (relative_new, matches) in candidates.iter().enumerate() {
                let [relative_old] = matches.as_slice() else {
                    continue;
                };
                if candidates
                    .iter()
                    .filter(|matches| matches.contains(relative_old))
                    .count()
                    != 1
                {
                    continue;
                }
                let old_index = old_index + relative_old;
                let new_index = new_index + relative_new;
                // Exact moves and duplicate line matches were handled above.
                if old_unique.get(before[old_index]) == Some(&Some(old_index))
                    && new_unique.get(after_keys[new_index]) == Some(&Some(new_index))
                    && !old_unique.contains_key(after_keys[new_index])
                    && !new_unique.contains_key(before[old_index])
                {
                    result[new_index].ranges =
                        project_words(&old[old_index], after[new_index], evidence);
                    if let (Some((old_status, _, _)), Some((new_status, _, _))) = (
                        crate::index::parse_task_line(before[old_index]),
                        crate::index::parse_task_line(after[new_index]),
                    ) {
                        // The line correspondence above also applies to its
                        // checkbox. Even replacing all of a task's description
                        // does not flip an unchanged completion status.
                        if old_status == new_status {
                            result[new_index].task_status_provenance =
                                old[old_index].task_status_provenance.clone();
                        }
                    }
                }
            }
        }
    }
    result
}

fn unique_positions<'a>(items: &[&'a str]) -> HashMap<&'a str, Option<usize>> {
    let mut positions = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        positions
            .entry(*item)
            .and_modify(|position| *position = None)
            .or_insert(Some(index));
    }
    positions
}

// Whitespace and authored words (including Markdown delimiters) are ranges.
// Changing `word` to `**word**` changes that authored word, preserving its
// introduction only when the adjacent replacement establishes correspondence.
fn words(text: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut whitespace = None;
    for (index, character) in text.char_indices() {
        let next = character.is_whitespace();
        if whitespace.is_some_and(|previous| previous != next) {
            result.push(&text[start..index]);
            start = index;
        }
        whitespace = Some(next);
    }
    if start < text.len() {
        result.push(&text[start..]);
    }
    result
}

fn project_words(
    old: &ProvenanceLine,
    text: &str,
    evidence: &RangeProvenance,
) -> Vec<ProvenanceRange> {
    let before = words(&old.text);
    let after = words(text);
    let offsets = |words: &[&str]| {
        let mut offset = 0;
        words
            .iter()
            .map(|word| {
                let start = offset;
                offset += word.len();
                start
            })
            .chain(std::iter::once(words.iter().map(|word| word.len()).sum()))
            .collect::<Vec<_>>()
    };
    let old_offsets = offsets(&before);
    let new_offsets = offsets(&after);
    let mut ranges = Vec::new();
    for op in capture_diff_slices(Algorithm::Myers, &before, &after) {
        match op {
            DiffOp::Equal {
                old_index,
                new_index,
                len,
            } => {
                let start = old_offsets[old_index];
                let end = old_offsets[old_index + len];
                for range in &old.ranges {
                    let from = start.max(range.start);
                    let to = end.min(range.end);
                    if from < to {
                        ranges.push(ProvenanceRange {
                            start: new_offsets[new_index] + from - start,
                            end: new_offsets[new_index] + to - start,
                            provenance: range.provenance.clone(),
                            formatting: range.formatting.clone(),
                        });
                    }
                }
            }
            DiffOp::Insert {
                new_index, new_len, ..
            } => ranges.push(ProvenanceRange {
                start: new_offsets[new_index],
                end: new_offsets[new_index + new_len],
                provenance: evidence.clone(),
                formatting: Vec::new(),
            }),
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => {
                let from = old_offsets[old_index];
                let to = old_offsets[old_index + old_len];
                let originals: Vec<_> = old
                    .ranges
                    .iter()
                    .filter(|range| range.start < to && range.end > from)
                    .collect();
                let mut provenance = evidence.clone();
                if let Some(first) = originals.first().filter(|first| {
                    originals
                        .iter()
                        .all(|range| range.provenance == first.provenance)
                }) {
                    provenance = first.provenance.clone();
                    provenance.last_changed_at = evidence.last_changed_at.clone();
                }
                ranges.push(ProvenanceRange {
                    start: new_offsets[new_index],
                    end: new_offsets[new_index + new_len],
                    provenance,
                    formatting: Vec::new(),
                });
            }
            DiffOp::Delete { .. } => {}
        }
    }
    let old_unique = unique_positions(&before);
    let new_unique = unique_positions(&after);
    after
        .iter()
        .enumerate()
        .flat_map(|(index, word)| {
            let start = new_offsets[index];
            let end = new_offsets[index + 1];
            if !word.trim().is_empty() {
                match (old_unique.get(word), new_unique.get(word)) {
                    (Some(Some(previous)), Some(Some(_))) => {
                        return slice_ranges(
                            &old.ranges,
                            old_offsets[*previous],
                            old_offsets[*previous + 1],
                            start,
                        );
                    }
                    (Some(None), _) | (Some(_), Some(None)) => {
                        return vec![ProvenanceRange {
                            start,
                            end,
                            provenance: evidence.clone(),
                            formatting: Vec::new(),
                        }];
                    }
                    _ => {}
                }
            }
            slice_ranges(&ranges, start, end, start)
        })
        .collect()
}

fn slice_ranges(
    ranges: &[ProvenanceRange],
    start: usize,
    end: usize,
    destination: usize,
) -> Vec<ProvenanceRange> {
    ranges
        .iter()
        .filter_map(|range| {
            let from = start.max(range.start);
            let to = end.min(range.end);
            (from < to).then(|| ProvenanceRange {
                start: destination + from - start,
                end: destination + to - start,
                provenance: range.provenance.clone(),
                formatting: range.formatting.clone(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::EventBus, semantic::SemanticState};

    fn with_vault(run: impl FnOnce(AppState, &Path)) {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("provenance-integration-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("provenance-integration-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        run(state, notes.path());
        crate::state::set_notes_root_override(None).unwrap();
    }

    fn save(
        state: &AppState,
        title: &str,
        body: &str,
        previous: Option<&Path>,
    ) -> (NoteIdentity, PathBuf) {
        let session = crate::commands::note_persistence::persist_note_session_with_outcome(
            state,
            title.into(),
            body.into(),
            previous.map(|path| path.to_string_lossy().into_owned()),
        )
        .unwrap()
        .unwrap();
        state
            .note_timeline()
            .finalize_editing_window(&NoteIdentity::new(session.note_id.as_ref().unwrap()))
            .unwrap();
        (
            NoteIdentity::new(session.note_id.unwrap()),
            PathBuf::from(session.path.unwrap()),
        )
    }

    fn refresh_catalog(state: &AppState, root: &Path) {
        // Watcher/reconciliation callers refresh the catalog after the retained
        // observation. Exercise that participant before asking for delivery.
        state
            .reconcile_full_vault_scan_observing(root, |_, _| Ok(()))
            .unwrap();
    }

    fn current(state: &AppState, id: &NoteIdentity) -> CurrentContentProvenance {
        state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .provenance(id)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn selected_restore_lineage_survives_failed_finalization_restart_and_clear() {
        with_vault(|state, root| {
            let (id, path) = save(&state, "Restore", "returned\nkept\n", None);
            save(&state, "Restore", "kept\n", Some(&path));
            save(&state, "Restore", "returned\nkept\n", Some(&path));
            let selected = current(&state, &id);
            let history = state.note_timeline().open_history_mode(id.clone());
            let selected_id = history
                .revisions()
                .unwrap()
                .last()
                .unwrap()
                .identity
                .clone();
            save(&state, "Restore", "kept\n", Some(&path));
            let preview = history.restore_preview(selected_id.as_str()).unwrap();
            super::super::inject_history_finalization_failure_once();
            let restored = history
                .confirm_restore(selected_id.as_str(), &preview.current_authored_content_hash)
                .unwrap();
            assert!(restored.mutation.warning().is_some());
            let restarted = AppState::new(
                SemanticState::new_disabled("disabled"),
                EventBus::disabled(),
            )
            .unwrap();
            restarted
                .note_timeline()
                .observe(VaultObservation::reconciled_state(path.clone(), 500, None))
                .unwrap();
            refresh_catalog(&restarted, root);
            let recovered = current(&restarted, &id);
            let lineage = at(&recovered.body, 0, "returned");
            assert_eq!(
                lineage.introduced_at,
                at(&selected.body, 0, "returned").introduced_at
            );
            assert_eq!(
                lineage.introduced_at.as_ref().unwrap().record_id,
                selected_id.as_str()
            );
            assert_eq!(
                lineage.restored_at.as_ref().unwrap().record_id,
                restored.revision_id().as_str()
            );
            assert_eq!(at(&recovered.body, 1, "kept").restored_at, None);
            assert_eq!(
                recovered,
                current(&restarted, &id),
                "rebuild is deterministic"
            );
            restarted.note_timeline().clear_note_history(&id).unwrap();
            let cleared = current(&restarted, &id);
            assert_eq!(lines_text(&cleared.body), "returned\nkept\n");
            for line in &cleared.body {
                let evidence = &line.ranges[0].provenance;
                assert_eq!(evidence.introduced_at, None);
                assert_eq!(evidence.last_changed_at, None);
                assert_eq!(evidence.restored_at, None);
                assert_ne!(evidence.known_since.record_id, selected_id.as_str());
            }
            assert_eq!(cleared.title_provenance.introduced_at, None);
            assert!(history_store::restore_origin(
                &history_store::Store::for_test(),
                restored.revision_id()
            )
            .unwrap()
            .is_none());
        });
    }

    #[test]
    fn title_provenance_follows_lifecycle_order_not_timestamps_or_body_revisions() {
        with_vault(|state, root| {
            let (id, path) = save(&state, "Original", "body", None);
            let before = current(&state, &id);
            let (_, renamed) = save(&state, "New title", "body", Some(&path));
            let changed = current(&state, &id);
            assert_eq!(changed.body, before.body);
            assert_eq!(changed.title, "New title");
            assert_ne!(changed.title_provenance, before.title_provenance);
            let destination = root.join("folder").join("New title.md");
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            fs::rename(&renamed, &destination).unwrap();
            state
                .note_timeline()
                .observe(VaultObservation::moved(renamed, destination.clone(), 10))
                .unwrap();
            refresh_catalog(&state, root);
            assert_eq!(
                current(&state, &id).title_provenance,
                changed.title_provenance
            );
            let final_path = destination.with_file_name("Final.md");
            fs::rename(&destination, &final_path).unwrap();
            state
                .note_timeline()
                .observe(VaultObservation::renamed(destination, final_path, 1))
                .unwrap();
            refresh_catalog(&state, root);
            let final_state = current(&state, &id);
            assert_eq!(final_state.title, "Final");
            assert_eq!(
                final_state
                    .title_provenance
                    .last_changed_at
                    .unwrap()
                    .at_millis,
                1
            );
            assert_eq!(
                state
                    .note_timeline()
                    .open_history_mode(id)
                    .revisions()
                    .unwrap()
                    .len(),
                1
            );
        });
    }

    #[test]
    fn delivery_snapshot_rejects_an_uncaptured_edit_after_projection() {
        with_vault(|state, _root| {
            let (id, path) = save(&state, "Snapshot", "text removed during delivery\n", None);
            let timeline = state.note_timeline();
            let access = timeline.current_content(AllowedScope::vault());
            let read = read_with_version(&access, &id).unwrap().unwrap();
            assert!(read.is_current(&access).unwrap());
            let canonical = fs::read_to_string(&path).unwrap();
            fs::write(
                &path,
                crate::note::replace_authored_content(&canonical, None, "current text\n").unwrap(),
            )
            .unwrap();
            assert!(!read.is_current(&access).unwrap());
        });
    }

    #[test]
    fn current_provenance_includes_body_and_properties() {
        with_vault(|state, _root| {
            let body = (1..=35).map(|i| format!("line {i}\n")).collect::<String>();
            let (id, _) = save(
                &state,
                "Pages",
                &format!("---\nproject: current\n---\n{body}"),
                None,
            );
            let timeline = state.note_timeline();
            let current = timeline
                .current_content(AllowedScope::vault())
                .provenance(&id)
                .unwrap()
                .unwrap();
            assert_eq!(current.body.len(), 35);
            assert_eq!(current.body[30].text, "line 31\n");
            assert!(current
                .properties
                .iter()
                .any(|line| line.text.contains("project: current")));
        });
    }

    #[test]
    fn activity_periods_page_current_notes_and_invalidate_cleared_citations() {
        with_vault(|state, root| {
            let (id, path) = save(&state, "Period", "obsolete\n", None);
            save(&state, "Other", "other current\n", None);
            let canonical = fs::read_to_string(&path).unwrap();
            fs::write(
                &path,
                crate::note::replace_authored_content(&canonical, None, "current\n").unwrap(),
            )
            .unwrap();
            state
                .note_timeline()
                .observe(VaultObservation::external_edit(path.clone(), 42, Some(1)))
                .unwrap();
            let timeline = state.note_timeline();
            let access = timeline.current_content(AllowedScope::vault());
            let period = access.activity(42, 43, 0, 20).unwrap();
            assert_eq!(period.items.len(), 1);
            assert_eq!(period.items[0].revision_count, 1);
            assert_eq!(period.items[0].sources, vec![MutationSource::ExternalEdit]);
            assert_eq!(period.items[0].first_at_millis, 42);
            assert_eq!(period.items[0].current_excerpt, "current\n");
            let evidence = period.items[0].citations.clone();
            assert_eq!(access.current_citations(&evidence).unwrap().len(), 1);
            let first = access.activity(0, u64::MAX, 0, 1).unwrap();
            let second = access
                .activity(0, u64::MAX, first.next_offset.unwrap(), 1)
                .unwrap();
            assert_ne!(first.items[0].note_id, second.items[0].note_id);
            assert_eq!(second.next_offset, None);
            timeline.clear_note_history(&id).unwrap();
            assert!(access.current_citations(&evidence).unwrap().is_empty());
            let forgotten = crate::state::forgotten_notes_root(root).join("Period.md");
            fs::create_dir_all(forgotten.parent().unwrap()).unwrap();
            fs::rename(&path, &forgotten).unwrap();
            timeline
                .observe(VaultObservation::moved(path, forgotten.clone(), 100))
                .unwrap();
            let remaining = access.activity(0, u64::MAX, 0, 20).unwrap();
            assert!(remaining
                .items
                .iter()
                .all(|item| item.note_id != id.as_str()));
            timeline
                .lifecycle(NoteLifecycleOperation::purged(id.clone(), forgotten, 101))
                .unwrap();
            assert!(access
                .activity(0, u64::MAX, 0, 20)
                .unwrap()
                .items
                .iter()
                .all(|item| item.note_id != id.as_str()));
            assert!(access.current_citations(&evidence).unwrap().is_empty());
        });
    }

    #[test]
    fn activity_returns_revision_counts_and_current_excerpts_without_removed_prose() {
        with_vault(|state, _root| {
            let (id, path) = save(&state, "Activity", "removed secret\nkept\n", None);
            save(&state, "Activity", "kept\n", Some(&path));
            let timeline = state.note_timeline();
            let access = timeline.current_content(AllowedScope::vault());
            let page = access.activity(0, u64::MAX, 0, 20).unwrap();
            assert_eq!(page.items.len(), 1);
            let item = &page.items[0];
            assert_eq!(item.note_id, id.as_str());
            assert_eq!(item.revision_count, 2);
            assert_eq!(item.current_excerpt, "kept\n");
            assert_eq!(item.citations.len(), 2);
            assert!(!serde_json::to_string(&page)
                .unwrap()
                .contains("removed secret"));
            let at = item.citations[0].at_millis;
            assert!(access.activity(at + 1, at, 0, 20).is_err());
            assert!(timeline
                .current_content(AllowedScope::policy(
                    Some(&HashSet::from([id.0.clone()])),
                    &HashSet::from([id.0.clone()])
                ))
                .activity(0, u64::MAX, 0, 20)
                .unwrap()
                .items
                .is_empty());
            fs::remove_file(&path).unwrap();
            assert!(access
                .activity(0, u64::MAX, 0, 20)
                .unwrap()
                .items
                .is_empty());
        });
    }

    #[test]
    fn access_filters_scope_exclusions_missing_forgotten_and_uncaptured_disk_prose() {
        with_vault(|state, root| {
            let (id, path) = save(&state, "Private", "deleted secret\nkept\n", None);
            save(&state, "Private", "kept\n", Some(&path));
            let projection = current(&state, &id);
            assert!(!serde_json::to_string(&projection)
                .unwrap()
                .contains("deleted secret"));
            for scope in [
                AllowedScope::policy(Some(&HashSet::new()), &HashSet::new()),
                AllowedScope::policy(
                    Some(&HashSet::from([id.0.clone()])),
                    &HashSet::from([id.0.clone()]),
                ),
            ] {
                assert!(state
                    .note_timeline()
                    .current_content(scope)
                    .provenance(&id)
                    .unwrap()
                    .is_none());
            }
            let canonical = fs::read_to_string(&path).unwrap();
            let external =
                crate::note::replace_authored_content(&canonical, None, "external current\n")
                    .unwrap();
            fs::write(&path, external).unwrap();
            assert!(matches!(
                state
                    .note_timeline()
                    .current_content(AllowedScope::vault())
                    .provenance(&id),
                Err(HistoryError::Stale(_))
            ));
            state
                .note_timeline()
                .observe(VaultObservation::external_edit(path.clone(), 99, Some(1)))
                .unwrap();
            let observed = current(&state, &id);
            assert_eq!(lines_text(&observed.body), "external current\n");
            assert_eq!(
                at(&observed.body, 0, "external")
                    .last_changed_at
                    .as_ref()
                    .unwrap()
                    .at_millis,
                99
            );
            let hidden = root.join("hidden.tmp");
            fs::rename(&path, &hidden).unwrap();
            assert!(state
                .note_timeline()
                .current_content(AllowedScope::vault())
                .provenance(&id)
                .unwrap()
                .is_none());
            let forgotten = crate::state::forgotten_notes_root(root).join("Private.md");
            fs::create_dir_all(forgotten.parent().unwrap()).unwrap();
            fs::rename(&hidden, &forgotten).unwrap();
            state
                .note_timeline()
                .observe(VaultObservation::moved(path, forgotten, 100))
                .unwrap();
            assert!(state
                .note_timeline()
                .current_content(AllowedScope::vault())
                .provenance(&id)
                .unwrap()
                .is_none());
        });
    }

    fn revision(number: u64, source: MutationSource, baseline: bool) -> NoteRevisionHeader {
        NoteRevisionHeader {
            identity: RevisionIdentity::from_persisted(format!("revision-{number}")),
            note_identity: NoteIdentity::new("note"),
            predecessor: None,
            payload_version: PayloadVersion::V1,
            source,
            time_evidence: if baseline {
                RevisionTimeEvidence::Baseline {
                    known_since_millis: number,
                }
            } else if source == MutationSource::ExternalEdit {
                RevisionTimeEvidence::Observed {
                    observed_at_millis: number,
                    modified_at_millis: Some(999999),
                }
            } else {
                RevisionTimeEvidence::Committed {
                    committed_at_millis: number,
                }
            },
            content_hash: String::new(),
            restored_from: None,
        }
    }

    fn edit(previous: &AuthoredProjection, text: &str, number: u64) -> AuthoredProjection {
        project_revision(
            previous,
            &ReconstructedNoteRevision {
                body: text.into(),
                unmanaged_frontmatter: None,
            },
            &revision(number, MutationSource::Editor, false),
            None,
        )
        .unwrap()
    }

    fn at<'a>(lines: &'a [ProvenanceLine], line: usize, word: &str) -> &'a RangeProvenance {
        let offset = lines[line].text.find(word).unwrap();
        &lines[line]
            .ranges
            .iter()
            .find(|range| range.start <= offset && offset < range.end)
            .unwrap()
            .provenance
    }

    fn introduced(evidence: &RangeProvenance) -> Option<u64> {
        evidence.introduced_at.as_ref().map(|value| value.at_millis)
    }

    #[test]
    fn appending_after_unterminated_prose_does_not_transfer_its_lineage() {
        let initial = edit(
            &AuthoredProjection::default(),
            "# Work\n\nI delivered the old brochure on September 4.",
            1,
        );
        let week = "# Work\n\nI delivered the old brochure on September 4.\n\nI sent the Atlas quote on September 9.\n\nI resolved the cache incident.";
        let first = edit(&initial, week, 2);
        let text = format!(
            "{}\n\nSeptember 15 retrospective: I submitted the expense report on September 8.",
            week.replace("Atlas quote", "Atlas revised quote")
        );
        let appended = edit(&first, &text, 3);
        assert_eq!(introduced(at(&appended.body, 6, "resolved")), Some(2));
        assert_eq!(
            at(&appended.body, 6, "resolved")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            2
        );
        for word in ["I", "submitted", "expense"] {
            assert_eq!(
                introduced(at(&appended.body, 8, word)),
                Some(3),
                "new paragraph must not borrow old line history"
            );
        }
        let trimmed = edit(&appended, week, 4);
        assert_eq!(introduced(at(&trimmed.body, 6, "resolved")), Some(2));
        assert_eq!(
            at(&trimmed.body, 6, "resolved")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            2
        );
    }

    #[test]
    fn insert_edit_delete_move_retype_and_formatting_have_conservative_lineage() {
        let first = edit(&AuthoredProjection::default(), "red apple\nblue sky\n", 1);
        let inserted = edit(&first, "red apple\nnew sentence\nblue sky\n", 2);
        assert_eq!(introduced(at(&inserted.body, 1, "new")), Some(2));
        assert_eq!(introduced(at(&inserted.body, 2, "blue")), Some(1));
        let edited = edit(&inserted, "green apple\nnew sentence\nblue sky\n", 3);
        assert_eq!(introduced(at(&edited.body, 0, "green")), Some(1));
        assert_eq!(
            at(&edited.body, 0, "green")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            3
        );
        assert_eq!(
            at(&edited.body, 0, "apple")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            1
        );
        let moved = edit(&edited, "blue sky\ngreen apple\nnew sentence\n", 4);
        assert_eq!(at(&moved.body, 0, "blue"), at(&first.body, 1, "blue"));
        let deleted = edit(&moved, "blue sky\nnew sentence\n", 5);
        assert!(!lines_text(&deleted.body).contains("apple"));
        let retyped = edit(&deleted, "blue sky\ngreen apple\nnew sentence\n", 6);
        assert_eq!(introduced(at(&retyped.body, 1, "green")), Some(6));
        let formatted = edit(&retyped, "blue sky\ngreen **apple**\nnew sentence\n", 7);
        assert_eq!(introduced(at(&formatted.body, 1, "apple")), Some(6));
        assert_eq!(
            at(&formatted.body, 1, "apple")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            7
        );
        assert_eq!(
            at(&formatted.body, 1, "green")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            6
        );
    }

    #[test]
    fn formatting_context_changes_all_affected_prose_and_preserves_its_introduction() {
        for (before, after, word) in [
            ("one two three", "**one two three**", "two"),
            ("**one two three**", "one two three", "two"),
            ("plain text", "# plain text", "text"),
            ("plain\n", "plain\n=====\n", "plain"),
            ("plain\n", "```rust\nplain\n```\n", "plain"),
        ] {
            let first = edit(&AuthoredProjection::default(), before, 1);
            let formatted = edit(&first, after, 2);
            let line = formatted
                .body
                .iter()
                .position(|line| line.text.contains(word))
                .unwrap();
            let evidence = at(&formatted.body, line, word);
            assert_eq!(introduced(evidence), Some(1), "{before:?} -> {after:?}");
            assert_eq!(
                evidence.last_changed_at.as_ref().unwrap().at_millis,
                2,
                "{before:?} -> {after:?}"
            );
        }
    }

    #[test]
    fn adjacent_line_edits_preserve_provable_unchanged_words() {
        let first = edit(&AuthoredProjection::default(), "red apple\nblue sky\n", 1);
        let edited = edit(&first, "green apple\nbright sky\n", 2);
        assert_eq!(at(&edited.body, 0, "apple"), at(&first.body, 0, "apple"));
        assert_eq!(at(&edited.body, 1, "sky"), at(&first.body, 1, "sky"));
    }

    #[test]
    fn ambiguous_duplicate_movement_does_not_pick_an_old_introduction() {
        let first = edit(&AuthoredProjection::default(), "same\nanchor\n", 1);
        let duplicated = edit(&first, "same\nanchor\nsame\n", 2);
        let moved = edit(&duplicated, "anchor\nsame\nsame\n", 3);
        assert_eq!(introduced(at(&moved.body, 1, "same")), Some(3));
        assert_eq!(introduced(at(&moved.body, 2, "same")), Some(3));
        assert_eq!(introduced(at(&moved.body, 0, "anchor")), Some(1));
    }

    #[test]
    fn baseline_and_external_edits_use_honest_time_evidence_for_body_and_properties() {
        let baseline = project_revision(
            &AuthoredProjection::default(),
            &ReconstructedNoteRevision {
                body: "old word".into(),
                unmanaged_frontmatter: Some("color: blue\n".into()),
            },
            &revision(10, MutationSource::BaselineInitialization, true),
            None,
        )
        .unwrap();
        for line in baseline.body.iter().chain(&baseline.properties) {
            assert_eq!(line.ranges[0].provenance.introduced_at, None);
            assert_eq!(line.ranges[0].provenance.last_changed_at, None);
            assert_eq!(line.ranges[0].provenance.known_since.at_millis, 10);
        }
        let changed = project_revision(
            &baseline,
            &ReconstructedNoteRevision {
                body: "new word".into(),
                unmanaged_frontmatter: Some("color: red\n".into()),
            },
            &revision(20, MutationSource::ExternalEdit, false),
            None,
        )
        .unwrap();
        let evidence = at(&changed.body, 0, "new");
        assert_eq!(introduced(evidence), None);
        assert_eq!(evidence.known_since.at_millis, 10);
        assert_eq!(evidence.last_changed_at.as_ref().unwrap().at_millis, 20);
        assert_eq!(
            evidence.last_changed_at.as_ref().unwrap().source,
            Some(MutationSource::ExternalEdit)
        );
        assert_eq!(
            at(&changed.properties, 0, "red")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            20
        );
        assert_eq!(at(&changed.body, 0, "word").last_changed_at, None);
    }

    #[test]
    fn restore_preserves_selected_lineage_and_marks_only_returned_ranges() {
        let first = edit(&AuthoredProjection::default(), "kept\nreturned\n", 1);
        let removed = edit(&first, "kept\n", 2);
        let restored = project_revision(
            &removed,
            &ReconstructedNoteRevision {
                body: "kept\nreturned\n".into(),
                unmanaged_frontmatter: None,
            },
            &revision(3, MutationSource::VersionRestore, false),
            Some(&first),
        )
        .unwrap();
        assert_eq!(at(&restored.body, 0, "kept").restored_at, None);
        assert_eq!(introduced(at(&restored.body, 1, "returned")), Some(1));
        assert_eq!(
            at(&restored.body, 1, "returned")
                .last_changed_at
                .as_ref()
                .unwrap()
                .at_millis,
            1
        );
        assert_eq!(
            at(&restored.body, 1, "returned")
                .restored_at
                .as_ref()
                .unwrap()
                .at_millis,
            3
        );
    }

    #[test]
    fn generated_edits_cover_exact_current_utf8_with_only_retained_evidence() {
        let fragments = [
            "",
            "red",
            "red\n",
            "🌍 café\r\n",
            "same\nsame\n",
            "# heading\n",
            "- [x] done\n",
            "**bold** word",
            "deleted secret\n",
        ];
        let mut previous = AuthoredProjection::default();
        for step in 1..=200 {
            let text = format!(
                "{}{}",
                fragments[step % fragments.len()],
                fragments[(step * 7 + 3) % fragments.len()]
            );
            let current = edit(&previous, &text, step as u64);
            assert_eq!(lines_text(&current.body), text);
            for (index, line) in current.body.iter().enumerate() {
                assert_eq!(line.line_number, index + 1);
                let mut offset = 0;
                for range in &line.ranges {
                    assert_eq!(range.start, offset);
                    assert!(range.end > range.start && line.text.is_char_boundary(range.end));
                    for evidence in [
                        &range.provenance.introduced_at,
                        &range.provenance.last_changed_at,
                        &range.provenance.restored_at,
                    ]
                    .into_iter()
                    .flatten()
                    {
                        assert!(evidence.at_millis <= step as u64);
                    }
                    offset = range.end;
                }
                assert_eq!(offset, line.text.len());
            }
            previous = current;
        }
    }

    #[test]
    fn current_content_provenance_explains_a_created_note() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("provenance-create-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("provenance-create-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Title".into(),
            "Current prose".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let note_id = NoteIdentity::new(created.note_id.unwrap());
        let projection = state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .provenance(&note_id)
            .unwrap()
            .expect("current note provenance");
        assert_eq!(projection.body[0].text, "Current prose");
        let evidence = &projection.body[0].ranges[0].provenance;
        assert_eq!(
            evidence.introduced_at.as_ref().unwrap().source,
            Some(MutationSource::NoteCreation)
        );
        assert_eq!(evidence.introduced_at, evidence.last_changed_at);
        assert_eq!(evidence.restored_at, None);
        assert_eq!(projection.title, "Title");
        crate::state::set_notes_root_override(None).unwrap();
    }
}
