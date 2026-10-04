# Backend persistence, Note Timeline, tasks, and canonical commands audit

Status: needs-triage
Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b` (source inspection of current checkout; no production/test edits by this audit).
Date: 2026-10-02

## Assessment

The main opportunity is reducing repeated environment/database setup and moving hot-path schema work to its existing initialization owner. The durability tests are numerous because they protect different failure boundaries, and should not be deleted merely because they save the same note repeatedly. I found two concrete correctness/isolation gaps, a misleading duplicate test, a tautological assertion, and several bounded simplifications. Large ownership rewrites need staged follow-up; this report does not recommend replacing NoteTimeline or weakening mandatory preparation.

The inventory covers 55 source files, 47,176 lines, 401 literal Rust test attributes, nine ignored tests, and 280 literal environment-lock call sites. Attribute counts are static, not the expanded compiler test list; helpers can acquire the environment lock for several tests. See [inventory](backend-persistence-inventory.md).

Standards: read the repository code-review and codebase-design skills, CONTEXT.md, ARCHITECTURE.md, relevant behavior invariants, Editing Window contract, and ADRs 0002/0004–0009. The findings below distinguish confirmed defects from design judgments. There is no originating feature issue to test against; the user’s audit request and current documented invariants define scope.

## 1. Test environment and persistence ownership

### BP-01 — One watcher test can initialize the user's configured/default vault

Priority: P1 test isolation. Confidence: high; call path verified statically.

- `src-tauri/src/vault_watcher.rs:1057` (`rename_matching_uses_catalog_hash_when_semantic_indexing_is_unavailable`) acquires the environment mutex and calls `AppState::new` without initializing disposable app-data or notes paths. Its only path literal is `/vault/Rename.md`, which does not constrain construction.
- `src-tauri/src/index.rs:161` resolves `RunningVault` from global configuration; `index.rs:180` constructs history context and binds `AppStateStorage`. `src-tauri/src/state/persistence.rs:748` opens SQLite and runs migrations.
- `src-tauri/src/state/config.rs:177` falls back to `~/.local/share/Gneauxghts`; `config.rs:188` defaults to `~/Documents/Gneauxghts`; persisted configuration can choose another real vault. The mutex only serializes access. It does not sandbox paths.

Impact: running this test alone can initialize/migrate real application state; running it in the suite can inherit stale paths from previous tests. It is not hermetic and a pass may depend on prior test order.

Minimal fix: after taking `lock_test_env`, create separate `TestDir` values for app-data and notes, initialize app-data, set the notes override, then construct AppState; replace `/vault/Rename.md` with `notes.path().join("Rename.md")`. Reset the override on teardown, preferably through a scoped fixture. Keep the behavioral hash assertion. No production change is necessary.

Validation: run the exact test alone under a temporary home/config; verify all created files are under the disposable fixture and the hash fallback assertion still passes. I searched every direct `AppState::new` in `src-tauri/src`; other apparent uninitialized calls are behind `with_vault`, `ErrorFixture`, Editing Window `Fixture`, or release-fixture setup. This is the only uninitialized direct case found by that scan.

### BP-02 — Global fixtures serialize the bulk of timeline integration coverage

Priority: P2 architecture/test maintainability. Confidence: high for serialization, medium for measured speed benefit (not timed).

Evidence: `src-tauri/src/test_support.rs:9` has a single process-wide `TEST_ENV_GUARD`. Tests in `note_timeline/tests/publication.rs:94`, `tests/administration.rs:2`, and `tests/observation_lifecycle.rs:2` repeat app-data initialization, two temporary directories, notes override, AppState construction, and manual override reset. `editing_window_capture/tests.rs:23` has a better local Fixture, but still depends on mutable global roots, while `history_store.rs:105` constructs `Store::for_test()` from those globals. `state/persistence.rs:730` has a global compatibility binding plus a test-only thread-local binding and lazy test fallback (`:855`).

Impact: at least 280 literal lock call sites in this inventory funnel through one mutex; adding Rust test threads cannot parallelize these sections. Manual reset is not unwind-safe; many tests intentionally do not reset at all. Child threads can observe different storage-selection behavior from the initiating thread, so simply deleting locks would be wrong.

Proposed staged change:

1. Introduce one test-owned vault fixture that owns its directories and running context, constructs AppState, shuts down/joins background work, and restores legacy composition globals on drop. Migrate repeated setup without changing behavioral cases.
2. Move operational state/task database calls from the compatibility global to the already bound `AppStateStorage` handle. `NoteTimelineRuntime::new` and `Store::new` already receive explicit roots; preserve that direction.
3. Move global fault injection/counters to the fixture/store when feasible; only then remove global locking from fully isolated tests. Keep tests of global startup configuration serialized.

Risk: high if tackled as one rewrite. A helper alone reduces duplication but does not prove isolation or parallel safety. Do not add a polymorphic HistoryStore: ADR 0004 explicitly rejects that abstraction while SQLite is the only adapter. Required replacement coverage: two concurrent disposable vaults with disjoint paths/state, child-thread operations bound to their originating vault, next-launch selection changes, failure/unwind teardown, and current clean-close/worker settlement cases.

### BP-03 — Every task query/reconciliation repeats full schema initialization

Priority: P2 production efficiency. Confidence: high for repeated work, unmeasured magnitude.

`state/task_projection.rs:196`, `:488`, `:510`, `:542`, `:555`, `:595`, and `:670` call `ensure_state_schema_idempotent` plus task DDL. `state/persistence.rs:912` forwards straight to `ensure_state_schema`, which starts `BEGIN IMMEDIATE`, issues all app-state CREATE TABLE statements, scans migration columns, and commits (`:916–974`). Even `load_task_by_id`/`load_tasks_for_note_id` therefore obtain a write reservation and perform migration checks. `AppStateStorage::bind` already initializes the core schema before publishing a handle (`:748–768`), but does not yet own task-schema initialization.

Proposed change: initialize the complete app-state + task projection schema once, transactionally, during storage binding. Ordinary task methods should trust the admitted bound handle. Retain explicitly callable migration helpers only for initialization tests, not per-read bootstrap. This also provides a clean route toward BP-02's explicit handle.

Replacement coverage: retain `state/persistence/migration_tests.rs:28` concurrent initialization and `:94` rollback tests, extend them to include task schema; add a focused initialized task read test under a concurrent SQLite writer to prove reads no longer attempt migration. Trace/count DDL or inspect SQLite contention rather than asserting machine-specific milliseconds. Preserve task read-your-write semantics and initialization-before-publication. Risk: medium; tests currently benefit from lazy creation and must be migrated together.

## 2. Task mutation and projection

### BP-04 — Remove false assurance and same-implementation comparisons

Priority: P2 test quality; immediate small change. Confidence: high.

- `services/task_mutation.rs:570`, `derived_failure_does_not_turn_a_committed_write_into_an_error`, constructs `FakeSink::new(..., None)` and performs an ordinary toggle. No failure is injected. It duplicates `clean_commit_writes_once_and_returns_authoritative_identity` at `:492`, with fewer assertions. Delete the duplicate or replace it with a real production derived-projection failure test if that boundary lacks one. Do not claim derived-failure coverage from its name.
- `services/task_mutation.rs:338`, `pure_transform_matches_legacy_toggle_and_delete_behavior`, computes expected output by calling the same toggle/delete functions used directly in the production dispatcher (`:79`). It only catches incorrect dispatch, not incorrect behavior. If retaining a dispatch contract, assert literal expected Markdown and include SetDueDate; otherwise rely on explicit transform/command behavior tests and delete this comparison.

The fake trait itself is not automatically unnecessary: `commit_loaded_task` verifies one-write/authoritative-result behavior while `prepare_loaded_task` tests dirty-document pure preparation. Keep the hash, ambiguous task, no-write, and committed-warning tests at `:356`, `:379`, `:396`, `:410`, `:484`, and `:547`. Real publication-failure integration at `:514` protects intent abandonment, which the fake cannot represent.

### BP-05 — Build each reconciled TaskRecord once; review quadratic matching separately

Priority: P3 small production cleanup; P2 future scale review. Confidence: high.

`state/task_projection.rs:258–299` constructs the same seventeen-field TaskRecord twice: once borrowed by `upsert_task_row` and again pushed into `surviving`. Construct a local row, pass `&row` into SQL, then move the row into the result. This removes a field-synchronization hazard and duplicate string cloning without changing ownership or test strategy. Existing stable-ID/reorder, due-date, completion timestamp, deletion, and recent-task tests (`:800–924`) are sufficient focused regression coverage.

Separately, `find_matching_previous_task_index` at `:375` performs up to five scans of all previous tasks for each new task (`select_matching_previous_task_with`, `:358`). The reconciliation algorithm is quadratic on a long task-heavy note. Preserve matching priority, closest-line tie behavior, identity, hidden state, and completion timestamps if changing it. First add a benchmark or comparison-count experiment for hundreds/thousands of tasks; then consider indexes by key, normalized text, and line. Do not rewrite the matcher solely from the asymptotic observation: duplicate-text identity policy is subtle and existing fixtures are small.

## 3. Note text and date contracts

### BP-06 — Managed timestamp parser accepts nonexistent calendar dates

Priority: P2 correctness + missing independent oracle. Confidence: confirmed by focused reproduction.

`src-tauri/src/note.rs:562` checks month 1–12 and day 1–31, then passes them directly to `days_from_civil` (`:623`). It does not check each month's length. `managed_timestamp_parser_round_trips_app_frontmatter_format` (`:642`) only round-trips the application's own formatter and rejects one arbitrary string, so it misses this.

Copied the exact parser and `days_from_civil` functions to `/tmp/timestamp-audit.rs`, compiled with `rustc --edition=2021`, and observed:

```text
2026-02-31T00:00:00Z: Some(1772496000000)
2026-03-03T00:00:00Z: Some(1772496000000)
2026-04-31T00:00:00Z: Some(1777593600000)
2026-05-01T00:00:00Z: Some(1777593600000)
```

The parser feeds created/updated metadata in `index.rs:1383`, `:1389`, `:1446`, `:1452` and Atlas in `semantic/atlas.rs:909`. Invalid externally edited metadata can therefore become a different valid date rather than be rejected/fall back.

Proposed fix: validate the calendar date before conversion, using a small shared calendar primitive or a suitable existing date library. A strict validator already exists in `services/task_dates.rs:9`; do not make foundational note parsing depend on a task service just to reuse it. Add literal expected timestamp vectors for leap/non-leap February, April 31, and valid boundary dates. Preserve exact-Z/no-fraction compatibility unless separately changing that contract; RFC3339 generalization is not required by this finding. Risk: low; invalid date handling changes deliberately.

## 4. Catalog and derived projections

### BP-07 — Retry work scans every path ever registered, even when nothing is pending

Priority: P2 scaling review. Confidence: high for scan/retention, unmeasured user impact.

`services/note_catalog.rs:115` permanently inserts a per-path state in a map named `lexical`; `apply_registered` clears its mutation when done but retains the generation watermark (`:167`). `retry_pending` (`:185`) clones and locks every map value to discover actual pending work. `index.rs:388` calls it on every interactive index refresh, and `:493` on full refresh. Ordinary successful publications populate this registry as well, so a warmed large vault pays a whole-registry scan even when retries are empty; renamed/deleted paths also stay retained.

Proposed change: separate the pending-path worklist from the stale-generation watermark registry. Retry only pending entries and keep late stale jobs unable to overwrite newer projections. Do not simply delete successful entries: `deferred_publication_cannot_overwrite_newer_reconciliation` (`note_catalog.rs:550`) demonstrates why the watermark matters. Add a work-count assertion that a large settled registry performs zero projection retries and bounded pending lookup work, plus existing stale upsert/remove interleavings. Rename the `lexical` registry to reflect that it coordinates lexical and task projections. Risk: medium because concurrency and generation ordering must remain intact.

## 5. Timeline test organization and runtime determinism

### BP-08 — Shrink default receipt stress geometry; preserve real release-scale gates

Priority: P2 test efficiency. Confidence: high that work can be bounded, speed not measured.

`note_timeline/history_store/editing_windows.rs:1431` performs 300 captures in an ordinary unignored test to prove a 64-entry unreferenced-receipt bound plus protected anchor/endpoint (66 rows). `editing_window_capture/tests.rs:114–152` separately performs 80 real command saves for the integrated bound. Opt-in `release_validation/windows.rs` already owns realistic 300-save window fixture acceptance.

Change the ordinary store fixture to a count just safely beyond retirement (e.g. 80), update endpoint assertions, and retain explicit below/at/above-bound assertions plus stale/protected/retry semantics. Keep 300 saves/window and large 10k/100k retained-history measurements in ignored optimized release tests. Expected gain is 220 fewer store captures in this one test, not a claimed suite runtime percentage. Do not shrink tests whose counts cross another actual policy threshold: the 140-revision checkpoint test at `tests/publication.rs:1280` crosses `MAX_REPLAY_REVISIONS=128` and has a reason to exist.

### BP-09 — Bound concurrency fixture waits and make teardown unconditional

Priority: P2 robustness. Confidence: high.

`editing_window_capture/tests.rs:1179` uses a 20 ms negative receive to infer that clean close is waiting, followed by unbounded `recv()` calls on the close result and writer release. A regression in barrier ordering can hang the harness. `vault_watcher.rs:1029` likewise receives worker outputs without timeouts. `editing_window_capture/tests.rs:1149` polls scheduler completion and lifetime with sleeps against the same two-second deadline for two phases. `readiness.rs:16` already supplies a bounded receive helper, demonstrating a local pattern to reuse.

Prefer an observed entered/waiting handshake, bounded receives, and an RAII release guard that releases the worker even if the controller assertion fails. Merely replacing the controller receive with `recv_timeout` is insufficient when a scoped thread remains permanently blocked: scope join can still hang after panic. Reset the deadline for logically separate lifecycle phases. Keep one real scheduler integration test; use injected clocks and explicit transition signals for policy cases. Do not replace existing real SQLite/barrier coverage with mocks. Risk: low-medium, primarily test harness changes; behavior should stay the same.

### BP-10 — Split by behavior owner, not by historical feature accumulation

Priority: P3 structural follow-up. Confidence: medium; design judgment.

`editing_window_capture/tests.rs` is 3,051 lines and spans window policy, read barriers, restore, selected-vault ownership, clear/reset, schema rejection, projection tags, and task interactions. The 6,074-line `history_store.rs` mixes codec, admission/rollback observations, revision reconstruction/query paging, lifecycle, deletion, recovery, schema creation, and tests. Both already have useful submodules (`runtime/verification.rs`, `history_store/editing_windows.rs`); build on those private boundaries.

Proposed organization: test modules for capture/receipts, runtime readiness/close, canonical publication, lifecycle/administration, and read capabilities, sharing only a small scoped vault fixture and explicit actions (`save` versus `save_and_finalize`). Keep storage-specific fixtures and SQL corruption inside private store tests. For production, extract the authored-state codec and schema/admission code into private modules before considering any deeper rewrite; retain one transaction boundary and the same storage-neutral NoteTimeline external seam.

`tests.rs:34` deliberately finalizes each fixture save; that is appropriate for tests requiring immutable retained revisions but unsafe as a general autosave helper. Make that distinction explicit in shared fixture names. `tests.rs:73` uses `include!` to preserve existing qualified test names; moving to ordinary Rust modules changes filters/scripts and must update them together. File size alone is not grounds for deletion. Large behavior matrices should become named cases with shared setup only when failures remain identifiable and independent.

## Coverage to preserve

- Exact prepared intent + published managed identity, authoritative read-back, mandatory preparation, committed-warning/no replay, and rename rollback (`tests/publication.rs:528`, `:590`, `:643`, `:690`, `:873`; `editing_window_capture/tests/readiness.rs:1075`, `:1186`).
- Fixed continuous deadline, 299,999 versus 300,000 admission, wall-clock jumps/suspension, canonical head versus finalized head, no-op A→B→A, retained receipts and stale token rejection.
- Target-first readiness, unrelated ready-note progress, stale successes AND stale failures after clear/reset/purge, true clean-close settlement, live writer versus interrupted recovery.
- Exact external observation replay, missing-path reuse/identity continuity, forgotten-note recovery distinct from Version Restore, scoped provenance and historical activity access.
- Byte-for-byte authored frontmatter/CRLF restore, append-only lineage, immutable revision pagination/cursors, unsupported schema rejection before any file or journal mutation.
- Shared Rust/TypeScript task-date fixtures and SQL migration rollback/concurrent initializer coverage. These exercise distinct seams rather than useless duplication.

## Inspection coverage and limits

All 55 files were inventoried by source/test attributes and test names; all direct `AppState::new` call sites across Rust source were checked for disposable setup. Deep call-path review covered ordinary editor/task publication, note identity preparation, task transforms/hash preparation/fake sink, task projection reconciliation/schema calls, catalog retry ordering, global config and state binding, watcher isolation case, timestamp conversion, receipt retirement tests, clean-close/scheduler fixture behavior, and representative publication/administration/observation/reconstruction tests.

Fully read small modules or complete relevant sections: current_document, note_persistence, task_mutation, note_catalog; task_dates transform/metadata/validation tests; timestamp parser/formatter; state binding/schema/migration tests; timeline test helpers; runtime/Store construction. Larger modules were sampled by risk and named behavior: history_store codec/admission/receipt/recovery/query sections; administration, lifecycle, forgotten commands, activity/provenance read paths and tests; window readiness tests and release fixtures. This is not a claim that every line of the 47k-line inventory received equivalent manual scrutiny. In particular, forgotten-note command scenarios and every corruption permutation should be re-reviewed before any large rewrite of those owners.

No full Cargo suite was run by this agent. The only executable experiment was the standalone exact-function timestamp reproduction. Performance findings describe demonstrated work/algorithm structure, not measured latency. No production or test files were edited; the parent audit coordinates test execution and subsequent implementation after reviewing all reports.
