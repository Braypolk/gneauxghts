# Backend timeline, persistence, task and watcher audit

Date: 2026-10-02. Audit only; no production or test edits. Scope: Rust NoteTimeline, history storage/runtime/provenance, note persistence, task mutation/projection, note catalog, watcher/reconciliation, app-state persistence and history commands; related architecture fitness checks.

## Assessment

The largest avoidable cost is fixture isolation and repeated full-service construction, followed by weak or duplicated assertions and overly specific architecture source checks. The repeated recovery, window, and command tests are often meaningful: store transaction atomicity, canonical publication ordering, runtime admission, restart recovery and IPC error translation are separate contracts. Removing one layer just because another contains similar words would remove fault coverage.

Confirmed correctness weaknesses in the tests include an unguarded writer stealing another test's global injected fault and a catalog test manually performing the projection it purports to verify. A target-code issue loses typed HistoryError classification during observation replay. Production improvement candidates are repeated app-state schema initialization, a large mixed-responsibility SQLite module, and retained per-path projection watermarks.

No timings are asserted here. The parent audit owns executable baseline and per-test profiling. Nine release diagnostics are already ignored; they are not default-suite runtime offenders. This report distinguishes static evidence from performance hypotheses.

## Contract reviewed

Read `CONTEXT.md`, `ARCHITECTURE.md` (canonical write paths and fitness checks), `docs/architecture/behavior-invariants.md` (save consistency, identity, self-save suppression, History Mode and provenance), `docs/architecture/editing-window-contract.md`, ADRs 0002/0004/0005/0006/0007/0008, and the repository code-review/codebase-design guidance.

Preserve mandatory durable intent preparation before Markdown, exact full-token matching, committed-result warnings without replaying a write, truthful baselines, retained exact observations before newer bytes, immutable revision identities, pending versus finalized heads, bounded receipts with protected references, fixed continuous-clock deadlines, no-op windows, per-note snapshot verification, global latch once corruption is discovered, obsolete verification rejection, replacement token invalidation, and clean-close portability/WAL barriers. Keep the one private NoteTimeline seam and concrete SQLite implementation; ADR 0004 explicitly rejects inventing a polymorphic store while SQLite is the only adapter.

## Findings by module

### Fixture isolation and fault injection

**BT-01 — P2, confirmed test race and cleanup leak. Guard every canonical writer and make environment lifetime explicit.**

Evidence: `state/persistence.rs:94-106` holds a process-global `FAIL_NEXT_NOTE_PUBLICATION`; `atomic_publish_note` consumes it at line 522. `state.rs:84,100,131,162,186` writer tests and `services/task_mutation.rs:503` do not take `lock_test_env`. Concurrent injected-failure cases such as `editing_window_capture/tests/readiness.rs:1082` and `task_mutation.rs:514` do take the lock, but a lock protects only cooperating tests. An unguarded atomic write can consume the injected failure, fail unexpectedly, and cause the intended fault case to succeed.

Global-path cleanup is also inconsistent: `tests/publication.rs:130` (`mutate_preserves_the_authoritative_publication_outcome`), `:1335` (`app_commit_preserves_identity_when_authored_content_becomes_empty`), `:1381` (`copied_identity...`), `note_catalog.rs:482` and all five task-projection tests install overrides without restoring them. Other tests restore only at the end; assertion panic skips restoration. `vault_watcher.rs:1056` constructs AppState without its own disposable root, making its behavior depend on whichever process configuration remains. The global mutex recovers poisoning (`test_support.rs:14`), so a failed predecessor does not isolate its leaked path from successors.

Change: immediately put the shared lock around every canonical writer/fault consumer. Then reuse a single RAII disposable-vault fixture: own lock, data/notes directories, state and optional clock; stop/join work and reset overrides before releasing the lock. `index.rs:1802-1847` already demonstrates a safer fixture lifetime. Keep explicit restart fixtures able to drop/recreate state without hiding process-global scope. Longer-term use existing `AppState::new_with_running_vault` and bound storage rather than global selection in ordinary fixtures; retain global-selection tests only where that behavior is the subject.

Validation: compare repeated default-parallel and `--test-threads=1` runs of writer/fault suites; temporarily panic inside a fixture and verify the next test sees a fresh root and no pending fault. Do not claim full test parallelism until compatibility bindings/global fault hooks are also removed. Confidence: high from exact shared atomic consumption and missing guards; no observed flaky-run rate measured.

### Note publication and lifecycle fixtures

**BT-02 — P2, confirmed obsolete replica. Delete the cfg(test)-only note-save implementation after migrating its contract cases.**

`state/persistence.rs:414-434` defines `persist_note` only for tests; `:487-507` defines its private `publish_note_save` only for tests. Production publication is in `services/note_timeline/publication.rs:81-239`, including durable preparation, watcher suppression, rollback and committed warnings. `state.rs:100-216` tests rename, concurrent path reservation, nested-directory preservation and chat rejection through the replica, not the production operation. The replica even commits rename suppression before the later write, unlike the production rollback-aware ordering. This is maintenance debt and weak evidence for production behavior.

Migration/deletion: move those four tests to command/NoteTimeline save tests, use real returned sessions/identities, and preserve one focused concurrent same-title create case. If chat rejection is already covered at the real command seam, merge only its identical input/expectation and retain explicit byte preservation. Keep `atomic_create_note_never_replaces_an_occupied_path`, pure stem/path logic and low-level atomic-publication tests. Then delete the test-only `persist_note`/`publish_note_save` functions and test reexports.

Validation: concurrent same-title creates preserve both bodies and distinct paths, rename stays in its nested directory, failed rename restores bytes/path, chat projections stay unchanged, no intent is left prepared after known failure. Confidence: high; replica is explicitly cfg(test) and four direct consumers are listed.

**BT-03 — P3, fixture consolidation judgment. Share construction and intentional retained-state setup, not every test assertion.**

The scoped inventory contains 143 explicit `AppState::new` construction sites and 252 lock sites, including multi-state restart scenarios. `tests.rs:34-52`, `provenance.rs:737-762`, `release_validation.rs:41-54` and command history fixtures independently save and explicitly finalize to produce retained states. The common timeline `tests/` suite repeats directory/scaffold/global setup while `editing_window_capture/tests.rs:14-110` has a more coherent fixture. The first helper explicitly documents that each step ends a window; it is not obsolete granular-editor compatibility.

Change: unify disposable state creation and a clearly named `save_and_finalize` fixture primitive. Provide a separate ordinary `save` primitive for real coalescing tests. Group timeline fixtures by publication, lifecycle/observation, administration, History Mode, readiness and evidence; use shared helpers only for mechanical preparation. Replace `include!` aggregation (`tests.rs:72-76`) with explicit child modules only if name changes are acceptable to release tooling. Do not merge restart and same-process scenarios or silently finalize inside a generic save helper.

Validation: same meaningful scenario/test count, same warning behavior, and separate assertions for pending and immutable heads. Confidence: high duplication, medium runtime benefit until constructor/SQL cost is profiled.

### Catalog and task projections

**BT-04 — P2, confirmed masked regression. A catalog test performs the task projection before checking it.**

`note_catalog.rs:482-546` calls `catalog.upsert(... Synchronous)` for a copied identity, then manually calls `apply_task_projection` at line 535 before loading copied task rows. Production `NoteCatalog::upsert` (`:303-331`) already passes `ProjectionWork::synchronous(true)` through the shared coordinator. If that production task dispatch stopped working, the manual projection could make the test pass.

Change: delete the manual second projection call; assert copied/original task identities directly after catalog upserts, alongside lexical assertions. Keep `deferred_publication_cannot_overwrite_newer_reconciliation` (`:549`) because it checks generation ordering and later removal, a distinct concern.

Validation: temporarily disable the production task-dispatch flag and verify this test fails; restore production code. Preserve duplicate identity resolved before any projection. Confidence: high.

**BT-05 — P2, confirmed production work; speedup unmeasured. Bootstrap app-state/task schemas once per bound connection.**

`task_projection.rs:194-198` invokes both `ensure_state_schema_idempotent` and `ensure_task_projection_schema` before reconciliation; the same pattern appears around 489/511/543/556/596/671. The supposedly idempotent wrapper (`state/persistence.rs:909-913`) reruns full `ensure_state_schema`: an IMMEDIATE transaction, eight CREATE TABLE statements and per-column migration inspection (`:916-1003`). Task schema itself executes table/index DDL (`task_projection.rs:66-100`). Meanwhile `AppStateStorage::bind` already performs state bootstrap once (`persistence.rs:749`). Reads/listings can therefore acquire a SQLite write transaction for schema bootstrap even when the schema is known. Every ordinary timeline save synchronously projects tasks via `post_publication.rs:119-129`, multiplying this work in storage fixtures.

Change: have bound app-state storage bootstrap both schemas transactionally on construction, then make projection operations use that initialized handle. Keep direct connection/bootstrap functions for migration tests. Finish replacing `RUNNING_STATE_DATABASE_COMPAT` (`persistence.rs:726-790,855-905`) with explicit bound storage where it simplifies ownership; this is a locality/testability improvement, not a proven current vault-switch bug. Its production connection is already bound to the running vault rather than the mutable next-launch preference.

Validation: retained legacy-state migration, two concurrent initializers, rollback on schema failure, missing task table on fresh vault, task identity/deadline/soft-delete behavior, restart settlement, explicit old/new-vault scope; measure statement and transaction count before/after. Confidence: high repeated work, medium benefit. No permanent schema cache keyed solely by process-global path.

**BT-06 — P3, production scale review. Projection coordination retains a watermark for every path ever encountered.**

`note_catalog.rs:53-66,112-121` inserts one Arc/Mutex state per unique path in a HashMap. Once work settles it clears only `latest.mutation` (`:162-165`), retaining the entry and generation. Removal also inserts/retains entries. Long rename/create/delete churn can grow this map for the lifetime of the app. The retained watermark is meaningful: it prevents an old queued lexical operation from resurrecting removed/newer content.

Review change: quantify churn, then consider queue-aware retirement or scoped generation tokens that keep a tombstone until older work cannot arrive. Do not simply remove the map entry after successful projection. Add bounded-churn acceptance only if this cost is material. Confidence: high monotonic membership, medium priority and memory impact; no measured regression.

### Test strength and redundant task cases

**BT-07 — P2, confirmed weak/duplicate assertions. Replace self-comparison and remove the fake derived-failure case.**

`task_mutation.rs:337-352` computes dispatch output then computes expected by calling the same toggle/delete helper as `transform_task_document` (`:79-88`). It detects dispatch-to-wrong-branch mistakes but adds no independent transform oracle. Use literal expected Markdown if keeping a dispatch smoke test; rely on existing index transform cases for algorithm coverage.

`task_mutation.rs:569-576` names a derived failure but creates `FakeSink(..., None)`, injects no failure, and repeats `clean_commit_writes_once_and_returns_authoritative_identity` (`:491-500`). Delete that duplicate. Real semantic-error behavior is exercised by `post_publication.rs:578-592`, which actually sets `semantic_error` and checks that diagnostics remain while required warning is absent. Keep the fake required-warning case because it verifies forwarding at the task result boundary.

`provenance.rs:1381-1423` calls its 200 iterations generated edits, but both fragments are determined modulo 9. After the first pass the edit geometries repeat every nine steps with changed evidence times. Either explicitly test two/three cycles for stability or use a reproducible seeded edit sequence that broadens transitions. Do not replace meaningful duplicate-line ambiguity, UTF-8, unterminated-line or restore-lineage cases with this generator.

Validation: literal task results include toggle/delete/due-date dispatch, semantic fault test remains, generated sequence still checks contiguous UTF-8 ranges and only retained evidence. Confidence: high for exact duplicate/no-fault case; medium judgment for generator.

### Readiness, scheduler and watcher concurrency

**BT-08 — P2, confirmed reliability and waiting cost. Bound progress waits and replace sleep-based control where hooks can acknowledge state.**

`vault_watcher.rs:1029-1054` uses unbounded `recv()` while scoped threads run: a stop/drain regression hangs the test process instead of producing a failure. Readiness tests are better bounded but use a repeated two-millisecond polling protocol (`editing_window_capture/tests/readiness.rs:18-26,43-49,89-94,151-154` and twelve additional sleep sites). Several tests prove a blocked call by waiting 100 ms for no result, such as `tests/publication.rs:1641-1647`; this adds unconditional idle time and assumes scheduling opportunity. Polling for actual completion/status is not inherently incorrect; controlling progress by timing when an acknowledgment is available is the avoidable part.

Change: use bounded receives for positive progress, release-on-drop ownership for paused workers, and a small test gate with explicit entered/released/cancelled acknowledgment. Keep real scheduler tests (`editing_window_capture/tests.rs` scheduler/drop, suspension and close cases) against the genuine worker; do not replace them all with direct tick calls. Use a bounded negative wait only where the assertion itself is that progress cannot occur, after the contender has acknowledged reaching the blocked boundary.

Validation: tests fail within a predictable bound on a broken stop/release, complete under busy/default-parallel scheduling, and still distinguish unrelated-note progress, same-note join, obsolete checks, cancellation-before-file-owner and clean-close lease ordering. Confidence: high unbounded wait; medium performance/reliability gain from polling replacement.

### SQLite storage and durable boundaries

**BT-09 — P3, profile-guided default-suite reduction. Keep one receipt-boundary integration test; move excess-volume stress to the existing release lane.**

`history_store/editing_windows.rs:1427-1495` performs 300 real prepared/captured file+SQLite operations in a default test although terminal retry bound is 64. `editing_window_capture/tests.rs:116-151` separately performs 80 real command saves; `editing_windows.rs:1639` and `:1795-1828` also cross the receipt bound. These exercise store transaction and command coordination separately, so the lower-layer and command-layer tests should both remain, but 300 is not required to cross the retirement threshold. The ignored `release_validation/windows.rs:177-329` already runs 12 × 300 production saves plus 1 MiB workloads.

Change after timings: shrink default store repetition to just beyond 64 plus protected anchor/endpoint exceptions, parameterize assertions instead of magic terminal counts, retain one abandonment-retirement case and explicit protected-reference case, and leave the 300/window acceptance in the ignored current-format release fixture. `tests/publication.rs:1265-1332` deliberately crosses adaptive checkpoint threshold 128 with 140 revisions; keep that threshold coverage. `tests/administration.rs:465-519` performs substantial compaction work to prove eventual physical reclamation; separate a cheap bounded-pass test from volume acceptance only if measured expensive.

Validation: exact old token stale, protected token retryable, canonical hash points to latest endpoint, sealed net revision reconstructs, outcome remains PendingWindow after seal, retained interval verified, no full prepared payloads retained. Re-run current-format release acceptance on a scheduled/manual lane. Confidence: high volume and overlap, medium runtime importance until measured.

**BT-10 — P2, confirmed loss of error classification in target code. Preserve typed errors through observation replay.**

`observation.rs:106-114` transforms `apply_observation` failure into `format!(...)`; `domain.rs:1874-1883` converts String/str to `HistoryError::Unavailable`. A proven Corrupt or Stale error is therefore delivered as Unavailable by this replay layer. `HistoryError::with_context` (`domain.rs:1848`) already adds diagnostics while preserving the variant. This matters to closed command state and recovery guidance. Many inner verification/finalization calls already latch corruption, so the code alone does not establish that every such path bypasses the global corruption block.

Change: use `error.with_context(...)` here and audit neighboring timeline contextual-error conversions for the same loss. Add one exact replay case returning a typed post-attestation corruption and one retryable I/O case; assert type, retained observation remains, current bytes unchanged, and appropriate global admission block. Existing `vault_watcher.rs:1187` checks exact retained B-before-C restart order, and readiness tests check latching elsewhere; neither directly proves this replay wrapper's returned classification.

Validation: Corrupt remains Corrupt, Stale remains Stale, Unavailable stays retryable; no observation acknowledgment before success. Confidence: high static variant loss, medium impact pending targeted reproduction.

**BT-11 — P3, larger private-module cleanup candidate. Split the history store by stable responsibilities and colocate narrowly scoped tests.**

`history_store.rs` is 6,074 lines: test mutation hooks dominate roughly 229-592, codec 593-945, observation ledger 947-1183, publication 1184-1802, append/headers/reads 1866-3044, deletion/labels 3046-3550, diagnostics/compaction/close/reset/rollback observations 3558-4776, recovery/reconstruction 4828-5338, inline tests 5340-5938 and further helpers 5940+. Existing private `editing_windows.rs`/`verification.rs` prove internal decomposition is possible without changing the external seam. `domain.rs` has many cfg(test)-only accessors alongside owned records; these are conveniences, not evidence of public production API breadth.

Suggested sequence: extract test-support helpers and inline tests mechanically; extract exact authored codec/reconstruction with pure/in-memory tests; separate selected-store admission/schema/portability and observation ledger or deletion tables when ownership is clear. Keep transactional append/capture/receipt operations local to one transaction and retain integration fixtures across extracted pieces. No new public storage trait or parallel writer. The broad `#[allow(dead_code)] mod editing_windows` (`history_store.rs:119`) should eventually be narrowed after compiler inventory; this audit found active policy use and does not claim a removable production helper without compiler/call evidence.

Validation: no visibility expansion, unchanged SQL/transaction order, fresh-format rejection byte preservation, all fault-point rollback tests, exact restore lineage, export/clean-close/recovery identity stability. Confidence: high responsibility spread, medium payoff relative to mechanical file-only splitting.

### Architecture fitness

**BT-12 — P3, confirmed refactor friction and incomplete source evidence. Keep architecture boundaries; stop pinning implementation spelling.**

Related cases in `tests/architecture_fitness.rs`: typed writers (121), private post-publication boundary (193), observers (279), command errors (402), one storage-neutral seam (540), current-content consumers (615), runtime owner (683), running vault (751), History Mode access (782), identity boundary (836), ordinary chat access (981), offthread/readiness (1037), restart (1138). They guard real invariants but use repeated raw source reads/string lists. Examples: exact multiline method chains (`:165-171,906-924`), SQL import spelling and PRAGMA strings (`:597-609`), doc headings (`:975-977`), and a brace counter (`:35-58`) which counts braces inside strings/comments. Concatenating modules and positive matching can pass when a required token exists only in dead code or a test helper; splitting on the first cfg(test) can omit later production code. They are fast but heavily coupled to code layout.

Change: consolidate forbidden-import/call boundaries using parsed or deliberately scoped production source; eliminate exact whitespace/import-list/heading assertions where visibility or executable behavior already proves the contract. Keep no caller SQL, private identity/grant issuer and restricted chat capability checks. Use existing runtime/conformance/command fixtures to prove behavior. Do not replace all static checks with broad integration tests or add expensive tooling solely to save milliseconds.

Validation: intentional prohibited import/call fails, legal formatting/private-file extraction passes, test-only occurrences cannot satisfy production ownership, one small source-scanning harness unit test handles comments/strings if maintaining that scanner. Confidence: high spelling sensitivity, medium parser/tooling choice.

## Keep versus consolidate map

| Cluster | Preserve | Consolidate/delete candidate |
| --- | --- | --- |
| Store receipts and windows | Full-scope token tampering; receipt/preparation rollback; endpoint/seal rollback; stale and protected references; interval corruption | Excess default repetition above the retirement boundary, not fault cases |
| Timeline publication | Prepare-before-write; exact managed identity/hash; no fallback history truth; live intent vs restart recovery; warnings | Test-only legacy state writer after its production scenarios are migrated |
| Runtime readiness | Same-note join; unrelated progress; replacement epoch; obsolete failure; global latch; cancelled close | Gate/poll helper boilerplate and avoidable timing-based waits |
| Administration | Note/vault clear active scope; missing/purge path reuse; reset-rebuild retry; rollback/new-install portability | Shared fixture mechanics; measured compaction stress lane |
| History Mode | Stable lineage/cursors; bounded anchored context; restore append-only/hash-bound; exact frontmatter | Shared save-and-finalize fixture; no inferred duplication across point/window tests |
| Provenance/evidence | Conservative duplicate-line ambiguity; UTF-8 ranges; removed prose exclusion; restore origin; interval/uncertain time | Repeated nine-state generator cycles unless they test a named long-sequence invariant |
| Catalog/tasks | Stable task identity; due-date moves; deletion; lexical/task generation ordering | Manual second projection masking; fake no-fault duplicate; self-comparison oracle |
| Watcher | Operation-aware exact suppression; retained B before disk C; stop/drain semantics | Own disposable AppState fixture; bounded progress channel waits |
| IPC contracts | Serialization of real Rust types and closed error states; offthread worker proof | Exact spelling checks already covered by executable conformance |

## Coverage inventory

The initial inventory below enumerates the original 45-file subset and its immediate private production modules; it omitted five related files now explicitly reviewed in the coverage reconciliation supplement below. Initial source counts: 45 files, 327 `#[test]` declarations, nine ignored release diagnostics; 252 direct shared-env lock sites and 143 direct AppState construction sites. Counts are source counts, not discovered executable-test counts: inherited fixture methods and include modules affect names, and a single test may contain many cases. Architecture fitness is additionally inspected for the related subset listed above. Full e2e, frontend, evidence-service and agent-tool ownership belongs to other audit reports.

| File | Lines | Tests | Ignored |
| --- | ---: | ---: | ---: |
| `src-tauri/src/commands/history_commands.rs` | 1550 | 12 | 0 |
| `src-tauri/src/commands/note_persistence.rs` | 134 | 1 | 0 |
| `src-tauri/src/services/note_catalog.rs` | 655 | 3 | 0 |
| `src-tauri/src/services/note_timeline/activity.rs` | 517 | 0 | 0 |
| `src-tauri/src/services/note_timeline/activity_history.rs` | 265 | 0 | 0 |
| `src-tauri/src/services/note_timeline/administration.rs` | 1025 | 0 | 0 |
| `src-tauri/src/services/note_timeline/current_content.rs` | 234 | 0 | 0 |
| `src-tauri/src/services/note_timeline/domain.rs` | 1890 | 0 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture/tests/evidence_contracts.rs` | 701 | 9 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture/tests/prose_tasks.rs` | 170 | 1 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture/tests/query_inventory.rs` | 433 | 4 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture/tests/readiness.rs` | 1255 | 25 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture/tests/weekly_tasks.rs` | 385 | 4 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture/tests.rs` | 3051 | 59 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_capture.rs` | 98 | 0 | 0 |
| `src-tauri/src/services/note_timeline/editing_window_policy.rs` | 91 | 2 | 0 |
| `src-tauri/src/services/note_timeline/forgotten.rs` | 347 | 0 | 0 |
| `src-tauri/src/services/note_timeline/history_mode.rs` | 1267 | 0 | 0 |
| `src-tauri/src/services/note_timeline/history_store/editing_windows.rs` | 1877 | 14 | 0 |
| `src-tauri/src/services/note_timeline/history_store/verification.rs` | 253 | 2 | 0 |
| `src-tauri/src/services/note_timeline/history_store.rs` | 6074 | 11 | 0 |
| `src-tauri/src/services/note_timeline/history_store_sql_work.rs` | 102 | 1 | 0 |
| `src-tauri/src/services/note_timeline/lifecycle.rs` | 499 | 0 | 0 |
| `src-tauri/src/services/note_timeline/observation.rs` | 481 | 0 | 0 |
| `src-tauri/src/services/note_timeline/post_publication.rs` | 613 | 5 | 0 |
| `src-tauri/src/services/note_timeline/provenance.rs` | 1464 | 16 | 0 |
| `src-tauri/src/services/note_timeline/publication.rs` | 412 | 0 | 0 |
| `src-tauri/src/services/note_timeline/release_validation/current_scale.rs` | 553 | 5 | 4 |
| `src-tauri/src/services/note_timeline/release_validation/windows.rs` | 422 | 3 | 3 |
| `src-tauri/src/services/note_timeline/release_validation.rs` | 232 | 2 | 2 |
| `src-tauri/src/services/note_timeline/runtime/verification.rs` | 575 | 0 | 0 |
| `src-tauri/src/services/note_timeline/runtime/windows.rs` | 392 | 0 | 0 |
| `src-tauri/src/services/note_timeline/runtime.rs` | 483 | 0 | 0 |
| `src-tauri/src/services/note_timeline/test_support.rs` | 139 | 0 | 0 |
| `src-tauri/src/services/note_timeline/tests/administration.rs` | 2228 | 36 | 0 |
| `src-tauri/src/services/note_timeline/tests/history_mode.rs` | 913 | 13 | 0 |
| `src-tauri/src/services/note_timeline/tests/observation_lifecycle.rs` | 1212 | 18 | 0 |
| `src-tauri/src/services/note_timeline/tests/publication.rs` | 1766 | 31 | 0 |
| `src-tauri/src/services/note_timeline/tests.rs` | 76 | 0 | 0 |
| `src-tauri/src/services/task_mutation.rs` | 577 | 12 | 0 |
| `src-tauri/src/state/persistence/migration_tests.rs` | 126 | 2 | 0 |
| `src-tauri/src/state/persistence.rs` | 1877 | 1 | 0 |
| `src-tauri/src/state/task_projection.rs` | 924 | 5 | 0 |
| `src-tauri/src/state.rs` | 547 | 15 | 0 |
| `src-tauri/src/vault_watcher.rs` | 1259 | 15 | 0 |

## Confidence and limits

Static audit inventories all scoped test declarations, fixture/fault/clock/wait mechanisms and target-module call paths. Deep tracing concentrated on publication, window storage/receipt integrity, admission/replacement, projection generations, typed errors and persistence lifecycle. This is not a claim of formal verification of every assertion or every SQL branch. No heavy tests, builds, latency probes, mutation experiments or release fixtures were run in this child audit. Findings BT-01/02/04/07/10 have direct code evidence; BT-03/05/06/08/09/11/12 include design or profiling judgments and must not be presented as measured speed regressions.

Prior implementation specs are historical evidence. Current code is schema 14, ordinary editor saves are pending-window capture, admission is per-note, and running-vault storage is bound at composition. This report intentionally does not propose reintroducing granular editor retention, old-store migration, mandatory whole-vault attestation, or a caller-visible post-commit service.

## Suggested implementation order after parent audit review

1. Guard fault-consuming writer tests and adopt disposable fixture cleanup; remove the catalog test's manual projection and the fake no-fault duplicate. Small behavior-preserving changes first.
2. Migrate the legacy test-only state writer cases to production save operations, then remove its replica.
3. Preserve typed replay errors with focused regression coverage.
4. Profile default-suite per-test costs; resize excess receipt loops and replace demonstrated waiting bottlenecks.
5. Bootstrap task/state schemas at binding and shrink compatibility storage usage with explicit scope/restart tests.
6. Mechanically extract private test support/codec, then revisit store responsibility boundaries and architecture scanner brittleness. Queue-aware watermark retirement remains optional pending a churn measurement.


## Coverage reconciliation supplement — 2026-10-03

The initial pass omitted test-scenario inspection and inventory rows for `state/config.rs`, `commands/forgotten_note_commands.rs`, `commands/task_commands.rs` and `commands/proposal_commands.rs`. `commands/note_session.rs` had only been inspected as a caller and has no inline tests. Those omissions are corrected here after reading the complete test modules and their targeted production paths; this is additional review, not a retroactive claim that the original pass included it. No code changes or executable/heavy tests were performed for this supplement. The already-authorized small implementation tranche removed one original test; original inventory counts remain historical.

| Additional file | Lines | Source tests | Actual scenario review |
| --- | ---: | ---: | --- |
| `src-tauri/src/state/config.rs` | 889 | 9 | All nine bodies and targeted path/manifest functions |
| `src-tauri/src/commands/forgotten_note_commands.rs` | 1,671 | 17 | All seventeen bodies and forgotten note/chat command branches |
| `src-tauri/src/commands/note_session.rs` | 259 | 0 | Complete production path and six external `commands.rs` scenario bodies |
| `src-tauri/src/commands/task_commands.rs` | 632 | 5 | All five bodies; list/group delivery and task mutation wrapper |
| `src-tauri/src/commands/proposal_commands.rs` | 301 | 1 | Complete commit/status-convergence path and the synchronization fault test |

The primary covered inventory now contains 50 distinct files; the additional 32 test declarations are separate from the original 327. `src-tauri/src/commands.rs` was additionally inspected for the note-session subset at lines 1107-1329, rather than claiming its entire test module as covered here. Frontend, chat service and native acceptance ownership remains in other reports.

### Vault configuration scenarios and targets

`state/config.rs:709-888` checks path derivation; initial directories/manifest and custom history format/generation; stable ID/creation time on re-scaffold; override precedence; Unix root/observation symlink canonicalization; invalid vault names; immediate-child containment; folder creation/list filtering; platform-specific default Documents root. Trace: `RunningVault::resolve` (:46-57) freezes canonical roots, `prepare_vault_root` (:286-302) creates/canonicalizes the folder, `ensure_vault_scaffold_for_history` (:612-643) preserves existing format/generation while refreshing application manifest data, and `validate_vault_path_in_container` (:396-451) canonicalizes both parent and existing target. These are meaningful configuration/path contracts. Retain custom initial format fixtures: they test format-neutral scaffold ownership, not unsupported-history admission.

A small assertion-strengthening opportunity exists in `ensure_vault_scaffold_is_idempotent_and_stable_id` (:745-763): the second call passes ignored history format/generation but asserts only ID/time afterward. Assert both returned and on-disk format/generation remain the original values, since rollback authority must not be overwritten by re-scaffolding. This is a coverage improvement, not a found production defect.

Four filesystem-local config tests (`:723,745,829,852`) acquire the global environment lock although traced helpers use explicit disposable roots and no global atomic note-write fault. They can be considered for removal of unnecessary serialization after a complete fault-consumer inventory; tests that set Documents/selection overrides must keep isolation. Do not mechanically remove the lock from all config tests.

### Forgotten note/chat lifecycle scenarios and targets

Reviewed race cases: save commits after forget planning (:507); stale purge versus recovery and optional re-forget, for manual and expiry paths (:575, four combinations); equivalent archive/recover/re-archive chat race (:699, four combinations); concurrent archive/expiry while an ordinary forget fails and unrelated navigation metadata changes (:809); destination appears after move planning (:936); stale row rollback/pruning preserves newer selection (:951). Retain these interleavings: ordinary note and chat have different persistence owners. The two four-case loops are purposeful state/entry-path matrices rather than eight indistinguishable repeats.

Reviewed durable cases: all three retention windows with restart, reused original path and later expiration (:988); confirmed reset of corrupt forgotten history with damaged on-disk metadata and unchanged bytes/deadline across restart (:1174); target collision planning (:1333); failed publication restores file/state and leaves no lifecycle intent (:1349); committed forget exposes warning and deferred exact lifecycle replay (:1410); chat-folder registration/recovery bookkeeping (:1479); expiry deletes chat folder and durable conversation (:1529); persisted identity despite missing file (:1586); unmanaged input obtains managed identity (:1606); managed identity and removal of trash metadata (:1624); purported damaged-metadata helper case (:1649, finding below).

Trace: ordinary commands enter `NoteTimeline.forget_note`, `recover_forgotten_note`, `purge_selected_forgotten_note` (:56-75,165-192,444-449) while chat uses compare-and-match bound app-state records under the shared file owner (:207-234,452-468). Startup cleanup (:372-410) first recovers lifecycle evidence, then distinguishes recovered identity continuity from expiry. `services/note_timeline/forgotten.rs:136-239` checks readiness/replay again under ownership, validates source bytes, stages metadata, atomically publishes/moves with rollback, and converts postcommit bookkeeping failures into warnings. Preserve these ownership distinctions; do not route chat-folder archive through ordinary-note revision logic.

**BT-13 — P2, confirmed misleading test. The damaged-metadata helper case starts with already repaired metadata.**

`commands/forgotten_note_commands.rs:1649-1670` is named `damaged_metadata_uses_catalog_identity_through_forget_and_recovery`, but its `repaired` literal already contains the expected managed identity. It constructs no catalog and never damages metadata. `prepare_forgotten_note_markdown` simply delegates to note preparation (`services/note_timeline/forgotten.rs:242-252`). The case therefore repeats the retained managed-identity transformation at :1624 with different strings and cannot detect a failure of timeline catalog continuity.

Change: replace with one command/NoteTimeline integration scenario that establishes catalog identity, removes/corrupts embedded identity, calls forget and recovery, and verifies the original identity plus authored bytes and lifecycle evidence. Alternatively rename as a repaired-input helper smoke test and delete the duplicate if the command scenario already exists in another suite. Keep unmanaged-input and unreadable-persisted-identity cases, which cover distinct fallback rules. Validation: temporarily remove preparation's catalog fallback and require this integration case to fail; retain no-write-during-observation and original atomic-publication repair. Confidence: high for current weak assertion, target gap requires cross-report reconciliation before adding a test.

**BT-14 — P3, concrete fixture duplication; cost unmeasured. Most forgotten command tests create a mock Tauri app to call state-explicit functions.**

This test module has ten `tauri::test::mock_builder` sites while the operations exercised are `forget_note_with_state`, `restore_forgotten_notes_with_state`, `delete_forgotten_notes_with_state`, cleanup and timeline methods. Those functions accept concrete AppState/ChatService references and do not require a UI runtime. Mock apps primarily serve dependency lookup (`app.state`) and lifetime management. Construction is repeated inside race matrices; no IPC handler is invoked in those cases.

Change after timings: a disposable fixture can directly own AppState plus optional ChatService and provide explicit references/restart replacement. Keep one actual command-worker/Tauri integration case elsewhere to verify IPC dispatch; remove mock runtime from cases whose subject is filesystem/state coordination. This extends BT-03 without deleting their concurrency/restart invariants. Confidence: high removable setup coupling, medium speedup until measured.

One fixture-scope issue extends BT-01: `chat_folder_uses_the_forgotten_item_recovery_lifecycle` (:1479) sets a disposable notes root but never installs its own app-data/observation directory before `AppState::new`. It can inherit a deleted predecessor's global app-local path, even though the note root is fresh. Include it in the shared disposable-vault fixture migration.

### Note-session scenarios and targets

There are no inline tests in `commands/note_session.rs`. Read the six external scenarios in `commands.rs:1108-1329`: stale last-opened state becomes blank; opening updates last-opened/recents; relative nested paths resolve and parent traversal fails; stable ID follows an external rename after supplied path disappears; row-scoped open leaves pins/hidden/order/collapse untouched; read-only session extraction does not update navigation.

Trace: `NoteSessionLookup` (:37-61) selects warm/cold index strategy; `resolve_note_path_by_id_with_state` (:63-75) uses index then disk fallback; load/open (:109-182) maintain row-scoped state and activity; extraction (:184-203) preserves tag diagnostics; supplied-path resolution (:205-259) falls back to Note Identity after external rename and rejects traversal. These are behavioral target tests outside the module, so zero inline tests does not mean missing coverage. External note-session fixtures still have non-RAII global cleanup debt (BT-01). The cfg(test) disk-only wrapper is a thin adapter around production code, unlike the separate legacy writer from BT-02, and does not merit deletion purely because it is cfg(test).

### Task command scenarios and targets

Four cheap tests (:508,521,544,566) independently check Open/Completed/All filtering, hidden task counts/display, hidden note visibility, and omission of groups when no tasks display. Preserve them rather than collapsing task and note visibility into one Boolean case. The fifth (:577) pauses a current-content read, clears history while the query is running, releases it and expects no stale task results.

Trace: list/recent/group functions (:64-158) cross CurrentContentAccess, grouping derives view counts (:168-286), and `mutate_task_with_view` (:414-447) commits through TaskMutationService and merges postcommit view-refresh warnings into the returned authoritative path. The stale delivery test deliberately exercises the timeline read seam rather than query SQL; task projection identity tests are complementary.

Its rendezvous channels at :601-621 use unbounded `recv`/blocking `sync_channel(0)` sends, extending BT-08: if `clear_note_history(...).unwrap()` fails before release, the scoped reader remains blocked and scope joining can hang. Use bounded positive waits plus release-on-drop/nonblocking release ownership. No additional test count is needed solely to duplicate current-content invalidation already covered at this seam. The production postcommit TaskViewRefresh merge has no direct inline scenario in this file; do not infer absence across native/frontend tests without the parent coverage map.

### Proposal command scenario and targets

`proposal_synchronization_returns_history_finalization_warning` (:251-299) actually prepares publication, writes authoritative canonical bytes, injects finalization failure, and verifies both identity and HistoryFinalization warning. Preserve it: it proves task/proposal-specific warning forwarding rather than merely the store fault hook.

Trace: `commit_agent_proposal_with_state` (:30-158) rechecks proposal status and conversation permission, plans against the running vault, begins durable commit intent, prepares timeline publication under the shared owner, abandons known errors/conflicts, adopts authoritative identity/warnings, and converges proposal status. `converge_agent_proposal_status` (:201-238) retries status recovery and distinguishes canonical committed bytes from unpublished failure; underlying durable status/recovery tests are in the chat service, owned by its audit report. `synchronize_applied_change` (:172-198) crosses the typed AcceptedChatProposal mutation seam. No confirmed production defect or redundant assertion was found in this inspected one-test module. Fixture boilerplate falls under BT-01/03; retain its real fault injection.
