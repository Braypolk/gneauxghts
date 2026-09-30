//! Read-only retained changes for explicit activity queries. History Mode and
//! restore authority are deliberately not exposed through this capability.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalPassage {
    pub(crate) revision_id: String,
    pub(crate) content_revision_id: String,
    pub(crate) change_kind: String,
    pub(crate) time_evidence: RevisionTimeEvidence,
    pub(crate) source: MutationSource,
}

impl HistoricalPassage {
    pub(crate) fn recorded_at_millis(&self) -> u64 {
        self.time_evidence.occurred_at_millis()
    }
}

pub(crate) struct HistoricalChange {
    pub(crate) proof: HistoricalPassage,
    pub(crate) location: String,
    pub(crate) start: usize,
    pub(crate) text: String,
}

pub(crate) struct ActivityHistoryAccess<'a> {
    pub(super) current: CurrentContentAccess<'a>,
}

impl NoteTimeline<'_> {
    pub(crate) fn activity_history(&self, scope: AllowedScope) -> ActivityHistoryAccess<'_> {
        ActivityHistoryAccess {
            current: self.current_content(scope),
        }
    }
}

impl ActivityHistoryAccess<'_> {
    pub(crate) fn changes(
        &self,
        note: &NoteIdentity,
        after: u64,
        before: u64,
    ) -> Result<(Vec<HistoricalChange>, bool), HistoryError> {
        self.current
            .with_integrity_tracking(|| self.changes_inner(note, after, before))
    }
    fn changes_inner(
        &self,
        note: &NoteIdentity,
        after: u64,
        before: u64,
    ) -> Result<(Vec<HistoricalChange>, bool), HistoryError> {
        if after >= before {
            return Err(HistoryError::Ineligible("Invalid activity range".into()));
        }
        self.current.finalize_evidence_target(note)?;
        let (_lease, _) = self.current.prepare_read().map_err(history_failure)?;
        if !self
            .current
            .eligibility()?
            .allows_note(Some(note.as_str()), None)
        {
            return Err(HistoryError::Ineligible("Note is not allowed".into()));
        }
        let snapshot = provenance::read_with_version(&self.current, note)?
            .ok_or_else(|| HistoryError::Ineligible("Canonical note is not captured".into()))?;
        let version = self.current.runtime.current_content_version()?;
        let mut result = Vec::new();
        let mut cursor = None;
        let mut scanned = 0;
        let mut complete = true;
        'pages: loop {
            let Some(page) = history_store::bounded_timeline_page(
                &self.current.runtime.store,
                note,
                cursor,
                100,
            )?
            else {
                break;
            };
            for record in page.records {
                scanned += 1;
                if scanned > 4096 {
                    complete = false;
                    break 'pages;
                }
                let history_store::BoundedTimelineRecord::Revision { header, .. } = record else {
                    continue;
                };
                if matches!(header.time_evidence, RevisionTimeEvidence::Baseline { .. })
                    || !header.time_evidence.overlaps(after, before)
                {
                    continue;
                }
                let changes = self.revision_changes(note, &header.identity)?;
                for change in changes {
                    if result.len() >= 4096 {
                        complete = false;
                        break 'pages;
                    }
                    result.push(change);
                }
            }
            cursor = page.next_record;
            if cursor.is_none() {
                break;
            }
        }
        if !self.current.runtime.current_content_is_current(version)?
            || !snapshot.is_current(&self.current)?
        {
            return Err(HistoryError::Stale(
                "History changed during activity read".into(),
            ));
        }
        Ok((result, complete))
    }

    fn revision_changes(
        &self,
        note: &NoteIdentity,
        revision: &RevisionIdentity,
    ) -> Result<Vec<HistoricalChange>, HistoryError> {
        let store = &self.current.runtime.store;
        let headers = history_store::revisions(store, note)?;
        let header = headers
            .iter()
            .find(|h| &h.identity == revision)
            .ok_or_else(|| HistoryError::Stale("Revision is unavailable".into()))?;
        if matches!(header.time_evidence, RevisionTimeEvidence::Baseline { .. }) {
            return Ok(vec![]);
        }
        let comparison = history_store::reconstruct_comparison(
            store,
            note,
            revision,
            HistoryDiffComparison::Parent,
        )?;
        let mut result = Vec::new();
        for (location, old, new) in [
            (
                "body",
                comparison.from.body.as_str(),
                comparison.to.body.as_str(),
            ),
            (
                "properties",
                comparison
                    .from
                    .unmanaged_frontmatter
                    .as_deref()
                    .unwrap_or(""),
                comparison.to.unmanaged_frontmatter.as_deref().unwrap_or(""),
            ),
        ] {
            // Match line content independently of the final newline. Appending
            // a paragraph must not turn the previous last line into new work.
            // Excerpts and offsets still come from the original retained bytes.
            let old_lines: Vec<_> = old.split_inclusive('\n').collect();
            let new_lines: Vec<_> = new.split_inclusive('\n').collect();
            let old_tokens: Vec<_> = old_lines
                .iter()
                .map(|s| s.strip_suffix('\n').unwrap_or(s))
                .collect();
            let new_tokens: Vec<_> = new_lines
                .iter()
                .map(|s| s.strip_suffix('\n').unwrap_or(s))
                .collect();
            let diff = similar::TextDiff::from_slices(&old_tokens, &new_tokens);
            let mut old_offset = 0;
            let mut new_offset = 0;
            for change in diff.iter_all_changes() {
                let text = match change.tag() {
                    similar::ChangeTag::Delete => old_lines[change.old_index().unwrap()],
                    similar::ChangeTag::Insert => new_lines[change.new_index().unwrap()],
                    similar::ChangeTag::Equal => {
                        old_offset += old_lines[change.old_index().unwrap()].len();
                        new_offset += new_lines[change.new_index().unwrap()].len();
                        continue;
                    }
                };
                let (kind, content_revision, start) = match change.tag() {
                    similar::ChangeTag::Delete => {
                        ("removed", comparison.from_id.as_ref(), old_offset)
                    }
                    similar::ChangeTag::Insert => ("added", comparison.to_id.as_ref(), new_offset),
                    similar::ChangeTag::Equal => unreachable!(),
                };
                if let Some(content_revision) = content_revision {
                    if !text.trim().is_empty() {
                        result.push(HistoricalChange {
                            proof: HistoricalPassage {
                                revision_id: revision.as_str().into(),
                                content_revision_id: content_revision.as_str().into(),
                                change_kind: kind.into(),
                                time_evidence: header.time_evidence,
                                source: header.source,
                            },
                            location: location.into(),
                            start,
                            text: text.into(),
                        });
                    }
                }
                match change.tag() {
                    similar::ChangeTag::Delete => old_offset += text.len(),
                    similar::ChangeTag::Insert => new_offset += text.len(),
                    _ => {}
                }
            }
        }
        Ok(result)
    }

    pub(crate) fn validate(
        &self,
        note: &NoteIdentity,
        proof: &HistoricalPassage,
        location: &str,
        start: usize,
        end: usize,
        excerpt: &str,
    ) -> Result<bool, HistoryError> {
        self.current.with_integrity_tracking(|| {
            self.validate_inner(note, proof, location, start, end, excerpt)
        })
    }
    fn validate_inner(
        &self,
        note: &NoteIdentity,
        proof: &HistoricalPassage,
        location: &str,
        start: usize,
        end: usize,
        excerpt: &str,
    ) -> Result<bool, HistoryError> {
        let (_lease, _) = self.current.prepare_read().map_err(history_failure)?;
        if !self
            .current
            .eligibility()?
            .allows_note(Some(note.as_str()), None)
        {
            return Ok(false);
        }
        let Some(snapshot) = provenance::read_with_version(&self.current, note)? else {
            return Ok(false);
        };
        let changes = self.revision_changes(
            note,
            &RevisionIdentity::from_persisted(proof.revision_id.clone()),
        )?;
        Ok(snapshot.is_current(&self.current)?
            && changes.iter().any(|c| {
                &c.proof == proof
                    && c.location == location
                    && start >= c.start
                    && end >= start
                    && c.text.get(start - c.start..end - c.start) == Some(excerpt)
            }))
    }
}
