# Main App QA Remediation Playbook

Date: 2026-04-22

Related docs:
- [Main App Deep QA Audit](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-deep-qa-audit-2026-04-22.md)

Related commits:
- `bf5d4aa` frontend notepad/settings/inbox cleanup
- `d330665` rust core/search/state cleanup
- `ecc55d5` semantic/graph optimization pass
- `52ddafa` ai helpers + restored fixtures

## Purpose

This playbook defines how to finish the partially addressed audit items and execute the major remaining reductions without breaking current app behavior. It is written to be converted directly into implementation tickets.

## Status Snapshot

| Workstream | Audit Status | Current State |
|---|---|---|
| Settings fan-out and polling churn | Partially addressed | Request dedupe and narrower reloads added, but store remains multi-concern and chatty |
| Interactive index refresh churn | Partially addressed | Refresh and sync cost reduced, but workflow is still refresh-driven instead of watcher-driven |
| Graph/map heavy load path | Partially addressed | Poll overlap and DB scoping improved, but payload remains mostly full-load |
| Clippy strict baseline | Partially addressed | Original `build.rs` lint fixed, repo still has broader `-D warnings` failures |
| `Notepad.svelte` decomposition | Major not addressed | File remains central orchestration surface |
| `state.rs` decomposition | Major not addressed | File remains mixed-responsibility backend module |
| `ai/mod.rs` decomposition | Major not addressed | File remains large multi-domain module |
| `commands.rs` narrowing | Major not addressed | Still mixes command orchestration and domain behavior |

## Partially Addressed Workstreams

### 1) Settings Store Fan-out and Polling Churn

Current files:
- [settings/store.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/settings/store.ts)

Target end state:
- One loader per concern with independent refresh cadence and error boundaries.
- No cross-refresh unless required by explicit dependency.

Implementation plan:
1. Split state slices into `semantic`, `sync`, `vault`, and `forgotten` loaders behind a small coordinator.
2. Move event handlers (`visibilitychange`, `vault-note-changed`) to a refresh policy layer that selects only affected loaders.
3. Replace timer-driven status polling with condition-based polling (only while semantic model/indexing is active).
4. Add per-slice in-flight request dedupe (already present for some calls, complete for all slices).

Exit criteria:
- Visibility resume does not call full semantic + sync + forgotten reload by default.
- Vault note change no longer fans out to unrelated sync/semantic actions.
- Store file reduced in complexity and measurable invoke count drops during a 5-minute idle settings session.

### 2) Interactive Index Refresh Churn

Current files:
- [index.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/index.rs)
- [search_commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/search_commands.rs)
- [task_commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/task_commands.rs)

Target end state:
- Watcher-driven invalidation and incremental updates are primary.
- Full vault refresh is fallback only.

Implementation plan:
1. Introduce an index invalidation epoch/dirty-path queue in the Rust app state.
2. Have watcher events mark changed note paths and trigger targeted upsert/delete in `NotesIndex`.
3. Update interactive commands to consume incremental freshness first; only run full refresh when invalidation state is unknown or inconsistent.
4. Add metrics counters for `full_refresh_count`, `incremental_update_count`, and command-level refresh source.

Exit criteria:
- `search`, `recent notes`, and `tasks` flows avoid full refresh in steady state.
- Full refresh count remains near zero during normal interactive sessions on unchanged vault.

### 3) Graph/Map Heavy Load Path

Current files:
- [graph_commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands/graph_commands.rs)
- [semantic/db.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/semantic/db.rs)
- [mapStore.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/graph/mapStore.ts)
- [GraphView.svelte](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/graph/GraphView.svelte)

Target end state:
- Fast route entry with staged graph hydration.
- Stable graph interactions without repeated full recompute.

Implementation plan:
1. Split `get_graph_data` into:
   - metadata/status endpoint (counts, readiness, time range)
   - graph payload endpoint (nodes/edges/clusters)
2. Cache payload by `(semantic_revision, color_group_count)` and return cache hit when unchanged.
3. Add incremental update mode for node positions and optional incremental edge rebuilds.
4. Frontend loads status first, then payload; avoid reset/rebuild if revision key is unchanged.

Exit criteria:
- Map route avoids full payload rebuild on no-op reopen.
- Polling stops once ready and does not overlap in-flight graph requests.

### 4) Clippy Strict Baseline

Current files:
- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/commands/search_commands.rs`
- `src-tauri/src/semantic/*`
- `src-tauri/src/sync.rs`

Target end state:
- `cargo clippy --all-targets -- -D warnings` passes cleanly.

Implementation plan:
1. Batch lint fixes by category:
   - signature/argument count reshaping
   - derivable impls / boolean simplifications / string replacement cleanups
2. For unavoidable high-arity APIs, replace positional args with parameter structs.
3. Gate each batch with full clippy + tests.
4. Add CI or pre-merge check to keep `-D warnings` green.

Exit criteria:
- Zero clippy warnings under current lint policy.

## Major Reduction Workstreams

### 5) Decompose `Notepad.svelte`

Current file:
- [Notepad.svelte](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/Notepad.svelte)

Target end state:
- Component acts as view shell + minimal route wiring.
- Orchestration moved into explicit controllers.

Implementation plan:
1. Extract pane/session orchestration into `notepadController` module.
2. Extract persistence/autosave into `notepadPersistenceController`.
3. Extract split-pane picker behavior into dedicated controller (existing helper can be expanded).
4. Extract proposal-mode flows into isolated module with clear interface.
5. Keep one migration branch per extraction to avoid large mixed diffs.

Exit criteria:
- `Notepad.svelte` size and branching complexity reduced substantially.
- No regression in open/save/remember/forget/search/related/split flows.

### 6) Decompose `state.rs`

Current file:
- [state.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/state.rs)

Target end state:
- State persistence, vault config, note-path resolution, and migration concerns are separated.

Implementation plan:
1. Create `state/` module folder with:
   - `vault_config.rs`
   - `metadata_repo.rs`
   - `note_path_resolver.rs`
   - `migrations.rs`
2. Move pure helpers first, then move DB-backed behaviors.
3. Keep old public function signatures as compatibility shims until all call sites are migrated.
4. Remove shims after command/sync call sites are fully moved.

Exit criteria:
- `state.rs` reduced to module wiring/re-exports.
- Domain responsibilities have clear owners and tests.

### 7) Decompose `ai/mod.rs`

Current file:
- [ai/mod.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/ai/mod.rs)

Target end state:
- AI behavior split by domain: provider config, diagnostics, job/inbox persistence, approval application, orchestration.

Implementation plan:
1. Introduce `ai/` submodules:
   - `provider.rs`
   - `settings.rs`
   - `diagnostics.rs`
   - `jobs_repo.rs`
   - `inbox_repo.rs`
   - `approval_service.rs`
   - `remember_orchestrator.rs`
2. Move internal DB access into repository modules and keep service APIs domain-specific.
3. Keep event emission points (`inbox-changed`) centralized in orchestration layer.
4. Add focused unit tests per new module before deleting old inline code.

Exit criteria:
- `ai/mod.rs` becomes thin public facade.
- Approval and job flows are testable in isolation.

### 8) Narrow `commands.rs`

Current file:
- [commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands.rs)

Target end state:
- Top-level commands module is mostly registration and thin request adapters.

Implementation plan:
1. Move remaining domain logic into existing submodules (`search_commands`, `task_commands`, `note_persistence`, etc.).
2. Standardize command handlers:
   - validate args
   - call domain service
   - map errors to command-safe strings
3. Add a simple command-surface map documenting owner module for each Tauri command.

Exit criteria:
- `commands.rs` no longer contains multi-step domain workflows.

## Cross-Cutting Safety Net (Required for All Major Splits)

### Frontend tests
1. Add unit tests for:
   - split pane picker behavior
   - inbox list resource request concurrency behavior
   - settings refresh policy transitions
2. Add store-level tests for search/related scheduling logic where practical.

### Backend tests
1. Add module-level unit tests for new extracted services/repos.
2. Keep fixture-based regression tests (`project-atlas`) in CI path.

## Recommended Execution Order

1. Finish clippy baseline to remove lint noise before larger refactors.
2. Add frontend/store tests for split/inbox/settings safety.
3. Decompose `state.rs` and `commands.rs` together (clear backend boundaries first).
4. Decompose `ai/mod.rs` with repository extraction.
5. Decompose `Notepad.svelte` incrementally with behavior-preserving moves.
6. Complete index invalidation and graph staged loading for runtime performance wins.

## Agent Execution Model (When Implementation Starts)

Use a lead-plus-specialists model, not a single worker and not uncontrolled parallelism.

### Agent topology

- 1 lead integrator agent
- 4 specialist implementation agents
- optional 1 stabilization agent for clippy/test cleanup batches

### Lead integrator responsibilities

1. Own architecture contracts and public interfaces before parallel coding starts.
2. Define file ownership and enforce non-overlap across specialists.
3. Review and integrate specialist PRs in wave order.
4. Run end-to-end validation after each wave.

### Specialist ownership map

Agent A: frontend orchestration
- [Notepad.svelte](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/Notepad.svelte)
- supporting notepad controller/module extracts in `src/lib/features/notepad/**`
- settings store decomposition in `src/lib/features/settings/**`

Agent B: rust core state/commands
- [state.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/state.rs)
- [commands.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/commands.rs)
- related extracted modules in `src-tauri/src/state/**` and `src-tauri/src/commands/**`

Agent C: AI subsystem split
- [ai/mod.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/ai/mod.rs)
- new `src-tauri/src/ai/**` modules (`provider`, `repo`, `orchestrator`, etc.)

Agent D: index + semantic/graph performance
- [index.rs](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src-tauri/src/index.rs)
- `src-tauri/src/commands/search_commands.rs`
- `src-tauri/src/commands/task_commands.rs`
- `src-tauri/src/commands/graph_commands.rs`
- `src-tauri/src/semantic/**`
- `src/lib/features/graph/**`

Agent E (optional): lint/test stabilization lane
- clippy remediation across targeted files
- test harness and regression test additions
- no architecture moves unless explicitly assigned

### Wave plan

Wave 0: contract phase (lead only)
1. Finalize module boundaries and interface contracts for `state`, `commands`, and `ai`.
2. Publish ownership table and freeze cross-owned files.
3. Define branch naming and PR template for this initiative.

Wave 1: backend boundary extraction (parallel)
1. Agent B decomposes `state.rs` and narrows `commands.rs`.
2. Agent C decomposes `ai/mod.rs`.
3. Agent E runs clippy/test baseline cleanup in untouched files only.
4. Lead integrates B then C, resolves shared type seams.

Wave 2: frontend decomposition + performance (parallel)
1. Agent A decomposes notepad/settings orchestration.
2. Agent D implements watcher-driven index invalidation and staged graph loading.
3. Agent E adds targeted frontend/backend tests for moved logic.
4. Lead integrates D then A to reduce merge conflicts with command contracts.

Wave 3: stabilization (lead + optional E)
1. Full regression pass across note/list/map/settings/inbox flows.
2. Final clippy strict pass.
3. Bundle-size and runtime metric comparison against pre-work baseline.

### Non-overlap rules

1. No two agents edit the same file in the same wave.
2. Shared interfaces can only be modified by the designated owner for that wave.
3. Any contract-breaking change requires lead approval before merge.
4. Large moves must be submitted as “move-only” commits before logic changes.

### Merge gates per PR

1. `pnpm run check`
2. `pnpm run build`
3. `cargo test --manifest-path src-tauri/Cargo.toml`
4. `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` for touched modules at minimum, full repo at wave end

### Operational defaults

1. Keep PR size small and domain-scoped.
2. Prefer extraction with compatibility shims first, behavior changes second.
3. Require short “risk + rollback” notes in each PR description.
4. Keep a running integration checklist in this playbook section as work advances.

## Definition of Done for This Playbook

- Each workstream above has an owner ticket and acceptance criteria copied verbatim.
- Major decomposition work is split into small mergeable PRs (no single mega-refactor PR).
- Validation baseline is green:
  - `pnpm run check`
  - `pnpm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
