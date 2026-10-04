# Test suite and codebase audit

Audit baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`.
Date: 2026-10-02 (America/Denver).

[Comparison with “Audit tests and codebase sol”](sol-comparison.md) maps shared
findings, additional defects, implementation overlap and a combined work order.

## Main conclusion

The problem is uneven test confidence and repeated setup more than raw test count.
Fast state-machine cases often protect distinct, important behavior. The stronger
cleanup opportunities are obsolete code kept alive only by tests, fakes that
reimplement the policy under test, assertions that cannot fail, and expensive
global/database setup for narrow behavior. Several genuine correctness gaps were
found while following tests into production code.

All module audits were saved and reviewed **before any production or test edits**.
[Review decisions](review.md) record the gate and bounded first implementation.
[Request/scope](spec.md) and [raw inventory](measurements/inventory.json) make the
work resumable. Source citations in the reports refer to the baseline; re-resolve
line numbers when implementing follow-ups.

## Module reports

| Related modules | Main review items | Detailed audit |
| --- | --- | --- |
| Documents, panes, workspace, History Mode, proposals | Weak sequence oracle, retained test runtimes, fake proposal review engine, dead pane helpers, repeated adoption policy; build real-owner composition harness | [Frontend coordination](reports/frontend-coordination.md) |
| Editor, Markdown, images, tasks, discovery | Broken multi-transaction sibling synchronization, async task/search/related lifetimes, Unicode offsets, DOM-only offscreen navigation, delayed clipboard cut | [Editor and discovery](reports/editor-and-discovery.md) |
| Canonical persistence and Note Timeline | Unsafe watcher fixture, globally serialized setup, repeated schema initialization on task reads, misleading task tests, invalid timestamp acceptance, retry-map scans | [Persistence and timeline](reports/backend-persistence-and-timeline.md), [inventory](reports/backend-persistence-inventory.md) |
| Chat, evidence, runtime and tools | Non-atomic admission/finalization exposure, cursor capacity defect, repeated inventory work, test-only proposal writers, real tool integration gaps, divergent live harness | [Agent and evidence](reports/backend-agent-and-evidence.md) |
| Shared UI, Settings, Atlas, search and semantic indexing | Unicode search panic, listener retry leaks, stale Settings/Atlas work, copied AppStore fake, real retry sleeps, scale assertions that do not measure reads | [UI and indexing](reports/ui-settings-and-indexing.md) |
| Runners, architecture and E2E | Vacuous compiler scan, fragile source-text assertions, undiscovered support tests, permissive IPC fixture, server ownership/readiness, unclear native tiers | [Harness and suite](reports/harness-and-suite.md) |

Each report separates confirmed defects, design judgments and unmeasured
performance hypotheses, with concrete evidence, replacement coverage, risk and
an inspection ledger. File discovery is exhaustive in first-party source roots;
large production modules were inspected by risk/call path rather than claiming
every line was proven. Vendored code was excluded.

## Highest-priority remaining work

1. **Fix async lifetime admission at existing owners.** Chat can duplicate
   subscriptions after partial initialization failure. AppStore can leak staged
   listeners; Settings, Atlas and task list initialization can outlive disposal.
   Search/related results can arrive after their input becomes obsolete.
   [Issue 01](issues/01-async-store-lifetimes.md).
2. **Fix search coordinate contracts.** A reproduced Rust search panic uses a
   lowercase byte offset against original UTF-8. Current-note highlights confuse
   UTF-16 with code-point offsets. Then replace visible-DOM destination matching
   with current document ranges. [Issue 02](issues/02-search-coordinate-contract.md).
3. **Repair test oracles before large frontend refactors.** Sequence tests swallow
   all unchanged-state exceptions; proposal tests simulate an outdated review
   state. Replace policy-copying fixtures with composed real owners.
   [Issue 04](issues/04-frontend-orchestration-depth.md).
4. **Fix evidence continuation admission and page reuse.** Search 32 can return
   a cursor that capacity checks then reject. Inventory continuations recreate
   searches and one test hides accumulation by creating a new session per page.
   [Issue 08](issues/08-evidence-pagination.md).
5. **Give durable chat operations a direct test boundary.** Admission and
   finalization failure paths need real transaction/recovery coverage; seeded SQL
   alone does not exercise them. [Issue 09](issues/09-chat-storage-boundary.md).

The clipboard cut stale-target defect is in [issue 03](issues/03-editor-command-composition.md).
Invalid calendar dates, weak render assertions and the conditional asset race
investigation are in [issue 14](issues/14-small-boundary-contracts.md).

## Substantial rewrites worth staging

- **Explicit persistence fixtures and bound storage handles:** remove accidental
  dependence on global paths, then unlock safe parallel Rust tests. Initialize
  task schema once at storage admission. Preserve canonical NoteTimeline and
  SQLite ownership. [Issue 05](issues/05-rust-fixture-isolation.md),
  [issue 06](issues/06-task-storage-schema.md),
  [issue 07](issues/07-timeline-fixture-organization.md).
- **Private ChatService admission/finalization and real agent test context:**
  exercise actual tools with a deterministic model; retire the second live
  protocol loop and unused unprepared proposal writers. Keep the app-owned runtime
  seam and worker permission/budget boundaries.
  [Issue 09](issues/09-chat-storage-boundary.md),
  [issue 10](issues/10-agent-runtime-test-seam.md),
  [issue 11](issues/11-proposal-prepared-writers.md).
- **Deadline-driven semantic work:** separate work selection, execution and retry
  scheduling so tests use controlled time and shutdown can interrupt waits.
  Measure visited rows/work in scale checks. [Issue 12](issues/12-semantic-scheduling.md).
- **Strict, domain-organized E2E fixture and owned server lifecycle:** fail unknown
  commands, validate server identity, reset independent scenario state, and define
  deterministic native versus live/scale gates. [Issue 13](issues/13-harness-contracts.md).

These are separate changes with replacement tests, not one application rewrite.
Removing a forwarding module is useful only if caller complexity disappears;
moving consistency policy out of its owner would make this code harder to test.

## What should remain

Keep distinct save/restore/conflict/recovery boundaries, exact identity and
provenance tests, production streaming-runner tests, permission allow/deny,
cross-language task-date contracts, migration rollback, and independent browser/
native rendering checks. Keep short pure command and state sequence tests.
Do not mistake a second layer's different failure boundary for duplication.

## Baseline evidence and limits

| Check | Baseline result |
| --- | --- |
| Vitest | 141 files / 1,007 tests passed; 47.52 s cold mixed-load run |
| TypeScript/Svelte/E2E types | Passed; 0 Svelte errors or warnings |
| Rust | Built and enumerated: 727 library tests + 19 architecture tests; execution deferred until unsafe fixture corrected |
| Node support + build-artifact probe | 9 passed; 6.03 s, mostly intentional build cycles |
| Python fixture checks | 8 passed; 0.071 s |
| Browser/native/live/scale | Static audit only; not run |

[Baseline Vitest log](measurements/vitest-baseline.log),
[per-file execution observations](measurements/vitest-baseline-summary.json),
[compiler path reproduction](measurements/architecture-path-repro.json),
[compiler enforcement proof](measurements/typecheck-legacy-field-repro.json).

Vitest reported 6.08 s total test execution summed across workers versus 468.89 s
collection summed across workers; these are not elapsed durations. Import/
collection cost deserves measurement before shaving cheap test cases. The
1.75-second legacy compiler scan did no useful scanning. No percentage speedup is
claimed from cold/warm runs or static cost models.

## Initial implementation and final checks

The initial cleanup is complete: 15 tracked files changed, net 102 lines removed.
It removes dead helpers and ineffective/duplicate assertions, fixes test isolation,
simplifies TaskRecord construction, and corrects editor batch synchronization with
regression coverage. [Accepted scope](review.md), [frontend implementation](implementation-frontend.md),
[persistence implementation](implementation-persistence.md), [editor implementation](implementation-editor.md).

Final checks: **1,008 frontend tests**, **710 Rust library tests + 19 architecture
tests**, **8 Node support tests**, **8 Python checks**, and type checking passed.
The Rust totals combine the full run with one approved rerun of a sandbox-blocked
localhost fixture; 16 ignored Rust tests and browser/native/live/scale execution
remain outside validation. See [complete validation and limitations](validation.md).
The 14 larger handoff issues remain open. No overall suite speedup is claimed.
