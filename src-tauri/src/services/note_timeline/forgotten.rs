use super::*;
use crate::{
    note,
    state::{self, ForgottenItemKind, PersistedForgottenNote},
};
use std::ffi::OsStr;

#[cfg(test)]
pub(crate) static BEFORE_FORGOTTEN_PUBLICATION: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>> =
    std::sync::Mutex::new(None);
#[cfg(test)]
pub(crate) static AFTER_FORGET_METADATA_STAGED: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>> =
    std::sync::Mutex::new(None);

impl NoteTimeline<'_> {
    pub(crate) fn forget_note(
        &self,
        path: &Path,
        retention_days: u32,
    ) -> Result<(PersistedForgottenNote, Option<NoteMutationWarning>), HistoryError> {
        if !matches!(retention_days, 1 | 7 | 30) {
            return Err("Unsupported forgotten note retention window".into());
        }
        self.runtime.store.require_path(path)?;
        require_active_vault_root(&self.runtime.store, &state::notes_root()?)?;
        let notes_dir = self.runtime.store.vault_root();
        fs::create_dir_all(state::forgotten_notes_root(notes_dir))
            .map_err(|error| error.to_string())?;
        let target = resolve_forgotten_target_path(notes_dir, path);
        let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
        let canonical = self.prepare_publication(Some(path), None, &source)?;
        let (canonical, note_id) =
            prepare_forgotten_note_markdown(&canonical, note::current_timestamp_rfc3339()?)?;
        let now = crate::time::current_time_millis()?;
        let selected = PersistedForgottenNote {
            note_id: Some(note_id.clone()),
            forgotten_path: target.to_string_lossy().into_owned(),
            original_path: path.to_string_lossy().into_owned(),
            title: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            forgotten_at_millis: now,
            purge_after_days: retention_days,
            purge_at_millis: now
                .saturating_add(u64::from(retention_days).saturating_mul(RECOVERY_DAY_MILLIS)),
            kind: ForgottenItemKind::Note,
            conversation_id: None,
        };
        #[cfg(test)]
        {
            let hook = BEFORE_FORGOTTEN_PUBLICATION.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
        }
        let warning = self.move_forgotten_note(
            NoteLifecycleOperation::forgotten(
                NoteIdentity::new(note_id),
                path.to_path_buf(),
                target,
                now,
            ),
            &canonical,
            &source,
            &selected,
        )?;
        Ok((selected, warning))
    }

    pub(crate) fn recover_forgotten_note(
        &self,
        selected: &PersistedForgottenNote,
    ) -> Result<Option<(PathBuf, Option<NoteMutationWarning>)>, HistoryError> {
        require_active_vault_root(&self.runtime.store, &state::notes_root()?)?;
        let source_path = Path::new(&selected.forgotten_path);
        self.runtime.store.require_path(source_path)?;
        let exists = state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            require_active_vault_root(&self.runtime.store, &state::notes_root()?)?;
            if !state::db_forgotten_note_matches(selected)? {
                return Err(HistoryError::Stale(
                    "The forgotten item changed before recovery".into(),
                ));
            }
            if source_path.is_file() {
                return Ok(true);
            }
            state::db_remove_forgotten_note(selected)?;
            Ok(false)
        })?;
        if !exists {
            return Ok(None);
        }
        let target = resolve_restore_target_path(
            self.runtime.store.vault_root(),
            Path::new(&selected.original_path),
        );
        let source = fs::read_to_string(source_path).map_err(|error| error.to_string())?;
        let retained = selected.note_id.as_deref().map(NoteIdentity::new);
        let canonical = self.prepare_publication(None, retained.as_ref(), &source)?;
        let canonical = note::prepare_note_markdown(&canonical, Some(&canonical), Some(None))?.0;
        let note_id = note::note_id_from_path_or_markdown(Some(source_path), &canonical)
            .ok_or("Forgotten note is missing its Note Identity")?;
        let warning = self.move_forgotten_note(
            NoteLifecycleOperation::recovered(
                NoteIdentity::new(note_id),
                source_path.to_path_buf(),
                target.clone(),
                crate::time::current_time_millis()?,
            ),
            &canonical,
            &source,
            selected,
        )?;
        Ok(Some((target, warning)))
    }

    // The selected row is the lifecycle-instance evidence. Stage and roll back
    // only that row, without replacing concurrent navigation or settings state.
    fn move_forgotten_note(
        &self,
        operation: NoteLifecycleOperation,
        canonical: &str,
        source_markdown: &str,
        selected: &PersistedForgottenNote,
    ) -> Result<Option<NoteMutationWarning>, HistoryError> {
        let recovering = operation.kind == LifecycleEventKind::Recovered;
        let source = operation
            .previous_path
            .as_deref()
            .ok_or("Note move requires its source")?;
        let target = &operation.path;
        let mut staged = selected.clone();
        if recovering {
            staged.original_path = target.to_string_lossy().into_owned();
        }
        self.runtime.store.require_path(target)?;
        loop {
            self.await_history_readiness(&operation.note_id)?;
            let result = state::with_note_file_mutation(|| {
                let _operation = self.runtime.begin_operation()?;
                self.runtime.with_observation_replay(|| {
                    if !self.runtime.is_note_ready(&operation.note_id)?
                        || history_store::has_pending_replay(&self.runtime.store)?
                    {
                        return Ok(None);
                    }
                    let _mutation = self.begin_current_content_mutation()?;
                    let mut indeterminate = false;
                    let publication = self.publish_lifecycle_under_mutation_boundary(
                        operation.clone(),
                        canonical,
                        || {
                            require_active_vault_root(
                                &self.runtime.store,
                                &state::notes_root()
                                    .map_err(LifecyclePublicationFailure::not_published)?,
                            )
                            .map_err(|error| {
                                LifecyclePublicationFailure::not_published(error.to_string())
                            })?;
                            validate_note_move_source(source, source_markdown)?;
                            if recovering {
                                state::db_set_forgotten_original_path(
                                    selected,
                                    &staged.original_path,
                                )
                            } else {
                                state::db_insert_forgotten_note(selected)
                            }
                            .map_err(LifecyclePublicationFailure::not_published)?;
                            #[cfg(test)]
                            if !recovering {
                                let hook = AFTER_FORGET_METADATA_STAGED.lock().unwrap().take();
                                if let Some(hook) = hook {
                                    hook();
                                }
                            }
                            let expected = crate::vault_watcher::record_expected_move(
                                source, target, canonical,
                            );
                            if let Err(failure) =
                                publish_note_move(source, target, canonical, source_markdown)
                            {
                                indeterminate = matches!(
                                    failure,
                                    LifecyclePublicationFailure::Indeterminate(_)
                                );
                                return Err(rollback_forgotten_metadata(failure, || {
                                    if recovering {
                                        state::db_set_forgotten_original_path(
                                            &staged,
                                            &selected.original_path,
                                        )
                                    } else {
                                        state::db_remove_forgotten_note(selected).map(|_| ())
                                    }
                                }));
                            }
                            expected.commit();
                            Ok(())
                        },
                    )?;
                    let mut warning = publication.commit_warning().cloned();
                    let bookkeeping = if recovering {
                        if indeterminate {
                            Ok(())
                        } else {
                            state::db_remove_forgotten_note(&staged).map(|_| ())
                        }
                    } else {
                        state::db_finish_forgetting(selected)
                    };
                    if let Err(error) = bookkeeping {
                        merge_note_mutation_warning(
                            &mut warning,
                            MutationWarningStage::DirtyRecovery,
                            "The note lifecycle changed, but its bookkeeping is awaiting retry",
                            error,
                        );
                    }
                    Ok(Some(warning))
                })
            })?;
            if let Some(warning) = result {
                return Ok(warning);
            }
        }
    }
}

pub(crate) fn prepare_forgotten_note_markdown(
    note_markdown: &str,
    forgotten_at_rfc3339: String,
) -> Result<(String, String), String> {
    let (forgotten_markdown, metadata) = note::prepare_note_markdown(
        note_markdown,
        Some(note_markdown),
        Some(Some(forgotten_at_rfc3339)),
    )?;
    Ok((forgotten_markdown, metadata.id))
}

fn rollback_forgotten_metadata(
    failure: LifecyclePublicationFailure,
    rollback: impl FnOnce() -> Result<(), String>,
) -> LifecyclePublicationFailure {
    match failure {
        LifecyclePublicationFailure::NotPublished(error) => {
            LifecyclePublicationFailure::not_published(match rollback() {
                Ok(()) => error,
                Err(rollback_error) => format!("{error}; additionally failed to roll back forgotten metadata: {rollback_error}"),
            })
        }
        indeterminate => indeterminate,
    }
}

fn validate_note_move_source(
    source: &Path,
    expected_raw_markdown: &str,
) -> Result<(), LifecyclePublicationFailure> {
    let current = fs::read_to_string(source)
        .map_err(|error| LifecyclePublicationFailure::not_published(error.to_string()))?;
    if current != expected_raw_markdown {
        return Err(LifecyclePublicationFailure::not_published(
            "The note changed before it could be moved. Try again.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn publish_note_move(
    source: &Path,
    target: &Path,
    canonical_markdown: &str,
    rollback_markdown: &str,
) -> Result<(), LifecyclePublicationFailure> {
    // Destination planning occurs before asynchronous admission. Recheck under
    // the timeline's existing file owner so another recovery cannot be replaced.
    if target.exists() {
        return Err(LifecyclePublicationFailure::not_published(
            "The destination changed before the note could be moved".to_string(),
        ));
    }
    fs::rename(source, target)
        .map_err(|error| LifecyclePublicationFailure::not_published(error.to_string()))?;
    if let Err(error) = crate::state::atomic_write_note(target, canonical_markdown.as_bytes()) {
        let rollback = fs::rename(target, source).and_then(|_| {
            crate::state::atomic_write_note(source, rollback_markdown.as_bytes())
                .map_err(std::io::Error::other)
        });
        return Err(match rollback {
            Ok(()) => LifecyclePublicationFailure::not_published(error),
            Err(rollback_error) => LifecyclePublicationFailure::indeterminate(format!(
                "{error}; additionally failed to roll back the lifecycle file move: {rollback_error}"
            )),
        });
    }
    Ok(())
}

pub(crate) fn resolve_forgotten_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    unique_path_in_dir(
        &state::forgotten_notes_root(notes_dir),
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
        "Untitled Note",
    )
}

pub(crate) fn resolve_restore_target_path(notes_dir: &Path, original_path: &Path) -> PathBuf {
    if original_path.parent() == Some(notes_dir) && !original_path.exists() {
        return original_path.to_path_buf();
    }

    unique_path_in_dir(
        notes_dir,
        original_path
            .file_name()
            .unwrap_or_else(|| OsStr::new("Untitled Note.md")),
        "Untitled Note",
    )
}

pub(crate) fn forgotten_note_identity(
    forgotten_note: &PersistedForgottenNote,
    forgotten_path: &Path,
) -> Option<NoteIdentity> {
    if forgotten_note.kind != ForgottenItemKind::Note {
        return None;
    }
    if let Some(note_id) = forgotten_note
        .note_id
        .as_deref()
        .filter(|note_id| !note_id.trim().is_empty())
    {
        return Some(NoteIdentity::new(note_id));
    }
    let markdown = fs::read_to_string(forgotten_path).ok()?;
    note::note_id_from_path_or_markdown(Some(forgotten_path), &markdown).map(NoteIdentity::new)
}
