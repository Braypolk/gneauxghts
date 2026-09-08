use super::*;

#[cfg(test)]
pub(crate) fn history_note_verification_count_for_test() -> usize {
    history_store::note_verification_count()
}

#[cfg(test)]
pub(crate) fn reset_history_integrity_snapshot_count_for_test() {
    history_store::reset_integrity_snapshot_count();
}

#[cfg(test)]
pub(crate) fn history_integrity_snapshot_count_for_test() -> usize {
    history_store::integrity_snapshot_count()
}

#[cfg(test)]
pub(crate) fn inject_history_finalization_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Finalize);
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HistoryTestDamage {
    Payload,
    WindowEvidence,
    ReciprocalEvidence,
    PayloadVersion,
    DatabaseBytes,
    DeltaLength,
    Lineage,
    Predecessor,
    Ancestry,
    Source,
}

#[cfg(test)]
pub(crate) fn damage_retained_revision_for_test(revision_id: &str, damage: HistoryTestDamage) {
    history_store::damage_retained_revision_for_test(
        &history_store::Store::for_test(),
        revision_id,
        damage,
    );
}

#[cfg(test)]
pub(crate) fn history_scan_counts_for_test() -> (usize, usize) {
    history_store::diagnostic_scan_counts()
}

#[cfg(test)]
pub(crate) fn prepared_history_intent_count_for_test(status: &str) -> u64 {
    history_store::prepared_intent_count(&history_store::Store::for_test(), status)
}

#[cfg(test)]
pub(crate) fn retained_observation_count_for_test() -> u64 {
    history_store::retained_observation_count(&history_store::Store::for_test())
}

#[cfg(test)]
pub(crate) fn reconstructed_revision_bodies_for_test(
    state: &AppState,
    note_id: &str,
) -> Result<Vec<String>, HistoryError> {
    let timeline = state.note_timeline();
    let history = timeline.history_mode(HistoryModeGrant::authorized(NoteIdentity::new(note_id)));
    history
        .revisions()?
        .into_iter()
        .map(|revision| {
            history
                .reconstruct(revision.identity())
                .map(|revision| revision.body().to_string())
        })
        .collect()
}

#[cfg(test)]
pub(crate) fn inject_history_recovery_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Recover);
}

#[cfg(test)]
pub(crate) fn inject_history_baseline_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Baseline);
}

#[cfg(test)]
pub(crate) fn corrupt_note_revision_payload_for_test(note_id: &NoteIdentity) {
    history_store::replace_revision_payload_version(&history_store::Store::for_test(), note_id, 99);
}

#[cfg(feature = "e2e-wdio")]
pub(crate) fn corrupt_history_store_for_test(state: &AppState) {
    history_store::replace_history_store_with_malformed_file_for_test(
        &state.note_timeline().runtime.store,
    );
}

#[cfg(test)]
pub(crate) fn replace_one_revision_source_for_test(
    note_id: &NoteIdentity,
    revision_id: &RevisionIdentity,
    source: &str,
) {
    history_store::replace_one_revision_source(
        &history_store::Store::for_test(),
        note_id,
        revision_id,
        source,
    );
}

#[cfg(test)]
pub(crate) fn inject_history_deletion_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Deletion);
}

#[cfg(test)]
pub(crate) fn inject_history_clean_close_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Close);
}

#[cfg(test)]
pub(crate) fn inject_lifecycle_finalization_failure_once() {
    history_store::inject_fault_once(history_store::FaultPoint::Lifecycle);
}

#[cfg(test)]
pub(super) fn inject_purge_staging_failure_once() {
    FAIL_NEXT_PURGE_STAGE.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
pub(super) fn inject_purge_projection_cleanup_failure_once() {
    FAIL_NEXT_PURGE_PROJECTION_CLEANUP.store(true, std::sync::atomic::Ordering::SeqCst);
}
