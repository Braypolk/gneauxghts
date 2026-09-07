use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryRestorePreview {
    pub(super) revision_id: String,
    pub(super) current_authored_content_hash: String,
    pub(super) unmanaged_frontmatter: Option<String>,
    pub(super) body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryRestoreResult {
    pub(super) revision_id: RevisionIdentity,
    pub(super) mutation: NoteMutationResult,
}

impl HistoryRestoreResult {
    pub(crate) fn revision_id(&self) -> &RevisionIdentity {
        &self.revision_id
    }

    pub(crate) fn mutation(&self) -> &NoteMutationResult {
        &self.mutation
    }
}

#[cfg(test)]
impl HistoryRestorePreview {
    pub(crate) fn revision_id(&self) -> &str {
        &self.revision_id
    }

    pub(crate) fn current_authored_content_hash(&self) -> &str {
        &self.current_authored_content_hash
    }

    pub(crate) fn unmanaged_frontmatter(&self) -> Option<&str> {
        self.unmanaged_frontmatter.as_deref()
    }

    pub(crate) fn body(&self) -> &str {
        &self.body
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryModeRevisionTimeKind {
    EditingWindow,
    KnownSince,
    Committed,
    Observed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum HistoryModeRecord {
    Revision {
        record_id: String,
        revision_id: String,
        source: MutationSource,
        occurred_at_millis: u64,
        timeline_ordinal: i64,
        time_kind: HistoryModeRevisionTimeKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        time_evidence: Option<RevisionTimeEvidence>,
        modified_at_millis: Option<u64>,
        revision_label: Option<String>,
        line_count: usize,
        character_count: usize,
    },
    LifecycleEvent {
        record_id: String,
        event_id: String,
        event_kind: LifecycleEventKind,
        occurred_at_millis: u64,
        timeline_ordinal: i64,
        previous_path: Option<String>,
        path: Option<String>,
    },
}

impl HistoryModeRecord {
    #[cfg(test)]
    pub(crate) fn record_id(&self) -> &str {
        match self {
            Self::Revision { record_id, .. } | Self::LifecycleEvent { record_id, .. } => record_id,
        }
    }

    #[cfg(test)]
    pub(crate) fn revision_id(&self) -> Option<&str> {
        match self {
            Self::Revision { revision_id, .. } => Some(revision_id),
            Self::LifecycleEvent { .. } => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn revision_label(&self) -> Option<&str> {
        match self {
            Self::Revision { revision_label, .. } => revision_label.as_deref(),
            Self::LifecycleEvent { .. } => None,
        }
    }
}

pub(super) fn authored_content_counts(revision: &ReconstructedNoteRevision) -> (usize, usize) {
    let frontmatter = revision
        .unmanaged_frontmatter
        .as_deref()
        .unwrap_or_default();
    (
        frontmatter.lines().count() + revision.body.lines().count(),
        frontmatter.chars().count() + revision.body.chars().count(),
    )
}

pub(super) fn project_revision_header(
    revision: NoteRevisionHeader,
    revision_label: Option<String>,
    timeline_ordinal: i64,
    counts: (usize, usize),
) -> HistoryModeRecord {
    let revision_id = revision.identity.0;
    let occurred_at_millis = revision.time_evidence.occurred_at_millis();
    let (time_kind, modified_at_millis) = match revision.time_evidence {
        RevisionTimeEvidence::EditingWindow { .. } => {
            (HistoryModeRevisionTimeKind::EditingWindow, None)
        }
        RevisionTimeEvidence::Baseline { .. } => (HistoryModeRevisionTimeKind::KnownSince, None),
        RevisionTimeEvidence::Committed { .. } => (HistoryModeRevisionTimeKind::Committed, None),
        RevisionTimeEvidence::Observed {
            modified_at_millis, ..
        } => (HistoryModeRevisionTimeKind::Observed, modified_at_millis),
    };
    HistoryModeRecord::Revision {
        record_id: revision_id.clone(),
        revision_id,
        source: revision.source,
        occurred_at_millis,
        timeline_ordinal,
        time_kind,
        time_evidence: revision.time_evidence.window(),
        modified_at_millis,
        revision_label,
        line_count: counts.0,
        character_count: counts.1,
    }
}

pub(super) fn project_lifecycle_header(
    event: LifecycleEventHeader,
    timeline_ordinal: i64,
) -> HistoryModeRecord {
    let event_id = event.identity.0;
    HistoryModeRecord::LifecycleEvent {
        record_id: event_id.clone(),
        event_id,
        event_kind: event.kind,
        occurred_at_millis: event.occurred_at_millis,
        timeline_ordinal,
        previous_path: event
            .previous_path
            .map(|path| path.to_string_lossy().into_owned()),
        path: event.path.map(|path| path.to_string_lossy().into_owned()),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryModePage {
    pub(super) records: Vec<HistoryModeRecord>,
    pub(super) next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) previous_cursor: Option<String>,
}

pub(super) const HISTORY_CURSOR_VERSION: u8 = 1;
pub(super) const HISTORY_CURSOR_ERROR: &str = "History page cursor is no longer available";
pub(crate) const MISSING_HISTORY_CURSOR_ERROR: &str =
    "Missing Note history continuation is stale or belongs to another Note Timeline";

/// Opaque continuation bound to one vault generation and Note Timeline. It
/// names the next predecessor directly, so it remains valid across restart.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HistoryCursor {
    pub(super) version: u8,
    pub(super) vault_id: String,
    pub(super) history_generation: u64,
    pub(super) note_id: String,
    pub(super) next_record_kind: HistoryCursorRecordKind,
    pub(super) next_record_id: String,
    pub(super) next_timeline_ordinal: usize,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum HistoryCursorRecordKind {
    Revision,
    LifecycleEvent,
}

impl HistoryCursor {
    pub(super) fn decode(encoded: &str, invalid_cursor: &str) -> Result<Self, String> {
        let bytes = BASE64_URL_SAFE
            .decode(encoded)
            .map_err(|_| invalid_cursor.to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| invalid_cursor.to_string())
    }

    pub(super) fn encode(&self) -> Result<String, HistoryError> {
        Ok(serde_json::to_vec(self)
            .map(|bytes| BASE64_URL_SAFE.encode(bytes))
            .map_err(|error| format!("Encode Missing Note history continuation: {error}"))?)
    }

    pub(super) fn record_identity(&self) -> TimelineRecordIdentity {
        match self.next_record_kind {
            HistoryCursorRecordKind::Revision => TimelineRecordIdentity::Revision(
                RevisionIdentity::from_persisted(self.next_record_id.clone()),
            ),
            HistoryCursorRecordKind::LifecycleEvent => TimelineRecordIdentity::LifecycleEvent(
                LifecycleEventIdentity::from_persisted(self.next_record_id.clone()),
            ),
        }
    }

    pub(super) fn for_record(
        note_id: &NoteIdentity,
        vault_id: &str,
        history_generation: u64,
        record: &TimelineRecordIdentity,
        next_timeline_ordinal: usize,
    ) -> Self {
        let (next_record_kind, next_record_id) = match record {
            TimelineRecordIdentity::Revision(identity) => {
                (HistoryCursorRecordKind::Revision, identity.0.clone())
            }
            TimelineRecordIdentity::LifecycleEvent(identity) => {
                (HistoryCursorRecordKind::LifecycleEvent, identity.0.clone())
            }
        };
        Self {
            version: HISTORY_CURSOR_VERSION,
            vault_id: vault_id.to_string(),
            history_generation,
            note_id: note_id.as_str().to_string(),
            next_record_kind,
            next_record_id,
            next_timeline_ordinal,
        }
    }
}

#[cfg(test)]
impl HistoryModePage {
    pub(crate) fn records(&self) -> &[HistoryModeRecord] {
        &self.records
    }

    pub(crate) fn next_cursor(&self) -> Option<&str> {
        self.next_cursor.as_deref()
    }
}

pub(super) fn project_bounded_history_record(
    record: history_store::BoundedTimelineRecord,
    timeline_ordinal: i64,
    revision_counts: &HashMap<RevisionIdentity, (usize, usize)>,
) -> Result<HistoryModeRecord, HistoryError> {
    Ok(match record {
        history_store::BoundedTimelineRecord::Revision { header, label } => {
            let counts = *revision_counts.get(&header.identity).ok_or_else(|| {
                "History page is missing its verified revision summary".to_string()
            })?;
            project_revision_header(header, label, timeline_ordinal, counts)
        }
        history_store::BoundedTimelineRecord::LifecycleEvent(event) => {
            project_lifecycle_header(event, timeline_ordinal)
        }
    })
}

pub(super) fn retained_history_page(
    store: &history_store::Store,
    note_id: &NoteIdentity,
    cursor: Option<&str>,
    limit: usize,
    invalid_cursor: &str,
) -> Result<HistoryModePage, HistoryError> {
    let vault_root = store.vault_root().to_path_buf();
    let manifest = crate::state::read_vault_manifest_for(&vault_root)
        .map_err(history_failure)?
        .ok_or_else(|| history_failure("History paging requires a vault manifest"))?;
    let continuation = cursor
        .map(|cursor| HistoryCursor::decode(cursor, invalid_cursor))
        .transpose()
        .map_err(HistoryError::Stale)?;
    if continuation.as_ref().is_some_and(|continuation| {
        continuation.version != HISTORY_CURSOR_VERSION
            || continuation.vault_id != manifest.vault_id
            || continuation.note_id != note_id.as_str()
            || continuation.history_generation != manifest.history_generation
    }) {
        return Err(HistoryError::Stale(invalid_cursor.to_string()));
    }
    let start = continuation.as_ref().map(HistoryCursor::record_identity);
    let page = history_store::bounded_timeline_page(store, note_id, start, limit)
        .map_err(history_failure)?
        .ok_or_else(|| HistoryError::Stale(invalid_cursor.to_string()))?;
    let first_ordinal = match &continuation {
        Some(continuation) if continuation.next_timeline_ordinal < page.total_records => {
            continuation.next_timeline_ordinal
        }
        Some(_) => return Err(HistoryError::Stale(invalid_cursor.to_string())),
        None => page.total_records.saturating_sub(1),
    };
    let revision_counts = history_store::history_page_revision_counts(store, &page.records)
        .map_err(history_failure)?;
    let record_count = page.records.len();
    let mut records = Vec::with_capacity(record_count);
    for (index, record) in page.records.into_iter().enumerate() {
        let timeline_ordinal = first_ordinal.saturating_sub(index);
        records.push(
            project_bounded_history_record(record, timeline_ordinal as i64, &revision_counts)
                .map_err(history_failure)?,
        );
    }
    let next_cursor = match page.next_record {
        Some(next_record) => {
            let next_ordinal = first_ordinal.checked_sub(record_count).ok_or_else(|| {
                HistoryError::Corrupt(
                    "Note Timeline record count does not match its lineage".into(),
                )
            })?;
            Some(
                HistoryCursor::for_record(
                    note_id,
                    &manifest.vault_id,
                    manifest.history_generation,
                    &next_record,
                    next_ordinal,
                )
                .encode()
                .map_err(history_failure)?,
            )
        }
        None => None,
    };
    Ok(HistoryModePage {
        records,
        next_cursor,
        previous_cursor: None,
    })
}

/// Context cursors retain the same vault/note/generation scope as ordinary pages,
/// plus the immutable anchor and a signed relative position. They cannot be
/// passed to ordinary paging or another citation's context.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HistoryContextCursor {
    pub(super) scope: HistoryCursor,
    pub(super) revision_id: String,
    pub(super) ordinal: i64,
    pub(super) newer: bool,
}

pub(super) fn retained_revision_context(
    store: &history_store::Store,
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    cursor: Option<&str>,
) -> Result<HistoryModePage, HistoryError> {
    let stale =
        || HistoryError::Stale("History context continuation is no longer available".into());
    let manifest = crate::state::read_vault_manifest_for(store.vault_root())?
        .ok_or_else(|| history_failure("History context requires a vault manifest"))?;
    let continuation = cursor
        .map(|encoded| {
            if encoded.len() > 4096 {
                return Err(stale());
            }
            let bytes = BASE64_URL_SAFE.decode(encoded).map_err(|_| stale())?;
            let cursor: HistoryContextCursor =
                serde_json::from_slice(&bytes).map_err(|_| stale())?;
            if cursor.scope.version != HISTORY_CURSOR_VERSION
                || cursor.scope.vault_id != manifest.vault_id
                || cursor.scope.history_generation != manifest.history_generation
                || cursor.scope.note_id != note_id.as_str()
                || cursor.revision_id != revision_id.as_str()
                || cursor.ordinal.unsigned_abs() > (1_u64 << 52)
            {
                return Err(stale());
            }
            Ok((cursor.scope.record_identity(), cursor.ordinal, cursor.newer))
        })
        .transpose()?;
    let page = history_store::bounded_revision_context(store, note_id, revision_id, continuation)?;
    let encode = |record: TimelineRecordIdentity,
                  ordinal: i64,
                  newer: bool|
     -> Result<String, HistoryError> {
        let cursor = HistoryContextCursor {
            scope: HistoryCursor::for_record(
                note_id,
                &manifest.vault_id,
                manifest.history_generation,
                &record,
                0,
            ),
            revision_id: revision_id.as_str().to_string(),
            ordinal,
            newer,
        };
        Ok(BASE64_URL_SAFE.encode(
            serde_json::to_vec(&cursor).map_err(|error| history_failure(error.to_string()))?,
        ))
    };
    let next_cursor = page
        .older
        .map(|record| {
            encode(
                record,
                page.first_ordinal - page.records.len() as i64,
                false,
            )
        })
        .transpose()?;
    let previous_cursor = page
        .newer
        .map(|record| encode(record, page.first_ordinal + 1, true))
        .transpose()?;
    let counts = history_store::history_page_revision_counts(store, &page.records)?;
    let records = page
        .records
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            project_bounded_history_record(record, page.first_ordinal - index as i64, &counts)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(HistoryModePage {
        records,
        next_cursor,
        previous_cursor,
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryModeRevision {
    pub(super) revision_id: String,
    pub(super) unmanaged_frontmatter: Option<String>,
    pub(super) body: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryDiffComparison {
    Parent,
    Current,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryDiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryDiffLine {
    pub(super) kind: HistoryDiffLineKind,
    pub(super) text: String,
    pub(super) old_line_number: Option<usize>,
    pub(super) new_line_number: Option<usize>,
}

#[cfg(test)]
impl HistoryDiffLine {
    pub(super) fn kind(&self) -> HistoryDiffLineKind {
        self.kind
    }

    pub(super) fn text(&self) -> &str {
        &self.text
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryModeDiff {
    pub(super) revision_id: String,
    pub(super) comparison: HistoryDiffComparison,
    pub(super) from_revision_id: Option<String>,
    pub(super) to_revision_id: Option<String>,
    pub(super) body_lines: Vec<HistoryDiffLine>,
    pub(super) properties_lines: Vec<HistoryDiffLine>,
    pub(super) missing_assets: Vec<String>,
}

#[cfg(test)]
impl HistoryModeDiff {
    pub(super) fn comparison(&self) -> HistoryDiffComparison {
        self.comparison
    }

    pub(super) fn compared_from_revision_id(&self) -> Option<&str> {
        self.from_revision_id.as_deref()
    }

    pub(super) fn to_revision_id(&self) -> Option<&str> {
        self.to_revision_id.as_deref()
    }

    pub(super) fn body_lines(&self) -> &[HistoryDiffLine] {
        &self.body_lines
    }

    pub(super) fn properties_lines(&self) -> &[HistoryDiffLine] {
        &self.properties_lines
    }

    pub(super) fn missing_assets(&self) -> &[String] {
        &self.missing_assets
    }
}

pub(super) fn diff_lines(old: &str, new: &str) -> Vec<HistoryDiffLine> {
    let old_lines = old.split_inclusive('\n').collect::<Vec<_>>();
    let new_lines = new.split_inclusive('\n').collect::<Vec<_>>();
    let mut lines = Vec::new();
    for operation in capture_diff_slices(Algorithm::Myers, &old_lines, &new_lines) {
        match operation {
            DiffOp::Equal {
                old_index,
                new_index,
                len,
            } => {
                for offset in 0..len {
                    lines.push(HistoryDiffLine {
                        kind: HistoryDiffLineKind::Context,
                        text: old_lines[old_index + offset].to_string(),
                        old_line_number: Some(old_index + offset + 1),
                        new_line_number: Some(new_index + offset + 1),
                    });
                }
            }
            DiffOp::Delete {
                old_index, old_len, ..
            } => append_removed_lines(&mut lines, &old_lines, old_index, old_len),
            DiffOp::Insert {
                new_index, new_len, ..
            } => append_added_lines(&mut lines, &new_lines, new_index, new_len),
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => {
                append_removed_lines(&mut lines, &old_lines, old_index, old_len);
                append_added_lines(&mut lines, &new_lines, new_index, new_len);
            }
        }
    }
    lines
}

pub(super) fn append_removed_lines(
    lines: &mut Vec<HistoryDiffLine>,
    source: &[&str],
    start: usize,
    len: usize,
) {
    lines.extend((0..len).map(|offset| HistoryDiffLine {
        kind: HistoryDiffLineKind::Removed,
        text: source[start + offset].to_string(),
        old_line_number: Some(start + offset + 1),
        new_line_number: None,
    }));
}

pub(super) fn append_added_lines(
    lines: &mut Vec<HistoryDiffLine>,
    source: &[&str],
    start: usize,
    len: usize,
) {
    lines.extend((0..len).map(|offset| HistoryDiffLine {
        kind: HistoryDiffLineKind::Added,
        text: source[start + offset].to_string(),
        old_line_number: None,
        new_line_number: Some(start + offset + 1),
    }));
}

pub(super) fn strip_inline_code(line: &str) -> String {
    let mut visible = String::with_capacity(line.len());
    let mut delimiter_width = 0;
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '`' {
            let mut width = 1;
            while chars.peek() == Some(&'`') {
                chars.next();
                width += 1;
            }
            if delimiter_width == 0 {
                delimiter_width = width;
            } else if delimiter_width == width {
                delimiter_width = 0;
            }
        } else if delimiter_width == 0 {
            visible.push(character);
        }
    }
    visible
}

pub(super) fn binary_asset_name(target: &str) -> Option<String> {
    let target = target
        .trim()
        .trim_matches(['<', '>'])
        .split(['|', '#', '?'])
        .next()
        .unwrap_or_default()
        .trim()
        .replace("\\(", "(")
        .replace("\\)", ")");
    if target.is_empty() || target.contains(':') {
        return None;
    }
    let mut components = Path::new(&target)
        .components()
        .map(|component| match component {
            std::path::Component::Normal(component) => component.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    if components.first() == Some(&"assets") {
        components.remove(0);
    }
    if components.is_empty() {
        return None;
    }
    let extension = Path::new(components.last()?)
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "md" | "markdown") {
        return None;
    }
    Some(components.join("/"))
}

pub(super) fn balanced_markdown_destination(target: &str) -> Option<(&str, usize)> {
    let mut depth = 1;
    let mut escaped = false;
    for (index, character) in target.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&target[..index], index + character.len_utf8()));
                }
            }
            _ => {}
        }
    }
    None
}

pub(super) fn referenced_binary_assets(markdown: &str) -> Vec<String> {
    let mut assets = HashSet::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let visible = strip_inline_code(line);
        let mut remainder = visible.as_str();
        while let Some(start) = remainder.find("[[") {
            let target = &remainder[start + 2..];
            let Some(end) = target.find("]]") else {
                break;
            };
            if let Some(file_name) = binary_asset_name(&target[..end]) {
                assets.insert(file_name);
            }
            remainder = &target[end + 2..];
        }
        let mut remainder = visible.as_str();
        while let Some(start) = remainder.find("](") {
            let target = &remainder[start + 2..];
            let Some((destination, consumed)) = balanced_markdown_destination(target) else {
                break;
            };
            let destination = destination.trim();
            let destination = if let Some(stripped) = destination.strip_prefix('<') {
                stripped.split('>').next().unwrap_or_default()
            } else {
                destination
                    .split_ascii_whitespace()
                    .next()
                    .unwrap_or_default()
            };
            if let Some(file_name) = binary_asset_name(destination) {
                assets.insert(file_name);
            }
            remainder = &target[consumed..];
        }
    }
    let mut assets = assets.into_iter().collect::<Vec<_>>();
    assets.sort();
    assets
}

pub(super) fn missing_binary_assets(
    store: &history_store::Store,
    markdown: &str,
) -> Result<Vec<String>, HistoryError> {
    let assets_dir = store.vault_root().to_path_buf().join("assets");
    Ok(referenced_binary_assets(markdown)
        .into_iter()
        .filter(|file_name| !assets_dir.join(file_name).is_file())
        .collect())
}

#[cfg(test)]
impl HistoryModeRevision {
    pub(crate) fn unmanaged_frontmatter(&self) -> Option<&str> {
        self.unmanaged_frontmatter.as_deref()
    }

    pub(crate) fn body(&self) -> &str {
        &self.body
    }
}

pub(super) fn recovered_note_ineligibility(
    store: &history_store::Store,
    note_id: &NoteIdentity,
) -> Result<Option<String>, HistoryError> {
    if history_store::missing_note(store, note_id)?.is_some() {
        return Ok(Some(
            "Recover the missing note before accessing its Note Timeline".to_string(),
        ));
    }
    let Some(path) = history_store::current_path(store, note_id)? else {
        return Ok(None);
    };
    let notes_root = store.vault_root().to_path_buf();
    if crate::state::is_forgotten_note_path(&path, &notes_root) {
        return Ok(Some(
            "Recover the forgotten note before accessing its Note Timeline".to_string(),
        ));
    }
    Ok(None)
}

pub(super) fn require_recovered_note(
    store: &history_store::Store,
    note_id: &NoteIdentity,
) -> Result<(), HistoryError> {
    if let Some(cause) = recovered_note_ineligibility(store, note_id)? {
        Err(cause.into())
    } else {
        Ok(())
    }
}

pub(super) fn canonical_markdown_for_recovered_note(
    note_id: &NoteIdentity,
    retained: &ReconstructedNoteRevision,
) -> Result<String, HistoryError> {
    let (template, _) = crate::note::prepare_note_markdown("", None, Some(None))?;
    let template = crate::note::repair_managed_note_identity(&template, note_id.as_str())?;
    Ok(crate::note::replace_authored_content(
        &template,
        retained.unmanaged_frontmatter(),
        retained.body(),
    )?)
}

pub(super) fn prepare_recovered_note_access(
    state: &AppState,
    note_id: &NoteIdentity,
) -> Result<OperationGuard, HistoryError> {
    let timeline = state.note_timeline();
    let operation = timeline
        .runtime
        .begin_operation()
        .map_err(history_failure)?;
    timeline
        .runtime
        .with_observation_replay(|| {
            timeline.recover_pending_deletions()?;
            timeline.replay_retained_observations(None)?;
            timeline.ensure_history_recovered()
        })
        .map_err(history_failure)?;
    timeline.runtime.ensure_note_ready(note_id)?;
    if let Some(cause) =
        recovered_note_ineligibility(&timeline.runtime.store, note_id).map_err(history_failure)?
    {
        return Err(HistoryError::Ineligible(cause));
    }
    Ok(operation)
}

impl HistoryModeAccess<'_> {
    pub(super) fn with_integrity_tracking<T>(
        &self,
        operation: impl FnOnce() -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        self.state
            .note_timeline()
            .runtime
            .with_history_result(operation)
    }

    pub(super) fn prepare_access(&self) -> Result<OperationGuard, HistoryError> {
        prepare_recovered_note_access(self.state, &self.note_id)
    }

    #[cfg(test)]
    pub(crate) fn revisions(&self) -> Result<Vec<NoteRevisionHeader>, HistoryError> {
        self.with_integrity_tracking(|| {
            let _operation = self.prepare_access()?;
            history_store::revisions(&self.state.note_timeline().runtime.store, &self.note_id)
                .map_err(history_failure)
        })
    }

    #[cfg(test)]
    pub(crate) fn lifecycle_events(&self) -> Result<Vec<LifecycleEventHeader>, HistoryError> {
        self.with_integrity_tracking(|| {
            let _operation = self.prepare_access()?;
            history_store::lifecycle_events(
                &self.state.note_timeline().runtime.store,
                &self.note_id,
            )
            .map_err(history_failure)
        })
    }

    pub(crate) fn reconstruct(
        &self,
        revision_id: &RevisionIdentity,
    ) -> Result<ReconstructedNoteRevision, HistoryError> {
        self.with_integrity_tracking(|| {
            let _operation = self.prepare_access()?;
            self.require_revision(revision_id)?;
            history_store::reconstruct(
                &self.state.note_timeline().runtime.store,
                &self.note_id,
                revision_id,
            )
            .map_err(history_failure)
        })
    }

    pub(super) fn require_revision(
        &self,
        revision_id: &RevisionIdentity,
    ) -> Result<(), HistoryError> {
        if history_store::owns_revision(
            &self.state.note_timeline().runtime.store,
            &self.note_id,
            revision_id,
        )
        .map_err(history_failure)?
        {
            Ok(())
        } else {
            Err(HistoryError::Missing(
                "Selected Note Revision is no longer available".to_string(),
            ))
        }
    }

    pub(crate) fn page(
        &self,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<HistoryModePage, HistoryError> {
        self.with_integrity_tracking(|| {
            let _operation = self.prepare_access()?;
            retained_history_page(
                &self.state.note_timeline().runtime.store,
                &self.note_id,
                cursor,
                limit,
                HISTORY_CURSOR_ERROR,
            )
        })
    }

    pub(crate) fn revision_context(
        &self,
        revision_id: &str,
        cursor: Option<&str>,
    ) -> Result<HistoryModePage, HistoryError> {
        self.with_integrity_tracking(|| {
            let _operation = self.prepare_access()?;
            retained_revision_context(
                &self.state.note_timeline().runtime.store,
                &self.note_id,
                &RevisionIdentity::from_persisted(revision_id),
                cursor,
            )
        })
    }

    pub(crate) fn revision(&self, revision_id: &str) -> Result<HistoryModeRevision, HistoryError> {
        self.with_integrity_tracking(|| {
            let reconstructed = self.reconstruct(&RevisionIdentity::from_persisted(revision_id))?;
            Ok(HistoryModeRevision {
                revision_id: revision_id.to_string(),
                unmanaged_frontmatter: reconstructed.unmanaged_frontmatter,
                body: reconstructed.body,
            })
        })
    }

    pub(super) fn current_restore_state(&self) -> Result<(PathBuf, String, String), HistoryError> {
        let path =
            history_store::current_path(&self.state.note_timeline().runtime.store, &self.note_id)
                .map_err(history_failure)?
                .ok_or_else(|| {
                    HistoryError::Missing(
                        "This Note Timeline has no current path to restore".to_string(),
                    )
                })?;
        let canonical = fs::read_to_string(&path).map_err(|error| {
            history_failure(format!("Read current note before Version Restore: {error}"))
        })?;
        let current_note_id = crate::note::parse_note(&canonical)
            .frontmatter
            .managed
            .map(|metadata| metadata.id)
            .filter(|identity| !identity.trim().is_empty())
            .ok_or_else(|| history_failure("Current note has no managed Note Identity"))?;
        if current_note_id != self.note_id.as_str() {
            return Err(history_failure(
                "Current note identity no longer matches this Note Timeline",
            ));
        }
        let hash = history_store::authored_content_hash(&canonical);
        let retained_hash = history_store::current_content_hash(
            &self.state.note_timeline().runtime.store,
            &self.note_id,
        )
        .map_err(history_failure)?
        .ok_or_else(|| {
            HistoryError::Missing("This Note Timeline has no current authored state".to_string())
        })?;
        if hash != retained_hash {
            return Err(history_failure(
                "Current authored content has not been captured by the Note Timeline; retry after synchronization",
            ));
        }
        Ok((path, canonical, hash))
    }

    pub(crate) fn restore_preview(
        &self,
        revision_id: &str,
    ) -> Result<HistoryRestorePreview, HistoryError> {
        self.with_integrity_tracking(|| {
            let _operation = self.prepare_access()?;
            let (_, _, current_authored_content_hash) = self.current_restore_state()?;
            let selected_id = RevisionIdentity::from_persisted(revision_id.trim());
            self.require_revision(&selected_id)?;
            let selected = history_store::reconstruct(
                &self.state.note_timeline().runtime.store,
                &self.note_id,
                &selected_id,
            )
            .map_err(history_failure)?;
            Ok(HistoryRestorePreview {
                revision_id: selected_id.0,
                current_authored_content_hash,
                unmanaged_frontmatter: selected.unmanaged_frontmatter,
                body: selected.body,
            })
        })
    }

    pub(crate) fn confirm_restore(
        &self,
        revision_id: &str,
        expected_current_authored_content_hash: &str,
    ) -> Result<HistoryRestoreResult, HistoryError> {
        self.with_integrity_tracking(|| {
            if expected_current_authored_content_hash.trim().is_empty() {
                return Err(history_failure(
                    "Version Restore confirmation requires its preview hash",
                ));
            }
            crate::state::with_note_file_mutation(|| {
                let _operation = self.prepare_access()?;
                let timeline = self.state.note_timeline();
                let (path, current, current_hash) = self.current_restore_state()?;
                if current_hash != expected_current_authored_content_hash {
                    return Err(HistoryError::Stale(
                        "Current authored content changed after this restore preview was created"
                            .to_string(),
                    ));
                }
                let selected_id = RevisionIdentity::from_persisted(revision_id.trim());
                self.require_revision(&selected_id)?;
                let selected = history_store::reconstruct(
                    &self.state.note_timeline().runtime.store,
                    &self.note_id,
                    &selected_id,
                )?;
                let selected_authored_hash = history_store::authored_parts_hash(
                    selected.unmanaged_frontmatter(),
                    selected.body(),
                );
                let replacement = crate::note::replace_authored_content(
                    &current,
                    selected.unmanaged_frontmatter(),
                    selected.body(),
                )?;
                let replacement_hash = history_store::authored_content_hash(&replacement);
                if replacement_hash != selected_authored_hash {
                    return Err(history_failure(
                        "Version Restore could not preserve the selected authored content exactly"
                            .to_string(),
                    ));
                }
                if replacement_hash == current_hash {
                    return Err(HistoryError::AlreadyCurrent(
                        "Selected revision already matches current authored content".to_string(),
                    ));
                }
                let prepared = timeline.prepare_exact_revision_publication(
                    MutationSource::VersionRestore,
                    &path,
                    Some(&path),
                    Some(&self.note_id),
                    &replacement,
                )?;
                if let Err(error) = history_store::prepare_restore_origin(
                    &self.state.note_timeline().runtime.store,
                    &prepared.history_intent,
                    &selected_id,
                ) {
                    return Err(history_failure(
                        prepared.into_parts().1.abandon_after_history_failure(error),
                    ));
                }
                if history_store::authored_content_hash(prepared.canonical_markdown())
                    != selected_authored_hash
                {
                    return Err(history_failure(
                        prepared.into_parts().1.abandon_after_publication_failure(
                            "Version Restore preparation changed the selected authored content"
                                .to_string(),
                        ),
                    ));
                }
                let still_current = fs::read_to_string(&path).map_err(|error| {
                    format!("Recheck current note before Version Restore: {error}")
                })?;
                if history_store::authored_content_hash(&still_current)
                    != expected_current_authored_content_hash
                {
                    return Err(HistoryError::Stale(
                    prepared.into_parts().1.abandon_after_publication_failure(
                        "Current authored content changed while Version Restore was being prepared"
                            .to_string(),
                    ),
                ));
                }
                let (canonical_markdown, history_intent) = prepared.into_parts();
                let restored_revision_id = match history_store::publication_revision_identity(
                    &self.state.note_timeline().runtime.store,
                    &history_intent,
                ) {
                    Ok(revision_id) => revision_id,
                    Err(error) => {
                        return Err(history_failure(
                            history_intent.abandon_after_history_failure(error),
                        ));
                    }
                };
                let expected_write =
                    crate::vault_watcher::record_expected_write(&path, &canonical_markdown);
                if let Err(error) =
                    crate::state::atomic_write_note(&path, canonical_markdown.as_bytes())
                {
                    return Err(history_failure(
                        history_intent.abandon_after_publication_failure(error),
                    ));
                }
                expected_write.commit();
                Ok(HistoryRestoreResult {
                    revision_id: restored_revision_id,
                    mutation: timeline.mutate(NoteMutation::version_restore(
                        history_intent,
                        path.clone(),
                        Some(path),
                        canonical_markdown,
                    )),
                })
            })
        })
    }

    pub(crate) fn name_revision(
        &self,
        revision_id: &RevisionIdentity,
        label: &str,
    ) -> Result<(), HistoryError> {
        self.with_integrity_tracking(|| {
            let label = label.trim();
            if label.is_empty() {
                return Err(history_failure("A Named Revision label cannot be empty"));
            }
            self.mutate_revision_label(revision_id, |note_id, revision_id| {
                history_store::name_revision(
                    &self.state.note_timeline().runtime.store,
                    note_id,
                    revision_id,
                    label,
                )
            })
        })
    }

    pub(super) fn mutate_revision_label(
        &self,
        revision_id: &RevisionIdentity,
        mutation: impl FnOnce(&NoteIdentity, &RevisionIdentity) -> Result<(), HistoryError>,
    ) -> Result<(), HistoryError> {
        let _operation = self.prepare_access()?;
        self.require_revision(revision_id)?;
        mutation(&self.note_id, revision_id).map_err(history_failure)
    }

    pub(crate) fn remove_revision_name(
        &self,
        revision_id: &RevisionIdentity,
    ) -> Result<(), HistoryError> {
        self.with_integrity_tracking(|| {
            self.mutate_revision_label(revision_id, |note, revision| {
                history_store::remove_revision_name(
                    &self.state.note_timeline().runtime.store,
                    note,
                    revision,
                )
            })
        })
    }

    pub(crate) fn diff(
        &self,
        revision_id: &str,
        comparison: HistoryDiffComparison,
    ) -> Result<HistoryModeDiff, HistoryError> {
        self.with_integrity_tracking(|| {
            crate::state::with_note_file_mutation(|| {
                let _operation = self.prepare_access()?;
                let revision_id = RevisionIdentity::from_persisted(revision_id);
                self.require_revision(&revision_id)?;
                let reconstructed = history_store::reconstruct_comparison(
                    &self.state.note_timeline().runtime.store,
                    &self.note_id,
                    &revision_id,
                    comparison,
                )
                .map_err(history_failure)?;
                let from = reconstructed.from;
                let to = reconstructed.to;
                let selected_body = match comparison {
                    HistoryDiffComparison::Parent => &to.body,
                    HistoryDiffComparison::Current => &from.body,
                };
                let old_properties = from.unmanaged_frontmatter.as_deref().unwrap_or_default();
                let new_properties = to.unmanaged_frontmatter.as_deref().unwrap_or_default();
                Ok(HistoryModeDiff {
                    revision_id: revision_id.0,
                    comparison,
                    from_revision_id: reconstructed.from_id.map(|id| id.0),
                    to_revision_id: reconstructed.to_id.map(|id| id.0),
                    body_lines: diff_lines(&from.body, &to.body),
                    properties_lines: diff_lines(old_properties, new_properties),
                    missing_assets: missing_binary_assets(
                        &self.state.note_timeline().runtime.store,
                        selected_body,
                    )
                    .map_err(history_failure)?,
                })
            })
        })
    }
}
