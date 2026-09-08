# 01 — Remove inert activity and unused persistence interfaces

Status: resolved
Depends on: None
Scope: active Round 1, execution position 1 of 6.
Round 1 order: 01 → 02 → 14 → 03 → 09 → 10; stop and audit after 10.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

Several interfaces require caller knowledge without affecting behavior. Semantic `report_activity`, `begin_foreground`, and `end_foreground` are empty in `src-tauri/src/semantic/activity.rs:24`. Their wrappers remain in `semantic/mod.rs:885`, the `ForegroundGuard` retains a semantic reference in `index.rs:92`, and `report_user_activity` remains an IPC command (`commands.rs:689`, registration `lib.rs:332`). Watcher notification is at `vault_watcher.rs:430`.

Frontend persistence exposes alternate entry points without production callers: returned `persistNote`/`queueNoteOperation`, exported `awaitAllSaveQueues`, and `shouldSkipAutosave` in `src/lib/features/notepad/session/session.ts:92`. The latter duplicates `documentHasCleanBuffer` (`document/documentState.ts:220`) with different empty-draft semantics. See investigations cross-cutting C2 and save/restore D.

## Implementation instructions

1. Re-run symbol searches across production, tests, E2E, and command registration before deleting each interface. Delete the empty semantic notification chain and its callers, including the semantic reference carried solely for these calls.
2. Keep `ForegroundActivity.in_flight` and its real background prewarm/yield behavior. It is a functioning resource counter, not the empty semantic gate notification.
3. Remove unused persistence exports/returned methods; retain methods used internally by the single queue owner. Remove the unused aggregate queue helper; `workspacePersistenceService.flushAllForNavigation` remains the actual departure barrier.
4. Delete the unused autosave predicate and tests only asserting that obsolete predicate. Keep empty-draft and dirty-save behavior covered at the persistence boundary.

## Acceptance and deletion evidence

- The named no-op functions, command registration, dead semantic reference, unused exports, and obsolete predicate are absent; do not replace them with another notifier/helper.
- No change to foreground yielding, save queue coalescing, empty-draft behavior, or navigation settlement.
- Existing index/foreground and persistence boundary tests pass. Use focused frontend tests and relevant Rust tests; no new mock suite for deleted no-ops.
- Report actual production/test line delta and deleted interfaces separately. This ticket should produce net production deletion.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: active in narrowed Round 1. Earlier full-plan numeric execution order is superseded by 01 → 02 → 14 → 03 → 09 → 10.

- 2026-09-07 implementation resolution: removed the complete no-op semantic activity notification chain: the layout's throttled input listeners and IPC invocation, `report_user_activity` command and registration, watcher notification, three `SemanticState` forwarding methods, three empty `BackgroundWorkGate` methods, and the semantic reference/constructor argument held by `ForegroundGuard`. `ForegroundActivity.in_flight`, its RAII guard, background queue yielding, prewarm, reconciliation, and manual-pause checkpoints remain intact. A final whole-repository caller search found the removed names only in planning/investigation prose.
- Persistence resolution: kept private `persistNote` and `queueNoteOperation` implementations, but removed their unused returned entries; removed the controller's unused aggregate `awaitAllSaveQueues` implementation/return, the workspace service's unused returned `awaitAllSaveQueues` entry, and exported `shouldSkipAutosave`. `workspacePersistenceService.flushAllForNavigation` remains the sole public all-document departure barrier and still uses its private queue sweep. The queue-coalescing test now arranges its barrier through the actual `DocumentRuntime` queue owner. No predicate-only test existed to delete; empty-draft and dirty-save outcomes remain covered at the persistence boundary.
- Line accounting from the ticket baseline: production +3/-92, net -89; tests +2/-2, net 0, including embedded Rust tests (none changed); tooling +0/-0, net 0. This Comments update is planning evidence and is excluded from production/test/tooling totals. No product state, owner family, or grouped state dimension was removed: the deleted semantic messages reached empty methods. The representative save and restore ledgers therefore remain 7 owners / 26 dimensions / 16 steps (15 for same-path save) and 8 / 36 / 21 respectively; their live coordination is unchanged. Removed burden is the inert layout/watcher/foreground notification routing and unused alternate persistence entry surface.
- Baseline method: before editing, archived the exact dirty working tree (excluding `.git`, `node_modules`, and `target`) to `/private/tmp/gneaux-ticket01-agent-baseline.tar`; all line counts and review diffs compare touched files to that archive with `git diff --no-index`, not to HEAD. Unrelated note-timeline/history work was preserved.
- Validation: focused Vitest persistence/workspace files passed 24/24; Rust foreground counter/yield tests passed 2/2; the `checkpoint_` Rust filter passed 4/4 including both semantic manual-pause tests; `pnpm run check` reported 0 errors and 0 warnings; `cargo check --manifest-path src-tauri/Cargo.toml` passed; Rust architecture fitness passed 17/17. Review concern: repository-wide `cargo fmt --check` is not clean because the captured working tree already contains extensive unrelated formatting drift, including untouched portions of shared files; no broad formatting rewrite was applied.
- Orchestrator audit: no Standards or Spec findings. Baseline-relative changes, whole-repository symbol removal, the retained foreground counter/yield seam, the private workspace queue sweep, and the private persistence queue implementation were independently verified. The previously recorded repository-wide formatting limitation remains; no Ticket 01 follow-up is required.
