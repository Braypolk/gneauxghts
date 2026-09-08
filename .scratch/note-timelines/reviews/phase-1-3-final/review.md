# Final Phase 1–3 review

**Follow-up:** all five findings are addressed in the follow-up fixes. See [fixes and passing validation](fixes.md).

Reviewed 2026-09-04 against `14e29d6`, using the user-confirmed pre–Note Timeline baseline `428a220`. Scope: issues 1–19 and 27–34. Issues 20–23 and 24–26 remain future work, not missing implementation findings. The working tree was clean when review started.

**Recommendation: fix the confirmed coordination and storage defects before beginning Phase 4. Keep the existing architecture.** The design has sound ownership and useful private modules; the remaining problems are specific gaps in those protocols, not evidence that the feature needs a rewrite.

Review combined independent standards and spec inspections, examination of the implementation and architecture decisions, existing regression gates, and focused failing reproductions. Production code was not changed. Temporary test additions were restored after execution. The evidence below records the original findings; the follow-up fixes retain production regression tests.

## Standards and architecture findings

### A1 · P1 · Recovery retry can abandon a live save

**Location:** `src-tauri/src/services/note_timeline.rs:3663–3674`; downstream abandonment in `history_store.rs:4140–4159`.

An app-owned writer holds the canonical note-file mutation lock while preparing an intent, publishing Markdown, and finalizing history. Explicit `retry_history_recovery` bypasses that lock. If Retry runs after preparation but before publication, `recover_pending` sees the old file and marks the live intent abandoned. The writer subsequently publishes, but exact finalization rejects the abandoned intent. Restart cannot recover it because it is no longer pending.

**Evidence:** a writer held the real canonical mutation lock while a concurrent retry completed and reported Healthy. Publication then returned a HistoryFinalization warning. After restart, only one revision remained where two were required.

**Documented rule:** the save consistency invariant requires serialization from preparation through finalization and prevents recovery from classifying a live publication as crash residue. Issues 7, 12, and 30 require durable capture and recovery coordination.

**Correction:** serialize explicit recovery with the existing canonical writer owner, preserving lock ordering. Protect both pre-publication and post-publication interleavings. Another runtime coordinator is unnecessary.

### A2 · P2 · Completed intents retain a redundant full history

**Location:** `src-tauri/src/services/note_timeline/history_store.rs:1019–1040`, terminal updates at `4283–4292` and `4316–4323`; abandonment at `1132` and recovery abandonment paths.

Every prepared intent stores a complete uncompressed authored payload. Finalization and abandonment change only the status; they never retire that payload. Even content-identical saves accumulate complete copies despite creating no new Note Revision. The compressed checkpoint/delta store therefore coexists with an indefinitely growing full-copy store. Per-note usage counts only revision payloads, obscuring this duplication.

**Evidence:** 16 identical saves of a 130,000-byte authored body retained one Note Revision with 83 bytes of reported revision payload, plus 16 finalized intent payloads totaling 2,080,320 bytes. These are live rows, not merely unreclaimed SQLite pages.

**Documented rule:** the spec selects verified deltas between compressed checkpoints; issue 1 evaluates stored size and changed-content cost, and issue 33 requires removing redundant internals. Full payloads are justified while preparation remains recoverable, but not indefinitely after it becomes terminal.

**Correction:** atomically retire terminal intent prose while preserving minimal identities, hashes, and other correlation evidence needed for foreign keys, exact finalization, and idempotency. Cover unchanged saves and abandoned intents too. Do not blindly delete referenced intent rows. Validate total production-store growth and usage reporting, not only the codec's compressed output.

## Spec findings

### B1 · P1 · Leaving History Mode during restore can overwrite new edits

**Location:** `src/lib/features/history/historyModeSession.svelte.ts:275–276`; exit admission at `496–505`; adoption in `src/lib/features/notepad/Notepad.svelte:800–812`.

Confirm a Version Restore, return to the workspace before its native response finishes, and type. Exit makes the editor usable, but `confirmRestore` later adopts the returned snapshot unconditionally. That adoption uses `preserveDraft=false` and replaces the newer local work. Reducer request correlation does not protect this side effect because it happens outside the reducer.

**Evidence:** the focused test used the real document editing service and Note Draft State with the same adoption wiring as Notepad. The newly entered text was replaced after the pending response resolved.

**Requirement:** issue 13 requires return to “the exact workspace state”; the document invariants require preserving newer local edits during committed-result adoption.

**Correction:** retain workspace exclusion until commit and adoption settle, or make adoption explicitly preserve newer document work using the existing document operation protocol. Cover both Back and Escape, stale response completion, and errors after publication.

### B2 · P2 · Properties-only restore preserves the old undo history

**Location:** `src/lib/features/notepad/Notepad.svelte:800–812`, with the conditional runtime update in `src/lib/features/notepad/document/documentEditingService.ts:118–126`.

A revision can have the same body and different unmanaged frontmatter. The backend correctly accepts this as a distinct authored state, but the editor session projects only the body. `applySnapshot` sees unchanged Markdown and never calls the editor replacement that establishes the fresh undo history. Ordinary undo can therefore cross this Version Restore.

**Evidence:** the focused test reproduced zero invocations of the runtime replacement/reset callback for this projection. Both restore reproductions failed while all 22 existing session tests passed.

**Requirement:** issue 17 says “Establish a fresh editor undo boundary so ordinary undo cannot cross the restore.”

**Correction:** make the restore's undo reset explicit and independent of whether its projected body changed. Verify with actual CodeMirror undo as well as a properties-only restore through the native interface.

### B3 · P2 · Already-matching revisions give unrelated recovery guidance

**Location:** `src-tauri/src/services/note_timeline.rs:2704–2707`, mapped in `src-tauri/src/commands/history_commands.rs:84–87`.

Previewing and confirming a revision that already matches current authored content returns `Ineligible`. The product mapping says the note must be recovered and prescribes `RecoverNote`, although the note is active. This is a valid domain distinction lost by the error contract.

**Requirement:** issue 32 requires “a useful user-facing recovery action.”

**Correction:** represent the already-matching condition accurately or make the preview identify a no-op and disable confirmation. Keep the command error contract closed and update shared fixtures if its shape changes. This finding is code-traced, not separately reproduced in a running native window.

## Architecture and complexity assessment

- **Keep the canonical Note Timeline owner.** Private runtime, store, and post-publication modules hide real recovery, durability, and projection work. The old parallel mutation owner has been removed. The recovery race should be repaired within this structure.
- **Keep role-limited current-content access.** It centralizes eligibility and invalidation across search, retrieval, tasks, and Atlas. Its adapters serve actual differing result shapes; replacing them with caller-managed checks would spread policy again.
- **Keep one retained-history pager.** Ordinary and Missing Note history now share the storage-backed implementation and restart-stable continuation. This is useful consolidation.
- **Keep the separate History Mode and document owners.** Keeping the workspace mounted preserves resources and state. The restore bugs expose an incomplete handoff, not a need for an application-wide state machine.
- **Avoid abstraction-driven cleanup.** A hypothetical storage trait, generic event platform, extra pass-through layers, or splitting the large timeline file solely by line count would conflict with the accepted design decisions and issue 33's guardrails. File length alone is not a finding.
- **Prioritize deleting redundant state over moving code.** The terminal intent payloads are a concrete deletion target with measurable benefit. The reported 60-line reduction in issue 33 is not itself proof that all redundancy was eliminated.
- **Use Phase 4 issue 23 for the remaining full-scale evidence.** Benchmark the complete production path, including all durable tables, current-content eligibility work, health checks, paging, and reconstruction. Existing codec/SQL spike numbers are useful but do not establish end-to-end production cost. This is planned work, not an additional phase-scope finding.

## Validation

| Gate | Result |
| --- | --- |
| `pnpm check` | Pass: zero errors and warnings |
| `pnpm test` | Pass: 764 tests across 122 files |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass: 443 Rust tests and 15 architecture fitness tests |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Pass |
| Focused recovery/storage/restore reproductions | Four expected failures confirming A1, A2, B1, B2; temporary source restored |
| `pnpm test:e2e:browser` | Failed twice in setup waiting for visible `note-title`; first run blank, warm rerun rendered body text but still failed visibility. Not attributed to a specific reviewed commit. |
| `pnpm test:e2e:native` | Pass: shared TypeScript/Rust fixtures, native build, 3 lifecycle scenarios, and all 3 Phase 1–3 timeline journeys |

The first sandboxed browser attempt could not bind the local server; the two actual browser runs used the approved local integration environment. The browser failures above happened after server startup and are separate from that restriction. The native gate exited successfully; its runner printed driver-discovery and teardown warnings, but all six native scenarios passed. The full combined gate remains unverified because the browser suite did not pass.

The disposable reproduction patches and logs were removed after their scenarios were incorporated into the fixes. This validation section describes the original review; the follow-up report records the completed passing gates.

## Before Phase 4

Repair A1 and B1 first, remove A2's redundant payload retention, then close B2 and B3 through the existing document and command contracts. Retain the focused regressions as implementation tests and restore the complete integration gate. No broad architectural rewrite is recommended.

Findings by axis: **Standards/architecture: 2, highest P1. Spec: 3, highest P1.**
