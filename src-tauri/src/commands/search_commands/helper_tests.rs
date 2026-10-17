use super::*;
use crate::{
    index::{build_indexed_note, NotesIndex},
    search::{NoteSearchResult, ScoredSearchResult},
};
use std::path::PathBuf;

#[test]
fn collect_recent_note_results_skips_current_note() {
    let current_path = PathBuf::from("/tmp/current.md");
    let other_path = PathBuf::from("/tmp/other.md");
    let mut index = NotesIndex::default();
    index.upsert_note(
        current_path.clone(),
        build_indexed_note(&current_path, "# Current\n\nBody", 10),
    );
    index.upsert_note(
        other_path.clone(),
        build_indexed_note(&other_path, "# Other\n\nElsewhere", 20),
    );

    let results = collect_recent_note_results(
        &[
            index.entries[&current_path].note_id.clone(),
            index.entries[&other_path].note_id.clone(),
        ],
        Some(index.entries[&current_path].note_id.as_str()),
        &index,
        12,
    );

    assert_eq!(results.len(), 1);
    assert_eq!(
        results[0].note_path.as_deref(),
        Some(other_path.to_string_lossy().as_ref())
    );
    assert_eq!(results[0].file_name, "other");
}

#[test]
fn merge_hybrid_candidates_applies_labels_scores_and_limit() {
    let lexical = vec![
        ScoredSearchResult {
            score: 100,
            result: NoteSearchResult {
                document_kind: crate::note::DocumentKind::Note,
                note_id: Some("note-a".to_string()),
                block_anchor: None,
                note_path: Some("/notes/a.md".to_string()),
                file_name: "a".to_string(),
                section_label: "Paragraph 1".to_string(),
                excerpt: "hybrid search ranking".to_string(),
                highlight_ranges: Vec::new(),
                match_text: "hybrid search".to_string(),
                reason_labels: Vec::new(),
                lexical_score: None,
                semantic_score: None,
                start_line: None,
                end_line: None,
            },
        },
        ScoredSearchResult {
            score: 40,
            result: NoteSearchResult {
                document_kind: crate::note::DocumentKind::Note,
                note_id: Some("note-b".to_string()),
                block_anchor: None,
                note_path: Some("/notes/b.md".to_string()),
                file_name: "b".to_string(),
                section_label: "Paragraph 1".to_string(),
                excerpt: "keyword only".to_string(),
                highlight_ranges: Vec::new(),
                match_text: "keyword".to_string(),
                reason_labels: Vec::new(),
                lexical_score: None,
                semantic_score: None,
                start_line: None,
                end_line: None,
            },
        },
    ];
    let semantic = vec![crate::semantic::SemanticChunkMatch {
        note_path: "/notes/c.md".to_string(),
        note_title: "c".to_string(),
        section_label: "Research".to_string(),
        excerpt: "conceptual match".to_string(),
        match_text: "conceptual match".to_string(),
        score: 0.9,
        start_line: 7,
        end_line: 8,
        document_kind: crate::note::DocumentKind::Note,
        block_anchor: None,
    }];

    let results = merge_hybrid_candidates(
        lexical,
        semantic,
        "hybrid search",
        Some(PathBuf::from("/notes/current.md").as_path()),
        2,
        0.5,
        0.4,
        &std::collections::HashMap::new(),
        &NoteAccessLookup::empty(),
        0,
    );

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].file_name, "a");
    assert_eq!(results[0].reason_labels, vec!["keyword".to_string()]);
    assert_eq!(results[0].lexical_score, Some(1.0));
    assert_eq!(results[0].semantic_score, Some(0.0));

    assert_eq!(results[1].file_name, "c");
    assert_eq!(results[1].reason_labels, vec!["semantic".to_string()]);
    assert_eq!(results[1].lexical_score, Some(0.0));
    assert_eq!(results[1].semantic_score, Some(1.0));
}

#[test]
fn semantic_only_note_match_keeps_kind_and_anchor() {
    let semantic = vec![crate::semantic::SemanticChunkMatch {
        note_path: "/notes/Example.md".to_string(),
        note_title: "A useful discussion".to_string(),
        section_label: "Remembered passage".to_string(),
        excerpt: "the exact remembered passage".to_string(),
        match_text: "the exact remembered passage".to_string(),
        score: 0.9,
        start_line: 1,
        end_line: 1,
        document_kind: crate::note::DocumentKind::Note,
        block_anchor: Some("excerpt_stable".to_string()),
    }];

    let results = merge_hybrid_candidates(
        Vec::new(),
        semantic,
        "remembered passage",
        None,
        5,
        0.5,
        0.5,
        &std::collections::HashMap::new(),
        &NoteAccessLookup::empty(),
        0,
    );

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].document_kind, crate::note::DocumentKind::Note);
    assert_eq!(results[0].block_anchor.as_deref(), Some("excerpt_stable"));
    assert_eq!(results[0].reason_labels, vec!["semantic".to_string()]);
}

#[test]
fn merge_hybrid_candidates_boosts_frequently_opened_notes() {
    let lexical = vec![
        ScoredSearchResult {
            score: 50,
            result: NoteSearchResult {
                document_kind: crate::note::DocumentKind::Note,
                note_id: Some("rarely-opened".to_string()),
                block_anchor: None,
                note_path: Some("/notes/rare.md".to_string()),
                file_name: "rare".to_string(),
                section_label: "Paragraph 1".to_string(),
                excerpt: "shared topic".to_string(),
                highlight_ranges: Vec::new(),
                match_text: "shared topic".to_string(),
                reason_labels: Vec::new(),
                lexical_score: None,
                semantic_score: None,
                start_line: None,
                end_line: None,
            },
        },
        ScoredSearchResult {
            score: 48,
            result: NoteSearchResult {
                document_kind: crate::note::DocumentKind::Note,
                note_id: Some("often-opened".to_string()),
                block_anchor: None,
                note_path: Some("/notes/often.md".to_string()),
                file_name: "often".to_string(),
                section_label: "Paragraph 1".to_string(),
                excerpt: "shared topic".to_string(),
                highlight_ranges: Vec::new(),
                match_text: "shared topic".to_string(),
                reason_labels: Vec::new(),
                lexical_score: None,
                semantic_score: None,
                start_line: None,
                end_line: None,
            },
        },
    ];
    let now = 1_700_000_000_000u64;
    let mut activity = std::collections::HashMap::new();
    activity.insert(
        "often-opened".to_string(),
        crate::state::NoteActivity {
            last_viewed_at_millis: now,
            open_count: 40,
            last_counted_open_at_millis: now,
        },
    );
    let mut note_lookup = NoteAccessLookup::empty();
    note_lookup
        .modified_by_note_id
        .insert("often-opened".to_string(), now);
    note_lookup
        .modified_by_note_id
        .insert("rarely-opened".to_string(), now);

    let results = merge_hybrid_candidates(
        lexical,
        Vec::new(),
        "shared topic",
        None,
        2,
        0.5,
        0.4,
        &activity,
        &note_lookup,
        now,
    );

    assert_eq!(results[0].file_name, "often");
    assert!(results[0]
        .reason_labels
        .iter()
        .any(|label| label == "frequently opened"));
}

#[test]
fn merge_hybrid_candidates_idle_decay_removes_access_boost() {
    let lexical = vec![
        ScoredSearchResult {
            score: 50,
            result: NoteSearchResult {
                document_kind: crate::note::DocumentKind::Note,
                note_id: Some("stale-popular".to_string()),
                block_anchor: None,
                note_path: Some("/notes/stale.md".to_string()),
                file_name: "stale".to_string(),
                section_label: "Paragraph 1".to_string(),
                excerpt: "shared topic".to_string(),
                highlight_ranges: Vec::new(),
                match_text: "shared topic".to_string(),
                reason_labels: Vec::new(),
                lexical_score: None,
                semantic_score: None,
                start_line: None,
                end_line: None,
            },
        },
        ScoredSearchResult {
            score: 48,
            result: NoteSearchResult {
                document_kind: crate::note::DocumentKind::Note,
                note_id: Some("fresh".to_string()),
                block_anchor: None,
                note_path: Some("/notes/fresh.md".to_string()),
                file_name: "fresh".to_string(),
                section_label: "Paragraph 1".to_string(),
                excerpt: "shared topic".to_string(),
                highlight_ranges: Vec::new(),
                match_text: "shared topic".to_string(),
                reason_labels: Vec::new(),
                lexical_score: None,
                semantic_score: None,
                start_line: None,
                end_line: None,
            },
        },
    ];
    let now = 1_700_000_000_000u64;
    let idle_viewed = now - (crate::state::OPEN_COUNT_DECAY_INTERVAL_MS * 40);
    let mut activity = std::collections::HashMap::new();
    activity.insert(
        "stale-popular".to_string(),
        crate::state::NoteActivity {
            last_viewed_at_millis: idle_viewed,
            open_count: 40,
            last_counted_open_at_millis: idle_viewed,
        },
    );
    let mut note_lookup = NoteAccessLookup::empty();
    note_lookup
        .modified_by_note_id
        .insert("stale-popular".to_string(), idle_viewed);
    note_lookup
        .modified_by_note_id
        .insert("fresh".to_string(), now);

    let results = merge_hybrid_candidates(
        lexical,
        Vec::new(),
        "shared topic",
        None,
        2,
        0.5,
        0.4,
        &activity,
        &note_lookup,
        now,
    );

    assert_eq!(results[0].file_name, "stale");
    assert!(!results[0]
        .reason_labels
        .iter()
        .any(|label| label == "frequently opened"));
}
