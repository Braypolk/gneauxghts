# Remaining test-suite audit work

This file contains only the audit findings that remain unresolved. Each item was
rechecked against the current tree; completed hardening work and historical test
counts are intentionally omitted.

## Coverage gaps

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

## Test strengthening

### Use independent expected task Markdown

`src-tauri/src/services/task_mutation.rs::pure_transform_matches_legacy_toggle_and_delete_behavior`
still derives its expected values with the same helpers used by production.
Replace those expectations with literal toggle and delete Markdown, including
the untouched second task.

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

1. Close the two remaining production-path coverage gaps.
2. Strengthen the task transform assertion.
3. Remove or replace the vacuous reasoning-payload assertion.
4. Revisit the source-string architecture guard separately.
