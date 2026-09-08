# 10 — Use stable handles for open documents and their resources

Status: resolved
Depends on: 09
Scope: active Round 1, execution position 6 of 6.
Round 1 order: 01 → 02 → 14 → 03 → 09 → 10; stop and audit after 10.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

`NoteKey` is path/draft-based (`src/lib/features/notepad/document/documentState.ts:29`; `state/noteStore.ts:43`). Rename/first save rekeys state, pane references, editor bindings, timers and save queues (`state/noteStore.ts:128`, `Notepad.svelte:528`). `documentRegistry.transfer` (`document/documentRegistry.ts:41`) and `DocumentRuntime.adoptFrom` (`document/documentRuntime.ts:149`) arbitrate resources during that identity change.

## Implementation instructions

1. Give each open document an immutable, ephemeral handle used by workspace references and DocumentRegistry. A draft handle is not a durable NoteIdentity. Persisted identity/path are mutable document attributes.
2. Maintain one vault-scoped lookup from canonical identity/path to open handle inside existing document ownership. Deduplicate opening before constructing another document. Update lookup and committed identity atomically through ticket 09's adoption operation.
3. Save/rename changes document attributes and lookup only; the document object, shared editor root, timers, queue and pane references retain the same handle.
4. Define collision behavior explicitly: never merge two independently dirty drafts or choose a winner by transferring queues. Use existing conflict/admission behavior where possible; surface an unresolved collision while preserving both drafts if evidence cannot select one safely. Distinguish a post-commit lookup/adoption collision from pre-publication failure: retain the authoritative committed result and both dirty drafts; never resubmit the canonical write to resolve an in-memory collision.
5. Audit external move observation and Remember semantics. Remember may create a fresh document in the invoking pane; genuine navigation can still replace pane references. Inspect actual persisted workspace contracts before changing them; do not invent a migration for ephemeral handles.
6. Delete path-based `NoteKey` construction, rename `rekeyNote` protocol, `transferNoteRuntime`, registry transfer, runtime rekey/adoptFrom and their exclusively used queue-join machinery after all consumers migrate. Keep legitimate navigation replacement operations.

## Acceptance and validation

- First save, title rename, two-pane editing, queued follow-up save, cursor/scroll, undo/redo and external move keep one document/runtime handle.
- Cover open-note deduplication, conflicting dirty documents, Remember, and identical durable identities in different vault contexts.
- Existing runtime/registry tests should assert continuity and outcomes, not reproduce old transfer internals. Replace obsolete transfer tests.
- Conditional save coordination step 14 (resource migration) disappears. Other authorities need not disappear; do not claim one giant document store is the goal.
- Report deleted transfer APIs/branches and net production/test changes. No compatibility shim retaining old and new handle systems after this ticket.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: active in narrowed Round 1. Earlier full-plan numeric execution order is superseded by 01 → 02 → 14 → 03 → 09 → 10.

- Ticket 14 pointer audit: this ticket names no implementation that moved out of `services/note_timeline.rs`; its document-runtime source pointers remain current.

- Resolved 2026-09-07. Every open document now receives one immutable,
  frontend-only `DocumentHandle`. `NotepadState.documentsByHandle` owns the
  document objects and one derived, vault-scoped Note Identity/path-to-handle
  index; `WorkspaceStore` and `DocumentRegistry` hold only the handle. Durable
  identity and canonical path remain mutable `NoteDraftState` attributes.
  Bootstrap binds the lookup to the running vault before normal session use,
  and open/session adoption consults the lookup before constructing a second
  document.

- Ticket 09 committed adoption now applies the authoritative
  identity/baseline/warning and rebuilds the complete derived lookup and
  collision state for every owned document in one synchronous owner operation.
  First save, same-note title
  rename, clean external move, proposal adoption, Version Restore, and
  Forgotten-Note Recovery retain the exact document object and handle. There
  is no pane rebind, editor-root replacement, timer move, or queue move. The
  watcher reports an external move as old-path deletion plus new-path change;
  the deletion path now first reads through the retained Note Identity, so a
  moved clean document adopts its new path on the same handle. Dirty moved
  content enters the existing external-conflict flow on that same handle, while
  a genuine failed identity read preserves the prior deletion behavior.

- Collision semantics are explicit. If a completed canonical write resolves
  to another open document, its committed result remains adopted on the saving
  document, both independently dirty working copies and both runtimes remain
  intact, and both documents receive reciprocal `canonicalCollision` state.
  The established lookup binding prevents a third duplicate open; persistence
  treats the collision as unresolved and a later enqueue performs no write.
  This is post-publication success, never the pre-publication failure branch and
  never permission to replay the canonical write. Navigation and close remain
  blocked while both participants are dirty. Once a participant matches its own
  saved baseline, the normal pane-close path cancels its timer, joins any
  already-running stable-handle queue, re-reads the authoritative document, and
  closes without enqueueing a new canonical write if it is still a clean
  collision participant. Removing that now-unreferenced document rebuilds the
  index, promotes the survivor, clears its collision, and disposes only the
  removed runtime. The UI explains this loss-safe path without offering a
  destructive winner/merge action.

- Deleted APIs and branches: path/draft `NoteKey`, mutable
  `NoteDraftState.key`, `createDraftNoteKey`, `noteKeyFromPath`, `rekeyNote`,
  the document editing boundary's `rekeyCommittedDocument` plus workspace/pane
  migration dependencies, `transferNoteRuntime`, `DocumentRegistry.transfer`,
  mutable `DocumentRuntime.noteKey`/`rekey`, `adoptFrom`, `setSaveQueue`, and
  `joinExternalQueue`. The resource-winner, timer-cancellation, pending-callback
  transfer, external-queue join, and old-key cleanup branches are gone. Unused
  session facades for timer get/set/clear, save-queue get/set/clear, and editor
  pane count were also deleted. The ordinary same-handle queue drain remains;
  legitimate navigation replacement remains as
  `replaceDocumentHandleReferences`, `replaceReferencedNoteWithFreshDraft`, and
  `replaceNoteAcrossPanes`. No compatibility shim retains the old key system.

- Persistence-contract audit found no durable workspace-handle contract to
  migrate. `SessionSnapshot` persists Note Identity/path and working/saved
  content, while editor view-state storage remains keyed by durable Note
  Identity/path and pane scope. Workspace pane/document handles exist only in
  the running frontend. Remember deliberately gives only the invoking pane a
  fresh handle and cleans the old document only after its final reference;
  identical Note Identities in separately bound vault states resolve only in
  their own vault context.

- Outcome coverage replaced transfer mechanics with continuity assertions:
  first save and title rename preserve one object/handle/registry entry/editor
  root; two panes preserve independent selection and scroll plus shared undo and
  redo; a draft receives its assigned identity while the same save queue drains
  one newest follow-up save; open requests deduplicate before construction;
  collision retains both later dirty copies and never resubmits; collision close
  repairs lookup; Remember keeps sibling-pane ownership; external move changes
  lookup aliases on one handle; and two vault contexts may contain equal durable
  identities without cross-resolution. The initial store-first red run was 4
  failed / 2 passed because vault binding and canonical lookup/adoption did not
  yet exist; the final focused outcome suite passed 86/86 across 10 files.

- Line accounting uses only the supplied exact post-Ticket-09 archive
  `/private/tmp/gneaux-round1-ticket10-baseline.tar`, verified SHA-256
  `d2e085b7efc9f4dd8fe213e3f66e11ed4c3244c37b16b467691b9ef83a71faa3`,
  with `git diff --no-index`, never HEAD. Production is **+642/-575, net +67**;
  behavior tests are **+968/-331, net +637**; TypeScript architecture-fitness
  tooling is **+55/-2, net +53**; `ARCHITECTURE.md` is **+24/-8, net +16**.
  Planning/resolution text and generated artifacts are excluded. No source file
  or implementation block moved in this ticket (**0 moved lines/files**); the
  reported 575 production deletions are actual baseline-relative removals or
  replacements, not Ticket 14's earlier file movement. The small production
  growth is the canonical lookup/collision policy, status surface, and external
  move recovery; it replaces the larger transfer protocol and removes a caller
  relationship even though collision evidence is now represented explicitly.

- Final census, using the investigation's definitions: ordinary same-path save,
  first save, and rename each remain **7 authoritative owners / 26 grouped
  dimensions / 8 resource categories**. Version Restore remains **8 / 36 /
  11**. The immutable handle replaces mutable `NoteKey` in the workspace-reference
  dimension; canonical lookup is rebuildable from owned document identities,
  and canonical collision extends the existing conflict dimension rather than
  adding an authority. Same-path save remains **14 coordination boundaries**;
  first save and rename fall from the post-Ticket-09 **15 to 14** because former
  conditional step 14 (pane/resource/timer/queue migration) disappears.
  Restore remains **20 top-level boundaries** because its operation-specific
  adoption already collapsed in Ticket 09; any nested departure save now also
  uses the 14-boundary path. The final save/rename tail is one committed-result
  handoff into atomic document identity/baseline/lookup adoption, followed by
  best-effort mark-open and operation success. Callers no longer choose resource
  winners, transfer queues/timers, replace panes, or clean old runtime keys.

- Validation: `pnpm check` reported 0 errors and 0 warnings; the final full
  frontend suite passed **864/864 across 124 files**; focused handle/adoption,
  runtime, pane, save, refresh, command, collision UI tests passed **86/86**;
  TypeScript architecture fitness passed **12/12** and Rust architecture fitness
  **17/17**; timeline contract fixtures passed **4/4 TypeScript + 1/1 Rust**;
  and the browser-mode document/pane fixture passed **15/15** after the final
  production change. Its first sandboxed launch could not bind localhost
  (`EPERM`); the approved localhost rerun passed. No Rust production changed,
  so broader Cargo check/lib tests were not required. Native E2E was not run:
  it is optional for this frontend seam, and no non-disposable user vault/config
  was touched. Final production/test searches find the removed key/rekey/transfer
  symbols and path/draft handle literals absent; their names remain only in the
  architecture-fitness test as prohibitions. `git diff --check` is clean.

- Orchestrator audit follow-up, 2026-09-07: the audit found that partially
  deleting and re-registering only the adopting document's aliases could leave
  a former collision participant unindexed with a stale one-sided collision
  after the established participant changed identity. Two regression tests
  first failed (**7/9 store tests**): a same-Note-Identity external move was
  incorrectly reported as adopted while dropping reciprocal collision state,
  and a genuinely distinct adoption left the other participant blocked. The
  owner now treats lookup aliases and collision flags as one wholly derived
  projection: every identity-affecting store, committed adoption, and explicit
  synchronization clears and rebuilds both across all owned documents. Stable
  insertion order retains the established binding. A same-identity move now
  publishes the established document's new path, retains both old-path
  admission and reciprocal unresolved collision with the other dirty document;
  a distinct identity/path indexes each document independently and clears both
  flags. Closing either side continues to run the same reconciliation, so no
  stale alias or one-sided block survives. The committed adoption result is
  classified from the reconciled state, preserving the post-publication
  collision/no-retry boundary.

- A second alias-granularity audit first failed **9/10 store tests**: for a
  path-only collision between distinct non-null Note Identities, registration
  assigned the later participant's unique identity alias to the established
  path winner. Registration now distinguishes identity and path conflicts.
  Same-identity collisions still direct otherwise-unclaimed aliases to the
  established identity owner, while path-only collisions retain the
  established path binding and index each unambiguous Note Identity to its own
  document. The focused store suite then passed **10/10**.

- A reachability audit first failed **12/14 departure/workspace tests**. Dirty
  collision participants remain navigation-guarded, but a user can now make one
  participant clean against its own baseline and close that pane through the
  real workspace transition. The close path removes it only after workspace and
  editor teardown leave it unreferenced, then reconciles the survivor. A final
  deferred-queue audit also first failed **12/14** because the initial exception
  skipped the stable-handle queue. Departure now always cancels the timer and
  joins that existing queue before re-reading the pane document; the integration
  proves the pane is neither retired nor removed while the queue is pending and
  that no fresh write is enqueued when the settled state remains a clean
  collision. Both focused controller suites then passed **14/14**.

- Audit delta versus the original resolution, measured against the same exact
  post-Ticket-09 archive rather than HEAD: production is **+642/-575** cumulative
  and behavior tests are **+968/-331** cumulative. The follow-ups replace the
  partial alias helper with complete reconciliation, preserve alias granularity,
  and add the loss-safe close/queue boundary plus its outcome tests.
  Tooling and architecture-document totals are **+55/-2** and **+24/-8**.
  No lines/files moved. Follow-up validation passed store regressions **10/10**,
  focused store/editing/refresh/persistence/departure/workspace/UI **70/70**,
  `pnpm check` with 0
  errors/warnings, TypeScript fitness **12/12**, Rust fitness **17/17**, and the
  full frontend suite **864/864 across 124 files**. The final browser document/
  pane fixture passed **15/15** after an expected sandbox `EPERM` on localhost
  bind and an approved rerun. Exhaustive production/test
  symbol searches again found no removed legacy APIs; only fitness-test
  prohibition literals and the unrelated domain `Draft` parameter remain.
  `git diff --check` remains clean. The owner/dimension/resource/coordination
  census is unchanged: saves/first save/rename **7/26/8/14** and restore
  **8/36/11/20**. No conditional resource-migration boundary returned.

- Scope remained Ticket 10 only. No durable handle migration, multi-vault live
  model, backend admission change, proposal-review lifecycle refactor, deferred
  Tickets 04–08/11–13, history-scale work, or native historical expansion was
  introduced. This round reduced a real conditional coordination relationship:
  the former path-derived identity no longer forces document/runtime ownership
  transfer, while working versus saved content and editor-root versus model
  projections remain intentionally distinct.

- Final orchestrator re-audit, 2026-09-07: no unresolved Standards or Spec
  finding remains. The audit independently inspected the exact post-Ticket-09
  archive-relative diff, stable-handle ownership, canonical lookup and alias
  reconciliation, post-commit collision/no-replay behavior, external-move
  adoption, Remember/navigation replacement, persisted workspace boundaries,
  runtime continuity, and removal of the rekey/transfer protocol. Three review
  findings were returned to the same Ticket 10 agent and verified after repair:
  reciprocal collision state is reconciled across later identity changes;
  distinct Note Identity aliases survive path-only collisions; and clean-side
  collision close is reachable and joins existing queue work before teardown
  without enqueuing a new canonical write. Independent validation passed
  `pnpm check` with 0 errors/warnings, 93/93 focused audit tests, the complete
  frontend suite at 864/864 across 124 files, TypeScript architecture fitness
  12/12, Rust architecture fitness 17/17, and timeline contracts 4/4
  TypeScript plus 1/1 Rust. Whole-production removed-symbol search and
  `git diff --check` are clean. The documented 15/15 browser result was also
  produced after the final production change; native E2E remains unclaimed.
