# 33: Make Phase 1–3 timeline internals navigable

**What to build:** Contributors can understand and change the completed Note Timeline behavior through a smaller, deeper external interface and focused private modules without altering user-visible Phase 1–3 behavior. This is a simplification pass: moving the same implementation and tests into more files is not sufficient.

**Blocked by:** 27: Repair revision continuity after history reset; 28: Page Missing Note recovery timelines; 29: Restore exact editor state after History Mode; 30: Encapsulate Note Timeline runtime coordination; 31: Centralize current-content access; 32: Stabilize the timeline command contract.

**Status:** ready-for-agent

- [x] Record a before-and-after inventory in the issue comments covering hand-written production lines, crate-visible Note Timeline symbols, duplicated workflows, test locations, and strict-lint findings. Use it to identify deletion and interface-reduction targets before moving code.
- [x] Keep one canonical external Note Timeline interface while organizing private runtime, mutation, lifecycle and recovery, history projection, health, and persistence concerns into cohesive modules. Internal seams remain private; do not add an adapter solely to make tests easier.
- [x] Replace the separate eager ordinary-history and bounded Missing-Note paging implementations with one storage-backed paging implementation. Preserve the existing serialized page contract, deterministic ordering, restart-stable continuation behavior, and Missing-Note eligibility rules.
- [x] Replace command-layer substring classification of internal error messages with a closed typed Note Timeline error at the history-facing seam. Keep diagnostic causes private for logging while preserving every issue-32 product state, message, and recovery action.
- [x] Deepen current-content access so Note Timeline owns filtering and invalidation while search, retrieval, task, and Atlas callers provide only the minimum identity/path classification required to project their result shape. Remove duplicated caller orchestration and keep historical prose structurally unavailable.
- [x] Organize tests beside the behavior they protect and apply replace-don't-layer: retain observable interface, concurrency, recovery, contract, and end-to-end evidence; delete superseded tests and test-only pass-through helpers that merely restate private implementation steps.
- [x] Remove broad dead-code suppression and either use, narrowly gate, or delete unused Phase 1–3 scaffolding. Resolve strict lint diagnostics across all targets and features without suppressing meaningful warnings.
- [x] Finish with fewer hand-written production lines across the Note Timeline, history command, and migrated current-content cluster than the starting point, and do not increase its crate-visible interface. Any exception must identify the irreducible behavior and receive explicit review rather than being hidden by generated fixtures, formatting, or moved files.
- [x] Keep the complete Rust, architecture, frontend, contract, component, browser end-to-end, and native test suites green through the refactor. Tests must continue to prove the same Phase 1–3 behavior without asserting file layout or private call sequences.

## Implementation guardrails

- Work one deepening target at a time: establish interface-level coverage, replace the old path, delete the old implementation and redundant tests, then proceed. Do not leave parallel old and new paths for a later cleanup.
- Preserve canonical ownership, durability ordering, fail-closed recovery, current-content access restrictions, and all Tauri payload shapes. This issue adds no product behavior.
- Prefer a small interface with private composition over new crate-visible traits, wrappers, getters, or test hooks. A private module earns its existence only when deleting it would force its complexity back into multiple callers.
- If a proposed extraction only relocates code or increases the facts callers must know, leave the code in place and record why instead of treating file count as progress.

## Known deepening targets

- `HistoryModeAccess::page_retained` and `NoteTimeline::missing_note_history_page` currently implement related paging rules through different paths.
- `HistoryCommandError::from_cause` currently derives product states from diagnostic message substrings.
- Current-content result types implement repeated projection and invalidation adapters across search, retrieval, tasks, and Atlas.
- `note_timeline.rs` combines the external interface, private coordination, projection, recovery, mutation, and a large inline test module, making behavior and evidence difficult to locate.

## Comments

### Baseline inventory (before implementation)

- **Hand-written production surface:** 12,865 physical lines before the primary test sections across `note_timeline.rs`, `history_store.rs`, `runtime.rs`, `history_commands.rs`, search, retrieval, task, and Atlas consumers. This deliberately conservative count includes embedded `cfg(test)` hooks; the after count must use the same boundaries. The full files contain 19,973 lines, including 6,153 lines in the main `note_timeline.rs` test module and 421 in the `history_store.rs` test module.
- **Crate-visible Note Timeline surface:** 271 broadly matched crate-visible declarations and methods in `note_timeline.rs`, including 210 crate-visible functions. This includes accessors on crate-visible records; the after inventory must use the same searches.
- **Duplicated workflows:** ordinary retained-history paging eagerly reads and orders the whole timeline while Missing-Note recovery uses bounded store paging and an encoded restart-stable cursor; command errors infer six product states from diagnostic substrings; current-content policy requires 16 consumer/test implementations of `CurrentContentItem` or `CurrentContentProjection`.
- **Test locations:** large inline suites live in `note_timeline.rs`, `history_store.rs`, history/search/task/Atlas command modules, search, and retrieval, with additional public contract and ownership evidence in `src-tauri/tests`, frontend unit/component tests, Playwright browser tests, and native end-to-end tests.
- **Strict lint baseline:** `cargo clippy --all-targets --all-features -- -D warnings` reports 23 errors: 13 library findings and 10 additional test-target findings. Timeline-cluster findings cover needless borrows, a large error variant, manual range patterns, a misleading `from_*` method name, a collapsible conditional, four nonminimal retrieval predicates, one cloned-ref assertion, and eight explicit drops of non-`Drop` timeline handles. Two unrelated E2E-only needless returns in `secrets.rs` and `lib.rs` are also part of the all-target/all-feature gate.

### Completion inventory (after implementation)

- **Hand-written production surface:** 12,805 physical lines using the same conservative file set and primary-test boundaries as the baseline, down 60 lines from 12,865. The page-bound editing-session scan found during review is the irreducible addition: it preserves the existing canonical session identity without materializing unrequested revision payloads.
- **Crate-visible Note Timeline surface:** 252 broadly matched declarations and methods, down 19 from 271; crate-visible functions are 193, down 17 from 210. The current-content boundary now uses the named `CurrentContentIdentity` classification instead of an invalid-state-prone nested optional tuple.
- **Duplicated workflows:** ordinary and Missing-Note history use one retained storage-backed pager and cursor; one typed `HistoryError` mapping replaces diagnostic substring classification; Note Timeline owns one current-content eligibility and delivery check. Consumer implementations remain only where result-shape retention or identity classification differs.
- **Organization:** persistence, post-publication repair, and runtime coordination remain cohesive private modules. The closed domain records and single-owner mutation, lifecycle/recovery, history projection, and health policies remain grouped and signposted beside `NoteTimeline`; extracting them would only relocate code behind re-exports, so the issue's no-file-shuffle guardrail takes precedence. The main inline timeline suite remains beside those private policies rather than being mechanically moved; three superseded scaffolding tests were deleted and production-unused inspection helpers are test-gated.
- **Strict lint:** `cargo clippy --all-targets --all-features -- -D warnings` reports zero findings, down from 23, without broad suppressions.
- **Verification:** all 443 Rust tests, 15 architecture fitness tests, 763 frontend/contract/component tests, Svelte checks, all 9 browser end-to-end scenarios, and all 3 native lifecycle scenarios pass. The browser suite required a warm rerun after Vite dependency optimization but completed fully green without code or test changes.
