# Promote the accepted Atlas renderer to the main map

Status: ready-for-human
Type: task

## Request

Replace the original main map with the approved Fusion view after preparation.
Preserve the accepted interactions, including passive search, stable geography,
the original search component, floating info panel and Fit map.

## Implementation

- `/map` mounts AtlasMap without a development guard. The original Deck renderer
  is removed from the route and remains recoverable in Git history.
- Renderer, layout and activity helpers move into the production Atlas module;
  the fictional demo moves to a script fixture, outside production source.
- `/map/prototype` redirects to `/map`, retaining old bookmarks without a second
  renderer. Lab launcher and benchmark imports point to their promoted locations.
- Browser coverage moves to the main route. Duplicate navigation coverage is
  consolidated; empty-space double-click and bookmark redirects remain covered.
  Obsolete Deck introspection is replaced with public hover/fit/zoom/region checks.
- Global map shortcuts respect locally handled key events, preventing region
  Enter from also activating selected-note editor navigation.
- Current behavior documentation supersedes historical prototype boundaries.

## Validation

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- `pnpm build`: production SPA build passes, including the main map and redirect.
- Forty focused TypeScript checks pass across AtlasStore, dense layout/metadata
  caching, IPC fixtures and architecture fitness (37 + 3).
- Thirteen browser checks pass across the main-map and navigation-motion suites:
  passive search, explicit-selection preservation, editor handoff, live deletion
  and camera stability, source invalidation, empty/unavailable states, 2,000-node
  render/zoom/fit, touch tap/pinch, empty-space double-click, bookmark redirect,
  reduced-motion editor navigation, and public map hover/fit/region Enter.
- Independent Spec review has no confirmed blocker. Standards review identified
  the obsolete Deck regression and keyboard-event propagation; both corrections
  are covered in the passing browser suite.
- The open read-only preview redirects to `/map` and displays the user's 166-note
  vault with the accepted renderer. The native activity contract passed during
  preparation. Native semantic retrieval and WebView input still lack an
  installed-app smoke run; this promotion did not rebuild the installed binary.
  No native source changes beyond that preparation.
