# Atlas visualization lab — second experiment

The first experiment was rejected: shelves, map/list, local neighbors and a review queue changed the browsing workflow instead of testing different whole-vault visualizations. Its primary source is preserved on `codex/atlas-interaction-prototype`. The revised experiment asks: **which visual encoding helps a person see all their notes, inspect how ideas relate, and narrow attention without losing the overview?** No production choice has been made.

## Run

`pnpm atlas:lab` opens a read-only comparison server. Start with [Treemap](http://127.0.0.1:1422/map/prototype?variant=treemap). The floating A–D switcher retains the same highlighted notes, filters and each view's session state. The Original Atlas link opens the unchanged `/map` interface using the same snapshot.

| Option | Encoding | Interaction and hypothesis | Main risk to evaluate |
| --- | --- | --- | --- |
| A / `treemap` | Nested rectangles, one equal-weight leaf per note; topic area reflects count | Topic/child boundaries, text/tag/topic highlight, selection and actual selected-note links, topic zoom/reset | Hierarchy is immediately visible but cross-topic structure is secondary; small labels truncate; hard partition hides overlapping membership |
| B / `matrix` | Every note on both axes; a filled cell is a recorded link | Topic/title/connectivity ordering, cell crosshair and exact pair inspector, magnified local lens, pair selection, link kind/strength | Dense connectivity is visible without crossed lines, but small cells require the detail lens and paths are harder to follow |
| C / `weave` | Every note around topic arcs; curved links gather through topic anchors | Trace note/topic connections, explicit/semantic/cross-topic filters, strongest-links thinning or all edges | Topic bridges may stand out, but arcs and curves can become a decorative tangle; angular order is categorization, not similarity |
| D / `time` | Every note on topic rows against actual created/updated dates | Date/type/strength controls, links for selected notes, rectangle selection and date-band highlighting | Useful temporal context depends on trustworthy metadata; imports can share dates, and collision packing needs a disclosed offset |

Each overview includes ungrouped notes and renders every snapshot node. Search and tag/topic lenses dim existing marks; they do not remove or regroup them. Link controls may hide edges, with counts showing the effect. Sorting and intentional topic zoom are explicit operations. Topic colors identify categories, not importance. Note selection carries between all four representations. Full sources open in an optional overlay. Selection/export remains a secondary inspection aid, rather than the primary experiment.

## Research grounding

The techniques test different properties rather than promise a better experience. [Johnson and Shneiderman's treemap paper](https://www.cs.umd.edu/~ben/papers/Johnson1991Tree.pdf) motivates using a bounded display for an entire hierarchy. This implementation uses equal note weights and balanced binary subdivision, not a claim of exact squarified treemap replication. [Ghoniem and Fekete's matrix work](https://doi.org/10.1145/1063669.1063698) motivates inspecting graph structure through row/column ordering. [Holten's hierarchical edge-bundling paper](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Holten06.pdf) motivates gathering links through a hierarchy; this prototype approximates that idea with quadratic/cubic curves through topic anchors. The time plot deliberately uses an interpretable metadata axis instead of introducing another unvalidated semantic projection.

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

The launcher binds only to `127.0.0.1:1422`, reads the configured vault's published Atlas and compatible labels, suppresses missing files, and reads activity through SQLite's read-only mode. The observed vault snapshot contains 166 notes, 16 root topics, 4 notes outside those topic memberships, and 2,915 links (2,826 semantic, 89 explicit). Those are snapshot facts, not general scale guarantees. Snapshot data and source bodies stay in process memory; no vault content is copied into source control. Indexed excerpts and later-read bodies can differ. Restart the launcher to acquire a newer snapshot.

`pnpm atlas:lab --demo` forces 38 fictional notes; the Demo button can also switch data in the browser. `pnpm atlas:lab --vault /absolute/vault/path` selects another published cache. Fallback data is explicitly labelled. The normal browser shell runs against the existing E2E mock; Atlas/source commands alone use read-only comparison data. This does not mutate the installed app or vault.

The lab is development-only, under the real app shell at `/map/prototype`, preserving the user-requested baseline. The source Atlas route and AtlasStore remain untouched. All state changes are in memory. These SVG experiments do not establish production performance at thousands of notes, algorithm quality, or usability with other people's vaults. A chosen approach requires production implementation and user testing.

## Capture

Primary-source branch for this round: `codex/atlas-visualization-prototype`. [Review issue](issues/01-compare-atlas-options.md). The first round remains recoverable in its separate branch; rejected workflow components have been removed from this lab.
