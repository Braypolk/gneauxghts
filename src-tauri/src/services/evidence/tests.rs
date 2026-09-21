use super::*;
use crate::{app::EventBus, semantic::SemanticState};

#[test]
fn evidence_fixture_scopes_pages_reads_and_invalidates_current_passages() {
    let _guard = crate::test_support::lock_test_env();
    let data = crate::test_support::TestDir::new("evidence-data");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    let notes = crate::test_support::TestDir::new("evidence-notes");
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    let state = AppState::new(
        SemanticState::new_disabled("disabled"),
        EventBus::disabled(),
    )
    .unwrap();
    let fixture: Value = serde_json::from_str(include_str!("fixtures.json")).unwrap();
    let mut id_map = HashMap::new();
    for n in fixture["notes"].as_array().unwrap() {
        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            n["title"].as_str().unwrap().into(),
            n["body"].as_str().unwrap().into(),
            None,
        )
        .unwrap()
        .unwrap();
        id_map.insert(
            n["id"].as_str().unwrap().to_string(),
            saved.note_id.unwrap(),
        );
    }
    state
        .lexical
        .sync_with_notes_index(&state.notes_index.lock().unwrap().entries)
        .unwrap();
    if let Ok(output) = std::env::var("GNEAUX_EVAL_OUTPUT") {
        evaluate_fixture(&state, &fixture, &id_map, &output);
    }
    let excluded = HashSet::from([id_map["private"].clone()]);
    for q in fixture["questions"].as_array().unwrap() {
        let mut session = EvidenceSession::default();
        let mut request = SearchRequest {
            query: q["query"].as_str().unwrap().into(),
            limit: Some(1),
            mode: SearchMode::Lexical,
            ..Default::default()
        };
        let mut found = HashSet::new();
        loop {
            let page = session
                .search(&state, None, &excluded, request.clone())
                .unwrap();
            for item in page["items"].as_array().unwrap() {
                found.insert(item["noteId"].as_str().unwrap().to_string());
            }
            if let Some(cursor) = page["nextCursor"].as_str() {
                request.cursor = Some(cursor.into());
            } else {
                break;
            }
        }
        for expected in q["expected"].as_array().unwrap() {
            assert!(
                found.contains(&id_map[expected.as_str().unwrap()]),
                "missing {expected} for {q}"
            );
        }
        assert!(!found.contains(&id_map["private"]));
        if q["expected"].as_array().unwrap().is_empty() {
            assert!(found.is_empty());
        }
    }
    // Literal and regex operate on exact Markdown, including newline and Unicode.
    for (query, mode) in [
        ("# Launch\n\nMaya", SearchMode::Literal),
        (r"# Launch\s+Maya", SearchMode::Regex),
    ] {
        let mut session = EvidenceSession::default();
        let page = session
            .search(
                &state,
                None,
                &excluded,
                SearchRequest {
                    query: query.into(),
                    mode,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(page["items"][0]["noteId"], id_map["orion"]);
    }
    let mut missing = EvidenceSession::default();
    missing
        .search(
            &state,
            None,
            &excluded,
            SearchRequest {
                query: "notthereyet".into(),
                mode: SearchMode::Lexical,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(missing.is_current(&state, None, &excluded));
    let mut session = EvidenceSession::default();
    let mut request = SearchRequest {
        query: "Maya".into(),
        limit: Some(1),
        ..Default::default()
    };
    let page = session
        .search(&state, None, &excluded, request.clone())
        .unwrap();
    assert_eq!(page["coverage"]["semantic"], "disabled");
    assert!(page["coverage"]["gaps"]
        .as_array()
        .unwrap()
        .iter()
        .any(|gap| gap.as_str().unwrap().contains("lexical search only")));
    let id = page["items"][0]["evidenceId"].as_str().unwrap().to_string();
    let (read, sources) = session
        .read(&state, None, &excluded, &[id.clone()], false)
        .unwrap();
    assert!(read["items"][0]["excerpt"]
        .as_str()
        .unwrap()
        .contains("Maya"));
    assert!(!sources.is_empty());
    let validation_count = session.admitted.len();
    let charged = session.used();
    let (again, _) = session
        .read(&state, None, &excluded, &[id.clone()], false)
        .unwrap();
    assert_eq!(again["items"][0]["excerpt"], read["items"][0]["excerpt"]);
    assert_eq!(
        session.admitted.len(),
        validation_count,
        "Repeated reads duplicated validation work"
    );
    assert!(
        session.used() > charged,
        "Repeated payload still consumes model context"
    );
    assert!(session.is_current(&state, None, &excluded));
    assert!(!session.is_current(&state, None, &HashSet::from([sources[0].0.note_id.clone()])));
    // A plain re-read must not replace proofs already delivered with provenance.
    let (_, proven_sources) = session
        .read(&state, None, &excluded, &[id.clone()], true)
        .unwrap();
    assert!(!proven_sources[0].0.revisions.is_empty());
    assert!(session.is_current(&state, None, &excluded));
    session
        .read(&state, None, &excluded, &[id.clone()], false)
        .unwrap();
    assert_eq!(session.admitted.len(), validation_count);
    state
        .note_timeline()
        .clear_note_history(&crate::services::note_timeline::NoteIdentity::new(
            &sources[0].0.note_id,
        ))
        .unwrap();
    assert!(
        !session.is_current(&state, None, &excluded),
        "Cleared proof survived after a plain re-read"
    );
    request.cursor = page["nextCursor"].as_str().map(str::to_string);
    fs::write(&sources[0].1, "removed current passage").unwrap();
    assert!(session.read(&state, None, &excluded, &[id], false).is_err());
    if request.cursor.is_some() {
        assert!(session.search(&state, None, &excluded, request).is_err());
    }
    assert!(!session.is_current(&state, None, &excluded));
    assert!(!missing.is_current(&state, None, &excluded));
    crate::state::set_notes_root_override(None).unwrap();
}

#[test]
fn budgets_preserve_utf8_and_rank_fusion_rewards_agreement() {
    assert_eq!(bounded("é安全", 3), "é");
    assert!(reciprocal_rank(5) * 2.0 > reciprocal_rank(0));
    let mut bad = SearchRequest {
        after: Some(2),
        before: Some(1),
        ..Default::default()
    };
    assert!(resolve_period(&mut bad).is_err());
}

#[test]
fn shared_worker_budget_does_not_copy_admitted_context_or_search_transcripts() {
    let mut parent = EvidenceSession::default();
    parent.admit_context("parent context", 100).unwrap();
    parent.searches.insert(
        "private-search".into(),
        ("version".into(), "binding".into(), vec![], json!({})),
    );
    let mut child = parent.fork();
    assert!(child.searches.is_empty());
    assert!(child.admitted.is_empty());
    child
        .admit_context(&"x".repeat(EVIDENCE_BYTES), EVIDENCE_BYTES)
        .unwrap();
    assert!(parent.admit_context("more", 4).is_err());
    assert_eq!(parent.used(), EVIDENCE_BYTES);
}

#[test]
fn long_paragraph_slices_reach_tail_without_splitting_unicode() {
    let text = format!("{} unique-tail-needle", "é語".repeat(2000));
    let slices = passage_slices(&text);
    assert!(slices.len() > 1);
    assert_eq!(slices.concat(), text);
    assert!(slices.last().unwrap().contains("unique-tail-needle"));
    assert!(slices.iter().all(|s| s.len() <= 2400));
}

#[test]
fn local_week_uses_calendar_midnight_and_explicit_half_open_bounds() {
    use chrono::{Datelike, Local, TimeZone};
    let mut request = SearchRequest {
        period: Some("this_week".into()),
        ..Default::default()
    };
    let period = resolve_period(&mut request).unwrap().unwrap();
    let start = Local
        .timestamp_millis_opt(period["after"].as_u64().unwrap() as i64)
        .unwrap();
    assert_eq!(start.weekday(), chrono::Weekday::Mon);
    assert_eq!(
        start.time(),
        chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
    );
    assert!(request.before.unwrap() > request.after.unwrap());
}

#[test]
fn lexical_normalization_is_resolved_back_to_exact_current_markdown() {
    let body = "# Context\n\n  First line\n\tCafé second line\n";
    let (start, end) = current_text_range(body, "First line Café second line").unwrap();
    assert_eq!(&body[start..end], "First line\n\tCafé second line");
    assert!(current_text_range("repeat\nrepeat", "repeat").is_none());
    assert!(current_text_range("old prose removed", "invented prose").is_none());
}

#[test]
fn period_worker_has_no_inherited_undated_ids() {
    let mut parent = EvidenceSession::default();
    parent.candidates.insert(
        "outside-period".into(),
        Candidate {
            task: None,
            citation: PassageCitation {
                id: "outside-period".into(),
                note_id: "n".into(),
                content_hash: "h".into(),
                location: "body".into(),
                start: 0,
                end: 1,
                excerpt: "x".into(),
                revisions: vec![],
            },
            path: PathBuf::new(),
            title: String::new(),
            section: String::new(),
            score: 1.0,
            provenance: None,
            context: String::new(),
        },
    );
    let selected = parent.fork();
    let mut receiver = EvidenceSession::default();
    receiver.accept_selected(&selected, &["outside-period".into()]);
    assert!(receiver.candidates.contains_key("outside-period"));
    let mut worker = parent.fork_for_period(true);
    assert!(worker.candidates.is_empty());
    worker.admit_context("shared", 6).unwrap();
    assert_eq!(parent.used(), 6);
}

// Offline contract comparison. The reformulation lane is scripted, not a live
// LLM worker benchmark; provider tokens and semantic quality remain unmeasured.
fn evaluate_fixture(
    state: &AppState,
    fixture: &Value,
    ids: &HashMap<String, String>,
    output: &str,
) {
    let excluded = HashSet::from([ids["private"].clone()]);
    let mut results = Vec::new();
    for question in fixture["questions"]
        .as_array()
        .unwrap()
        .iter()
        .chain(fixture["semanticQuestions"].as_array().unwrap())
    {
        let query = question["query"].as_str().unwrap();
        let expected = question["expectedPassages"].as_array().unwrap();
        let terms: Vec<_> = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| s.len() > 1)
            .map(str::to_lowercase)
            .collect();
        let baseline: Vec<_> = state
            .notes_index
            .lock()
            .unwrap()
            .entries
            .values()
            .filter(|n| !excluded.contains(&n.note_id))
            .filter_map(|n| {
                n.paragraphs
                    .iter()
                    .find(|p| terms.iter().any(|t| p.text_lower.contains(t)))
                    .map(|p| p.text.clone())
            })
            .collect();
        let baseline_hits = expected
            .iter()
            .filter(|e| {
                baseline
                    .iter()
                    .any(|t| t.contains(e["text"].as_str().unwrap()))
            })
            .count();
        for lane in ["direct_lexical", "scripted_reformulation"] {
            let start = std::time::Instant::now();
            let parent = EvidenceSession::default();
            let mut session = if lane == "scripted_reformulation" {
                parent.fork()
            } else {
                parent
            };
            let queries: Vec<&str> = if lane == "scripted_reformulation" {
                question["reformulations"]
                    .as_array()
                    .map(|qs| qs.iter().filter_map(Value::as_str).collect())
                    .unwrap_or(vec![query])
            } else {
                vec![query]
            };
            let mut returned = Vec::new();
            let mut valid = 0;
            let mut coverage = Vec::new();
            for q in queries {
                let page = session
                    .search(
                        state,
                        None,
                        &excluded,
                        SearchRequest {
                            query: q.into(),
                            mode: SearchMode::Lexical,
                            limit: Some(20),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                coverage.push(page["coverage"].clone());
                let selected: Vec<String> = page["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|i| i["evidenceId"].as_str().unwrap().into())
                    .take(8)
                    .collect();
                let (_, sources) = session
                    .read(state, None, &excluded, &selected, false)
                    .unwrap();
                for (c, _, _) in sources {
                    valid += usize::from(validate_citation(state, &c, None, &excluded).is_some());
                    returned.push(c);
                }
            }
            let hits = expected
                .iter()
                .filter(|e| {
                    returned.iter().any(|c| {
                        c.note_id == ids[e["note"].as_str().unwrap()]
                            && c.excerpt.contains(e["text"].as_str().unwrap())
                    })
                })
                .count();
            results.push(json!({"query":query,"lane":lane,"expectedPassages":expected.iter().map(|e| &e["id"]).collect::<Vec<_>>(),"expectedCount":expected.len(),"passageHits":hits,"baselinePassageHits":baseline_hits,"returnedCitations":returned.len(),"returnedPassages":returned.iter().map(|c| &c.excerpt).collect::<Vec<_>>(),"validCitations":valid,"evidenceBytes":session.used(),"estimatedEvidenceTokens":session.used().div_ceil(4),"providerTokens":null,"latencyMillis":start.elapsed().as_secs_f64()*1000.0,"coverage":coverage}));
        }
    }
    fs::write(output, serde_json::to_string_pretty(&json!({"method":"offline lexical + scripted reformulation; not live model delegation","semanticModel":"disabled","results":results})).unwrap()).unwrap();
}

#[test]
fn navigation_maps_unicode_duplicate_ranges_after_hidden_title() {
    let raw = "# Example\n\n☕ repeated\nrepeated";
    let start = raw.rfind("repeated").unwrap();
    let passage = PassageCitation {
        id: "p".into(),
        note_id: "n".into(),
        content_hash: canonical_content_hash(raw),
        location: "body".into(),
        start,
        end: start + 8,
        excerpt: "repeated".into(),
        revisions: vec![],
    };
    let (markdown, selection) = editor_passage_navigation(raw, "Example", &passage);
    assert_eq!(markdown, "☕ repeated\nrepeated");
    assert_eq!(selection.unwrap(), json!({"anchor":11,"head":19}));
}

#[test]
fn local_week_preserves_spring_and_fall_dst_boundaries() {
    if std::env::var_os("GNEAUX_DST_PROBE").is_none() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "services::evidence::tests::local_week_preserves_spring_and_fall_dst_boundaries",
            ])
            .env("TZ", "America/New_York")
            .env("GNEAUX_DST_PROBE", "1")
            .status()
            .unwrap();
        assert!(status.success());
        return;
    }
    use chrono::{Datelike, Local, TimeZone};
    for (month, day, elapsed_hours) in [(3, 8, 155), (11, 1, 157)] {
        let now = Local.with_ymd_and_hms(2026, month, day, 12, 0, 0).unwrap();
        let start = local_week_start(now).unwrap();
        assert_eq!(start.weekday(), chrono::Weekday::Mon);
        assert_eq!(now.signed_duration_since(start).num_hours(), elapsed_hours);
    }
}
