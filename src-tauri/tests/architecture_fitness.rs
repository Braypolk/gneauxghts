mod support;
use std::{fs, path::PathBuf};
use support::{compact, production_rust, rust_function};

fn repository_file(relative_path: &str) -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = if let Some(relative_path) = relative_path.strip_prefix("src-tauri/") {
        manifest_dir.join(relative_path)
    } else {
        manifest_dir
            .parent()
            .expect("src-tauri has a repository parent")
            .join(relative_path)
    };
    static CACHE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<PathBuf, String>>,
    > = std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(source) = cache.lock().unwrap().get(&path).cloned() {
        return source;
    }
    let source = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let source = if path.extension().is_some_and(|extension| extension == "rs") {
        production_rust(&source)
    } else {
        source
    };
    cache.lock().unwrap().insert(path, source.clone());
    source
}

fn repository_module_tree(path: &str) -> String {
    let source = repository_file(path);
    let parsed = syn::parse_file(&source).expect("parse module root");
    let base = std::path::Path::new(path).with_extension("");
    let mut combined = source.clone();
    for item in parsed.items {
        if let syn::Item::Mod(module) = item {
            if module.content.is_none() {
                let relative = base.join(format!("{}.rs", module.ident));
                let relative = relative.to_string_lossy();
                combined.push_str("\n");
                combined.push_str(&repository_module_tree(&relative));
            }
        }
    }
    combined
}

fn assert_contains_all(source: &str, expected: &[&str]) {
    let code = support::without_string_literals(source);
    for value in expected {
        let checked = if value.contains('"') { source } else { &code };
        assert!(
            compact(checked).contains(&compact(value)),
            "expected scoped source to contain `{value}`"
        );
    }
}

fn assert_contains_none(source: &str, forbidden: &[&str]) {
    for value in forbidden {
        assert!(
            !compact(source).contains(&compact(value)),
            "scoped source must not contain bypass `{value}`"
        );
    }
}

#[test]
fn sqlite_history_format_selection_stays_inside_note_timeline_storage() {
    let vault_config = repository_file("src-tauri/src/state/config.rs");

    assert_contains_none(&vault_config, &["sqlite-v1"]);
}

fn repository_rust_sources(relative_dir: &str) -> Vec<(PathBuf, String)> {
    fn collect(directory: &std::path::Path, sources: &mut Vec<(PathBuf, String)>) {
        for entry in fs::read_dir(directory).expect("read Rust source directory") {
            let path = entry.expect("read Rust source entry").path();
            if path.is_dir()
                && path
                    .file_name()
                    .is_some_and(|name| name != "tests" && name != "release_validation")
            {
                collect(&path, sources);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let source = fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
                sources.push((path, production_rust(&source)));
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut sources = Vec::new();
    collect(&manifest_dir.join(relative_dir), &mut sources);
    sources
}

#[test]
fn clean_task_commands_delegate_canonical_mutation_to_the_task_service() {
    let commands = repository_file("src-tauri/src/commands/task_commands.rs");

    assert_contains_none(
        &commands,
        &[
            "toggle_task_in_markdown",
            "delete_task_in_markdown",
            "atomic_write_note",
            "fs::write",
            "reconcile_note_tasks",
            "queue_note_update",
            "upsert_notes_index_entry",
        ],
    );
}

#[test]
fn ordinary_note_writers_use_typed_note_timeline_mutations() {
    let note_persistence = repository_file("src-tauri/src/commands/note_persistence.rs");
    let tasks = repository_file("src-tauri/src/services/task_mutation.rs");
    let task_production = tasks.as_str();

    for source in [note_persistence.as_str(), task_production] {
        assert_contains_none(
            source,
            &[
                "PostCommitNoteMutationService",
                ".apply_canonical_file(",
                "refresh_saved_note_best_effort",
                "build_indexed_note",
                "queue_note_update",
                "upsert_notes_index_entry",
                "reconcile_note_tasks",
            ],
        );
    }
}

#[test]
fn note_timeline_contracts_the_legacy_post_commit_boundary() {
    let services = repository_file("src-tauri/src/services/mod.rs");
    let catalog = repository_file("src-tauri/src/services/note_catalog.rs");
    let post_publication =
        repository_file("src-tauri/src/services/note_timeline/post_publication.rs");

    assert_contains_none(
        &services,
        &["mod note_mutation;", "pub(crate) mod note_mutation;"],
    );
    assert_contains_none(&post_publication, &["pub(crate)", "pub fn"]);
    assert_contains_none(
        &catalog,
        &[
            "PublicationCatalogOutcome",
            "synchronize_published_upsert",
            "synchronize_published_remove",
            "CatalogWriteMode::Save",
            "ProjectionTiming",
            "ProjectionPlan",
            "from_plan(",
        ],
    );
    assert_contains_none(
        &post_publication,
        &[
            "enum PublicationStage",
            "struct PublicationIssue",
            "struct CommittedMutationWarning",
        ],
    );

    for (path, source) in repository_rust_sources("src") {
        for legacy_entry in [
            "PostCommitNoteMutationService",
            "PostCommitNoteMutationOutcome",
            "services::note_mutation",
            ".apply_canonical_file(",
        ] {
            assert!(
                !source.contains(legacy_entry),
                "{} reintroduced legacy mutation entry `{legacy_entry}`",
                path.display()
            );
        }
    }
}

#[test]
fn vault_observers_and_lifecycle_commands_use_typed_note_timeline_entries() {
    let watcher = repository_file("src-tauri/src/vault_watcher.rs");
    let forgotten = repository_file("src-tauri/src/commands/forgotten_note_commands.rs");
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/observation.rs"),
        repository_file("src-tauri/src/services/note_timeline/lifecycle.rs"),
    ]
    .join("\n");

    assert_contains_none(
        &watcher,
        &[
            "OBSERVED_MISSING_NOTES",
            "classify_present_observation(",
            "VaultObservation::reattached(",
            "collect_markdown_files_recursively(",
        ],
    );
    assert_contains_none(&timeline, &["OBSERVED_MISSING_IDENTITIES"]);
    assert_contains_none(
        &forgotten,
        &[
            "prepare_notes_dir(true)",
            "publish_lifecycle(",
            "NoteLifecycleOperation::",
            "rollback_forgotten_metadata(",
            "retain_recovery_metadata",
        ],
    );
}

#[test]
fn task_document_mutation_commands_are_registered_without_generic_source_override() {
    let registration = repository_file("src-tauri/src/lib.rs");
    let sessions = repository_file("src/lib/features/notepad/session/session.ts");
    assert!(registration.contains("commands::task_commands::prepare_task_document_mutation"));
    assert!(registration.contains("commands::save_task_note"));
    assert_contains_none(&sessions, &["saveSource"]);
}

#[test]
fn timeline_commands_expose_only_the_closed_command_error_contract() {
    let history_commands = repository_file("src-tauri/src/commands/history_commands.rs");
    let root_commands = repository_file("src-tauri/src/commands.rs");
    let production_history_commands = history_commands.as_str();

    assert_contains_none(
        production_history_commands,
        &[
            "HistoryCommandError::from_cause",
            "to_ascii_lowercase",
            "Result<Vec<MissingNoteSummary>, String>",
        ],
    );

    for command in [
        "get_history_health",
        "get_note_history_health",
        "retry_history_recovery",
        "reset_corrupt_history",
    ] {
        let function = rust_function(&root_commands, command);
        assert!(
            function.contains("history_commands::HistoryCommandResult<"),
            "{command} must return the closed Note Timeline command error"
        );
    }
}

#[test]
fn note_timeline_owns_one_storage_neutral_role_limited_seam() {
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/domain.rs"),
        repository_file("src-tauri/src/services/note_timeline/history_mode.rs"),
        repository_file("src-tauri/src/services/note_timeline/current_content.rs"),
        repository_file("src-tauri/src/services/note_timeline/publication.rs"),
        repository_file("src-tauri/src/services/note_timeline/observation.rs"),
    ]
    .join("\n");

    assert_contains_none(
        &timeline,
        &[
            "rusqlite",
            "params!",
            "Connection",
            "Transaction",
            "Row<'_>",
            "PRAGMA",
            "journal_mode",
            "busy_timeout",
            "synchronous =",
            "history.sqlite3",
            "row_id",
            "rowid",
            "WAL",
            "wal_checkpoint",
            "impl HistoryModeGrant {\n    pub(crate) fn authorized",
            "impl RevisionIdentity {\n    pub(crate) fn",
            "impl LifecycleEventIdentity {\n    pub(crate) fn",
            "trait HistoryStore",
        ],
    );
}

#[test]
fn current_content_consumers_cross_one_timeline_owned_read_interface() {
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/current_content.rs"),
    ]
    .join("\n");
    let retrieval = repository_file("src-tauri/src/services/retrieval.rs");
    let search = repository_file("src-tauri/src/commands/search_commands.rs");
    let tasks = repository_file("src-tauri/src/commands/task_commands.rs");
    let atlas = repository_file("src-tauri/src/commands/atlas_commands.rs");

    assert_contains_none(
        &timeline,
        &[
            "pub(crate) struct CurrentContentRead",
            "pub(crate) struct CurrentContentEligibility",
            "pub(crate) enum CurrentContentReference",
            "begin_current_content_read",
            "fn invalidate(&mut self)",
        ],
    );

    for consumer in [&retrieval, &search, &tasks, &atlas] {
        assert_contains_none(
            consumer,
            &[
                "begin_current_content_read",
                "content_read.is_current()",
                ".allows_note(",
            ],
        );
    }

    for function in [
        rust_function(&retrieval, "retrieve_vault_notes"),
        rust_function(&search, "list_recent_notes"),
        rust_function(&search, "list_recent_focus"),
        rust_function(&search, "search_notes_hybrid_for_state"),
        rust_function(&search, "get_related_notes"),
        rust_function(&search, "retrieve_note_context"),
        rust_function(&tasks, "list_recent_tasks"),
        rust_function(&tasks, "list_tasks"),
        rust_function(&tasks, "get_task_group"),
        rust_function(&atlas, "get_vault_atlas"),
        rust_function(&atlas, "search_vault_atlas"),
    ] {
        assert_contains_all(function, &[".current_content(", ".read"]);
    }
    assert_contains_all(&retrieval, &["AllowedScope::policy("]);
    for vault_consumer in [&search, &tasks, &atlas] {
        assert_contains_all(vault_consumer, &["AllowedScope::vault()"]);
    }
}

#[test]
fn app_state_holds_one_encapsulated_note_timeline_runtime() {
    let index = repository_file("src-tauri/src/index.rs");
    let callers = repository_rust_sources("src")
        .into_iter()
        .filter(|(path, _)| {
            !path.ends_with("services/note_timeline.rs")
                && !path.to_string_lossy().contains("services/note_timeline/")
                && !path.ends_with("services/note_timeline/runtime.rs")
                && !path.ends_with("index.rs")
        })
        .map(|(_, source)| source)
        .collect::<Vec<_>>()
        .join("\n");

    assert_contains_none(
        &index,
        &[
            "note_timeline_history_recovered",
            "note_timeline_integrity",
            "note_timeline_observation_replay",
            "note_timeline_operations",
            "NoteTimelineOperationBarrier",
            "NoteTimelineIntegrityAttestation",
        ],
    );
    assert_contains_none(
        &callers,
        &[
            "NoteTimeline::new(",
            "NoteTimeline::bind(",
            "NoteTimelineRuntime::new(",
            "NoteTimelineOwnerToken",
            "begin_note_timeline_operation",
            "close_note_timeline_operations",
            "lock_note_timeline_observation_replay",
            "lock_note_timeline_history_recovery",
            "lock_note_timeline_integrity",
        ],
    );
}

#[test]
fn running_vault_is_bound_and_apply_only_stages_the_next_launch() {
    let commands = repository_file("src-tauri/src/commands.rs");
    let watcher = repository_file("src-tauri/src/vault_watcher.rs");
    let apply = rust_function(&commands, "set_vault_directory_for_state");

    assert_contains_all(apply, &["stage_notes_root(state.running_vault()"]);
    assert_contains_none(
        apply,
        &["clean_close", "vault_root()", "semantic_status_changed"],
    );
    assert_contains_none(&watcher, &["notes_root()"]);
}

#[test]
fn history_mode_commands_use_only_the_role_limited_note_timeline_access() {
    let commands = repository_file("src-tauri/src/commands/history_commands.rs");
    let history_store = repository_file("src-tauri/src/services/note_timeline/history_store.rs");
    let lib = repository_file("src-tauri/src/lib.rs");

    assert_contains_all(
        &commands,
        &["open_history_mode(NoteIdentity::new(note_id))"],
    );
    assert_contains_none(
        &commands,
        &["history_store", "rusqlite", "reconstruct_revision"],
    );
    assert_contains_all(
        &lib,
        &[
            "commands::history_commands::get_note_history_page",
            "commands::history_commands::get_missing_note_history_page",
            "commands::history_commands::get_note_history_revision",
        ],
    );
    let bounded_missing_page = rust_function(&history_store, "bounded_timeline_page");
    assert_contains_none(
        bounded_missing_page,
        &["COUNT(", "fn revisions(", "fn lifecycle_events("],
    );
}

#[test]
fn note_identity_continuity_stays_inside_the_timeline_and_catalog_boundary() {
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/domain.rs"),
        repository_file("src-tauri/src/services/note_timeline/publication.rs"),
        repository_file("src-tauri/src/services/note_timeline/observation.rs"),
        repository_file("src-tauri/src/services/note_timeline/lifecycle.rs"),
    ]
    .join("\n");
    let post_publication =
        repository_file("src-tauri/src/services/note_timeline/post_publication.rs");
    let index = repository_file("src-tauri/src/index.rs");
    let background = repository_file("src-tauri/src/services/background_index_queue.rs");
    let note_persistence = repository_file("src-tauri/src/commands/note_persistence.rs");
    let state_persistence = repository_file("src-tauri/src/state/persistence.rs");
    let forgotten = repository_file("src-tauri/src/commands/forgotten_note_commands.rs");
    let tasks = repository_file("src-tauri/src/services/task_mutation.rs");

    assert_contains_none(
        &timeline,
        &[
            "impl RevisionIdentity {\n    pub(crate) fn issue",
            "impl LifecycleEventIdentity {\n    pub(crate) fn issue",
        ],
    );
    assert_contains_none(
        &post_publication,
        &["repair_managed_note_identity", "atomic_write_note"],
    );
    assert_contains_none(&index, &["let mut candidate = index.clone()"]);
    assert_contains_none(
        &background,
        &["apply_lexical_projection(", "apply_task_projection("],
    );
    assert_contains_none(
        &note_persistence,
        &[
            "prepare_revision_publication(",
            "NoteMutation::",
            "build_saved_note_session",
        ],
    );
    assert_contains_none(
        &state_persistence,
        &[
            "persist_note_with_preparation",
            "prepared_context",
            "prepare: impl FnOnce",
        ],
    );
    for caller in [&tasks, &note_persistence] {
        assert_contains_none(
            caller,
            &[
                "PreparedHistoryIntent",
                "PreparedRevisionPublication",
                "NoteMutation::",
                "prepare_revision_publication",
                ".mutate(",
                "abandon_after",
                "with_note_file_mutation",
                "atomic_write_note",
                "atomic_create_note",
                "record_expected_write",
                "fs::write",
            ],
        );
    }
    assert_contains_none(
        &format!("{note_persistence}\n{forgotten}\n{tasks}"),
        &["repair_managed_note_identity"],
    );
}

#[test]
fn interactive_history_waits_run_offthread_and_readiness_stays_observational() {
    for (path, commands) in [
        (
            "src-tauri/src/commands.rs",
            vec![
                "bootstrap_app",
                "load_note_session",
                "save_note",
                "save_task_note",
                "toggle_task",
                "delete_task",
                "get_settings_view",
                "get_history_health",
                "get_note_history_health",
                "retry_history_recovery",
                "reset_corrupt_history",
            ],
        ),
        (
            "src-tauri/src/commands/history_commands.rs",
            vec![
                "get_note_history_page",
                "get_note_history_context",
                "get_note_history_revision",
                "get_note_history_diff",
                "finalize_note_editing_window",
                "list_missing_notes",
                "get_missing_note_history_page",
                "recover_missing_note",
                "delete_missing_notes",
                "preview_note_revision_restore",
                "restore_note_revision",
                "name_note_revision",
                "remove_note_revision_name",
                "clear_note_history",
                "clear_vault_history",
            ],
        ),
        (
            "src-tauri/src/commands/forgotten_note_commands.rs",
            vec![
                "forget_note",
                "list_forgotten_notes",
                "restore_forgotten_notes",
                "delete_forgotten_notes",
            ],
        ),
    ] {
        let source = repository_file(path);
        for command in commands {
            assert_contains_all(rust_function(&source, command), &["on_app_worker"]);
        }
    }
    let commands = repository_file("src-tauri/src/commands.rs");
    let worker = rust_function(&commands, "on_app_worker");
    assert_contains_all(worker, &["spawn_blocking", ".await"]);
    assert_contains_none(worker, &["HistoryCommandError", "note_timeline()"]);
    for command in ["bootstrap_app", "load_note_session"] {
        assert_contains_all(
            rust_function(&commands, command),
            &["prepare_notes_dir_with_state(false", "foreground_guard"],
        );
        assert_contains_none(
            rust_function(&commands, command),
            &["note_timeline()", "history_health"],
        );
    }
    let observer = rust_function(&commands, "get_history_readiness");
    assert_contains_none(
        observer,
        &[
            "resolve_note",
            "prepare_notes_dir",
            "await_history",
            "history_health",
            "rusqlite",
        ],
    );
}

#[test]
fn explicit_restart_has_one_joining_frontend_action_and_one_backend_owner() {
    let settings = repository_file("src/lib/features/settings/store.svelte.ts");
    let backend = repository_file("src-tauri/src/app/lifecycle.rs");
    let commands = repository_file("src-tauri/src/commands.rs");
    let app = repository_file("src-tauri/src/lib.rs");

    assert_contains_none(&settings, &["plugin-process", "relaunch("]);

    assert_contains_none(&backend, &["is_cleanly_closed("]);
    let chat_quiesce = backend
        .find("database\n            .quiesce_for_restart(app)")
        .unwrap();
    let semantic_quiesce = backend
        .find("state.semantic.quiesce_for_restart()")
        .unwrap();
    let watcher_stop = backend.find("watcher.stop_and_join()?").unwrap();
    let durable_settlement = backend.find("state.settle_restart_writes()?").unwrap();
    let projection_stop = backend
        .find("state.stop_rebuildable_projection_work()?")
        .unwrap();
    let timeline_close = backend
        .find(".clean_close(state.running_vault().root())")
        .unwrap();
    let semantic_finish = backend
        .find("state.semantic.finish_restart_shutdown()?")
        .unwrap();
    assert!(
        chat_quiesce < semantic_quiesce
            && semantic_quiesce < watcher_stop
            && watcher_stop < durable_settlement
            && durable_settlement < projection_stop
            && projection_stop < timeline_close
            && timeline_close < semantic_finish
    );
    assert_contains_all(
        rust_function(&commands, "prepare_restart"),
        &["prepare_restart_with_relaunch"],
    );
    assert_contains_all(
        rust_function(&commands, "prepare_restart_with_relaunch"),
        &["spawn_blocking", "prepare_restart(&app)"],
    );
    assert_contains_all(&app, &["api.prevent_exit()"]);
    assert_contains_none(&app, &[".clean_close(", ".is_cleanly_closed("]);
}

#[test]
fn pi_native_publication_and_reads_use_retained_domain_owners() {
    let publication = repository_file("src-tauri/src/pi_chat/publication.rs");
    let notes = repository_file("src-tauri/src/pi_chat/notes.rs");
    assert_contains_all(
        &publication,
        &[
            ".create_note_with_proof(",
            ".update_note_with_proof(",
            ".reconcile_publication(",
        ],
    );
    assert_contains_none(
        &publication,
        &["atomic_write_note", "atomic_create_note", "fs::write("],
    );
    assert_contains_all(&notes, &[".current_content(", ".read_note("]);
    for source in [&publication, &notes] {
        assert_contains_none(
            source,
            &[
                "open_history_mode(",
                "history_store::",
                "AgentRuntime",
                "ChatService",
            ],
        );
    }
}
