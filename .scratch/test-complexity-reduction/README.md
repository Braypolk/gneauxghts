# Complexity reduction — second pass

Implemented, independently reviewed, and verified. Final gates: 1,117 frontend cases, 743 Rust cases, 32 support cases, 23 architecture cases, and 40 affected browser scenarios passed; typechecking and production Rust checking passed. Detailed commands, initial failures, corrections and limitations are in validation.md.

This pass addresses maintenance machinery as well as redundant cases. Compared with the frozen tree at the start of this pass, maintained source falls from 193,790 to 191,528 physical lines: **2,262 fewer lines**, six files deleted, no source files added. Audit reports are excluded. Of the reduction, 2,169 lines are tests/test support (including inline Rust tests and test-only methods); 93 are production. Dedicated test/fixture files alone fall by 1,878 lines. See reduction.json for exact per-file deltas and classification caveat.

| Module | Concrete simplification | Net lines removed |
| --- | --- | ---: |
| Documents/workspace/history | Replaced a thirteen-option fake workspace membership/retirement model with existing real composition. Simplified persistence fixtures and chat adapter inputs; removed dead dependency and unsafe whole-module casts. Deleted duplicated state/SSR cases with retained behavioral owners. | 681 |
| Editor/search/proposals | Removed fabricated proposal runtime, repeated lower-level happy paths, redundant draft/cache fixtures and four test-only exports. Existing command/orchestration tests own transferred assertions. | 355 |
| Settings/Atlas/chat UI | Deleted three forwarding modules and three test files; removed two module mock layers/four spies, unused semantic presentation logic and unnecessary full DTO construction. | 428 |
| Rust timeline/tasks | Deleted seven test-only methods and four redundant cases; thirteen fixture setups now reuse unchanged TestVault. Narrowed code-text architecture checks while retaining ownership prohibitions. | 435 |
| Rust agent/evidence/semantic | Removed synthetic dynamic-tool script, obsolete streaming comparison and old writer. Transferred assertions into real persistence/runtime tests. Removed five always-empty internal retrieval fields and dead branch. | 284 |
| Browser/architecture | Removed scroll-dispatch interception, duplicate Clear journey and intermediate-width duplicates; dropped three AST implementation-shape checks. Preserved actual offscreen geometry, completion waits and ownership boundaries. | 82 |

The final integration check also corrected inherited nonblocking mode in an existing macOS HTTP fixture (+3 test-support lines, no new case); issue07 records the native socket flag evidence.

Frontend cases fall **1,162→1,117**, with files 152→149. The same pnpm test command still passes 32 support tests. Vitest duration 15.30s before versus 15.88s after (test execution 4.28s versus 4.26s) provides **no demonstrated runtime speedup**. Four browser cases and nine ordinary Rust cases were removed; Rust execution falls from 752 to 743 passing cases, plus 15 ignored opt-in cases (previously 16; the obsolete benchmark was removed). Final results are recorded in validation.md.

## Why retained protection is credible

Each issue records the retained owner of deleted assertions; consolidation was not based on test names alone. Independent reviewers checked both preservation and actual removal of machinery, using the pre-reduction snapshot rather than Git HEAD (which also contains earlier work). They identified a lost post-clear wait; it was restored before final browser verification.

Representative mutation checks deliberately broke retained behavior. Replacing minimal block edits with whole-document changes still failed retained move/undo regressions; removing Markdown marker concealment still failed retained formatting tests. A proposed deletion was rejected when a broken workspace retry limit failed only the purportedly redundant retry test. That test stays. The clear-during-read race likewise stays because no equivalent retained owner was found.

## Scope and remaining complexity

This is a bounded reduction, not a claim that every remaining test is essential or that the application has been completely redesigned. Most removed lines were test machinery. Transactional rollback/restart, stale completion, permissions, destructive-history races, numerical policies and real browser geometry retain distinct cases. Large orchestration modules and backend persistence policy still carry substantial inherent and architectural complexity; this pass does not present test deletions as a rewrite of those systems. No new helper framework or replacement state model was introduced.

## Handoff

- plan.md and spec.md: delegation, acceptance criteria and scope.
- issues/01–07: reviewed proposals, retained owners and per-module outcomes.
- validation.md: final combined verification and limitations.
- standards-review.md, review-agent.md, root-review.md: independent review and disposition.
- baseline.json, reduction.json, measure.py: reproducible before/after inventory.
- source-changes.patch: source diff for this pass alone, independent of earlier working-tree changes.
- Per-owner metrics/diffs/logs in this directory preserve details and mutation evidence.

All changes remain in the working tree; no commit or push was made.
