# 09 — Own committed content adoption at the document boundary

Status: resolved
Depends on: 03
Scope: active Round 1, execution position 5 of 6.
Round 1 order: 01 → 02 → 14 → 03 → 09 → 10; stop and audit after 10.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

`PersistenceControllerParams` exposes `rekeyNoteWithRuntime` and `applySavedSnapshot` (`src/lib/features/notepad/orchestration/persistenceController.ts:34`). The composition root implements them at `Notepad.svelte:528` and `:576`; restore adds another path at `:805`. Generic `documentEditingService.applySnapshot` (`document/documentEditingService.ts:102`) exposes a callback and policy flags. Restore requires an open draft/editor even though citation targets can be independent (`Notepad.svelte:810`, `:1160`; `documentPaneCoordinator.ts:157`).

## Implementation instructions

Use existing backend mutation results/contracts. Deferred tickets 07 and 08 are not prerequisites; do not restructure publication admission, proposal commands, or review attachment state to implement adoption.

1. Deepen the existing document editing boundary with operation-specific methods: adopt saved result using captured edit/operation evidence; adopt Version Restore; adopt accepted proposal. Also migrate the remaining generic snapshot consumers: clean external refresh (`orchestration/noteCommandController.ts:150`) and transient Forgotten-Note Recovery (`:423`) into fixed-purpose methods. Names may follow local style; policies must not be caller-supplied boolean combinations.
2. This boundary privately locates the document and runtime, applies identity/baseline/warning, preserves eligible edits made during a save/proposal commit, and updates the shared editor root. Composition root wires concrete owners once; it does not sequence per-result mutations.
3. Keep path rekey inside this boundary for now; ticket 10 removes it. Delete persistence's two composition callbacks and restore/proposal-specific manual synchronization paths after all callers migrate.
4. Restore is successful for an unopened citation target: update no open document and create/navigate no pane. For a retained document with only chat panes, update its baseline and existing shared runtime; a future editor mount starts from restored state without old undo.
5. Version Restore starts one fresh shared undo root, including properties-only restore. Replace duplicate reset flags/effect callbacks with one fixed operation policy. Keep per-pane selection/scroll separate.
6. Consume authoritative `NoteSession`/mutation data directly where save currently expands equal fields into `SessionSnapshot`. Keep saved-vs-working distinction and snapshot uses that represent actual unsaved/restoration state.
7. After a canonical commit, adoption failure must not authorize resubmission. Surface/reconcile the committed result through the same document boundary. Preserve `acknowledgeDocumentCommit` canonical read-back comparison (`noteCommandController.ts:226`–`:238`): if disk changed after the commit, enter existing external-sync/conflict handling instead of blindly adopting earlier committed bytes.

## Acceptance and validation

- Existing persistence/history/proposal adoption tests cover later body/title edits, stale tokens, committed warnings, two-pane shared undo, and external conflicts.
- Add missing outcome cases for unopened citation target, chat-only retained document, properties-only restore, and navigation joining an in-flight restore. Verify successful restore does not require selecting an editor pane.
- Delete public generic snapshot policy flags/callbacks and manual composition-root adoption code; retain private pure model transformation where useful.
- Do not merge draft baseline, live undo root, and canonical disk into one state object. Ownership of synchronization becomes explicit; distinct representations remain justified.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: active in narrowed Round 1. Earlier full-plan numeric execution order is superseded by 01 → 02 → 14 → 03 → 09 → 10.

- Ticket 14 pointer audit: this ticket names the stable backend mutation contract but no private NoteTimeline source location; its source pointers remain current.

- Resolved 2026-09-07. `DocumentEditingService` now owns fixed-purpose
  `adoptSavedResult`, `adoptVersionRestore`, `adoptAcceptedProposal`,
  `adoptCleanExternalRefresh`, and `restoreTransientForgotten` operations. The
  boundary privately finds retained documents and `documentRegistry` runtimes,
  decides whether captured save/proposal work is still current, adopts
  identity/saved baseline/commit warning, performs the still-required path
  rekey, updates the one shared editor root, and refreshes derived views. The
  composition root supplies concrete owners once; its late-bound persistence
  reference is only dependency wiring for autosave and performs no result
  sequencing.

- Deleted caller protocol: `PersistenceControllerParams.rekeyNoteWithRuntime`,
  `applySavedSnapshot`, and caller-provided `isTitleEditing`; the root's manual
  rekey/runtime transfer, save-result apply callback, required-open restore
  lookup, preferred-editor restore/reset closure, and proposal/external/Forgotten
  post-apply branches are gone. Deleted public generic `applySnapshot`, its
  runtime callback, and the five caller-selectable policies `preserveDraft`,
  `resetUndoHistory`, `autosave`, `scheduleDerived`, and `immediateRelated`.
  `DocumentSaveCapture` replaces the persistence controller's separate token,
  revision, title, Markdown, Note Identity, and path locals with the exact
  evidence the adoption owner needs; `VersionRestoreAdoption` records the
  required `adopted` versus successful `notOpen` outcome. Neither is stored
  state or a new owner.

- Authoritative mutation results now remain `NoteSession` through ordinary
  save, task-attributed save, and canonical read-back. Their former equal-field
  expansion into `SessionSnapshot` was removed. `SessionSnapshot` remains for
  real bootstrap/open/restoration and working-versus-saved representations.
  The proposal commit warning is carried into adoption, and a warning-only
  success schedules no publication. Canonical proposal read-back comparison is
  unchanged in meaning: a Markdown mismatch performs a trailing disk read and
  enters the existing external-conflict machine while retaining local work;
  the accepted proposal is neither blindly adopted nor submitted again.

- Outcome details: an unopened citation restore returns `notOpen` without
  creating, selecting, or navigating a pane. A chat-only retained document
  adopts its baseline and an existing shared runtime; a later editor mount reads
  that restored document with no old undo. Every open-document Version Restore,
  including a properties-only restore, silently creates one fresh shared undo
  root for all attached panes while preserving their individual selection and
  viewport. Save adoption preserves later body and title edits and rejects stale
  operation tokens. Clean external refresh uses its fixed committed policy;
  transient Forgotten recovery uses a distinct non-commit runtime operation and
  retains its autosave behavior without manufacturing an editor callback.

- Scope stayed within Ticket 09: no backend publication-admission change,
  proposal command/domain/status or review-attachment change, durable schema,
  new service/framework, or alternative mock layer was added. Path-based rekey,
  pane-reference migration, runtime transfer, and collision handling remain
  private inside this boundary for now and are deliberately left for Ticket 10.

- Line accounting against the exact pre-edit dirty-tree archive: production
  **+471/-272, net +199** across the composition root, document state/editing
  boundary, editor runtime, persistence/note-command/proposal adapters, proposal
  orchestration, and session IPC wrappers; behavior tests **+555/-224, net
  +331**; architecture-fitness tooling **+34/-0, net +34**; architecture and
  behavior docs **+25/-0, net +25**. This Comments entry is excluded. The
  implementation grows the deep boundary and its outcome coverage while the
  composition root is -73 lines and persistence/note-command orchestration is
  -51 lines net; the deleted interfaces and policy combinations above are the
  interface-complexity reduction.

- Owner/state recount: save remains **7 authoritative owners / 26 grouped
  dimensions** and restore remains **8 / 36**; the existing document editing
  boundary deepened and no state owner or stored dimension was introduced.
  Under the investigation's caller-burden definition, new/rename save falls
  from 16 to **15** coordination boundaries and same-path save from 15 to
  **14**: stale/preserve decision plus model/runtime adoption are one document
  result-adoption entry, while conditional path/resource migration remains a
  real separate handoff until Ticket 10. Restore falls from 21 to **20** because
  the history-result handoff and document/editor adoption are one fixed-purpose
  entry with no selected-pane handoff. Proposal action retains its **17 owner
  families / 41 grouped dimensions**; only its open-document synchronization
  branch collapses to one adoption call, with run, durable proposal status,
  review workflow, and hunk state unchanged.

- Baseline: the supplied exact post-03 archive was
  `/private/tmp/gneaux-round1-ticket09-baseline.tar`; the anticipated notepad
  production surface matched it before editing. The agent also captured the
  complete dirty tree (excluding `.git`, dependency/build outputs) at
  `/private/tmp/gneaux-ticket09-preedit.tar`, SHA-256
  `d94461d6f3add0841040355176d502b9d7f57c7a63fa805bee356f2c24bbd14b`.
  Counts, review, and whitespace checks use that archive with
  `git diff --no-index`, never HEAD. Unrelated/newer work was preserved.

- Validation: `pnpm run check` reported 0 errors and 0 warnings; the focused
  adoption/persistence/history/proposal suite passed 121/121 after the final
  shared-runtime test change; the full frontend suite passed 846/846 across 124
  files; TypeScript/Rust timeline contract fixtures passed 4/4 and 1/1; frontend
  architecture fitness passed 11/11; Rust architecture fitness passed 17/17;
  and the isolated browser document/pane fixture passed 15/15, including full
  Version Restore and undo isolation. The native E2E binary built successfully,
  but the disposable native Editing Window fixture could not obtain a valid
  WebDriver session in this host (`tauri-driver not found`, followed by no
  visible webview); its two cases therefore failed before useful acceptance
  evidence. Its config used and cleaned `/tmp/gneauxghts-native-e2e-*`, never a
  user vault. The real shared-runtime/unit tests and browser harness cover the
  affected frontend seam; rerunning that native fixture on a host with the
  driver/visible webview is the only tooling follow-up.

- Audit follow-ups: review the private collision-rekey ordering and the
  composition root's dependency-only late binding, then carry the recorded
  conditional migration directly into Ticket 10 rather than creating another
  adoption layer. Whole-production searches find the removed callback/policy
  names absent; architecture fitness contains their names only as prohibitions.
  No unresolved Ticket 09 behavior concern remains.

- Orchestrator audit follow-up, 2026-09-07: fixed a baseline-semantic regression
  in transient Forgotten-Note Recovery. The pre-Ticket-09 snapshot conversion
  retained `ForgottenNote.currentNoteId/currentNotePath` as the current
  persisted document identity while deliberately leaving the saved baseline
  absent. The fixed-purpose recovery transformation now applies that same
  current identity through the private document identity constructor; null path
  still produces a draft, and every recovery still clears `savedBaseline`,
  retains its existing non-history-flushing runtime policy, and schedules the
  recovered working copy for ordinary save. Added a boundary regression test
  with non-null Note Identity/path alongside the existing null-identity case.
  Focused document/runtime/note-command/fitness validation passed 41/41, and
  `pnpm run check` again reported 0 errors and 0 warnings. The correction adds
  +7/-0 production and +24/-0 test lines relative to the earlier resolution
  record; the cumulative baseline-relative counts above have been updated.
  Owner, state-dimension, coordination, and Ticket 10 rekey counts are
  unchanged. No further audit finding remains.
