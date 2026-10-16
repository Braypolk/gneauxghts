# Complete editable Note Proposal and refinement behavior

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 04, 05

Follow [the spec](../spec.md) and proposal/adoption invariants. Reuse the real
document runtime and global review workflow; Pi owns durable pending records.

## Work

- Complete creation/update, independent title/location changes, body/hunk editing
  and queued reviews without arrival-triggered navigation.
- Refine the same pending Note Proposal using its latest checkpoint/version. Late
  output cannot overwrite newer edits or revive settled work; generation failure
  after staging leaves the review available.
- Retain checkpoint-before-switch/departure/background, one editable review and
  route-independent settlement. Failed checkpoints block handoff without losing
  text or preventing unrelated ordinary-note saves.
- Bind Keep to exact target/version/payload and native effect receipt. Preserve
  dirty-editor adoption, collisions/conflict refresh and explicit reapproval.

## Acceptance

- Real native UI edits body/title/location/hunks, switches queued reviews,
  terminates/reopens and restores acknowledged state before Keep/Discard.
- Inject checkpoint failure and ordinary edits during publication: retain text,
  block handoff where required and adopt without overwriting later edits. Discard
  of creation never autosaves a note.
- Duplicate/concurrent Keep, stale decisions, refinement/checkpoint races and late
  refinement after settlement yield one valid transition/publication.
- Changed target, revoked access, occupied path and independent rename preserve a
  recoverable draft and require deliberate reapproval where applicable.
- Native receipts remain narrow; no legacy or parallel generic review owner appears.

## Starting points

`src/lib/prototypes/pi/{reviews,notesExtension,chatApi}.ts`,
`src/lib/features/proposals/`, document adoption APIs,
`src-tauri/src/pi_prototype_publication.rs` and deterministic proposal policy.

## Comments

### 2026-10-15 implementation checkpoint (acceptance pending)

- Pi `ReviewTask` remains the only durable review/decision owner. The retained
  document runtime and global review workflow still own live editable body,
  title, location, hunk choices, checkpoint barriers and committed adoption.
- Added `read_note_proposal` and `refine_note_proposal` extension tools. Refinement
  binds the conversation and acknowledged draft version, reuses the same pending
  record, checks native canonical full-read proof for an existing target, and
  transactionally rejects newer checkpoints or settlement. Durable per-call
  replay acknowledgements cannot revive settled work.
- Shared review API helpers preserve no-op versions, validate complete checkpoints,
  join concurrent Keep and bind exact body/version/source/destination to a native
  intent. An uncertain native acknowledgement pins the original accepted payload
  until Retry Keep reconciles it; edits/Discard cannot abandon a possible effect.
  The synthetic-only `prototypeFault(id, 'checkpoint')` now injects a review
  checkpoint failure before acknowledgement (clear with an empty fault string).
- Native publication uses a narrow, evaluation-only
  `NoteTimeline::edit_prototype_note` operation for atomic identity/base/collision
  checks and existing retained history publication of body plus location changes.
  Receipt recovery requires exact Note Identity and editor-visible content;
  uncertain later edits cannot be overwritten by replay. Explicit selected-note
  grants and current exclusions are rechecked at Keep; source-free creation does
  not require vault-read permission.
- Ticket 07 integration preparation preserves promotion metadata and invokes its
  separable-addition refresh contract for existing-note Saves. This comment does
  not establish faithful Save acceptance.
- Validation: `pnpm exec vitest run src/lib/prototypes/pi/reviewState.test.ts
  src/lib/prototypes/pi/reviews.test.ts
  src/lib/features/proposals/proposalOrchestration.test.ts
  src/lib/features/proposals/documentReview.test.ts` passed 47 tests (17 new Pi
  review tests, 30 retained editor tests). `pnpm exec svelte-check --tsconfig
  ./tsconfig.json` reported zero errors and warnings at the checkpoint. Five
  additional Rust behavior checks are prepared for the orchestrator's native
  test run; no native command was run by this implementer.
- Gates still pending: acceptance of dependencies 04/05, native Rust execution,
  real UI checkpoint/queue/termination/reopen journeys, canonical conflict and
  dirty-editor publication races, and actual iOS acceptance. Status remains
  `ready-for-agent`; this is implementation evidence, not ticket acceptance.
- Follow-up recovery implementation: NoteTimeline now records a typed, scoped
  publication proof to the native intent ledger before rename/write. Retry Keep
  verifies the captured Note Revision and exact authored bytes, so an intervening
  ordinary edit can retain today's bytes while returning the original accepted
  receipt. Temporary proof bytes retire after the adapter receipt persists.
  Evaluation accepted renames correlate the existing lifecycle-event receipt
  nonce, preserving unchanged-body rename proofs beyond the normal 64-retry
  receipt watermark without another schema or lifecycle owner.
- Five Rust behavior checks are prepared, including genuine synthetic native
  `receipt-write` failure followed by an ordinary Editor edit, exact original
  receipt recovery, a forged-proof rejection, and an unchanged-body rename followed
  by 70 ordinary publications. These require the orchestrator's native run.
- Exact remaining uncertainty limits: historical intents written before proof
  correlation, a deliberately cleared/unavailable timeline proof, or a same-path
  authored no-op whose unreferenced receipt has retired remain fail-closed if
  today's target differs. They cannot authorize replay or overwrite.
