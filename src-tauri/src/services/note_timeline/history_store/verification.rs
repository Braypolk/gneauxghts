//! Typed verification in a consistent read snapshot. No runtime locks or file
//! mutation ownership are needed to finish one note.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[cfg(test)]
static NOTE_VERIFICATION_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
pub(in super::super) fn note_verification_count() -> usize {
    NOTE_VERIFICATION_COUNT.load(Ordering::SeqCst)
}

pub(in super::super) fn admit_current_store(store: &Store) -> Result<(), HistoryError> {
    let c = open_store(store)?;
    if history_reset_rebuild_is_pending(store, &c)? {
        return Err(corrupt("History reset rebuild is incomplete"));
    }
    Ok(())
}

fn checkpoint(stop: &AtomicBool) -> Result<(), HistoryError> {
    if stop.load(Ordering::Acquire) {
        return Err(HistoryError::Unavailable(
            "History verification cancelled".into(),
        ));
    }
    std::thread::yield_now();
    Ok(())
}

fn read_connection(store: &Store, stop: Arc<AtomicBool>) -> Result<Connection, HistoryError> {
    checkpoint(&stop)?;
    let c = open_store(store)?;
    c.busy_timeout(Duration::from_millis(100))?;
    c.progress_handler(1000, Some(move || stop.load(Ordering::Acquire)));
    Ok(c)
}

pub(in super::super) fn verification_notes(
    store: &Store,
    stop: Arc<AtomicBool>,
) -> Result<Vec<NoteIdentity>, HistoryError> {
    let c = read_connection(store, stop.clone())?;
    let mut stmt = c.prepare("SELECT note_id FROM timeline_heads UNION SELECT note_id FROM revisions UNION SELECT note_id FROM lifecycle_events UNION SELECT note_id FROM publication_scopes UNION SELECT note_id FROM pending_editing_windows")?;
    let mut notes = Vec::new();
    for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
        checkpoint(&stop)?;
        notes.push(NoteIdentity::new(row?));
    }
    Ok(notes)
}

pub(in super::super) fn verify_structure(
    store: &Store,
    stop: Arc<AtomicBool>,
) -> Result<(), HistoryError> {
    let mut c = read_connection(store, stop.clone())?;
    let tx = c.transaction()?;
    if !connection_integrity_is_verified(&tx)? {
        return Err(corrupt("History store structural verification failed"));
    }
    checkpoint(&stop)
}

pub(in super::super) fn verify_note(
    store: &Store,
    note: &NoteIdentity,
    stop: Arc<AtomicBool>,
) -> Result<(), HistoryError> {
    #[cfg(test)]
    NOTE_VERIFICATION_COUNT.fetch_add(1, Ordering::SeqCst);
    let mut c = read_connection(store, stop.clone())?;
    let tx = c.transaction()?;
    verify_note_snapshot(&tx, note, &|| checkpoint(&stop))
}

fn verify_note_snapshot(
    tx: &Connection,
    note: &NoteIdentity,
    check: &dyn Fn() -> Result<(), HistoryError>,
) -> Result<(), HistoryError> {
    verify_revision_payloads_cancellable(&tx, Some(note), check)?;
    editing_windows::verify_cancellable(&tx, Some(note.as_str()), check)?;
    let count: u64 = tx.query_row("SELECT (SELECT COUNT(*) FROM revisions WHERE note_id=?1)+(SELECT COUNT(*) FROM lifecycle_events WHERE note_id=?1)", [note.as_str()], |r| r.get(0))?;
    let head = tx.query_row("SELECT record_kind,record_id,record_count,revision_id,result_hash FROM timeline_heads WHERE note_id=?1", [note.as_str()], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,u64>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?))).optional()?;
    let Some((kind, id, recorded_count, revision, result_hash)) = head else {
        if count != 0 {
            return Err(corrupt("Timeline records have no head"));
        }
        return check();
    };
    if count != recorded_count {
        return Err(corrupt("Timeline head count mismatch"));
    }
    let mut cursor = parse_record_identity(Some(kind), Some(id))?;
    let mut seen = HashSet::new();
    let mut newest_revision = None;
    while let Some(id) = cursor {
        check()?;
        if !seen.insert(format!("{id:?}")) {
            return Err(corrupt("Timeline predecessor cycle"));
        }
        let record = bounded_timeline_record(&tx, note, &id)?
            .ok_or_else(|| corrupt("Timeline predecessor is missing"))?;
        if let BoundedTimelineRecord::Revision { header, .. } = &record {
            if newest_revision.is_none() {
                newest_revision = Some((
                    header.identity.as_str().to_owned(),
                    header.content_hash.clone(),
                ));
            }
        }
        cursor = record.predecessor();
    }
    if seen.len() as u64 != count || newest_revision != revision.zip(result_hash) {
        return Err(corrupt("Timeline head or predecessor lineage mismatch"));
    }
    // Lifecycle receipt scope is independent of the revision payload chain.
    let invalid: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM lifecycle_events e LEFT JOIN publication_receipts p ON p.intent_id=e.intent_id LEFT JOIN publication_scopes s ON s.note_id=e.note_id WHERE e.note_id=?1 AND e.intent_id IS NOT NULL AND (p.intent_id IS NULL OR p.note_id!=e.note_id OR p.status!='finalized' OR p.deletion_epoch!=s.deletion_epoch OR p.sequence>s.issued_sequence))", [note.as_str()], |r| r.get(0))?;
    if invalid {
        return Err(corrupt("Lifecycle publication receipt scope mismatch"));
    }
    check()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::EventBus, commands::note_persistence, index::AppState, semantic::SemanticState,
    };

    #[test]
    fn scoped_verification_keeps_one_snapshot_while_a_second_connection_saves() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("verification-snapshot-data");
        crate::state::initialize_app_data_dir(data.path().to_owned()).unwrap();
        let notes = crate::test_support::TestDir::new("verification-snapshot-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_owned())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let saved = note_persistence::persist_note_session_with_outcome(
            &state,
            "Snapshot".into(),
            "A".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let note = NoteIdentity::new(saved.note_id.unwrap());
        let store = &state.note_timeline().runtime.store;
        let mut c = read_connection(store, Arc::new(AtomicBool::new(false))).unwrap();
        let tx = c.transaction().unwrap();
        let old_count: u64 = tx
            .query_row(
                "SELECT record_count FROM timeline_heads WHERE note_id=?1",
                [note.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        // App-owned publication on a different connection commits while this
        // read transaction retains the preceding complete history snapshot.
        note_persistence::persist_note_session_with_outcome(
            &state,
            "Snapshot".into(),
            "B".into(),
            saved.path,
        )
        .unwrap();
        state
            .note_timeline()
            .finalize_editing_window(&note)
            .unwrap();
        verify_note_snapshot(&tx, &note, &|| Ok(())).unwrap();
        let snapshot_count: u64 = tx
            .query_row(
                "SELECT record_count FROM timeline_heads WHERE note_id=?1",
                [note.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        let new_count: u64 = open_store(store)
            .unwrap()
            .query_row(
                "SELECT record_count FROM timeline_heads WHERE note_id=?1",
                [note.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(snapshot_count, old_count);
        assert_eq!(new_count, old_count + 1);
        drop(tx);
        verify_note(store, &note, Arc::new(AtomicBool::new(false))).unwrap();
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn long_note_verification_checks_cancellation_between_payloads() {
        let _guard = crate::test_support::lock_test_env();
        let data = crate::test_support::TestDir::new("verification-cancel-data");
        crate::state::initialize_app_data_dir(data.path().to_owned()).unwrap();
        let notes = crate::test_support::TestDir::new("verification-cancel-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_owned())).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        let saved = note_persistence::persist_note_session_with_outcome(
            &state,
            "Cancel".into(),
            "A".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let note = NoteIdentity::new(saved.note_id.unwrap());
        for n in 0..12 {
            note_persistence::persist_note_session_with_outcome(
                &state,
                "Cancel".into(),
                format!("state {n}"),
                saved.path.clone(),
            )
            .unwrap();
            state
                .note_timeline()
                .finalize_editing_window(&note)
                .unwrap();
        }
        let c = open_store(&state.note_timeline().runtime.store).unwrap();
        let checks = std::cell::Cell::new(0);
        let error = verify_note_snapshot(&c, &note, &|| {
            checks.set(checks.get() + 1);
            if checks.get() == 5 {
                Err(HistoryError::Unavailable("cancelled within a note".into()))
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert!(matches!(error, HistoryError::Unavailable(_)));
        assert_eq!(checks.get(), 5);
        crate::state::set_notes_root_override(None).unwrap();
    }
}
