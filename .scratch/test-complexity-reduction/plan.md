# Delegated reduction plan

1. Freeze current source/count inventory (baseline.json) before edits.
2. Five owners audit their bounded areas, including the code/interfaces their tests target. Persist proposals and retained coverage ownership before changes; coordinator reviews.
3. Remove redundant tests and test-only plumbing, simplify necessary setup and narrow exposed interfaces where justified. Keep real defect regressions and distinct layer contracts.
4. Owners verify their remaining suite; coordinator reviews deletions against named retained behavior and runs combined gates. Use focused mutation checks for representative deleted-test protection when uncertainty warrants them.
5. Publish exact net changes and remaining expensive/complex areas. Do not claim complexity was reduced from test counts or file splitting alone.

## Ownership

- 01 Documents: document/workspace/persistence/history/navigation orchestration tests and supporting production seams. Excludes editor runtime/search, chat, proposals.
- 02 Editor: editor/runtime/Markdown/tasks/search/related/proposals tests and code. Coordinate shared document APIs before source edits.
- 03 UI: Settings, Atlas frontend, AppStore/listeners, chat frontend, their fixtures/types and shallow wrappers.
- 04 Timeline: Rust persistence/timeline/note catalog/task projection tests and helpers, structural fitness. No semantic/chat/evidence edits.
- 05 Agent/semantic: Rust chat/evidence/retrieval/proposals/semantic numerical/runtime tests and support.
- 06 Coordinator: browser/native E2E, Node/Python support, TS architecture checks and cross-module integration. Shared test_support.rs changes require coordinator approval/owner agreement.

## Acceptance

Review proposals first. Attribute every substantial deletion to a retained contract owner or explicitly obsolete behavior. Record removed helper/mock/configuration concepts as well as LOC. Do not add another broad correctness campaign in place of reduction. Final independent review checks both preservation and demonstrated simplification.

## Reviewed scope

All six proposals are recorded in issues/01–06 and approved after comparing removed assertions with their remaining owners. Confirmed reductions include duplicate workspace ownership fakes, unused Settings forwarding modules and mocks, synthetic proposal/runtime graphs, test-only exports/constructors/getters, repeated lifetime setup and internal source/call-count checks. Distinct rollback, restart, permission, stale-completion, numerical-policy and geometry contracts remain.

The frontend baseline was rerun before edits:152 files/1,162 tests,32 support checks; Vitest15.30s, test execution4.28s. This is a same-command local observation, not a portable performance guarantee. Source snapshot and inventory precede changes. Representative mutation checks will test retained protection rather than relying on similar test names.

## Final acceptance

All six delegated reduction areas and the bounded integration-fixture follow-on are complete. Reviews and combined gates passed; see README.md and validation.md. Net removal: 2,262 maintained source lines, six files, 45 frontend cases, nine ordinary Rust cases, four browser cases and one obsolete ignored benchmark. No new source/test files or test framework introduced. Initial integration failures and their concrete corrections remain recorded.
