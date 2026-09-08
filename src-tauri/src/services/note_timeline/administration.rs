use super::*;

pub(super) fn require_active_vault_root(
    store: &history_store::Store,
    requested_root: &Path,
) -> Result<PathBuf, HistoryError> {
    let active_root = store.vault_root().to_path_buf();
    let active_identity = fs::canonicalize(&active_root).unwrap_or_else(|_| active_root.clone());
    let requested_identity =
        fs::canonicalize(requested_root).unwrap_or_else(|_| requested_root.to_path_buf());
    if requested_identity != active_identity {
        return Err(format!(
            "Note Timeline vault root mismatch: requested {} but active vault is {}",
            requested_root.display(),
            active_root.display()
        )
        .into());
    }
    Ok(active_root)
}

#[cfg(test)]
pub(super) static FAIL_NEXT_PURGE_STAGE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(test)]
pub(super) static FAIL_NEXT_PURGE_PROJECTION_CLEANUP: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub(super) fn stage_note_for_purge(path: &Path, staged_path: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_NEXT_PURGE_STAGE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Err(std::io::Error::other("injected purge staging failure"));
    }
    fs::rename(path, staged_path)
}

impl<'a> NoteTimeline<'a> {
    #[allow(dead_code)] // Consumed by workspace bootstrap.
    pub(crate) fn history_readiness(
        &self,
        note: Option<&NoteIdentity>,
    ) -> Result<HistoryReadiness, HistoryError> {
        self.runtime.readiness(note)
    }

    #[allow(dead_code)] // Blocking target request; UI observes the correlated snapshot.
    pub(crate) fn await_history_readiness(
        &self,
        note: &NoteIdentity,
    ) -> Result<HistoryReadiness, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered()?;
        self.runtime.ensure_note_ready(note)?;
        self.runtime.readiness(Some(note))
    }

    #[cfg(test)]
    pub(crate) fn is_cleanly_closed(&self) -> Result<bool, HistoryError> {
        self.runtime.is_cleanly_closed()
    }

    #[cfg(test)]
    pub(crate) fn wait_for_clean_close_joiner_for_test(&self) {
        self.runtime.wait_for_close_joiner();
    }

    pub(super) fn ensure_history_recovered(&self) -> Result<(), HistoryError> {
        self.runtime.ensure_history_recovered(|| {
            history_store::recover_pending(&self.runtime.store)?;
            self.recover_pending_deletions()?;
            self.finalize_surviving_windows()
        })
    }

    pub(super) fn finalize_surviving_windows(&self) -> Result<(), HistoryError> {
        // Storage verifies anchor lineage, endpoint hash, receipt and generation.
        // The durable endpoint is authoritative even when its former path is
        // missing or reused; external observations are applied separately.
        for window in history_store::pending_windows(&self.runtime.store)? {
            self.finalize_editor_capture(&NoteIdentity::new(&window.note_id))?;
        }
        Ok(())
    }

    #[cfg(feature = "e2e-wdio")]
    pub(crate) fn advance_window_clock_for_e2e(&self, millis: u64) {
        self.runtime.advance_window_clock_for_e2e(millis);
    }

    pub(crate) fn finalize_editing_window(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<(), HistoryError> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _mutation = self.begin_current_content_mutation()?;
            self.with_settled_history_mutation(|| {
                if recovered_note_ineligibility(&self.runtime.store, note_id)?.is_some() {
                    return Err(HistoryError::Ineligible(
                        "Note is ineligible for Editing Window finalization".into(),
                    ));
                }
                self.finalize_editor_capture(note_id).map(|_| ())
            })
        })
        .map_err(history_failure)
    }

    pub(crate) fn clean_close(&self, vault_root: &Path) -> Result<(), HistoryError> {
        let vault_root = require_active_vault_root(&self.runtime.store, vault_root)?;
        self.runtime.close_operations(|| {
            crate::state::with_note_file_mutation(|| {
                self.runtime.with_observation_replay(|| {
                    self.recover_pending_deletions()?;
                    self.replay_retained_observations(None)?;
                    self.ensure_history_recovered()?;
                    crate::state::read_vault_manifest_for(&vault_root)?
                        .ok_or_else(|| "Clean close requires a vault manifest".to_string())?;
                    self.finalize_surviving_windows()?;
                    history_store::clean_close(&self.runtime.store)
                })
            })
        })
    }

    pub(super) fn with_settled_history_mutation<T>(
        &self,
        operation: impl FnOnce() -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            self.replay_retained_observations(None)?;
            self.ensure_history_recovered()?;
            operation()
        })
    }

    /// A logical deletion owns disposal of its pending endpoints. Startup still
    /// attests and recovers exact publications, and settles every other note.
    pub(super) fn with_settled_history_deletion<T>(
        &self,
        discarded_notes: &HashSet<NoteIdentity>,
        operation: impl FnOnce() -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        self.runtime.with_observation_replay(|| {
            let startup = self.runtime.history_needs_recovery()?;
            let result = (|| {
                self.recover_pending_deletions()?;
                self.runtime.ensure_history_recovered(|| {
                    history_store::recover_pending(&self.runtime.store)?;
                    self.recover_pending_deletions()?;
                    for window in history_store::pending_windows(&self.runtime.store)? {
                        let note = NoteIdentity::new(&window.note_id);
                        if !discarded_notes.contains(&note) {
                            self.finalize_editor_capture(&note)?;
                        }
                    }
                    Ok(())
                })?;
                let deferred = history_store::discarded_observation_sequences(
                    &self.runtime.store,
                    discarded_notes,
                )?;
                self.replay_retained_observations_except(None, &deferred)?;
                operation()
            })();
            if result.is_err() && startup {
                // No clock origin was invented for the deferred endpoint. A
                // failed deletion must make that startup work retryable again.
                self.runtime.retry_startup_after_failed_deletion()?;
            }
            result
        })
    }

    pub(super) fn begin_current_content_mutation(
        &self,
    ) -> Result<CurrentContentMutationGuard, HistoryError> {
        let mutation = self.runtime.begin_current_content_mutation()?;
        crate::commands::search_commands::invalidate_result_caches();
        Ok(mutation)
    }

    pub(super) fn recover_pending_deletions(&self) -> Result<(), HistoryError> {
        for pending in history_store::pending_deletions_for_recovery(&self.runtime.store)? {
            self.runtime.store.require_path(&pending.path)?;
            self.runtime.store.require_path(&pending.staged_path)?;
            if !pending.finalized && !pending.staged_path.exists() && pending.path.exists() {
                history_store::abandon_note_purge(&self.runtime.store, &pending.operation_id)?;
                continue;
            }
            self.remove_purged_note_projections(&pending.note_id, &pending.path)?;
            if !pending.finalized {
                let _replacement = self.runtime.replace_note_history(&pending.note_id)?;
                history_store::finalize_note_purge(&self.runtime.store, &pending.operation_id)?;
            }
            history_store::complete_note_purge(&self.runtime.store, &pending.operation_id)?;
        }
        Ok(())
    }

    pub(super) fn purge_note_under_mutation_boundary(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
        occurred_at_millis: u64,
    ) -> Result<(), HistoryError> {
        let manifest =
            crate::state::read_vault_manifest_for(&self.runtime.store.vault_root().to_path_buf())?
                .ok_or_else(|| "History purge requires a vault manifest".to_string())?;
        let marker = DeletionMarker::issue(
            DeletionScope::Note(note_id.clone()),
            HistoryDeletionKind::Purge,
            occurred_at_millis,
            manifest.history_generation,
        );
        let _replacement = self.runtime.replace_note_history(note_id)?;
        let staged_path =
            history_store::prepare_note_purge(&self.runtime.store, note_id, path, &marker)?;
        let expected_removal = crate::vault_watcher::record_expected_removal(path);
        match stage_note_for_purge(path, &staged_path) {
            Ok(()) => expected_removal.commit(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !path.exists() => {}
            Err(error) => {
                return match history_store::abandon_note_purge(&self.runtime.store, marker.operation_id()) {
                    Ok(()) => Err(format!(
                        "Stage canonical note before purging its timeline {}: {error}",
                        path.display()
                    ).into()),
                    Err(abandon_error) => Err(format!(
                        "Stage canonical note before purging its timeline {}: {error}; abandon prepared purge: {abandon_error}",
                        path.display()
                    ).into()),
                };
            }
        }
        self.remove_purged_note_projections(note_id, path)?;
        history_store::finalize_note_purge(&self.runtime.store, marker.operation_id())?;
        history_store::complete_note_purge(&self.runtime.store, marker.operation_id())
    }

    pub(super) fn purge_missing_note_under_mutation_boundary(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
        occurred_at_millis: u64,
    ) -> Result<(), HistoryError> {
        let manifest =
            crate::state::read_vault_manifest_for(&self.runtime.store.vault_root().to_path_buf())?
                .ok_or_else(|| "History purge requires a vault manifest".to_string())?;
        let marker = DeletionMarker::issue(
            DeletionScope::Note(note_id.clone()),
            HistoryDeletionKind::Purge,
            occurred_at_millis,
            manifest.history_generation,
        );
        let _replacement = self.runtime.replace_note_history(note_id)?;
        history_store::prepare_note_purge(&self.runtime.store, note_id, path, &marker)?;
        self.remove_purged_note_projections(note_id, path)?;
        history_store::finalize_note_purge(&self.runtime.store, marker.operation_id())?;
        history_store::complete_note_purge(&self.runtime.store, marker.operation_id())
    }

    pub(super) fn remove_purged_note_projections(
        &self,
        note_id: &NoteIdentity,
        path: &Path,
    ) -> Result<(), HistoryError> {
        #[cfg(test)]
        if FAIL_NEXT_PURGE_PROJECTION_CLEANUP.swap(false, std::sync::atomic::Ordering::SeqCst) {
            return Err("injected purge projection cleanup interruption"
                .to_string()
                .into());
        }
        let indexed_identity = self.state.indexed_note_identity(path)?;
        if indexed_identity
            .as_deref()
            .is_none_or(|indexed_note_id| indexed_note_id == note_id.as_str())
        {
            self.state.remove_note_indexes(path)?;
        }
        self.state
            .semantic
            .purge_note_projection(path, note_id.as_str())?;
        Ok(())
    }

    pub(crate) fn initialize_existing_notes(
        &self,
        vault_root: &Path,
    ) -> Result<BaselineInitializationProgress, HistoryError> {
        self.initialize_existing_notes_with_candidates(
            vault_root,
            Vec::new(),
            BaselineInitializationHistory::SettleExistingStore,
        )
    }

    pub(super) fn initialize_existing_notes_with_candidates(
        &self,
        vault_root: &Path,
        additional_candidates: Vec<ExistingBaselineCandidate>,
        history: BaselineInitializationHistory,
    ) -> Result<BaselineInitializationProgress, HistoryError> {
        let setup_operation = self.runtime.begin_operation()?;
        let vault_root = require_active_vault_root(&self.runtime.store, vault_root)?;
        if history == BaselineInitializationHistory::SettleExistingStore {
            self.recover_retained_observations()?;
            self.ensure_history_recovered()?;
        }
        let mut progress = BaselineInitializationProgress {
            phase: BaselineInitializationPhase::Initializing,
            discovered_notes: 0,
            baseline_revisions: 0,
            ready_notes: 0,
            failed_notes: 0,
            last_error: None,
        };
        history_store::store_baseline_initialization_progress(&self.runtime.store, &progress)?;
        let mut candidates = collect_markdown_files_recursively(&vault_root)?
            .into_iter()
            .map(|path| ExistingBaselineCandidate::Active { path })
            .collect::<Vec<_>>();
        candidates.extend(
            crate::state::read_state(&vault_root)?
                .forgotten_notes
                .into_iter()
                .filter(|forgotten| forgotten.kind == crate::state::ForgottenItemKind::Note)
                .map(|forgotten| ExistingBaselineCandidate::Forgotten {
                    path: PathBuf::from(forgotten.forgotten_path),
                    note_id: forgotten.note_id.map(NoteIdentity::new),
                    original_path: PathBuf::from(forgotten.original_path),
                    forgotten_at_millis: forgotten.forgotten_at_millis,
                }),
        );
        candidates.extend(additional_candidates);
        candidates.sort_by(|left, right| left.path().cmp(right.path()));
        drop(setup_operation);
        for candidate in candidates {
            let candidate_operation = self.runtime.begin_operation()?;
            let path = candidate.path().to_path_buf();
            let markdown = match candidate
                .canonical_markdown()
                .map(str::to_owned)
                .map(Ok)
                .unwrap_or_else(|| fs::read_to_string(&path).map_err(|error| error.to_string()))
            {
                Ok(markdown) => markdown,
                Err(error) => {
                    progress.failed_notes += 1;
                    progress.last_error = Some(format!(
                        "Read existing note {} for baseline: {error}",
                        path.display()
                    ));
                    history_store::store_baseline_initialization_progress(
                        &self.runtime.store,
                        &progress,
                    )?;
                    continue;
                }
            };
            let parsed = crate::note::parse_note(&markdown);
            let metadata = parsed.frontmatter.managed.as_ref();
            if metadata.is_some_and(|metadata| metadata.kind.is_chat_projection()) {
                continue;
            }
            let retained_note_id = candidate.retained_note_id();
            if metadata.is_none() && retained_note_id.is_none() {
                continue;
            }
            progress.discovered_notes += 1;
            let embedded_note_id = metadata.and_then(|metadata| {
                (!metadata.id.trim().is_empty()).then(|| NoteIdentity::new(metadata.id.clone()))
            });
            let mut resolved_note_id = None;
            let initialized = (|| {
                if retained_note_id.is_some()
                    && embedded_note_id.is_some()
                    && retained_note_id != embedded_note_id
                {
                    return Err(
                        "Inactive note state identity does not match its canonical Markdown"
                            .to_string(),
                    );
                }
                let persisted_path_identity =
                    history_store::note_identity_for_current_path(&self.runtime.store, &path)?;
                let note_id = match persisted_path_identity.or(retained_note_id.clone()) {
                    Some(note_id) => note_id,
                    None => {
                        let historical_owner = embedded_note_id
                            .as_ref()
                            .map(|value| history_store::current_path(&self.runtime.store, value))
                            .transpose()?
                            .flatten();
                        NoteIdentity::new(self.state.resolve_observed_note_identity(
                            &path,
                            &markdown,
                            historical_owner.as_deref(),
                        )?)
                    }
                };
                resolved_note_id = Some(note_id.clone());
                if history == BaselineInitializationHistory::RebuildReplacementStore {
                    history_store::verify_note(
                        &self.runtime.store,
                        &note_id,
                        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                    )?;
                } else {
                    self.runtime.ensure_note_ready(&note_id)?;
                }
                let known_since_millis = crate::time::current_time_millis().map_err(|error| {
                    format!("Issue Baseline Revision known-since time: {error}")
                })?;
                // Verification can join background work; release the read lease
                // before waiting for the file owner, which close also owns.
                drop(candidate_operation);
                let apply = || -> Result<bool, HistoryError> {
                    let _operation = self.runtime.begin_operation()?;
                    let _mutation = self.begin_current_content_mutation()?;
                    let current_markdown = candidate
                        .canonical_markdown()
                        .map(str::to_owned)
                        .map(Ok)
                        .unwrap_or_else(|| fs::read_to_string(&path).map_err(HistoryError::from))?;
                    if current_markdown != markdown {
                        return Err(HistoryError::Unavailable(
                            "Canonical note changed during baseline initialization; retry".into(),
                        ));
                    }
                    let baseline_inserted = history_store::record_baseline_revision_if_absent(
                        &self.runtime.store,
                        &note_id,
                        &path,
                        &markdown,
                        known_since_millis,
                    )?;
                    if candidate.is_inactive()
                        && (baseline_inserted
                            || history_store::lifecycle_events(&self.runtime.store, &note_id)?
                                .is_empty())
                    {
                        candidate.record_inactive_lifecycle(&self.runtime.store, &note_id)?;
                    }
                    history_store::clear_baseline_initialization_failure(
                        &self.runtime.store,
                        &note_id,
                    )?;
                    let ready = matches!(
                        history_store::note_baseline_initialization_state(
                            &self.runtime.store,
                            &note_id
                        )?,
                        NoteBaselineInitializationState::Initialized {
                            known_since_millis: Some(_)
                        }
                    );
                    Ok(ready)
                };
                if history == BaselineInitializationHistory::RebuildReplacementStore {
                    apply().map_err(String::from)
                } else {
                    crate::state::with_note_file_mutation(apply).map_err(String::from)
                }
            })();
            let _progress_operation = self.runtime.begin_operation()?;
            match initialized {
                Ok(true) => {
                    progress.baseline_revisions += 1;
                    progress.ready_notes += 1;
                }
                Ok(false) => progress.ready_notes += 1,
                Err(error) => {
                    progress.failed_notes += 1;
                    progress.last_error = Some(format!(
                        "Initialize existing note {}: {error}",
                        path.display()
                    ));
                    if let Some(note_id) = resolved_note_id.as_ref().or(embedded_note_id.as_ref()) {
                        history_store::record_baseline_initialization_failure(
                            &self.runtime.store,
                            note_id,
                            &path,
                            progress.last_error.as_deref().unwrap_or("Baseline failed"),
                        )?;
                    }
                }
            }
            history_store::store_baseline_initialization_progress(&self.runtime.store, &progress)?;
        }
        let _operation = self.runtime.begin_operation()?;
        progress.phase = if progress.failed_notes == 0 {
            BaselineInitializationPhase::Complete
        } else {
            BaselineInitializationPhase::Degraded
        };
        history_store::store_baseline_initialization_progress(&self.runtime.store, &progress)?;
        Ok(progress)
    }

    #[cfg(test)]
    pub(crate) fn baseline_initialization_progress(
        &self,
    ) -> Result<BaselineInitializationProgress, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        history_store::baseline_initialization_progress(&self.runtime.store)
    }

    #[cfg(test)]
    pub(crate) fn note_baseline_initialization_state(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<NoteBaselineInitializationState, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        history_store::note_baseline_initialization_state(&self.runtime.store, note_id)
    }

    #[cfg(test)]
    pub(crate) fn reset_history(
        &self,
        vault_root: &Path,
    ) -> Result<HistoryResetReceipt, HistoryError> {
        self.reset_history_from(vault_root, ResetHistorySource::RequireReadableStore)
    }

    pub(super) fn reset_history_from(
        &self,
        vault_root: &Path,
        source: ResetHistorySource,
    ) -> Result<HistoryResetReceipt, HistoryError> {
        let vault_root = require_active_vault_root(&self.runtime.store, vault_root)?;
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.runtime.with_observation_replay(|| {
                let preserve_old_store = source == ResetHistorySource::RequireReadableStore
                    || history_store::store_is_queryable_for_reset(&self.runtime.store);
                let recoverable_missing = if preserve_old_store {
                    self.recover_pending_deletions()?;
                    self.replay_retained_observations(None)?;
                    history_store::recover_pending(&self.runtime.store)?;
                    self.recoverable_missing_baseline_candidates()?
                } else {
                    Vec::new()
                };
                self.runtime.begin_history_replacement()?;
                let (previous_generation, generation, operation_id, reset_at_millis) =
                    match history_store::reset_history_store(&self.runtime.store, &vault_root) {
                        Ok(result) => result,
                        Err(error) => {
                            self.runtime.fail_history_replacement()?;
                            return Err(error);
                        }
                    };
                let initialization = match self.initialize_existing_notes_with_candidates(
                    &vault_root,
                    recoverable_missing,
                    BaselineInitializationHistory::RebuildReplacementStore,
                ) {
                    Ok(initialization)
                        if initialization.phase() == BaselineInitializationPhase::Complete =>
                    {
                        initialization
                    }
                    Ok(initialization) => {
                        self.runtime.fail_history_replacement()?;
                        return Err(format!(
                            "History reset replacement did not rebuild completely: {}",
                            initialization
                                .last_error()
                                .unwrap_or("one or more Baseline Revisions failed")
                        )
                        .into());
                    }
                    Err(error) => {
                        self.runtime.fail_history_replacement()?;
                        return Err(format!(
                            "History reset replacement did not rebuild completely: {error}"
                        )
                        .into());
                    }
                };
                if let Err(error) =
                    history_store::complete_history_reset_rebuild(&self.runtime.store)
                {
                    self.runtime.fail_history_replacement()?;
                    return Err(format!(
                        "History reset replacement could not be made available: {error}"
                    )
                    .into());
                }
                self.runtime.complete_history_replacement()?;
                Ok(HistoryResetReceipt {
                    operation_id,
                    previous_generation,
                    generation,
                    reset_at_millis,
                    initialization,
                })
            })
        })
    }

    pub(super) fn recoverable_missing_baseline_candidates(
        &self,
    ) -> Result<Vec<ExistingBaselineCandidate>, HistoryError> {
        // Reset can retain a Missing Note only when its latest authored state
        // still reconstructs and verifies. It must never invent replacement
        // content from an unavailable or corrupt revision.
        let missing_notes = history_store::missing_notes(&self.runtime.store)
            .map_err(|error| format!("Read Missing Notes before history reset: {error}"))?;
        missing_notes
            .into_iter()
            .map(|missing| {
                let retained =
                    history_store::reconstruct_latest(&self.runtime.store, missing.note_id())
                        .map_err(|error| {
                            format!(
                                "Reconstruct Missing Note {} before history reset: {error}",
                                missing.note_id().as_str()
                            )
                        })?;
                let canonical_markdown =
                    canonical_markdown_for_recovered_note(missing.note_id(), &retained).map_err(
                        |error| {
                            format!(
                                "Canonicalize Missing Note {} before history reset: {error}",
                                missing.note_id().as_str()
                            )
                        },
                    )?;
                Ok(ExistingBaselineCandidate::Missing {
                    record: missing,
                    canonical_markdown,
                })
            })
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn latest_history_reset(&self) -> Result<Option<HistoryResetReceipt>, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        let Some((operation_id, previous_generation, generation, reset_at_millis)) =
            history_store::latest_history_reset(&self.runtime.store)?
        else {
            return Ok(None);
        };
        Ok(Some(HistoryResetReceipt {
            operation_id,
            previous_generation,
            generation,
            reset_at_millis,
            initialization: history_store::baseline_initialization_progress(&self.runtime.store)?,
        }))
    }

    pub(crate) fn history_health(&self) -> Result<HistoryHealthReport, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        let health = self.runtime.history_health_snapshot()?;
        let initialization = match &health {
            history_store::HistoryStoreHealth::Available(snapshot) => {
                snapshot.initialization.clone()
            }
            history_store::HistoryStoreHealth::Unavailable
            | history_store::HistoryStoreHealth::Corrupt => BaselineInitializationProgress {
                phase: BaselineInitializationPhase::NotStarted,
                discovered_notes: 0,
                baseline_revisions: 0,
                ready_notes: 0,
                failed_notes: 0,
                last_error: None,
            },
        };
        let last_reset = history_store::latest_history_reset(&self.runtime.store)
            .ok()
            .flatten()
            .map(
                |(operation_id, previous_generation, generation, reset_at_millis)| {
                    HistoryResetReceipt {
                        operation_id,
                        previous_generation,
                        generation,
                        reset_at_millis,
                        initialization: initialization.clone(),
                    }
                },
            );
        let report = match health {
            history_store::HistoryStoreHealth::Available(snapshot) => {
                let state = if snapshot.pending_repairs > 0 {
                    HistoryHealthState::Warning
                } else {
                    match snapshot.initialization.phase {
                        BaselineInitializationPhase::NotStarted
                        | BaselineInitializationPhase::Initializing => {
                            HistoryHealthState::Initializing
                        }
                        BaselineInitializationPhase::Degraded => HistoryHealthState::Degraded,
                        BaselineInitializationPhase::Complete => HistoryHealthState::Healthy,
                    }
                };
                HistoryHealthReport {
                    state,
                    integrity: HistoryIntegrityState::Verified,
                    initialization: snapshot.initialization,
                    storage: Some(snapshot.storage),
                    pending_repairs: snapshot.pending_repairs,
                    can_retry: matches!(
                        state,
                        HistoryHealthState::Warning | HistoryHealthState::Degraded
                    ),
                    can_reset: false,
                    last_reset,
                }
            }
            history_store::HistoryStoreHealth::Unavailable => HistoryHealthReport {
                state: HistoryHealthState::Unavailable,
                integrity: HistoryIntegrityState::Unavailable,
                initialization,
                storage: None,
                pending_repairs: 0,
                can_retry: true,
                can_reset: true,
                last_reset,
            },
            history_store::HistoryStoreHealth::Corrupt => HistoryHealthReport {
                state: HistoryHealthState::Corrupt,
                integrity: HistoryIntegrityState::Corrupt,
                initialization,
                storage: None,
                pending_repairs: 0,
                can_retry: true,
                can_reset: true,
                last_reset,
            },
        };
        Ok(report)
    }

    pub(crate) fn note_history_health(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<NoteHistoryHealth, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        let (state, revision_count, lifecycle_event_count, revision_payload_bytes) =
            match self.runtime.note_history_health_snapshot(note_id)? {
                history_store::NoteHistoryStoreHealth::Available(snapshot) => {
                    let state = match snapshot.initialization {
                        NoteBaselineInitializationState::Uninitialized => {
                            NoteHistoryHealthState::Initializing
                        }
                        NoteBaselineInitializationState::Failed { .. } => {
                            NoteHistoryHealthState::Degraded
                        }
                        NoteBaselineInitializationState::Initialized { .. } => {
                            NoteHistoryHealthState::Healthy
                        }
                    };
                    (
                        state,
                        snapshot.revision_count,
                        snapshot.lifecycle_event_count,
                        snapshot.revision_payload_bytes,
                    )
                }
                history_store::NoteHistoryStoreHealth::Unavailable => {
                    (NoteHistoryHealthState::Unavailable, 0, 0, 0)
                }
                history_store::NoteHistoryStoreHealth::Corrupt => {
                    (NoteHistoryHealthState::Corrupt, 0, 0, 0)
                }
            };
        Ok(NoteHistoryHealth {
            note_id: note_id.as_str().to_string(),
            state,
            revision_count,
            lifecycle_event_count,
            revision_payload_bytes,
        })
    }

    pub(crate) fn retry_history_recovery(
        &self,
        vault_root: &Path,
    ) -> Result<HistoryHealthReport, HistoryError> {
        let vault_root = require_active_vault_root(&self.runtime.store, vault_root)?;
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.runtime.with_observation_replay(|| {
                self.recover_pending_deletions()?;
                self.replay_retained_observations(None)?;
                let recovering_startup = self.runtime.history_needs_recovery()?;
                self.runtime.retry_history_recovery(|| {
                    history_store::recover_pending(&self.runtime.store)?;
                    self.recover_pending_deletions()?;
                    if recovering_startup {
                        self.finalize_surviving_windows()?;
                    }
                    Ok(())
                })
            })
        })
        .map_err(history_failure)?;
        // Diagnostics and background baseline verification do not own canonical
        // mutation serialization across unrelated retained histories.
        if matches!(
            self.history_health()?.state(),
            HistoryHealthState::Initializing | HistoryHealthState::Degraded
        ) {
            self.initialize_existing_notes(&vault_root)?;
        }
        self.history_health()
    }

    pub(crate) fn reset_corrupt_history(
        &self,
        vault_root: &Path,
        confirmed: bool,
    ) -> Result<HistoryResetReceipt, HistoryError> {
        if !confirmed {
            return Err(history_failure(
                "Corrupt history reset requires explicit confirmation",
            ));
        }
        let health = self.history_health().map_err(history_failure)?;
        if !matches!(
            health.state(),
            HistoryHealthState::Corrupt | HistoryHealthState::Unavailable
        ) {
            return Err(HistoryError::Ineligible(
                "History reset is available only when history is corrupt or unavailable"
                    .to_string(),
            ));
        }
        self.reset_history_from(vault_root, ResetHistorySource::PreserveWhenReadable)
            .map_err(history_failure)
    }

    pub(crate) fn clear_note_history(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<HistoryDeletionReceipt, HistoryError> {
        if let Some(cause) =
            recovered_note_ineligibility(&self.runtime.store, note_id).map_err(history_failure)?
        {
            return Err(HistoryError::Ineligible(cause));
        }
        if history_store::current_path(&self.runtime.store, note_id)
            .map_err(history_failure)?
            .is_none()
        {
            return Err(HistoryError::Missing(
                "Cannot clear an unknown Note Timeline".to_string(),
            ));
        }
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            self.with_settled_history_deletion(&HashSet::from([note_id.clone()]), || {
                require_recovered_note(&self.runtime.store, note_id)?;
                let path = history_store::current_path(&self.runtime.store, note_id)?
                    .ok_or_else(|| "Cannot clear an unknown Note Timeline".to_string())?;
                let canonical_markdown = fs::read_to_string(&path).map_err(|error| {
                    format!(
                        "Read current canonical note before clearing history {}: {error}",
                        path.display()
                    )
                })?;
                let occurred_at_millis = crate::time::current_time_millis()
                    .map_err(|error| format!("Issue history clear time: {error}"))?;
                let manifest = crate::state::read_vault_manifest_for(
                    &self.runtime.store.vault_root().to_path_buf(),
                )?
                .ok_or_else(|| "History clear requires a vault manifest".to_string())?;
                let marker = DeletionMarker::issue(
                    DeletionScope::Note(note_id.clone()),
                    HistoryDeletionKind::Clear,
                    occurred_at_millis,
                    manifest.history_generation,
                );
                let _replacement = self.runtime.replace_note_history(note_id)?;
                history_store::clear_note_history(
                    &self.runtime.store,
                    note_id,
                    &path,
                    &canonical_markdown,
                    &marker,
                )?;
                self.runtime.forget_window_clock(note_id);
                Ok(HistoryDeletionReceipt {
                    marker,
                    baseline_note_ids: vec![note_id.clone()],
                })
            })
        })
        .map_err(history_failure)
    }

    pub(crate) fn clear_vault_history(
        &self,
        vault_root: &Path,
    ) -> Result<HistoryDeletionReceipt, HistoryError> {
        let vault_root =
            require_active_vault_root(&self.runtime.store, vault_root).map_err(history_failure)?;
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            let mut discarded_notes = HashSet::new();
            for window in history_store::pending_windows(&self.runtime.store)? {
                let note = NoteIdentity::new(&window.note_id);
                if recovered_note_ineligibility(&self.runtime.store, &note)?.is_none()
                    && history_store::current_path(&self.runtime.store, &note)?
                        .is_some_and(|path| path.is_file() && path.starts_with(&vault_root))
                {
                    discarded_notes.insert(note);
                }
            }
            self.with_settled_history_deletion(&discarded_notes, || {
                let mut seeds = Vec::new();
                let mut seen_note_ids = HashSet::new();
                for path in collect_markdown_files_recursively(&vault_root)? {
                    let canonical_markdown = fs::read_to_string(&path).map_err(|error| {
                        format!(
                            "Read active canonical note before clearing vault history {}: {error}",
                            path.display()
                        )
                    })?;
                    let parsed = crate::note::parse_note(&canonical_markdown);
                    let managed_metadata = parsed.frontmatter.managed;
                    if managed_metadata
                        .as_ref()
                        .is_some_and(|metadata| metadata.kind.is_chat_projection())
                    {
                        continue;
                    }
                    let historical_note_id =
                        history_store::note_identity_for_current_path(&self.runtime.store, &path)?;
                    let embedded_note_id = managed_metadata
                        .as_ref()
                        .map(|metadata| metadata.id.as_str())
                        .filter(|note_id| !note_id.trim().is_empty())
                        .map(NoteIdentity::new);
                    let note_id = match historical_note_id.or(embedded_note_id) {
                        Some(note_id) => note_id,
                        None if managed_metadata.is_none() => continue,
                        None => {
                            return Err(format!(
                            "Active note {} has no stable Note Identity for vault history clear",
                            path.display()
                        )
                            .into());
                        }
                    };
                    if !seen_note_ids.insert(note_id.clone()) {
                        return Err(format!(
                        "Multiple active notes claim Note Identity {} during vault history clear",
                        note_id.as_str()
                    )
                        .into());
                    }
                    seeds.push(HistoryClearBaseline {
                        note_id,
                        path,
                        canonical_markdown,
                    });
                }
                let occurred_at_millis = crate::time::current_time_millis()
                    .map_err(|error| format!("Issue vault history clear time: {error}"))?;
                let manifest = crate::state::read_vault_manifest_for(&vault_root)?
                    .ok_or_else(|| "Vault history clear requires a vault manifest".to_string())?;
                let marker = DeletionMarker::issue(
                    DeletionScope::Vault(manifest.vault_id),
                    HistoryDeletionKind::Clear,
                    occurred_at_millis,
                    manifest.history_generation,
                );
                let _replacements = seeds
                    .iter()
                    .map(|seed| self.runtime.replace_note_history(&seed.note_id))
                    .collect::<Result<Vec<_>, _>>()?;
                history_store::clear_vault_history(&self.runtime.store, &seeds, &marker)?;
                for seed in &seeds {
                    self.runtime.forget_window_clock(&seed.note_id);
                }
                Ok(HistoryDeletionReceipt {
                    marker,
                    baseline_note_ids: seeds.into_iter().map(|seed| seed.note_id).collect(),
                })
            })
        })
        .map_err(history_failure)
    }

    #[cfg(test)]
    pub(crate) fn deletion_markers(&self) -> Result<Vec<DeletionMarker>, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered()?;
        history_store::deletion_markers(&self.runtime.store)
    }

    #[cfg(test)]
    pub(crate) fn history_storage_usage(&self) -> Result<HistoryStorageUsage, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        self.recover_retained_observations()?;
        self.ensure_history_recovered()?;
        history_store::storage_usage(&self.runtime.store)
    }

    pub(crate) fn compact_history_storage(
        &self,
        maximum_reclaim_bytes: u64,
    ) -> Result<HistoryCompactionReceipt, HistoryError> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_mutation(|| {
                let before = history_store::storage_usage(&self.runtime.store)?;
                history_store::compact(&self.runtime.store, maximum_reclaim_bytes)?;
                let after = history_store::storage_usage(&self.runtime.store)?;
                Ok(HistoryCompactionReceipt { before, after })
            })
        })
    }
}
