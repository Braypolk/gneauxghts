# Test suite audit and cleanup

Start with [combined review and priorities](review.md), then the module reports and individual handoff issues. [Scope](spec.md) records the audit-before-edit requirement; [validation](validation.md) records what actually ran. Initial report paths/lines refer to baseline `cb4d4c0`. Dated reconciliation supplements identify current-tree references and inspections added after the bounded cleanup. There are 83 named review items and 18 handoff tickets; related items can belong to the same workstream.

| Module | Detailed audit |
| --- | --- |
| Documents, workspace, navigation, History Mode, proposals | [frontend-documents](reports/frontend-documents.md) |
| Editor, Markdown, images, search, related notes, tasks, UI | [frontend-editor](reports/frontend-editor.md) |
| Note Timeline, persistence, task projections, watcher | [backend-timeline](reports/backend-timeline.md) |
| Chat, agent runtime, evidence, semantic indexing, app/settings/Atlas | [agent-app](reports/agent-app.md) |
| Browser/native E2E, fixtures, scripts, execution gates | [e2e-harness](reports/e2e-harness.md) |
| Architecture fitness, contracts, residual utilities, proposal resolver | [cross-cutting](reports/cross-cutting.md) |
| Backend command/cache/index/event/lifecycle composition | [backend-boundaries supplement](reports/backend-boundaries-supplement.md) |

## Inventory and baseline

Static [inventory.json](inventory.json) discovers 141 frontend test files, 85 Rust test-bearing files, 34 E2E/spec/support test files, and two script test files. It lists lexical declarations, line counts, ignores and selected mechanism counts. Rust file lengths include production; they are not test-only size. Parameterized frontend cases expand to 1,007 executed tests. Reports explicitly state review depth and execution limits.

Frontend baseline: 141 files / 1,007 tests passed. Type checks: zero Svelte errors/warnings; E2E TypeScript passed. Node support/artifact checks: nine passed (eight cheap support cases plus one separate macOS Cargo artifact probe). Python fixture checks: eight passed. Rust sandbox run: 710 passed, one localhost binding permission failure, 16 ignored; the exact failing local-HTTP case passed with binding allowed. The complete unrestricted run and final verification are recorded in validation.

A single frontend run took approximately 42.64 seconds including startup/transform under concurrent work on this host. The legacy-field whole-program architecture assertion took 2.34 seconds. Treat these as observations, not a stable speedup baseline. No browser/native/model/scale execution is claimed.

## Completed first cleanup

Fixed stale search/related admission, retry after conflict editor failures, and inherited history-error keys. Removed ineffective duplicate assertions/compiler work, strengthened catalog ownership evidence, guarded identified Rust fault consumers, included eight cheap harness checks in the default test command, and closed Python SQLite connections.

Final verification: 1,030 frontend tests plus eight harness checks passed; type checks passed; eight Python tests passed; all 34 affected Rust tests passed. Full Rust baseline: 711 library plus 19 architecture tests passed, 16 intentionally ignored. Changed Rust files pass formatting; the whole-project format check exposes five untouched baseline files. Native/live-model/scale runs remain unexecuted. Details and logs: [validation](validation.md).

Use the [coverage ledger](coverage-ledger.md) to locate any inventoried file and the [issues directory](issues/) for scoped follow-up tasks. Private history/chat/Atlas decomposition, shared faithful composition fixtures, parser-consistent editor admission, incremental decoration, browser IPC fixture rewrite, and explicit execution lanes are the larger proposals. Each preserves existing owners and requires replacement evidence before deletion.
