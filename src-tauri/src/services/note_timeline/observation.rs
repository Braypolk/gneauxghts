use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ObservationReceipt {
    pub(super) source: VaultObservationSource,
    pub(super) kind: VaultObservationKind,
    pub(super) path: PathBuf,
    pub(super) previous_path: Option<PathBuf>,
    pub(super) observed_at_millis: u64,
    pub(super) modified_at_millis: Option<u64>,
    pub(super) commit_warning: Option<NoteMutationWarning>,
}

impl ObservationReceipt {
    #[cfg(test)]
    pub(crate) fn source(&self) -> VaultObservationSource {
        self.source
    }

    #[cfg(test)]
    pub(crate) fn kind(&self) -> VaultObservationKind {
        self.kind
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    #[cfg(test)]
    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn observed_at_millis(&self) -> u64 {
        self.observed_at_millis
    }

    #[cfg(test)]
    pub(crate) fn modified_at_millis(&self) -> Option<u64> {
        self.modified_at_millis
    }

    pub(crate) fn commit_warning(&self) -> Option<&NoteMutationWarning> {
        self.commit_warning.as_ref()
    }
}

impl<'a> NoteTimeline<'a> {
    pub(crate) fn observe(
        &self,
        observation: VaultObservation,
    ) -> Result<ObservationReceipt, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        self.runtime.store.require_path(&observation.path)?;
        if let Some(path) = &observation.previous_path {
            self.runtime.store.require_path(path)?;
        }
        let _current_content_mutation = self.begin_current_content_mutation()?;
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            let observation = self.capture_observed_markdown(observation)?;
            if observation.kind == VaultObservationKind::ReconciliationScan {
                self.replay_retained_observations(None)?;
                return self.apply_observation(observation);
            }

            let requested_sequence =
                history_store::retain_observation(&self.runtime.store, &observation)?;
            #[cfg(feature = "e2e-wdio")]
            crate::e2e_process_fault::hit("observation-retained");
            Ok(self
                .replay_retained_observations(Some(requested_sequence))?
                .ok_or_else(|| {
                    format!(
                        "Retained Note Timeline observation {requested_sequence} was not replayed"
                    )
                })?)
        })
    }

    pub(super) fn recover_retained_observations(&self) -> Result<(), HistoryError> {
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            self.replay_retained_observations(None).map(|_| ())
        })
    }

    pub(super) fn replay_retained_observations(
        &self,
        requested_sequence: Option<i64>,
    ) -> Result<Option<ObservationReceipt>, HistoryError> {
        self.replay_retained_observations_except(requested_sequence, &HashSet::new())
    }

    pub(super) fn replay_retained_observations_except(
        &self,
        requested_sequence: Option<i64>,
        deferred: &HashSet<i64>,
    ) -> Result<Option<ObservationReceipt>, HistoryError> {
        let mut requested_receipt = None;
        for retained in history_store::retained_observations(&self.runtime.store)? {
            if deferred.contains(&retained.sequence) {
                continue;
            }
            let receipt = self
                .apply_observation(retained.observation)
                .map_err(|error| {
                    format!(
                        "Replay retained Note Timeline observation {}: {error}",
                        retained.sequence
                    )
                })?;
            history_store::acknowledge_observation(&self.runtime.store, retained.sequence)?;
            if requested_sequence == Some(retained.sequence) {
                requested_receipt = Some(receipt);
            }
        }
        Ok(requested_receipt)
    }

    pub(super) fn capture_observed_markdown(
        &self,
        mut observation: VaultObservation,
    ) -> Result<VaultObservation, HistoryError> {
        let requires_markdown = matches!(observation.kind, VaultObservationKind::CanonicalState)
            || matches!(
                observation.kind,
                VaultObservationKind::Lifecycle(
                    LifecycleEventKind::Renamed | LifecycleEventKind::Moved
                )
            );
        if requires_markdown && observation.canonical_markdown.is_none() {
            observation.canonical_markdown =
                Some(fs::read_to_string(&observation.path).map_err(|error| {
                    format!(
                        "Capture observed canonical note {}: {error}",
                        observation.path.display()
                    )
                })?);
        }
        if observation.kind == VaultObservationKind::Lifecycle(LifecycleEventKind::Missing)
            && observation.missing_retention_days.is_none()
        {
            observation.missing_retention_days =
                Some(crate::state::forgotten_note_retention_days()?);
        }
        Ok(observation)
    }

    pub(super) fn apply_observation(
        &self,
        observation: VaultObservation,
    ) -> Result<ObservationReceipt, HistoryError> {
        let VaultObservation {
            source,
            mut kind,
            path,
            mut previous_path,
            observed_at_millis,
            modified_at_millis,
            canonical_markdown,
            missing_retention_days,
        } = observation;
        let mut lifecycle_projection_warning = None;
        match kind {
            VaultObservationKind::ReconciliationScan => {
                self.ensure_history_recovered()?;
            }
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing) => {
                self.ensure_history_recovered()?;
                let note_id = self
                    .state
                    .indexed_note_identity(&path)?
                    .map(NoteIdentity::new)
                    .or(history_store::note_identity_for_current_path(
                        &self.runtime.store,
                        &path,
                    )?);
                if let Some(note_id) = note_id {
                    self.finalize_editor_capture(&note_id)?;
                    self.state.detach_indexed_note_identity(&path)?;
                    let retention_days = missing_retention_days.ok_or_else(|| {
                        "Missing Note observation has no captured retention setting".to_string()
                    })?;
                    let missing_record = MissingNoteRecord::captured(
                        note_id.clone(),
                        path.clone(),
                        observed_at_millis,
                        retention_days,
                    );
                    history_store::record_observed_missing_lifecycle_event(
                        &self.runtime.store,
                        &missing_record,
                    )?;
                    lifecycle_projection_warning = self.synchronize_missing_projection(&path);
                }
            }
            VaultObservationKind::CanonicalState => {
                let markdown = canonical_markdown.map(Ok).unwrap_or_else(|| {
                    fs::read_to_string(&path).map_err(|error| {
                        format!("Read observed canonical note {}: {error}", path.display())
                    })
                })?;
                self.ensure_history_recovered()?;
                let embedded_note_id = crate::note::parse_note(&markdown)
                    .frontmatter
                    .managed
                    .map(|metadata| NoteIdentity::new(metadata.id))
                    .filter(|identity| !identity.as_str().trim().is_empty());
                let historical_path = embedded_note_id
                    .as_ref()
                    .map(|value| history_store::current_path(&self.runtime.store, value))
                    .transpose()?
                    .flatten();
                let identity_history = historical_path.as_deref().filter(|historical_path| {
                    source == VaultObservationSource::Reconciliation || *historical_path == path
                });
                let note_id = self.state.resolve_observed_note_identity(
                    &path,
                    &markdown,
                    identity_history,
                )?;
                // Self-observations compare the captured canonical endpoint,
                // which can be newer than the immutable revision anchor.
                let identity = NoteIdentity::new(note_id.clone());
                self.runtime.ensure_note_ready(&identity)?;
                let unchanged =
                    history_store::current_content_hash(&self.runtime.store, &identity)?.as_deref()
                        == Some(history_store::authored_content_hash(&markdown).as_str());
                if !unchanged || historical_path.as_deref().is_some_and(|old| old != path) {
                    self.finalize_editor_capture(&identity)?;
                }
                if let Some(previous_path) = historical_path.as_deref().filter(|previous_path| {
                    source == VaultObservationSource::Reconciliation
                        && *previous_path != path
                        && !previous_path.exists()
                }) {
                    let relocation = if previous_path.parent() == path.parent() {
                        LifecycleEventKind::Renamed
                    } else {
                        LifecycleEventKind::Moved
                    };
                    history_store::record_observed_lifecycle_event(
                        &self.runtime.store,
                        &NoteIdentity::new(note_id.clone()),
                        relocation,
                        Some(previous_path),
                        &path,
                        observed_at_millis,
                    )?;
                }
                if history_store::baseline_initialization_progress(&self.runtime.store)?.phase()
                    != BaselineInitializationPhase::Complete
                {
                    history_store::record_baseline_revision_if_absent(
                        &self.runtime.store,
                        &NoteIdentity::new(note_id.clone()),
                        &path,
                        &markdown,
                        observed_at_millis,
                    )?;
                }
                if !unchanged {
                    history_store::record_external_revision(
                        &self.runtime.store,
                        &identity,
                        &path,
                        &markdown,
                        observed_at_millis,
                        modified_at_millis,
                    )?;
                }
                let mut missing_path = self
                    .state
                    .prepare_safe_note_identity_reattachment(&path, note_id.as_str())?;
                if missing_path.is_none() {
                    missing_path = history_store::missing_note(
                        &self.runtime.store,
                        &NoteIdentity::new(note_id.clone()),
                    )?
                    .filter(|missing| missing.path() == path)
                    .map(|missing| missing.path().to_path_buf());
                }
                if let Some(missing_path) = missing_path {
                    kind = VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached);
                    previous_path = Some(missing_path);
                    history_store::record_observed_lifecycle_event(
                        &self.runtime.store,
                        &NoteIdentity::new(note_id),
                        LifecycleEventKind::Reattached,
                        previous_path.as_deref(),
                        &path,
                        observed_at_millis,
                    )?;
                }
            }
            VaultObservationKind::Lifecycle(
                LifecycleEventKind::Renamed | LifecycleEventKind::Moved,
            ) => {
                if let Some(previous_path) = previous_path.as_deref() {
                    let markdown = canonical_markdown.map(Ok).unwrap_or_else(|| {
                        fs::read_to_string(&path).map_err(|error| {
                            format!("Read observed moved note {}: {error}", path.display())
                        })
                    })?;
                    self.ensure_history_recovered()?;
                    let transferred = self
                        .state
                        .prepare_note_identity_transfer(previous_path, &path)?;
                    let note_id = match transferred {
                        Some(note_id) => note_id,
                        None => self
                            .state
                            .resolve_observed_note_identity(&path, &markdown, None)?,
                    };
                    self.finalize_editor_capture(&NoteIdentity::new(&note_id))?;
                    let lifecycle_kind = match kind {
                        VaultObservationKind::Lifecycle(kind) => kind,
                        _ => unreachable!("matched lifecycle observation"),
                    };
                    history_store::record_observed_lifecycle_event(
                        &self.runtime.store,
                        &NoteIdentity::new(note_id),
                        lifecycle_kind,
                        Some(previous_path),
                        &path,
                        observed_at_millis,
                    )?;
                }
            }
            VaultObservationKind::Lifecycle(
                kind @ (LifecycleEventKind::Forgotten | LifecycleEventKind::Recovered),
            ) => {
                if !path.exists()
                    && previous_path
                        .as_deref()
                        .is_some_and(|previous_path| previous_path.exists())
                {
                    return Ok(ObservationReceipt {
                        source,
                        kind: VaultObservationKind::Lifecycle(kind),
                        path,
                        previous_path,
                        observed_at_millis,
                        modified_at_millis,
                        commit_warning: None,
                    });
                }
                let intended_markdown = canonical_markdown.ok_or_else(|| {
                    "App-owned lifecycle observation is missing intended canonical Markdown"
                        .to_string()
                })?;
                let mut published_markdown = fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "Read app-owned lifecycle publication {}: {error}",
                        path.display()
                    )
                })?;
                let mut authoritative_authored_edit = false;
                if published_markdown != intended_markdown {
                    let intended_note_id = crate::note::parse_note(&intended_markdown)
                        .frontmatter
                        .managed
                        .map(|metadata| metadata.id)
                        .filter(|note_id| !note_id.trim().is_empty());
                    let published_note_id = crate::note::parse_note(&published_markdown)
                        .frontmatter
                        .managed
                        .map(|metadata| metadata.id)
                        .filter(|note_id| !note_id.trim().is_empty());
                    if intended_note_id.is_none() || intended_note_id != published_note_id {
                        return Err(format!(
                            "App-owned lifecycle publication at {} does not match its durable intent",
                            path.display()
                        ).into());
                    }
                    if history_store::authored_content_hash(&published_markdown)
                        == history_store::authored_content_hash(&intended_markdown)
                    {
                        crate::state::atomic_write_note(&path, intended_markdown.as_bytes())
                            .map_err(|error| {
                                format!(
                                    "Repair app-owned lifecycle publication {}: {error}",
                                    path.display()
                                )
                            })?;
                        published_markdown = intended_markdown;
                    } else {
                        authoritative_authored_edit = true;
                    }
                }
                self.ensure_history_recovered()?;
                let note_id = crate::note::parse_note(&published_markdown)
                    .frontmatter
                    .managed
                    .map(|metadata| NoteIdentity::new(metadata.id))
                    .filter(|identity| !identity.as_str().trim().is_empty())
                    .ok_or_else(|| {
                        "App-owned lifecycle publication requires a managed Note Identity"
                            .to_string()
                    })?;
                self.finalize_editor_capture(&note_id)?;
                if kind == LifecycleEventKind::Recovered {
                    if let Some(previous_path) = previous_path.as_deref() {
                        self.state.prepare_missing_note_recovery_identity(
                            &path,
                            previous_path,
                            note_id.as_str(),
                        )?;
                    }
                }
                history_store::record_observed_lifecycle_event(
                    &self.runtime.store,
                    &note_id,
                    kind,
                    previous_path.as_deref(),
                    &path,
                    observed_at_millis,
                )?;
                if authoritative_authored_edit {
                    let authoritative_observed_at_millis = crate::time::current_time_millis()
                        .map_err(|error| {
                            format!(
                                "Issue external lifecycle-recovery observation time for {}: {error}",
                                path.display()
                            )
                        })?;
                    history_store::record_external_revision(
                        &self.runtime.store,
                        &note_id,
                        &path,
                        &published_markdown,
                        authoritative_observed_at_millis,
                        modified_at_millis,
                    )?;
                    merge_note_mutation_warning(
                        &mut lifecycle_projection_warning,
                        MutationWarningStage::HistoryFinalization,
                        "The note lifecycle changed and a newer external edit was preserved",
                        format!(
                            "Authoritative authored content at {} differed from its retained lifecycle publication",
                            path.display()
                        ),
                    );
                }
                lifecycle_projection_warning = match kind {
                    LifecycleEventKind::Forgotten => {
                        let projection_warning = previous_path
                            .as_deref()
                            .and_then(|path| self.synchronize_forgotten_projection(path));
                        merge_optional_note_mutation_warning(
                            lifecycle_projection_warning,
                            projection_warning,
                        )
                    }
                    LifecycleEventKind::Recovered => merge_optional_note_mutation_warning(
                        lifecycle_projection_warning,
                        self.synchronize_recovered_projection(
                            &path,
                            published_markdown.clone(),
                            observed_at_millis,
                        ),
                    ),
                    _ => None,
                };
            }
            _ => {}
        }
        Ok(ObservationReceipt {
            source,
            kind,
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis,
            commit_warning: lifecycle_projection_warning,
        })
    }
}
