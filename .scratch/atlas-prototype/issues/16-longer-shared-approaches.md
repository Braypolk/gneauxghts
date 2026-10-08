# Extend shared approaches for nearby destinations

Status: ready-for-human
Type: task

## Request

Nearby routes sometimes run alongside one another rather than sharing a path.
Improve bundling where it preserves the smoothness and clearance achieved in
the previous iteration.

## Change

The existing source-to-cloud highway can now continue into a second shared
section for nearby destinations. Every pair in a group must be close relative
to its remaining travel distance, so a chain of nearby notes cannot merge
diverging approaches. Groups are planned from fixed geometry, independently of
the visible strength subset. Planning is quadratic in region size and cached.

Additional sections retain the existing tangent, curvature and dot-clearance
checks. When a deeper branch cannot retain these, it tries the earlier shared
junction before routing independently. Each shared section is drawn once;
singleton continuations attach to the last shared ancestor. Destination
highlighting traces the complete cached route. Filtering changes the drawing
split without moving full paths or changing authored connection visibility.

This is a conservative improvement within a destination cloud. Nearby routes
with incompatible approaches or insufficient dot clearance remain separate;
different destination clouds are not merged merely because their lines cross.

## Verification

All 48 Atlas unit tests pass. A new public-output geometry regression verifies
the deeper shared section, forward travel, six-unit dot clearance and stable
full paths when filtering removes a sibling but retains a parent highway.
The 18 existing map browser tests and the new nested-approach browser test pass.
The new browser test checks that both levels draw once, highlighting follows
the full route and strength changes restore the same shared sections.
Type checking, the production build and diff whitespace checks pass.

A temporary read-only probe of the published 166-note vault found an additional
shared section in the Falcon & Automation Stack neighborhood. Its 18 visible
routes retained a minimum unrelated-dot gap of about 7.25 world units and had
no sampled backward steps. Initial routing took about 50 ms; an immediately
repeated cached call took about 0.33 ms. The probe was removed and the revised
image-cloud approach was inspected in the live map.
