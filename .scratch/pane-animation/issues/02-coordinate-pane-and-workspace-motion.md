# 02 — Coordinate pane and workspace motion

Status: resolved
Implementation: complete (2026-09-22)
Depends on: 01

Read [the spec](../spec.md), `ARCHITECTURE.md`, and the applicable pane/document behavior invariants.

## Change

Introduce one small presentation helper for the pane layout transition, composed at the workspace view. Its inputs are the affected DOM elements, destination layout, and motion preference; its output is a cancellable completion. It owns temporary geometry and animation handles only.

- Capture actual before/after dimensions at transition boundaries, batching reads and writes. Measure or calculate final geometry without painting an intermediate final-layout flash.
- Animate explicit pane widths and outer/card dimensions between those endpoints on the same 220 ms easing curve. An entering pane starts at zero width and opacity; a leaving pane reaches zero while mounted. Cover either close side and note/chat content.
- Replace the independent max-width animation for pane changes with interpolation of actual viewport-constrained widths. Coordinate Related reservation using final shell geometry; suppress its intermediate observer-driven retargeting and the card's separate 300 ms transition for this operation.
- Keep the active border aligned with the changing pane geometry; hide it when collapse begins.
- Connect completion to the existing close preparation seam in `paneCloseAnimation.ts` / `notepadCommands.ts`. Treat absent motion, reduced motion, cancellation, and disposal as explicit completion paths. Include a bounded fallback; do not strand close on a missing event.
- On interruption, cancel old work and clean up temporary styles. For a real window resize, settle safely to the current responsive layout; for a replacement pane operation, start from current displayed geometry where feasible. Ignore old completion callbacks after supersession.

Likely touch points: `Notepad.svelte`, `NotepadPane.svelte`, route `+page.svelte`, Related layout helpers, and the existing pane animation adapter. Keep workspace membership and save/departure ordering in their current owners. No editor DOM cloning, snapshots, or fixed-width text layer in this pass.

## Verification

Check intermediate widths on open and close, final geometry after cleanup, and the absence of the baseline reversal/overshoot. Opening and closing should each finish as one movement. Exercise stale/failed preparation and cancellation using the existing controller tests where timing coordination changes. Ticket 03 verifies the full user journey and native renderer.

## Comments

- Planned 2026-09-22. Keep this presentation-local; an ownership redesign is unnecessary for the measured defects.

## Implementation evidence

Completed in the current working tree. See [validation results](../validation.md).
The final view uses Web Animations for coordinated motion; component-scoped
pane CSS defines the resting/collapsed layouts rather than a second CSS transition.
