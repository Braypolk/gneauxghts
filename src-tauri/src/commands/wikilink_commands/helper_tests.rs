use super::*;
use crate::index::build_indexed_note;
use std::path::PathBuf;

#[test]
fn parse_wikilink_target_supports_aliases_and_same_note_sections() {
    assert_eq!(
        parse_wikilink_target("Project Atlas#Paragraph 2|Atlas"),
        ParsedWikilinkTarget {
            note: Some("Project Atlas".to_string()),
            section: Some("Paragraph 2".to_string()),
        }
    );
    assert_eq!(
        parse_wikilink_target("#Ideas"),
        ParsedWikilinkTarget {
            note: None,
            section: Some("Ideas".to_string()),
        }
    );
}

#[test]
fn resolve_note_link_target_prefers_paragraph_numbers_and_falls_back_to_title() {
    let note_path = PathBuf::from("/tmp/project-atlas.md");
    let note = build_indexed_note(
        &note_path,
        "# Project Atlas\n\nFirst paragraph.\n\n## Ideas\n\nSecond paragraph with link target.\n",
        10,
    );

    let paragraph_target = resolve_note_link_target(&note_path, &note, Some("Paragraph 3"));
    let heading_target = resolve_note_link_target(&note_path, &note, Some("Ideas"));
    let fallback_target = resolve_note_link_target(&note_path, &note, Some("Missing"));

    assert_eq!(paragraph_target.note_path, "/tmp/project-atlas.md");
    assert_eq!(paragraph_target.section_label, "Paragraph 3");
    assert_eq!(paragraph_target.match_text, "## Ideas");

    assert_eq!(heading_target.section_label, "Paragraph 3");
    assert_eq!(heading_target.match_text, "## Ideas");

    assert_eq!(fallback_target.section_label, "Title");
    assert_eq!(fallback_target.match_text, "project-atlas");
}

#[test]
fn resolve_note_link_target_supports_stable_block_ids() {
    let note_path = PathBuf::from("/tmp/Chats/2026-07-12-planning/Part 001.md");
    let note = build_indexed_note(
        &note_path,
        "# Planning\n\nA durable response. ^msg_01ABC\n\nAnother response.",
        10,
    );

    let target = resolve_note_link_target(&note_path, &note, Some("^msg_01ABC"));

    assert_eq!(target.block_id.as_deref(), Some("msg_01ABC"));
    assert_eq!(target.line_number, Some(3));
    assert_eq!(target.match_text, "A durable response. ^msg_01ABC");
}

#[test]
fn path_qualified_note_references_match_relative_vault_paths() {
    let notes_dir = PathBuf::from("/vault");
    let note_path = notes_dir.join("Chats/2026-07-12-planning/Part 001.md");
    let note = build_indexed_note(&note_path, "Transcript", 10);

    assert!(note_matches_reference(
        "Chats/2026-07-12-planning/Part 001",
        &note_path,
        &note,
        &notes_dir,
    ));
    assert!(note_matches_reference(
        "Chats\\2026-07-12-planning\\Part 001.md",
        &note_path,
        &note,
        &notes_dir,
    ));
    assert!(!note_matches_reference(
        "Other/Part 001",
        &note_path,
        &note,
        &notes_dir,
    ));
}
