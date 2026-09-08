use super::*;

impl<'a> NoteTimeline<'a> {
    #[cfg(test)]
    pub(crate) fn lifecycle(
        &self,
        operation: NoteLifecycleOperation,
    ) -> Result<LifecycleReceipt, HistoryError> {
        self.lifecycle_with_forgotten_selection(operation, None)
    }

    pub(crate) fn purge_selected_forgotten_note(
        &self,
        expected: &crate::state::PersistedForgottenNote,
        occurred_at_millis: u64,
    ) -> Result<(), HistoryError> {
        let path = PathBuf::from(&expected.forgotten_path);
        self.runtime.store.require_path(&path)?;
        if let Some(note_id) = forgotten::forgotten_note_identity(expected, &path) {
            self.lifecycle_with_forgotten_selection(
                NoteLifecycleOperation::purged(note_id, path, occurred_at_millis),
                Some(expected),
            )
            .map(|_| ())
        } else {
            crate::state::with_note_file_mutation(|| {
                let _operation = self.runtime.begin_operation()?;
                if !self
                    .state
                    .app_state_storage()
                    .forgotten_note_matches(expected)?
                {
                    return Err(HistoryError::Stale(
                        "The forgotten item changed before deletion".into(),
                    ));
                }
                if path.exists() {
                    fs::remove_file(&path).map_err(|error| error.to_string())?;
                }
                self.state
                    .app_state_storage()
                    .remove_forgotten_note(expected)?;
                Ok(())
            })
        }
    }

    pub(super) fn lifecycle_with_forgotten_selection(
        &self,
        operation: NoteLifecycleOperation,
        expected: Option<&crate::state::PersistedForgottenNote>,
    ) -> Result<LifecycleReceipt, HistoryError> {
        self.runtime.store.require_path(&operation.path)?;
        if let Some(path) = &operation.previous_path {
            self.runtime.store.require_path(path)?;
        }
        let NoteLifecycleOperation {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        } = operation;
        if kind != LifecycleEventKind::Purged {
            return Err(
                "Forgotten and Recovered transitions require lifecycle publication"
                    .to_string()
                    .into(),
            );
        }
        crate::state::with_note_file_mutation(|| {
            let _timeline_operation = self.runtime.begin_operation()?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
            self.with_settled_history_deletion(&HashSet::from([note_id.clone()]), || {
                // A queued forgotten-item purge must not erase a note restored
                // since selection. Check after recovery under the same file owner
                // that performs deletion; a missing source at its retained path
                // remains a legitimate purge target.
                if history_store::current_path(&self.runtime.store, &note_id)?
                    .is_some_and(|current| current != path)
                {
                    return Err(HistoryError::Stale(
                        "The note moved or was recovered before deletion".to_string(),
                    ));
                }
                // A restore followed by forgetting again can reuse the same path.
                // The selected metadata must still describe this lifecycle instance.
                if let Some(expected) = expected {
                    if !self
                        .state
                        .app_state_storage()
                        .forgotten_note_matches(expected)?
                    {
                        return Err(HistoryError::Stale(
                            "The forgotten item changed before deletion".to_string(),
                        ));
                    }
                }
                self.purge_note_under_mutation_boundary(&note_id, &path, occurred_at_millis)?;
                if let Some(expected) = expected {
                    self.state
                        .app_state_storage()
                        .remove_forgotten_note(expected)?;
                }
                Ok(())
            })
        })?;
        Ok(LifecycleReceipt {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        })
    }

    pub(super) fn publish_lifecycle_under_mutation_boundary(
        &self,
        operation: NoteLifecycleOperation,
        canonical_markdown: &str,
        publish: impl FnOnce() -> Result<(), LifecyclePublicationFailure>,
    ) -> Result<LifecyclePublicationResult, HistoryError> {
        self.runtime.store.require_path(&operation.path)?;
        if let Some(path) = &operation.previous_path {
            self.runtime.store.require_path(path)?;
        }
        if !matches!(
            operation.kind,
            LifecycleEventKind::Forgotten | LifecycleEventKind::Recovered
        ) {
            return Err(
                "Only Forgotten or Recovered lifecycle publications can be prepared"
                    .to_string()
                    .into(),
            );
        }
        let embedded_note_id = crate::note::parse_note(canonical_markdown)
            .frontmatter
            .managed
            .map(|metadata| metadata.id)
            .filter(|note_id| !note_id.trim().is_empty())
            .ok_or_else(|| {
                "Lifecycle publication preparation requires a managed Note Identity".to_string()
            })?;
        if embedded_note_id != operation.note_id.as_str() {
            return Err(
                "Lifecycle publication identity does not match its Note Timeline"
                    .to_string()
                    .into(),
            );
        }

        self.finalize_editor_capture(&operation.note_id)?;
        let observation = VaultObservation::lifecycle(
            VaultObservationSource::Reconciliation,
            operation.kind,
            operation.path.clone(),
            operation.previous_path.clone(),
            operation.occurred_at_millis,
        )
        .with_canonical_markdown(canonical_markdown.to_string());
        let sequence = history_store::retain_observation(&self.runtime.store, &observation)?;
        let (commit_warning, publication_indeterminate) = match publish() {
            Ok(()) => {
                let warning = match self.replay_retained_observations(Some(sequence)) {
                    Ok(Some(receipt)) => receipt.commit_warning().cloned(),
                    Ok(None) => Some(NoteMutationWarning::single(
                        MutationWarningStage::HistoryFinalization,
                        "The note lifecycle changed, but its Note Timeline record is awaiting recovery"
                            .to_string(),
                        format!("Retained lifecycle observation {sequence} was not replayed"),
                    )),
                    Err(error) => Some(NoteMutationWarning::single(
                        MutationWarningStage::HistoryFinalization,
                        "The note lifecycle changed, but its Note Timeline record is awaiting recovery"
                            .to_string(),
                        error.to_string(),
                    )),
                };
                (warning, false)
            }
            Err(LifecyclePublicationFailure::NotPublished(error)) => {
                return Err(match history_store::acknowledge_observation(&self.runtime.store, sequence) {
                    Ok(()) => error.into(),
                    Err(abandon_error) => format!(
                        "{error}; additionally failed to abandon its lifecycle intent: {abandon_error}"
                    ).into(),
                });
            }
            Err(LifecyclePublicationFailure::Indeterminate(error)) => (
                Some(NoteMutationWarning::single(
                    MutationWarningStage::HistoryFinalization,
                    "The note lifecycle publication is awaiting recovery".to_string(),
                    error,
                )),
                true,
            ),
        };
        if publication_indeterminate {
            let _ = self
                .state
                .mark_notes_index_dirty(&operation.path, "lifecycle-publication-retry");
            if let Some(previous_path) = operation.previous_path.as_deref() {
                let _ = self
                    .state
                    .mark_notes_index_dirty(previous_path, "lifecycle-publication-retry");
            }
        }
        Ok(LifecyclePublicationResult {
            receipt: LifecycleReceipt {
                kind: operation.kind,
                note_id: operation.note_id,
                path: operation.path,
                previous_path: operation.previous_path,
                occurred_at_millis: operation.occurred_at_millis,
            },
            commit_warning,
        })
    }

    pub(crate) fn recover_lifecycle_publications(&self) -> Result<(), HistoryError> {
        let _timeline_operation = self.runtime.begin_operation()?;
        self.runtime.with_observation_replay(|| {
            self.recover_pending_deletions()?;
            self.replay_retained_observations(None).map(|_| ())
        })
    }

    pub(super) fn synchronize_forgotten_projection(
        &self,
        path: &Path,
    ) -> Option<NoteMutationWarning> {
        self.synchronize_inactive_projection(path, LifecycleEventKind::Forgotten)
    }

    pub(super) fn synchronize_missing_projection(
        &self,
        path: &Path,
    ) -> Option<NoteMutationWarning> {
        self.synchronize_inactive_projection(path, LifecycleEventKind::Missing)
    }

    pub(super) fn synchronize_inactive_projection(
        &self,
        path: &Path,
        kind: LifecycleEventKind,
    ) -> Option<NoteMutationWarning> {
        let (lifecycle_label, retry_label) = match kind {
            LifecycleEventKind::Forgotten => ("forgotten", "forgotten-note"),
            LifecycleEventKind::Missing => ("missing", "missing-note"),
            _ => unreachable!("only inactive lifecycle events remove current projections"),
        };
        let mut warning = None;
        let warning_message =
            format!("The note was {lifecycle_label} with incomplete search synchronization");
        if let Err(error) = self.state.semantic.queue_delete_note(path) {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::SemanticUpdate,
                &warning_message,
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, &format!("{retry_label}-semantic-retry"));
        }
        if let Err(error) = self.state.remove_note_indexes(path) {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::CatalogRemove,
                &warning_message,
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, &format!("{retry_label}-catalog-retry"));
        }
        warning
    }

    pub(crate) fn missing_notes(&self) -> Result<Vec<MissingNoteRecord>, HistoryError> {
        self.runtime.with_history_result(|| {
            let _operation = self.runtime.begin_operation().map_err(history_failure)?;
            self.recover_retained_observations()
                .map_err(history_failure)?;
            self.ensure_history_recovered().map_err(history_failure)?;
            history_store::missing_notes(&self.runtime.store).map_err(history_failure)
        })
    }

    pub(crate) fn missing_note_history_page(
        &self,
        note_id: NoteIdentity,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<HistoryModePage, HistoryError> {
        self.runtime.with_history_result(|| {
            let _operation = self.runtime.begin_operation().map_err(history_failure)?;
            self.recover_retained_observations()
                .map_err(history_failure)?;
            self.ensure_history_recovered().map_err(history_failure)?;
            self.runtime.ensure_note_ready(&note_id)?;
            if history_store::missing_note(&self.runtime.store, &note_id)
                .map_err(history_failure)?
                .is_none()
            {
                return Err(if cursor.is_some() {
                    HistoryError::Stale(MISSING_HISTORY_CURSOR_ERROR.to_string())
                } else {
                    HistoryError::Missing(
                        "Missing Note is no longer available for recovery".to_string(),
                    )
                });
            }
            retained_history_page(
                &self.runtime.store,
                &note_id,
                cursor,
                limit,
                MISSING_HISTORY_CURSOR_ERROR,
            )
        })
    }

    pub(crate) fn recover_missing_note(
        &self,
        note_id: NoteIdentity,
    ) -> Result<LifecyclePublicationResult, HistoryError> {
        let result = crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_mutation(|| {
                let recovered_at_millis = crate::time::current_time_millis()?;
                let missing = history_store::missing_note(&self.runtime.store, &note_id)?.ok_or_else(|| {
                    "Missing Note is no longer available for recovery".to_string()
                })?;
                self.runtime.store.require_path(missing.path())?;
                if missing.purge_at_millis() <= recovered_at_millis {
                    self.purge_missing_note_under_mutation_boundary(
                        &note_id,
                        missing.path(),
                        recovered_at_millis,
                    )?;
                    return Err(
                        "Missing Note recovery deadline expired; its timeline was permanently purged"
                            .to_string().into(),
                    );
                }
                self.runtime.ensure_note_ready(&note_id)?;
                let retained = history_store::reconstruct_latest(&self.runtime.store, &note_id)?;
                let canonical = canonical_markdown_for_recovered_note(&note_id, &retained)?;
                let preferred_path = missing.path().to_path_buf();
                let target_path = if preferred_path.exists() {
                    unique_path_in_dir(
                        preferred_path.parent().unwrap_or_else(|| Path::new(".")),
                        preferred_path.file_name().unwrap_or_default(),
                        "Recovered Note",
                    )
                } else {
                    preferred_path.clone()
                };
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!(
                            "Create Missing Note recovery directory {}: {error}",
                            parent.display()
                        )
                    })?;
                }
                self.publish_lifecycle_under_mutation_boundary(
                    NoteLifecycleOperation::recovered(
                        note_id.clone(),
                        preferred_path,
                        target_path.clone(),
                        recovered_at_millis,
                    ),
                    &canonical,
                    || {
                        let expected = crate::vault_watcher::record_expected_write(
                            &target_path,
                            &canonical,
                        );
                        crate::state::atomic_create_note(&target_path, canonical.as_bytes())
                            .map_err(LifecyclePublicationFailure::not_published)?;
                        expected.commit();
                        Ok(())
                    },
                )
            })
        });
        result.map_err(|cause| {
            if matches!(
                history_store::missing_note(&self.runtime.store, &note_id),
                Ok(None)
            ) {
                HistoryError::Missing(cause.to_string())
            } else {
                history_failure(cause)
            }
        })
    }

    pub(crate) fn purge_expired_missing_notes(&self, now_millis: u64) -> Result<(), HistoryError> {
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let discarded: HashSet<_> = history_store::missing_notes(&self.runtime.store)?
                .into_iter()
                .filter(|missing| missing.purge_at_millis() <= now_millis)
                .map(|missing| missing.note_id().clone())
                .collect();
            self.with_settled_history_deletion(&discarded, || {
                for missing in history_store::missing_notes(&self.runtime.store)?
                    .into_iter()
                    .filter(|missing| missing.purge_at_millis() <= now_millis)
                {
                    self.purge_missing_note_under_mutation_boundary(
                        missing.note_id(),
                        missing.path(),
                        now_millis,
                    )?;
                }
                Ok(())
            })
        })
    }

    pub(crate) fn purge_missing_notes(
        &self,
        note_ids: &[NoteIdentity],
        occurred_at_millis: u64,
    ) -> Result<(), HistoryError> {
        let selected = note_ids
            .iter()
            .map(|note_id| note_id.as_str())
            .collect::<HashSet<_>>();
        let missing = history_store::missing_notes(&self.runtime.store).map_err(history_failure)?;
        for note_id in note_ids {
            if !missing.iter().any(|missing| missing.note_id() == note_id) {
                return Err(HistoryError::Missing(format!(
                    "Missing Note {} is no longer available for deletion",
                    note_id.as_str()
                )));
            }
        }
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            self.with_settled_history_deletion(&note_ids.iter().cloned().collect(), || {
                for missing in missing
                    .into_iter()
                    .filter(|missing| selected.contains(missing.note_id().as_str()))
                {
                    self.purge_missing_note_under_mutation_boundary(
                        missing.note_id(),
                        missing.path(),
                        occurred_at_millis,
                    )?;
                }
                Ok(())
            })
        })
        .map_err(history_failure)
    }

    pub(super) fn synchronize_recovered_projection(
        &self,
        path: &Path,
        canonical_markdown: String,
        modified_at_millis: u64,
    ) -> Option<NoteMutationWarning> {
        let mut warning = None;
        let note = build_indexed_note(path, &canonical_markdown, modified_at_millis);
        if let Err(error) = self.state.upsert_note_indexes(path.to_path_buf(), note) {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::CatalogUpsert,
                "The note was recovered with incomplete search synchronization",
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, "recovered-note-catalog-retry");
        }
        if let Err(error) =
            self.state
                .semantic
                .queue_note_update(path, canonical_markdown, modified_at_millis)
        {
            merge_note_mutation_warning(
                &mut warning,
                MutationWarningStage::SemanticUpdate,
                "The note was recovered with incomplete search synchronization",
                error,
            );
            let _ = self
                .state
                .mark_notes_index_dirty(path, "recovered-note-semantic-retry");
        }
        warning
    }
}
