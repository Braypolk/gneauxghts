# Add an image viewer with note gallery zoom and pan

Status: resolved
Type: task
Depends on: 02, 03

## Scope

Implement the modal viewer, geometry, and lifecycle contract in [the specification](../spec.md). Open through image activation, Zoom, or Space. Inventory all source-note image occurrences in source order, including offscreen ones. Keep filename/error presentation and previous/next controls. Implement fit, zoom/reset, clamped pointer panning, and focus/selection/scroll restoration.

Viewer visibility belongs to the extended transient union; its session payload does not introduce another global open flag. Underlying editor input is inert. Use injected asset resources and request identities.

## Main files

- Private viewer session/geometry and `ImageViewer.svelte` under `images/`.
- `pane/paneTransientUiState.ts`, `pane/paneTransientUiController.svelte.ts`
- `Notepad.svelte` only for the existing surface composition/lifecycle integration.

## Acceptance

- Click/Zoom/Space, Right/Left, zoom keys/buttons, pointer pan, Escape/close/backdrop follow the specification.
- Duplicate assets remain separate gallery occurrences; missing images retain navigable entries.
- Viewer use causes no Markdown changes, save requests, or Note Revisions.
- Focus is trapped, controls are accessible, and ordinary editor shortcuts cannot run underneath.
- Navigation/replacement/History Mode/review/restart safely close it; restoration never focuses a dead or unrelated editor lifetime.
- Pure geometry tests and real browser journeys cover viewport resize, extremes, offscreen inventory, pending loads, and origin restoration.

## Comments

Use an in-app overlay. Native fullscreen, wheel/pinch gestures, and wraparound are not required by the recorded flow.

## Answer

Implemented the native modal dialog through the existing transient owner, including full-note occurrence inventory, missing/retry UI, browse/fit/zoom/pan, focus trapping, and lifetime-checked origin selection/scroll restoration. Viewer actions stay outside authored state. Fixed transient no-op reassignment during teardown so editor callbacks cannot resurrect a retired modal. Offscreen gallery and native close/return checks pass.

Evidence: [implementation validation](../validation.md).
