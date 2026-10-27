use super::*;

#[test]
fn atlas_search_does_not_match_the_shared_vault_root() {
    let notes_dir = Path::new("/Users/example/Gneauxghts/Notes");
    let note_path = "/Users/example/Gneauxghts/Notes/Projects/Launch.md";
    let searchable_path = atlas_searchable_note_path(note_path, notes_dir);
    let terms = vec!["gneauxghts".to_string()];

    assert_eq!(searchable_path, "Projects/Launch.md");
    assert_eq!(
        lexical_note_score(
            &terms,
            &["Launch", "Launch.md", &searchable_path, "Project details"],
            &[],
        ),
        0.0,
    );
    assert_eq!(
        title_tag_path_score(
            "gneauxghts",
            &terms,
            "Launch",
            "Launch.md",
            &searchable_path,
            &[],
        ),
        0.0,
    );
}

#[test]
fn atlas_search_ignores_legacy_frontmatter_derived_tags() {
    let stale = vec!["gneauxghts".to_string()];
    assert!(atlas_searchable_tags(DocumentKind::Note, "legacy", &stale).is_empty());

    let current_hash = format!("{NOTE_PRESENTATION_ALGORITHM_VERSION}:hash");
    assert_eq!(
        atlas_searchable_tags(DocumentKind::Note, &current_hash, &stale),
        stale,
    );
}

#[test]
fn query_admission_rejects_background_similarity_and_activity_boosts() {
    let semantic_floor = atlas_semantic_search_floor(0.70, 0.80);
    let mut item = AtlasSearchMatch {
        note_id: None,
        note_path: "Unrelated.md".into(),
        document_kind: DocumentKind::Note,
        score: 0.9,
        semantic_score: 0.61,
        lexical_score: 0.0,
        structural_score: 0.0,
        reason_labels: vec!["Recent or accessed".into()],
    };
    assert!(!admits_search_match(&item, false, semantic_floor));
    item.semantic_score = 0.71;
    assert!(!admits_search_match(&item, false, semantic_floor));
    item.semantic_score = 0.80;
    assert!(admits_search_match(&item, false, semantic_floor));
    item.semantic_score = 0.0; // embedding unavailable
    item.structural_score = 1.0;
    item.lexical_score = 2.0 / 3.0;
    assert!(!admits_search_match(&item, false, semantic_floor));
    item.lexical_score = 1.0;
    assert!(admits_search_match(&item, false, semantic_floor));
    item.lexical_score = 0.0;
    assert!(admits_search_match(&item, true, semantic_floor)); // tags already intersected
    item.semantic_score = 0.22;
    let legacy_floor = atlas_semantic_search_floor(0.18, 0.45);
    assert!(!admits_search_match(&item, false, legacy_floor));
    item.semantic_score = 0.45;
    assert!(admits_search_match(&item, false, legacy_floor));
}

#[test]
fn semantic_only_matches_stay_near_the_best_query_match() {
    let floor = atlas_semantic_search_floor(0.70, 0.95);
    let mut item = AtlasSearchMatch {
        note_id: None,
        note_path: "Loosely related.md".into(),
        document_kind: DocumentKind::Note,
        score: 1.0,
        semantic_score: 0.80,
        lexical_score: 0.0,
        structural_score: 0.0,
        reason_labels: vec![],
    };
    assert!(!admits_search_match(&item, false, floor));
    item.semantic_score = 0.93;
    assert!(admits_search_match(&item, false, floor));
    item.semantic_score = f32::NAN;
    assert!(!admits_search_match(&item, false, floor));
    item.lexical_score = 1.0;
    assert!(admits_search_match(&item, false, floor));
}

#[test]
fn text_matches_require_complete_words_and_every_query_term() {
    for (query, title, matched) in [
        ("rain", "Brainstorming", false),
        ("go", "Django", false),
        ("blue bell", "deploy", false),
        ("blue bell", "Bluebird bell", false), // completed first term must match
        ("blue bell", "Blue-bell trip", true),
        ("blue bel", "Blue Bell Day 1", true),
        ("blue bell", "Blue bells", true),
        ("rain water budget", "Rain water", false),
        ("rain water budget", "Budget for rain water", true),
        ("café", "CAFÉ plans", true),
    ] {
        let normalized_query = normalize_search_text(query);
        let terms = search_words(&normalized_query)
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(
            lexical_note_score(&terms, &[title], &[]) >= 1.0,
            matched,
            "{query:?} / {title:?}"
        );
    }
}
