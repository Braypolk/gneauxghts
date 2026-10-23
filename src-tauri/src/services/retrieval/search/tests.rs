use super::*;
use crate::{
    commands::note_persistence::persist_note_session_with_outcome as save,
    services::retrieval::{retrieve_vault_notes, VaultDateFilters},
};

#[test]
fn retrieval_uses_current_canonical_utf8_and_falls_back_before_indexing() {
    let vault = crate::test_support::TestVault::new("search-canonical");
    let saved = save(
        &vault.state,
        "Unicode".into(),
        "# Heading\n\nneedle\t  café\n続き".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let run = || {
        retrieve_vault_notes(
            &vault.state,
            "needle",
            20,
            None,
            &HashSet::new(),
            Default::default(),
        )
        .unwrap()
    };
    let fallback = run();
    assert_eq!(fallback.len(), 1);
    assert!(
        fallback[0].excerpt.contains("needle\t  café\n続き"),
        "{:?}",
        fallback
    );
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    let indexed = run();
    assert_eq!(indexed.len(), 1);
    assert_eq!(indexed[0].excerpt, fallback[0].excerpt);
    let path = PathBuf::from(saved.path.unwrap());
    let old = fs::read_to_string(&path).unwrap();
    // No watcher/index update: a stale indexed excerpt may not be delivered.
    fs::write(&path, old.replace("needle", "absent")).unwrap();
    assert!(run().is_empty());
}

#[test]
fn retrieval_respects_scope_dates_kind_limits_and_metadata_only_queries() {
    let vault = crate::test_support::TestVault::new("search-scope");
    let mut ids = Vec::new();
    for i in 0..24 {
        ids.push(
            save(
                &vault.state,
                format!("Note {i}"),
                "needle body".into(),
                None,
            )
            .unwrap()
            .unwrap()
            .note_id
            .unwrap(),
        );
    }
    let allowed = HashSet::from([ids[0].clone(), ids[1].clone()]);
    let excluded = HashSet::from([ids[0].clone()]);
    let result = retrieve_vault_notes(
        &vault.state,
        "needle",
        20,
        Some(&allowed),
        &excluded,
        Default::default(),
    )
    .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].note_id, ids[1]);
    assert_eq!(
        retrieve_vault_notes(
            &vault.state,
            "needle",
            100,
            None,
            &HashSet::new(),
            Default::default()
        )
        .unwrap()
        .len(),
        20
    );
    let dated = retrieve_vault_notes(
        &vault.state,
        "",
        20,
        Some(&allowed),
        &excluded,
        VaultDateFilters {
            updated_after: Some(1),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(dated.len(), 1);
    assert!(dated[0].excerpt.contains("needle body"));
    assert!(retrieve_vault_notes(
        &vault.state,
        "",
        20,
        None,
        &HashSet::new(),
        Default::default()
    )
    .unwrap()
    .is_empty());
    let path = vault
        .state
        .notes_index
        .lock()
        .unwrap()
        .get_note_by_note_id(&ids[1])
        .unwrap()
        .0
        .clone();
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(&path, raw.replace(&ids[1], "conflicting-identity")).unwrap();
    assert!(retrieve_vault_notes(
        &vault.state,
        "needle",
        20,
        Some(&allowed),
        &excluded,
        Default::default()
    )
    .unwrap()
    .is_empty());
}

#[test]
fn semantic_fusion_widens_scope_rejects_stale_passages_and_keeps_lexical_on_failure() {
    let vault = crate::test_support::TestVault::new("search-hybrid");
    let saved = save(
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
    let mut widths = Vec::new();
    collect_semantic_candidates(
        &vault.state,
        &ids,
        &mut snapshots,
        &mut candidates,
        |width| {
            widths.push(width);
            if width == 64 {
                return Ok((0..64).map(|_| item("excluded.md", "private")).collect());
            }
            Ok(vec![
                item(saved.path.as_ref().unwrap(), "alpha common"),
                item(saved.path.as_ref().unwrap(), "omega semantic"),
                item(saved.path.as_ref().unwrap(), "stale bytes"),
            ])
        },
    );
    assert_eq!(widths, vec![64, 256]);
    assert_eq!(candidates.len(), 2);
    assert!(candidates[0].score > lexical.score);
    assert_eq!(candidates[1].passage.excerpt, "omega semantic");
    collect_semantic_candidates(&vault.state, &ids, &mut snapshots, &mut candidates, |_| {
        Err("unavailable".into())
    });
    assert_eq!(candidates.len(), 2);
}

#[test]
fn semantic_source_can_admit_an_approximate_passage_absent_from_lexical_matches() {
    let vault = crate::test_support::TestVault::new("search-approximate-source");
    let saved = save(
        &vault.state,
        "Growing".into(),
        "budget seedling shelter".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let id = saved.note_id.unwrap();
    let ids = HashSet::from([id.clone()]);
    let lexical = vault
        .state
        .lexical
        .passage_matches_with_catalog(
            &vault.state.notes_index.lock().unwrap().entries,
            "inexpensive greenhouse",
            &ids,
            WORK_LIMIT,
        )
        .unwrap();
    assert!(lexical.is_empty());
    let mut candidates = Vec::new();
    collect_semantic_candidates(
        &vault.state,
        &ids,
        &mut HashMap::new(),
        &mut candidates,
        |_| {
            Ok(vec![crate::semantic::SemanticChunkMatch {
                note_path: saved.path.clone().unwrap(),
                note_title: "Growing".into(),
                section_label: "Body".into(),
                excerpt: "budget seedling shelter".into(),
                match_text: "budget seedling shelter".into(),
                score: 1.0,
                start_line: 1,
                end_line: 1,
                document_kind: DocumentKind::Note,
                block_anchor: None,
            }])
        },
    );
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].passage.excerpt, "budget seedling shelter");
    // Synthetic ranking source verifies admission, not real-model relevance.
}

#[test]
fn fingerprint_tracks_bytes_and_not_timestamps_and_ranges_reject_ambiguity() {
    let vault = crate::test_support::TestVault::new("search-fingerprint");
    let saved = save(
        &vault.state,
        "Unchanged".into(),
        "Supporting passage".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let ids = HashSet::from([saved.note_id.unwrap()]);
    let before = fingerprint(&vault.state, &ids).unwrap();
    let path = PathBuf::from(saved.path.unwrap());
    let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
    let time = file.metadata().unwrap().modified().unwrap() + std::time::Duration::from_secs(1);
    file.set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    assert_eq!(before, fingerprint(&vault.state, &ids).unwrap());
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(&path, raw.replace("Supporting", "Contradict")).unwrap();
    file.set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    assert_ne!(before, fingerprint(&vault.state, &ids).unwrap());
    assert!(current_text_range("same\n\nsame", "same").is_none());
    assert_eq!(
        current_text_range("café\t  続き", "café 続き"),
        Some((0, "café\t  続き".len()))
    );
}

#[test]
fn fingerprint_releases_catalog_during_io_and_rejects_changed_path_bindings() {
    let vault = crate::test_support::TestVault::new("search-fingerprint-lock");
    let saved = save(
        &vault.state,
        "Unchanged".into(),
        "Supporting passage".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let ids = HashSet::from([saved.note_id.unwrap()]);
    let mut bytes = 0;
    let first = fingerprint_with(&vault.state, &ids, |path| {
        assert!(
            vault.state.notes_index.try_lock().is_ok(),
            "file IO must not hold catalog"
        );
        let raw = fs::read(path).unwrap();
        bytes += raw.len();
        Ok(blake3::hash(&raw).to_hex().to_string())
    })
    .unwrap();
    assert_eq!(first, fingerprint(&vault.state, &ids).unwrap());
    assert!(bytes > 0);
    assert!(fingerprint_with(&vault.state, &ids, |path| {
        let raw = fs::read(path).unwrap();
        vault.state.notes_index.lock().unwrap().remove_note(path);
        Ok(blake3::hash(&raw).to_hex().to_string())
    })
    .is_err());
}

#[test]
fn scoped_ranking_keeps_large_pages_and_known_identity_with_missing_managed_id() {
    let vault = crate::test_support::TestVault::new("search-scoped-ranking");
    let foreground = vault.state.foreground_guard();
    let mut saved = Vec::new();
    for i in 0..24 {
        saved.push(
            save(
                &vault.state,
                format!("Note {i}"),
                "needle body".into(),
                None,
            )
            .unwrap()
            .unwrap(),
        );
    }
    let run = |query: &str, limit| {
        super::super::retrieve_scoped_notes(
            &vault.state,
            query,
            limit,
            None,
            &HashSet::new(),
            Default::default(),
        )
    };
    assert_eq!(run("needle", 4096).unwrap().len(), 24);
    assert!(run(&"x".repeat(4097), 50).is_err());
    assert!(run(&"x".repeat(1025), 50).is_ok());
    let path = PathBuf::from(saved[0].path.as_ref().unwrap());
    let raw = fs::read_to_string(&path).unwrap();
    let raw = raw.replace(saved[0].note_id.as_ref().unwrap(), "");
    fs::write(&path, raw).unwrap();
    assert_eq!(run("needle", 4096).unwrap().len(), 24);
    drop(foreground);
}

/// Reproducible work/lock profile, not a real-vault latency acceptance test.
/// cargo test --lib profile_fingerprint_corpus_work -- --ignored --nocapture
#[test]
#[ignore = "explicit corpus/lock measurement"]
fn profile_fingerprint_corpus_work() {
    use std::time::Instant;
    let median = |values: &mut Vec<u128>| {
        values.sort();
        values[values.len() / 2]
    };
    for count in [128, 1024] {
        let vault = crate::test_support::TestVault::new("search-fingerprint-profile");
        let mut ids = HashSet::new();
        let mut corpus_bytes = 0;
        for i in 0..count {
            let id = format!("profile-{i:04}");
            let path = vault.notes.path().join(format!("{i:04}.md"));
            let raw = format!(
                "---\ngneauxghts:\n  id: {id}\n---\n\n{}",
                "needle ordinary note prose ".repeat(631)
            );
            fs::write(&path, &raw).unwrap();
            corpus_bytes += raw.len();
            vault.state.notes_index.lock().unwrap().upsert_note(
                path.clone(),
                crate::index::build_indexed_note(&path, &raw, 1),
            );
            ids.insert(id);
        }
        let legacy = || {
            let started = Instant::now();
            let index = vault.state.notes_index.lock().unwrap();
            let locked = Instant::now();
            let mut keys = Vec::new();
            for id in &ids {
                if let Some((path, _)) = index.get_note_by_note_id(id) {
                    let mut file = fs::File::open(path).unwrap();
                    let mut content = blake3::Hasher::new();
                    content.update_reader(&mut file).unwrap();
                    keys.push(
                        serde_json::to_string(&(path, content.finalize().to_hex().as_str()))
                            .unwrap(),
                    );
                }
            }
            keys.sort();
            let lock_us = locked.elapsed().as_micros();
            drop(index);
            (
                hash(&keys.join("\n")),
                started.elapsed().as_micros(),
                lock_us,
            )
        };
        // Warm both implementations against identical bytes before sampling.
        legacy();
        fingerprint(&vault.state, &ids).unwrap();
        let mut old_total = Vec::new();
        let mut old_locked = Vec::new();
        let mut new_total = Vec::new();
        let mut new_non_io = Vec::new();
        for _ in 0..7 {
            let (old_hash, total, locked) = legacy();
            old_total.push(total);
            old_locked.push(locked);
            let started = Instant::now();
            let mut io_us = 0;
            let new_hash = fingerprint_with(&vault.state, &ids, |path| {
                let reading = Instant::now();
                let mut file = fs::File::open(path).unwrap();
                let mut content = blake3::Hasher::new();
                content.update_reader(&mut file).unwrap();
                let value = content.finalize().to_hex().to_string();
                io_us += reading.elapsed().as_micros();
                Ok(value)
            })
            .unwrap();
            let total = started.elapsed().as_micros();
            assert_eq!(old_hash, new_hash);
            new_total.push(total);
            // Includes sorting/serialization/hashing outside the lock, so this
            // is a conservative upper bound on aggregate lock time, not exact.
            new_non_io.push(total.saturating_sub(io_us));
        }
        eprintln!("fingerprint-profile notes={count} corpus_bytes={corpus_bytes} samples=7 warm_fs=true bytes_per_query_pair={} old_total_us={} old_lock_us={} new_total_us={} new_lock_upper_us={} file_io_under_new_lock=0", corpus_bytes * 2, median(&mut old_total) * 2, median(&mut old_locked) * 2, median(&mut new_total) * 2, median(&mut new_non_io) * 2);
    }
}

#[test]
fn pending_catalog_scores_share_the_index_scale_and_keep_the_matching_paragraph() {
    let vault = crate::test_support::TestVault::new("search-mixed-ranking");
    let indexed = save(&vault.state, "Needle".into(), "index body".into(), None)
        .unwrap()
        .unwrap();
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    // Hold the normal foreground guard so new projections stay pending.
    let foreground = vault.state.foreground_guard();
    let pending = save(
        &vault.state,
        "Pending".into(),
        "needle separate words\n\nneedle haystack actual matching paragraph".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let matches = retrieve_vault_notes(
        &vault.state,
        "needle",
        20,
        None,
        &HashSet::new(),
        Default::default(),
    )
    .unwrap();
    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].note_id, indexed.note_id.unwrap(), "a pending body match must not displace a strong indexed title solely due to score units: {matches:?}");
    let phrases = retrieve_vault_notes(
        &vault.state,
        "needle haystack",
        20,
        Some(&HashSet::from([pending.note_id.unwrap()])),
        &HashSet::new(),
        Default::default(),
    )
    .unwrap();
    assert_eq!(phrases.len(), 1);
    assert!(
        phrases[0]
            .excerpt
            .contains("haystack actual matching paragraph"),
        "{phrases:?}"
    );
    drop(foreground);
}
