# Retain theme names and allow durable user naming

Status: ready-for-human
Type: task
Blocked by: 01, 02, 05

## Outcome

Cloud names remain recognizable and users can supply their own names without
changing membership or geography.

## Work

Reuse approved topic scoring and descriptor caches with a meaningful-change
threshold for automatic name replacement. Preserve current generation/model/
membership admission. Add a typed name command through Atlas's existing owner,
available from retained metadata during semantic rebuilding. Persist overrides in
durable map state, with serialized naming/publication so worker callbacks and old
responses cannot revert a committed name. Add response types/IPC fixtures and
frontend admission for the returned name.

Expose rename and restore-automatic in root/child region guides with keyboard
save/cancel and visible save failure. Validate one-line names of 1-80 Unicode
characters after trimming; duplicates are allowed. Empty override restores auto.
User names are display-only. Surviving thematic continuations inherit names;
retired names remain in lineage metadata and unrelated branches get auto names.
Follow [the spec](../spec.md).

## Acceptance and verification

- Names survive restart, ordinary edits, splitting of other branches, cache clear
  and provider setup/rebuild.
- Rename during a structural or label job is not overwritten by that job.
- Retired/wrong-variant targets and invalid input are rejected clearly.
- Clearing an override reveals the compatible automatic name.
- Small evidence changes do not churn automatic labels; real theme drift can.
- Naming changes do not repack notes/hulls or move the camera.
- Add command/publication, IPC, store admission and browser naming regressions.

## Implementation — 2026-10-07

Typed naming command, durable overrides, restore-auto, validation, stable automatic names and stale-response reconciliation are implemented. Native label/name persistence and browser naming tests pass.

See [evaluation and limitations](../evaluation.md).
