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
