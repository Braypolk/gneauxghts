use super::*;
use crate::services::note_timeline::VaultObservation;
use std::sync::Mutex;

fn fixture(
    label: &str,
) -> (
    crate::test_support::TestVault,
    EvidenceSession,
    Vec<PassageCitation>,
) {
    let vault = crate::test_support::TestVault::new(label);
    let mut session = EvidenceSession::default();
    session.configure_allowance(Some(usize::MAX));
    let mut passages = Vec::new();
    for title in ["First source", "Second source"] {
        let saved = crate::test_support::save_and_finalize(
            &vault.state,
            title.into(),
            format!("Canonical {title} passage"),
            None,
        )
        .unwrap()
        .unwrap();
        let (_, delivered) = session
            .read_request(
                &vault.state,
                None,
                &HashSet::new(),
                ReadRequest {
                    note_id: saved.note_id,
                    ..Default::default()
                },
            )
            .unwrap();
        passages.push(
            delivered
                .into_iter()
                .map(|(citation, _, _)| citation)
                .find(|citation| citation.location == "body")
                .unwrap(),
        );
    }
    session
        .admitted
        .retain(|id, _| passages.iter().any(|citation| &citation.id == id));
    (vault, session, passages)
}

fn with_validation_hook<T>(
    hook: impl FnMut(CitationValidationEvent<'_>) + 'static,
    operation: impl FnOnce() -> T,
) -> T {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            CITATION_VALIDATION_HOOK.with(|hook| *hook.borrow_mut() = None);
        }
    }
    CITATION_VALIDATION_HOOK.with(|current| {
        assert!(current.borrow().is_none());
        *current.borrow_mut() = Some(Box::new(hook));
    });
    let _reset = Reset;
    operation()
}

#[test]
fn admitted_batch_retries_and_rejects_a_source_changed_after_its_validation() {
    let (vault, session, _) = fixture("evidence-batch-changed");
    let state = vault.state.clone();
    let attempts = Arc::new(AtomicUsize::new(0));
    let observed_attempts = attempts.clone();
    let mut changed = false;
    let mut first_source = None;
    let current = with_validation_hook(
        move |event| match event {
            CitationValidationEvent::AttemptStarted => {
                observed_attempts.fetch_add(1, Ordering::SeqCst);
            }
            CitationValidationEvent::SourceValidated(citation) if !changed => {
                let (path, title) = state
                    .notes_index
                    .lock()
                    .unwrap()
                    .get_note_by_note_id(&citation.note_id)
                    .map(|(path, note)| (path.to_string_lossy().to_string(), note.title.clone()))
                    .unwrap();
                if let Some((first_path, first_title)) = first_source.take() {
                    changed = true;
                    crate::test_support::save_and_finalize(
                        &state,
                        first_title,
                        "Changed after validation".into(),
                        Some(first_path),
                    )
                    .unwrap()
                    .unwrap();
                } else {
                    first_source = Some((path, title));
                }
            }
            _ => {}
        },
        || {
            session
                .check_current(&vault.state, None, &HashSet::new())
                .unwrap()
        },
    );
    assert!(
        !current,
        "A later source cannot hide a change to an earlier source"
    );
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        2,
        "A timeline mutation retries the complete batch"
    );
}

#[test]
fn admitted_batch_rechecks_every_source_after_an_unchanged_observation_overlap() {
    let (vault, session, _) = fixture("evidence-batch-unchanged");
    let unrelated = crate::test_support::save_and_finalize(
        &vault.state,
        "Unrelated source".into(),
        "Unchanged unrelated bytes".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let original = fs::read(unrelated.path.as_ref().unwrap()).unwrap();
    let state = vault.state.clone();
    let attempts = Arc::new(AtomicUsize::new(0));
    let observed_attempts = attempts.clone();
    let validated = Arc::new(Mutex::new(Vec::new()));
    let observed_sources = validated.clone();
    let mut observed = false;
    let current = with_validation_hook(
        move |event| match event {
            CitationValidationEvent::AttemptStarted => {
                observed_attempts.fetch_add(1, Ordering::SeqCst);
            }
            CitationValidationEvent::SourceValidated(citation) => {
                observed_sources.lock().unwrap().push(citation.id.clone());
                if !observed {
                    observed = true;
                    state
                        .note_timeline()
                        .observe(VaultObservation::external_edit(
                            PathBuf::from(unrelated.path.as_ref().unwrap()),
                            2,
                            None,
                        ))
                        .unwrap();
                }
            }
        },
        || {
            session
                .check_current(&vault.state, None, &HashSet::new())
                .unwrap()
        },
    );
    assert!(current);
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    let validated = validated.lock().unwrap();
    for id in session.admitted.keys() {
        assert_eq!(
            validated.iter().filter(|seen| *seen == id).count(),
            2,
            "Every admitted passage must be rechecked, including earlier sources"
        );
    }
    assert_eq!(
        fs::read(vault.notes.path().join("Unrelated source.md")).unwrap(),
        original
    );
}

#[test]
fn admitted_batch_rechecks_earlier_canonical_bytes_without_a_watcher_event() {
    let (vault, session, _) = fixture("evidence-batch-external");
    let state = vault.state.clone();
    let mut changed = false;
    let mut first_path = None;
    let current = with_validation_hook(
        move |event| {
            if let CitationValidationEvent::SourceValidated(citation) = event {
                if !changed {
                    let path = state
                        .notes_index
                        .lock()
                        .unwrap()
                        .get_note_by_note_id(&citation.note_id)
                        .unwrap()
                        .0
                        .clone();
                    if let Some(earlier_path) = first_path.take() {
                        changed = true;
                        let raw = fs::read_to_string(&earlier_path).unwrap();
                        fs::write(
                            earlier_path,
                            raw.replace("Canonical", "Uncaptured change to"),
                        )
                        .unwrap();
                    } else {
                        first_path = Some(path);
                    }
                }
            }
        },
        || {
            session
                .check_current(&vault.state, None, &HashSet::new())
                .unwrap()
        },
    );
    assert!(
        !current,
        "Canonical rechecks cannot depend on watcher delivery"
    );
}

#[test]
fn citation_batch_keeps_scope_identity_hash_title_range_and_proof_checks() {
    let (vault, _, citations) = fixture("evidence-batch-checks");
    let refs = citations.iter().collect::<Vec<_>>();
    let excluded = HashSet::new();
    assert!(check_citations(&vault.state, &refs, None, &excluded)
        .unwrap()
        .is_some());
    let allowed = HashSet::from([citations[0].note_id.clone()]);
    assert!(
        check_citations(&vault.state, &refs, Some(&allowed), &excluded)
            .unwrap()
            .is_none()
    );
    assert!(check_citations(
        &vault.state,
        &refs,
        None,
        &HashSet::from([citations[1].note_id.clone()])
    )
    .unwrap()
    .is_none());
    let mut invalid = citations[1].clone();
    for change in 0..6 {
        invalid.clone_from(&citations[1]);
        match change {
            0 => invalid.note_id = "missing-note".into(),
            1 => invalid.content_hash = "different-hash".into(),
            2 => invalid.end += 1,
            3 => invalid.excerpt = "different excerpt".into(),
            4 => {
                invalid.location = "title".into();
                invalid.start = 0;
                invalid.end = "Outdated title".len();
                invalid.excerpt = "Outdated title".into();
            }
            _ => invalid.revisions.push(RevisionCitation {
                note_id: invalid.note_id.clone(),
                revision_id: "unissued-revision".into(),
                at_millis: 1,
                time_evidence: None,
                source: crate::services::note_timeline::MutationSource::Editor,
                current_excerpt: invalid.excerpt.clone(),
            }),
        }
        assert!(
            check_citations(&vault.state, &[&citations[0], &invalid], None, &excluded)
                .unwrap()
                .is_none(),
            "Invalid source variant {change} must fail the complete set"
        );
        assert!(check_citation(&vault.state, &invalid, None, &excluded)
            .unwrap()
            .is_none());
    }
    let path = vault
        .state
        .notes_index
        .lock()
        .unwrap()
        .get_note_by_note_id(&citations[1].note_id)
        .unwrap()
        .0
        .clone();
    let original = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        original.replace(&citations[1].note_id, "another-managed-identity"),
    )
    .unwrap();
    assert!(check_citations(&vault.state, &refs, None, &excluded)
        .unwrap()
        .is_none());
    fs::write(&path, original).unwrap();
    assert!(check_citations(&vault.state, &refs, None, &excluded)
        .unwrap()
        .is_some());
    fs::remove_file(path).unwrap();
    assert!(check_citations(&vault.state, &refs, None, &excluded)
        .unwrap()
        .is_none());
}
