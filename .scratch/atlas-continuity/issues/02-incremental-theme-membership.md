# Reconcile communities and preserve dominant-theme membership

Status: ready-for-human
Type: task
Blocked by: 01

## Outcome

Ordinary changes retain recognizable clouds while clear semantic changes move
notes to their strongest theme. Isolated notes remain outside clouds.

## Work

Use current community detection as candidate input to the private continuity
calculation from [the spec](../spec.md). Match clouds one-to-one using stable
member/core overlap and compatible semantic evidence, with deterministic ties.
Represent split/merge proposals and retirements explicitly rather than inheriting
ordinal IDs. Retain memberships around close ties; clear current dominance must
win. Compare cumulative current changes against retained core evidence so a
series of small edits can change membership.

Do not use user names, opening activity, or navigation-only placeholder vectors
as evidence for semantic themes. Preserve existing isolation/weak-bridge policies.
Track evidence against meaningful structural/content fingerprints, not polling
or repeated epochs. Capture baseline sequence metrics before replacing behavior.

## Acceptance and verification

- Centrality/order changes do not exchange cloud identities or colors.
- Multi-theme notes have one home in the more present theme.
- Small ties remain stable; gradual and abrupt real theme changes are adopted.
- Related additions join appropriately; unrelated additions stay ungrouped.
- Deletions and visibility exclusions are immediately removed from admitted data.
- Alternative polling/batching does not fabricate split/merge evidence.
- Extend geometry/continuity sequence tests; retain coherent-group and weak-bridge
  regressions. Measure identity retention and membership churn.

## Implementation — 2026-10-07

Current community proposals reconcile with stable IDs and retained theme evidence. Dominant-theme margin, gradual migration, isolated/navigation-only handling and unrelated-theme retirement are covered by sequence tests.

See [evaluation and limitations](../evaluation.md).
