use super::*;

impl<'a> NoteTimeline<'a> {
    /// Prepare user-authored Markdown for an app-owned publication while
    /// preserving the identity already owned by the logical note. Callers
    /// provide continuity evidence; the timeline keeps the repair policy
    /// and metadata representation private.
    pub(crate) fn prepare_publication(
        &self,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<String, HistoryError> {
        let _operation = self.runtime.begin_operation()?;
        if let Some(path) = continuity_path {
            self.runtime.store.require_path(path)?;
        }
        let catalog_identity = continuity_path
            .map(|path| self.state.indexed_note_identity(path))
            .transpose()?
            .flatten();
        let retained_identity = retained_identity
            .map(NoteIdentity::as_str)
            .filter(|note_id| !note_id.trim().is_empty());
        if let (Some(retained), Some(catalog)) = (retained_identity, catalog_identity.as_deref()) {
            if retained != catalog {
                return Err(format!(
                    "Note identity continuity conflict: retained identity {retained} does not match catalog identity {catalog}."
                ).into());
            }
        }
        let historical_identity = if catalog_identity.is_none() && retained_identity.is_none() {
            continuity_path
                .map(|value| {
                    history_store::note_identity_for_current_path(&self.runtime.store, value)
                })
                .transpose()?
                .flatten()
        } else {
            None
        };
        let authoritative_identity = catalog_identity
            .as_deref()
            .or(retained_identity)
            .or_else(|| historical_identity.as_ref().map(NoteIdentity::as_str));
        let embedded_identity = crate::note::parse_note(markdown)
            .frontmatter
            .managed
            .map(|metadata| metadata.id);

        match authoritative_identity {
            Some(note_id) if embedded_identity.as_deref() != Some(note_id) => Ok(
                crate::note::repair_managed_note_identity(markdown, note_id)?,
            ),
            _ => Ok(markdown.to_string()),
        }
    }

    /// Complete ordinary editor/task save. Target verification may wait, so it
    /// precedes file ownership; canonical identity is resolved again inside it.
    pub(crate) fn save_note(
        &self,
        source: MutationSource,
        title: &str,
        markdown: &str,
        current_path: Option<String>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        let notes_dir = self.runtime.store.vault_root();
        let current_path = crate::state::validate_current_path(current_path, notes_dir)?;
        let source = if current_path.is_none() {
            MutationSource::NoteCreation
        } else {
            source
        };
        if current_path.is_none() && title.trim().is_empty() && markdown.trim().is_empty() {
            return Ok(None);
        }
        // This identity is only a fallback for a draft or an unmanaged source.
        // Never reuse preflight-enriched Markdown: disk properties can change
        // before ownership while the caller's body-only input remains unchanged.
        let mut candidate = NoteIdentity::new(crate::note::generate_unique_id());
        loop {
            self.runtime.with_history_result(|| {
                let _operation = self.runtime.begin_operation()?;
                self.recover_retained_observations()?;
                self.ensure_history_recovered()?;
                let (_, canonical) = crate::state::prepare_note_save(
                    notes_dir,
                    title,
                    markdown,
                    current_path.as_deref(),
                    Some(candidate.as_str()),
                )?;
                let canonical =
                    self.prepare_publication(current_path.as_deref(), None, &canonical)?;
                candidate = NoteIdentity::new(
                    crate::note::parse_note(&canonical)
                        .frontmatter
                        .managed
                        .ok_or("Save requires a managed Note Identity")?
                        .id,
                );
                self.runtime.ensure_note_ready(&candidate)?;
                Ok(())
            })?;
            #[cfg(test)]
            {
                let hook = AFTER_SAVE_PREFLIGHT.lock().unwrap().take();
                if let Some(hook) = hook {
                    hook();
                }
            }
            // Close takes the file owner before draining leases. Never carry a
            // preflight lease while waiting here; readmission belongs inside.
            let outcome = crate::state::with_note_file_mutation(|| {
                let _operation = self.runtime.begin_operation()?;
                self.runtime.with_observation_replay(|| {
                    if history_store::has_pending_replay(&self.runtime.store)? {
                        return Ok(None);
                    }
                    let (target_path, canonical) = crate::state::prepare_note_save(
                        notes_dir,
                        title,
                        markdown,
                        current_path.as_deref(),
                        Some(candidate.as_str()),
                    )?;
                    self.runtime.store.require_path(&target_path)?;
                    let canonical =
                        self.prepare_publication(current_path.as_deref(), None, &canonical)?;
                    let note_id = NoteIdentity::new(
                        crate::note::parse_note(&canonical)
                            .frontmatter
                            .managed
                            .ok_or("Save requires a managed Note Identity")?
                            .id,
                    );
                    if !self.runtime.is_note_ready(&note_id)? {
                        candidate = note_id;
                        return Ok(None);
                    }
                    let _mutation = self.begin_current_content_mutation()?;
                    let (canonical, history_intent) = self
                        .prepare_canonical_revision_publication(
                            source,
                            &target_path,
                            current_path.as_deref(),
                            canonical,
                        )?
                        .into_parts();
                    let moved_from = current_path
                        .as_deref()
                        .filter(|path| *path != target_path && path.exists());
                    let expected_removal =
                        moved_from.map(crate::vault_watcher::record_expected_removal);
                    if let Some(path) = moved_from {
                        if let Err(error) = fs::rename(path, &target_path) {
                            return Err(history_intent
                                .abandon_after_publication_failure(error.to_string())
                                .into());
                        }
                    }
                    #[cfg(test)]
                    {
                        let hook = AFTER_SAVE_RENAME.lock().unwrap().take();
                        if let Some(hook) = hook {
                            hook();
                        }
                    }
                    let expected_write =
                        crate::vault_watcher::record_expected_write(&target_path, &canonical);
                    if let Err(error) =
                        crate::state::atomic_write_note(&target_path, canonical.as_bytes())
                    {
                        if let Some(path) = moved_from {
                            if let Err(rollback) = fs::rename(&target_path, path) {
                                // The requested bytes did not commit. Preserve the dirty
                                // draft and recovery intent instead of reporting old bytes
                                // at the moved path as a successful save.
                                let release = self.runtime.with_history_result(|| {
                                    history_store::release_publication_receipt(
                                        &self.runtime.store,
                                        &history_intent,
                                    )
                                });
                                let recovery = self.runtime.require_released_capture_recovery();
                                let recovery_error = release
                                    .and(recovery)
                                    .err()
                                    .map(|failure| {
                                        format!("; failed to release save for recovery: {failure}")
                                    })
                                    .unwrap_or_default();
                                let message = format!(
                                    "{error}; failed to restore {} from {}: {rollback}; history intent retained for recovery{recovery_error}",
                                    path.display(),
                                    target_path.display(),
                                );
                                return Err(message.into());
                            }
                        }
                        return Err(history_intent
                            .abandon_after_publication_failure(error)
                            .into());
                    }
                    if let Some(expected) = expected_removal {
                        expected.commit();
                    }
                    expected_write.commit();
                    Ok(Some(self.mutate(NoteMutation {
                        source,
                        history_intent,
                        path: target_path,
                        previous_path: current_path.clone(),
                        fallback_markdown: canonical,
                    })))
                })
            })?;
            if outcome.is_some() {
                return Ok(outcome);
            }
        }
    }

    /// Durably prepare one app-owned authored-state mutation before its
    /// canonical Markdown is published. The returned bytes include the
    /// timeline-owned identity and are the only bytes the caller may publish.
    pub(crate) fn prepare_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<PreparedRevisionPublication, HistoryError> {
        self.runtime.with_history_result(|| {
            let operation = self.runtime.begin_operation()?;
            self.runtime.store.require_path(target_path)?;
            let current_content_mutation = self.begin_current_content_mutation()?;
            self.recover_retained_observations()?;
            self.ensure_history_recovered()?;
            let identity_prepared =
                self.prepare_publication(continuity_path, retained_identity, markdown)?;
            let existing_markdown = target_path
                .is_file()
                .then(|| fs::read_to_string(target_path))
                .transpose()
                .map_err(|error| error.to_string())?;
            let canonical = crate::note::prepare_note_markdown(
                &identity_prepared,
                existing_markdown.as_deref(),
                Some(None),
            )?
            .0;
            self.prepare_canonical_revision_publication(
                source,
                target_path,
                continuity_path,
                canonical,
            )
            .map(|prepared| prepared.with_runtime_leases(operation, current_content_mutation))
        })
    }

    pub(super) fn prepare_exact_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<PreparedRevisionPublication, HistoryError> {
        self.runtime.with_history_result(|| {
            let operation = self.runtime.begin_operation()?;
            self.runtime.store.require_path(target_path)?;
            let current_content_mutation = self.begin_current_content_mutation()?;
            self.recover_retained_observations()?;
            self.ensure_history_recovered()?;
            let canonical =
                self.prepare_publication(continuity_path, retained_identity, markdown)?;
            self.prepare_canonical_revision_publication(
                source,
                target_path,
                continuity_path,
                canonical,
            )
            .map(|prepared| prepared.with_runtime_leases(operation, current_content_mutation))
        })
    }

    pub(super) fn prepare_canonical_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        canonical: String,
    ) -> Result<PreparedRevisionPublication, HistoryError> {
        let baseline_markdown = continuity_path
            .filter(|path| path.is_file())
            .map(fs::read_to_string)
            .transpose()
            .map_err(|error| format!("Read canonical state before Baseline Revision: {error}"))?;
        let baseline_known_since = baseline_markdown
            .as_ref()
            .map(|_| crate::time::current_time_millis())
            .transpose()
            .map_err(|error| format!("Issue Baseline Revision known-since time: {error}"))?;
        let history_intent = self.prepare_history_capture(
            source,
            target_path,
            &canonical,
            if continuity_path.is_none() {
                history_store::PublicationIntentKind::Create
            } else {
                history_store::PublicationIntentKind::Update
            },
            baseline_markdown
                .as_deref()
                .map(|canonical_markdown| history_store::BaselineSeed {
                    path: continuity_path.expect("baseline requires continuity path"),
                    canonical_markdown,
                    known_since_millis: baseline_known_since
                        .expect("baseline Markdown requires known-since time"),
                }),
        )?;
        #[cfg(feature = "e2e-wdio")]
        crate::e2e_process_fault::hit("publication-prepared");
        Ok(PreparedRevisionPublication {
            canonical_markdown: canonical,
            history_intent,
        })
    }

    pub(crate) fn mutate(&self, mutation: NoteMutation) -> NoteMutationResult {
        let NoteMutation {
            source,
            history_intent,
            path,
            previous_path,
            fallback_markdown,
        } = mutation;
        #[cfg(feature = "e2e-wdio")]
        crate::e2e_process_fault::hit("canonical-published");
        let canonical_read = fs::read_to_string(&path);
        let history_error = match canonical_read.as_deref() {
            Ok(canonical) => self
                .runtime
                .with_history_result(|| {
                    history_store::finalize_publication(
                        &self.runtime.store,
                        &history_intent,
                        source,
                        &path,
                        canonical,
                    )
                })
                .err(),
            Err(error) => Some(
                format!("Read authoritative Markdown before history finalization: {error}").into(),
            ),
        };
        #[cfg(feature = "e2e-wdio")]
        if history_error.is_none() {
            crate::e2e_process_fault::hit("publication-captured");
        }
        // Canonical publication has completed, including uncertain capture. The
        // durable unresolved record remains protected, but is now safe to retry.
        let release_error = self
            .runtime
            .with_history_result(|| {
                history_store::release_publication_receipt(&self.runtime.store, &history_intent)
            })
            .err();
        let recovery_error = if history_error.is_some() {
            self.runtime.require_released_capture_recovery().err()
        } else {
            None
        };
        let mut outcome = post_publication::synchronize_canonical_file(
            self.state,
            path,
            previous_path,
            fallback_markdown,
        );
        if let Some(error) = history_error {
            outcome.record_issue(MutationWarningStage::HistoryFinalization, error.to_string());
        }
        if let Some(error) = release_error {
            outcome.record_issue(MutationWarningStage::HistoryFinalization, error.to_string());
        }
        if let Some(error) = recovery_error {
            outcome.record_issue(MutationWarningStage::HistoryFinalization, error.to_string());
        }
        NoteMutationResult::from_publication(source, outcome)
    }
}
