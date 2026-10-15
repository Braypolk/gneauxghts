use super::*;
mod coverage;

#[test]
fn search_freshness_survives_unrelated_legacy_note_identity_assignment() {
    let vault = crate::test_support::TestVault::new("evidence-legacy-identity");
    crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Supporting note".into(),
        "Supporting passage".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let legacy = vault.notes.path().join("Legacy.md");
    fs::write(&legacy, "Unrelated legacy content").unwrap();
    vault
        .state
        .upsert_note_indexes(
            legacy.clone(),
            crate::index::build_indexed_note(&legacy, "Unrelated legacy content", 1),
        )
        .unwrap();
    assert!(vault
        .state
        .indexed_note_identity(&legacy)
        .unwrap()
        .is_none());
    let mut session = EvidenceSession::default();
    session
        .search(
            &vault.state,
            None,
            &HashSet::new(),
            SearchRequest {
                query: "Supporting".into(),
                mode: SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(session.is_current(&vault.state, None, &HashSet::new()));
    let original = fs::read(&legacy).unwrap();
    vault
        .state
        .note_timeline()
        .observe(
            crate::services::note_timeline::VaultObservation::external_edit(
                legacy.clone(),
                2,
                Some(1),
            ),
        )
        .unwrap();
    vault
        .state
        .upsert_note_indexes(
            legacy.clone(),
            crate::index::build_indexed_note(&legacy, "Unrelated legacy content", 1),
        )
        .unwrap();
    assert!(vault
        .state
        .indexed_note_identity(&legacy)
        .unwrap()
        .is_some());
    assert_eq!(fs::read(&legacy).unwrap(), original);
    assert!(
        session.is_current(&vault.state, None, &HashSet::new()),
        "Assigning identity to an unchanged unrelated legacy note is not changed search content"
    );
}

#[test]
fn search_freshness_tracks_content_instead_of_file_timestamps() {
    let vault = crate::test_support::TestVault::new("evidence-unchanged-timestamp");
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Unchanged".into(),
        "Supporting passage".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let path = saved.path.unwrap();
    let mut session = EvidenceSession::default();
    session
        .search(
            &vault.state,
            None,
            &HashSet::new(),
            SearchRequest {
                query: "Supporting".into(),
                mode: SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(session.is_current(&vault.state, None, &HashSet::new()));
    let original = fs::read(&path).unwrap();
    let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
    let changed_time =
        file.metadata().unwrap().modified().unwrap() + std::time::Duration::from_secs(1);
    file.set_times(fs::FileTimes::new().set_modified(changed_time))
        .unwrap();
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(
        session.is_current(&vault.state, None, &HashSet::new()),
        "Identical canonical bytes must remain current after a timestamp-only change"
    );
    // Same-length content changes cannot hide behind the original timestamp.
    let changed = String::from_utf8(original)
        .unwrap()
        .replace("Supporting", "Contradict");
    fs::write(&path, changed).unwrap();
    file.set_times(fs::FileTimes::new().set_modified(changed_time))
        .unwrap();
    assert!(!session.is_current(&vault.state, None, &HashSet::new()));
}

#[test]
fn expiring_search_cursors_keeps_earlier_scope_freshness_checks() {
    let vault = crate::test_support::TestVault::new("retired-search-scope");
    let state = &vault.state;
    let mut notes = Vec::new();
    for title in ["Earlier research", "Later research"] {
        notes.push(
            crate::commands::note_persistence::persist_note_session_with_outcome(
                state,
                title.into(),
                "Original contents".into(),
                None,
            )
            .unwrap()
            .unwrap(),
        );
    }
    let mut session = EvidenceSession::default();
    let excluded = HashSet::new();
    for i in 0..33 {
        session
            .search(
                state,
                None,
                &excluded,
                SearchRequest {
                    query: format!("missing-{i}"),
                    mode: SearchMode::Literal,
                    note_ids: Some(vec![notes[usize::from(i > 0)].note_id.clone().unwrap()]),
                    ..Default::default()
                },
            )
            .unwrap();
    }
    assert_eq!(session.searches.len(), 32);
    assert_eq!(session.retired_search_scopes.len(), 1);
    assert!(session.is_current(state, None, &excluded));
    fs::write(notes[0].path.as_ref().unwrap(), "Changed earlier scope").unwrap();
    assert!(!session.is_current(state, None, &excluded));
}

#[test]
fn evidence_fixture_scopes_pages_reads_and_invalidates_current_passages() {
    let vault = crate::test_support::TestVault::new("evidence");
    let state = &vault.state;
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
    // Search cursors occupy a bounded cache, not a cumulative research quota.
    // Adding another query keeps the newest cursor and evicts the oldest.
    let mut capacity = EvidenceSession::default();
    for index in 0..31 {
        capacity
            .search(
                &state,
                None,
                &HashSet::new(),
                SearchRequest {
                    query: format!("unfindable-capacity-{index}"),
                    mode: SearchMode::Literal,
                    ..Default::default()
                },
            )
            .unwrap();
    }
    let mut last = SearchRequest {
        query: ".".into(),
        mode: SearchMode::Regex,
        limit: Some(1),
        ..Default::default()
    };
    let first = capacity
        .search(&state, None, &HashSet::new(), last.clone())
        .unwrap();
    last.cursor = Some(first["nextCursor"].as_str().unwrap().to_string());
    capacity.configure_allowance(Some(62_080));
    let next = capacity
        .search(&state, None, &HashSet::new(), last.clone())
        .unwrap();
    assert_eq!(next["items"].as_array().unwrap().len(), 1);
    assert_eq!(next["coverage"]["budget"]["evidenceBytes"], 62_080);
    assert_eq!(next["coverage"]["budget"]["usedBytes"], capacity.used());
    last.cursor = None;
    assert!(capacity.search(&state, None, &HashSet::new(), last).is_ok());

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
fn resized_evidence_allowance_keeps_shared_spending_and_parent_reserve() {
    let mut parent = EvidenceSession::default();
    parent.configure_allowance(Some(62_080));
    let mut worker = parent.fork_for_period(false);
    let delivered = worker.admit_context(&"x".repeat(100_000), 100_000).unwrap();
    assert_eq!(delivered.len(), 50_080);
    assert!(worker.admit_context("more", 4).is_err());
    assert_eq!(parent.admit_context("handoff", 7).unwrap(), "handoff");
    parent.configure_allowance(Some(13_824));
    assert!(parent.admit_context("more", 4).is_err());
    assert!(worker.admit_context("more", 4).is_err());
    parent.configure_allowance(None);
    assert!(parent.admit_context("more", 4).is_err());
    assert_eq!(
        parent.used(),
        50_087,
        "Capacity refresh must never forgive spending"
    );
}

#[test]
fn adaptive_allowance_delivers_more_than_24kb_with_bounded_truthful_read_pages() {
    let vault = crate::test_support::TestVault::new("adaptive-read-budget");
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Large synthetic record".into(),
        "A synthetic project records its review decisions and remaining tasks.\n\n".repeat(600),
        None,
    )
    .unwrap()
    .unwrap();
    let mut session = EvidenceSession::default();
    session.configure_allowance(Some(250_000));
    let mut request = ReadRequest {
        note_id: saved.note_id,
        ..Default::default()
    };
    let mut read_bytes = 0;
    loop {
        let (page, _) = session
            .read_request(&vault.state, None, &HashSet::new(), request)
            .unwrap();
        assert!(page.to_string().len() <= READ_BYTES);
        assert_eq!(
            page["remainingEvidenceBytes"].as_u64().unwrap() as usize + session.used(),
            250_000
        );
        read_bytes += page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["excerpt"].as_str().map_or(0, str::len))
            .sum::<usize>();
        let Some(cursor) = page["nextCursor"].as_str() else {
            break;
        };
        request = ReadRequest {
            cursor: Some(cursor.into()),
            ..Default::default()
        };
    }
    assert!(read_bytes > EVIDENCE_BYTES);
    assert!(session.used() > EVIDENCE_BYTES);
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
                historical: None,
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
    receiver.accept_selected(&selected, &["outside-period".into()], &[]);
    assert!(receiver.candidates.contains_key("outside-period"));
    assert!(
        receiver.admitted.is_empty(),
        "Undelivered selections must not be admitted as evidence"
    );
    let mut worker = parent.fork_for_period(true);
    assert!(worker.candidates.is_empty());
    worker.admit_context("shared", 6).unwrap();
    assert_eq!(parent.used(), 6);
}

#[test]
fn navigation_maps_unicode_duplicate_ranges_after_hidden_title() {
    let raw = "# Example\n\n☕ repeated\nrepeated";
    let start = raw.rfind("repeated").unwrap();
    let passage = PassageCitation {
        historical: None,
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
fn read_budget_never_charges_passages_discarded_by_response_overhead() {
    let vault = crate::test_support::TestVault::new("read-budget");
    let state = &vault.state;
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &state,
        "Budget project".into(),
        format!("# Project\n\n{}", "Review vendor options. ".repeat(65)),
        None,
    )
    .unwrap()
    .unwrap();
    for remaining in (100..5000).step_by(100) {
        let mut session = EvidenceSession::default();
        let used_before = EVIDENCE_BYTES - remaining;
        session.budget.used.store(used_before, Ordering::SeqCst);
        let result = session.read_request(
            &state,
            None,
            &HashSet::new(),
            ReadRequest {
                note_id: saved.note_id.clone(),
                include_provenance: Some(false),
                ..Default::default()
            },
        );
        match result {
            Err(error) => {
                assert_eq!(error.code, FailureCode::EvidenceBudget, "{error}");
                assert_eq!(
                    session.used(),
                    used_before,
                    "Undelivered read consumed allowance at {remaining} remaining bytes"
                );
                assert!(
                    session.admitted.is_empty(),
                    "Undelivered citations must not become admitted"
                );
                assert!(
                    !session
                        .delivered_guidance
                        .pending(&[json!({"excerpt":"later"})])
                        .is_empty(),
                    "A failed delivery must not consume the interpretation contract"
                );
            }
            Ok((payload, citations)) => {
                let items = payload["items"].as_array().unwrap();
                assert_eq!(items.len(), citations.len());
                assert!(
                    payload.to_string().len() <= remaining,
                    "Response exceeds allowance"
                );
                assert!(
                    payload.to_string().len() <= READ_BYTES,
                    "Response exceeds page capacity"
                );
            }
        }
    }
}

#[test]
fn research_and_mixed_read_pages_preserve_deliverable_evidence_within_budget() {
    let vault = crate::test_support::TestVault::new("research-budget");
    let state = &vault.state;
    crate::commands::note_persistence::persist_note_session_with_outcome(
        &state,
        "Vendor review".into(),
        "Confirm vendor review with Larissa.".into(),
        None,
    )
    .unwrap()
    .unwrap();
    state
        .lexical
        .sync_with_notes_index(&state.notes_index.lock().unwrap().entries)
        .unwrap();
    let mut initial = EvidenceSession::default();
    let discovery = initial
        .search(
            &state,
            None,
            &HashSet::new(),
            SearchRequest {
                query: "Larissa".into(),
                mode: SearchMode::Literal,
                ..Default::default()
            },
        )
        .unwrap();
    let id = discovery["items"][0]["evidenceId"]
        .as_str()
        .unwrap()
        .to_string();
    let mut partials = 0;
    for research in [false, true] {
        for remaining in (100..=READ_BYTES).step_by(50) {
            let mut session = EvidenceSession::default();
            session.candidates = initial.candidates.clone();
            session
                .budget
                .used
                .store(EVIDENCE_BYTES - remaining, Ordering::SeqCst);
            let before = session.used();
            let result = if research {
                session.read_research(
                    &state,
                    None,
                    &HashSet::new(),
                    &[id.clone()],
                    None,
                    vec!["coverage_incomplete".into()],
                )
            } else {
                session.read(
                    &state,
                    None,
                    &HashSet::new(),
                    &[id.clone(), "unknown-evidence-id".into()],
                    false,
                )
            };
            match result {
                Err(_) => {
                    assert_eq!(
                        session.used(),
                        before,
                        "Failed page charged undelivered evidence"
                    );
                    assert!(session.admitted.is_empty());
                }
                Ok((page, sources)) => {
                    assert_eq!(
                        sources.len(),
                        1,
                        "A valid selected passage must remain deliverable"
                    );
                    assert!(page.to_string().len() <= remaining);
                    assert!(session.used() - before >= page.to_string().len());
                    assert_eq!(
                        page["items"][0]["excerpt"],
                        "Confirm vendor review with Larissa."
                    );
                    if research {
                        assert_eq!(page["status"], "partial");
                        assert!(page["nextCursor"].is_null());
                        assert!(page["remainingEvidenceIds"].as_array().unwrap().is_empty());
                    } else if !page["failures"].as_array().unwrap().is_empty() {
                        partials += 1;
                        assert_eq!(page["status"], "partial");
                        assert_eq!(page["delivery"]["complete"], false);
                    } else {
                        assert!(page["nextCursor"].is_string());
                        let used = session.used();
                        let next = session
                            .read_request(
                                &state,
                                None,
                                &HashSet::new(),
                                ReadRequest {
                                    cursor: page["nextCursor"].as_str().map(str::to_string),
                                    ..Default::default()
                                },
                            )
                            .unwrap_err();
                        assert_eq!(next.payload()["recovery"]["action"], "correct_request");
                        assert_eq!(session.used(), used);
                    }
                }
            }
        }
    }
    assert!(
        partials > 0,
        "Mixed reads did not deliver a valid passage alongside the explicit failure"
    );
}

#[test]
fn operation_snapshots_reduce_reads_and_never_authorize_a_changed_note() {
    let vault = crate::test_support::TestVault::new("evidence-snapshot");
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Long".into(),
        "x".repeat(24_000),
        None,
    )
    .unwrap()
    .unwrap();
    let id = saved.note_id.unwrap();
    SNAPSHOT_READS.with(|n| n.set(0));
    // The former per-slice construction path loaded canonical bytes each time.
    for _ in 0..10 {
        CanonicalSnapshot::load(&vault.state, &id).unwrap();
    }
    let repeated = SNAPSHOT_READS.with(|n| n.replace(0));
    let mut snapshots = HashMap::new();
    let mut candidates = Vec::new();
    for offset in (0..24_000).step_by(2400) {
        candidates.push(
            cached_candidate(
                &vault.state,
                &mut snapshots,
                &id,
                &"x".repeat(2400),
                "body",
                "Current",
                1.0,
                Some(offset),
            )
            .unwrap(),
        );
    }
    assert_eq!(repeated, 10);
    assert_eq!(SNAPSHOT_READS.with(|n| n.get()), 1);
    assert!(
        validate_citation(&vault.state, &candidates[0].citation, None, &HashSet::new()).is_some()
    );
    let mut session = EvidenceSession::default();
    let (page, _) = session
        .read_request(
            &vault.state,
            None,
            &HashSet::new(),
            ReadRequest {
                note_id: Some(id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    let cursor = page["nextCursor"].as_str().unwrap().to_string();
    let continuation = session.read_continuations[&cursor].clone();
    for index in 0..127 {
        session
            .read_continuations
            .insert(format!("held-{index}"), continuation.clone());
    }
    assert!(session
        .read_request(
            &vault.state,
            None,
            &HashSet::new(),
            ReadRequest {
                cursor: Some(cursor),
                ..Default::default()
            }
        )
        .is_ok());
    assert!(session
        .read_request(
            &vault.state,
            None,
            &HashSet::new(),
            ReadRequest {
                note_id: Some(id),
                ..Default::default()
            }
        )
        .is_err());
    let raw = fs::read_to_string(saved.path.as_ref().unwrap()).unwrap();
    fs::write(
        saved.path.unwrap(),
        raw.replace(&"x".repeat(24_000), "Changed"),
    )
    .unwrap();
    assert!(
        validate_citation(&vault.state, &candidates[0].citation, None, &HashSet::new()).is_none()
    );
}

#[test]
fn hybrid_composition_merges_agreement_widens_allowed_scope_and_reports_failure() {
    let vault = crate::test_support::TestVault::new("evidence-hybrid");
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Hybrid".into(),
        "alpha common\n\nomega semantic".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let id = saved.note_id.unwrap();
    let ids = HashSet::from([id.clone()]);
    let item = |path: &str, text: &str| crate::semantic::SemanticChunkMatch {
        note_path: path.into(),
        note_title: "Hybrid".into(),
        section_label: "Body".into(),
        excerpt: text.into(),
        match_text: text.into(),
        score: 1.0,
        start_line: 1,
        end_line: 1,
        document_kind: DocumentKind::Note,
        block_anchor: None,
    };
    let mut snapshots = HashMap::new();
    let lexical = cached_candidate(
        &vault.state,
        &mut snapshots,
        &id,
        "alpha common",
        "body",
        "Body",
        reciprocal_rank(0),
        None,
    )
    .unwrap();
    let mut candidates = vec![lexical.clone()];
    let mut semantic = "ready".to_string();
    let mut gaps = Vec::new();
    let mut widths = Vec::new();
    collect_semantic_candidates(
        &vault.state,
        &SearchRequest::default(),
        &ids,
        &mut snapshots,
        &mut candidates,
        &mut semantic,
        &mut gaps,
        |width| {
            widths.push(width);
            if width == 64 {
                return Ok((0..64).map(|_| item("excluded.md", "private")).collect());
            }
            Ok(vec![
                item(saved.path.as_ref().unwrap(), "alpha common"),
                item(saved.path.as_ref().unwrap(), "omega semantic"),
                item(saved.path.as_ref().unwrap(), "stale semantic bytes"),
            ])
        },
    )
    .unwrap();
    assert_eq!(widths, vec![64, 256]);
    assert_eq!(candidates.len(), 2);
    assert!(candidates[0].score > lexical.score);
    assert_eq!(candidates[1].citation.excerpt, "omega semantic");
    let mut bounded_widths = Vec::new();
    collect_semantic_candidates(
        &vault.state,
        &SearchRequest::default(),
        &ids,
        &mut snapshots,
        &mut candidates,
        &mut semantic,
        &mut gaps,
        |width| {
            bounded_widths.push(width);
            Ok((0..width).map(|_| item("excluded.md", "private")).collect())
        },
    )
    .unwrap();
    assert_eq!(bounded_widths, vec![64, 256, 1024, WORK_LIMIT]);
    assert_eq!(candidates.len(), 2);
    assert!(gaps
        .iter()
        .any(|gap| gap == "Semantic candidate coverage is incomplete"));
    let retained = candidates.len();
    collect_semantic_candidates(
        &vault.state,
        &SearchRequest::default(),
        &ids,
        &mut snapshots,
        &mut candidates,
        &mut semantic,
        &mut gaps,
        |_| Err("provider unavailable".into()),
    )
    .unwrap();
    assert_eq!(candidates.len(), retained);
    assert_eq!(semantic, "error");
    assert!(gaps
        .iter()
        .any(|gap| gap.contains("lexical results remain")));
}

#[test]
fn read_guidance_is_budgeted_once_and_reintroduced_for_independent_workers() {
    let vault = crate::test_support::TestVault::new("read-guidance");
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Delivery".into(),
        "- [ ] Ship @due(2026-10-09)".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let mut session = EvidenceSession::default();
    let read = ReadRequest {
        note_id: saved.note_id,
        ..Default::default()
    };
    let (first, _) = session
        .read_request(&vault.state, None, &HashSet::new(), read.clone())
        .unwrap();
    let guidance = first["interpretationGuidance"].as_array().unwrap();
    assert_eq!(
        guidance.len(),
        3,
        "Source scope, prose and current task deadline interpretation"
    );
    assert!(first.to_string().len() <= READ_BYTES);
    assert!(session.used() >= first.to_string().len());
    let (second, _) = session
        .read_request(&vault.state, None, &HashSet::new(), read.clone())
        .unwrap();
    assert!(second.get("interpretationGuidance").is_none());
    let before = session.used();
    let mut worker = session.fork();
    let (worker_page, _) = worker
        .read_request(&vault.state, None, &HashSet::new(), read)
        .unwrap();
    assert_eq!(
        worker_page["interpretationGuidance"],
        first["interpretationGuidance"]
    );
    assert!(
        session.used() > before,
        "Workers share allowance but have independent guidance context"
    );
}

#[test]
fn guidance_bootstrap_preserves_complete_long_task_passages_and_shared_budget() {
    let vault = crate::test_support::TestVault::new("long-task-guidance");
    let line = format!("- [ ] {} @due(2026-10-09)", "a".repeat(1794));
    let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
        &vault.state,
        "Long task".into(),
        line.clone(),
        None,
    )
    .unwrap()
    .unwrap();
    let mut initial = EvidenceSession::default();
    initial
        .read_request(
            &vault.state,
            None,
            &HashSet::new(),
            ReadRequest {
                note_id: saved.note_id,
                ..Default::default()
            },
        )
        .unwrap();
    let id = initial
        .candidates
        .iter()
        .find(|(_, c)| c.citation.location == "body")
        .unwrap()
        .0
        .clone();
    // Exercise all interpretation contracts at the serialization boundary. Task
    // fact correctness itself is covered by the retained-activity contract tests.
    initial.candidates.get_mut(&id).unwrap().task = Some(json!({"currentStatus":"open"}));
    for research in [false, true] {
        let mut session = initial.fork();
        let before = session.used();
        let (bootstrap, sources) = if research {
            session.read_research(
                &vault.state,
                None,
                &HashSet::new(),
                &[id.clone()],
                None,
                vec![],
            )
        } else {
            session.read_request(
                &vault.state,
                None,
                &HashSet::new(),
                ReadRequest {
                    evidence_ids: vec![id.clone()],
                    ..Default::default()
                },
            )
        }
        .unwrap();
        assert!(
            sources.is_empty(),
            "Bootstrap does not admit the pending passage"
        );
        assert!(bootstrap["items"].as_array().unwrap().is_empty());
        assert_eq!(
            bootstrap["interpretationGuidance"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        assert!(bootstrap.to_string().len() <= READ_BYTES);
        let followup = if research {
            ReadRequest {
                evidence_ids: vec![id.clone()],
                ..Default::default()
            }
        } else {
            ReadRequest {
                cursor: Some(bootstrap["nextCursor"].as_str().unwrap().into()),
                ..Default::default()
            }
        };
        let (page, sources) = session
            .read_request(&vault.state, None, &HashSet::new(), followup)
            .unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(page["items"][0]["excerpt"], line);
        assert_eq!(page["items"][0]["taskDates"]["complete"], true);
        assert!(page.get("interpretationGuidance").is_none());
        assert!(page.to_string().len() <= READ_BYTES);
        assert!(session.used() - before >= bootstrap.to_string().len() + page.to_string().len());
    }
}
