# Atlas fusion V3

Status: ready-for-human
Type: prototype

Question: Can the original spatial Atlas make notes readable at the point of exploration, while retaining fast connection browsing and an honest view of opening activity?

## User direction

The user finds the visualization tests interesting, but most require diverting attention to a distant preview and make note identity hard to read. Idea Weave supplies fast connection exploration; Topic × time supplies a useful sense of attention patterns. Build one V3 with the original Atlas at its heart. Keep the original and A–H available.

## Scope

Use native note positions and cloud hierarchy. Hover identifies a note near its glyph; click pins a readable excerpt at that location. Stepping or scrolling through the browse pool keeps the reader in place while the graph highlights that note and its incident links. Actual connected-note labels make endpoints legible. Full source expands inside the same reader rather than opening a distant panel. Search immediately identifies matching notes. Pan/zoom remain map operations.

Opening activity is distinct from note centrality and semantic similarity. The existing app count has an eight-hour cooldown and decays one per 36 hours idle; it is a recent activity weight, not lifetime frequency. A read-only launcher payload exposes effective counts, with last-viewed timestamps separately. Missing activity is labelled no recorded views, not never read. Demo data and native-runtime fallback have timestamps only.

No production persistence, Atlas state ownership, or original Atlas behavior changes. All V3 interactions stay in memory.

## Validation

Verified the 166-note vault with 2,916 links: every note appears once; search preserves native mark positions and keeps the reader anchored. Go Operator exposes all 24 recorded connections at the default threshold; connected browsing keeps the card fixed while note identity and links change. Wheel over the compact preview switches notes without zooming the map. Full-source reading stays in place; the expected 797-character source was identified, and an 8,760-character source scrolled without changing notes. Async reads correlate both a request token and active note ID.

Actual activity legend/labels match the local read-only audit: 134 no recorded openings, 25 idle effective weights at zero, seven positive weights. The 38-note demo exposes recency only, with no invented count option. Pan, zoom and reset verified. Desktop1280×720 and narrow391×851 checks passed after correcting real-pixel label sizing, preview placement, and a collapsed narrow excerpt caused by global control minimum sizes. The final narrow reader retains a visible title and104px of excerpt space.

Original Atlas route, AtlasStore and A–H match starting hashes byte-for-byte. `pnpm check` passed with zero errors or warnings; `pnpm build` passed. Full sources currently display plain Markdown in the prototype. No production decision has been made.

## Capture

Primary-source target: `codex/atlas-fusion-v3-prototype`. No production winner selected.

## Comments

2026-10-03: User requests one integrated V3 after comparing eight encodings. Earlier rounds remain available for comparison.

2026-10-03: V3 is available at `/map/prototype?variant=fusion`, alongside the first eight. The hypothesis is a stable nearby reader with connection glide, not another whole-vault rearrangement. Source/preview interactions do not count as openings or write activity.

2026-10-03 refinement: User requires filenames without hovering when no note is selected, with zoom gating to avoid clutter, and asks for activity shapes instead of secondary rings. V3 now reveals full, wrapped, clickable filenames for every note whose center is in the viewport at 4× (6× below 450px wide). Labels remain stable across hover and query changes. Local placement tries to avoid overlaps; dense compact layouts fall back to balanced annotation columns with leaders rather than dropping names. Topic labels give way to filenames at that zoom. Zoom now extends to 8×. These thresholds are prototype choices for evaluation, not a production decision.

Activity is one filled glyph in the topic color: circle = opened within seven days, diamond = opened earlier, triangle = no recorded opening. In opening-activity mode: circle = positive effective weight, diamond = zero/idle, triangle = no activity record. The exact value stays in the preview. Ordinary overview edges are now hidden; hover/pinned focus reveals eligible incident edges, and All links remains available. Interaction focus/collection outlines remain separate from activity.

Refinement validation: 166 marks preserved. Full filename text matched filename titles without shortening; no pinned reader was needed. At desktop1280×720, 3.7× had no filename labels and4.8× showed55 with zero overlapping boxes. At compact391×851,6.3× showed14 full filenames with zero overlapping boxes after correcting real cluster density. Clicking an annotation opened its note with33 eligible edges; Next changed the note and closing restored the quiet overview. Activity shapes matched the read-only audit (7 positive,25 idle,134 no record); recency shapes were17 recent,15 earlier,134 no opening. The user's normal pane was restored after breakpoint checks. Original Atlas and A–H hashes remain unchanged. `pnpm check` passes with zero errors/warnings; production build also verified.

Primary-source refinement: captured on `codex/atlas-fusion-v3-prototype`, following its original V3 snapshot. Only the V3 component and this issue were added to that capture; unrelated working changes remain outside it.
