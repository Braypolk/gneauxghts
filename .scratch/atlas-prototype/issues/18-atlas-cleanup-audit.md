# Atlas cleanup audit and resume notes

Status: ready-for-human
Type: task

## Request and scope

Stop feature work, audit the accumulated Atlas changes for competing or
duplicate logic, and clean up confirmed issues. Reviewed the Atlas working-tree
changes against main HEAD 1882ab00, including new routing/selection modules,
the map route, launcher, behavior documentation and browser tests. Independent
Standards and Spec reviews checked the current product contract and issue
history. Unrelated notepad/image changes were excluded.

## Corrections

- Removed the retired renderer's unused zoom tiers, fixed connection caps,
  cloud/hover presentation state, link and cloud visibility calculations,
  search opacity/size helpers and obsolete label key from AtlasStore. Call-site
  searches confirmed these had no live consumers. Removed their obsolete
  helper tests; layout tests still cover caption/metadata refresh without
  moving notes.
- Kept one live connection policy in atlasConnections: strength-based semantic
  filtering and unlimited authored neighbors, shared by graph and reader.
- Shared segment-distance and polygon-proximity math between layout and routing.
  Shared the connectedness clamp between screen size and world radius, and
  derived the router's maximum node radius from geometry rather than copying
  its current numeric upper bound.
- Unified cubic serialization/sampling so both spline strategies enforce
  clearance at the same resolution. Extended highways now use the existing
  highway success/failure caches rather than a second overlapping cache.
- Fixed Escape being ignored while the read-only full-source reader had focus.
  Editable/search controls retain their own keyboard handling; source arrows
  continue scrolling text. Added a browser regression checking reader closure,
  deselection and unchanged camera.
- Removed the launcher's duplicate, misleading original-map comparison URL;
  marked the earlier prototype state in the spec as archived.

## Resume later

The production renderer is `/map`. The behavior contract is
[docs/features/atlas.md](../../../docs/features/atlas.md); earlier prototypes
are archived in Git history and old bookmarks redirect to the main map.

Ownership: AtlasStore owns published data, indexed search, selected note and
native subscriptions/polling. AtlasMap owns camera, hover, floating reader,
region inspection and temporary strength/routing controls. atlasLayout owns
fixed world geography and captions. atlasConnections owns neighbor policy.
atlasRouting owns geometry-derived path/highway caches. Camera and strength
changes must not invalidate existing route geometry.

Retained distinctions are intentional: reader browsing stays within the
original picked note's neighborhood while the active note changes; raster
obstacles plan paths while exact sampled geometry validates them; the natural
spline is required at shared joins, with older validated bends available only
for independent routes. The straight-line comparison checkbox remains because
the user requested it.

Routing is heuristic. Shared approaches group fixed region geometry and take
quadratic work in region size, cached per source/region. Not every nearby-looking
pair can safely share a path. Cloud avoidance yields before dot clearance.
Unrouteable or overlapping geometry retains a final direct cubic so authored
links are never dropped; that final fallback cannot guarantee obstacle gaps.
The read-only lab does not establish native WKWebView behavior or production
performance for every vault shape. Future work should start with a concrete
reproduction or usability question rather than adding more routing variants.

## Verification

All 42 Atlas unit tests and 20 map browser tests pass. Browser coverage includes
the focused-source Escape regression, search without automatic selection,
empty-canvas zoom/deselection, editor handoff, source invalidation, shared and
nested highways through filtering/focus, and a 2,000-note fixture. Type checking
reports zero errors/warnings; the production build and diff whitespace checks
pass. The read-only live lab was reloaded and its 166-note overview verified.
Independent follow-up reviews verified the corrections; an obsolete assertion-
free helper test found during that review was removed. No additional confirmed
Atlas defects remain from this audit.
