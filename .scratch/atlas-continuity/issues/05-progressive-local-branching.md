# Show emerging subgroups and promote them nearby

Status: ready-for-human
Type: task
Blocked by: 02, 03, 04

## Outcome

Distinct subthemes become visible inside a cloud before separating into nearby
clouds. Growth does not force everything into a giant central region.

## Work

Replace stateless immediate promotion with the candidate/visible/promoted
lifecycle in [the spec](../spec.md). Reuse child-community detection and coherent
group checks. Persist semantic evidence keyed to meaningful input changes; evaluate
cohesion, separation, viable size and crowding. Size alone is an evaluation trigger.
Distinguish accumulating evidence from a bounded subgroup presentation interval:
strong evidence can promote after its visible stage even if no further edit arrives,
while identical polling cannot strengthen a weak candidate. Use the existing queue
for any required one-shot follow-up; do not introduce periodic idle movement.

Keep the best thematic continuation's identity/anchor/name. Promoted children keep
their subgroup identity and nearby position. Handle balanced splits and merges
with explicit lineage/retirement; make merge reversal harder than promotion.
Shrinking groups tolerate modest changes but empty groups retire immediately.

Render child hulls/captions and child region inspection. Overview exposes broader
parent/family context; closer zoom reveals specific themes. Family context does
not duplicate note counts/edges or become a giant collision obstacle. Audit nested
hit targets, parent/child containment, and connection routing.

## Acceptance and verification

- Separated growth first shows subgroups, then promotes them locally.
- A weak one-update candidate does not split; repeated polls do not mature it.
- Strong supported branches do not need unrelated future edits to finish promotion.
- Coherent dense growth does not invent false thematic partitions.
- Split/merge oscillation, balanced splits and shrinking/empty regions are covered.
- Zoom changes presentation without moving notes or reclustering.
- Children can be inspected independently and authored links remain visible.
- Extend sequence geometry tests and browser hierarchy/promotion tests.

## Implementation — 2026-10-07

Visible subgroups, evidence-based promotion, balanced retirement, family overview and conservative merge evidence are implemented. Strong/moderate split and sustained merge sequences pass.

See [evaluation and limitations](../evaluation.md).
