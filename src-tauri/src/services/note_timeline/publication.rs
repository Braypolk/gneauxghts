use super::*;

#[cfg(test)]
mod rename_tests;

/// Exact canonical publication prepared by NoteTimeline. Only the trusted native
/// effect ledger retains this opaque proof; Pi review documents never receive it.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublicationProof {
    token: String,
    note_id: String,
    path: PathBuf,
    canonical_markdown: String,
    #[serde(default)]
    effect: PublicationEffect,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum PublicationEffect {
    #[default]
    Write,
    Rename {
        source_path: PathBuf,
    },
}
type ProofRecorder<'a> = &'a dyn Fn(&PublicationProof) -> Result<(), HistoryError>;

fn require_raw_publication_base(
    raw: &str,
    identity: &NoteIdentity,
    expected_hash: &str,
) -> Result<(), HistoryError> {
    if crate::note::parse_note(raw)
        .frontmatter
        .managed
        .as_ref()
        .map(|m| m.id.as_str())
        != Some(identity.as_str())
    {
        return Err(HistoryError::Stale(
            "Target identity changed; review again".into(),
        ));
    }
    if crate::semantic::db::content_hash(raw) != expected_hash {
        return Err(HistoryError::Stale(
            "Target changed; review refreshed content and Keep again".into(),
        ));
    }
    Ok(())
}

pub(super) enum PublicationMode<'a> {
    Replace,
    Proven {
        record: ProofRecorder<'a>,
        create_only: bool,
    },
    Restore {
        selected: &'a RevisionIdentity,
        expected_hash: &'a str,
        selected_hash: &'a str,
    },
}

pub(super) struct AuthoredPublication {
    pub(super) mutation: NoteMutationResult,
    pub(super) revision_id: Option<RevisionIdentity>,
}

impl<'a> NoteTimeline<'a> {
    /// Prepare user-authored Markdown for an app-owned publication while
    /// preserving the identity already owned by the logical note. Callers
    /// provide continuity evidence; the timeline keeps the repair policy
    /// and metadata representation private.
    pub(super) fn prepare_publication(
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
                return Err(HistoryError::Stale(format!(
                    "Note identity continuity conflict: retained identity {retained} does not match catalog identity {catalog}."
                )));
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

    /// Target recovery and verification never hold the canonical file owner.
    /// The authoritative input is resolved again under ownership; the edit runs
    /// exactly once, only after that target has been admitted.
    pub(super) fn with_admitted_publication<T>(
        &self,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        resolve: impl Fn(&NoteIdentity) -> Result<(PathBuf, String), HistoryError>,
        publish: impl FnOnce(PathBuf, String, NoteIdentity) -> Result<T, HistoryError>,
    ) -> Result<T, HistoryError> {
        let mut candidate = NoteIdentity::new(crate::note::generate_unique_id());
        let mut publish = Some(publish);
        loop {
            self.runtime.with_history_result(|| {
                let _operation = self.runtime.begin_operation()?;
                self.recover_retained_observations()?;
                self.ensure_history_recovered()?;
                let (path, raw) = resolve(&candidate)?;
                self.runtime.store.require_path(&path)?;
                candidate = self.publication_identity(
                    continuity_path,
                    retained_identity,
                    &raw,
                    &candidate,
                )?;
                self.reconcile_publication_location(continuity_path, &candidate)?;
                self.runtime.ensure_note_ready(&candidate)
            })?;
            #[cfg(test)]
            {
                let hook = AFTER_SAVE_PREFLIGHT.lock().unwrap().take();
                if let Some(hook) = hook {
                    hook();
                }
            }
            let result = crate::state::with_note_file_mutation(|| {
                let _operation = self.runtime.begin_operation()?;
                self.runtime.with_observation_replay(|| {
                    if history_store::has_pending_replay(&self.runtime.store)? {
                        return Ok(None);
                    }
                    let (path, raw) = resolve(&candidate)?;
                    self.runtime.store.require_path(&path)?;
                    let identity = self.publication_identity(
                        continuity_path,
                        retained_identity,
                        &raw,
                        &candidate,
                    )?;
                    // Preflight can have admitted this buffer before another
                    // publication moved its identity. Recheck under the file
                    // owner so a queued save cannot recreate its former path
                    // or overwrite a different note that now occupies it.
                    if let Some(path) = continuity_path {
                        if history_store::current_path(&self.runtime.store, &identity)?
                            .is_some_and(|current| current != path)
                        {
                            return Err(HistoryError::Stale(
                                "Note location changed while the save was waiting; refresh before saving".into(),
                            ));
                        }
                    }
                    if !self.runtime.is_note_ready(&identity)? {
                        candidate = identity;
                        return Ok(None);
                    }
                    publish.take().expect("admitted publication runs once")(path, raw, identity)
                        .map(Some)
                })
            })?;
            if let Some(result) = result {
                return Ok(result);
            }
        }
    }

    fn publication_identity(
        &self,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        raw: &str,
        fallback: &NoteIdentity,
    ) -> Result<NoteIdentity, HistoryError> {
        let repaired = self.prepare_publication(continuity_path, retained_identity, raw)?;
        Ok(crate::note::parse_note(&repaired)
            .frontmatter
            .managed
            .map(|metadata| metadata.id)
            .filter(|id| !id.trim().is_empty())
            .map(NoteIdentity::new)
            .unwrap_or_else(|| fallback.clone()))
    }

    #[cfg(test)]
    pub(crate) fn save_note(
        &self,
        source: MutationSource,
        title: &str,
        markdown: &str,
        current_path: Option<String>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.save_note_with_tags(source, title, markdown, current_path, None)
    }

    #[cfg(test)]
    pub(crate) fn save_note_with_tags(
        &self,
        source: MutationSource,
        title: &str,
        markdown: &str,
        current_path: Option<String>,
        tag_edit: Option<&crate::tags::TagEdit>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.save_note_with_expected_identity(source, title, markdown, current_path, None, tag_edit)
    }

    pub(crate) fn save_note_with_expected_identity(
        &self,
        source: MutationSource,
        title: &str,
        markdown: &str,
        current_path: Option<String>,
        expected_identity: Option<&NoteIdentity>,
        tag_edit: Option<&crate::tags::TagEdit>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        let root = self.runtime.store.vault_root();
        let current_path = crate::state::validate_current_path(current_path, root)?;
        if expected_identity.is_some() && current_path.is_none() {
            return Err(HistoryError::Stale(
                "A saved Note Identity requires its captured note path".into(),
            ));
        }
        let source = if current_path.is_none() {
            MutationSource::NoteCreation
        } else {
            source
        };
        if current_path.is_none()
            && title.trim().is_empty()
            && markdown.trim().is_empty()
            && tag_edit.is_none_or(|edit| edit.tags.is_empty())
        {
            return Ok(None);
        }
        self.with_admitted_publication(
            current_path.as_deref(),
            expected_identity,
            |candidate| {
                Ok(crate::state::prepare_note_save(
                    root,
                    title,
                    markdown,
                    current_path.as_deref(),
                    Some(candidate.as_str()),
                )?)
            },
            |path, canonical, identity| {
                let canonical = crate::tags::apply_edit(&canonical, tag_edit)?;
                let canonical =
                    self.prepare_publication(current_path.as_deref(), Some(&identity), &canonical)?;
                self.publish_authored(
                    source,
                    path,
                    current_path.clone(),
                    canonical,
                    PublicationMode::Replace,
                )
                .map(|outcome| Some(outcome.mutation))
            },
        )
    }

    /// Apply a domain transform to the owned authoritative Markdown. The caller
    /// computes content only; preparation, publication and recovery stay here.
    pub(crate) fn edit_note(
        &self,
        source: MutationSource,
        path: &Path,
        retained_identity: Option<&NoteIdentity>,
        transform: impl FnOnce(&str) -> Result<String, HistoryError>,
    ) -> Result<NoteMutationResult, HistoryError> {
        let path = crate::state::validate_current_path(
            Some(path.to_string_lossy().into_owned()),
            self.runtime.store.vault_root(),
        )?
        .ok_or("Missing note path")?;
        self.with_admitted_publication(
            Some(&path),
            retained_identity,
            |_| Ok((path.clone(), fs::read_to_string(&path)?)),
            |path, raw, identity| {
                let authored = transform(&raw)?;

                let repaired = self.prepare_publication(Some(&path), Some(&identity), &authored)?;
                let canonical =
                    crate::note::prepare_note_markdown(&repaired, Some(&raw), Some(None))?.0;
                Ok(self
                    .publish_authored(
                        source,
                        path.clone(),
                        Some(path),
                        canonical,
                        PublicationMode::Replace,
                    )?
                    .mutation)
            },
        )
    }

    /// Complete same-location update with an exact raw-file base and durable proof.
    pub(crate) fn update_note_with_proof(
        &self,
        path: &Path,
        identity: &NoteIdentity,
        expected_hash: &str,
        markdown: &str,
        record: ProofRecorder<'_>,
    ) -> Result<NoteMutationResult, HistoryError> {
        let root = self.runtime.store.vault_root();
        let current =
            crate::state::validate_current_path(Some(path.to_string_lossy().into_owned()), root)?
                .ok_or("Missing note path")?;
        self.with_admitted_publication(
            Some(&current),
            Some(identity),
            |_| {
                // A byte-preserving independent move still invalidates location
                // approval. Resolve again both before and under file ownership.
                let located = crate::state::resolve_note_path_by_id(root, identity.as_str())?;
                if located.as_deref() != Some(current.as_path()) {
                    return Err(HistoryError::Stale(
                        "Target location changed; review its current location and Keep again"
                            .into(),
                    ));
                }
                Ok((current.clone(), fs::read_to_string(&current)?))
            },
            |path, raw, admitted| {
                require_raw_publication_base(&raw, identity, expected_hash)?;
                if admitted != *identity {
                    return Err(HistoryError::Stale(
                        "Target identity changed; review again".into(),
                    ));
                }

                // The issued editing base exposes authored content only. Treat its full
                // replacement as authoritative for body and unmanaged properties,
                // including removing the final property. Managed metadata comes
                // exclusively from the admitted canonical base, never the model.
                let authored = crate::note::parse_note(markdown);
                let properties = authored.frontmatter.raw_other.map(|mut properties| {
                    if !properties.ends_with('\n') {
                        properties.push('\n');
                    }
                    properties
                });
                let canonical = crate::note::replace_authored_content(
                    &raw,
                    properties.as_deref(),
                    &authored.body,
                )?;
                Ok(self
                    .publish_authored(
                        MutationSource::AgentPublication,
                        path,
                        Some(current.clone()),
                        canonical,
                        PublicationMode::Proven {
                            record,
                            create_only: false,
                        },
                    )?
                    .mutation)
            },
        )
    }

    /// Create at the exact prepared destination. Identity and canonical bytes are
    /// stable across retries; the atomic publication can never replace a late arrival.
    pub(crate) fn create_note_with_proof(
        &self,
        path: &Path,
        identity: &NoteIdentity,
        canonical: &str,
        record: ProofRecorder<'_>,
    ) -> Result<NoteMutationResult, HistoryError> {
        self.runtime.store.require_path(path)?;
        if crate::note::parse_note(canonical)
            .frontmatter
            .managed
            .as_ref()
            .map(|m| m.id.as_str())
            != Some(identity.as_str())
        {
            return Err("Prepared creation identity does not match".into());
        }
        self.with_admitted_publication(
            None,
            Some(identity),
            |_| match fs::symlink_metadata(path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Ok((path.to_path_buf(), canonical.to_string()))
                }
                Ok(_) => Err(HistoryError::Stale(
                    "Creation destination is occupied".into(),
                )),
                Err(error) => Err(error.into()),
            },
            |path, canonical, _| {
                self.publish_authored(
                    MutationSource::AgentPublication,
                    path,
                    None,
                    canonical,
                    PublicationMode::Proven {
                        record,
                        create_only: true,
                    },
                )
                .map(|outcome| outcome.mutation)
            },
        )
    }

    /// Move the admitted source without changing a single canonical byte. The
    /// durable two-path proof precedes the no-replace syscall, and every replay
    /// verifies that original effect instead of attempting a second rename.
    pub(crate) fn rename_note_with_proof(
        &self,
        source: &Path,
        destination: &Path,
        identity: &NoteIdentity,
        expected_raw_hash: &str,
        record: ProofRecorder<'_>,
    ) -> Result<NoteMutationResult, HistoryError> {
        let root = self.runtime.store.vault_root();
        self.runtime.store.require_path(source)?;
        self.runtime.store.require_path(destination)?;
        if source == destination || source.parent() != destination.parent() {
            return Err(
                "A note rename requires a different filename in its current directory".into(),
            );
        }
        let source =
            crate::state::validate_current_path(Some(source.to_string_lossy().into_owned()), root)?
                .ok_or("Missing rename source")?;
        let destination = destination.to_path_buf();
        let resolve = || -> Result<(PathBuf, String), HistoryError> {
            if crate::state::resolve_note_path_by_id(root, identity.as_str())?.as_deref()
                != Some(source.as_path())
            {
                return Err(HistoryError::Stale(
                    "Rename source location changed; read and review again".into(),
                ));
            }
            if !fs::symlink_metadata(&source)?.file_type().is_file() {
                return Err(HistoryError::Stale(
                    "Rename source is no longer an ordinary file".into(),
                ));
            }
            let raw = fs::read_to_string(&source)?;
            require_raw_publication_base(&raw, identity, expected_raw_hash)?;
            match fs::symlink_metadata(&destination) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
                Ok(_) => return Err(HistoryError::Stale("Rename destination is occupied".into())),
            }
            if crate::note::parse_note(&raw)
                .frontmatter
                .managed
                .as_ref()
                .is_none_or(|managed| managed.trashed_at.is_some())
            {
                return Err(HistoryError::Stale(
                    "Rename source is no longer an active note".into(),
                ));
            }
            Ok((source.clone(), raw))
        };
        self.with_admitted_publication(Some(&source), Some(identity), |_| resolve(), |_, raw, admitted| {
            if admitted != *identity {
                return Err(HistoryError::Stale("Rename source identity changed".into()));
            }
            let _mutation = self.begin_current_content_mutation()?;
            self.finalize_editor_capture(identity)?;
            // A fresh authorized read can see an external edit before its watcher
            // event. Retain that observed source state through the existing
            // history owner; the following filename-only effect adds no content
            // revision and cannot claim authorship of the independent edit.
            if history_store::current_content_hash(&self.runtime.store, identity)?
                .is_some_and(|head| head != history_store::authored_content_hash(&raw))
            {
                history_store::record_external_revision(&self.runtime.store, identity,
                    &source, &raw, crate::time::current_time_millis()?, None)?;
            }
            let intent = history_store::prepare_rename_publication(
                &self.runtime.store, &source, &destination, &raw,
                crate::time::current_time_millis()?,
            )?;
            let proof = PublicationProof {
                token: intent.as_str().into(), note_id: identity.as_str().into(),
                path: destination.clone(), canonical_markdown: raw.clone(),
                effect: PublicationEffect::Rename { source_path: source.clone() },
            };
            if let Err(error) = record(&proof) {
                return Err(intent.abandon_after_history_failure(error));
            }
            #[cfg(feature = "e2e-wdio")]
            crate::e2e_process_fault::hit("rename-prepared");
            // Proof recording can block on durable external state. Revalidate
            // source bytes/location and destination after it returns.
            if let Err(error) = resolve() {
                return Err(intent.abandon_after_history_failure(error));
            }
            let removal = crate::vault_watcher::record_expected_removal(&source);
            let write = crate::vault_watcher::record_expected_write(&destination, &raw);
            if let Err(error) = crate::state::atomic_move_note_no_replace(&source, &destination) {
                // The kernel can have moved successfully before an I/O/sync
                // acknowledgement fails. Never abandon an unproven effect.
                let source_unchanged = fs::read_to_string(&source).is_ok_and(|current| current == raw);
                let destination_absent = fs::symlink_metadata(&destination).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
                if source_unchanged && (destination_absent || error.kind() == std::io::ErrorKind::AlreadyExists) {
                    return Err(intent.abandon_after_history_failure(error.into()));
                }
                let _ = history_store::release_publication_receipt(&self.runtime.store, &intent);
                let _ = self.runtime.require_released_capture_recovery();
                return Err(HistoryError::from(error).with_context("Rename outcome is uncertain; reconcile its retained two-path proof before retrying"));
            }
            removal.commit();
            write.commit();
            #[cfg(feature = "e2e-wdio")]
            crate::e2e_process_fault::hit("rename-moved");
            // An external writer can change the source inode between the final
            // read and rename. Keep that changed file intact and retain proof;
            // no rollback or stale-byte publication can restore the reviewed input.
            if !fs::symlink_metadata(&destination).is_ok_and(|metadata| metadata.file_type().is_file())
                || !fs::read_to_string(&destination).is_ok_and(|current| current == raw)
                || !fs::symlink_metadata(&source).is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            {
                let _ = history_store::release_publication_receipt(&self.runtime.store, &intent);
                let _ = self.runtime.require_released_capture_recovery();
                return Err("Rename moved a concurrently changed source; retained effect requires reconciliation".into());
            }
            if let Err(error) = history_store::record_rename_effect(&self.runtime.store, &intent) {
                let _ = history_store::release_publication_receipt(&self.runtime.store, &intent);
                let _ = self.runtime.require_released_capture_recovery();
                return Err(error.with_context("Rename moved; its exact effect observation still requires reconciliation"));
            }
            #[cfg(feature = "e2e-wdio")]
            crate::e2e_process_fault::hit("rename-observed");
            Ok(self.mutate(NoteMutation {
                source: MutationSource::AgentPublication,
                history_intent: intent,
                path: destination.clone(),
                previous_path: Some(source.clone()),
                fallback_markdown: raw,
            }))
        })
    }

    fn reconcile_rename_publication(
        &self,
        proof: &PublicationProof,
        source: &Path,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.runtime.store.require_path(source)?;
        self.runtime.store.require_path(&proof.path)?;
        if source.parent() != proof.path.parent() || source == proof.path {
            return Err("Invalid retained rename locations".into());
        }
        self.retry_history_recovery(self.runtime.store.vault_root())?;
        let identity = NoteIdentity::new(proof.note_id.clone());
        if !history_store::verify_rename_publication(
            &self.runtime.store,
            &proof.token,
            &identity,
            source,
            &proof.path,
            &proof.canonical_markdown,
        )? {
            return Ok(None);
        }
        let (diagnostics, warning) = crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _mutation = self.begin_current_content_mutation()?;
            let current = fs::symlink_metadata(&proof.path)
                .ok()
                .filter(|metadata| metadata.file_type().is_file())
                .and_then(|_| fs::read_to_string(&proof.path).ok())
                .filter(|raw| {
                    crate::note::parse_note(raw)
                        .frontmatter
                        .managed
                        .as_ref()
                        .is_some_and(|managed| {
                            managed.id == proof.note_id && managed.trashed_at.is_none()
                        })
                });
            match current {
                Some(raw) => {
                    // A newly created old-path file is independent data. Upsert
                    // that current file separately, never remove its projection
                    // merely because it shares a former location.
                    let old_present = fs::symlink_metadata(source).is_ok();
                    let mut outcome = post_publication::synchronize_canonical_file(
                        self.state,
                        proof.path.clone(),
                        (!old_present).then(|| source.to_path_buf()),
                        raw,
                    );
                    if old_present {
                        if let Some(old_raw) = fs::symlink_metadata(source)
                            .ok()
                            .filter(|metadata| metadata.file_type().is_file())
                            .and_then(|_| fs::read_to_string(source).ok())
                        {
                            let old = post_publication::synchronize_canonical_file(
                                self.state,
                                source.to_path_buf(),
                                None,
                                old_raw,
                            );
                            outcome.issues.extend(old.issues);
                        }
                    }
                    let warning = outcome.required_consistency_warning();
                    Ok::<_, HistoryError>((outcome.issues, warning))
                }
                None => Ok((
                    vec![],
                    Some(NoteMutationWarning::single(
                        MutationWarningStage::CanonicalRead,
                        "The rename committed; its current location could not be verified.".into(),
                        "The current destination is unavailable or has another identity.".into(),
                    )),
                )),
            }
        })?;
        Ok(Some(NoteMutationResult {
            payload_version: PayloadVersion::V1,
            source: MutationSource::AgentPublication,
            note_id: identity,
            path: proof.path.clone(),
            canonical_markdown: proof.canonical_markdown.clone(),
            diagnostics,
            warning,
        }))
    }

    /// Verification recovers retained history only; it never publishes new Markdown.
    /// Token, identity and canonical bytes must verify against the retained receipt.
    pub(crate) fn reconcile_publication(
        &self,
        proof: &PublicationProof,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        if let PublicationEffect::Rename { source_path } = &proof.effect {
            return self.reconcile_rename_publication(proof, source_path);
        }
        let path = &proof.path;
        self.runtime.store.require_path(path)?;
        let identity = NoteIdentity::new(proof.note_id.clone());
        self.retry_history_recovery(self.runtime.store.vault_root())?;
        // Startup reads do not mutate canonical files. Reconcile only this
        // exact prepared token under the ordinary canonical mutation owner.

        if !history_store::verify_publication(
            &self.runtime.store,
            &proof.token,
            &identity,
            &proof.canonical_markdown,
        )? {
            return Ok(None);
        }
        // A verified canonical effect can have lost its acknowledgement before
        // required catalog/task coordination was recorded. Repair current same-
        // identity projections through their existing owner; never publish old bytes.
        let (diagnostics, warning) = crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _mutation = self.begin_current_content_mutation()?;
            let current = fs::read_to_string(path).ok().filter(|raw| {
                crate::note::parse_note(raw)
                    .frontmatter
                    .managed
                    .as_ref()
                    .is_some_and(|managed| {
                        managed.id == proof.note_id && managed.trashed_at.is_none()
                    })
            });
            match current {
                Some(raw) => {
                    let coordinated = post_publication::synchronize_canonical_file(
                        self.state, path.to_path_buf(), None, raw,
                    );
                    let warning = coordinated.required_consistency_warning();
                    Ok::<_, HistoryError>((coordinated.issues, warning))
                }
                None => Ok((vec![], Some(NoteMutationWarning::single(
                    MutationWarningStage::CanonicalRead,
                    "The publication committed; current note projections could not be verified.".into(),
                    "The current canonical target is unavailable or has a different identity.".into(),
                )))),
            }
        })?;
        Ok(Some(NoteMutationResult {
            payload_version: PayloadVersion::V1,
            source: MutationSource::AgentPublication,
            note_id: identity,
            path: path.to_path_buf(),
            canonical_markdown: proof.canonical_markdown.clone(),
            diagnostics,
            warning,
        }))
    }

    pub(super) fn publish_authored(
        &self,
        source: MutationSource,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        canonical: String,
        mode: PublicationMode<'_>,
    ) -> Result<AuthoredPublication, HistoryError> {
        let _mutation = self.begin_current_content_mutation()?;
        let (canonical, history_intent) = self
            .prepare_canonical_revision_publication(
                source,
                &path,
                previous_path.as_deref(),
                canonical,
            )?
            .into_parts();
        if let PublicationMode::Proven { record, .. } = &mode {
            let identity = crate::note::parse_note(&canonical)
                .frontmatter
                .managed
                .ok_or("Prepared publication has no Note Identity")?
                .id;
            let proof = PublicationProof {
                token: history_intent.as_str().into(),
                note_id: identity,
                path: path.clone(),
                canonical_markdown: canonical.clone(),
                effect: PublicationEffect::Write,
            };
            if let Err(error) = record(&proof) {
                return Err(history_intent.abandon_after_history_failure(error));
            }
        }
        let revision_id = if let PublicationMode::Restore {
            selected,
            expected_hash,
            selected_hash,
        } = mode
        {
            let prepare = (|| {
                history_store::prepare_restore_origin(
                    &self.runtime.store,
                    &history_intent,
                    selected,
                )?;
                if history_store::authored_content_hash(&canonical) != selected_hash {
                    return Err(
                        "Version Restore preparation changed the selected authored content".into(),
                    );
                }
                let current = fs::read_to_string(&path)?;
                if history_store::authored_content_hash(&current) != expected_hash {
                    return Err(HistoryError::Stale(
                        "Current authored content changed while Version Restore was being prepared"
                            .into(),
                    ));
                }
                history_store::publication_revision_identity(&self.runtime.store, &history_intent)
            })();
            match prepare {
                Ok(id) => Some(id),
                Err(error) => return Err(history_intent.abandon_after_history_failure(error)),
            }
        } else {
            None
        };
        let moved_from = previous_path
            .as_deref()
            .filter(|previous| *previous != path && previous.exists());
        let expected_removal = moved_from.map(crate::vault_watcher::record_expected_removal);
        if let Some(previous) = moved_from {
            if let Err(error) = fs::rename(previous, &path) {
                return Err(history_intent.abandon_after_history_failure(error.into()));
            }
        }
        #[cfg(test)]
        {
            let hook = AFTER_SAVE_RENAME.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
        }
        let expected_write = crate::vault_watcher::record_expected_write(&path, &canonical);
        let write = if matches!(
            mode,
            PublicationMode::Proven {
                create_only: true,
                ..
            }
        ) {
            crate::state::atomic_create_note(&path, canonical.as_bytes()).map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    HistoryError::Stale("Creation destination is occupied".into())
                } else {
                    error.into()
                }
            })
        } else {
            crate::state::atomic_write_note(&path, canonical.as_bytes()).map_err(HistoryError::from)
        };
        if let Err(error) = write {
            if let Some(previous) = moved_from {
                if let Err(rollback) = fs::rename(&path, previous) {
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
                        .map(|e| format!("; failed to release save for recovery: {e}"))
                        .unwrap_or_default();
                    return Err(error.with_context(format!("failed to restore {} from {}: {rollback}; history intent retained for recovery{recovery_error}", previous.display(), path.display())));
                }
            }
            return Err(history_intent.abandon_after_history_failure(error));
        }
        if let Some(expected) = expected_removal {
            expected.commit();
        }
        expected_write.commit();
        Ok(AuthoredPublication {
            revision_id,
            mutation: self.mutate(NoteMutation {
                source,
                history_intent,
                path,
                previous_path,
                fallback_markdown: canonical,
            }),
        })
    }
    /// Durably prepare one app-owned authored-state mutation before its
    /// canonical Markdown is published. The returned bytes include the
    /// timeline-owned identity and are the only bytes the caller may publish.
    #[cfg(test)]
    pub(super) fn prepare_revision_publication(
        &self,
        source: MutationSource,
        target_path: &Path,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<PreparedRevisionPublication, HistoryError> {
        self.runtime.with_history_result(|| {
            let _operation = self.runtime.begin_operation()?;
            self.runtime.store.require_path(target_path)?;
            let _current_content_mutation = self.begin_current_content_mutation()?;
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

    pub(super) fn mutate(&self, mutation: NoteMutation) -> NoteMutationResult {
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
