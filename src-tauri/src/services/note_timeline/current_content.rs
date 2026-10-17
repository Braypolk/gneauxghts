use super::*;

pub(crate) struct CurrentContentAccess<'a> {
    pub(super) state: &'a AppState,
    pub(super) runtime: &'a NoteTimelineRuntime,
    pub(super) scope: AllowedScope,
}

/// A canonical read does not create an Editing Window boundary. A revision is
/// present only when its retained authored payload reconstructs this read.
pub(crate) struct CanonicalNoteRead {
    pub(crate) markdown: String,
    pub(crate) path: PathBuf,
    pub(crate) title: String,
    pub(crate) revision: Option<RevisionCitation>,
    version: CurrentContentVersion,
    _operation: OperationGuard,
}

// Current-content delivery policy shared by search, retrieval, tasks, and Atlas.

pub(crate) trait CurrentContentProjection {
    type Item: CurrentContentItem;

    fn retain_current(&mut self, retains: &mut dyn FnMut(&Self::Item) -> bool);
}

pub(crate) enum CurrentContentIdentity<'a> {
    NonNote,
    Note {
        note_id: Option<&'a str>,
        note_path: Option<&'a str>,
    },
}

pub(crate) trait CurrentContentItem {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_>;
}

impl<T: CurrentContentItem> CurrentContentProjection for Vec<T> {
    type Item = T;

    fn retain_current(&mut self, retains: &mut dyn FnMut(&T) -> bool) {
        self.retain(retains);
    }
}

pub(super) struct CurrentContentEligibility<'a> {
    pub(super) scope: &'a AllowedScope,
    pub(super) active_notes: HashMap<String, PathBuf>,
    pub(super) active_paths: HashMap<PathBuf, String>,
}

impl CurrentContentEligibility<'_> {
    pub(super) fn allows_note(&self, note_id: Option<&str>, note_path: Option<&str>) -> bool {
        let path = note_path.map(PathBuf::from);
        let resolved_note_id = note_id.map(str::to_string).or_else(|| {
            path.as_ref()
                .and_then(|path| self.active_paths.get(path).cloned())
        });
        let Some(resolved_note_id) = resolved_note_id else {
            return false;
        };
        let identity = NoteIdentity::new(resolved_note_id.clone());
        if !self.scope.allows(&identity) {
            return false;
        }
        let Some(active_path) = self.active_notes.get(&resolved_note_id) else {
            return false;
        };
        path.as_ref().is_none_or(|path| path == active_path)
    }

    pub(super) fn retains<T: CurrentContentItem>(&self, item: &T) -> bool {
        match item.current_note_identity() {
            CurrentContentIdentity::NonNote => true,
            CurrentContentIdentity::Note { note_id, note_path } => {
                self.allows_note(note_id, note_path)
            }
        }
    }
}

impl CurrentContentAccess<'_> {
    pub(crate) fn validate_note_read(
        &self,
        note_id: &NoteIdentity,
        read: &CanonicalNoteRead,
    ) -> Result<bool, HistoryError> {
        Ok(self.runtime.current_content_is_current(read.version)?
            && self
                .eligibility()?
                .allows_note(Some(note_id.as_str()), read.path.to_str())
            && fs::read_to_string(&read.path).ok().as_ref() == Some(&read.markdown))
    }
    pub(crate) fn read_note(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<CanonicalNoteRead, HistoryError> {
        for _ in 0..3 {
            let (operation, version) = self.prepare_refreshable_read()?;
            let eligibility = self.eligibility()?;
            if !eligibility.allows_note(Some(note_id.as_str()), None) {
                return Err(HistoryError::Ineligible(
                    "Note is unavailable or outside the allowed scope".into(),
                ));
            }
            let path = eligibility.active_notes[note_id.as_str()].clone();
            let markdown = fs::read_to_string(&path)
                .map_err(|_| HistoryError::Ineligible("Note is unavailable".into()))?;
            let parsed = crate::note::parse_note(&markdown);
            // Eligibility resolves the canonical catalog identity. An external
            // editor may remove or damage its embedded copy without changing
            // the known note; only a present conflicting identity displaces it.
            if parsed.frontmatter.managed.as_ref().is_some_and(|managed| {
                (!managed.id.trim().is_empty() && managed.id != note_id.as_str())
                    || managed.trashed_at.is_some()
            }) {
                return Err(HistoryError::Ineligible(
                    "Canonical Note Identity changed; retry the read".into(),
                ));
            }
            self.runtime.ensure_note_ready(note_id)?;
            let revision =
                match history_store::current_revision_header(&self.runtime.store, note_id)? {
                    Some(header)
                        if history_store::reconstruct(
                            &self.runtime.store,
                            note_id,
                            &header.identity,
                        )? == history_store::authored_content(&markdown) =>
                    {
                        Some(RevisionCitation {
                            note_id: note_id.as_str().into(),
                            revision_id: header.identity.as_str().into(),
                            at_millis: header.time_evidence.occurred_at_millis(),
                            time_evidence: Some(header.time_evidence),
                            source: header.source,
                            current_excerpt: String::new(),
                        })
                    }
                    _ => None,
                };
            if fs::read_to_string(&path).ok().as_ref() != Some(&markdown)
                || !self.runtime.current_content_is_current(version)?
                || !self
                    .eligibility()?
                    .allows_note(Some(note_id.as_str()), path.to_str())
            {
                continue;
            }
            return Ok(CanonicalNoteRead {
                markdown,
                title: path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                path,
                revision,
                version,
                _operation: operation,
            });
        }
        Err(HistoryError::Stale(
            "Current note changed during the read; retry the read".into(),
        ))
    }

    pub(super) fn with_integrity_tracking<T>(
        &self,
        operation: impl FnOnce() -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        self.runtime.with_history_result(operation)
    }

    pub(crate) fn current_citations(
        &self,
        citations: &[RevisionCitation],
    ) -> Result<Vec<RevisionCitation>, HistoryError> {
        self.with_integrity_tracking(|| activity::current_citations(self, citations))
    }

    pub(crate) fn activity(
        &self,
        after: u64,
        before: u64,
        offset: usize,
        limit: usize,
    ) -> Result<activity::ActivityPage, HistoryError> {
        self.with_integrity_tracking(|| activity::read(self, after, before, offset, limit))
    }

    pub(crate) fn provenance(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<Option<provenance::CurrentContentProvenance>, HistoryError> {
        self.with_integrity_tracking(|| {
            self.finalize_evidence_target(note_id)?;
            Ok(provenance::read_with_version(self, note_id)?.map(|read| read.current))
        })
    }

    /// An explicit evidence boundary owns eligibility and canonical checks through
    /// finalization. A stale disk observation cannot seal an unrelated endpoint.
    pub(super) fn finalize_evidence_target(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<(), HistoryError> {
        if !self
            .eligibility()?
            .allows_note(Some(note_id.as_str()), None)
        {
            return Ok(());
        }
        self.state
            .note_timeline()
            .await_history_readiness(note_id)?;
        crate::state::with_note_file_mutation(|| self.finalize_evidence_target_owned(note_id))
    }

    // Caller holds the note-file mutation owner, including activity selection.
    pub(super) fn finalize_evidence_target_owned(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<(), HistoryError> {
        let timeline = self.state.note_timeline();
        let _operation = self.runtime.begin_operation()?;
        timeline
            .with_settled_history_mutation(|| {
                let eligibility = self.eligibility()?;
                if !eligibility.allows_note(Some(note_id.as_str()), None)
                    || recovered_note_ineligibility(&self.runtime.store, note_id)?.is_some()
                {
                    return Ok(());
                }
                let path = &eligibility.active_notes[note_id.as_str()];
                let canonical = fs::read_to_string(path).map_err(|e| e.to_string())?;
                let parsed = crate::note::parse_note(&canonical);
                if parsed
                    .frontmatter
                    .managed
                    .as_ref()
                    .is_some_and(|m| m.id != note_id.as_str())
                    || history_store::current_content_hash(&self.runtime.store, note_id)?.as_deref()
                        != Some(history_store::authored_content_hash(&canonical).as_str())
                {
                    return Ok(());
                }
                if history_store::pending_window(&self.runtime.store, note_id)?.is_some() {
                    let _mutation = timeline.begin_current_content_mutation()?;
                    timeline.finalize_editor_capture(note_id)?;
                }
                Ok(())
            })
            .map_err(history_failure)
    }

    pub(super) fn prepare_read(
        &self,
    ) -> Result<(OperationGuard, CurrentContentVersion), HistoryError> {
        self.with_integrity_tracking(|| {
            let operation = self.runtime.begin_operation()?;
            let timeline = NoteTimeline {
                state: self.state,
                runtime: self.runtime,
            };
            let version = self.runtime.with_observation_replay(|| {
                timeline.recover_pending_deletions()?;
                self.runtime.current_content_version()
            })?;
            Ok((operation, version))
        })
    }

    fn prepare_refreshable_read(
        &self,
    ) -> Result<(OperationGuard, CurrentContentVersion), HistoryError> {
        // Preparation races share the original settlement budget. A queued
        // writer must finish before we spend a projection attempt.
        let deadline = self.runtime.current_content_settlement_deadline();
        loop {
            self.runtime.await_current_content_settled(deadline)?;
            let prepared = self.with_integrity_tracking(|| {
                let operation = self.runtime.begin_operation()?;
                let timeline = NoteTimeline {
                    state: self.state,
                    runtime: self.runtime,
                };
                let version = self.runtime.with_observation_replay(|| {
                    timeline.recover_pending_deletions()?;
                    self.runtime.settled_current_content_version()
                })?;
                Ok(version.map(|version| (operation, version)))
            })?;
            if let Some(prepared) = prepared {
                return Ok(prepared);
            }
            // Both replay ownership and the unsuccessful operation lease have
            // been released before waiting for the writer queued behind us.
        }
    }

    pub(super) fn eligibility(&self) -> Result<CurrentContentEligibility<'_>, HistoryError> {
        let notes_root = self.runtime.store.vault_root().to_path_buf();
        let index = self
            .state
            .notes_index
            .lock()
            .map_err(|_| "Notes index lock poisoned".to_string())?;
        let mut active_notes = HashMap::new();
        let mut active_paths = HashMap::new();
        for (path, note) in &index.entries {
            if !path.starts_with(&notes_root)
                || crate::state::is_forgotten_note_path(path, &notes_root)
                || !path.is_file()
            {
                continue;
            }
            active_notes.insert(note.note_id.clone(), path.clone());
            active_paths.insert(path.clone(), note.note_id.clone());
        }
        Ok(CurrentContentEligibility {
            scope: &self.scope,
            active_notes,
            active_paths,
        })
    }

    pub(super) fn finish_read<T: CurrentContentProjection>(
        &self,
        version: CurrentContentVersion,
        mut projection: T,
    ) -> Result<T, HistoryError> {
        let eligibility = self.eligibility()?;
        let current = self.runtime.current_content_is_current(version)?;
        projection.retain_current(&mut |item| current && eligibility.retains(item));
        Ok(projection)
    }

    pub(crate) fn read<T: CurrentContentProjection>(
        &self,
        query: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let (_operation, version) = self.prepare_read()?;
        let projection = query()?;
        self.finish_read(version, projection).map_err(Into::into)
    }

    /// Only repeatable projection queries belong here. Mutating commands must
    /// keep their single-execution read path. An invalidated projection is not
    /// evidence that the vault has no items.
    pub(crate) fn read_refreshable<T: CurrentContentProjection>(
        &self,
        mut query: impl FnMut() -> Result<T, String>,
    ) -> Result<T, String> {
        for _ in 0..3 {
            let (_operation, version) = self.prepare_refreshable_read()?;
            let mut projection = query()?;
            let eligibility = self.eligibility()?;
            if !self.runtime.current_content_is_current(version)? {
                continue;
            }
            projection.retain_current(&mut |item| eligibility.retains(item));
            return Ok(projection);
        }
        Err(
            HistoryError::Stale("Current notes changed during the read; retry the read".into())
                .into(),
        )
    }

    pub(crate) async fn read_async<T, F>(&self, query: F) -> Result<T, String>
    where
        T: CurrentContentProjection,
        F: std::future::Future<Output = Result<T, String>>,
    {
        let (_operation, version) = self.prepare_read()?;
        let projection = query.await?;
        self.finish_read(version, projection).map_err(Into::into)
    }
}
