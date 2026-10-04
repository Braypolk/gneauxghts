# Atlas/main integration Spec review

Status: ready-for-agent
Progress: Read-only independent review complete; integration requirements below are recorded before coordinator edits. No source changes or test/build/browser runs.

## Scope

Applied the repository code-review skill (Spec axis). Compared `git diff cb4d4c02f0e2c1220d37b281ee300eff1aabf20b 3464e93bd91ecfd14b0c58a9ca07f8f8bcd17a79` and current cleanup source. Read `main:docs/features/atlas.md`, main issues04/05, local `.scratch/merge-main/spec.md`, and previous test-reduction requirements. This is a pre-integration review of two source sides, **not** a claim that the coordinator has already introduced the mistakes described below. Line numbers for main-only files refer to that main commit.

## Required merge corrections / protection

### M1 — Preserve the real offscreen navigation regression while replacing the obsolete Deck case

Spec: merge spec says “Preserve cleanup behavior and Atlas Fusion changes”; main issue05 says “Obsolete Deck introspection is replaced with public hover/fit/zoom/region checks.”

Both sides changed `e2e/specs/browser/animation-navigation.spec.ts`. Main's first case (line12) is the old synthetic scroll-owner/reduced-motion check, while cleanup's first case (line15) is `reveals a task destination outside the mounted editor viewport after route navigation`. That actual route/editor regression protects a reproduced lifecycle ordering defect and full-document reveal; it is not superseded by main's map tests. Taking main's file wholesale would lose this protection and restore the old test machinery. Keep cleanup's offscreen case and reset helper; replace only its Deck hover case with main's public renderer case (main line63). Remove Deck module instrumentation made obsolete by that replacement. Main's deletion of `map-navigation.spec.ts` is valid: new `map.spec.ts` preserves selected-other-note double-click, Enter and empty-space double-click. Do not retain the old canvas-coordinate tests alongside the SVG renderer.

### M2 — Add Atlas behavior to the isolated backend, not a second event/installation model

Spec: merge spec says “Resolve both sides of conflicts without restoring removed abstractions”; Atlas docs say the store keeps “the original save/external/vault/indexing subscriptions and pending build polling.”

Main adds `setAtlas`, a search response, and a new `eventHandlers` map inside the old `installBrowserE2eBackend` (main lines527–590,902–941). Cleanup already has a per-instance `createBrowserE2eBackend(overrides)`, a `listeners` map, exact event unsubscription, `bridge.emit`, strict unknown-command rejection, and one shared bridge type (`browserBackendContract.ts`, re-exported by `e2e/support/browserBackend.d.ts`). Preserve these owners. Add only per-instance Atlas override/search capabilities and the `setAtlas` bridge member. Using both listener maps can make a map test's emitted event miss actual AppStore subscriptions; restoring main's catch-all null/empty returns would erase deliberately retained command-boundary failures. Keep cleanup's fixture tests, especially `delivers to each subscription and unlistens only its owned callback`.

Main's new `map.spec.ts:9–12` starts cases with `browser.url('/map')` only. It reloads in-memory JavaScript but leaves durable workspace/cursor/settings storage from previous cases. Adapt setup through the existing inert-origin `resetBrowserWorkspace` before navigating to `/map` so editor handoff tests have an explicit baseline. Do not invent a second reset implementation or clear storage while mounted owners can write it back.

### M3 — Port delivery-time activity into the extracted publication owner

Spec: Atlas docs require opacity from “the existing backend-decayed opening count and last-viewed timestamp” and “No new activity writes or persistence policy”; issue04 requires older cache JSON to default to unknown activity.

Main adds `AtlasNode.effective_open_count` with `#[serde(default)]`, `apply_opening_activity`, delivery overlay, node-construction fields, and `atlas_activity_payload_preserves_unknown_history_and_reads_older_cache_nodes` in the old monolithic `semantic/atlas.rs`. Cleanup moved that delivery path into `semantic/atlas/publication.rs:743–751`, construction into `publication.rs:348–375`, and tests into `publication_tests.rs`/other focused modules. Merely retaining cleanup's extracted files plus main's new field would compile only after field fixes yet still omit activity overlay at the *actual* delivery path. Move the helper/call and new regression to publication ownership; keep geometry/query modules extracted. Add `None` at every existing typed constructor including atlas-label fixtures. Retain all new assertions: old cache default, 5→3 decay after two intervals, serialized numeric field, unchanged x/y, unknown-history timestamp/count reset. Do not persist mutable activity into layout identity or add a separate write policy.

### M4 — Keep cleanup's lifecycle admission, carry the new store test contracts without duplicate mocks

Spec: issue04 says “Shared store rejects initialization after route disposal and query/visibility-obsolete search responses.” Atlas docs retain one owner for published response/search/selection and all subscriptions.

Cleanup's `#lifetime` plus joined `#initializePromise`, immediate search invalidation and injected search loader already cover main's `#initializeSequence` additions. Retain the cleanup implementation rather than layering another initialize counter or restoring direct IPC in `runSearch`. Cleanup also revalidates retained graphs on re-entry and protects Running Vault from next-launch selection; those are not replaced by Fusion.

Map main's three added store tests explicitly:

- `does not attach subscriptions when initialization finishes after leaving the map`: already owned by cleanup's stronger `joins initialization and never subscribes after disposal during visibility loading`; no duplicate required.
- `drops a completed search after its query is changed and changed back`: retain its **ABA** contract. Cleanup's existing `query` row changes old→new, which alone could pass using string comparison without sequence invalidation. Upgrade that retained query row to old→new→old rather than adding main's module-wide `invokeMock` and a parallel describe harness. This preserves the distinctive oracle without another fixture model.
- `clears a removed selection during refresh and does not replace a failure with demo data`: preserve this selection/error contract using the existing injected Atlas loader. Main browser live-deletion case covers mounted reader/labels/camera; it does not by itself prove failed-refresh retention, so do not discard the latter assertion as duplicate.

### M5 — Preserve the explicit lab adapter boundary while adopting main's fresh-data behavior

Spec: Atlas docs: “The development command pnpm atlas:lab uses read-only cached vault data … Fictional data requires --demo. Production does not import the demo fixture or depend on this launcher.” Merge spec prohibits restoring removed abstractions.

Cleanup replaced `scripts/atlasPrototype.mjs` source rewriting with `transformIndexHtml` command overrides through `window.__GNEAUXGHTS_E2E_COMMANDS__`; main retains the old transform at lines87–98 while adding required fresh snapshot/body reads, tag matching, explicit unavailable state, activity overlay and moved fixture paths. Combine those behavior changes with cleanup's existing command-override seam. Taking cleanup's launcher wholesale would retain automatic demo fallback and stale body caching and point to the deleted `src/lib/features/atlas/prototype/demo.ts`. Taking main's launcher wholesale restores string-spelling dependence on backend internals. New fixture import must be `/scripts/fixtures/atlasDemo.ts`; benchmark and layout tests already use that location. Remove the old prototype badge/variant navigation. The existing override map supports all four required commands without exposing additional app APIs.

## Reviewed accepted behavior without additional findings

- Main `/map` mounts the new renderer and uses AtlasStore, existing pending note target with `documentKind`, SearchBar/SearchDock, and route initialize/dispose. `/map/prototype` redirects; existing `/atlas` redirect remains. No parallel renderer route should survive integration.
- Renderer keeps camera transient and frames only initially or on explicit Fit/region action; passive query highlights do not select/open/close a note. Source signature invalidation includes id/path/update time/excerpt, and request sequence prevents old full-source reads replacing a newer selection. These match the documented requirements inspected.
- Main's three layout tests cover spacing/containment, deterministic placement, metadata/caption cache separation, deletion/empty behavior and filename identity. They are distinctive renderer contracts; no duplicated current cleanup layout owner was found. The 2,000-node browser case is a real rendering/input check, not evidence for a production latency promise. No runtime reduction is recommended without measurement.
- Main's public hover/zoom/Fit/region-Enter case is appropriate replacement coverage for deleted Deck introspection, including local keyboard precedence. Preserve the explicit no-editor-navigation assertion.
- Main's browser search fixture is intentionally lexical body matching. Do not describe passing browser tests as native semantic/tag retrieval validation; main's docs already distinguish native and offline behavior.

## Readiness

No additional confirmed defect in accepted Atlas behavior was established by this bounded source review. The five items are concrete integration requirements with identified source conflicts/coverage risks; root must verify them in the merged tree. Preserve all uniquely mapped contracts, consolidate only explicit duplicates, and use the existing isolated fixture and extracted-module architecture. No execution results are claimed by this reviewer.

## Authorized Rust merge resolution (frozen)

After this report was saved, root authorized only the Atlas Rust conflict resolution. Edited exactly:

- `src-tauri/src/semantic/atlas.rs`: resolved conflict by retaining the cleanup extracted-module root and adding main's two-line serde-default optional activity field. No old publication/query/test monolith restored.
- `src-tauri/src/semantic/atlas/publication.rs`: imported the existing decay function, moved main's unchanged `apply_opening_activity` helper into the publication owner, initialized new published nodes to unknown activity, and replaced delivery's timestamp-only overlay with main's timestamp/count overlay using one current timestamp.
- `src-tauri/src/semantic/atlas/publication_tests.rs`: copied the complete new main regression, unchanged apart from module indentation, into the already-registered publication test module. All six original assertions remain.

Inspected the already-auto-merged `atlas_labels.rs`; its only required new fixture field is present (`effective_open_count: None`). Did not edit that file. Repository-wide constructor search found the publication and label-fixture constructors accounted for; geometry's similar fixture is a `WorkingNode`, not `AtlasNode`, and was intentionally left unchanged. Read-only diff inspection confirms no conflict markers in the Atlas root/split modules and no other main Atlas production changes omitted from the compared delta. No staging, formatting command, tests or builds performed; root owns validation and staging. M3 implementation is complete pending root compilation/execution.
