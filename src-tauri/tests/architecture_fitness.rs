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
fn note_save_and_proposal_commit_use_the_shared_post_commit_boundary() {
    let note_persistence = repository_file("src-tauri/src/commands/note_persistence.rs");
    let proposals = repository_file("src-tauri/src/commands/proposal_commands.rs");

    assert_contains_all(
        &note_persistence,
        &[
            "PostCommitNoteMutationService::new(state)",
            ".apply_canonical_file(",
            "required_consistency_warning()",
            "commit_warning",
        ],
    );
    assert_contains_all(
        &proposals,
        &[
            "fn synchronize_applied_change(",
            "PostCommitNoteMutationService::new(state)",
            ".apply_canonical_file(",
            "synchronize_applied_change(&state, &result",
        ],
    );

    for source in [&note_persistence, &proposals] {
        assert_contains_none(
            source,
            &[
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
    assert!(registration.contains("commands::task_commands::prepare_task_document_mutation"));
    assert!(frontend.contains("'prepare_task_document_mutation'"));
}
