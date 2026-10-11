use super::*;
use crate::services::evidence::{EvidenceSession, ReadRequest, SearchMode, SearchRequest};
use serde_json::{json, Value};

fn millis(date: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(date)
        .unwrap()
        .timestamp_millis() as u64
}

fn read_all(f: &Fixture, session: &mut EvidenceSession, mut request: SearchRequest) -> Vec<Value> {
    let mut items = Vec::new();
    loop {
        let page = session
            .search(&f.state, None, &HashSet::new(), request.clone())
            .unwrap();
        let ids: Vec<String> = page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["evidenceId"].as_str().unwrap().into())
            .collect();
        for selection in ids.chunks(8) {
            let pages = f.read_evidence_pages(
                session,
                ReadRequest {
                    evidence_ids: selection.to_vec(),
                    ..Default::default()
                },
            );
            items.extend(
                pages
                    .into_iter()
                    .flat_map(|page| page["items"].as_array().unwrap().clone()),
            );
        }
        match page["nextCursor"].as_str() {
            Some(cursor) => request.cursor = Some(cursor.into()),
            None => break,
        }
    }
    items
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
    let mut session = EvidenceSession::default();
    let mut items = read_all(
        &f,
        &mut session,
        SearchRequest {
            query: "sent|resolved|revised|old brochure|expense report".into(),
            mode: SearchMode::Regex,
            after: Some(after),
            before: Some(before),
            limit: Some(20),
            ..Default::default()
        },
    );
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
    // Exhaustively inspecting every word's lineage above is a fixture operation.
    // In a fresh bounded run, select the two action excerpts before searching
    // for late reports. Both capabilities must fit the same shared allowance.
    let mut focused = EvidenceSession::default();
    let mut request = SearchRequest {
        query: "sent|resolved".into(),
        mode: SearchMode::Regex,
        after: Some(after),
        before: Some(before),
        ..Default::default()
    };
    let mut selected: Vec<String> = Vec::new();
    loop {
        let found = focused
            .search(&f.state, None, &HashSet::new(), request.clone())
            .unwrap();
        selected.extend(
            found["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|item| {
                    item["preview"]
                        .as_str()
                        .is_some_and(|text| text.contains("sent") || text.contains("resolved"))
                })
                .map(|item| item["evidenceId"].as_str().unwrap().to_owned()),
        );
        match found["nextCursor"].as_str() {
            Some(cursor) => request.cursor = Some(cursor.into()),
            None => break,
        }
    }
    assert_eq!(
        selected.len(),
        2,
        "Select supported actions, not every unchanged word"
    );
    let action_pages = f.read_evidence_pages(
        &mut focused,
        ReadRequest {
            evidence_ids: selected,
            ..Default::default()
        },
    );
    assert_eq!(
        action_pages
            .iter()
            .map(|page| page["items"].as_array().unwrap().len())
            .sum::<usize>(),
        2
    );
    // Current-content retrieval supplies the late authored event date without
    // requesting removed prose or treating the recording date as the event date.
    let late = read_all(
        &f,
        &mut focused,
        SearchRequest {
            query: "expense report".into(),
            mode: SearchMode::Literal,
            ..Default::default()
        },
    );
    assert!(
        late.iter()
            .any(|i| i["excerpt"].as_str().unwrap().contains("September 8")),
        "current passage supplies the authored event date: {late:?}"
    );
    items.extend(late);
    if let Ok(path) = std::env::var("GNEAUX_PROSE_EVIDENCE_OUTPUT") {
        fs::write(path, serde_json::to_string_pretty(&json!({
            "id":"prose_real_timeline", "question":"What tasks did I do this week? This week means September 7 through September 13, 2026, in America/Denver.",
            "resolvedPeriod":{"after":after,"before":before,"timezone":"America/Denver"}, "sources":items,
            "expected":"Include sending Atlas quote September 9 and submitting expense report September 8. Cache incident is recorded resolved but its event date is unknown, so do not count it as definitely completed this week from the sentence's edit time. Old brochure is outside the week. The later revised word and retrospective recording do not change the explicit event dates. Cite supporting current passages."
        })).unwrap()).unwrap();
    }
}
