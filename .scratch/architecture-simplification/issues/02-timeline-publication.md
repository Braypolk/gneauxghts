# 02 — Complete NoteTimeline authored-publication ownership

Status: ready-for-agent
Progress: Implemented and independently reviewed; source frozen. All 252 ordinary timeline tests passed (9 opt-in tests ignored), plus affected task/proposal checks and architecture fitness. Coordinator full backend acceptance passed.
Owner: audit_timeline
Design: [timeline-design.md](../timeline-design.md)

## Scope

Own `services/note_timeline` publication/domain/restore implementation and affected private tests, `services/task_mutation.rs`, `commands/proposal_commands.rs`, and proposal canonical writer portions/tests in `proposals.rs`. Coordinate structural fitness edits with coordinator. Coordinator owns architecture-document integration. Do not change SQLite schema/receipt representation, task transforms, chat permissions/proposal state machine, external observation protocol, or lifecycle deletion/forget staging.

## Implementation sequence

1. **Inventory caller protocol and failures.** Enumerate every production and out-of-module test caller of prepare/token/mutate APIs. Keep an explicit checklist so no old production protocol survives as a forwarding compatibility API. Capture task/proposal/restore validation and result conversion behavior before replacing it.
2. **Implement complete edit/create admission in the timeline.** Use target preflight/recovery outside the file owner, drop preflight leases, then take file owner → operation lease → observation replay owner. Recheck proof/identity/pending replay and retry outside ownership when needed. Materialize authoritative current Markdown and run the supplied pure task/proposal transformation only after successful owned admission. Use the existing `HistoryError::Stale` for edit conflict and an explicit typed occupied-path result for exclusive creation if existing errors cannot represent it without message parsing.
3. **Concentrate actual publication privately.** One private lifetime owns current-content invalidation, exact history preparation, optional private restore-origin attachment, watcher correlation, canonical write, abandonment/recovery release, finalization, and returned committed warnings. Keep editor rename/rollback and exact restore content as explicit private branches. Do not expose a caller-supplied filesystem writer or transaction/lease object.
4. **Migrate task owner completely.** Resolve task and validate path, then invoke complete edit with the existing transform under the owned canonical read. Remove sink trait/concrete sink/synchronization DTO and standalone writer; retain dirty prepare and literal transform contract. Replace fake sink protocol-order tests with real complete-operation outcomes, reusing existing fixture/fault infrastructure.
5. **Migrate proposal update/create completely.** Keep access checks, persisted proposal commit intent, content/base-hash policy, and post-commit status convergence in current owners. Timeline owns canonical write and committed result; map typed conflict/occupied-path outcome into the existing IPC result. Remove proposal prepared-publication adapters/canonical writers and command synchronization DTO/helper. Do not acquire an outer file owner around the complete timeline operation.
6. **Use the private publication implementation from editor/restore.** Preserve body-only enrichment under ownership, rename rollback, selected-origin preparation before write, exact CRLF/frontmatter checks, reserved revision identity, and preview-hash recheck. Remove superseded duplicate write/finalize code after migration, not while callers still depend on it.
7. **Narrow the contract and delete obsolete plumbing.** Make storage preparation/token/mutation types and methods private to timeline; remove token-carried runtime lease fields/forwarding and abandoned public DTO constructors. Keep private token validation, prepared-base data, receipt tests, and durable fault/restart tests. Migrate out-of-module tests to complete operations; do not retain public test-only replicas of the retired protocol.
8. **Focused validation and independent review.** Compile once after coherent migration; run affected task/proposal/timeline/restore/readiness tests and architecture fitness. Update source ownership assertions around actual complete callers. Coordinator runs combined acceptance after source freeze. Record what interface/order obligations and implementations were removed, separately from LOC.

## Creation and failure classification

Exact-path creation uses the approved existing `state::atomic_create_note` protocol: write and sync an adjacent temporary file, then hard-link it to the exact destination without replacement and remove the temporary name. Its private result preserves `io::ErrorKind::AlreadyExists`; the ordinary atomic-replace wrapper still returns String errors. This supersedes the proposed direct `create_new`/partial-destination cleanup protocol: failed write/sync never exposes partial canonical bytes, and the no-replace link leaves occupied files/symlinks untouched. A failed temporary cleanup does not make the destination committed. Creation admission validates the parent scope; under ownership any existing leaf (including outward and dangling symlinks) returns occupied, with atomic no-replace retaining the late-race safeguard. Parent symlinks outside the selected vault remain rejected.

Only complete authoritative canonical bytes qualify for a committed warning. Existing editor rename rollback failure still retains/releases exact evidence for recovery and returns an indeterminate publication error. No schema or receipt format changed.

## Acceptance matrix

- Real task toggle/delete/due transformations: canonical/task projection/source preserved; dirty preparation remains nonwriting; one committed warning after one write; write failure abandons exact intent.
- Proposal existing-note raw/base-hash conflict and occupied creation path: no overwrite; permissions and status convergence unchanged; accepted-proposal source preserved; actual committed bytes never replayed after status or history failure.
- Editor preflight tests: ready note remains writable while unrelated target verifies; queued observation replay precedes save; close between preflight and ownership does not deadlock; current properties enrich body-only input; rename rollback and indeterminate rollback retain their existing outcomes.
- Restore: exact empty/frontmatter/CRLF; stale preview; selected-origin/revision identity; append-only restart behavior; post-publication warning and recovery.
- Durability: exact scoped token, source/identity mismatch, authoritative-read failure, retained observations, fault rollback/restart, receipt 64 and replay 128 boundaries remain protected by existing private tests.
- Structural: task/proposal callers no longer import prepared history types, write note files, abandon intents, call post-publication finalization, or take a file owner around timeline publication. SQLite/observation/lifecycle ownership remains unchanged.

## Completion record

Implemented complete `edit_note` and `create_note_at` operations and a shared private admission/publication lifetime for editor saves and Version Restore. Authoritative read/transform executes once under canonical ownership after readiness admission. Private tokens no longer carry caller runtime/current-content leases.

Removed task mutation sink trait/concrete sink, synchronization DTO and standalone file writer; proposal prepared/canonical writer adapters, separate creation writer, command synchronization DTO/helper; duplicated restore write/finalize sequencing; external token constructors and forwarding lease methods. Task, proposal, commands and ChatService recovery tests now exercise actual complete timeline operations. Private typed-token, receipt, rollback/restart and selected-version tests remain.

Initial validation: combined lib compilation passed, 40 focused affected tests passed, 23 architecture fitness tests passed. Independent review found outward-existing symlink occupation incorrectly classified by destination canonicalization; parent-scoped creation admission and owned occupancy check correct it, with a focused regression. Final validation recorded below when complete.


Final owned validation: clean lib compilation passed (18.48s), then direct current binary `services::note_timeline:: --test-threads=1` passed **252 tests, 9 ignored**, 72.65s; log `../02-timeline-tests.log`. This includes the new authoritative task transform admission race and occupied file/dangling/outward-symlink creation regression (also separately 2/2 in 0.18s). The independent Standards reviewer confirmed the creation correction and found no further backend issue.

The coordinator's first full run exposed one outdated private fixture: `clean_close_waits_for_active_save_then_finalizes_and_old_runtime_is_inert_after_vault_switch` manually prepared a token and expected its removed runtime lease. The test now pauses the actual complete save at the existing prewrite hook and verifies the same close barrier, final canonical content and inert old runtime. No timeout increase or restoration of obsolete token leases. The failed full-run log is preserved; the full timeline rerun verifies the corrected real operation and all remaining private durability fixtures. Root owns the combined-suite rerun.

Metrics: `../02-metrics.json` compares the explicit owned file set against this phase's frozen current-tree snapshot. It records **126 fewer physical lines**, including new tests and inline Rust tests; shared commands/chat-test files are excluded to avoid double-counting coordinator work. This is descriptive: the architecture benefit is elimination of caller-managed publication protocols and lease/token handoff, while preserving real private durability coverage.

Coordinator acceptance: corrected full Rust run passed **746 library tests and 23 architecture tests**, 15 existing opt-in tests ignored; production `cargo check` passed. Logs: `../rust-full-fixed.log`, `../rust-check.log`. This closes issue02 backend acceptance; native acceptance remains part of the coordinator’s combined application gate.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
