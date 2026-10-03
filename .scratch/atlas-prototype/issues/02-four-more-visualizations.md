# Add four more Atlas visualizations

Status: ready-for-human
Type: prototype

Question: What other visual encodings help a person see the whole vault, understand relationships, and filter attention while preserving context?

User verdict on A–D: “This is more like it! These are some good tests.” User requests four additional options. Retain A–D and the existing Atlas. No production winner has been selected.

## Scope

E / contour landscape: a continuous density field from the original spatial coordinates, with every note overlaid and smoothing/selection controls.

F / sunburst: radial space-filling hierarchy, topic → child topic → individual notes, with focus/reset and source inspection.

G / topic flows: unfolded membership and related-topic affinities around individually visible notes, using real cross-topic links.

H / similarity compass: all notes projected against two user-selected idea anchors, using explicit graph-derived affinity metrics.

Four subagents own one new component each. Parent owns integration, shared navigation, browser checks and capture. Source data, highlights and selection are shared with A–D. State stays in memory; original Atlas state and persistence remain unchanged.

## Validation

Browser checks use the same frozen vault: 166 notes and 2,916 recorded relationships. Each E–H overview renders 166 unique note identities; contour/flow paths and compass coordinates are finite. Search leaves all four mark geometries unchanged and preserves the contour field. Sunburst focus selects 15 notes and resets to 166; exact source inspection reads the intended note. Terrain brushing collected 139 notes, preserved across A–D/E–H, and Reset cleared the selection. Compass anchor changes apply only on Reproject vault; quadrant filters retain all marks and label missing affinity as unknown. Flow link filters preserve all notes and detail-lens inspection resolves the intended identity. Arrows cross the D/E group boundary correctly.

Desktop (1280×720) and narrow (565×720) checks exposed tiny flow labels and clipped compass controls; both were corrected. Four new components were implemented by four subagents. A–D, the original Atlas route, and AtlasStore match their starting SHA-1 fingerprints byte-for-byte.

`pnpm check` passed without errors or warnings; `pnpm build` passed. No production choice or usability verdict is asserted. User evaluation is the next step.

## Capture

Target primary-source branch: `codex/atlas-visualization-more-prototype`. [Spec](../spec.md).

## Comments

2026-10-03: User requests four more after approving the quality of A–D. New options span continuous spatial density, radial hierarchy, categorical relationship flows, and graph-affinity axes. They test different visual assumptions rather than introduce new browsing workflows.

2026-10-03: E–H are available alongside A–D. No winner selected; the user can compare continuous concentration, radial hierarchy, categorical affinity flows, and graph-derived conceptual axes against the same sources.
