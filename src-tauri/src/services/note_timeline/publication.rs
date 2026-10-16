use super::*;

#[cfg(all(test, feature = "pi-prototype"))]
static INTERRUPT_PROTOTYPE_AFTER_RENAME: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(test, feature = "pi-prototype"))]
static INTERRUPT_PROTOTYPE_AFTER_CANONICAL: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Exact canonical publication prepared by NoteTimeline. Only the trusted native
/// effect ledger retains this opaque proof; Pi review documents never receive it.
#[cfg(feature = "pi-prototype")]
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrototypePublicationProof {
    token: String,
    note_id: String,
    path: PathBuf,
    canonical_markdown: String,
}
#[cfg(feature = "pi-prototype")]
impl PrototypePublicationProof {
    pub(crate) fn location(&self) -> &Path { &self.path }
}
#[cfg(feature = "pi-prototype")]
type PrototypeProofRecorder<'a> =
    &'a dyn Fn(&PrototypePublicationProof) -> Result<(), HistoryError>;

#[cfg(all(test, feature = "pi-prototype"))]
mod pi_review_tests {
    use super::*;
    use crate::{app::EventBus, semantic::SemanticState};

    #[test]
    fn unchanged_review_rename_proof_survives_more_than_64_later_publications() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("pi-unchanged-receipt-data");
        let notes = crate::test_support::TestDir::new("pi-unchanged-receipt-vault");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::test_support::save_and_finalize(
            &state,
            "Original".into(),
            "Before".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let source = PathBuf::from(created.path.unwrap());
        let target = notes.path().join("Moved.md");
        let identity = NoteIdentity::new(created.note_id.unwrap());
        let hash = crate::semantic::db::content_hash(&fs::read_to_string(&source).unwrap());
        let proof = std::cell::RefCell::new(None);
        state
            .note_timeline()
            .edit_prototype_note_with_proof(
                &source,
                &target,
                &identity,
                &hash,
                "Before",
                Some(&|value| {
                    *proof.borrow_mut() = Some(value.clone());
                    Ok(())
                }),
            )
            .unwrap();
        let proof = proof.into_inner().unwrap();
        for index in 0..70 {
            state
                .note_timeline()
                .save_note(
                    MutationSource::Editor,
                    "Moved",
                    &format!("Later ordinary edit {index}"),
                    Some(target.to_string_lossy().into_owned()),
                )
                .unwrap()
                .unwrap();
        }
        let current = fs::read_to_string(&target).unwrap();
        let recovered = state
            .note_timeline()
            .recover_prototype_publication(&proof)
            .unwrap()
            .unwrap();
        assert_eq!(recovered.note_id(), &identity);
        assert!(recovered.canonical_markdown().contains("Before"));
        assert_eq!(fs::read_to_string(&target).unwrap(), current);
        assert!(current.contains("Later ordinary edit 69"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn accepted_review_changes_location_and_body_once_and_rejects_changed_base_or_collision() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("pi-review-publication-data");
        let notes = crate::test_support::TestDir::new("pi-review-publication-vault");
        crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let created = crate::test_support::save_and_finalize(
            &state,
            "Original".into(),
            "---\nproject: atlas\n---\n\nBefore".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let source = PathBuf::from(created.path.unwrap());
        let identity = NoteIdentity::new(created.note_id.unwrap());
        let raw = fs::read_to_string(&source).unwrap();
        let hash = crate::semantic::db::content_hash(&raw);
        let target = notes.path().join("Independent location.md");
        let timeline = state.note_timeline();
        assert!(timeline
            .edit_prototype_note(&source, &target, &identity, "wrong base", "After")
            .is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), raw);
        assert!(!target.exists());
        fs::write(&target, "Other note").unwrap();
        assert!(timeline
            .edit_prototype_note(&source, &target, &identity, &hash, "After")
            .is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "Other note");
        assert_eq!(fs::read_to_string(&source).unwrap(), raw);
        fs::remove_file(&target).unwrap();
        let committed = timeline
            .edit_prototype_note(
                &source,
                &target,
                &identity,
                &hash,
                "---\nproject: atlas\n---\n\nAfter",
            )
            .unwrap();
        assert_eq!(committed.note_id.as_str(), identity.as_str());
        assert_eq!(committed.path, target);
        assert!(!source.exists());
        let canonical = fs::read_to_string(&target).unwrap();
        assert!(canonical.contains("project: atlas"));
        assert!(canonical.contains("After"));
        assert!(timeline
            .edit_prototype_note(&source, &target, &identity, &hash, "Replay must not write")
            .is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), canonical);
        crate::state::set_notes_root_override(None).unwrap();
    }
}

#[cfg(feature = "pi-prototype")]
fn require_prototype_base(
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

#[derive(Clone, Copy)]
pub(super) enum PublicationPathScope {
    Destination,
    Parent,
}

pub(super) enum PublicationMode<'a> {
    Replace,
    CreateNew,
    #[cfg(feature = "pi-prototype")]
    Prototype {
        record: PrototypeProofRecorder<'a>,
        create_new: bool,
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

    /// Target recovery and verification never hold the canonical file owner.
    /// The authoritative input is resolved again under ownership; the edit runs
    /// exactly once, only after that target has been admitted.
    pub(super) fn with_admitted_publication<T>(
        &self,
        path_scope: PublicationPathScope,
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
                self.runtime.store.require_path(match path_scope {
                    PublicationPathScope::Destination => &path,
                    PublicationPathScope::Parent => path.parent().ok_or("Missing note parent")?,
                })?;
                candidate = self.publication_identity(
                    continuity_path,
                    retained_identity,
                    &raw,
                    &candidate,
                )?;
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
                    self.runtime.store.require_path(match path_scope {
                        PublicationPathScope::Destination => &path,
                        PublicationPathScope::Parent => {
                            path.parent().ok_or("Missing note parent")?
                        }
                    })?;
                    let identity = self.publication_identity(
                        continuity_path,
                        retained_identity,
                        &raw,
                        &candidate,
                    )?;
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

    pub(crate) fn save_note(
        &self,
        source: MutationSource,
        title: &str,
        markdown: &str,
        current_path: Option<String>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.save_note_with_tags(source, title, markdown, current_path, None)
    }

    pub(crate) fn save_note_with_tags(
        &self,
        source: MutationSource,
        title: &str,
        markdown: &str,
        current_path: Option<String>,
        tag_edit: Option<&crate::tags::TagEdit>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        let root = self.runtime.store.vault_root();
        let current_path = crate::state::validate_current_path(current_path, root)?;
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
            PublicationPathScope::Destination,
            current_path.as_deref(),
            None,
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
                .map(|outcome| outcome.map(|outcome| outcome.mutation))
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
            PublicationPathScope::Destination,
            Some(&path),
            retained_identity,
            |_| Ok((path.clone(), fs::read_to_string(&path)?)),
            |path, raw, identity| {
                crate::note::reject_chat_projection_write(&raw)?;
                let authored = transform(&raw)?;
                crate::note::reject_chat_projection_write(&authored)?;
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
                    .expect("replacement never returns occupied")
                    .mutation)
            },
        )
    }

    /// Publish at the exact path, returning None when it is occupied. Adjacent
    /// temporary-file publication never exposes a partially written new note.
    pub(crate) fn create_note_at(
        &self,
        source: MutationSource,
        path: &Path,
        markdown: &str,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.create_note_at_with_identity(
            source,
            path,
            markdown,
            None,
            #[cfg(feature = "pi-prototype")]
            None,
        )
    }

    /// One accepted Pi effect may change body and location independently. Check
    /// the captured identity/base and destination under the same admission as
    /// the retained history intent, rename and canonical publication.
    #[cfg(feature = "pi-prototype")]
    pub(crate) fn edit_prototype_note(
        &self,
        current_path: &Path,
        target_path: &Path,
        identity: &NoteIdentity,
        expected_hash: &str,
        markdown: &str,
    ) -> Result<NoteMutationResult, HistoryError> {
        self.edit_prototype_note_with_proof(
            current_path,
            target_path,
            identity,
            expected_hash,
            markdown,
            None,
        )
    }

    #[cfg(feature = "pi-prototype")]
    pub(crate) fn edit_prototype_note_with_proof(
        &self,
        current_path: &Path,
        target_path: &Path,
        identity: &NoteIdentity,
        expected_hash: &str,
        markdown: &str,
        record: Option<PrototypeProofRecorder<'_>>,
    ) -> Result<NoteMutationResult, HistoryError> {
        let root = self.runtime.store.vault_root();
        let current = crate::state::validate_current_path(
            Some(current_path.to_string_lossy().into_owned()),
            root,
        )?
        .ok_or("Missing note path")?;
        let target = crate::proposals::canonical_agent_commit_target(root, target_path)?;
        self.with_admitted_publication(
            PublicationPathScope::Destination,
            Some(&current),
            Some(identity),
            |_| {
                // A byte-preserving independent move still invalidates location
                // approval. Resolve again both before and under file ownership.
                let located = crate::state::resolve_note_path_by_id(root, identity.as_str())?;
                if located.as_deref() != Some(current.as_path()) {
                    return Err(HistoryError::Stale(
                        "Target location changed; review its current location and Keep again".into(),
                    ));
                }
                Ok((target.clone(), fs::read_to_string(&current)?))
            },
            |path, raw, admitted| {
                require_prototype_base(&raw, identity, expected_hash)?;
                if admitted != *identity {
                    return Err(HistoryError::Stale(
                        "Target identity changed; review again".into(),
                    ));
                }
                if path != current {
                    match fs::symlink_metadata(&path) {
                        Ok(_) => return Err(HistoryError::Stale(
                            "Review destination occupied; choose another location and Keep again"
                                .into(),
                        )),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                crate::note::reject_chat_projection_write(&raw)?;
                crate::note::reject_chat_projection_write(markdown)?;
                let repaired =
                    self.prepare_publication(Some(&current), Some(identity), markdown)?;
                let canonical =
                    crate::note::prepare_note_markdown(&repaired, Some(&raw), Some(None))?.0;
                Ok(self
                    .publish_authored(
                        MutationSource::AcceptedChatProposal,
                        path,
                        Some(current.clone()),
                        canonical,
                        record
                            .map(|record| PublicationMode::Prototype {
                                record,
                                create_new: false,
                            })
                            .unwrap_or(PublicationMode::Replace),
                    )?
                    .expect("replacement never returns occupied")
                    .mutation)
            },
        )
    }

    // A native publication intent may reserve the Note Identity before writing
    // Markdown, so a crash cannot mistake unrelated equal text for its receipt.
    #[cfg(feature = "pi-prototype")]
    pub(crate) fn create_prototype_note_at(
        &self,
        path: &Path,
        markdown: &str,
        identity: &NoteIdentity,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.create_note_at_with_identity(
            MutationSource::AcceptedChatProposal,
            path,
            markdown,
            Some(identity),
            None,
        )
    }

    #[cfg(feature = "pi-prototype")]
    pub(crate) fn create_prototype_note_with_proof(
        &self,
        path: &Path,
        markdown: &str,
        identity: &NoteIdentity,
        record: PrototypeProofRecorder<'_>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.create_note_at_with_identity(
            MutationSource::AcceptedChatProposal,
            path,
            markdown,
            Some(identity),
            Some(record),
        )
    }

    #[cfg(feature = "pi-prototype")]
    pub(crate) fn recover_prototype_publication(
        &self,
        proof: &PrototypePublicationProof,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.recover_prototype_publication_at(proof, &proof.path)
    }

    /// The native location adapter supplies only a location resolved from this
    /// vault's retained root binding. Token, identity and canonical bytes remain
    /// unchanged and must still verify against the timeline's retained receipt.
    #[cfg(feature = "pi-prototype")]
    pub(crate) fn recover_prototype_publication_at(
        &self,
        proof: &PrototypePublicationProof,
        path: &Path,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        self.runtime.store.require_path(path)?;
        let identity = NoteIdentity::new(proof.note_id.clone());
        self.retry_history_recovery(self.runtime.store.vault_root())?;
        // Startup reads do not mutate canonical files. Reconcile only this
        // exact prepared token under the ordinary canonical mutation owner.
        crate::state::with_note_file_mutation(|| {
            let _operation = self.runtime.begin_operation()?;
            let _mutation = self.begin_current_content_mutation()?;
            history_store::prototype_renames::recover(
                &self.runtime.store, &proof.token, &identity, path, &proof.canonical_markdown,
            )
        })?;
        if !history_store::verify_prototype_publication(
            &self.runtime.store,
            &proof.token,
            &identity,
            &proof.canonical_markdown,
        )? {
            return Ok(None);
        }
        Ok(Some(NoteMutationResult {
            payload_version: PayloadVersion::V1,
            source: MutationSource::AcceptedChatProposal,
            note_id: identity,
            path: path.to_path_buf(),
            canonical_markdown: proof.canonical_markdown.clone(),
            diagnostics: vec![],
            warning: None,
        }))
    }

    fn create_note_at_with_identity(
        &self,
        source: MutationSource,
        path: &Path,
        markdown: &str,
        retained_identity: Option<&NoteIdentity>,
        #[cfg(feature = "pi-prototype")] record: Option<PrototypeProofRecorder<'_>>,
    ) -> Result<Option<NoteMutationResult>, HistoryError> {
        let path = crate::state::validate_current_path(
            Some(path.to_string_lossy().into_owned()),
            self.runtime.store.vault_root(),
        )?
        .ok_or("Missing note path")?;
        crate::note::reject_chat_projection_write(markdown)?;
        self.with_admitted_publication(
            PublicationPathScope::Parent,
            None,
            retained_identity,
            |_| Ok((path.clone(), markdown.to_string())),
            |path, raw, identity| {
                // An occupied leaf, including an outward or dangling symlink,
                // is a conflict. Only its parent determines creation scope.
                match fs::symlink_metadata(&path) {
                    Ok(_) => return Ok(None),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
                let repaired = crate::note::repair_managed_note_identity(&raw, identity.as_str())?;
                let canonical = crate::note::prepare_note_markdown(&repaired, None, Some(None))?.0;
                #[cfg(feature = "pi-prototype")]
                let mode = record
                    .map(|record| PublicationMode::Prototype {
                        record,
                        create_new: true,
                    })
                    .unwrap_or(PublicationMode::CreateNew);
                #[cfg(not(feature = "pi-prototype"))]
                let mode = PublicationMode::CreateNew;
                self.publish_authored(source, path, None, canonical, mode)
                    .map(|outcome| outcome.map(|outcome| outcome.mutation))
            },
        )
    }

    pub(super) fn publish_authored(
        &self,
        source: MutationSource,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        canonical: String,
        mode: PublicationMode<'_>,
    ) -> Result<Option<AuthoredPublication>, HistoryError> {
        let _mutation = self.begin_current_content_mutation()?;
        let (canonical, history_intent) = self
            .prepare_canonical_revision_publication(
                source,
                &path,
                previous_path.as_deref(),
                canonical,
            )?
            .into_parts();
        #[cfg(feature = "pi-prototype")]
        if let PublicationMode::Prototype { record, .. } = &mode {
            if let Some(previous) = previous_path.as_deref().filter(|previous| *previous != path) {
                let prepared = (|| {
                    let base = fs::read_to_string(previous)?;
                    history_store::prototype_renames::prepare(
                        &self.runtime.store, history_intent.as_str(), previous, &path, &base,
                    )
                })();
                if let Err(error) = prepared {
                    return Err(history_intent.abandon_after_history_failure(error));
                }
            }
            let identity = crate::note::parse_note(&canonical)
                .frontmatter
                .managed
                .ok_or("Prepared publication has no Note Identity")?
                .id;
            let proof = PrototypePublicationProof {
                token: history_intent.as_str().into(),
                note_id: identity,
                path: path.clone(),
                canonical_markdown: canonical.clone(),
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
        #[cfg(all(test, feature = "pi-prototype"))]
        if moved_from.is_some() && matches!(mode, PublicationMode::Prototype { .. })
            && INTERRUPT_PROTOTYPE_AFTER_RENAME.swap(false, std::sync::atomic::Ordering::SeqCst) {
            // Model process loss at the actual fs::rename boundary, without
            // poisoning the shared file owner or relying on a write rollback.
            history_store::release_publication_receipt(&self.runtime.store, &history_intent)?;
            self.runtime.require_released_capture_recovery()?;
            return Err("simulated process interruption after prepared rename".into());
        }
        #[cfg(test)]
        {
            let hook = AFTER_SAVE_RENAME.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
        }
        let expected_write = crate::vault_watcher::record_expected_write(&path, &canonical);
        let mut create_new = matches!(mode, PublicationMode::CreateNew);
        #[cfg(feature = "pi-prototype")]
        {
            create_new |= matches!(
                mode,
                PublicationMode::Prototype {
                    create_new: true,
                    ..
                }
            );
        }
        let write = if create_new {
            match crate::state::atomic_create_note(&path, canonical.as_bytes()) {
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    history_intent.abandon()?;
                    return Ok(None);
                }
                result => result.map_err(HistoryError::from),
            }
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
        #[cfg(all(test, feature = "pi-prototype"))]
        if matches!(mode, PublicationMode::Prototype { .. })
            && INTERRUPT_PROTOTYPE_AFTER_CANONICAL.swap(false, std::sync::atomic::Ordering::SeqCst) {
            history_store::release_publication_receipt(&self.runtime.store, &history_intent)?;
            self.runtime.require_released_capture_recovery()?;
            return Err("simulated process interruption after canonical publication".into());
        }
        Ok(Some(AuthoredPublication {
            revision_id,
            mutation: self.mutate(NoteMutation {
                source,
                history_intent,
                path,
                previous_path,
                fallback_markdown: canonical,
            }),
        }))
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

#[cfg(all(test, feature = "pi-prototype"))]
#[path = "tests/prototype_rename_recovery.rs"]
mod prototype_rename_recovery_tests;
