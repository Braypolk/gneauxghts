# Main App QA: Remaining Partially Addressed Items

Date: 2026-04-22

Related docs:
- [Main App Deep QA Audit](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-deep-qa-audit-2026-04-22.md)
- [Main App QA Remediation Playbook](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-qa-remediation-playbook-2026-04-22.md)

Scope:
- Items that have meaningful progress but are not yet at the target end state.

Status update (2026-04-22):
- This checklist is now implemented in code in the current branch/worktree.

## 1) AI Module Decomposition (`ai/mod.rs`)

Current state:
- `ai/mod.rs` was reduced and split into:
  - [provider.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/ai/provider.rs)
  - [store.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/ai/store.rs)
- `ai/mod.rs` remains large and still carries broad orchestration responsibilities.

Remaining gap:
- Domain boundaries are better, but orchestration/service split is incomplete.

Next implementation steps:
1. Extract approval application logic into `approval_service.rs`.
2. Extract job runner/orchestration into `remember_orchestrator.rs`.
3. Keep event emission (`inbox-changed`) centralized in one orchestration layer.
4. Add module-level tests for each extracted service.

Exit criteria:
- `ai/mod.rs` is a thin facade + command bindings.
- Approval and remember/job orchestration are isolated and directly testable.

Implemented:
- Added [approval_service.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/ai/approval_service.rs) for approval/apply/retry/clear logic.
- Added [remember_orchestrator.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/ai/remember_orchestrator.rs) for worker wake/loop/process orchestration.
- `ai/mod.rs` command handlers now delegate to these services.

## 2) Command Layer Narrowing (`commands.rs`)

Current state:
- Note-session workflows moved into:
  - [note_session.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/note_session.rs)
- `commands.rs` is smaller but still broad.

Remaining gap:
- Some command handlers still contain non-trivial orchestration and cross-domain branching.

Next implementation steps:
1. Continue extracting domain-specific command internals from `commands.rs`.
2. Standardize command handlers to:
   - argument validation
   - domain service call
   - error mapping
3. Add a command ownership map (command -> module owner).

Exit criteria:
- `commands.rs` is mostly registration and thin adapters.

Implemented:
- Added [index_bridge.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/index_bridge.rs) and moved shared index helpers out of `commands.rs`.
- Updated command submodules to use `index_bridge` directly.
- Added ownership map doc: [main-app-command-ownership-map-2026-04-22.md](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-command-ownership-map-2026-04-22.md).

## 3) Settings Fan-out and Polling (`settings/store.ts`)

Current state:
- Refresh policy extraction added:
  - [refreshPolicy.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/refreshPolicy.ts)
- Store still owns multiple concerns in one file.

Remaining gap:
- Semantic, sync, vault, and forgotten-note state are still tightly coupled in one operational store.

Next implementation steps:
1. Split slice loaders into modules:
   - `semanticLoader`
   - `syncLoader`
   - `vaultLoader`
   - `forgottenLoader`
2. Move event-triggered refresh decisions to a dedicated coordinator.
3. Measure invoke volume before/after to verify reduced fan-out.

Exit criteria:
- Visibility and vault-change events refresh only affected slices.
- Store complexity and invoke fan-out are materially reduced.

Implemented:
- Added slice loader modules:
  - [semanticLoader.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/loaders/semanticLoader.ts)
  - [syncLoader.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/loaders/syncLoader.ts)
  - [vaultLoader.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/loaders/vaultLoader.ts)
  - [forgottenLoader.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/loaders/forgottenLoader.ts)
- Added [refreshCoordinator.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/refreshCoordinator.ts) and removed `refreshPolicy.ts`.
- `store.ts` now routes visibility and vault-change refresh through the coordinator with narrower slice loads.

## 4) Interactive Index Refresh Strategy

Current state:
- Index revision tracking and conditional task resync were added:
  - [index.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/index.rs)
  - [task_commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/task_commands.rs)

Remaining gap:
- System is still not fully watcher-first invalidation for all interactive flows.

Next implementation steps:
1. Add explicit invalidation epoch + dirty-path queue as first-class app state.
2. Drive refresh from watcher events by default.
3. Keep full refresh as fallback path only.
4. Add counters:
   - `full_refresh_count`
   - `incremental_update_count`
   - command-level refresh source

Exit criteria:
- Routine search/task/list interactions avoid full vault refresh in steady state.

Implemented:
- Added interactive invalidation queue/epoch and refresh counters in [index.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/index.rs).
- Added `AppState::mark_notes_index_dirty` and `AppState::ensure_interactive_index`.
- Switched watcher updates to dirty-path invalidation in [watcher.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/sync/watcher.rs).
- Updated search/tasks/wikilinks/graph command paths to use watcher-first `ensure_interactive_index` with source tags.

## 5) Graph/Map Heavy Path

Current state:
- Graph cache and no-op view rebuild protections were added:
  - [graph_commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/graph_commands.rs)
  - [GraphView.svelte](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/graph/GraphView.svelte)

Remaining gap:
- API still returns a largely full payload path; staged metadata/payload split is not complete.

Next implementation steps:
1. Split graph API into:
   - lightweight metadata/status endpoint
   - heavy payload endpoint
2. Persist/cache payload by revision key and color group count.
3. Skip payload fetch when metadata indicates no revision change.

Exit criteria:
- No-op map re-open avoids full graph assembly and redraw.

Implemented:
- Added metadata endpoint `get_graph_data_metadata` in [graph_commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/graph_commands.rs).
- Kept heavy payload endpoint `get_graph_data` and keyed cache by semantic revision + notes revision + color groups.
- Updated [mapStore.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/graph/mapStore.ts) to fetch metadata first and skip payload fetch when revision key is unchanged.

## Recommended Order for Remaining Partial Items

1. Finish command and AI narrowing together.
2. Complete settings slice isolation.
3. Move index strategy to watcher-first invalidation.
4. Complete staged graph API and route hydration.
