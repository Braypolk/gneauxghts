use crate::{
    note,
    semantic::db::content_hash,
    state::{derive_file_stem_from_title_and_markdown, is_valid_note_path, persist_note},
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
    let note_path = PathBuf::from(path);
    if !is_valid_note_path(&note_path, notes_dir) {
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
    use super::{apply_note_changes, NoteChange};
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
}
