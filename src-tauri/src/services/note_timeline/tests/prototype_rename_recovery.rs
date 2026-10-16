use super::*;
use crate::{app::EventBus, semantic::SemanticState};

struct Fixture {
    state: AppState,
    _data: crate::test_support::TestDir,
    notes: crate::test_support::TestDir,
    source: PathBuf,
    target: PathBuf,
    identity: NoteIdentity,
    base: String,
}
impl Fixture {
    fn new() -> Self {
        let data = crate::test_support::TestDir::new("pi-rename-recovery-data");
        let notes = crate::test_support::TestDir::new("pi-rename-recovery-vault");
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
        let target = notes.path().join("Reviewed destination.md");
        let identity = NoteIdentity::new(created.note_id.unwrap());
        let base = fs::read_to_string(&source).unwrap();
        Self {
            state,
            _data: data,
            notes,
            source,
            target,
            identity,
            base,
        }
    }

    // The real durable preparation and correlation, followed by exactly the
    // fs::rename boundary. Drop the writer without a canonical publication.
    fn interrupt_after_rename(&self) -> PrototypePublicationProof {
        let proof = std::cell::RefCell::new(None);
        INTERRUPT_PROTOTYPE_AFTER_RENAME.store(true, std::sync::atomic::Ordering::SeqCst);
        let error = self
            .state
            .note_timeline()
            .edit_prototype_note_with_proof(
                &self.source,
                &self.target,
                &self.identity,
                &crate::semantic::db::content_hash(&self.base),
                "After",
                Some(&|value| {
                    *proof.borrow_mut() = Some(value.clone());
                    Ok(())
                }),
            )
            .unwrap_err();
        assert!(error.to_string().contains("simulated process interruption"));
        assert!(!self.source.exists());
        assert_eq!(fs::read_to_string(&self.target).unwrap(), self.base);
        let proof = proof.into_inner().unwrap();
        proof
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        crate::state::set_notes_root_override(None).unwrap();
    }
}

#[test]
fn prepared_rename_crash_restores_exact_base_then_retry_has_one_effect() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let proof = f.interrupt_after_rename();
    let timeline = f.state.note_timeline();
    // Startup/read recovery must retain the unpublished rename correlation.
    timeline.retry_history_recovery(f.notes.path()).unwrap();
    assert!(!f.source.exists());
    assert_eq!(fs::read_to_string(&f.target).unwrap(), f.base);
    assert!(timeline
        .recover_prototype_publication(&proof)
        .unwrap()
        .is_none());
    assert_eq!(fs::read_to_string(&f.source).unwrap(), f.base);
    assert!(!f.target.exists());
    let final_proof = std::cell::RefCell::new(None);
    timeline
        .edit_prototype_note_with_proof(
            &f.source,
            &f.target,
            &f.identity,
            &crate::semantic::db::content_hash(&f.base),
            "After",
            Some(&|value| {
                *final_proof.borrow_mut() = Some(value.clone());
                Ok(())
            }),
        )
        .unwrap();
    let final_proof = final_proof.into_inner().unwrap();
    let bytes = fs::read_to_string(&f.target).unwrap();
    for _ in 0..2 {
        assert!(timeline
            .recover_prototype_publication(&final_proof)
            .unwrap()
            .is_some());
        assert_eq!(fs::read_to_string(&f.target).unwrap(), bytes);
    }
    assert!(!f.source.exists());
    let connection = rusqlite::Connection::open(history_store::history_database_path_for_test(
        f.notes.path(),
    ))
    .unwrap();
    let (effects, renames): (u64,u64) = connection.query_row(
        "SELECT (SELECT COUNT(*) FROM revisions WHERE note_id=?1 AND source='acceptedChatProposal'),
                (SELECT COUNT(*) FROM lifecycle_events WHERE note_id=?1 AND kind IN ('renamed','moved'))",
        [f.identity.as_str()], |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
    assert_eq!((effects, renames), (1, 1));
}

#[test]
fn prepared_rename_crash_preserves_changed_target_as_actionable_conflict() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let proof = f.interrupt_after_rename();
    let changed = f.base.replace("Before", "Independent target edit");
    fs::write(&f.target, &changed).unwrap();
    let error = f
        .state
        .note_timeline()
        .recover_prototype_publication(&proof)
        .unwrap_err();
    assert!(matches!(error, HistoryError::Stale(_)));
    assert!(!f.source.exists());
    assert_eq!(fs::read_to_string(&f.target).unwrap(), changed);
}

#[test]
fn prepared_rename_crash_never_overwrites_reoccupied_source() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let proof = f.interrupt_after_rename();
    fs::write(&f.source, "Another note owns this path").unwrap();
    let error = f
        .state
        .note_timeline()
        .recover_prototype_publication(&proof)
        .unwrap_err();
    assert!(matches!(error, HistoryError::Stale(_)));
    assert_eq!(
        fs::read_to_string(&f.source).unwrap(),
        "Another note owns this path"
    );
    assert_eq!(fs::read_to_string(&f.target).unwrap(), f.base);
}

#[test]
fn byte_preserving_independent_move_requires_location_reapproval() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let moved = f.notes.path().join("Independently moved.md");
    fs::rename(&f.source, &moved).unwrap();
    let error = f
        .state
        .note_timeline()
        .edit_prototype_note(
            &f.source,
            &f.target,
            &f.identity,
            &crate::semantic::db::content_hash(&f.base),
            "After",
        )
        .unwrap_err();
    assert!(matches!(error, HistoryError::Stale(_)));
    assert_eq!(fs::read_to_string(&moved).unwrap(), f.base);
    assert!(!f.source.exists());
    assert!(!f.target.exists());
    f.state
        .note_timeline()
        .edit_prototype_note(
            &moved,
            &f.target,
            &f.identity,
            &crate::semantic::db::content_hash(&f.base),
            "After",
        )
        .unwrap();
    assert!(!moved.exists());
    assert!(fs::read_to_string(&f.target).unwrap().contains("After"));
}

#[test]
fn prepared_rename_proof_cannot_restore_different_accepted_bytes() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let mut proof = f.interrupt_after_rename();
    proof.canonical_markdown = proof.canonical_markdown.replace("After", "Forged");
    assert!(f
        .state
        .note_timeline()
        .recover_prototype_publication(&proof)
        .is_err());
    assert!(!f.source.exists());
    assert_eq!(fs::read_to_string(&f.target).unwrap(), f.base);
}

#[test]
fn prepared_rename_rollback_resumes_after_exclusive_source_restoration() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let proof = f.interrupt_after_rename();
    // Recovery itself died after its create-exclusive original-path write.
    crate::state::atomic_create_note(&f.source, f.base.as_bytes()).unwrap();
    assert!(f
        .state
        .note_timeline()
        .recover_prototype_publication(&proof)
        .unwrap()
        .is_none());
    assert_eq!(fs::read_to_string(&f.source).unwrap(), f.base);
    assert!(!f.target.exists());
}

#[test]
fn prepared_rename_canonical_capture_survives_whole_vault_move_without_replay() {
    let _guard = crate::test_support::lock_test_env();
    let data = crate::test_support::TestDir::new("pi-published-rename-move-data");
    let old = crate::test_support::TestDir::new("pi-published-rename-move-old");
    let destination = crate::test_support::TestDir::new("pi-published-rename-move-new");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(old.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(old.path()).unwrap();
    let first = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let created =
        crate::test_support::save_and_finalize(&first, "Original".into(), "Before".into(), None)
            .unwrap()
            .unwrap();
    let source = PathBuf::from(created.path.unwrap());
    let target = old.path().join("Reviewed destination.md");
    let identity = NoteIdentity::new(created.note_id.unwrap());
    let base = fs::read_to_string(&source).unwrap();
    let proof = std::cell::RefCell::new(None);
    INTERRUPT_PROTOTYPE_AFTER_CANONICAL.store(true, std::sync::atomic::Ordering::SeqCst);
    let error = first
        .note_timeline()
        .edit_prototype_note_with_proof(
            &source,
            &target,
            &identity,
            &crate::semantic::db::content_hash(&base),
            "After",
            Some(&|value| {
                *proof.borrow_mut() = Some(value.clone());
                Ok(())
            }),
        )
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("interruption after canonical publication"));
    let proof = proof.into_inner().unwrap();
    let canonical = fs::read_to_string(&target).unwrap();
    assert!(canonical.contains("After"));
    assert!(!source.exists());
    drop(first); // process loss: no clean close and no canonical rollback
    let moved = destination.path().join("Vault");
    fs::rename(old.path(), &moved).unwrap();
    crate::state::set_notes_root_override(Some(moved.clone())).unwrap();
    let reopened = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let target = moved.join("Reviewed destination.md");
    let timeline = reopened.note_timeline();
    for _ in 0..2 {
        let recovered = timeline
            .recover_prototype_publication_at(&proof, &target)
            .unwrap()
            .unwrap();
        assert_eq!(recovered.note_id(), &identity);
        assert_eq!(recovered.path(), target);
        assert_eq!(recovered.canonical_markdown(), canonical);
        assert_eq!(fs::read_to_string(&target).unwrap(), canonical);
        assert!(!moved.join("Original.md").exists());
    }
    let connection =
        rusqlite::Connection::open(history_store::history_database_path_for_test(&moved)).unwrap();
    let (effects, renames, pending): (u64,u64,u64) = connection.query_row(
        "SELECT (SELECT COUNT(*) FROM revisions WHERE note_id=?1 AND source='acceptedChatProposal'),
                (SELECT COUNT(*) FROM lifecycle_events WHERE note_id=?1 AND kind IN ('renamed','moved')),
                (SELECT COUNT(*) FROM prepared_intents WHERE note_id=?1)",
        [identity.as_str()], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    ).unwrap();
    assert_eq!((effects, renames, pending), (1, 1, 0));
    crate::state::set_notes_root_override(None).unwrap();
}
