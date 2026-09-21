use serde_json::Value;
use std::{fs, path::PathBuf};

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
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

fn assert_contains_all(source: &str, expected: &[&str]) {
    for value in expected {
        assert!(
            source.contains(value),
            "expected scoped source to contain `{value}`"
        );
    }
}

fn assert_contains_none(source: &str, forbidden: &[&str]) {
    for value in forbidden {
        assert!(
            !source.contains(value),
            "scoped source must not contain bypass `{value}`"
        );
    }
}

fn rust_function<'a>(source: &'a str, name: &str) -> &'a str {
    let marker = format!("fn {name}(");
    let start = source
        .find(&marker)
        .or_else(|| source.find(&format!("fn {name}<")))
        .unwrap_or_else(|| panic!("expected Rust function `{name}`"));
    let body_start = source[start..]
        .find('{')
        .map(|offset| start + offset)
        .unwrap_or_else(|| panic!("expected body for Rust function `{name}`"));
    let mut depth = 0usize;
    for (offset, byte) in source.as_bytes()[body_start..].iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return &source[start..=body_start + offset];
                }
            }
            _ => {}
        }
    }
    panic!("unterminated Rust function `{name}`")
}

#[test]
fn sqlite_history_format_selection_stays_inside_note_timeline_storage() {
    let vault_config = repository_file("src-tauri/src/state/config.rs");
    let history_store = repository_file("src-tauri/src/services/note_timeline/history_store.rs");

    assert_contains_none(&vault_config, &["sqlite-v1"]);
    assert_contains_all(
        &history_store,
        &["pub(super) const HISTORY_FORMAT: &str = \"sqlite-v1\""],
    );
}

fn repository_rust_sources(relative_dir: &str) -> Vec<(PathBuf, String)> {
    fn collect(directory: &std::path::Path, sources: &mut Vec<(PathBuf, String)>) {
        for entry in fs::read_dir(directory).expect("read Rust source directory") {
            let path = entry.expect("read Rust source entry").path();
            if path.is_dir() {
                collect(&path, sources);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let source = fs::read_to_string(&path)
                    .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
                sources.push((path, source));
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

    assert_contains_all(
        &commands,
        &[
            "pub(crate) fn toggle_task_with_view",
            "pub(crate) fn delete_task_with_view",
            "mutate_task_with_view(",
            "TaskMutationService::new(&state).commit(",
        ],
    );
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
    let chat_commands = repository_file("src-tauri/src/commands/chat_commands.rs");
    let chat = repository_file("src-tauri/src/chat.rs");
    let proposals = repository_file("src-tauri/src/commands/proposal_commands.rs");
    let tasks = repository_file("src-tauri/src/services/task_mutation.rs");
    let task_production = tasks
        .split("#[cfg(test)]")
        .next()
        .expect("task mutation production source");

    assert_contains_all(
        &note_persistence,
        &[
            ".save_note(source, &title, &markdown, current_path)",
            "MutationSource::Editor",
            "pub(crate) fn persist_task_note_session_with_outcome(",
            "MutationSource::TaskAction",
            "commit_warning",
        ],
    );
    assert_contains_all(
        &chat_commands,
        &[
            "projection_conflict_conversion(",
            "persist_note_session_with_outcome(",
            "settle_committed_projection_conversion(",
            "restore_projection_after_conflict(",
        ],
    );
    assert_contains_none(
        chat.split("#[cfg(test)]")
            .next()
            .expect("chat production source"),
        &[
            "unique_converted_note_path(",
            "fs::write(&target, ordinary_note)",
        ],
    );
    assert_contains_all(
        &proposals,
        &[
            "fn synchronize_applied_change(",
            ".note_timeline()\n        .mutate(NoteMutation::accepted_chat_proposal(",
            "synchronize_applied_change(&state, &result",
        ],
    );
    assert_contains_all(
        &tasks,
        &[
            "self.state.note_timeline().mutate(NoteMutation::task_action(",
            "outcome.report_degraded(\"task mutation\")",
        ],
    );

    for source in [&note_persistence, &proposals, task_production] {
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
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/publication.rs"),
    ]
    .join("\n");
    let post_publication =
        repository_file("src-tauri/src/services/note_timeline/post_publication.rs");
    let architecture = repository_file("ARCHITECTURE.md");

    assert_contains_all(
        &timeline,
        &[
            "mod post_publication;",
            "post_publication::synchronize_canonical_file(",
        ],
    );
    assert_contains_none(
        &services,
        &["mod note_mutation;", "pub(crate) mod note_mutation;"],
    );
    assert_contains_all(
        &post_publication,
        &[
            "pub(super) fn synchronize_canonical_file(",
            "pub(super) struct PublicationOutcome",
            "struct PublicationCatalogOutcome",
        ],
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
    assert_contains_all(
        &post_publication,
        &[
            "DeferredCatalogProjection::lexical(",
            "MutationWarningStage::TaskProjectionUpsert",
            "MutationWarningStage::SemanticUpdate",
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
    assert_contains_none(
        &architecture,
        &[
            "PostCommitNoteMutationService",
            "future canonical owner",
            "future canonical owner for ordinary-note mutations",
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
    let app = repository_file("src-tauri/src/lib.rs");
    let forgotten = repository_file("src-tauri/src/commands/forgotten_note_commands.rs");
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/observation.rs"),
        repository_file("src-tauri/src/services/note_timeline/lifecycle.rs"),
    ]
    .join("\n");

    assert_contains_all(
        &watcher,
        &[
            "fn observe_timeline(",
            "timeline.observe(observation)",
            "VaultObservation::renamed(",
            "VaultObservation::moved(",
            "VaultObservation::external_edit(",
            "VaultObservation::missing(",
            "fn observe_reconciliation_state(",
            "VaultObservation::reconciled_state(",
            "reconciliation_observations(",
            "reconcile_full_vault_scan_observing(",
        ],
    );
    assert_contains_none(
        &watcher,
        &[
            "OBSERVED_MISSING_NOTES",
            "classify_present_observation(",
            "VaultObservation::reattached(",
            "collect_markdown_files_recursively(",
        ],
    );
    assert_contains_all(
        &timeline,
        &[
            "prepare_safe_note_identity_reattachment(&path, note_id.as_str())",
            "detach_indexed_note_identity(&path)",
            "LifecycleEventKind::Reattached",
        ],
    );
    assert_contains_none(&timeline, &["OBSERVED_MISSING_IDENTITIES"]);
    assert_contains_all(
        &app,
        &[
            "name(\"vault-watcher-startup\".to_string())",
            "state.note_timeline().initialize_existing_notes(notes_dir)",
        ],
    );
    assert_contains_all(
        &forgotten,
        &[
            ".forget_note(note_path, retention_days)",
            ".recover_forgotten_note(&forgotten_note)",
            ".purge_selected_forgotten_note(",
        ],
    );
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
fn dirty_document_task_prepare_contract_is_registered_and_fixture_backed() {
    let fixture: Value = serde_json::from_str(&repository_file(
        "src-tauri/test-fixtures/contracts/command-payloads.json",
    ))
    .expect("parse command contract fixture");
    let command = &fixture["commands"]["prepare_task_document_mutation"];
    let args = command["args"]
        .as_object()
        .expect("prepare task mutation fixture arguments");
    let result = command["result"]
        .as_object()
        .expect("prepare task mutation fixture result");

    assert_eq!(
        args.keys().map(String::as_str).collect::<Vec<_>>(),
        ["bodyHash", "mutationKind", "taskId", "workingMarkdown"]
    );
    assert_eq!(
        result.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "baseHash",
            "noteId",
            "notePath",
            "taskId",
            "updatedEditorMarkdown"
        ]
    );

    let registration = repository_file("src-tauri/src/lib.rs");
    let frontend = repository_file("src/lib/features/tasks/openDocumentTaskMutation.ts");
    let sessions = repository_file("src/lib/features/notepad/session/session.ts");
    let persistence =
        repository_file("src/lib/features/notepad/orchestration/persistenceController.ts");
    assert!(registration.contains("commands::task_commands::prepare_task_document_mutation"));
    assert!(registration.contains("commands::save_task_note"));
    assert!(frontend.contains("'prepare_task_document_mutation'"));
    assert!(frontend.contains("attributeTaskActionSave"));
    assert!(sessions.contains("invoke<NoteSession>(\"save_task_note\""));
    assert_contains_all(
        &persistence,
        &[
            "taskActionAttributions",
            "taskAttribution.revision === note.operation.revision",
            "taskAttribution.markdown === markdown",
            "params.saveTaskNoteSession",
        ],
    );
    assert_contains_none(&sessions, &["saveSource"]);
}

#[test]
fn timeline_commands_expose_only_the_closed_command_error_contract() {
    let history_commands = repository_file("src-tauri/src/commands/history_commands.rs");
    let root_commands = repository_file("src-tauri/src/commands.rs");
    let production_history_commands = history_commands
        .split("#[cfg(test)]\nmod tests")
        .next()
        .expect("history command production source");

    assert_contains_all(
        production_history_commands,
        &[
            "pub(crate) struct HistoryCommandError",
            "pub(crate) type HistoryCommandResult<T>",
            "HistoryCommandError::from_history_error",
        ],
    );
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
fn chat_requests_use_typed_intent_and_one_correlated_run_context() {
    let chat = repository_file("src-tauri/src/chat.rs");
    let commands = repository_file("src-tauri/src/commands/chat_commands.rs");

    assert_contains_all(
        &chat,
        &[
            "pub(crate) enum ChatRequest",
            "New {",
            "Retry {",
            "struct ActiveChatRun",
            "request: ChatRequest",
            "async fn run_request(&self, run: ActiveChatRun)",
            "async fn run_agent_response(\n        &self,\n        run: &ActiveChatRun,",
        ],
    );
    assert_contains_all(&commands, &["ChatRequest::New", "ChatRequest::Retry"]);
    assert_contains_none(
        &chat,
        &[
            "existing_user_message_id",
            "async fn run_request(\n        &self,\n        app:",
        ],
    );
}

#[test]
fn agent_permissions_stay_product_owned_transient_and_pre_tool() {
    let permissions = repository_file("src-tauri/src/agent_permissions.rs");
    let runtime = repository_file("src-tauri/src/agent_runtime.rs");
    let chat = repository_file("src-tauri/src/chat.rs");
    let registration = repository_file("src-tauri/src/lib.rs");

    assert_contains_all(
        &permissions,
        &[
            "pub(crate) struct AgentPermissionBroker",
            "pub(crate) fn for_run",
            "fn production_requirements()",
            "pub(crate) async fn request_for_tool",
            "AgentPermissionDecision::AllowForSession",
            "state.run_grants.retain(|grant| grant.run_id != run_id)",
        ],
    );
    assert_contains_all(
        &runtime,
        &[
            "async fn on_tool_call",
            ".request_for_tool(",
            "Self::PermissionRequested { .. }",
            "Self::PermissionResolved { .. }",
        ],
    );
    assert_contains_all(
        &chat,
        &[
            "envelope.event.is_durable()",
            "permission_broker.finish_run(&run.run_id)",
            "AgentPermissionBoundary::for_run(",
            "pub(crate) fn decide_agent_permission",
        ],
    );
    assert!(registration.contains("commands::chat_commands::chat_decide_permission"));
    assert_contains_none(&permissions, &["rig_agent", "rig_core", "fs::write"]);
}

#[test]
fn semantic_state_owns_one_work_queue_and_worker_context() {
    let semantic = repository_file("src-tauri/src/semantic/mod.rs");
    let indexer = repository_file("src-tauri/src/semantic/indexer.rs");

    assert_contains_all(
        &semantic,
        &[
            "work_queue: SemanticWorkQueue",
            "WarmupScheduling::DeferredUntilAnnReady",
            "WarmupScheduling::WakeImmediately",
            "IndexingWorkerContext {",
            ".release_initial_scan(&context.runtime, &context.debug)",
        ],
    );
    assert_contains_none(
        &semantic,
        &["signal_tx:", "wake_pending:", "fn request_wake(&self)"],
    );
    assert_contains_all(
        &indexer,
        &[
            "pub(crate) struct SemanticWorkQueue",
            "pub(crate) struct IndexingWorkerContext",
            "struct SemanticDocumentBatch",
            "fn process_pending_jobs(context: &IndexingWorkerContext)",
        ],
    );
    assert_contains_none(&indexer, &["#[allow(clippy::too_many_arguments)]"]);
}

#[test]
fn note_timeline_owns_one_storage_neutral_role_limited_seam() {
    let services = repository_file("src-tauri/src/services/mod.rs");
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/domain.rs"),
        repository_file("src-tauri/src/services/note_timeline/history_mode.rs"),
        repository_file("src-tauri/src/services/note_timeline/current_content.rs"),
        repository_file("src-tauri/src/services/note_timeline/publication.rs"),
        repository_file("src-tauri/src/services/note_timeline/observation.rs"),
    ]
    .join("\n");
    let history_store = repository_file("src-tauri/src/services/note_timeline/history_store.rs");

    assert!(services.contains("pub(crate) mod note_timeline;"));
    assert_contains_all(
        &timeline,
        &[
            "pub(crate) struct NoteTimeline",
            "pub(crate) fn mutate(",
            "pub(crate) fn observe(",
            "pub(crate) fn history_mode(",
            "pub(crate) fn current_content(",
            "pub(crate) struct HistoryModeAccess",
            "pub(crate) struct CurrentContentAccess",
            "pub(crate) struct HistoryModeGrant",
            "pub(crate) struct NoteMutationResult",
            "pub(crate) struct NoteMutationWarning",
            "pub(crate) enum MutationWarningStage",
            "identity_type!(RevisionIdentity);",
            "identity_type!(LifecycleEventIdentity);",
            "mod history_store;",
            "pub(crate) fn prepare_revision_publication(",
        ],
    );
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
    assert_contains_all(
        &history_store,
        &[
            "use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};",
            "PRAGMA journal_mode=WAL;",
            "PRAGMA foreign_keys=ON;",
            "PRAGMA synchronous=FULL;",
            "PRAGMA busy_timeout=5000;",
            "configure_wal_bounds(&connection)?;",
            ".pragma_update(None, \"wal_autocheckpoint\"",
            "\"journal_size_limit\"",
            "history.sqlite3",
            "const LINE_DELTA_MAGIC: &[u8; 4] = b\"NTL1\";",
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

    assert_contains_all(
        &timeline,
        &[
            "pub(crate) trait CurrentContentProjection",
            "pub(crate) trait CurrentContentItem",
            "fn current_note_identity(&self)",
            "pub(crate) fn read<",
            "pub(crate) async fn read_async<",
            "pub(crate) fn current_content(",
            "scope: AllowedScope",
        ],
    );
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
        assert_contains_all(consumer, &[".current_content(", ".read"]);
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
        rust_function(&search, "search_notes_hybrid"),
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
    let runtime = repository_file("src-tauri/src/services/note_timeline/runtime.rs");
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

    assert_contains_all(
        &index,
        &[
            "note_timeline: NoteTimelineRuntime",
            "pub(crate) struct NoteTimelineOwnerToken(());",
            "let note_timeline = NoteTimelineRuntime::new(",
            "NoteTimelineOwnerToken(()),",
            "running_vault.root().to_path_buf(),",
            "running_vault.app_local_observation_dir().to_path_buf(),",
            "pub(crate) fn note_timeline(&self) -> NoteTimeline<'_>",
        ],
    );
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
    assert_contains_all(
        &runtime,
        &[
            "pub(crate) struct NoteTimelineRuntime",
            "pub(super) store: Arc<history_store::Store>",
            "store: Arc::clone(&self.store)",
            "struct NoteTimelineOperationBarrier",
            "fn begin_operation(",
            "fn close_operations(",
            "fn with_observation_replay<T>(",
            "fn ensure_history_recovered(",
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
    let app = repository_file("src-tauri/src/lib.rs");
    let index = repository_file("src-tauri/src/index.rs");
    let commands = repository_file("src-tauri/src/commands.rs");
    let watcher = repository_file("src-tauri/src/vault_watcher.rs");
    let apply = rust_function(&commands, "set_vault_directory_for_state");

    assert_contains_all(
        &app,
        &[
            "let running_vault = state::RunningVault::resolve(app_data_dir.clone())?;",
            "AppState::new_with_running_vault(",
        ],
    );
    assert_contains_all(
        &index,
        &[
            "running_vault: RunningVault",
            "app_state_storage: AppStateStorage",
            "pub(crate) fn running_vault(&self) -> &RunningVault",
        ],
    );
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
    let timeline = [
        repository_file("src-tauri/src/services/note_timeline.rs"),
        repository_file("src-tauri/src/services/note_timeline/domain.rs"),
        repository_file("src-tauri/src/services/note_timeline/history_mode.rs"),
    ]
    .join("\n");
    let history_store = repository_file("src-tauri/src/services/note_timeline/history_store.rs");
    let lib = repository_file("src-tauri/src/lib.rs");

    assert_contains_all(
        &commands,
        &[
            "open_history_mode(NoteIdentity::new(note_id))",
            ".page(cursor.as_deref(), limit)",
            ".revision(revision_id)",
        ],
    );
    assert_contains_none(
        &commands,
        &["history_store", "rusqlite", "reconstruct_revision"],
    );
    assert_contains_all(
        &timeline,
        &[
            "pub(crate) struct HistoryModeAccess",
            "self.history_mode(HistoryModeGrant::authorized(note_id))",
        ],
    );
    assert_contains_all(
        &lib,
        &[
            "commands::history_commands::get_note_history_page",
            "commands::history_commands::get_missing_note_history_page",
            "commands::history_commands::get_note_history_revision",
        ],
    );
    let bounded_missing_page = history_store
        .split("pub(super) fn bounded_timeline_page(")
        .nth(1)
        .and_then(|source| source.split("pub(super) fn current_path(").next())
        .expect("bounded Missing Note paging implementation");
    assert_contains_all(
        bounded_missing_page,
        &["record_count", "next_record.take()"],
    );
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
    let catalog = repository_file("src-tauri/src/services/note_catalog.rs");
    let background = repository_file("src-tauri/src/services/background_index_queue.rs");
    let note_persistence = repository_file("src-tauri/src/commands/note_persistence.rs");
    let state_persistence = repository_file("src-tauri/src/state/persistence.rs");
    let forgotten = repository_file("src-tauri/src/commands/forgotten_note_commands.rs");
    let proposals = repository_file("src-tauri/src/commands/proposal_commands.rs");
    let proposal_writers = repository_file("src-tauri/src/proposals.rs");
    let tasks = repository_file("src-tauri/src/services/task_mutation.rs");
    let architecture = repository_file("ARCHITECTURE.md");
    let invariants = repository_file("docs/architecture/behavior-invariants.md");

    assert_contains_all(
        &timeline,
        &[
            "fn issue() -> Self",
            "RevisionIdentity::issue()",
            "LifecycleEventIdentity::issue()",
            "prepare_note_identity_transfer(previous_path, &path)",
            "prepare_safe_note_identity_reattachment(",
            "detach_indexed_note_identity(&path)",
        ],
    );
    assert_contains_none(
        &timeline,
        &[
            "impl RevisionIdentity {\n    pub(crate) fn issue",
            "impl LifecycleEventIdentity {\n    pub(crate) fn issue",
        ],
    );
    assert_contains_all(&timeline, &["crate::note::repair_managed_note_identity("]);
    assert_contains_all(
        &post_publication,
        &["prepare_note_identity_transfer(previous_path, &path)"],
    );
    assert_contains_none(
        &post_publication,
        &["repair_managed_note_identity", "atomic_write_note"],
    );
    assert_contains_all(
        &index,
        &[
            "pending_identity_transfers",
            "detached_identity_owners",
            "fn reserve_identity_transfer(",
            "expected_canonical_hash",
            "catalog_projection_retries",
        ],
    );
    assert_contains_all(
        &catalog,
        &[
            "struct CatalogProjectionRetries",
            "struct PathProjectionState",
            "struct ProjectionWork",
            "self.retries.apply(",
            "apply_task_projection(&latest_mutation)",
        ],
    );
    assert_contains_none(&index, &["let mut candidate = index.clone()"]);
    assert_contains_all(
        &post_publication,
        &["catalog_projection_retries\n            .apply("],
    );
    assert_contains_all(&background, &["projection_retries.apply("]);
    assert_contains_none(
        &background,
        &["apply_lexical_projection(", "apply_task_projection("],
    );
    assert_contains_all(&timeline, &["pub(crate) fn prepare_publication("]);
    assert_contains_all(&proposals, &["timeline.prepare_revision_publication("]);
    assert_contains_all(&tasks, &["timeline.prepare_revision_publication("]);
    assert_contains_all(
        &note_persistence,
        &[".save_note(source, &title, &markdown, current_path)"],
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
    assert_contains_all(
        &timeline,
        &[
            "pub(crate) fn save_note(",
            "self.runtime.is_note_ready(&note_id)?",
            "history_store::has_pending_replay(&self.runtime.store)?",
        ],
    );
    let compact_timeline = timeline.split_whitespace().collect::<String>();
    assert_contains_all(
        &compact_timeline,
        &["history_store::finalize_publication(&self.runtime.store,&history_intent,source,&path,canonical"],
    );
    assert_contains_all(&proposals, &["with_note_file_mutation(||"]);
    assert_contains_all(&tasks, &["crate::state::with_note_file_mutation(||"]);
    assert_contains_all(
        &timeline,
        &[
            "pub(crate) struct PreparedHistoryIntent",
            "history_intent: PreparedHistoryIntent",
            "pub(crate) fn abandon_after_publication_failure(",
            "store: Option<history_store::Store>",
        ],
    );
    assert_contains_all(
        &proposal_writers,
        &[
            "commit_prepared_note_review(",
            "commit_prepared_note_creation_at_path(",
            "publication: &PreparedRevisionPublication",
        ],
    );
    assert_contains_all(&proposals, &["&prepared"]);
    assert_contains_none(
        &format!("{note_persistence}\n{forgotten}\n{proposals}\n{tasks}"),
        &["repair_managed_note_identity"],
    );
    assert!(architecture.contains("Note Identity follows the logical note"));
    assert!(invariants.contains("Note Identity follows the note"));
}

#[test]
fn ordinary_chat_history_is_on_demand_and_cannot_mint_history_mode_access() {
    let tools = repository_file("src-tauri/src/agent_tools.rs");
    let history_tool = repository_file("src-tauri/src/agent_tools/current_history.rs");
    assert_contains_all(
        &tools,
        &[
            ".tool(SearchEvidenceTool(self.clone()))",
            ".tool(ReadEvidenceTool(self.clone()))",
            ".tool(ResearchNotesTool(self.clone()))",
        ],
    );
    let evidence = repository_file("src-tauri/src/services/evidence.rs");
    assert_contains_all(
        &evidence,
        &[
            ".current_content(AllowedScope::policy(",
            ".provenance(",
            ".activity(",
            "validate_citation",
        ],
    );
    for source in [
        &tools,
        &history_tool,
        &evidence,
        &repository_file("src-tauri/src/agent_tools/research.rs"),
        &repository_file("src-tauri/src/chat.rs"),
    ] {
        assert_contains_none(
            source,
            &[
                "open_history_mode(",
                "HistoryModeGrant",
                "history_store::",
                ".reconstruct(",
            ],
        );
    }
    for function in [
        "active_note_context",
        "selected_context_prompt",
        "explicit_wikilink_context",
    ] {
        assert_contains_none(
            rust_function(&tools, function),
            &[
                ".provenance(",
                ".provenance_page(",
                "current_history_payload",
                ".activity(",
            ],
        );
    }
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
        (
            "src-tauri/src/commands/proposal_commands.rs",
            vec!["commit_agent_proposal"],
        ),
        (
            "src-tauri/src/commands/chat_commands.rs",
            vec!["chat_archive_conversation"],
        ),
    ] {
        let source = repository_file(path);
        for command in commands {
            assert!(source.contains(&format!(
                "pub(crate) async fn {command}<R: tauri::Runtime>("
            )));
            assert_contains_all(rust_function(&source, command), &["on_app_worker"]);
        }
    }
    let commands = repository_file("src-tauri/src/commands.rs");
    let worker = rust_function(&commands, "on_app_worker");
    assert_contains_all(
        worker,
        &[
            "spawn_blocking",
            "try_state::<AppState>",
            "operation(&state)",
            ".await",
        ],
    );
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
    assert_contains_all(observer, &["history_readiness(note.as_ref())"]);
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
    let frontend = repository_file("src/lib/app/restartLifecycle.svelte.ts");
    let settings = repository_file("src/lib/features/settings/store.svelte.ts");
    let backend = repository_file("src-tauri/src/app/lifecycle.rs");
    let commands = repository_file("src-tauri/src/commands.rs");
    let app = repository_file("src-tauri/src/lib.rs");

    assert_contains_all(
        &frontend,
        &[
            "await awaitPendingNoteSave()",
            "invoke<PrepareRestartReceipt>('prepare_restart')",
            "await relaunch()",
            "workspaceMutationsBlocked",
            "this.phase === 'readyToRestart'",
        ],
    );
    let save = frontend.find("await awaitPendingNoteSave()").unwrap();
    let prepare = frontend
        .find("invoke<PrepareRestartReceipt>('prepare_restart')")
        .unwrap();
    let relaunch = frontend.find("await relaunch()").unwrap();
    assert!(save < prepare && prepare < relaunch);
    assert_contains_none(&settings, &["plugin-process", "relaunch("]);

    assert_contains_all(
        &backend,
        &[
            "pub(crate) struct AppLifecycle",
            "self.settled.wait(state)",
            "chat.quiesce_for_restart()",
            "state.semantic.quiesce_for_restart()",
            "watcher.stop_and_join()?",
            "state.settle_restart_writes()?",
            "state.stop_rebuildable_projection_work()?",
            ".clean_close(state.running_vault().root())",
            "state.semantic.finish_restart_shutdown()?",
        ],
    );
    assert_contains_none(&backend, &["is_cleanly_closed("]);
    let chat_quiesce = backend.find("chat.quiesce_for_restart()").unwrap();
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
        &["spawn_blocking", "prepare_restart(&app)"],
    );
    assert_contains_all(&app, &["ordinary-exit-settlement", "api.prevent_exit()"]);
    assert_contains_none(&app, &[".clean_close(", ".is_cleanly_closed("]);
}
