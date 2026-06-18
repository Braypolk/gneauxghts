mod config;
mod persistence;
pub(crate) mod task_projection;

#[allow(unused_imports)]
pub(crate) use config::{
    app_data_dir, current_vault_info, default_notes_root, ensure_vault_scaffold,
    forgotten_notes_root, global_secrets_db_path, initialize_app_data_dir,
    initialize_documents_dir, notes_root, read_vault_config, read_vault_manifest_for,
    set_notes_root, set_notes_root_override, vault_data_dir, vault_root, write_vault_config,
    VaultConfig, VaultInfo, VaultManifest, VAULT_CACHE_DIR_NAME,
};
#[allow(unused_imports)]
pub(crate) use persistence::{
    db_insert_forgotten_note, db_remove_forgotten_note, db_set_last_opened_note_id,
    db_set_note_collapsed, db_set_note_hidden, db_set_note_order, db_set_recent_note_ids,
    derive_file_stem, derive_file_stem_from_title_and_markdown, is_forgotten_note_path,
    is_valid_note_path, persist_note, prune_recent_note_ids, prune_recent_note_ids_with_lookup,
    push_unique, read_state, read_state_with_lookup, resolve_note_id_from_path,
    resolve_note_path_by_id, touch_recent_note_id, validate_current_path,
    write_last_opened_and_recents, write_state, write_state_with_lookup, NoteIdLookup,
    PersistedForgottenNote, PersistedState,
};

#[cfg(test)]
mod tests {
    use super::{
        derive_file_stem, derive_file_stem_from_title_and_markdown, forgotten_notes_root,
        initialize_app_data_dir, persist_note, read_state, resolve_note_id_from_path, write_state,
        PersistedForgottenNote, PersistedState,
    };
    use crate::test_support::{TestDir, TEST_ENV_GUARD};
    use std::fs;

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
        // app-state.sqlite3 is now vault-local: point the active vault at the
        // test notes dir so the DB lands in an isolated temp `.gneauxghts`.
        super::set_notes_root_override(Some(notes_dir.to_path_buf())).expect("override notes root");
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let forgotten_dir = forgotten_notes_root(notes_dir);
        fs::create_dir_all(&forgotten_dir).expect("create forgotten dir");
        let live_forgotten_note = forgotten_dir.join("Live Note.md");
        fs::write(&live_forgotten_note, "# Live Note\n\nBody").expect("write forgotten note");
        let stale_forgotten_note = forgotten_dir.join("Missing Note.md");
        let live_note_id = resolve_note_id_from_path(&live_note).expect("live note id");

        write_state(
            notes_dir,
            &PersistedState {
                last_opened_note_id: Some("missing-note".to_string()),
                recent_note_ids: vec![
                    "missing-note".to_string(),
                    live_note_id.clone(),
                    live_note_id.clone(),
                ],
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
        assert_eq!(state.hidden_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.note_order_note_ids, vec![live_note_id.clone()]);
        assert_eq!(state.collapsed_note_ids, vec![live_note_id]);
        assert_eq!(state.forgotten_notes.len(), 1);
        assert_eq!(
            state.forgotten_notes[0].forgotten_path,
            live_forgotten_note.to_string_lossy()
        );
    }

    /// Cold-start prune retains unknown ids when the in-memory index has
    /// not yet been populated. This is the regression test for the
    /// first-note-switch hang: prior behaviour fell back to a per-id
    /// vault walk for any id the index did not know about, producing
    /// O(N_recents * N_files) disk IO on the first user-driven
    /// `open_note`. With a cold `Index { is_warm: false }` lookup the
    /// pruner now leaves unknown ids in place; they are dropped by the
    /// next call once the background prewarm has populated the index.
    #[test]
    fn read_state_with_cold_index_lookup_retains_unknown_ids() {
        use std::path::PathBuf;
        let _guard = match TEST_ENV_GUARD.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let app_data_dir = TestDir::new("state-app-data-cold-retain");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-cold-retain");
        let notes_dir = temp.path();
        super::set_notes_root_override(Some(notes_dir.to_path_buf())).expect("override notes root");
        // A real note exists on disk so write_state can persist; the
        // cold Index lookup pretends not to know about it.
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let live_note_id = resolve_note_id_from_path(&live_note).expect("live note id");

        // Persist the seed state without going through any pruner so the
        // unknown ids actually land in the database — production code
        // would never persist garbage like this directly, but we need a
        // stored row that proves the cold-read path leaves it alone.
        super::db_set_last_opened_note_id(Some(&live_note_id)).expect("seed last opened");
        super::db_set_recent_note_ids(&[live_note_id.clone(), "unknown-id".to_string()])
            .expect("seed recents");
        super::db_set_note_hidden("another-unknown", true).expect("seed hidden");
        super::db_set_note_order(&["yet-another-unknown".to_string()]).expect("seed order");

        // Cold index: the closure returns None for everything. Without
        // the cold-mode retain, this would walk the vault per id and
        // delete the unknown ids; with cold mode they must be retained.
        let empty: Box<dyn Fn(&str) -> Option<PathBuf>> = Box::new(|_| None);
        let cold_lookup = super::NoteIdLookup::Index {
            lookup: &*empty,
            is_warm: false,
        };
        let state = super::read_state_with_lookup(notes_dir, &cold_lookup).expect("read");
        assert_eq!(
            state.recent_note_ids,
            vec![live_note_id.clone(), "unknown-id".to_string()],
            "cold lookup must retain ids it cannot resolve",
        );
        assert_eq!(state.hidden_note_ids, vec!["another-unknown".to_string()]);
        assert_eq!(
            state.note_order_note_ids,
            vec!["yet-another-unknown".to_string()],
        );
        assert_eq!(state.last_opened_note_id, Some(live_note_id));
    }

    /// Warm-index prune drops unknown ids cleanly. The lookup closure
    /// here resolves only `live_note_id`; with `is_warm: true` the
    /// pruner trusts the index and drops everything else without
    /// touching the disk.
    #[test]
    fn read_state_with_warm_index_lookup_drops_unknown_ids() {
        use std::path::PathBuf;
        let _guard = match TEST_ENV_GUARD.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let app_data_dir = TestDir::new("state-app-data-warm-drop");
        initialize_app_data_dir(app_data_dir.path().to_path_buf()).expect("set app data dir");
        let temp = TestDir::new("state-warm-drop");
        let notes_dir = temp.path();
        super::set_notes_root_override(Some(notes_dir.to_path_buf())).expect("override notes root");
        let live_note = notes_dir.join("Live Note.md");
        fs::write(&live_note, "# Live Note\n\nBody").expect("write live note");
        let live_note_id = resolve_note_id_from_path(&live_note).expect("live note id");

        super::db_set_last_opened_note_id(Some("missing-id")).expect("seed last opened");
        super::db_set_recent_note_ids(&[live_note_id.clone(), "missing-id".to_string()])
            .expect("seed recents");
        super::db_set_note_hidden("missing-id", true).expect("seed hidden");
        super::db_set_note_order(&["missing-id".to_string()]).expect("seed order");

        let live_note_owned = live_note.clone();
        let live_id_for_closure = live_note_id.clone();
        let resolver: Box<dyn Fn(&str) -> Option<PathBuf>> = Box::new(move |id| {
            if id == live_id_for_closure {
                Some(live_note_owned.clone())
            } else {
                None
            }
        });
        let warm_lookup = super::NoteIdLookup::Index {
            lookup: &*resolver,
            is_warm: true,
        };
        let state = super::read_state_with_lookup(notes_dir, &warm_lookup).expect("read");
        assert_eq!(state.recent_note_ids, vec![live_note_id]);
        assert!(state.hidden_note_ids.is_empty());
        assert!(state.note_order_note_ids.is_empty());
        assert_eq!(state.last_opened_note_id, None);
    }
}
