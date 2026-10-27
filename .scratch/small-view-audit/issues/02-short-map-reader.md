# Give the Map reader usable space in short windows

Status: needs-triage
Disposition: deferred — user requested leaving landscape issues out of current scope.
Priority: P2
Type: task

## Reproduction

At 844×390, open Map, Fit map to view, and select Beta. The fixed connection-control area consumes nearly all the expanded info dock. `.reader` is only 36px high, equal to its total vertical padding; its title and excerpt are invisible. Scrolling to the end exposes only clipped Open in editor / Read full note buttons. The 640×560 regression does not exercise this height.

Sources: `src/lib/features/atlas/AtlasMap.svelte:526–546`: dock height subtracts 140px, info-body hides overflow, connection controls cannot shrink, and reader padding sets a 36px minimum. At keyboard visual height 126 the dock collapses further to a 2px border. Do not treat the keyboard case alone as proof of a native Name cloud journey; that journey remains to be validated.

## Acceptance

- At 844×390 and shorter supported windows, note title, excerpt, browse controls, and source/editor actions remain visibly reachable with normal scrolling.
- Regions use the same usable constrained-height strategy.
- With the keyboard open, active region naming/search controls and the collapse control remain accessible.
- Preserve ordinary tall-window behavior and map camera/selection state.

See [audit](../report.md), [reader](../evidence/probe-map-landscape-final.png), and [scrolled actions](../evidence/probe-map-landscape-scrolled.png).
