mod config;
mod persistence;

#[allow(unused_imports)]
pub(crate) use config::{
    app_data_dir, current_vault_info, default_notes_root, forgotten_notes_root,
    initialize_app_data_dir, initialize_documents_dir, notes_root, read_vault_config,
    set_notes_root, write_vault_config, VaultConfig, VaultInfo,
};
#[allow(unused_imports)]
pub(crate) use persistence::{
    db_insert_forgotten_note, db_remove_forgotten_note, db_remove_task_timestamp,
    db_set_hidden_task_key, db_set_last_opened_note_id, db_set_note_collapsed, db_set_note_hidden,
    db_set_note_order, db_set_recent_note_ids, db_upsert_task_timestamp, derive_file_stem,
    derive_file_stem_from_title_and_markdown, is_forgotten_note_path, is_valid_note_path,
    persist_note, prune_recent_note_ids, prune_recent_note_ids_with_lookup, push_unique,
    read_state, read_state_with_lookup, resolve_note_id_from_path, resolve_note_path_by_id,
    touch_recent_note_id, validate_current_path, write_state, write_state_with_lookup,
    NoteIdLookup, PersistedForgottenNote, PersistedState, PersistedTaskTimestamps,
};

#[cfg(test)]
mod tests {
    use super::{
        derive_file_stem, derive_file_stem_from_title_and_markdown, forgotten_notes_root,
        initialize_app_data_dir, persist_note, read_state, resolve_note_id_from_path, write_state,
        PersistedForgottenNote, PersistedState, PersistedTaskTimestamps,
    };
    use crate::test_support::{TestDir, TEST_ENV_GUARD};
    use std::{collections::HashMap, fs};

    #[test]
    fn derive_file_stem_sanitizes_invalid_characters_and_truncates() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-derive");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let markdown =
            "#   Launch: /Alpha? *Plan* for <Agents> with a very long trailing title that should be trimmed nicely\n";
        let stem = derive_file_stem(markdown);

        assert!(!stem.contains('/'));
        assert!(!stem.contains('?'));
        assert!(!stem.contains('*'));
        assert!(!stem.contains('<'));
        assert!(stem.len() <= 80);
        assert!(stem.starts_with("Launch Alpha Plan for Agents"));
    }

    #[test]
    fn derive_file_stem_prefers_explicit_title() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-derive-title");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");

        let stem = derive_file_stem_from_title_and_markdown("  Title From Input  ", "Body text");
        assert_eq!(stem, "Title From Input");
    }

    #[test]
    fn persist_note_renames_existing_file_when_title_changes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-persist");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-persist-note");
        let notes_dir = temp.path();
        let original_path = notes_dir.join("First Note.md");
        fs::write(&original_path, "Old content").expect("write original note");

        let saved_path = persist_note(
            notes_dir,
            "Second Note",
            "Fresh content",
            Some(original_path.as_path()),
        )
        .expect("persist note")
        .expect("saved path");

        let renamed_path = notes_dir.join("Second Note.md");
        assert_eq!(saved_path, renamed_path.to_string_lossy());
        assert!(!original_path.exists());
        let saved_markdown = fs::read_to_string(&renamed_path).expect("read renamed note");
        assert!(saved_markdown.contains("gneauxghts:"));
        assert!(saved_markdown.ends_with("Fresh content"));
    }

    #[test]
    fn persist_note_keeps_existing_nested_folder_when_title_changes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-persist-nested");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-persist-note-nested");
        let notes_dir = temp.path();
        let nested_dir = notes_dir.join("Projects");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        let original_path = nested_dir.join("First Note.md");
        fs::write(&original_path, "Old content").expect("write original note");

        let saved_path = persist_note(
            notes_dir,
            "Second Note",
            "Fresh content",
            Some(original_path.as_path()),
        )
        .expect("persist note")
        .expect("saved path");

        let renamed_path = nested_dir.join("Second Note.md");
        assert_eq!(saved_path, renamed_path.to_string_lossy());
        assert!(!original_path.exists());
        assert!(renamed_path.exists());
    }

    #[test]
    fn resolve_note_path_by_id_finds_nested_notes() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-resolve-nested");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-resolve-note-nested");
        let notes_dir = temp.path();
        let nested_dir = notes_dir.join("Projects");
        let hidden_dir = notes_dir.join(".obsidian");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::create_dir_all(&hidden_dir).expect("create hidden dir");

        let nested_note = nested_dir.join("Roadmap.md");
        let hidden_note = hidden_dir.join("Ignore.md");
        fs::write(&nested_note, "# Roadmap\n\nBody").expect("write nested note");
        fs::write(&hidden_note, "# Ignore\n\nBody").expect("write hidden note");
        let note_id = resolve_note_id_from_path(&nested_note).expect("note id");

        let resolved = super::resolve_note_path_by_id(notes_dir, &note_id).expect("resolve path");

        assert_eq!(resolved, Some(nested_note));
    }

    #[test]
    fn read_state_prunes_invalid_paths_and_dedupes_entries() {
        let _guard = TEST_ENV_GUARD.lock().expect("lock test env");
        let app_data_dir = TestDir::new("state-app-data-prune");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-pruning");
        let notes_dir = temp.path();
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let forgotten_dir = forgotten_notes_root(notes_dir);
        fs::create_dir_all(&forgotten_dir).expect("create forgotten dir");
        let live_forgotten_note = forgotten_dir.join("Live Note.md");
        fs::write(&live_forgotten_note, "# Live Note\n\nBody").expect("write forgotten note");
        let stale_forgotten_note = forgotten_dir.join("Missing Note.md");
        let live_note_id = resolve_note_id_from_path(&live_note).expect("live note id");

        let mut task_timestamps = HashMap::new();
        task_timestamps.insert(
            "task-1".to_string(),
            PersistedTaskTimestamps {
                created_at_millis: 1,
                updated_at_millis: 2,
            },
        );

        write_state(
            notes_dir,
            &PersistedState {
                last_opened_note_id: Some("missing-note".to_string()),
                recent_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                hidden_task_keys: vec![String::new(), "task-1".to_string(), "task-1".to_string()],
                hidden_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                note_order_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                collapsed_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
                task_timestamps,
                forgotten_notes: vec![
                    PersistedForgottenNote {
                        forgotten_path: stale_forgotten_note.to_string_lossy().into_owned(),
                        original_path: live_note.to_string_lossy().into_owned(),
                        title: "Missing forgotten".to_string(),
                        forgotten_at_millis: 10,
                        purge_after_days: 7,
                        purge_at_millis: 20,
                    },
                    PersistedForgottenNote {
                        forgotten_path: live_forgotten_note.to_string_lossy().into_owned(),
                        original_path: live_note.to_string_lossy().into_owned(),
                        title: "Live forgotten".to_string(),
                        forgotten_at_millis: 30,
                        purge_after_days: 7,
                        purge_at_millis: 40,
                    },
                    PersistedForgottenNote {
                        forgotten_path: live_forgotten_note.to_string_lossy().into_owned(),
                        original_path: live_note.to_string_lossy().into_owned(),
                        title: "Duplicate forgotten".to_string(),
                        forgotten_at_millis: 50,
                        purge_after_days: 7,
                        purge_at_millis: 60,
                    },
                ],
            },
        )
        .expect("write state");

        let state = read_state(notes_dir).expect("read state");
        assert_eq!(state.last_opened_note_id, None);
        assert_eq!(state.recent_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.hidden_task_keys, vec!["task-1".to_string()]);
        assert_eq!(state.hidden_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.note_order_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.collapsed_note_ids, vec![live_note_id]);
        assert_eq!(state.task_timestamps.len(), 1);
        assert_eq!(state.forgotten_notes.len(), 1);
        assert_eq!(
            state.forgotten_notes[0].forgotten_path,
            live_forgotten_note.to_string_lossy()
        );
    }
}
