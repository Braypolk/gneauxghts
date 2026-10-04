# Atlas visualization lab — eight comparisons and V3 fusion

## Current production map — 2026-10-03

The user approved promotion after integration preparation. The accepted Fusion
renderer now lives at `/map` as `features/atlas/AtlasMap.svelte`, with layout and
activity helpers in the same module. It initializes in production and uses the
existing AtlasStore and native command/navigation boundaries. The former
`/map/prototype` route only redirects to `/map`; variant parameters are retired.

Search highlights matches without selecting notes or changing the camera. The
floating reader/region panel, zoom-faded filenames, stable spacing, inside-cloud
captions, activity opacity, connectedness size and explicit Fit map remain.
The original renderer is recoverable from Git history; the prototype branch
retains the accepted pre-promotion version. See
[promotion](issues/05-promote-main-map.md) for scope and validation, and
[Atlas behavior](../../docs/features/atlas.md) for the current product contract.

The status sections below describe earlier stages, not the current routing.

## Current direction — 2026-10-03 cleanup

The user selected the fusion view for further work and requested one clean full-screen preview. Only AtlasFusion is active at /map/prototype; legacy variant parameters no longer switch renderers. Earlier A–H components and the comparison switcher are removed. Their complete source and earlier spec are recoverable on codex/atlas-prototypes-before-cleanup (8c4856d31d31d81cbbd286b7503c3da9d8b0fb4a).

The current view has the original Atlas bottom-centered search, a Fit map action, stable spaced dots with zoom-faded names, names inside clouds, and a floating dismissible note/region info panel. Extra filters and collection/export chrome are removed. The original production /map route remains untouched. The surviving preview is captured on codex/atlas-fusion-v3-prototype. See issues/03-atlas-fusion-v3.md for the current scope and checks.

### Integration preparation — 2026-10-03

Fusion stays on the development preview route; the main `/map` renderer is unchanged. The preview now consumes the same AtlasStore lifecycle, indexed search and selected-note state as the main map. Editor handoff uses the existing pending navigation target. Native Atlas nodes expose an optional, backend-decayed effectiveOpenCount; older cached payloads remain readable. Normal data refresh retains the camera and invalidates stale source reads. Transient region renaming is removed. Layout and captions are separately cached, with spatial indexing for spacing checks.

The offline lab refreshes published snapshots and full source bytes, supports full-body text/tag matching, and reports missing data rather than silently supplying fiction. It cannot exercise native semantic retrieval or live native indexing events. Use `--demo` explicitly for fictional data. See [integration preparation](issues/04-integration-preparation.md) for validation and remaining native smoke checks.

The sections below describe the historical comparison rounds, whose active UI has now been retired.


The first experiment was rejected: shelves, map/list, local neighbors and a review queue changed the browsing workflow instead of testing different whole-vault visualizations. Its primary source is preserved on `codex/atlas-interaction-prototype`. The revised experiment asks: **which visual encoding helps a person see all their notes, inspect how ideas relate, and narrow attention without losing the overview?** No production choice has been made.

## Run

`pnpm atlas:lab` opens the current [main Atlas map](http://127.0.0.1:1422/map)
against read-only published vault snapshots. It does not rebuild the native
application or provide native semantic retrieval. Earlier comparison views and
their switcher are archived in Git history.

| Option | Encoding | Interaction and hypothesis | Main risk to evaluate |
| --- | --- | --- | --- |
| A / `treemap` | Nested rectangles, one equal-weight leaf per note; topic area reflects count | Topic/child boundaries, text/tag/topic highlight, selection and actual selected-note links, topic zoom/reset | Hierarchy is immediately visible but cross-topic structure is secondary; small labels truncate; hard partition hides overlapping membership |
| B / `matrix` | Every note on both axes; a filled cell is a recorded link | Topic/title/connectivity ordering, cell crosshair and exact pair inspector, magnified local lens, pair selection, link kind/strength | Dense connectivity is visible without crossed lines, but small cells require the detail lens and paths are harder to follow |
| C / `weave` | Every note around topic arcs; curved links gather through topic anchors | Trace note/topic connections, explicit/semantic/cross-topic filters, strongest-links thinning or all edges | Topic bridges may stand out, but arcs and curves can become a decorative tangle; angular order is categorization, not similarity |
| D / `time` | Every note on topic rows against actual created/updated dates | Date/type/strength controls, links for selected notes, rectangle selection and date-band highlighting | Useful temporal context depends on trustworthy metadata; imports can share dates, and collision packing needs a disclosed offset |

Each overview includes ungrouped notes and renders every snapshot node. Search and tag/topic lenses dim existing marks; they do not remove or regroup them. Link controls may hide edges, with counts showing the effect. Sorting and intentional topic zoom are explicit operations. Topic colors identify categories, not importance. Note selection carries between all eight representations. Full sources open in an optional overlay. Selection/export remains a secondary inspection aid, rather than the primary experiment.

## Four additional encodings

On 2026-10-03 the user approved A–D as useful tests and requested four more. A–D remain byte-for-byte unchanged.

| Option | Encoding | Question | Main risk |
| --- | --- | --- | --- |
| E / `contour` | Continuous note-density contours behind every native-position note | Can concentrations, gaps and changes in smoothing make the vault easier to read than discrete region hulls? | Kernel bandwidth changes the terrain; contours do not establish new semantic membership or relationships |
| F / `sunburst` | Root/child idea sectors and individual note leaves in nested rings | Is radial hierarchy easier to navigate than rectangular area or a ring of connections? | Thin leaves need a targeting aid; hard hierarchy hides overlapping ideas |
| G / `flows` | Primary topics → individual notes → recorded related-topic affinities | Does unfolding categorical connections expose cross-topic notes and communities more clearly than bundled curves? | Crossing flows and aggregations can obscure individual evidence; related-topic affinity is not additional membership |
| H / `compass` | Graph-affinity axes against two chosen topics or notes | Can changing the conceptual axes reveal bridges and let people carve useful groups out of the whole vault? | The graph is sparse and thresholded; absent cached links do not prove dissimilarity, and overlapping points need disclosed offsets |

This expansion adds complementary lenses; it does not claim eight are needed in the final app. [Additional review issue](issues/02-four-more-visualizations.md).

## V3: Atlas fusion

The user preferred Idea Weave's fast connection exploration and Topic × time's attention patterns, but found note identity and content too far from the point of exploration. V3 retains the original Atlas positions and topic hierarchy. It tests whether a reader placed beside the active note can expose actual content and relationships without repeatedly moving attention to another panel. Browsing keeps the reader at a stable screen anchor while the graph updates. Full sources expand in that reader. The earlier eight views and original Atlas remain available.

Opening activity and last viewed are separate signals. The existing app-state `open_count` has an eight-hour counting cooldown and decays one per 36 hours idle; V3 exposes that effective activity weight through a read-only launcher payload. This is not lifetime viewing frequency. `lastViewedAtMillis` can include session restoration. Missing records say no recorded views, rather than never read. Demo/native fallback uses available timestamps without inventing counts. The earlier D plot uses created/updated dates; those are not view history.

The local activity audit found 32 recorded rows matching the 166-note snapshot: 25 effective weights were zero and seven were positive (1–3). The remaining 134 notes had no recorded row. This is incomplete app history, not a measure of whether the user has ever read a note elsewhere.

[Review issue](issues/03-atlas-fusion-v3.md). Primary-source branch: `codex/atlas-fusion-v3-prototype`. No production choice yet.

## Research grounding

The techniques test different properties rather than promise a better experience. [Johnson and Shneiderman's treemap paper](https://www.cs.umd.edu/~ben/papers/Johnson1991Tree.pdf) motivates using a bounded display for an entire hierarchy. This implementation uses equal note weights and balanced binary subdivision, not a claim of exact squarified treemap replication. [Ghoniem and Fekete's matrix work](https://doi.org/10.1145/1063669.1063698) motivates inspecting graph structure through row/column ordering. [Holten's hierarchical edge-bundling paper](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Holten06.pdf) motivates gathering links through a hierarchy; this prototype approximates that idea with quadratic/cubic curves through topic anchors. The time plot deliberately uses an interpretable metadata axis instead of introducing another unvalidated semantic projection.

The new contour experiment follows the density-field idea described in [D3's kernel-density documentation](https://d3js.org/d3-contour/density), using an independent small Gaussian grid/contour implementation because the repository has no D3 contour dependency. The radial hierarchy experiment is grounded in [Georgia Tech's SunBurst work](https://sites.cc.gatech.edu/gvu/ii/sunburst/). These are technique references, not evidence that users will prefer these particular prototypes. Topic flows and affinity axes are design hypotheses built from the available Atlas graph; they do not assert a new embedding or ground-truth similarity.

These papers establish visualization approaches; they do not establish demand for this app. The [earlier product research](../atlas-research/report.md) still applies, particularly the distinction between an appealing map and repeat utility.

## Comparison tasks

1. Identify the three largest ideas in the vault, and explain what their size means.
2. Find a bridge between two different topics. Inspect both actual sources and judge the relationship.
3. Highlight a topic or search term. Can you still tell where the highlighted notes sit in the whole vault?
4. Follow a note's explicit links separately from semantic matches. Is the distinction clear?
5. Select a group spatially or structurally, switch views, and see whether another encoding reveals something new.
6. Find a cluster of similar notes written or updated at different times. Check whether dates are informative or just import history.

Record ease of targeting, readable context, false inferred relationships, useful connections noticed, clutter at overview, and desire to return. A visualization failing one task can still be a useful optional lens. Do not select a winner on appearance alone.

## Data and boundaries

The launcher binds only to `127.0.0.1:1422`, reads the configured vault's published Atlas and compatible labels, suppresses missing files, and reads activity through SQLite's read-only mode. The snapshot observed during the additional round contains 166 notes, 16 root topics, 4 notes outside those topic memberships, and 2,916 links (2,827 semantic, 89 explicit). Those are snapshot facts, not general scale guarantees. Snapshot data and source bodies stay in process memory; no vault content is copied into source control. Indexed excerpts and later-read bodies can differ. Restart the launcher to acquire a newer snapshot.

`pnpm atlas:lab --demo` forces 38 fictional notes; earlier comparisons also offered an in-browser Demo button. `pnpm atlas:lab --vault /absolute/vault/path` selects another published cache. Fallback data is explicitly labelled. The normal browser shell runs against the existing E2E mock; Atlas/source commands alone use read-only comparison data. This does not mutate the installed app or vault.

The lab is development-only, under the real app shell at `/map/prototype`, preserving the user-requested baseline. The source Atlas route and AtlasStore remain untouched. All state changes are in memory. These SVG experiments do not establish production performance at thousands of notes, algorithm quality, or usability with other people's vaults. A chosen approach requires production implementation and user testing.

## Capture

The four additional encodings are captured on `codex/atlas-visualization-more-prototype`. A–D are retained.

Primary-source branch for this round: `codex/atlas-visualization-prototype`. [Review issue](issues/01-compare-atlas-options.md). The first round remains recoverable in its separate branch; rejected workflow components have been removed from this lab.
