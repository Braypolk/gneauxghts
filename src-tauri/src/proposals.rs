use crate::{
    note,
    semantic::db::content_hash,
    state::{atomic_write_note, derive_file_stem_from_title_and_markdown, is_valid_note_path, persist_note},
    vault_watcher,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum NoteChange {
    UpdateNote {
        path: String,
        base_content_hash: String,
        new_title: String,
        new_markdown: String,
    },
    CreateNote {
        suggested_title: String,
        markdown: String,
    },
    DeleteNote {
        path: String,
        base_content_hash: String,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppliedNoteChange {
    pub(crate) kind: String,
    pub(crate) path: Option<String>,
    pub(crate) previous_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyNoteChangesResult {
    pub(crate) applied: Vec<AppliedNoteChange>,
}

/// Untrusted edit input used only for preview. Positions are always derived by
/// Rust; the model never gets to provide offsets or a content hash.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum ProposedTextEdit {
    Replace {
        old_text: String,
        new_text: String,
        context_before: Option<String>,
        context_after: Option<String>,
    },
    Insert {
        new_text: String,
        context_before: Option<String>,
        context_after: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalPreviewHunk {
    pub(crate) id: String,
    /// UTF-16 offsets, matching CodeMirror's document coordinate system.
    pub(crate) base_from: usize,
    pub(crate) base_to: usize,
    pub(crate) proposed_from: usize,
    pub(crate) proposed_to: usize,
    pub(crate) old_text: String,
    pub(crate) new_text: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalPreview {
    pub(crate) review_id: String,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) base_content_hash: String,
    pub(crate) base_editor_markdown: String,
    pub(crate) proposed_editor_markdown: String,
    pub(crate) hunks: Vec<ProposalPreviewHunk>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitNoteReviewResult {
    pub(crate) status: String,
    pub(crate) applied: Option<AppliedNoteChange>,
    pub(crate) message: Option<String>,
}

#[derive(Clone, Debug)]
struct ResolvedTextEdit {
    from: usize,
    to: usize,
    old_text: String,
    new_text: String,
}

pub(crate) fn preview_note_change(
    notes_dir: &Path,
    path: &str,
    edits: &[ProposedTextEdit],
) -> Result<ProposalPreview, String> {
    let note_path = validate_existing_note_path(notes_dir, path)?;
    reject_chat_projection_path(&note_path)?;
    let raw = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    let fallback_title = note_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (title, base) = note::extract_file_name_title_and_body(&raw, &fallback_title);
    let resolved = resolve_text_edits(&base, edits)?;

    let mut proposed = base.clone();
    for edit in resolved.iter().rev() {
        proposed.replace_range(edit.from..edit.to, &edit.new_text);
    }

    let mut delta_utf16: isize = 0;
    let hunks = resolved
        .iter()
        .enumerate()
        .map(|(index, edit)| {
            let base_from = utf16_len(&base[..edit.from]);
            let base_to = utf16_len(&base[..edit.to]);
            let proposed_from = (base_from as isize + delta_utf16) as usize;
            let proposed_to = proposed_from + utf16_len(&edit.new_text);
            delta_utf16 += utf16_len(&edit.new_text) as isize - (base_to - base_from) as isize;
            ProposalPreviewHunk {
                id: format!("hunk-{}", index + 1),
                base_from,
                base_to,
                proposed_from,
                proposed_to,
                old_text: edit.old_text.clone(),
                new_text: edit.new_text.clone(),
            }
        })
        .collect::<Vec<_>>();

    let base_hash = content_hash(&raw);
    Ok(ProposalPreview {
        review_id: content_hash(&format!("{}\0{}\0{}", path, base_hash, proposed)),
        note_path: note_path.to_string_lossy().into_owned(),
        title,
        base_content_hash: base_hash,
        base_editor_markdown: base,
        proposed_editor_markdown: proposed,
        hunks,
    })
}

pub(crate) fn commit_note_review(
    notes_dir: &Path,
    path: String,
    expected_base_hash: String,
    markdown: String,
) -> Result<CommitNoteReviewResult, String> {
    let note_path = validate_existing_note_path(notes_dir, &path)?;
    let raw = fs::read_to_string(&note_path).map_err(|err| err.to_string())?;
    if content_hash(&raw) != expected_base_hash {
        return Ok(CommitNoteReviewResult {
            status: "conflict".to_string(),
            applied: None,
            message: Some("Note changed on disk.".to_string()),
        });
    }
    // A reviewed body is deliberately written back to the existing file. The
    // generic update path may derive a new filename from the title/body; that
    // is correct for ordinary saves but violates the review contract.
    let normalized = note::normalize_wikilink_markdown(&markdown);
    note::reject_chat_projection_write(&normalized)?;
    let prepared = note::prepare_note_markdown(&normalized, Some(&raw), Some(None))?.0;
    vault_watcher::record_self_save(&note_path);
    atomic_write_note(&note_path, prepared.as_bytes())?;
    Ok(CommitNoteReviewResult {
        status: "committed".to_string(),
        applied: Some(AppliedNoteChange {
            kind: "updateNote".to_string(),
            path: Some(note_path.to_string_lossy().into_owned()),
            previous_path: Some(note_path.to_string_lossy().into_owned()),
        }),
        message: None,
    })
}

fn resolve_text_edits(base: &str, edits: &[ProposedTextEdit]) -> Result<Vec<ResolvedTextEdit>, String> {
    if edits.is_empty() {
        return Err("Proposal contains no edits.".to_string());
    }
    let mut resolved = Vec::with_capacity(edits.len());
    for edit in edits {
        let (old_text, new_text, before, after, insertion) = match edit {
            ProposedTextEdit::Replace { old_text, new_text, context_before, context_after } => {
                if old_text.is_empty() {
                    return Err("Replace edits must include non-empty oldText.".to_string());
                }
                (old_text.as_str(), new_text.as_str(), context_before.as_deref(), context_after.as_deref(), false)
            }
            ProposedTextEdit::Insert { new_text, context_before, context_after } => {
                if context_before.as_deref().unwrap_or("").is_empty()
                    && context_after.as_deref().unwrap_or("").is_empty()
                {
                    return Err("Insert edits require contextBefore or contextAfter.".to_string());
                }
                ("", new_text.as_str(), context_before.as_deref(), context_after.as_deref(), true)
            }
        };
        let candidates = if insertion {
            string_boundaries(base)
                .into_iter()
                .filter(|pos| context_matches(base, *pos, before, after))
                .collect::<Vec<_>>()
        } else {
            find_all(base, old_text)
                .into_iter()
                .filter(|pos| context_matches(base, *pos, before, None)
                    && context_after_matches(base, *pos + old_text.len(), after))
                .collect::<Vec<_>>()
        };
        if candidates.len() != 1 {
            return Err(if candidates.is_empty() {
                "Could not apply safely: edit target was not found.".to_string()
            } else {
                "Could not apply safely: edit target is ambiguous.".to_string()
            });
        }
        let from = candidates[0];
        resolved.push(ResolvedTextEdit {
            from,
            to: if insertion { from } else { from + old_text.len() },
            old_text: old_text.to_string(),
            new_text: new_text.to_string(),
        });
    }
    resolved.sort_by_key(|edit| (edit.from, edit.to));
    for pair in resolved.windows(2) {
        if let [left, right] = pair {
            if right.from < left.to
                || (right.from == left.from && (left.from == left.to || right.from == right.to))
            {
                return Err("Could not apply safely: edits overlap.".to_string());
            }
        }
    }
    Ok(resolved)
}

fn context_matches(base: &str, pos: usize, before: Option<&str>, after: Option<&str>) -> bool {
    before.map(|value| base[..pos].ends_with(value)).unwrap_or(true)
        && after.map(|value| base[pos..].starts_with(value)).unwrap_or(true)
}

fn context_after_matches(base: &str, pos: usize, after: Option<&str>) -> bool {
    after.map(|value| base[pos..].starts_with(value)).unwrap_or(true)
}

fn find_all(haystack: &str, needle: &str) -> Vec<usize> {
    haystack.match_indices(needle).map(|(offset, _)| offset).collect()
}

fn string_boundaries(value: &str) -> Vec<usize> {
    let mut positions = value.char_indices().map(|(offset, _)| offset).collect::<Vec<_>>();
    positions.push(value.len());
    positions
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

#[derive(Clone, Debug)]
enum PreparedChange {
    Update {
        original_path: PathBuf,
        target_path: PathBuf,
        title: String,
        markdown: String,
    },
    Create {
        title: String,
        markdown: String,
    },
    Delete {
        path: PathBuf,
    },
}

pub(crate) fn apply_note_changes(
    notes_dir: &Path,
    changes: &[NoteChange],
) -> Result<ApplyNoteChangesResult, String> {
    let prepared = prepare_note_changes(notes_dir, changes)?;
    let mut applied = Vec::new();

    for change in prepared {
        match change {
            PreparedChange::Update {
                original_path,
                target_path,
                title,
                markdown,
            } => {
                let previous_path = original_path.to_string_lossy().into_owned();
                let saved_path = persist_note(notes_dir, &title, &markdown, Some(&original_path))?
                    .ok_or_else(|| "Updated note produced no persisted path.".to_string())?;
                applied.push(AppliedNoteChange {
                    kind: "updateNote".to_string(),
                    path: Some(saved_path),
                    previous_path: Some(previous_path),
                });
                if target_path != original_path && original_path.exists() {
                    return Err("Updated note rename left the original file in place.".to_string());
                }
            }
            PreparedChange::Create { title, markdown } => {
                let saved_path = persist_note(notes_dir, &title, &markdown, None)?
                    .ok_or_else(|| "Created note produced no persisted path.".to_string())?;
                applied.push(AppliedNoteChange {
                    kind: "createNote".to_string(),
                    path: Some(saved_path),
                    previous_path: None,
                });
            }
            PreparedChange::Delete { path } => {
                vault_watcher::record_self_save(&path);
                fs::remove_file(&path).map_err(|err| err.to_string())?;
                applied.push(AppliedNoteChange {
                    kind: "deleteNote".to_string(),
                    path: None,
                    previous_path: Some(path.to_string_lossy().into_owned()),
                });
            }
        }
    }

    Ok(ApplyNoteChangesResult { applied })
}

fn prepare_note_changes(
    notes_dir: &Path,
    changes: &[NoteChange],
) -> Result<Vec<PreparedChange>, String> {
    let mut prepared = Vec::with_capacity(changes.len());
    let mut touched_paths = HashSet::<PathBuf>::new();

    for change in changes {
        match change {
            NoteChange::UpdateNote {
                path,
                base_content_hash,
                new_title,
                new_markdown,
            } => {
                let note_path = validate_existing_note_path(notes_dir, path)?;
                reject_chat_projection_path(&note_path)?;
                note::reject_chat_projection_write(new_markdown)?;
                reject_duplicate_touch(&mut touched_paths, &note_path)?;
                validate_content_hash(&note_path, base_content_hash)?;
                let target_path =
                    update_target_path(notes_dir, &note_path, new_title, new_markdown)?;
                if target_path != note_path && target_path.exists() {
                    return Err(format!(
                        "Cannot update note because target already exists: {}",
                        target_path.to_string_lossy()
                    ));
                }
                prepared.push(PreparedChange::Update {
                    original_path: note_path,
                    target_path,
                    title: new_title.trim().to_string(),
                    markdown: new_markdown.clone(),
                });
            }
            NoteChange::CreateNote {
                suggested_title,
                markdown,
            } => {
                note::reject_chat_projection_write(markdown)?;
                let title = suggested_title.trim().to_string();
                if title.is_empty() && markdown.trim().is_empty() {
                    return Err("Cannot create an empty untitled note.".to_string());
                }
                let target_path = create_target_path(notes_dir, &title, markdown)?;
                if target_path.exists() {
                    return Err(format!(
                        "Cannot create note because target already exists: {}",
                        target_path.to_string_lossy()
                    ));
                }
                reject_duplicate_touch(&mut touched_paths, &target_path)?;
                prepared.push(PreparedChange::Create {
                    title,
                    markdown: markdown.clone(),
                });
            }
            NoteChange::DeleteNote {
                path,
                base_content_hash,
            } => {
                let note_path = validate_existing_note_path(notes_dir, path)?;
                reject_chat_projection_path(&note_path)?;
                reject_duplicate_touch(&mut touched_paths, &note_path)?;
                validate_content_hash(&note_path, base_content_hash)?;
                prepared.push(PreparedChange::Delete { path: note_path });
            }
        }
    }

    Ok(prepared)
}

fn validate_existing_note_path(notes_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let notes_dir = fs::canonicalize(notes_dir).map_err(|err| err.to_string())?;
    let note_path = fs::canonicalize(path).map_err(|err| err.to_string())?;
    if !is_valid_note_path(&note_path, &notes_dir) {
        return Err(format!("Invalid note path: {path}"));
    }
    if !note_path.is_file() {
        return Err(format!("Note does not exist: {path}"));
    }
    Ok(note_path)
}

fn validate_content_hash(path: &Path, expected_hash: &str) -> Result<(), String> {
    let current = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let actual_hash = content_hash(&current);
    if actual_hash != expected_hash {
        return Err(format!(
            "Note changed since the proposal was created: {}",
            path.to_string_lossy()
        ));
    }
    Ok(())
}

fn reject_chat_projection_path(path: &Path) -> Result<(), String> {
    let markdown = fs::read_to_string(path).map_err(|err| err.to_string())?;
    note::reject_chat_projection_write(&markdown)
}

fn reject_duplicate_touch(seen: &mut HashSet<PathBuf>, path: &Path) -> Result<(), String> {
    if seen.insert(path.to_path_buf()) {
        Ok(())
    } else {
        Err(format!(
            "Proposal touches the same note more than once: {}",
            path.to_string_lossy()
        ))
    }
}

fn update_target_path(
    notes_dir: &Path,
    current_path: &Path,
    title: &str,
    markdown: &str,
) -> Result<PathBuf, String> {
    let file_stem = derive_file_stem_from_title_and_markdown(title, markdown);
    let parent = current_path.parent().unwrap_or(notes_dir);
    Ok(parent.join(format!("{file_stem}.md")))
}

fn create_target_path(notes_dir: &Path, title: &str, markdown: &str) -> Result<PathBuf, String> {
    let file_stem = derive_file_stem_from_title_and_markdown(title, markdown);
    Ok(notes_dir.join(format!("{file_stem}.md")))
}

#[cfg(test)]
mod tests {
    use super::{apply_note_changes, commit_note_review, preview_note_change, NoteChange, ProposedTextEdit};
    use crate::{
        semantic::db::content_hash,
        state::initialize_app_data_dir,
        test_support::{lock_test_env, TestDir},
    };
    use std::fs;

    fn setup(name: &str) -> TestDir {
        TestDir::new(name)
    }

    fn write_note(dir: &TestDir, file_name: &str, body: &str) -> (String, String) {
        let path = dir.path().join(file_name);
        fs::write(&path, body).expect("write note");
        (path.to_string_lossy().into_owned(), content_hash(body))
    }

    #[test]
    fn applies_update_when_hash_matches() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-app-data-update");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-update");
        let (path, hash) = write_note(&dir, "Original.md", "# Original\n\nOld");

        let result = apply_note_changes(
            dir.path(),
            &[NoteChange::UpdateNote {
                path: path.clone(),
                base_content_hash: hash,
                new_title: "Original".to_string(),
                new_markdown: "# Original\n\nNew".to_string(),
            }],
        )
        .expect("apply");

        assert_eq!(result.applied.len(), 1);
        assert!(fs::read_to_string(path).expect("read").contains("New"));
    }

    #[test]
    fn rejects_stale_update_without_writing() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-app-data-stale-update");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-stale-update");
        let (path, hash) = write_note(&dir, "Original.md", "# Original\n\nOld");
        fs::write(&path, "# Original\n\nChanged").expect("mutate");

        let error = apply_note_changes(
            dir.path(),
            &[NoteChange::UpdateNote {
                path: path.clone(),
                base_content_hash: hash,
                new_title: "Original".to_string(),
                new_markdown: "# Original\n\nNew".to_string(),
            }],
        )
        .expect_err("stale");

        assert!(error.contains("changed"));
        assert!(fs::read_to_string(path).expect("read").contains("Changed"));
    }

    #[test]
    fn rejects_stale_delete_without_deleting() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-app-data-stale-delete");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-stale-delete");
        let (path, hash) = write_note(&dir, "Delete.md", "# Delete\n\nOld");
        fs::write(&path, "# Delete\n\nChanged").expect("mutate");

        let error = apply_note_changes(
            dir.path(),
            &[NoteChange::DeleteNote {
                path: path.clone(),
                base_content_hash: hash,
            }],
        )
        .expect_err("stale");

        assert!(error.contains("changed"));
        assert!(std::path::Path::new(&path).exists());
    }

    #[test]
    fn applies_create_note() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-app-data-create");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-create");

        let result = apply_note_changes(
            dir.path(),
            &[NoteChange::CreateNote {
                suggested_title: "Created".to_string(),
                markdown: "# Created\n\nBody".to_string(),
            }],
        )
        .expect("apply");

        let path = result.applied[0].path.as_ref().expect("path");
        assert!(fs::read_to_string(path).expect("read").contains("Body"));
    }

    #[test]
    fn validates_all_changes_before_writing() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-app-data-atomic");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-atomic");
        let (path, hash) = write_note(&dir, "Original.md", "# Original\n\nOld");
        let (stale_path, stale_hash) = write_note(&dir, "Stale.md", "# Stale\n\nOld");
        fs::write(&stale_path, "# Stale\n\nChanged").expect("mutate");

        let error = apply_note_changes(
            dir.path(),
            &[
                NoteChange::UpdateNote {
                    path: path.clone(),
                    base_content_hash: hash,
                    new_title: "Original".to_string(),
                    new_markdown: "# Original\n\nNew".to_string(),
                },
                NoteChange::DeleteNote {
                    path: stale_path,
                    base_content_hash: stale_hash,
                },
            ],
        )
        .expect_err("stale");

        assert!(error.contains("changed"));
        assert!(fs::read_to_string(path).expect("read").contains("Old"));
    }

    #[test]
    fn rejects_updates_and_deletes_of_chat_projections() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-app-data-chat-projection");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-chat-projection");
        let body = "---\ngneauxghts:\n  id: transcript-1\n  kind: chatTranscript\n  chat_id: chat-1\n  part: 1\n  projection_hash: abc\n---\n\nTranscript";
        let (path, hash) = write_note(&dir, "Part 001.md", body);

        let update_error = apply_note_changes(
            dir.path(),
            &[NoteChange::UpdateNote {
                path: path.clone(),
                base_content_hash: hash.clone(),
                new_title: "Part 001".to_string(),
                new_markdown: "Changed".to_string(),
            }],
        )
        .expect_err("chat update rejected");
        assert!(update_error.contains("read-only"));

        let delete_error = apply_note_changes(
            dir.path(),
            &[NoteChange::DeleteNote {
                path: path.clone(),
                base_content_hash: hash,
            }],
        )
        .expect_err("chat delete rejected");
        assert!(delete_error.contains("read-only"));
        assert_eq!(fs::read_to_string(path).expect("read"), body);
    }

    #[test]
    fn previews_editable_body_without_writing_and_uses_utf16_offsets() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-preview-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-preview");
        let (path, _) = write_note(&dir, "Emoji.md", "# Emoji\n\nA 😀 old\n");

        let preview = preview_note_change(
            dir.path(),
            &path,
            &[ProposedTextEdit::Replace {
                old_text: "old".to_string(),
                new_text: "new".to_string(),
                context_before: None,
                context_after: None,
            }],
        )
        .expect("preview");

        assert_eq!(preview.base_editor_markdown, "A 😀 old");
        assert_eq!(preview.proposed_editor_markdown, "A 😀 new");
        assert_eq!(preview.hunks[0].base_from, "A 😀 ".encode_utf16().count());
        assert!(fs::read_to_string(&path).expect("read").contains("old"));
    }

    #[test]
    fn commit_review_returns_conflict_without_overwriting() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-review-commit-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-review-commit");
        let (path, hash) = write_note(&dir, "Review.md", "# Review\n\nOld");
        fs::write(&path, "# Review\n\nExternal").expect("external change");

        let result = commit_note_review(dir.path(), path.clone(), hash, "New".to_string())
            .expect("result");
        assert_eq!(result.status, "conflict");
        assert!(fs::read_to_string(path).expect("read").contains("External"));
    }

    #[test]
    fn commit_review_preserves_existing_path_and_frontmatter() {
        let _guard = lock_test_env();
        let app_data = TestDir::new("proposal-review-fixed-path-app-data");
        initialize_app_data_dir(app_data.path().to_path_buf()).expect("app data");
        let dir = setup("proposal-review-fixed-path");
        let raw = "---\ncustom: keep\n---\n# Display title\n\nOld";
        let (path, hash) = write_note(&dir, "Stable Path.md", raw);

        let result = commit_note_review(dir.path(), path.clone(), hash, "New".to_string())
            .expect("commit");

        assert_eq!(result.status, "committed");
        assert_eq!(
            result.applied.and_then(|applied| applied.path),
            Some(fs::canonicalize(&path).expect("canonical path").to_string_lossy().into_owned())
        );
        assert!(std::path::Path::new(&path).exists());
        assert!(!dir.path().join("Display title.md").exists());
        let saved = fs::read_to_string(path).expect("saved");
        assert!(saved.contains("custom: keep"));
        assert!(saved.ends_with("New"));
    }
}
