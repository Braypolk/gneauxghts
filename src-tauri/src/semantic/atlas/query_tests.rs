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
