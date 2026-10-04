# Document-owned proposal review

Status: ready-for-agent
Progress: Implemented and frozen after route-lifetime review correction; real teardown/remount/in-flight completion35 tests pass, final pending-admission22 tests pass. Independent re-review and coordinator gates ongoing.
Owner: audit_editor

Design: ../frontend-alternative.md. Root owns architecture/invariant documentation. Documents owner writes Notepad.svelte and workspace lifetime integration; this owner changes proposal modules, editor root/rendering/capabilities and focused tests. No generic lease framework.

First prove real root review transitions, effect-only Keep, exact modified-hunk mapping, unchanged sibling viewport/history and no-pane Markdown notification. Then remove cached editor, hunkSnapshot, workingMarkdown and suspendedMarkdown and all attach/suspend/restore orchestration. Root review metadata is the explicit retention signal, consumed by workspace disposal/removal; active global workflow remains the admission/durable resolution owner. Preserve passive arrival, current placement, dirty/conflict gates, captured commit/later edits and explicit discard confirmation.

Renderer keeps only a root-published immutable projection, never maps hunk state itself. Retained root operations use proposal annotations; effect-only status does not advance Markdown revision. Resource notification follows one document owner. Tests use real shared runtime and production renderer; obsolete fallback-only tests are removed only after equivalent user outcomes pass.

Verification: focused runtime/proposal/composition tests, typecheck; coordinator browser after source freeze. Root transaction and retention proof are required before final migration, no compatibility state or old fallback fields survive.


Implementation and measured outcome: ../05-review-results.md. Final focused log: /tmp/review-final.log (9 files, 70 tests); root proof ran before migration (/tmp/document-review-proof.log, 13 tests). Independent spec reviewer audit_timeline notified at source freeze.

## Comments

Independent findings corrected: visible terminal-save failure, retained-document Reload Disk, edited-review supersession guard, single presentation operation, repeated-confirmation admission. See ../05-review-results.md for exact scope/counts and final evidence.

## Route lifetime correction (approved by coordinator)

Review/document state outlives Notepad route components, as does singleton NoteDraftState. Teardown must not clear review suppression and leave proposed bytes as an ordinary dirty note. Retain root/session through route unmount; retire only old orchestration admission/focus. A new orchestration binds its current document callbacks to the same root. This is one route-owner handoff, not per-pane attachment or text snapshots. Already-admitted durable completion may settle the retained document after unmount through exact owned-document adoption/persistence; disposed navigation remains invalidated. Durable requests use route-independent ChatApi, not a disposed ChatController. Required regressions: defensive flush never saves unaccepted text, ordinary note still saves, remount can resolve the same edited review, in-flight commit reaches one terminal state without replay.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
