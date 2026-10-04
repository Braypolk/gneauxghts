# Independent frontend / E2E Standards review

Status: ready-for-agent
Progress: Review complete against frozen01/02/05 and root06 reductions; no actionable findings. Coordinator combined acceptance pending.
Reviewer: audit_agent

## Scope and baseline

Compared current files directly with the snapshot in `.scratch/test-reduction/baseline.json`: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-test-reduction-meo8wffi`. Git HEAD is not this review's baseline. Scope: documents01 including approvedD22–D25, editor/proposals02, UI05 and root browser/native06. Excluded own backend04 changes. Read repository AGENTS, code-review skill including all12 smell prompts, phase spec/plan and each deletion audit/result. Inspected the full collected frontend/E2E snapshot diff (`review-frontend.patch`) and relevant retained tests/production branches. No reviewed source edits or test runs by reviewer.

## Findings

No actionable Standards/correctness findings. The diff is confined to test files in the inventoried source tree; no new TS/Svelte production files, production edits, new support framework or replacement tests were introduced. Remaining additions are removal of unused imported names, smaller existing parameter arrays, and accurate descriptions for a remaining link-format or conflicted-review case. Whole-test deletions match their audit identities. Tests were not combined or turned into hidden loops to lower reported counts; the remaining loops already existed in the baseline.

Case-count distinction is honest: editor removes five redundant format rows *inside one existing test*, and does not count those as five executable cases. Transient-surface/source-provenance reductions remove preexisting parameter executions on the same production branch. The proposal reload test retains the conflicted case unchanged in substance after deleting the ordinary-review parameter; it does not combine former assertions from multiple cases.

## Coverage checks

- **Documents01:** retained document adoption/identity, conflict resolution/retry, workspace actual close/disposal and model-sequence tests are present. The removed constructor-handle oracle is superseded by first-save/rename ownership behavior. Failed conflict application is covered by the real controller's recovery/retry assertions. The retained exact adoption test checks revision and authored fields. The independent workspace model and readable adjacent-selection branch test remain. The model-helper mutation tests were testing injected failures in their own helper rather than a production mutation. D22's production transition has two open branches and a kind/owner equality close branch; the surviving rows exercise those branches. D23 provenance values are copied without production source-specific branching; actual refresh-controller notification tests remain. D24/D25 remove redundant nonmatching filtering and nested underscore-emphasis coverage, not special production paths.
- **Editor02:** all six command→parser→decoration→unwrap format compositions remain unchanged. Link/wikilink paths remain in the low-level format test. Invalid/standard/bullet indentation survivors execute the actual application command; directly invoking CodeMirror Backspace/Delete never tested the application keymap. The removed indent-facet check imported its expected constants from the same implementation. Image selection retains actual inventory reference identity; its deleted50-image case had no performance oracle, while the benchmark remains. Proposal adapter tests preserving teardown flush protection, remount, later edits, exact durable completion, document-bound reload and terminal failures are unchanged. No recent data-loss regression was removed.
- **UI05:** real-adapter complete active-note fixture remains. Inventory-of-fixture-keys and literal cursor checks are not dispatch tests. Whole timeline error vocabulary remains compared with the shared fixture. The failed-open aggregate test remains; the removed lifecycle/terminal cases have stronger real-controller owners, including older terminal+delta replay and legitimate retry identity. Atlas delayed visibility/activation revalidation remains. Two implementation call-count assertions were removed while ownership field restrictions and scanner probes remain. Intentional tradeoffs are accurately disclosed: specific editorial catalog aliases, raw activity payload forwarding equality and getKeyStatus provider forwarding no longer have individual equality assertions; no false claim of identical surviving privacy coverage is made.
- **Root06:** browser only removes the initial plain-open parameter. Four narrow/wide × left/right cases still call the same open sampler and both continuity/entrance assertions, followed by their close behavior. open-current/open-chat remain because entry paths differ. Native only removes boot/title smoke; reconnect still waits for the live shell and verifies native geometry, and the dedicated debug bridge case remains. No timing threshold, timeout, screenshot baseline, sampler or cleanup assertion changed.

## Standards / smell assessment

No documented repository standard violation found. All12 smell heuristics applied as judgement, not quotas:

- **Duplicated Code / Speculative Generality / Middle Man:** repeated smoke and pass-through test cases were removed, with no replacement abstraction or generic helper layer.
- **Mysterious Name:** two surviving case names became more accurate; retained test/helper names remain descriptive. No name change is counted as a reduction.
- **Data Clumps / Primitive Obsession:** no new fixture parameter bundles, string protocols or parallel state were introduced; existing typed fixtures and identity checks remain.
- **Repeated Switches / Divergent Change:** no new dispatch or switch logic; same-branch parameter reductions are supported by inspected production control flow.
- **Shotgun Surgery:** edits span suites because duplicated oracles lived there; surviving assertions were not relocated to create new cross-file coupling.
- **Feature Envy / Message Chains:** actual ownership-level composition remains the behavioral owner where lower-level mirrors were deleted; no new probing of private state or long callback protocol was added.
- **Refused Bequest:** no inheritance or widened test-double interface changes.

No new dead helper/import problem found. Removed cases' now-unused imported functions/types and file-local source/cursor fields were cleaned up; shared scanner helpers, test models, format composition and fixtures remain referenced. Existing whitespace/style is not treated as a review finding.

## Validation and readiness

Owner-reported focused evidence:01 **321 tests /38 files passed**,02 **75/10 passed**,05 **99/8 passed**. These are separate selections and overlap; do not sum them into unique acceptance coverage. Documents owner confirmed final source freeze after three unused Markdown imports were removed. Counts:01 removes34 actual cases,02 removes16 plus five non-case fixtures,05 removes22; root06 removes two browser/native cases. This reviewer did not rerun suites or browser sessions. Root owns final collection, typechecks, combined suites and GUI acceptance. Standards review is ready with no remaining blocker.
