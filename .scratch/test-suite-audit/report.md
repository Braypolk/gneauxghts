# Remaining test-suite audit work

This file contains only the audit findings that remain unresolved. Each item was
rechecked against the current tree; completed hardening work and historical test
counts are intentionally omitted.

## Coverage gaps

### Exercise real block-move actions

`src/lib/features/notepad/editor/blockMoveUndo.test.ts` still constructs the
desired transaction through `moveViaMinimalChange`. Replace the two synthetic
movement scenarios with tests that invoke `moveCurrentBlock` or `moveBlockTo`
against real CodeMirror state and assert ordering plus undo/redo caret position.
Keep the three focused `minimalDocChange` cases.

### Exercise Atlas publication through its production owner

`src-tauri/src/semantic/atlas.rs::atomic_publication_keeps_previous_generation_until_pointer_flip`
still writes both artifacts and flips the pointer inside the test. Replace it
with a test that enters the production structural-publication path, interrupts
or fails before pointer replacement, and proves through the ordinary reader that
the previous generation remains usable.

### Add production-path current-content invalidation coverage

The invalidation tests in `commands/search_commands.rs`,
`commands/task_commands.rs`, `commands/atlas_commands.rs`, and
`services/retrieval.rs` still call the current-content capability directly with
constructed results. Keep those capability-race tests, but add focused coverage
that enters each real consumer, holds its query before delivery, invalidates the
result, and verifies that stale content is withheld.

## Test cleanup and strengthening

### Remove three opaque-view-state render cases

The parameterized cases in
`src/lib/features/history/HistoryMode.svelte.test.ts` render a captured view
state and compare it with the same object. Remove the collapsed, forward, and
reversed selection cases. Read-only rendering and selection restoration remain
covered elsewhere.

### Remove the shared-alias pseudo-deduplication case

Remove `refreshes one shared clean document reference exactly once` from
`src/lib/features/notepad/document/documentState.sequence.test.ts`. It calls the
adoption function once itself and only observes three aliases to the same object.
Keep the state-transition sequences and the real refresh-controller deduplication
test.

### Strengthen and consolidate Atlas compatibility coverage

In `src-tauri/src/semantic/atlas.rs`, move source-set, layout-version, and
edge-generation rejection assertions into
`warm_generation_is_served_stale_while_new_epoch_builds`, where
`pointer_is_compatible` is actually called. Then remove
`compatibility_rejects_input_and_algorithm_changes`, which currently tests only
derived equality.

Remove the `LABEL_ALGORITHM_VERSION` string-contains test from
`src-tauri/src/semantic/atlas_labels.rs`; production generation and pointer
compatibility tests already cover algorithm selection and cache rejection.

### Use independent expected task Markdown

`src-tauri/src/services/task_mutation.rs::pure_transform_matches_legacy_toggle_and_delete_behavior`
still derives its expected values with the same helpers used by production.
Replace those expectations with literal toggle and delete Markdown, including
the untouched second task.

### Consolidate duplicated task-adapter success coverage

In `src/lib/features/notepad/orchestration/notepadTaskMutationAdapter.test.ts`,
give the integrated dirty-task scenario distinct editor-save and task-save spies.
Assert that task attribution is selected, editor save is not selected, and no
extra autosave is scheduled. Then remove the earlier fake-editing success case.

### Remove or make the reasoning-payload assertion meaningful

`src/lib/features/chat/ui/ChatMessage.svelte.test.ts` asserts that `private
reasoning payload` is absent without putting that value in its fixture. Either
remove the vacuous assertion or supply private reasoning at the actual filtering
boundary and prove it is excluded.

## Architecture guard follow-up

`src-tauri/src/agent_run_coordinator.rs` still uses a source-string assertion
against `chat.rs`. Decide whether its routing rule belongs in the Rust
architecture-fitness suite and replace it with a less spelling-sensitive check
if practical. Do not delete it unless equivalent ownership coverage survives.

## Recommended order

1. Close the three production-path coverage gaps.
2. Strengthen the task, Atlas compatibility, and task-adapter tests.
3. Remove the five confirmed low-value cases and the vacuous assertion.
4. Revisit the source-string architecture guard separately.
