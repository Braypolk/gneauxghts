# Main App Deep QA Audit

Date: 2026-04-22

Scope:
- Included: `src/**`, `src-tauri/src/**`
- Excluded: sync server and other server-side sync implementation details
- Reference-only: generated Apple/Tauri artifacts and vendored code

Follow-up:
- [Main App QA Remediation Playbook](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-qa-remediation-playbook-2026-04-22.md)

## Summary

This repo already has a solid local-first architecture and a meaningful Rust unit-test base, but the main app is now concentrated around a handful of oversized orchestration modules that make correctness, performance, and future refactors harder than they should be.

The current risk profile is dominated by:
- one very large frontend orchestration component: `src/lib/features/notepad/Notepad.svelte`
- several large backend orchestration/state modules: `src-tauri/src/commands.rs`, `src-tauri/src/state.rs`, `src-tauri/src/ai/mod.rs`
- repeated interactive full-vault refreshes and fan-out state reloads
- a baseline that is not fully clean: TypeScript check failures, missing Rust fixtures, formatting drift, and a Clippy warning promoted to error

Observed runtime routes:
- `Note`, `List`, `Map`, `Settings`, and `Inbox` all launched successfully in a live Tauri dev session
- opening a note from `List` returned to `Note` correctly
- `Map` rendered populated clusters
- `Settings -> Semantic search` showed live runtime/index telemetry
- destructive flows such as `Forget`, `Delete task`, and Inbox approval/rejection were intentionally not executed during the UI pass

## Hard Baseline

### Command results

| Command | Result | Classification |
|---|---|---|
| `pnpm run check` | Failed | Type-safety issue |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 63 passed, 5 failed | Missing fixture/test harness issue |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Failed | Style/lint issue |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Failed | Style/lint issue |
| `pnpm run build` | Passed | Clean build |
| `cargo build --manifest-path src-tauri/Cargo.toml` | Passed | Clean build |
| `pnpm tauri dev` | Passed | Live app launched |

### Baseline failures in detail

1. `pnpm run check`
   - `src/lib/features/notepad/Notepad.svelte:2247`
   - `src/lib/features/notepad/Notepad.svelte:2359`
   - `SplitChoice` includes `"new"`, but `resolveSplitPickerChoice` only accepts `"chat" | "current" | "previous"`.

2. `cargo test`
   - Five failures all trace back to `src-tauri/src/test_support.rs:44`
   - Missing `src-tauri/test-fixtures/project-atlas.*` fixture data breaks:
     - `index::tests::build_indexed_note_matches_project_atlas_fixture`
     - `search::tests::build_recent_result_prefers_first_body_paragraph`
     - `search::tests::search_note_matches_project_atlas_fixture`
     - `semantic::chunking::tests::chunk_markdown_matches_project_atlas_fixture`
     - `semantic::chunking::tests::chunk_markdown_produces_stable_content_hash_for_same_markdown`

3. `cargo clippy`
   - `src-tauri/build.rs:65`
   - `copy_runtime_libraries(resources_lib_dir: &PathBuf)` should take `&Path`

4. `cargo fmt --check`
   - Formatting drift in:
     - `src-tauri/src/commands/search_commands.rs`
     - `src-tauri/src/lexical.rs`
     - `src-tauri/src/search.rs`

### Build-size signals

`pnpm run build` succeeded, but the produced bundles show the editor/runtime surface is large:
- client chunk `CbH_Wgde.js`: 496.87 kB raw, 173.17 kB gzip
- client chunk `DNu6rfe2.js`: 336.83 kB raw, 81.09 kB gzip
- route chunk `nodes/2.*.js`: 181.19 kB raw, 52.39 kB gzip
- server chunk `draftly-vendor.js`: 531.18 kB
- server route `entries/pages/_page.svelte.js`: 255.41 kB

This is not automatically wrong for a desktop app, but it does confirm that the notepad/editor path carries most of the frontend weight.

## Architecture Map

### Top-level app shape

Frontend routes:
- `src/routes/+page.svelte`: main note editor
- `src/routes/list/+page.svelte`: master task list
- `src/routes/map/+page.svelte`: semantic graph view
- `src/routes/settings/+page.svelte`: semantic/sync/vault/theme/AI settings
- `src/routes/inbox/+page.svelte`: AI jobs and approval inbox

Shared frontend shell:
- `src/routes/+layout.svelte`: theme + mobile viewport + shared nav
- `src/lib/ui/NavBar.svelte`: route navigation, pending-save gating, inbox status indicator
- `src/lib/ui/navStatusStore.ts`: inbox badge polling/listening

Rust app bootstrap:
- `src-tauri/src/lib.rs`: initializes app data, vault, sync watcher, semantic state, AI state, and registers the Tauri command surface
- `src-tauri/src/index.rs`: in-memory note index + lexical index ownership
- `src-tauri/src/state.rs`: vault config, app metadata persistence, note path resolution, state migration, note persistence helpers
- `src-tauri/src/semantic/mod.rs`: semantic runtime facade over embed/index/db/ANN/related systems
- `src-tauri/src/ai/mod.rs`: AI settings, job execution, inbox persistence, and approval flows

### Runtime events

| Event | Emitted by | Consumed by | Purpose |
|---|---|---|---|
| `vault-note-changed` | `src-tauri/src/sync/watcher.rs` | `src/lib/features/notepad/Notepad.svelte`, `src/lib/features/settings/store.ts` | React to vault file changes |
| `inbox-changed` | `src-tauri/src/ai/mod.rs` | `src/lib/ui/navStatusStore.ts`, `src/lib/features/inbox/store.ts` | Refresh AI inbox state |

### Frontend to backend matrix

| Frontend surface | Tauri invokes/events | Backend owners |
|---|---|---|
| Notepad session/editor | `load_note_session`, `open_note`, `read_note`, `save_note`, `remember_note`, `remember_with_action`, `store_pasted_image`, `forget_note`, `restore_forgotten_notes`, `get_semantic_status`, `vault-note-changed` | `commands.rs`, `commands/note_persistence.rs`, `commands/forgotten_note_commands.rs`, `state.rs`, `index.rs`, `semantic/mod.rs`, `ai/mod.rs` |
| Notepad search/related | `search_notes_hybrid`, `list_recent_notes`, `list_recent_tasks`, `get_related_notes` | `commands/search_commands.rs`, `search.rs`, `lexical.rs`, `semantic/mod.rs` |
| Wikilinks/images | `autocomplete_note_links`, `resolve_note_link`, `read_image_asset_data_url`, `store_pasted_image` | `commands/wikilink_commands.rs`, `commands/asset_commands.rs`, `index.rs`, filesystem |
| Task list | `list_tasks`, `set_note_collapsed`, `set_task_hidden`, `toggle_task`, `set_note_hidden`, `set_note_order`, `delete_task`, `open_note` | `commands/task_commands.rs`, `state.rs`, `index.rs` |
| Map | `get_semantic_status`, `get_graph_data`, `save_graph_node_positions`, `open_note` | `commands/graph_commands.rs`, `semantic/db.rs`, `semantic/cluster.rs`, `index.rs` |
| Settings | `get_semantic_status`, `get_semantic_settings`, `set_semantic_settings`, `get_semantic_debug_metrics`, `clear_semantic_debug_metrics`, `prepare_semantic_model`, `rebuild_semantic_index`, `pause_semantic_indexing`, `resume_semantic_indexing`, `get_vault_info`, `set_vault_directory`, sync commands, AI settings commands, `vault-note-changed` | `semantic/mod.rs`, `state.rs`, `sync.rs`, `ai/mod.rs` |
| Inbox | `list_inbox_items`, `get_inbox_item`, `approve_inbox_item`, `approve_inbox_item_with_changes`, `reject_inbox_item`, `retry_inbox_item`, `clear_inbox`, `open_note`, `inbox-changed` | `ai/mod.rs`, `commands.rs` |
| Nav status | `list_inbox_items`, `inbox-changed` | `ai/mod.rs` |

## End-to-End Workflow Traces

### 1. Note load/open/save/remember/forget

Frontend path:
- `Notepad.svelte` owns pane state, draft state, autosave scheduling, split-pane behavior, related/search coordination, and proposal mode
- session helpers live in `src/lib/features/notepad/session/session.ts`

Backend path:
- `open_note`, `read_note`, `save_note`, `remember_note` route through `commands.rs` and `commands/note_persistence.rs`
- persistence touches `state.rs`, `index.rs`, sync dirty-marking, and semantic queueing
- forgetting/restoring goes through `commands/forgotten_note_commands.rs`, which also updates sync and semantic state

Relationship:
- this is the most coupled path in the app
- note save/remember/forget updates filesystem state, app metadata, recent note state, task timestamps, lexical index, notes index, sync dirty state, and semantic indexing queues

### 2. Search and hybrid search

Frontend path:
- `src/lib/features/notepad/search/store.ts`
- `src/lib/features/notepad/search/search.ts`
- `src/lib/features/notepad/ui/bottomBarState.ts`

Backend path:
- `src-tauri/src/commands/search_commands.rs`
- lexical and note search logic in `src-tauri/src/lexical.rs` and `src-tauri/src/search.rs`
- semantic augmentation in `src-tauri/src/semantic/mod.rs`

Relationship:
- hybrid search always begins with lexical collection
- semantic search is only used for `All` mode and only for queries that pass a length/term threshold
- the search UI depends on current in-editor title/markdown/path overrides, so the frontend and backend are tightly coordinated here

### 3. Related notes

Frontend path:
- `src/lib/features/notepad/related/store.ts`
- `src/lib/features/notepad/related/layout.ts`

Backend path:
- `get_related_notes`
- `semantic.related_notes(...)`
- semantic DB, ANN, and related-query cache

Relationship:
- the related panel is selection-aware and debounced on the frontend
- the semantic layer caches related-query results internally
- this path already has useful telemetry, which is a strong point

### 4. Task list and mutation

Frontend path:
- `src/routes/list/+page.svelte`
- `src/lib/features/tasks/taskListStore.ts`

Backend path:
- `src-tauri/src/commands/task_commands.rs`
- `state.rs` task timestamp persistence
- `index.rs` task parsing/toggling/deletion helpers

Relationship:
- task UI is optimistic for hidden/collapsed state, but toggle/delete reload the list after mutation
- task data is still derived from note markdown, so list operations are coupled to note parsing and full-note reads

### 5. Graph/map

Frontend path:
- `src/routes/map/+page.svelte`
- `src/lib/features/graph/mapStore.ts`
- `src/lib/features/graph/GraphView.svelte`

Backend path:
- `src-tauri/src/commands/graph_commands.rs`
- semantic DB loaders, embedding metadata, clustering, node position persistence

Relationship:
- map load depends entirely on semantic readiness
- the frontend polls semantic status until the model is ready
- the backend loads all note metadata, embeddings, snippets, positions, and edges, then clusters notes unless a revision-scoped cache hits

### 6. Settings and semantic controls

Frontend path:
- `src/routes/settings/+page.svelte`
- `src/lib/features/settings/store.ts`
- `src/lib/features/settings/aiRememberSettingsStore.ts`

Backend path:
- semantic commands in `commands.rs`
- sync commands in `commands.rs` and `sync.rs`
- vault configuration in `state.rs`
- AI diagnostics/settings/models in `ai/mod.rs`

Relationship:
- settings is effectively a control plane for the rest of the app
- it is also one of the chattiest frontend stores, with bulk reloads, polling, event listeners, and auto-sync hooks

### 7. AI/inbox flows

Frontend path:
- `src/routes/inbox/+page.svelte`
- `src/lib/features/inbox/store.ts`
- proposal state in `src/lib/features/proposals/session.ts`

Backend path:
- `src-tauri/src/ai/mod.rs`

Relationship:
- the AI module owns provider configuration, diagnostics, model discovery, job history, inbox storage, approval application, and event emission
- this is a separate subsystem, but it is now firmly part of the main desktop app surface and affects navigation state too

## Subsystem Assessment

### Frontend

#### Notepad/editor/session/runtime state

Responsibilities:
- pane management
- note draft state
- editor lifecycle
- autosave
- disk refresh
- forget/restore
- search/related coordination
- proposal review mode
- split-pane picker and placeholder chat pane

Assessment:
- strongest example of frontend over-centralization
- `Notepad.svelte` at 2899 lines is effectively the feature shell, workflow controller, and runtime coordinator
- several useful helpers already exist, but the top-level component still owns too many decisions

Primary concerns:
- fragile coupling across panes, note state, editor state, search state, and related state
- hard to unit test because the core behavior is concentrated in Svelte component logic
- current TypeScript failure is inside this file, reinforcing the maintenance cost

#### Search/related/wikilinks/images

Assessment:
- generally cleaner than the notepad shell
- good use of small helper modules and request-cancellation patterns
- still tightly coupled to live editor state and current-document overrides

Primary concerns:
- frontend stores are clean in isolation, but they rely on a backend that may refresh the vault repeatedly
- related/search scheduling is split across multiple stores plus notepad orchestration

#### Tasks/list

Assessment:
- conceptually straightforward
- UI is readable and store boundaries are reasonable

Primary concerns:
- task toggles and deletes force reloads instead of reusing local derived state
- backend task operations still depend on full note reads and timestamp reconciliation

#### Graph/map

Assessment:
- clear route/store/view split
- graph clustering cache is a positive design decision

Primary concerns:
- frontend polling loop plus expensive backend graph assembly create a high-latency risk path
- `GraphView.svelte` is large and D3-heavy, which makes it another likely performance hotspot

#### Settings

Assessment:
- settings route is well-featured, but it is now operationally dense

Primary concerns:
- `settings/store.ts` is too chatty and mixes semantic controls, vault settings, sync lifecycle, forgotten notes, and auto-sync coordination
- repeated full reloads can cause redundant backend traffic

#### Shared UI/utilities

Assessment:
- nav shell is fairly small
- pending-save navigation gating is a good pattern

Primary concerns:
- inbox indicator duplicates inbox loading work done elsewhere

### Backend

#### Tauri command layer

Assessment:
- command surface is broad and mostly coherent
- some domain-specific work has already been extracted to submodules

Primary concerns:
- `commands.rs` is still too large and too central
- command registration in `lib.rs` exposes a very wide API surface without a stricter domain boundary

#### Persisted app state and vault path handling

Assessment:
- robust handling of defaults, custom vaults, migrations, and note metadata

Primary concerns:
- `state.rs` is carrying too many roles:
  - environment path initialization
  - vault configuration
  - database state persistence
  - JSON migration
  - note persistence helpers
  - note path resolution
  - forgotten-note path logic
- this is a major simplification target

#### Note parsing/indexing/search

Assessment:
- one of the cleaner backend subsystems conceptually
- Rust tests around indexing/search/task parsing are valuable

Primary concerns:
- interactive commands repeatedly call `refresh_if_stale(...)`
- refresh is filesystem-driven and uses recursive collection/signature checks, which becomes more expensive as the vault grows

#### Semantic DB/indexer/embed/ANN/related

Assessment:
- functionally rich subsystem with real observability and runtime checks
- ANN cache, cluster cache, and related-query cache are good signs

Primary concerns:
- complexity is distributed across many large files
- graph, search, and related-note features all depend on this stack
- repeated `open_database` and `ensure_schema` calls make the hot path noisier than necessary

#### AI module

Assessment:
- powerful subsystem with inbox/state/approval support

Primary concerns:
- `src-tauri/src/ai/mod.rs` at 3468 lines is too large for safe iteration
- it duplicates database/schema concerns internally instead of leaning on a shared persistence layer
- it owns too many separate concepts:
  - provider settings
  - diagnostics
  - model listing
  - remember flows
  - inbox storage
  - job execution
  - approval application

## Bottlenecks and Efficiency Risks

### Highest-likelihood runtime bottlenecks

1. Interactive note-index refresh churn
   - Evidence:
     - `list_recent_notes`, `search_notes`, `search_notes_hybrid`, `list_recent_tasks`, `list_tasks`, wikilink commands, and graph position save all touch the in-memory notes index and call `refresh_if_stale(...)`
     - `refresh_if_stale(...)` ultimately walks the vault via `collect_markdown_files_recursively(...)`
   - Risk:
     - repeated filesystem scanning on UI-facing actions
     - amplified as vault size increases

2. Notepad orchestration on the critical path
   - Evidence:
     - `Notepad.svelte` combines editor lifecycle, autosave, pane management, disk refresh, related/search scheduling, and proposal handling
   - Risk:
     - state churn and regressions are more likely because many workflows share the same orchestration surface

3. Settings fan-out and polling
   - Evidence:
     - `loadSemanticState()` invokes six commands in parallel
     - semantic polling runs every 5 seconds while certain conditions are true
     - visibility and vault-change handlers trigger more reloads and auto-sync
   - Risk:
     - redundant command load
     - unpredictable UI work during longer indexing or sync sessions

4. Map readiness polling and full graph rebuild path
   - Evidence:
     - `mapStore.ts` polls `get_semantic_status` every 1.5 seconds
     - `get_graph_data` loads note metadata, embeddings, snippets, positions, edges, and potentially reclusters
   - Risk:
     - graph open can be expensive even when the route itself looks simple

5. Task mutation refresh path
   - Evidence:
     - task toggle/delete flows reload after mutation
     - backend task mutation reads note markdown and rewrites persisted state
   - Risk:
     - avoidable work on frequent task interactions

### Observed positive performance patterns

- semantic search is skipped for small/weak queries instead of always running
- semantic search and related-note work use `spawn_blocking`
- graph cluster assignments are revision-cached
- semantic subsystem exposes meaningful debug metrics
- auto-sync work is queued rather than sprayed concurrently

## Findings Backlog

### Correctness and regression risk

#### P1. Frontend static baseline is broken in the main note surface

Evidence:
- `src/lib/features/notepad/Notepad.svelte:2247`
- `src/lib/features/notepad/Notepad.svelte:2359`

Why it matters:
- the main editing surface already fails type-checking
- this weakens confidence in the highest-risk module

Recommended fix shape:
- align `SplitChoice` and `resolveSplitPickerChoice(...)`
- add a small type-level or unit-level assertion around split-pane choices

Expected payoff:
- restores trust in the static frontend baseline

#### P1. Rust search/index/chunking fixture coverage is effectively disabled

Evidence:
- missing `src-tauri/test-fixtures` causes 5 deterministic test failures

Why it matters:
- these tests are intended to lock down some of the search/index/content-shaping behavior
- right now they do not provide signal

Recommended fix shape:
- restore the missing `project-atlas` fixture set
- make fixture absence fail with a clearer setup error, or move those tests to inline fixtures if that is the intended model

Expected payoff:
- restores regression protection around core note indexing/search behavior

### Performance bottlenecks

#### P1. Interactive commands repeatedly force vault freshness checks

Evidence:
- `search_commands.rs`, `task_commands.rs`, `wikilink_commands.rs`, and parts of graph handling all refresh the note index if stale
- staleness window is short: 750 ms

Why it matters:
- on a larger vault, repeated scans and signature checks become an app-wide tax

Recommended fix shape:
- move toward event-driven invalidation using the watcher as the primary source of truth
- keep refresh-on-demand as a fallback, but not the dominant path for frequent actions

Expected payoff:
- lower filesystem churn across search, list, graph, and notepad flows

#### P1. Settings reload path is doing too much work too often

Evidence:
- `settings/store.ts` bulk loads semantic state, vault info, sync status, and conflicts together
- visibility and vault-change hooks retrigger broad reloads
- auto-sync is also scheduled from settings

Why it matters:
- this is effectively an operational dashboard with several overlapping refresh paths

Recommended fix shape:
- split semantic status, vault info, sync status, and forgotten-note state into narrower loaders
- only reload the slice affected by each action

Expected payoff:
- fewer redundant invokes and less route-level churn

#### P2. Inbox status is fetched twice on every inbox-change event

Evidence:
- `src/lib/ui/navStatusStore.ts`
- `src/lib/features/inbox/store.ts`
- both listen to `inbox-changed` and both call `list_inbox_items`

Why it matters:
- this is unnecessary duplicate work on every inbox update

Recommended fix shape:
- centralize inbox status in one store or expose a cheaper indicator endpoint for nav status

Expected payoff:
- simpler event flow and lower duplicate fetch volume

#### P2. Graph route remains one of the most expensive user-visible loads

Evidence:
- semantic readiness polling in `mapStore.ts`
- full graph-data assembly in `graph_commands.rs`

Why it matters:
- the route depends on expensive semantic infrastructure and full-data assembly

Recommended fix shape:
- separate graph metadata from heavy payloads
- cache more aggressively across route opens
- consider incremental graph updates instead of always rebuilding the full response

Expected payoff:
- faster map open and reloads

### Simplification and maintainability

#### P1. `Notepad.svelte` is too large to safely evolve

Evidence:
- 2899 lines
- owns pane orchestration, editor runtime, autosave, refresh-from-disk, related/search coordination, remember/forget flows, proposal mode, and split-pane scaffolding

Why it matters:
- this is the frontend nexus for most critical workflows

Recommended fix shape:
- split by behavior, not by arbitrary file size:
  - pane/session orchestration
  - persistence/autosave actions
  - split-pane management
  - proposal mode
  - related/search wiring

Expected payoff:
- lower regression surface and easier targeted testing

#### P1. `state.rs` is a backend god module

Evidence:
- 1399 lines
- mixes vault config, environment path bootstrapping, metadata persistence, migration, note persistence helpers, path resolution, and forgotten-note support

Why it matters:
- nearly every important backend flow depends on it

Recommended fix shape:
- extract:
  - vault configuration
  - persisted app metadata repository
  - note path resolution
  - note persistence file operations

Expected payoff:
- cleaner ownership model across commands, sync, and note persistence

#### P1. `ai/mod.rs` needs domain splitting

Evidence:
- 3468 lines
- owns settings, diagnostics, model enumeration, remember dispatch, inbox/job storage, and approval application

Why it matters:
- this is large enough to hide cross-feature regressions

Recommended fix shape:
- extract separate modules for:
  - provider/settings
  - diagnostics
  - inbox/job persistence
  - approval application
  - remember action orchestration

Expected payoff:
- clearer AI subsystem boundaries and safer future changes

#### P2. `commands.rs` is still broader than it should be

Evidence:
- 1076 lines
- mixed domain wrappers remain alongside more focused submodules

Why it matters:
- this keeps the Tauri boundary harder to reason about than necessary

Recommended fix shape:
- continue domain-based extraction until `commands.rs` is mostly command registration plus thin wrappers

Expected payoff:
- easier command auditing and narrower backend surfaces

#### P2. Semantic subsystem is functionally rich but structurally heavy

Evidence:
- `semantic/mod.rs`, `db.rs`, `embed.rs`, `cluster.rs`, `indexer.rs`, `ann.rs`, `related.rs` are all substantial

Why it matters:
- graph, search, related notes, and settings all depend on this subsystem

Recommended fix shape:
- formalize sub-boundaries:
  - runtime/controller
  - persistence/repository
  - indexing pipeline
  - query services

Expected payoff:
- easier performance work and less cross-cutting modification risk

### Best-practice and hygiene gaps

#### P2. The repo is not formatting-clean on the Rust side

Evidence:
- `cargo fmt --check` fails

Recommended fix shape:
- restore a formatting-clean baseline and keep it enforced

Expected payoff:
- easier diffs and less review noise

#### P2. Clippy with `-D warnings` is not currently green

Evidence:
- `build.rs:65` ptr-arg issue

Recommended fix shape:
- fix the signature and keep a clean clippy baseline in CI or local pre-merge checks

Expected payoff:
- stronger lint discipline before further refactors

#### P2. Frontend has almost no automated test safety net

Evidence:
- no frontend test script in `package.json`
- no meaningful frontend test files surfaced in the main app scope

Recommended fix shape:
- add targeted tests for:
  - search store behavior
  - related store behavior
  - task store optimistic updates
  - split-pane selection typing/behavior

Expected payoff:
- less dependence on manual QA for core state-management logic

## Manual Scenario Pass

Executed in the live Tauri app:
- launched desktop app in dev mode
- opened `List`
- expanded a task group
- opened a note from the task list
- opened `Map`
- opened `Settings`
- opened `Settings -> Semantic search`
- opened `Inbox`

Observed outcomes:
- route navigation worked across all main surfaces
- `List -> Open` correctly navigated back into `Note`
- `Map` rendered populated graph clusters
- `Settings -> Semantic search` showed model/runtime/index telemetry, confirming the semantic stack is active in the live app
- `Inbox` loaded and showed applied AI work with review details

Not executed:
- `Forget`
- `Delete task`
- Inbox approval/rejection/retry
- sync conflict resolution

Reason:
- this pass stayed non-destructive and avoided mutating local note data or approval state

## Top 10 Highest-Leverage Reductions

1. Split `src/lib/features/notepad/Notepad.svelte` into smaller behavior-owned controllers and view shells.
2. Break `src-tauri/src/ai/mod.rs` into settings, diagnostics, inbox persistence, approval application, and remember orchestration modules.
3. Break `src-tauri/src/state.rs` into vault config, metadata repository, path resolution, and file persistence layers.
4. Reduce interactive `refresh_if_stale(...)` dependence by making watcher-driven invalidation the default path.
5. Narrow `src/lib/features/settings/store.ts` so semantic, sync, vault, and forgotten-note state reload independently.
6. Consolidate inbox event handling so nav status does not re-fetch the full inbox list separately.
7. Isolate the graph data pipeline so route open does less one-shot database and clustering work.
8. Restore the missing Rust fixtures so search/index/chunking tests are meaningful again.
9. Re-establish a clean Rust hygiene baseline with `cargo fmt --check` and `cargo clippy -D warnings`.
10. Add targeted frontend store tests before doing any large notepad/settings refactor.

## Suggested Implementation Order

1. Fix the broken baseline first:
   - `pnpm check`
   - restore Rust fixtures
   - `cargo fmt --check`
   - `cargo clippy -D warnings`

2. Remove the biggest orchestration bottlenecks:
   - `Notepad.svelte`
   - `state.rs`
   - `ai/mod.rs`

3. Then attack hot-path efficiency:
   - watcher-driven note-index invalidation
   - settings reload fan-out
   - inbox duplicate fetches
   - graph route load cost

4. Add lightweight frontend tests before or alongside the large frontend splits.

## Net Assessment

The app is functional and already has several strong foundations:
- local-first storage
- meaningful Rust test coverage in core modules
- useful semantic telemetry
- sensible domain splits in some areas

The main issue is not that the architecture is wrong. The issue is that too much of the architecture is now concentrated in a few oversized coordinator files. The next phase should prioritize reducing those coordinators, restoring a clean validation baseline, and replacing repeated broad refreshes with narrower, event-driven state updates.
