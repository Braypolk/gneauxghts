# Highlight clouds from the region list

Status: resolved

Hovering an entry in All regions should highlight its cloud on the map.

## Comments

2026-10-04: Adding transient renderer-owned region preview for pointer hover
and keyboard focus, with a stronger cloud fill/outline and caption. Keep region
click navigation and map camera behavior intact. Clear preview when the panel
closes, the guide changes, or its region disappears.

## Answer

All regions entries now preview their cloud on pointer hover or keyboard focus.
The cloud gets a stronger fill, a clear outline at overview zoom, and an emphasized
caption; the list row also highlights. Pointer and keyboard previews are separate
so leaving a row does not erase an entry that still has keyboard focus. Closing
the panel clears both previews; changing to the region guide hides the preview;
removed regions are discarded on refresh. No camera, selection or persistence
changes occur from previewing an entry.

Verified on the read-only vault map: hover switches between applications and love,
pointer leave clears the highlight, keyboard focus matches its cloud, and panel
close removes it. Camera transform stays identical through hover. `pnpm check`
passes with zero Svelte errors/warnings and clean E2E TypeScript. Screenshot:
`/private/tmp/gneauxghts-region-hover.png`. Temporary tab/server were closed.
