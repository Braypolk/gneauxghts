use super::*;
use crate::services::note_timeline::activity_history::ActivityHistoryAccess;

#[test]
fn retained_changes_validate_proofs_and_scope_without_promoting_historical_status() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save("A unchanged backlog\nOriginal plan.");
    f.seal();
    f.clock.store(2_000_000, Ordering::SeqCst);
    f.save("A unchanged backlog\n- [ ] Send report\nExperimental idea, later removed.");
    f.seal();
    f.clock.store(3_000_000, Ordering::SeqCst);
    f.save("A unchanged backlog\n- [x] Send report\nVendor review.");
    f.seal();
    let timeline = f.state.note_timeline();
    let access = timeline.activity_history(AllowedScope::vault());
    let (changes, complete) = access.changes(&f.note, 1_500_000, 2_500_000).unwrap();
    assert!(complete);
    let text = changes
        .iter()
        .map(|change| change.text.as_str())
        .collect::<String>();
    assert!(!text.contains("unchanged backlog"));
    assert!(
        text.contains("Send report")
            && text.contains("Experimental idea")
            && text.contains("Original plan")
    );
    let current = timeline
        .current_content(AllowedScope::vault())
        .read_note(&f.note)
        .unwrap()
        .markdown;
    assert!(current.contains("[x] Send report") && !current.contains("Experimental idea"));
    let denied = timeline.activity_history(AllowedScope::policy(
        Some(&HashSet::from([f.note.as_str().into()])),
        &HashSet::from([f.note.as_str().into()]),
    ));
    for change in &changes {
        let validate = |access: &ActivityHistoryAccess<'_>, text: &str| {
            access
                .validate(
                    &f.note,
                    &change.proof,
                    &change.location,
                    change.start,
                    change.start + change.text.len(),
                    text,
                )
                .unwrap()
        };
        assert!(validate(&access, &change.text));
        assert!(!validate(&denied, &change.text));
        assert!(!validate(&access, "forged unchanged backlog"));
    }
    timeline.clear_note_history(&f.note).unwrap();
    assert!(access
        .changes(&f.note, 1_500_000, 2_500_000)
        .unwrap()
        .0
        .is_empty());
    for change in changes {
        assert!(!matches!(
            access.validate(
                &f.note,
                &change.proof,
                &change.location,
                change.start,
                change.start + change.text.len(),
                &change.text
            ),
            Ok(true)
        ));
    }
}

#[test]
fn retained_changes_keep_clock_uncertainty_and_do_not_redate_an_appended_line() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("first");
    clock.elapsed.store(100, Ordering::SeqCst);
    clock.wall.store(900_000, Ordering::SeqCst);
    f.save("endpoint");
    f.seal();
    let timeline = f.state.note_timeline();
    let access = timeline.activity_history(AllowedScope::vault());
    let (changes, _) = access.changes(&f.note, 10_000_000, 20_000_000).unwrap();
    assert!(
        !changes.is_empty(),
        "uncertain clock windows remain candidates outside recorded bounds"
    );
    assert!(changes.iter().all(|c| c.proof.time_evidence.uncertain()));
    drop(timeline);
    let f = Fixture::new();
    f.save("A initial proposal: weekly exports.");
    f.seal();
    f.clock.store(2_000_000, Ordering::SeqCst);
    f.save("A initial proposal: weekly exports.\n\n- [ ] Arrange vendor review");
    f.seal();
    let timeline = f.state.note_timeline();
    let (changes, _) = timeline
        .activity_history(AllowedScope::vault())
        .changes(&f.note, 1_500_000, 2_500_000)
        .unwrap();
    let text = changes.iter().map(|c| c.text.as_str()).collect::<String>();
    assert!(text.contains("Arrange vendor review"));
    assert!(!text.contains("weekly exports"));
}
