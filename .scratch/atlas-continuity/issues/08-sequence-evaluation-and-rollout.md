# Calibrate continuity and verify native lifecycle behavior

Status: ready-for-human
Type: task
Blocked by: 01, 02, 03, 04, 05, 06, 07

## Outcome

Evidence shows that the rendered map remains learnable across note changes while
still forming useful new themes. Implementation and docs agree on lifecycle rules.

## Work

Run the full sequence matrix in [the spec](../spec.md), including alternate update
batching and long-term gradual theme changes. Compare to the baseline captured
before the membership/layout changes. Calibrate retention margins, soft movement
budgets, branching evidence and merge reversal from recorded results. Evaluate
homogeneous large groups honestly; do not claim size caps guarantee meaningful
semantic splits. Record thresholds as policy with their fixture evidence.

Validate restart/migration, interrupted publication, name races, corrupt/missing
cache artifacts, cache clear, representation changes, and visibility isolation.
Verify actual native updates/restart with temporary test data; do not modify the
user's live vault or restart their current app without authorization. The read-only
lab is useful for visual inspection but is not native lifecycle evidence.

Update feature docs, architecture, behavior invariants and the storage ADR to
reflect the final implementation. Record a compact evaluation report and limitations
here. Preserve unrelated dirty work and archived experiments.

## Acceptance and verification

- Report identity retention, backend/rendered displacement, neighborhood retention,
  membership/name churn, split reversals, geometry constraints and processing time.
- Stationary/presentation-only changes yield stationary geography; clear semantic
  changes still move membership and create supported branches.
- Every note remains represented once or isolated; current-content exclusions win.
- Authored names and accepted continuity survive all supported rebuild paths.
- Run relevant Rust Atlas/naming/publication/commands and architecture checks,
  frontend Atlas/IPC tests, browser map specs, `pnpm check`, production build,
  Rust formatting and native smoke coverage. Repeat only for material changes.
- Record any unverified native/provider behavior explicitly before declaring done.

## Implementation — 2026-10-07

Evaluation is recorded in ../evaluation.md. Automated Rust, frontend, browser, architecture, build and type checks pass. Production native owner seams were exercised with temporary data; a live desktop/provider usability smoke remains for human review.

See [evaluation and limitations](../evaluation.md).
