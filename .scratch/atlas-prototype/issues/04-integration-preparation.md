# Prepare Fusion for the main map

Status: ready-for-human
Type: task

## Request

Resolve the readiness findings before replacing the original map, reuse its existing behavior, and look for concrete cleanup/simplification opportunities. Keep the main renderer available for comparison.

## Result

- Preview uses the original AtlasStore for saved/external/vault/indexing events, debounce, pending-build polling, cached data, search and selection reconciliation.
- Original pending-target editor navigation is restored through Open in editor, double-click and Enter. Existing search components remain in place; map keyboard fit/zoom and touch tap/pan/pinch work.
- Camera uses a fixed world reference after initial framing. Routine refreshes and search do not fit/recenter; Fit map is explicit. Losing the selected note restores all eligible filenames. Source/path/excerpt updates invalidate loaded/in-flight source text.
- Native activity is an additive optional AtlasNode field populated at delivery using the existing effective_open_count policy. Older cache JSON defaults to unknown activity. No new activity writes or persistence policy.
- Removed duplicate local search, parallel snapshot/activity state, temporary region renaming, duplicate node lookup/link filtering and unused child hull fitting. Pure layout/label calculations moved out of Svelte and cache separately from mutable metadata. Spatial grid includes node centers as well as reserved labels.
- Shared store rejects initialization after route disposal and query/visibility-obsolete search responses.
- Offline adapter reloads snapshots on Atlas requests and reads fresh note bytes. It searches complete bodies and filenames with tag/# filters. Missing snapshots show unavailable state; fiction requires --demo. Offline text matching does not implement semantic relevance.

## Validation

- pnpm check: zero Svelte errors/warnings; E2E TypeScript passes.
- Production build passes.
- 40 focused TypeScript tests pass: store refresh/poll/races, dense-layout spacing and cached metadata, IPC fixtures and architecture fitness.
- Native cargo check --tests passes; focused Rust activity payload test passes, covering decay, unknown history and older cache deserialization.
- Eight Fusion browser regressions pass: double-click, Enter/button editor handoff, content search beyond excerpt, live deletion/camera, source invalidation, empty/unavailable state, 2,000-note SVG rendering/zoom/fit, touch tap/pinch. Three original-map navigation regressions also pass.
- Normal user preview contains 166 notes, 16 root clouds and 32 notes with recorded activity; shared labels remain mounted at reading zoom.
- Synthetic benchmark including caption placement (18 roots): 166 notes 5.9ms, 1,000 49.5ms, 2,000 103.5ms, 5,000 730.6ms initial. Metadata refresh 0.1–2.6ms. Earlier same 5,000 fixture took 6,684.8ms before allocation-free grid lookups. These are helper timings, not end-to-end native UI latency, and do not represent a pathological single dense cloud.
- Independent Standards/Spec reviews found no remaining confirmed blocker after verifying spatial-index boundary and touch capture fixes.

## Boundary before promotion

The main /map route source remains unchanged. This prepares shared behavior; it does not merge the new renderer or remove the development guard. Browser fixtures validate command/event wiring rather than actual native semantic retrieval. A native smoke check after promotion should cover model availability, indexing completion and native WebView input. Native activity contract is compiled and tested, but the currently running offline lab does not rebuild the desktop binary.
