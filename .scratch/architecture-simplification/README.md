# Architecture simplification

Progress: Complete. All eight scoped issues implemented, independent review findings closed, and final acceptance recorded below.

## What changed

This phase replaces coordination protocols and duplicate state ownership. It compares against the saved working-tree snapshot in `baseline.json`, after the earlier audit/cleanup work, not Git HEAD.

| Module | Replacement | Machinery removed |
| --- | --- | --- |
| Workspace/navigation | One concrete `NotepadWorkspaceSession` owns complete open, restore, split, close, presentation and reviewed-document reload operations | Ten controller/facade/pipeline modules; caller-composed navigation phases; mirrored store queries; nested public operation/save bypass protocol |
| Proposal review/editor | Shared document root owns editable review text and hunks across panes and route lifetimes; workflow owns durable admission | Pane editor cache, fallback working/suspended Markdown, hunk snapshots, attach/suspend/restore protocol, four presentation callbacks, `reviewDisplay` |
| Timeline/task/proposal writes | Complete NoteTimeline edit/create/save/restore operations own canonical publication and recovery | Task mutation sink, proposal file writers and synchronization DTOs, public prepared-token/abandon/finalize sequencing, token-carried runtime leases |
| Chat | One aggregate admits state/data changes; controller owns complete first send | Parallel mutable projection fields, flags-to-data patch protocol, public create-then-send protocol, composer creation timing flag |
| Semantic scheduling | Claim only the selected work category; return outcome directly | Whole-queue drain/reconstruction, seven handled flags, deferred replay clones, two runtime result mailbox fields |
| Settings/Atlas | AppStore owns complete snapshot operations; Atlas revalidates on activation; defaults and visibility use separate durable writes | Public snapshot admission-token handoff, detached cache freshness authority, full-record settings write lost-update protocol |

The workspace constructor uses existing concrete owners and rendered/derived-view effects. This is a replacement rather than a new layer around the old controllers. Existing durable persistence, document adoption, editor, membership and native runtime authorities remain in place. No storage schema or authored-content format changed.

## Problems found and corrected during implementation/review

- Full scan could replay stale recall over newer queued data; failed label retry could replace a newer label request.
- First-send continuation and completion hooks could use a conversation selected by a reentrant subscriber instead of their admitted origin; old terminal events could replay after a later request.
- Chat defaults and Atlas visibility could overwrite each other through stale full-record settings snapshots.
- Proposal replacement could discard edits outside proposal hunks; edited/partially resolved/conflicted reviews now require resolution before replacement.
- Retained review replacement/terminal cleanup could leak roots or lose ordinary edits. Terminal persistence saves remaining ordinary edits before cleanup and exposes failures without replaying a completed durable action.
- Reload Disk could refresh the active note instead of the retained reviewed document and subsequently save explicitly discarded proposal text. Reload is now document-bound, adopts canonical bytes, rejects stale reads and admits only one pending dismissal/reload.
- Clearing review metadata at route disposal could expose unaccepted proposal text to the asynchronous save barrier and later remount. Review ownership now survives with the module-scoped document; route callbacks retire/reconnect without another text copy, and durable settlement does not depend on a disposed chat controller.
- Occupied outward symlinks must retain exclusive-create conflict semantics. Parent scope is validated without following an occupied leaf, and atomic no-replace publication handles races.
- Blocked chat-context restoration must not install a requested conversation on the old context. Stale navigation and disposed-owner completions remain guarded.

## Size and test interpretation

Measured against this phase’s saved snapshot:

| Source category | Net physical lines |
| --- | ---: |
| Frontend production | −2,681 |
| Frontend tests/support | −183 |
| Rust files containing production and inline tests | −152 |
| Rust test files | +42 |
| E2E/scripts | +21 |
| **Total source** | **−2,953** |

Deleted17 source files (11 production,6 tests) and added3 (1 production,2 tests):14 fewer files overall. Ten workspace modules totaling3,315 lines were replaced by one concrete session of roughly1,400 lines; its operations are private internally and complete at the caller boundary.

Final frontend case count is1,137, up20 from1,117 at this phase’s baseline; Rust library cases rose3 to746. This is a production-complexity reduction, not a claim that executable test count fell. Frontend test/support code nevertheless shrank183 lines through removal of obsolete controller fixtures and consolidation around real owners.

Measurements are in `changes.json`. Physical counts include readable formatting, comments and blank lines. Markdown audit/architecture documentation is excluded. Frontend production is separated from tests/support; Rust mixed files include inline tests and are not all credited as production savings.

This phase does not optimize for the raw number of test cases. Obsolete callback-protocol fixtures were deleted and remaining coverage exercises real replacement owners; bounded regressions were retained for exposed data-loss/admission bugs. The final report gives both line counts and executable case counts so these cannot be confused.

## Acceptance and limits

- Frontend:145 files /1,137 tests passed; support32 and Python8 passed.
- Rust:746 library and23 architecture tests passed;15 existing opt-in cases ignored. Production cargo check passed.
- Svelte/TypeScript and E2E typechecks passed; diff whitespace check passed.
- All26 browser files have passing final results (25-file successful portion of the final full run plus the corrected cursor file’s12 focused checks).
- Native smoke:all7 files /13 cases passed, one opt-in measurement skipped. Actual process restart also passed: closed timeline rejected further writes, new process recovered retained versions, continued editing and closed successfully.

An initial Map target failure and initial native split-pane input failure did not reproduce in subsequent runs. Their causes remain unproven; original logs and native input diagnostics are retained. No weakened assertions or increased deadlines were used to hide them. The restart runner emitted Vite/esbuild shutdown errors after both app processes exited and all lifecycle assertions passed; its result is passed and exit code0. Live-provider and opt-in release/performance lanes were not run; no performance improvement is claimed.

## Evidence and handoff

- [Accepted plan](plan.md), [spec](spec.md), and individual issues in `issues/01` through `issues/08`.
- Designs: [workspace](documents-design.md), [proposal/editor alternative](frontend-alternative.md), [timeline](timeline-design.md), [backend](backend-design.md), [UI](ui-design.md).
- Implementation reports: [workspace](documents-implementation.md), [proposal review](05-review-results.md), [UI](ui-implementation.md), [backend scheduler](backend-result.md); timeline implementation is in [issue02](issues/02-timeline-publication.md).
- Independent reviews: [backend Standards](review-standards-backend.md), [UI Standards](review-standards-ui.md), [proposal Standards](review-standards-proposals.md), [workspace/proposal Spec](review-spec-workspace.md), [UI Spec](review-spec-ui.md), [coordinator integration](review-root.md).
- [Validation record](validation.md) preserves failed runs, corrections, exact final commands/counts and limits. [Map diagnosis](map-startup-diagnosis.md) records the unreproduced initial failure without inventing a cause.
- `measure.py` regenerates `changes.json` and `source-changes.patch` from the saved phase snapshot. Per-owner metrics list exact paths; use the aggregate measurement to avoid overlapping integration-file credit.

All work remains in the existing working tree. No commit, push or deployment was performed.
