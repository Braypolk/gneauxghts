use super::*;

fn millis(date: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(date)
        .unwrap()
        .timestamp_millis() as u64
}

#[test]
fn prose_activity_preserves_range_dates_and_late_reports_need_content_search() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let old = "# Work\n\nI delivered the old brochure on September 4.";
    f.clock
        .store(millis("2026-09-06T12:00:00-06:00"), Ordering::SeqCst);
    f.save(old);
    f.seal();
    let week = "# Work\n\nI delivered the old brochure on September 4.\n\nI sent the Atlas quote on September 9.\n\nI resolved the cache incident.";
    f.clock
        .store(millis("2026-09-09T12:00:00-06:00"), Ordering::SeqCst);
    f.save(week);
    f.seal();
    let current = format!(
        "{}\n\nSeptember 15 retrospective: I submitted the expense report on September 8.",
        week.replace("Atlas quote", "Atlas revised quote")
    );
    f.clock
        .store(millis("2026-09-15T12:00:00-06:00"), Ordering::SeqCst);
    f.save(&current);
    f.seal();
    let after = millis("2026-09-07T00:00:00-06:00");
    let before = millis("2026-09-14T00:00:00-06:00");
    let items = f.activity_ranges(after, before);
    assert!(!items.is_empty());
    assert!(
        items.iter().all(|i| i["task"].is_null()),
        "prose is not backend-validated checkbox status"
    );
    assert!(
        items
            .iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("sent")),
        "completion wording survives the later edit: {items:?}"
    );
    assert!(
        !items
            .iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("revised")),
        "later word edit is outside the week"
    );
    assert!(
        !items
            .iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("old brochure")),
        "file modification cannot refresh old prose"
    );
    assert!(
        !items
            .iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("expense report")),
        "activity searches date text changes, not described events"
    );
    let current_body = crate::note::parse_note(&fs::read_to_string(&f.path).unwrap()).body;
    for phrase in ["old brochure", "expense report", "revised"] {
        let start = current_body.find(phrase).unwrap();
        let end = start + phrase.len();
        assert!(
            !items
                .iter()
                .any(|i| i["start"].as_u64().unwrap() < end as u64
                    && i["end"].as_u64().unwrap() > start as u64),
            "even a fragment of {phrase} must not be reported as changed during the week"
        );
    }
    assert!(
        items
            .iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("resolved")),
        "appending the retrospective must preserve the preceding completion sentence"
    );
    for item in &items {
        assert_eq!(
            item["provenance"]["lastChangedAt"]["atMillis"],
            millis("2026-09-09T12:00:00-06:00")
        );
    }
    // Current retrieval supplies the late authored date without treating the
    // recording date as the event date or requesting removed prose.
    let late = crate::services::retrieval::retrieve_vault_notes(
        &f.state,
        "expense report",
        20,
        None,
        &HashSet::new(),
        Default::default(),
    )
    .unwrap();
    assert!(late.iter().any(|item| item.excerpt.contains("September 8")));
}
