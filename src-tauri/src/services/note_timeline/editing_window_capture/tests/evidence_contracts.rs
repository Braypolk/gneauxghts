use super::*;
use crate::services::evidence::{
    query::ActivityRange, EvidenceSession, ReadRequest, SearchRequest,
};
use serde_json::json;

fn ms(s: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .unwrap()
        .timestamp_millis() as u64
}
fn week() -> ActivityRange {
    ActivityRange {
        start: "2026-09-21".into(),
        end: "2026-09-28".into(),
        timezone: Some("America/Denver".into()),
    }
}

#[test]
fn evidence_contracts_reconstruct_changed_lines_then_check_current_status() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.clock
        .store(ms("2026-09-10T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Project\n\n- [ ] Ancient untouched backlog\n\nOriginal plan.");
    f.seal();
    f.clock
        .store(ms("2026-09-23T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Project\n\n- [ ] Ancient untouched backlog\n\n- [ ] Send Larissa the report\n\nPrepare revised onboarding plan.\n\nExperimental idea, later removed.");
    f.seal();
    f.clock
        .store(ms("2026-09-29T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Project\n\n- [ ] Ancient untouched backlog\n\n- [x] Send Larissa the report\n\nOnboarding plan replaced by a vendor review.");
    f.seal();
    let excluded = HashSet::new();
    let mut session = EvidenceSession::default();
    let mut request = SearchRequest {
        include_history: true,
        activity_range: Some(week()),
        limit: Some(2),
        ..Default::default()
    };
    let mut passages = Vec::new();
    let mut citations = Vec::new();
    loop {
        let page = session
            .search(&f.state, None, &excluded, request.clone())
            .unwrap();
        session.remember_search(&page, request.clone(), false);
        let ids: Vec<String> = page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["evidenceId"].as_str().unwrap().into())
            .collect();
        let mut read = ReadRequest {
            evidence_ids: ids,
            activity_range: Some(week()),
            ..Default::default()
        };
        loop {
            let (result, sources) = session
                .read_request(&f.state, None, &excluded, read)
                .unwrap();
            for item in result["items"].as_array().unwrap() {
                assert_eq!(item["sourceKind"], "retained_note_change");
                assert_eq!(item["activitySupport"]["status"], "supported", "{item}");
                passages.push(item["excerpt"].as_str().unwrap().to_string());
            }
            citations.extend(sources.into_iter().map(|s| s.0));
            if let Some(cursor) = result["nextCursor"].as_str() {
                read = ReadRequest {
                    cursor: Some(cursor.into()),
                    ..Default::default()
                };
            } else {
                break;
            }
        }
        if let Some(cursor) = page["nextCursor"].as_str() {
            request = session.resume_search(cursor, false).unwrap();
        } else {
            break;
        }
    }
    let changed = passages.join("\n");
    assert!(
        !changed.contains("Ancient untouched"),
        "unchanged backlog cannot inherit the note's date"
    );
    assert!(
        changed.contains("Send Larissa")
            && changed.contains("onboarding")
            && changed.contains("Experimental idea")
    );
    assert!(
        changed.contains("Original plan"),
        "removed lines are retained changes too"
    );
    for c in &citations {
        assert!(
            crate::services::evidence::validate_citation(&f.state, c, None, &excluded).is_some()
        );
    }
    let mut current = EvidenceSession::default();
    let mut args = ReadRequest {
        note_id: Some(f.note.as_str().into()),
        include_provenance: Some(false),
        activity_range: Some(week()),
        ..Default::default()
    };
    let mut current_text = String::new();
    loop {
        let (page, _) = current
            .read_request(&f.state, None, &excluded, args)
            .unwrap();
        for item in page["items"].as_array().unwrap() {
            current_text.push_str(item["excerpt"].as_str().unwrap());
            assert_eq!(item["activitySupport"]["status"], "not_established");
        }
        if let Some(cursor) = page["nextCursor"].as_str() {
            args = ReadRequest {
                cursor: Some(cursor.into()),
                ..Default::default()
            };
        } else {
            break;
        }
    }
    assert!(current_text.contains("[x] Send Larissa") && current_text.contains("vendor review"));
    assert!(!current_text.contains("Experimental idea"));
    let (outside, _) = session
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                evidence_ids: vec![citations[0].id.clone()],
                activity_range: Some(ActivityRange {
                    start: "2026-09-01".into(),
                    end: "2026-09-02".into(),
                    timezone: Some("UTC".into()),
                }),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        outside["items"][0]["activitySupport"]["status"],
        "not_established"
    );
    let denied = HashSet::from([f.note.as_str().to_string()]);
    assert!(citations
        .iter()
        .all(
            |c| crate::services::evidence::validate_citation(&f.state, c, None, &denied).is_none()
        ));
    let mut forged = citations[0].clone();
    forged.excerpt = "Ancient untouched backlog".into();
    assert!(
        crate::services::evidence::validate_citation(&f.state, &forged, None, &excluded).is_none()
    );
    f.state.note_timeline().clear_note_history(&f.note).unwrap();
    assert!(
        citations
            .iter()
            .all(
                |c| crate::services::evidence::validate_citation(&f.state, c, None, &excluded)
                    .is_none()
            ),
        "cleared history invalidates retained evidence"
    );
}

#[test]
fn evidence_contracts_read_continuation_revalidates_and_preserves_valid_batch_items() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.save(&format!(
        "{}\n\n{}\n\n{}",
        "Alpha ".repeat(400),
        "Beta ".repeat(400),
        "Gamma ".repeat(400)
    ));
    f.seal();
    let mut session = EvidenceSession::default();
    let none = HashSet::new();
    let (first, sources) = session
        .read_request(
            &f.state,
            None,
            &none,
            ReadRequest {
                note_id: Some(f.note.as_str().into()),
                include_provenance: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(!sources.is_empty());
    let cursor = first["nextCursor"]
        .as_str()
        .expect("large note must continue");
    assert_eq!(first["delivery"]["complete"], false);
    let excluded = HashSet::from([f.note.as_str().to_string()]);
    let denied = session
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                cursor: Some(cursor.into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(denied.payload()["code"], "stale_evidence");
    assert_eq!(denied.payload()["recovery"]["action"], "search_again");
    // A bad selection cannot discard an independent valid item.
    let mut independent = EvidenceSession::default();
    let found = independent
        .search(
            &f.state,
            None,
            &none,
            SearchRequest {
                query: "Alpha".into(),
                mode: crate::services::evidence::SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    let id = found["items"][0]["evidenceId"].as_str().unwrap();
    let (read, sources) = independent
        .read_request(
            &f.state,
            None,
            &none,
            serde_json::from_value(
                json!({"evidence_ids":["invented",id],"include_provenance":false}),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(read["failures"].as_array().unwrap().len(), 1);
}

#[test]
fn evidence_contracts_assistant_transcripts_are_not_primary_evidence() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let path = f.path.parent().unwrap().join("Prior answer.md");
    let raw="---\ngneauxghts:\n  id: CHAT-REGRESSION\n  kind: chatTranscript\n  chat_id: regression\n  part: 1\n---\n\nCANARY_PRIOR_ANSWER: I completed every task last week.\n";
    fs::write(&path, raw).unwrap();
    let indexed = crate::index::build_indexed_note(&path, raw, ms("2026-09-23T12:00:00Z"));
    assert_eq!(
        indexed.document_kind,
        crate::note::DocumentKind::ChatTranscript
    );
    f.state
        .upsert_managed_chat_projection(path, indexed)
        .unwrap();
    let mut session = EvidenceSession::default();
    let excluded = HashSet::new();
    let found = session
        .search(
            &f.state,
            None,
            &excluded,
            SearchRequest {
                query: "CANARY_PRIOR_ANSWER".into(),
                mode: crate::services::evidence::SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(found["items"].as_array().unwrap().is_empty());
    assert!(session
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                note_id: Some("CHAT-REGRESSION".into()),
                ..Default::default()
            }
        )
        .is_err());
}

#[test]
fn evidence_contracts_clock_discontinuity_never_claims_definite_activity() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let clock = f.continuous();
    f.save("first");
    clock.elapsed.store(100, Ordering::SeqCst);
    clock.wall.store(900_000, Ordering::SeqCst);
    f.save("endpoint");
    f.seal();
    let mut session = EvidenceSession::default();
    let excluded = HashSet::new();
    let page = session
        .search(
            &f.state,
            None,
            &excluded,
            SearchRequest {
                include_history: true,
                activity_range: Some(week()),
                ..Default::default()
            },
        )
        .unwrap();
    let ids = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["evidenceId"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert!(
        !ids.is_empty(),
        "uncertain windows remain candidates, even outside their recorded clock bounds"
    );
    let (read, _) = session
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                evidence_ids: ids,
                activity_range: Some(week()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(!read["items"].as_array().unwrap().is_empty());
    for item in read["items"].as_array().unwrap() {
        assert_eq!(item["activitySupport"]["status"], "uncertain");
    }
}

#[test]
fn evidence_contracts_activity_pages_separate_retrieval_from_delivery() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let mut allowed = HashSet::new();
    for i in 0..3 {
        let note = note_persistence::persist_note_session_with_outcome(
            &f.state,
            format!("Activity page {i}"),
            format!("Recorded work {i}"),
            None,
        )
        .unwrap()
        .unwrap();
        let id = note.note_id.unwrap();
        f.state
            .note_timeline()
            .finalize_editor_capture(&NoteIdentity::new(&id))
            .unwrap();
        allowed.insert(id);
    }
    let mut session = EvidenceSession::default();
    let mut request = SearchRequest {
        include_history: true,
        limit: Some(1),
        note_ids: Some(allowed.iter().cloned().collect()),
        activity_range: Some(ActivityRange {
            start: "2020-01-01".into(),
            end: "2030-01-01".into(),
            timezone: Some("UTC".into()),
        }),
        ..Default::default()
    };
    let mut seen = HashSet::new();
    for page_number in 0..3 {
        let original = request.clone();
        let resolved = session.normalize_request(&mut request).unwrap().unwrap();
        let page = session
            .activity_page(&f.state, Some(&allowed), &HashSet::new(), request, resolved)
            .unwrap();
        assert_eq!(
            page["coverage"]["complete"], true,
            "pagination is not a retrieval gap"
        );
        assert_eq!(page["delivery"]["complete"], page_number == 2);
        seen.insert(page["items"][0]["noteId"].as_str().unwrap().to_string());
        session.remember_search(&page, original, true);
        if page_number == 2 {
            assert!(page["nextCursor"].is_null());
            break;
        }
        let cursor = page["nextCursor"].as_str().unwrap();
        assert!(
            session.resume_search(cursor, false).is_err(),
            "another tool cannot consume the cursor"
        );
        request = session.resume_search(cursor, true).unwrap();
    }
    assert_eq!(seen, allowed);
}

#[test]
fn evidence_contracts_appending_lines_does_not_promote_the_existing_final_line() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    f.clock
        .store(ms("2026-09-10T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Project\n\nInitial proposal: weekly exports.");
    f.seal();
    f.clock
        .store(ms("2026-09-23T12:00:00-06:00"), Ordering::SeqCst);
    f.save("# Project\n\nInitial proposal: weekly exports.\n\n- [ ] Arrange vendor review");
    f.seal();
    let mut session = EvidenceSession::default();
    let page = session
        .search(
            &f.state,
            None,
            &HashSet::new(),
            SearchRequest {
                include_history: true,
                activity_range: Some(week()),
                limit: Some(20),
                ..Default::default()
            },
        )
        .unwrap();
    let previews = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["preview"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(previews.contains("Arrange vendor review"));
    assert!(
        !previews.contains("weekly exports"),
        "A final newline is not newly authored work: {previews}"
    );
}

#[test]
fn evidence_contracts_compact_reads_preserve_proofs_without_expanding_lineage() {
    let _guard = crate::test_support::lock_test_env();
    let f = Fixture::new();
    let mut text = String::new();
    for index in 0..8 {
        f.clock.store(
            ms("2026-09-23T12:00:00-06:00") + index * 1000,
            Ordering::SeqCst,
        );
        text.push_str(&format!("Recorded commitment {index}.\n\n"));
        f.save(&text);
        f.seal();
    }
    let excluded = HashSet::new();
    let mut compact = EvidenceSession::default();
    let (page, sources) = compact
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                note_id: Some(f.note.as_str().into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        page["delivery"]["complete"], true,
        "short current content must not require paging its entire lineage: {page}"
    );
    assert!(page["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["excerpt"]
            .as_str()
            .is_some_and(|s| s.contains("Recorded commitment 7"))));
    assert!(sources
        .iter()
        .all(|(c, _, _)| crate::services::evidence::validate_citation(
            &f.state, c, None, &excluded
        )
        .is_some()));

    let mut expanded = EvidenceSession::default();
    let (proof_page, _) = expanded
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                note_id: Some(f.note.as_str().into()),
                include_provenance: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(proof_page["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| !i["provenance"].is_null()));
    assert!(
        proof_page.to_string().len() > page.to_string().len(),
        "optional lineage must remain available, outside the compact default"
    );

    let found = compact
        .search(
            &f.state,
            None,
            &excluded,
            SearchRequest {
                include_history: true,
                activity_range: Some(week()),
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    let id = found["items"][0]["evidenceId"].as_str().unwrap();
    let (history, citations) = compact
        .read_request(
            &f.state,
            None,
            &excluded,
            ReadRequest {
                evidence_ids: vec![id.into()],
                activity_range: Some(week()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        history["items"][0]["activitySupport"]["status"],
        "supported"
    );
    assert!(!history["items"][0]["historical"].is_null());
    assert!(citations[0].0.historical.is_some());
    assert!(crate::services::evidence::validate_citation(
        &f.state,
        &citations[0].0,
        None,
        &excluded
    )
    .is_some());
}
