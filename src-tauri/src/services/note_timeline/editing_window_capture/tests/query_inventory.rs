use super::*;
use crate::services::evidence::{EvidenceSession, SearchRequest};
use crate::services::note_timeline::test_fixtures::{load, HistoryFixture};
use serde_json::json;

#[test]
fn query_inventory_groups_surviving_activity_and_validates_freshness() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let instant = |s: &str| {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .timestamp_millis() as u64
    };
    f.clock
        .store(instant("2026-09-05T12:00:00-06:00"), Ordering::SeqCst);
    f.save("Old unchanged paragraph.\n\nProject instructions.");
    f.seal();
    f.clock
        .store(instant("2026-09-10T12:00:00-06:00"), Ordering::SeqCst);
    f.save("Old unchanged paragraph.\n\nProject instructions.\n\nNew review findings.\n\nNew delivery notes.");
    f.seal();
    f.clock
        .store(instant("2026-09-12T12:00:00-06:00"), Ordering::SeqCst);
    f.save("Old unchanged paragraph.\n\nProject instructions.\n\nNew review findings.\n\nNew delivery notes.\n\nSecond review observation.");
    f.seal();
    f.clock
        .store(instant("2026-09-15T12:00:00-06:00"), Ordering::SeqCst);
    f.save("Old unchanged paragraph.\n\nProject instructions.\n\nNew review findings.\n\nNew delivery notes.\n\nSecond review observation.\n\nLater appendix.");
    f.seal();
    let request: SearchRequest =
        serde_json::from_value(json!({"activity_range":{"start":"2026-09-07","end":"2026-09-14"}}))
            .unwrap();
    let mut session = EvidenceSession::default();
    session.anchor.instant = "2026-09-14T16:00:00Z".parse().unwrap();
    session.anchor.timezone = "America/Denver".into();
    let resolved = session
        .normalize_request(&mut request.clone())
        .unwrap()
        .unwrap();
    let token = tokio_util::sync::CancellationToken::new();
    token.cancel();
    let mut cancelled = request.clone();
    cancelled.cancelled = Some(token);
    assert!(
        session
            .inventory(&f.state, None, &HashSet::new(), cancelled, resolved.clone())
            .unwrap_err()
            .code
            == crate::services::tool_outcome::FailureCode::Cancelled
    );
    let inventory = session
        .inventory(&f.state, None, &HashSet::new(), request.clone(), resolved)
        .unwrap();
    assert!(inventory.complete, "{:?}", inventory.gaps);
    assert_eq!(inventory.rows.len(), 1);
    assert!(!inventory.rows[0].uncertain);
    assert!(inventory.rows[0].excerpt.contains("Second"));
    assert!(!inventory.rows[0].excerpt.contains("Later"));
    let starts: HashSet<_> = inventory.rows[0].activity.iter().map(|a| a.start).collect();
    assert!(starts.contains(&instant("2026-09-12T12:00:00-06:00")));
    assert!(session.is_current(&f.state, None, &HashSet::new()));
    assert!(!session.is_current(
        &f.state,
        None,
        &HashSet::from([inventory.rows[0].note_id.clone()])
    ));
    // Ordinary cursor search shares the new binding and remains current across pages.
    let mut normal = EvidenceSession::default();
    normal.anchor = session.anchor.clone();
    let mut request = request;
    request.limit = Some(1);
    let first = normal
        .search(&f.state, None, &HashSet::new(), request.clone())
        .unwrap();
    assert!(normal.is_current(&f.state, None, &HashSet::new()));
    request.cursor = first["nextCursor"].as_str().map(str::to_owned);
    assert!(request.cursor.is_some());
    normal
        .search(&f.state, None, &HashSet::new(), request)
        .unwrap();
    // Budget-starved read is distinct from no evidence and cannot be retried unchanged.
    let ids = vec![first["items"][0]["evidenceId"]
        .as_str()
        .unwrap()
        .to_string()];
    normal.admit_context(&"x".repeat(24000), 24000).unwrap();
    let limited = normal
        .read(&f.state, None, &HashSet::new(), &ids, true)
        .unwrap_err()
        .payload();
    assert_eq!(limited["code"], "evidence_budget");
    assert_eq!(limited["retryable"], false);
    assert_eq!(
        limited["recovery"]["action"],
        "finish_with_available_evidence"
    );
    f.clock
        .store(instant("2026-09-16T12:00:00-06:00"), Ordering::SeqCst);
    f.save("Replaced all content.");
    f.seal();
    assert!(!session.is_current(&f.state, None, &HashSet::new()));
}

#[test]
fn query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass() {
    for dense in [false, true] {
        let (f, ids) = load(if dense {
            HistoryFixture::InventoryDense
        } else {
            HistoryFixture::InventorySparse
        });
        let allowed = ids.into_iter().collect::<HashSet<_>>();
        assert_eq!(allowed.len(), if dense { 20 } else { 55 });
        let mut request: SearchRequest = serde_json::from_value(
            json!({"activity_range":{"start":"2020-01-01","end":"2030-01-02"}}),
        )
        .unwrap();
        let mut seen = HashSet::new();
        let mut pages = 0;
        let mut first_cursor = None;
        let mut session = EvidenceSession::default();
        loop {
            let resolved = session
                .normalize_request(&mut request.clone())
                .unwrap()
                .unwrap();
            let result = session
                .inventory(
                    &f.state,
                    Some(&allowed),
                    &HashSet::new(),
                    request.clone(),
                    resolved.clone(),
                )
                .unwrap();
            assert!(!result.rows.is_empty());
            assert_eq!(
                session.retained_search_count(),
                1,
                "continuation must reuse its original search"
            );
            if pages == 0 {
                if dense {
                    assert!(
                        result.rows.len() < 50,
                        "dense page must stop before the row limit"
                    );
                }
                assert!(result.budgets["stopReasons"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r
                        == if dense {
                            "inventory_page_bytes"
                        } else {
                            "display_rows"
                        }));
            }
            let serialized_bytes = serde_json::to_vec(&result.rows).unwrap().len();
            assert!(serialized_bytes <= 256000, "{serialized_bytes}");
            assert!(
                serialized_bytes
                    <= result.budgets["inventory"]["usedBytes"].as_u64().unwrap() as usize
            );
            assert!(session.is_current(&f.state, Some(&allowed), &HashSet::new()));
            for row in &result.rows {
                assert!(allowed.contains(&row.note_id));
                assert!(seen.insert(row.note_id.clone()), "duplicate inventory note");
            }
            pages += 1;
            assert!(pages < 10);
            if let Some(cursor) = result.continuation {
                assert!(!result.complete);
                if first_cursor.is_none() {
                    first_cursor = Some(cursor.clone());
                }
                request.cursor = Some(cursor);
                let excluded = HashSet::from([allowed.iter().next().unwrap().clone()]);
                assert!(session
                    .inventory(
                        &f.state,
                        Some(&allowed),
                        &excluded,
                        request.clone(),
                        resolved
                    )
                    .is_err());
            } else {
                assert!(result.complete, "{:?}", result.gaps);
                break;
            }
        }
        assert!(pages > 1);
        assert_eq!(seen, allowed);
        request.cursor = first_cursor;
        let id = allowed.iter().next().unwrap();
        f.state
            .note_timeline()
            .clear_note_history(&NoteIdentity::new(id))
            .unwrap();
        let resolved = session
            .normalize_request(&mut request.clone())
            .unwrap()
            .unwrap();
        assert!(
            session
                .inventory(&f.state, Some(&allowed), &HashSet::new(), request, resolved)
                .is_err(),
            "History-only changes must invalidate same-session inventory offsets"
        );
    }
}

#[test]
fn query_inventory_nine_dense_notes_do_not_spend_model_evidence() {
    let (f, ids) = load(HistoryFixture::NineDense);
    let expected = ids.into_iter().collect::<HashSet<_>>();
    assert_eq!(expected.len(), 9);
    let request: SearchRequest = serde_json::from_value(
        json!({"activity_range":{"start":"1970-01-01","end":"2030-01-02","timezone":"UTC"}}),
    )
    .unwrap();
    let mut session = EvidenceSession::default();
    session.admit_context(&"x".repeat(24000), 24000).unwrap();
    let resolved = session
        .normalize_request(&mut request.clone())
        .unwrap()
        .unwrap();
    let result = session
        .inventory(
            &f.state,
            Some(&expected),
            &HashSet::new(),
            request,
            resolved,
        )
        .unwrap();
    assert!(result.complete, "{:?}", result.gaps);
    assert!(result.continuation.is_none());
    assert_eq!(result.budgets["modelEvidence"]["usedBytes"], 24000);
    assert!(result.budgets["inventory"]["usedBytes"].as_u64().unwrap() < 256000);
    assert_eq!(result.rows.len(), 9);
    assert_eq!(
        result
            .rows
            .iter()
            .map(|row| row.note_id.clone())
            .collect::<HashSet<_>>(),
        expected
    );
    assert!(session.is_current(&f.state, Some(&expected), &HashSet::new()));
}

#[test]
fn activity_discovery_composes_with_provenance_reads_and_older_open_tasks() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let instant = |s: &str| {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .timestamp_millis() as u64
    };
    f.clock
        .store(instant("2026-09-05T12:00:00Z"), Ordering::SeqCst);
    f.save("Project kickoff.");
    f.seal();
    f.clock
        .store(instant("2026-09-10T12:00:00Z"), Ordering::SeqCst);
    f.save("Project kickoff.\n\nReviewed the delivery draft on September 10, 2026.");
    f.seal();
    let task = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Earlier commitments".into(),
        "- [ ] Send the invoice after approval".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let excluded_note = note_persistence::persist_note_session_with_outcome(
        &f.state,
        "Private commitments".into(),
        "- [ ] Private task canary".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let excluded = HashSet::from([excluded_note.note_id.unwrap()]);
    let mut session = EvidenceSession::default();
    let request: SearchRequest = serde_json::from_value(json!({"activity_range":{
        "start":"2026-09-07","end":"2026-09-14","timezone":"UTC"
    }}))
    .unwrap();
    let resolved = session
        .normalize_request(&mut request.clone())
        .unwrap()
        .unwrap();
    let page = session
        .activity_page(&f.state, None, &excluded, request.clone(), resolved.clone())
        .unwrap();
    assert_eq!(page["notesReturned"], 1);
    // A valid activity request can fail before the allowance reaches zero:
    // the remaining bytes must fit the whole page, including its envelope.
    let mut nearly_full = EvidenceSession::default();
    nearly_full
        .admit_context(&"x".repeat(23900), 23900)
        .unwrap();
    let failure = nearly_full
        .activity_page(&f.state, None, &excluded, request.clone(), resolved.clone())
        .unwrap_err()
        .payload();
    assert_eq!(failure["code"], "evidence_budget");
    assert_eq!(failure["retryable"], false);
    assert_eq!(
        failure["recovery"]["action"],
        "finish_with_available_evidence"
    );
    // A rejected page does not consume the remaining bytes.
    assert_eq!(
        nearly_full
            .admit_context(&"x".repeat(100), 100)
            .unwrap()
            .len(),
        100
    );
    let id = page["items"][0]["evidenceId"].as_str().unwrap().to_string();
    let (read, sources) = session
        .read(&f.state, None, &excluded, &[id], true)
        .unwrap();
    assert_eq!(sources.len(), 1);
    assert!(read["items"][0]["excerpt"]
        .as_str()
        .unwrap()
        .contains("Reviewed"));
    assert!(!read["items"][0]["provenance"].is_null());
    // The next part of the objective has a different scope: no inherited date
    // filter hides an unfinished commitment from an older/different note.
    let tasks = session
        .search(
            &f.state,
            None,
            &excluded,
            SearchRequest {
                query: "- [ ]".into(),
                mode: crate::services::evidence::SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(tasks["items"].as_array().unwrap().len(), 1);
    assert_eq!(tasks["items"][0]["noteId"], task.note_id.unwrap());
    let task_id = tasks["items"][0]["evidenceId"]
        .as_str()
        .unwrap()
        .to_string();
    let (read, _) = session
        .read(&f.state, None, &excluded, &[task_id], false)
        .unwrap();
    assert!(read["items"][0]["excerpt"]
        .as_str()
        .unwrap()
        .contains("Send the invoice"));
    assert!(session.is_current(&f.state, None, &excluded));
    // Activity previews now consume the same model evidence allowance as other
    // capabilities; they cannot bypass it through an inventory-specific path.
    let remaining = session.admit_context(&"x".repeat(24000), 24000).unwrap();
    assert!(remaining.len() < 24000);
    assert!(
        session
            .activity_page(&f.state, None, &excluded, request, resolved)
            .unwrap_err()
            .code
            == crate::services::tool_outcome::FailureCode::EvidenceBudget
    );
}
