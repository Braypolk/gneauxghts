use super::*;
use crate::services::evidence::{EvidenceSession, SearchRequest};
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
    let request: SearchRequest = serde_json::from_value(json!({"interpretation":{"target":"notes","operation":"list","subject":null,"time":[{"role":"text_activity","relation":"within","period":{"kind":"calendar","unit":"week","offset":-1}}]}})).unwrap();
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
    assert!(session
        .inventory(&f.state, None, &HashSet::new(), cancelled, resolved.clone())
        .unwrap_err()
        .contains("cancelled"));
    let (inventory, _, sources) = session
        .inventory(&f.state, None, &HashSet::new(), request.clone(), resolved)
        .unwrap();
    assert!(inventory.complete, "{:?}", inventory.gaps);
    assert_eq!(inventory.rows.len(), 1);
    assert!(!inventory.rows[0].uncertain);
    assert!(inventory.rows[0].excerpt.contains("Second"));
    assert!(!inventory.rows[0].excerpt.contains("Later"));
    assert_eq!(sources.len(), 1);
    let starts: HashSet<_> = inventory.rows[0].activity.iter().map(|a| a.start).collect();
    assert!(starts.contains(&instant("2026-09-12T12:00:00-06:00")));
    assert!(session.is_current(&f.state, None, &HashSet::new()));
    assert!(!session.is_current(
        &f.state,
        None,
        &HashSet::from([sources[0].0.note_id.clone()])
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
    let (limited, _) = normal
        .read(&f.state, None, &HashSet::new(), &ids, true)
        .unwrap();
    assert_eq!(limited["truncationReason"], "run_budget");
    assert_eq!(limited["retryable"], false);
    assert_eq!(limited["status"], "limited");
    f.clock
        .store(instant("2026-09-16T12:00:00-06:00"), Ordering::SeqCst);
    f.save("Replaced all content.");
    f.seal();
    assert!(!session.is_current(&f.state, None, &HashSet::new()));
}

#[test]
fn query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass() {
    let _guard = crate::test_support::lock_test_env();
    for dense in [false, true] {
        let f = Fixture::new();
        let mut allowed = HashSet::new();
        for i in 0..55 {
            let note = note_persistence::persist_note_session_with_outcome(
                &f.state,
                format!("Inventory {i}"),
                format!(
                    "Unique inventory content {i}. {}",
                    if dense {
                        "Long but current note content. ".repeat(400)
                    } else {
                        String::new()
                    }
                ),
                None,
            )
            .unwrap()
            .unwrap();
            allowed.insert(note.note_id.unwrap());
        }
        let mut request: SearchRequest = serde_json::from_value(json!({"interpretation":{"target":"notes","operation":"count","time":[{"role":"text_activity","relation":"within","period":{"kind":"dates","start":"2020-01-01","end":"2030-01-01"}}]}})).unwrap();
        let mut seen = HashSet::new();
        let mut pages = 0;
        let mut first_cursor = None;
        loop {
            let mut session = EvidenceSession::default();
            let resolved = session
                .normalize_request(&mut request.clone())
                .unwrap()
                .unwrap();
            let (result, _, sources) = session
                .inventory(
                    &f.state,
                    Some(&allowed),
                    &HashSet::new(),
                    request.clone(),
                    resolved.clone(),
                )
                .unwrap();
            assert!(!result.rows.is_empty());
            if pages == 0 {
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
            let delivered = sources
                .iter()
                .map(|(c, path, title)| crate::chat::ChatSource {
                    kind: "note".into(),
                    note_id: Some(c.note_id.clone()),
                    note_path: Some(path.to_string_lossy().into()),
                    title: title.clone(),
                    excerpt: c.excerpt.clone(),
                    url: None,
                    anchor: Some(c.id.clone()),
                    revision: None,
                    passage: Some(c.clone()),
                })
                .collect::<Vec<_>>();
            let serialized_bytes = serde_json::to_vec(&(&result.rows, delivered))
                .unwrap()
                .len();
            assert!(serialized_bytes <= 256000, "{serialized_bytes}");
            assert!(
                serialized_bytes
                    <= result.budgets["inventory"]["usedBytes"].as_u64().unwrap() as usize
            );
            assert!(session.is_current(&f.state, Some(&allowed), &HashSet::new()));
            for source in sources {
                assert!(allowed.contains(&source.0.note_id));
                seen.insert(source.0.note_id);
            }
            pages += 1;
            assert!(pages < 10);
            if let Some(cursor) = result.continuation {
                assert!(!result.complete);
                if first_cursor.is_none() {
                    first_cursor = Some(cursor.clone());
                }
                request.cursor = Some(cursor);
                let mut stale = EvidenceSession::default();
                let excluded = HashSet::from([allowed.iter().next().unwrap().clone()]);
                assert!(stale
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
        let mut changed = EvidenceSession::default();
        let resolved = changed
            .normalize_request(&mut request.clone())
            .unwrap()
            .unwrap();
        assert!(
            changed
                .inventory(&f.state, Some(&allowed), &HashSet::new(), request, resolved)
                .is_err(),
            "History-only changes must invalidate cross-run inventory offsets"
        );
    }
}

#[test]
fn query_inventory_nine_dense_notes_do_not_spend_model_evidence() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let mut expected = HashSet::new();
    for i in 0..9 {
        let title = format!("Dense inventory {i}");
        let mut body = "Background context that was already present. ".repeat(80);
        let note = note_persistence::persist_note_session_with_outcome(
            &f.state,
            title.clone(),
            body.clone(),
            None,
        )
        .unwrap()
        .unwrap();
        expected.insert(note.note_id.clone().unwrap());
        for j in 0..12 {
            f.clock.store(1_000_000 + j * 10_000, Ordering::SeqCst);
            body.push_str(&format!("\n\nRecorded finding {j}."));
            note_persistence::persist_note_session_with_outcome(
                &f.state,
                title.clone(),
                body.clone(),
                note.path.clone(),
            )
            .unwrap();
            f.state
                .note_timeline()
                .finalize_editor_capture(&NoteIdentity::new(note.note_id.as_ref().unwrap()))
                .unwrap();
        }
    }
    let request: SearchRequest = serde_json::from_value(json!({"interpretation":{"target":"notes","operation":"list","time":[{"role":"text_activity","relation":"within","period":{"kind":"dates","start":"1970-01-01","end":"2030-01-01"}}]}})).unwrap();
    let mut session = EvidenceSession::default();
    session.admit_context(&"x".repeat(24000), 24000).unwrap();
    let resolved = session
        .normalize_request(&mut request.clone())
        .unwrap()
        .unwrap();
    let (result, _, sources) = session
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
    assert_eq!(sources.len(), 9);
    assert_eq!(
        sources
            .iter()
            .map(|s| s.0.note_id.clone())
            .collect::<HashSet<_>>(),
        expected
    );
    assert!(session.is_current(&f.state, Some(&expected), &HashSet::new()));
    for (citation, path, title) in sources {
        let body = std::fs::read_to_string(path).unwrap();
        assert!(
            crate::services::evidence::editor_passage_navigation(&body, &title, &citation)
                .1
                .is_some()
        );
    }
}
