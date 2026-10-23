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
    assert!(!admits_search_match(&item, false, 0.70));
    item.semantic_score = 0.71;
    assert!(admits_search_match(&item, false, 0.70));
    item.semantic_score = 0.0; // embedding unavailable
    assert!(!admits_search_match(&item, false, 0.70));
    item.lexical_score = 1.0;
    assert!(admits_search_match(&item, false, 0.70));
    item.lexical_score = 0.0;
    assert!(admits_search_match(&item, true, 0.70)); // tags already intersected
    item.semantic_score = 0.22;
    assert!(admits_search_match(&item, false, 0.18)); // retained Jina calibration
}
