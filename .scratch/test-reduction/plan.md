# Test reduction plan

Progress: Complete. All audits were persisted before edits, approved removals implemented, independently reviewed and verified. See README.md and validation.md.

1. Workspace/model/history tests: documents owner.
2. Editor/images/proposals: editor owner.
3. Timeline/evidence/task backend: timeline owner.
4. Remaining backend and architecture: agent owner.
5. Remaining frontend: UI owner.
6. Browser/native/support/scripts and cross-layer review: root.

Each report supplies exact removed cases, retained owner and rejected unsafe cuts. Root reviews all reports, then releases non-overlapping test-only edits. Run focused tests, independent coverage review, full frontend/Rust/typechecks and affected UI lanes. No production changes without a separately documented necessity. No skipped tests, weakened assertions or merging unrelated cases to manufacture a smaller number.

## Audit checkpoint

All six module reports were persisted before any source edits. Coordinator reviewed their exact deletion/survival maps and inspected representative candidate/survivor bodies. Baseline collector confirms1,137 frontend cases, and phase measurement was zero source changes before release.

Approved: D01–D21 (24 executions), E01–E17 (16 executions plus5 fixtures), timeline13, backend8 library+2 architecture plus documented positive-snippet trimming, UI-R1–R10 (22 executions plus2 scanner assertions), root2 E2E cases. Total expected87 actual executions removed. Keep failed-open machine recovery and all explicitly retained owners; additional unverified candidates are not authorized by this checkpoint. Remove genuinely unused test-only imports/helpers without altering production behavior. No assertions moved into other cases.

Progress: implementation released in non-overlapping ownership scopes; independent review and combined acceptance follow.

### Additional audited same-branch cuts

Coordinator separately reviewed documents D22–D25 before those edits: production transient UI open has two branches (ordinary/image) and close is kind equality only; MRU nonmatching filter is already asserted; underscore italic is parsed in nested formatting; external conflict sources are opaque data in this test rather than actual event entrypoints. Approved10 further input cases, preserving both open branches and the matching/mismatched close cases. Expected total97 actual cases removed. This does not combine or rename cases to shrink count.


Final acceptance:97 actual cases and1,835 test/test-only lines removed. Independent review findings closed; full frontend/Rust/support/Python/typechecks and affected browser/native journeys passed. No new source files or application behavior changes.
