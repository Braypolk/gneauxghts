# Test reduction

Progress: Complete. Approved reductions, independent reviews and final acceptance passed. See validation.md for exact commands, results and limits.

## Result

This phase removes **97 actual test cases**, **1,835 physical lines of tests/test-only support**, and **two entire test files**. It changes no application behavior and adds no replacement tests or support framework. Counts compare the saved working tree at the start of this phase, after the architecture rewrite, not Git HEAD.

| Suite | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Frontend Vitest | 1,137 | 1,065 | 72 |
| Rust library (non-ignored) | 746 | 725 | 21 |
| Rust architecture | 23 | 21 | 2 |
| Affected browser pane-animation spec | 11 | 10 | 1 |
| Affected native app-lifecycle spec | 3 | 2 | 1 |
| **Cases removed** | | | **97** |

Five duplicate inline-format fixture rows were also removed inside an existing case; they are **not** counted as five executable cases. Support32 and Python8 remain unchanged, as do existing opt-in suites. Existing ignored cases are not new deletions.

| Audit group | Cases removed | Net test/support lines removed |
| --- | ---: | ---: |
| Workspace, documents, navigation, History | 34 | 461 |
| Editor, images, proposal review | 16 | 172 |
| Chat, settings, Atlas, frontend contracts | 22 | 283 |
| Timeline, evidence/task callers | 13 | 425 |
| Other backend and architecture | 10 | 488 |
| Browser/native | 2 | 6 |
| **Total** | **97** | **1,835** |

Physical lines include comments/blanks and test-only accessors in Rust production files. No production-line reduction is claimed. `changes.json` and `source-changes.patch` contain the exact49-file phase diff. The deleted whole files are `notepad/editor/indentConfig.test.ts` and `notepad/images/imagePerformance.test.ts`.

## What was redundant

- Simple success cases repeated by real controller/workspace/editor composition that checks the same result plus identity, persistence, undo or lifecycle effects.
- Multiple inputs with different labels but the same production branch, while distinct branches and actual event entrypoints remain tested.
- Tests asserting constructor defaults, constant-to-itself equality, deterministic hash self-comparisons, receipt getter echoes or direct third-party editing commands.
- Source-text architecture checks pinning exact helper names, signatures and struct fields. Privacy/write-ownership bans, role/capability boundaries, offthread admission and restart ordering remain.
- A duplicate80-save Editing Window scenario superseded by exact stored receipt boundaries and real editor admission/deadline journeys.
- Fake task-shaped clear/read concurrency coverage superseded by the retained generic read-admission race; the deleted test never invoked a task command.

Some removals intentionally discard low-value detection rather than pretending another test is identical: individual settings keyword aliases, trivial forwarding equality, exact spare ANN capacity and static app title. Every such tradeoff is explicit in its audit map.

## What remains and why

Retained tests cover distinct race schedules, data loss, canonical identity, corruption/rollback/restart, privacy, selection/undo, platform rendering, date/Unicode boundaries and actual UI wiring. A mocked controller test does not replace a native serialization boundary; Chromium and WKWebView checks are not interchangeable. The audits explicitly rejected several apparently similar cases after finding different assertions or production branches.

The ordinary frontend/Rust/architecture total falls from1,906 to1,811, approximately5%. This is a bounded reduction of excess, not evidence that every remaining test is indispensable. This audit did not establish a safe basis for a wholesale cut of the remaining suite. Larger reductions would need further behavioral tradeoffs or a different testing strategy; the inspection limits are recorded in each module audit. No throughput claim is made: full frontend test-body time remained essentially unchanged in these runs, and wall time includes concurrent typechecking and collection overhead.

## Verification

Full frontend1,065, Rust library725+architecture21, support32 and Python8 passed. Svelte/TypeScript reports0 errors/0 warnings; E2E typecheck and whitespace checks passed. The affected browser pane-animation spec passed10 cases; native app-lifecycle passed2. The rest of the graphical suite was unchanged and not rerun in this test-only phase. Existing15 opt-in Rust cases remain ignored; no new ignores or skips were added.

## Evidence and handoff

All six audits were written before code edits. The coordinator separately approved the additional same-branch cuts before their edits. Named removed/surviving tests, retained boundaries and inspection limits are in:

- [Workspace/History audit](01-workspace-audit.md) and [result](01-result.md)
- [Editor/proposal audit](02-editor-audit.md) and [result](02-result.md)
- [Timeline/task audit](03-timeline-audit.md) and [result](03-result.md)
- [Backend/architecture audit](04-backend-audit.md) and [result](04-result.md)
- [UI/contracts audit](05-ui-audit.md) and [result](05-result.md)
- [Browser/native/support audit](06-e2e-audit.md)

Independent [frontend Standards](review-standards-frontend.md), [frontend Spec](review-spec-frontend.md), [backend Standards/Spec](review-backend.md), and [coordinator coverage review](review-root.md) have no open findings. [Validation](validation.md) records exact checks, the compile-caught getter cleanup correction, final counts and limits. `frontend-case-delta.json` records executable name differences with multiplicity; one surviving case title was corrected after fixture removal and is not counted as a deleted case.

All changes remain uncommitted. No push or deployment performed.
