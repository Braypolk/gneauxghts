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
            "NoteTimeline::new(state).mutate(",
            "NoteMutation::editor(",
            "NoteMutation::note_creation(",
            "pub(crate) fn persist_task_note_session_with_outcome(",
            "NoteMutation::task_action(",
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
            "NoteTimeline::new(state).mutate(NoteMutation::accepted_chat_proposal(",
            "synchronize_applied_change(&state, &result",
        ],
    );
    assert_contains_all(
        &tasks,
        &[
            "NoteTimeline::new(self.state).mutate(NoteMutation::task_action(",
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
    let timeline = repository_file("src-tauri/src/services/note_timeline.rs");
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
            "ProjectionTiming::Deferred",
            "from_plan(",
        ],
    );
    assert_contains_all(&post_publication, &["DeferredCatalogProjection::lexical("]);
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
    let timeline = repository_file("src-tauri/src/services/note_timeline.rs");

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
            "NoteTimeline::new(&state).initialize_existing_notes(&notes_dir)",
        ],
    );
    assert_contains_all(
        &forgotten,
        &[
            "NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::forgotten(",
            "NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::recovered(",
            "NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::purged(",
            "retained_identity.as_ref()",
            "note_id: Some(note_id.clone())",
            "forgotten_note\n        .note_id",
        ],
    );
    assert_contains_none(&forgotten, &["prepare_notes_dir(true)"]);
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
    let timeline = repository_file("src-tauri/src/services/note_timeline.rs");
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
            "pub(crate) fn agent_restore(",
            "pub(crate) struct HistoryModeAccess",
            "pub(crate) struct CurrentContentAccess",
            "pub(crate) struct AgentRestoreAccess",
            "pub(crate) struct ExplicitRestoreGrant",
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
            "impl ExplicitRestoreGrant {\n    pub(crate) fn new",
            "impl HistoryModeGrant {\n    pub(crate) fn authorized",
            "impl RevisionIdentity {\n    pub(crate) fn",
            "impl LifecycleEventIdentity {\n    pub(crate) fn",
            "trait HistoryStore",
        ],
    );
    assert_contains_all(
        &history_store,
        &[
            "use rusqlite::{params, Connection, OptionalExtension, Transaction};",
            "PRAGMA journal_mode=WAL;",
            "PRAGMA foreign_keys=ON;",
            "PRAGMA synchronous=FULL;",
            "PRAGMA busy_timeout=5000;",
            "PRAGMA wal_autocheckpoint=1000;",
            "history.sqlite3",
            "const LINE_DELTA_MAGIC: &[u8; 4] = b\"NTL1\";",
        ],
    );
}

#[test]
fn note_identity_continuity_stays_inside_the_timeline_and_catalog_boundary() {
    let timeline = repository_file("src-tauri/src/services/note_timeline.rs");
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
            "generation: u64",
            "struct ProjectionWork",
            "target_tasks: bool",
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
    assert_contains_all(
        &forgotten,
        &["NoteTimeline::new(&state).prepare_publication("],
    );
    assert_contains_all(&proposals, &["timeline.prepare_revision_publication("]);
    assert_contains_all(&tasks, &["timeline.prepare_revision_publication("]);
    assert_contains_all(&note_persistence, &[".prepare_revision_publication("]);
    assert_contains_all(
        &state_persistence,
        &[
            "pub(crate) fn persist_note_with_preparation<P, T>(",
            "with_note_file_mutation(||",
            "abandon_after_publication_failure(",
            "let outcome = finalize(",
        ],
    );
    assert_contains_all(&proposals, &["with_note_file_mutation(||"]);
    assert_contains_all(&tasks, &["crate::state::with_note_file_mutation(||"]);
    assert_contains_all(
        &timeline,
        &[
            "pub(crate) struct HistoryIntentIdentity",
            "history_intent: HistoryIntentIdentity",
            "pub(crate) fn abandon_after_publication_failure(",
            "history_store::finalize_publication(&history_intent, source, &path, canonical)",
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
