# 04 — Bind one running vault and stage the next selection

Status: resolved
Depends on: None; fresh triage required
Scope: deferred; excluded from Round 1. Do not implement without a new scope decision after the Round 1 audit.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

`src-tauri/src/state/config.rs:75` rereads the selected root on every operational call. `state/persistence.rs:752` swaps a global SQLite connection when that preference changes. History, semantic, chat, and lexical resources remain startup-bound. Watcher registration captures one root (`vault_watcher.rs:274`) while debounce/reconciliation reread another (`:341`, `:754`). Apply closes history before fallible config persistence (`commands.rs:484`–`:516`). A config failure can leave the old runtime closed; a successful selection can leave mixed old/new paths.

## Chosen behavior

Switching remains restart-based. Apply saves the next-launch folder; the currently running vault stays open and usable until explicit Restart. Backend snapshots distinguish running root from selected next-launch root. This is an intentional product behavior change, not a transparent internal refactor.

## Implementation instructions

1. Resolve a concrete immutable running-vault context at `src-tauri/src/lib.rs:113`. Carry canonical root/data/app-local observation paths into existing AppState, history, chat, semantic, watcher, and app-state persistence construction.
2. Give existing AppState a bound app-state storage handle, preserving serialized transactions. Remove operational `STATE_DATABASE` path swapping and global selected-root lookups. Platform startup discovery may remain; do not build a dependency-injection container.
3. Replace Apply's close/write/count protocol with validation and atomic next-launch preference publication. Validate iOS/path restrictions before scaffolding. Avoid a fallible post-commit note scan being reported as preference-save failure. Reuse persisted config representation; no history schema change.
4. Return running/selected identities in the authoritative vault snapshot. Repeated B→C selection works; selecting running A clears restart-needed. Failure leaves running A usable.
5. Watcher callbacks and reconciliation retain captured running context. Replace selected-global comparisons in `services/note_timeline/forgotten.rs:25` with bound storage access; preserve real vault identity, store generation, and path admission checks.
6. Update Settings copy to explain next-launch application. Adapt necessary IPC fixtures/types. Snapshot deduplication is ticket 06; actual lifecycle closure is ticket 05.

## Acceptance and validation

- After Apply B, all ordinary reads/writes/events/app-state records still belong to A; after a new process starts they belong to B. Test production-style resolution without a permanent `NOTES_ROOT_OVERRIDE` masking preference changes (`commands.rs:856`).
- Cover repeated Apply, same canonical path/alias, invalid target, failed config publication, forgotten operations, and old watcher callbacks after selection.
- No timeline close occurs during Apply; failed selection does not disable editing. Preserve app-local anti-rollback authority and cross-vault rejection.
- Audit every operational `notes_root`/`state_database_path` caller and aliases/derived accessors `vault_root`, `vault_data_dir`, `vault_cache_dir` (`state/config.rs:380`), plus task projection calls to `with_state_database_internal` (`state/task_projection.rs:193`); document any startup-only exceptions. Delete compensating selected-path checks only after their underlying storage is bound.
- Update ARCHITECTURE and applicable invariant/ADR explanation for staged selection. Net line savings are not promised for this correctness foundation; the deleted global path-switch protocol must be demonstrated.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: deferred by the user's narrowed first-round decision. Retained as investigation/design evidence; ready-for-agent status and the original execution order no longer apply.

- Fresh triage (2026-09-07): ready for implementation after the completed Round 1 audit and the user's explicit approval of staged Apply behavior. The current working tree still resolves operational roots through `notes_root()`, swaps the app-state database by selected path, rereads the selected root in watcher/lifecycle paths, and closes the running timeline before selection publication. Ticket 04 therefore remains a correctness fix rather than stale cleanup. Exact pre-ticket working-tree archive: `/tmp/gneauxghts-ticket04-baseline.2TOXTh` (workspace snapshot excluding dependency/build caches); audit deltas must be measured against this archive, not HEAD.

- Resolved 2026-09-07 against the exact supplied archive
  `/tmp/gneauxghts-ticket04-baseline.2TOXTh`, never HEAD. The archive predates
  the orchestrator's fresh-triage edit above (`needs-triage` to
  `ready-for-agent` plus its comment); that preserved +3/-1 issue-metadata
  difference is not attributed to implementation. Generated dependency/build
  directories and Tauri schemas were excluded. The final archive comparison
  contains only this ticket's backend, frontend, contract, test, and domain/
  architecture files; no unrelated source delta was introduced.

- The process now resolves one concrete immutable `RunningVault` at the Tauri
  composition root. It creates/adopts and carries the canonical running root,
  its canonical vault-data directory, and the canonical app-local observation
  directory into `AppState`,
  Note Timeline, semantic/chat construction, startup indexing, watcher loops,
  history administration, and clean close. Ordinary command preparation,
  search, assets, tasks, proposals, forgotten-note cleanup, watcher debounce,
  and reconciliation use that bound context rather than rereading selection.

- Apply now computes the current snapshot before publication, validates iOS
  container restrictions and non-directory targets before scaffolding, then
  publishes the existing config representation through a same-directory
  create-new temporary file, `sync_all`, and rename. It performs no timeline
  close, runtime rebind, semantic status refresh, or fallible post-commit note
  scan/read. `VaultInfo` exposes `runningPath` and `selectedPath`; its restart
  flag compares canonical identities. B→C replacement works, selecting A by an
  alias clears restart-needed, and publication/target failure leaves A open and
  editable. Explicit and default selections share the same create,
  canonicalize, scaffold, then publish preparation path; clearing the stored
  override therefore cannot publish an unprepared default. Settings consumes
  the backend snapshot, labels Apply as
  next-launch behavior, and keeps workspace/assets bound to `runningPath`.

- App-state SQLite is opened once from the composed running vault as
  `AppStateStorage`. Forgotten-note and forgotten-chat lifecycle metadata now
  use that exact AppState handle, preserving serialized transactions and
  cross-vault rejection. Deleted the old `StateDatabase { path, connection }`
  cache, its `entry.path != database_path` replacement branch, the operational
  selected-root-derived database open, production no-argument `notes_root`,
  `vault_root`, and `vault_data_dir` access, Apply's close/write/count protocol,
  watcher root rereads, selected-global lifecycle compensation checks, and the
  frontend's first-load `activeVaultPath` mirror. The old `currentPath` vault
  contract was replaced rather than retained as a compatibility field.

- Caller audit: `RunningVault::resolve` is the only production selection read
  used to bind operational resources, and it runs at startup composition.
  `configured_selected_root` remains only for the preference snapshot/staging
  surface. No-argument root/data and `state_database_path` helpers are
  `cfg(test)` only. `vault_data_dir_for`, `vault_cache_dir_for`, and manifest
  helpers are pure explicit-root derivations; `ChatService.notes_root` and
  `HistoryStore.vault_root` return already-bound owner state. Task projection's
  existing `with_state_database_internal` calls remain, but they now reach the
  weak running connection published by `AppStateStorage`; production performs
  no path lookup or swap. Only its disposable parallel-test fallback resolves
  the test override path.

- Production-style behavior coverage clears `NOTES_ROOT_OVERRIDE`, starts from
  persisted A, applies B, proves an editor preparation and an old watcher
  observation still succeed in A, proves app-state is written only under A,
  then drops the process state and proves newly composed state binds/writes B.
  Additional coverage exercises B→C, A alias equality, invalid file targets,
  injected atomic-config publication failure, Settings running/selected state,
  and the existing bound forgotten/callback/anti-rollback cross-vault cases.
  IPC event fixtures and the browser backend fixture carry both identities.

- Standards/spec audit follow-up: `RunningVault` no longer stores a requested
  path alongside a separate canonical identity. Startup creates a missing
  selected directory, resolves aliases, and uses the resulting canonical root
  for its operational root and data paths; the app-local observation directory
  is canonicalized too. A Unix regression fixture covers a missing child under
  a symlinked parent plus an aliased observation directory. The default Apply
  branch now uses the same target preparation as an explicit path and is
  covered through directory/manifest creation before `None` config
  publication. The two real native support clients now consume
  `vault.runningPath`, and the fixture override comments explicitly restrict it
  to startup composition rather than suggesting live switching. The accepted
  weak AppState compatibility connection remains bounded to its already-bound
  connection and does not reread or swap the selection.

- Final baseline-relative line accounting (issue comments excluded): backend
  implementation plus colocated test-compatibility seams, excluding changed
  embedded test modules, is **+591/-296**; frontend production is **+16/-24**;
  behavior/contract tests and fixtures (including embedded Rust modules and the
  browser fixture) are **+266/-31**; architecture-fitness tooling is
  **+34/-3**; native E2E support tooling is **+4/-4**; domain/architecture
  documentation is **+51/-14**. Total is **+962/-372, net +590 across 38
  changed files**. Relative to the prior resolution ledger, the audit follow-up
  added **+83/-26**: Rust production **+22/-17**, regression/test compatibility
  **+57/-5**, and native tooling **+4/-4**; frontend and documentation counts
  did not change. No implementation block or file was moved. Growth is the
  immutable context, exact storage handle, atomic publication, canonical
  startup/target preparation, explicit IPC distinction, and acceptance
  coverage; no net-line saving was promised.

- Validation passed: `cargo check --manifest-path src-tauri/Cargo.toml`;
  `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`; focused `vault_`
  Rust tests 33/33; Rust architecture fitness 18/18; full Rust library suite
  **582 passed / 9 ignored / 0 failed**; `pnpm run check` with 0 errors and 0
  warnings; focused frontend settings/session/IPC/app-store tests 27/27; and
  full Vitest **865/865 across 124 files**. The ignored Rust cases are the
  pre-existing explicit release/scale diagnostics and were compiled but not
  executed. Both migrated native helpers passed `node --check`; paused native
  lifecycle/scale acceptance was not executed. The audit rerun initially
  exposed macOS `/var` versus `/private/var` disposable-fixture mismatches and
  one unguarded parallel AppState fixture after the new canonical operational
  root was enforced. Those were caused by this ticket rather than pre-existing
  repository failures: `TestDir` now returns its canonical path, explicit
  cross-vault fixtures use canonical roots, and the AppState test takes the
  shared path guard. Representative failures, focused vault tests, and the full
  library rerun are green. All tests used disposable roots; no user vault or
  database state was opened or modified. No unresolved Ticket 04 concern
  remains.

- Orchestrator Standards/Spec audit (2026-09-07): reviewed the complete delta
  against `/tmp/gneauxghts-ticket04-baseline.2TOXTh`, not HEAD, using the
  repository code-review and codebase-design criteria. The initial audit found
  four caused gaps: non-canonical operational startup paths, missing default-
  target scaffold preparation, two native helpers using the deleted
  `currentPath` contract, and override comments advertising a rejected live-
  switch seam. The same implementation agent corrected all four. Follow-up
  inspection found no remaining Spec omission, incorrect behavior, scope creep,
  documented-standard breach, or actionable smell. The broad file propagation
  is required to replace operational root rereads at the cross-layer ownership
  seam; it does not introduce another policy owner. The orchestrator reran the
  canonical-root regression, staged-Apply running-vault regression, architecture
  fitness boundary test, 22 focused frontend tests, and syntax checks for both
  migrated native helpers; all passed. Ticket 04 is accepted as resolved.
