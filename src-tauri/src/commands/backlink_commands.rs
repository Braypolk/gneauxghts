use super::{
    prepare_notes_dir,
    wikilink_commands::{note_matches_reference, parse_wikilink_target},
};
use crate::{
    index::{AppState, NotesIndex},
    note_links::NoteLink,
    semantic::RelatedNoteMatch,
    services::note_timeline::AllowedScope,
    state::validate_current_path,
};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub(crate) async fn get_note_backlinks(
    app: AppHandle,
    current_path: Option<String>,
) -> Result<Vec<RelatedNoteMatch>, String> {
    super::on_app_worker(app, move |state| list_backlinks(state, current_path)).await?
}

fn list_backlinks(
    state: &AppState,
    current_path: Option<String>,
) -> Result<Vec<RelatedNoteMatch>, String> {
    state
        .note_timeline()
        .current_content(AllowedScope::vault())
        .read_refreshable(|| {
            let notes_dir = prepare_notes_dir(state, false)?;
            let Some(current_path) = validate_current_path(current_path.clone(), &notes_dir)?
            else {
                return Ok(Vec::new());
            };
            state.ensure_interactive_index(&notes_dir, "get_note_backlinks")?;
            let index = state
                .notes_index
                .lock()
                .map_err(|_| "Search index lock poisoned".to_string())?;
            Ok(collect_backlinks(&index, &notes_dir, &current_path))
        })
}

fn collect_backlinks(
    index: &NotesIndex,
    notes_dir: &Path,
    current_path: &Path,
) -> Vec<RelatedNoteMatch> {
    let Some(target) = index.entries.get(current_path) else {
        return Vec::new();
    };
    let mut results = Vec::new();
    for (path, note) in &index.entries {
        if path == current_path
            || !path.starts_with(notes_dir)
            || crate::state::is_forgotten_note_path(path, notes_dir)
            || !path.is_file()
        {
            continue;
        }
        let link = note.links.iter().find(|link| {
            if link.wiki {
                parse_wikilink_target(&link.target)
                    .note
                    .as_deref()
                    .is_some_and(|reference| {
                        note_matches_reference(reference, current_path, target, notes_dir)
                    })
            } else {
                markdown_destination(link, path).as_deref() == Some(current_path)
            }
        });
        let Some(link) = link else {
            continue;
        };
        results.push(RelatedNoteMatch {
            note_id: Some(note.note_id.clone()),
            note_path: path.to_string_lossy().into_owned(),
            note_title: note.title.clone(),
            section_label: format!("Line {}", link.line),
            excerpt: link.excerpt.clone(),
            match_text: link.excerpt.clone(),
            score: 1.0,
            start_line: link.line,
            end_line: link.line,
            document_kind: note.document_kind,
            block_anchor: None,
        });
    }
    results.sort_by(|a, b| {
        a.note_title
            .to_lowercase()
            .cmp(&b.note_title.to_lowercase())
            .then_with(|| a.note_path.cmp(&b.note_path))
    });
    results
}

fn markdown_destination(link: &NoteLink, source: &Path) -> Option<PathBuf> {
    let raw = link.target.split('#').next()?;
    if raw.is_empty() || raw.contains(':') || raw.starts_with('/') {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()?;
    if !decoded.to_lowercase().ends_with(".md") {
        return None;
    }
    let mut destination = source.parent()?.to_path_buf();
    for component in Path::new(decoded.as_ref()).components() {
        match component {
            Component::Normal(part) => destination.push(part),
            Component::ParentDir => {
                destination.pop();
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestVault;

    #[test]
    fn backlinks_follow_authored_links_and_refresh_with_the_index() {
        let vault = TestVault::with_notes("backlinks", |root| {
            std::fs::create_dir(root.join("folder")).unwrap();
            for (name, body) in [
                ("Target note.md", "Self [[Target note]]"),
                ("Wiki.md", "Intro\n\nSee [[Target note#Ideas|alias]] and [[Target note]]."),
                ("folder/Path.md", "See [[Target note.md#^block]]."),
                ("folder/Markdown.md", "See [target](../Target%20note.md#ideas)."),
                ("Literal.md", "`[[Target note]]`\n\n```md\n[[Target note]]\n```\n\n\\[[Target note]]\n\n<!-- [[Target note]] -->\n\n![[Target note]]"),
                ("Unrelated.md", "Target note is mentioned. [[Other]] [web](https://example.com/Target%20note.md)"),
            ] { std::fs::write(root.join(name), body).unwrap(); }
        });
        let path = vault
            .notes
            .path()
            .join("Target note.md")
            .to_string_lossy()
            .into_owned();
        let rows = list_backlinks(&vault.state, Some(path.clone())).unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| r.note_title.as_str())
                .collect::<Vec<_>>(),
            vec!["Markdown", "Path", "Wiki"]
        );
        let wiki = rows.iter().find(|r| r.note_title == "Wiki").unwrap();
        assert_eq!(wiki.start_line, 3);
        assert!(wiki.excerpt.contains("alias"));
        assert!(list_backlinks(&vault.state, None).unwrap().is_empty());
        std::fs::write(vault.notes.path().join("Wiki.md"), "Link removed").unwrap();
        vault.state.notes_index.lock().unwrap().upsert_note(
            vault.notes.path().join("Wiki.md"),
            crate::index::build_indexed_note(
                &vault.notes.path().join("Wiki.md"),
                "Link removed",
                20,
            ),
        );
        assert_eq!(list_backlinks(&vault.state, Some(path)).unwrap().len(), 2);
    }
}
