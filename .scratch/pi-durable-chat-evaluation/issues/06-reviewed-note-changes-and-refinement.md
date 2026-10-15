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
