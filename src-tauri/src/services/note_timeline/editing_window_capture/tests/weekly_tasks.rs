use super::*;
use crate::services::evidence::{EvidenceSession, SearchRequest};

fn millis(date: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(date)
        .unwrap()
        .timestamp_millis() as u64
}

#[test]
fn weekly_task_evidence_tracks_checkbox_ranges_not_file_or_task_wording_edits() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.clock
        .store(millis("2026-09-06T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Work\n\n- [x] Archive old invoices\n- [x] Keep capitalization\n- [ ] Send renewal proposal\n- [ ] Ship patch\n- [x] Publish guide\n- [x] Review metrics\n\nPlanning a deployment.");
    f.seal();
    f.clock
        .store(millis("2026-09-09T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Work\n\n- [x] Archive old invoices\n- [X] Keep capitalization\n- [x] Send renewal proposal\n- [ ] Ship urgent patch\n- [x] Publish onboarding guide\n- [ ] Review metrics\n- [x] Close weekly report\n\nPlan to deploy Friday.");
    f.seal();
    // The final file write falls outside the requested week. The surviving
    // completion marker must retain its own Wednesday evidence nevertheless.
    f.clock
        .store(millis("2026-09-15T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Work\n\n- [x] Archive old invoices\n- [X] Keep capitalization\n- [x] Send renewal proposal to Mia\n- [ ] Ship urgent patch\n- [x] Publish onboarding guide\n- [ ] Review metrics\n- [x] Close weekly report\n\nUnrelated follow-up added next week.");
    f.seal();
    let raw = fs::read_to_string(&f.path).unwrap();
    let parsed = crate::note::parse_note(&raw);
    let body = parsed.body;
    let tasks: Vec<_> = f.state.notes_index.lock().unwrap().entries[&f.path]
        .tasks
        .iter()
        .map(|t| (t.text.clone(), t.completed))
        .collect();
    assert_eq!(
        tasks,
        vec![
            ("Archive old invoices".into(), true),
            ("Keep capitalization".into(), true),
            ("Send renewal proposal to Mia".into(), true),
            ("Ship urgent patch".into(), false),
            ("Publish onboarding guide".into(), true),
            ("Review metrics".into(), false),
            ("Close weekly report".into(), true),
        ],
        "real task parser separates checkboxes from prose and current status"
    );
    let after = millis("2026-09-07T00:00:00-06:00");
    let before = millis("2026-09-14T00:00:00-06:00");
    let mut request = SearchRequest {
        after: Some(after),
        before: Some(before),
        limit: Some(20),
        ..Default::default()
    };
    let mut session = EvidenceSession::default();
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
        // This lineage fixture exhaustively inspects every changed range in
        // separate bounded read sessions. A real agent selects necessary ranges
        // within one shared allowance; budget delivery has dedicated regressions.
        for id in ids {
            let mut reader = EvidenceSession::default();
            let mut discovery = request.clone();
            discovery.cursor = None;
            loop {
                let found = reader
                    .search(&f.state, None, &HashSet::new(), discovery.clone())
                    .unwrap();
                if found["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|item| item["evidenceId"] == id)
                {
                    break;
                }
                discovery.cursor = Some(
                    found["nextCursor"]
                        .as_str()
                        .expect("Selected fixture range must remain discoverable")
                        .into(),
                );
            }
            let (read, sources) = reader
                .read(&f.state, None, &HashSet::new(), &[id], false)
                .unwrap();
            let returned = read["items"].as_array().unwrap();
            assert_eq!(returned.len(), 1);
            for (citation, _, _) in sources {
                assert!(crate::services::evidence::validate_citation(
                    &f.state,
                    &citation,
                    None,
                    &HashSet::new()
                )
                .is_some());
            }
            items.extend(returned.iter().cloned());
        }
        match page["nextCursor"].as_str() {
            Some(cursor) => request.cursor = Some(cursor.into()),
            None => break,
        }
    }
    let marker_is_activity = |line: &str| {
        let marker = body.find(line).unwrap() + 3; // checked x, not task words
        items.iter().any(|i| {
            i["start"].as_u64().unwrap() as usize <= marker
                && marker < i["end"].as_u64().unwrap() as usize
        })
    };
    assert!(
        marker_is_activity("- [x] Send renewal proposal to Mia"),
        "Wednesday completion survives later wording edit: {items:?}"
    );
    assert!(
        marker_is_activity("- [x] Close weekly report"),
        "newly recorded complete task: {items:?}"
    );
    assert!(
        !marker_is_activity("- [x] Publish onboarding guide"),
        "wording edit cannot refresh an old completion marker: {items:?}"
    );
    assert!(
        !marker_is_activity("- [x] Archive old invoices"),
        "file edit cannot refresh an unchanged completed task: {items:?}"
    );
    assert!(
        items.iter().any(|i| i["supportingContext"]
            .as_str()
            .unwrap()
            .contains("Publish onboarding guide")),
        "wording edit remains visible as activity without claiming completion"
    );
    assert!(!items.iter().any(|i| i["excerpt"]
        .as_str()
        .unwrap()
        .contains("Unrelated follow-up")));
    for item in &items {
        let context = item["supportingContext"].as_str().unwrap();
        let task = &item["task"];
        if context.contains("Send renewal") || context.contains("Close weekly") {
            assert_eq!(task["currentStatus"], "completed", "{item}");
            assert_eq!(task["statusMarkerChangedInPeriod"], true, "{item}");
        } else if context.contains("Publish onboarding") {
            assert_eq!(task["currentStatus"], "completed", "{item}");
            assert_eq!(task["statusMarkerChangedInPeriod"], false, "{item}");
            assert_eq!(task["matchedRangeIncludesStatusMarker"], false, "{item}");
        } else if context.contains("Keep capitalization") {
            assert_eq!(task["currentStatus"], "completed", "{item}");
            assert_eq!(
                task["statusMarkerChangedInPeriod"], false,
                "changing x to X is not completing the task again: {item}"
            );
        } else if context.contains("Ship urgent") || context.contains("Review metrics") {
            assert_eq!(task["currentStatus"], "open", "{item}");
        }
    }
    if let Ok(output) = std::env::var("GNEAUX_TASK_EVIDENCE_OUTPUT") {
        fs::write(output, serde_json::to_string_pretty(&serde_json::json!({
            "id":"weekly_tasks_real_timeline", "question":"What tasks did I do this week? For this test, this week is September 7 through September 13, 2026, in America/Denver. Report what the notes establish about completion, not just what text was edited.",
            "resolvedPeriod":{"after":after,"before":before,"timezone":"America/Denver"},
            "sources":items,
            "expected":"Identify Send renewal proposal and Close weekly report as recorded complete in the period. Archive old invoices was already complete before the period. Keep capitalization only changed [x] to [X], so it also remains an older completion. Publish onboarding guide only had wording edited, so its old completion is not this week's accomplishment. Ship urgent patch and reopened Review metrics are incomplete. Planning prose is not a completed task. The later file write and added 'to Mia' wording do not move the checkbox's completion evidence out of the week. Do not claim these records independently prove real-world work dates."
        })).unwrap()).unwrap();
    }

    // Clearing history establishes an unknown baseline, not a new completion.
    f.state.note_timeline().clear_note_history(&f.note).unwrap();
    f.clock
        .store(millis("2026-09-10T12:00:00-06:00"), Ordering::SeqCst);
    f.save(&body.replace(
        "Publish onboarding guide",
        "Publish updated onboarding guide",
    ));
    f.seal();
    let mut baseline = EvidenceSession::default();
    let page = baseline
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                after: Some(after),
                before: Some(before),
                ..Default::default()
            },
        )
        .unwrap();
    let item = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["task"]["text"] == "Publish updated onboarding guide")
        .expect("wording activity remains visible");
    assert_eq!(item["task"]["currentStatus"], "completed");
    assert!(
        item["task"]["statusMarkerChangedInPeriod"].is_null(),
        "baseline cannot date the unchanged checkbox: {item}"
    );
}

#[test]
fn rewriting_a_checked_tasks_entire_description_is_not_a_new_completion() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.clock.store(1_000_000, Ordering::SeqCst);
    f.save("- [x] Old task");
    f.seal();
    f.clock.store(2_000_000, Ordering::SeqCst);
    f.save("- [x] Completely rewritten wording");
    f.seal();
    let mut session = EvidenceSession::default();
    let page = session
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                after: Some(1_500_000),
                before: Some(2_500_000),
                ..Default::default()
            },
        )
        .unwrap();
    let item = &page["items"][0];
    assert_eq!(item["task"]["currentStatus"], "completed");
    assert_eq!(
        item["task"]["statusMarkerChangedInPeriod"], false,
        "description replacement leaves the existing checkbox status intact: {item}"
    );
}

#[test]
fn restoring_a_checked_task_reports_restore_without_redating_its_marker() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let first = millis("2026-09-06T12:00:00-06:00");
    f.clock.store(first, Ordering::SeqCst);
    f.save("- [x] Archive records");
    f.seal();
    let selected = history_store::revisions(&f.state.note_timeline().runtime.store, &f.note)
        .unwrap()
        .into_iter()
        .find(|h| h.time_evidence.occurred_at_millis() == first)
        .unwrap()
        .identity;
    f.clock
        .store(millis("2026-09-09T12:00:00-06:00"), Ordering::SeqCst);
    f.save("- [ ] Archive records");
    f.seal();
    let timeline = f.state.note_timeline();
    let history = timeline.open_history_mode(f.note.clone());
    let preview = history.restore_preview(selected.as_str()).unwrap();
    history
        .confirm_restore(selected.as_str(), &preview.current_authored_content_hash)
        .unwrap();
    let mut session = EvidenceSession::default();
    let page = session
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                after: Some(1),
                before: Some(u64::MAX),
                ..Default::default()
            },
        )
        .unwrap();
    let item = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["task"]["matchedRangeIncludesStatusMarker"] == true)
        .expect("restored marker activity");
    let task = &item["task"];
    assert_eq!(task["currentStatus"], "completed");
    assert_eq!(task["statusMarkerRestoredInPeriod"], true);
    assert_eq!(
        task["statusMarkerTime"]["lastWallMillis"], first,
        "restore does not become the checkbox's latest authored change"
    );

    // A subsequent real checkbox change supersedes restoration as the latest
    // status event; retaining restore lineage cannot hide that new completion.
    let later = crate::time::current_time_millis().unwrap() + 60_000;
    f.clock.store(later, Ordering::SeqCst);
    f.save("- [ ] Archive records");
    f.seal();
    f.clock.store(later + 60_000, Ordering::SeqCst);
    f.save("- [x] Archive records");
    f.seal();
    let mut session = EvidenceSession::default();
    let page = session
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                after: Some(1),
                before: Some(u64::MAX),
                ..Default::default()
            },
        )
        .unwrap();
    let task = &page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["task"]["matchedRangeIncludesStatusMarker"] == true)
        .unwrap()["task"];
    assert_eq!(task["currentStatus"], "completed");
    assert_eq!(task["statusMarkerRestoredInPeriod"], false);
    assert_eq!(task["statusMarkerTime"]["lastWallMillis"], later + 60_000);
}

#[test]
fn task_checkbox_window_straddling_week_start_is_explicitly_uncertain() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let monday = millis("2026-09-07T00:00:00-06:00");
    f.clock.store(monday - 86_400_000, Ordering::SeqCst);
    f.save("- [ ] Boundary task");
    f.seal();
    f.clock.store(monday - 2_000, Ordering::SeqCst);
    f.save("- [x] Boundary task");
    f.clock.store(monday + 2_000, Ordering::SeqCst);
    f.save("- [x] Boundary task\nFollow-up");
    f.seal();
    let mut session = EvidenceSession::default();
    let page = session
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                after: Some(monday),
                before: Some(monday + 86_400_000),
                ..Default::default()
            },
        )
        .unwrap();
    let item = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["task"]["matchedRangeIncludesStatusMarker"] == true)
        .unwrap();
    let task = &item["task"];
    assert_eq!(task["currentStatus"], "completed");
    assert!(
        task["statusMarkerChangedInPeriod"].is_null(),
        "overlap cannot assert a definite in-period status change"
    );
    assert_eq!(
        task["statusMarkerTimeUncertain"], true,
        "overlap cannot establish which side of Monday the checkbox changed"
    );
    assert_eq!(task["statusMarkerTime"]["minWallMillis"], monday - 2_000);
    assert_eq!(task["statusMarkerTime"]["maxWallMillis"], monday + 2_000);
    if let Ok(output) = std::env::var("GNEAUX_TASK_BOUNDARY_EVIDENCE_OUTPUT") {
        let id = item["evidenceId"].as_str().unwrap().to_string();
        let (read, _) = session
            .read(&f.state, None, &HashSet::new(), &[id], false)
            .unwrap();
        fs::write(output, serde_json::to_string_pretty(&serde_json::json!({
            "id":"weekly_task_boundary", "question":"What tasks did I complete since Monday, September 7? The reporting period here is September 7, 2026, in America/Denver. Can this task definitely count as completed in that period?",
            "resolvedPeriod":{"after":monday,"before":monday+86_400_000,"timezone":"America/Denver"},
            "sources":read["items"],
            "expected":"Boundary task is currently recorded complete, but its retained status-change window straddles Sunday/Monday by two seconds on each side. Do not count it as definitely completed during Monday's reporting period or choose a precise completion instant. State uncertainty; overlap alone is insufficient."
        })).unwrap()).unwrap();
    }
}
