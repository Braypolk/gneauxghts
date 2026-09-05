# Rust test-suite usefulness audit

Scope: current working tree, `src-tauri/src/**/*.rs`, including existing review fixes. No production or test files changed and no broad suites run. `src-tauri/tests/architecture_fitness.rs` belongs to the parent review. Assessment uses updated local code-review/TDD guidance, architecture ownership/invariants, and the Note Timeline Phase 1–3 specification. Future Phase 4 is not treated as missing coverage.

Inventory: 448 `#[test]` functions across 46 source files. One is Linux-only, giving 447 on macOS. Every test-bearing file's test names and gating were inspected; bodies were sampled in every file, with complete reads of suspect tests and their production callees. Large chat, timeline, Atlas, and indexer suites were **sampled, not exhaustively traced**. The inventory below records purposes and representative entry points; it is not a claim that all 448 tests were independently proven adequate.

## Findings and recommendations

### 1. Fix shared-environment race in RSS tests — correctness, P2

`src-tauri/src/semantic/debug.rs:302` and `:333` both mutate `GNEAUXGHTS_PROFILE_RSS` without a common lock. The first test sets it to `1`/`true`; the second removes it and expects `sample_rss` to do nothing. Default parallel Cargo execution permits the first test to enable profiling between the second test's removal and sample, or the second to remove it before the first's enabled assertion. Saving/restoring the variable does not serialize this interleaving. This is a demonstrated source-level interleaving, **not an observed flaky run in this audit**.

**Consolidate or synchronize.** Keep all truthy/falsy and disabled-sampling assertions. Combining into one environment-owning test is enough for these two; if retaining two, acquire the same environment guard and restore through a panic-safe guard. No timing sleeps needed.

### 2. Atlas atomic-publication test scripts the protocol it claims to verify — coverage, P2

`src-tauri/src/semantic/atlas.rs:4544–4583` manually writes the old/new artifacts and flips the ready pointer. It calls `atomic_write_json`, but never the production structural-build publication sequence at `:1079–1097`. Swapping production artifact/pointer order would leave this test green. The architecture requires retaining the last usable generation across interrupted replacement.

**Strengthen/replace.** Exercise the real publication path, interrupt or fail before the pointer switch, then load/query through the ordinary reader and prove the old generation remains usable. Delete the scripted test only when that surviving test exists. This is not criticism of inspecting persisted JSON: persisted pointer selection is the contract, but the test currently owns the relevant ordering itself.

### 3. Consumer invalidation tests prove result-type handling, not their named command integration — coverage limit, P2

`commands/search_commands.rs:1461`, `commands/task_commands.rs:554`, `commands/atlas_commands.rs:167`, and `services/retrieval.rs:303` call `NoteTimeline.current_content(...).read/read_async` directly with hand-built result values. Their channel-controlled interleavings are real and useful for eligibility/invalidation, but they do not invoke the production search/task/Atlas/retrieval functions. A consumer that stops using the capability could leave these tests passing. Architecture checks help enforce routing but do not replace the actual caller/reader interaction.

**Keep the capability race evidence; strengthen caller coverage.** At least one focused integration per distinct consumer delivery path should enter the real production consumer and hold its query before delivery. Use existing boundaries where possible, not a public adapter invented for tests. Consolidate repeated setup only after the surviving capability and consumer cases are explicitly identified. Do not claim these four tests already constitute end-to-end command coverage.

### 4. Consolidate dependency-equality check into real compatibility coverage — maintenance, P3

`semantic/atlas.rs:4586–4598` asserts a struct equals its clone and differs after fields change. It exercises derived equality, not `pointer_is_compatible`; deleting dependency comparison from that production function would not fail this test. `warm_generation_is_served_stale_while_new_epoch_builds` at `:4601` does call the compatibility function.

**Consolidate two tests into one:** move source-set, layout-version, and edge-generation rejection cases into the actual pointer-compatibility test, retaining its epoch/input-hash cases. Remove the equality-only test afterward. Net reduction: **one test**, with stronger coverage.

### 5. Replace task transform's self-derived oracle — maintenance/coverage, P3

`services/task_mutation.rs:330–344` builds the expected result with `toggle_task_in_markdown` / `delete_task_in_markdown`, exactly the helpers to which `transform_task_document` delegates at `:72–80`. This verifies dispatch, but cannot catch a wrong transformed body shared by actual and expected paths.

**Strengthen in place:** supply literal expected Markdown for both toggle and delete, including the untouched second task. Retain dirty duplicate-task rejection (`:387`), non-writing preparation (`:401`), and actual publication failure (`:469`) tests; they protect different boundaries. No test-count reduction is required.

### 6. Remove algorithm-name spelling test — maintenance, P3

`semantic/atlas_labels.rs:1530–1533` only asserts `LABEL_ALGORITHM_VERSION` contains `chunk-keybert`. It cannot prove the algorithm is selected or old cache entries are rejected. This unnecessarily couples harmless version naming to the suite.

**Remove one test.** Surviving coverage: `chunk_keybert_ranks_content_phrases_near_cloud_centroid` (`:1354`), `title_only_chunks_still_produce_keybert_label` (`:1646`), and `label_pointer_requires_current_algorithm_and_model` in `semantic/atlas.rs:4619`. Those call production generation/compatibility behavior.

### Coordination note for the architecture review

`agent_run_coordinator.rs:38–43` is a source-string check on `chat.rs`; it is not a runtime coordinator test. It would miss aliased/wrapped bypasses. The parent review should decide its ownership alongside architecture fitness. Do **not** delete it as an exact duplicate without first preserving its specific routing assertion; none was established within this source-only audit.

## Cleanup size and order

Safe, concrete count: remove one algorithm-spelling test and consolidate the two Atlas compatibility tests into one = **two fewer tests**. Optionally combine the two RSS environment scenarios = **one further reduction**, preserving every assertion. Atlas publication replacement and independent task outputs can keep the same counts. Consumer integration may legitimately increase counts. No bulk test deletion is supported by this audit.

The small duplicated ranking fixtures in `commands.rs:1098`, `:1215`, and `:1295` could share a private candidate constructor if those cases are edited, but their ordering/decay expectations are distinct. Repeated vault setup alone is not a defect: global environment serialization, lifecycle state, and restart boundaries differ across cases. Do not replace them with a configurable generic test framework.

## High-value tests that should remain

- Timeline preparation rejection, committed-warning recovery, exact-intent correlation, missing managed identity, unreadable authoritative Markdown, and live-intent retry races distinguish different durability outcomes. Keep `history_preparation_failure_publishes_nothing`, `finalization_uses_the_exact_prepared_intent_identity`, `canonical_read_failure_keeps_pending_recovery_retryable`, `concurrent_history_reads_after_restart_converge_one_prepared_publication`, and `recovery_retry_waits_for_live_publication_before_and_after_markdown_write` in `services/note_timeline.rs`.
- Keep interrupted purge with reused original path (`:6023`), interrupted clear (`:6083`), failed reset withholding partial replacement (`:7296`), captured Missing retention (`:9662`), duplicate identity (`:8838`), and move/disappearance refresh-order coverage (`:8959`). Shared setup does not make their guarantees interchangeable.
- Keep clean-copy identity/hash continuity (`:6889`) separately from same-installation WAL recovery without SHM (`:7009`) and rejection of unsupported live copies/rollback. ADRs explicitly distinguish these trust states.
- Keep storage migration tests in `history_store.rs`, especially terminal-intent migration with pending replay and foreign-key checks (`:4572`), legacy trust (`:4979`), schema-five compaction transition, and schema-seven retention evidence. Direct SQL/schema assertions are appropriate here. Future edits to older migration fixtures should also verify reconstructed retained content through ordinary reads, not only a probe table.
- Keep `vault_watcher.rs:1059`: it retains observed B while disk advances to C and proves A/B/C survive restart. A normal external-edit test does not establish that.
- Keep forgotten reset/recovery (`commands/forgotten_note_commands.rs:852`) and Missing bounded paging/restart/stale-cursor/recovery (`commands/history_commands.rs:758`). These compose owners and exposed earlier integration defects.
- Keep chat interrupted-message/run reconciliation, durable retry context, proposal commit-intent recovery/conflict/migration, and archived projection lifecycle. The transcript and proposal database has separate durability ownership from Note Timeline.
- Keep both chunk ANN and note ANN last-good generation tests: separate production owners, identities and query shapes exist. Similar test names are not duplication. Keep semantic retry ordering, cross-note batching, and immutable chat-excerpt indexing.
- Keep typed event/command fixtures. They serialize production Rust types against independently stored frontend-shared contracts; they are not merely snapshots of private structs.
- No-assert panic regressions in `agent_tools.rs:1330` and `semantic/embed.rs:1237` intentionally exercise blocking HTTP client lifecycle under the real async runtime. Their successful completion is meaningful evidence.

## Gating/configuration

Cargo has no custom test harness, `test = false`, or default features disabling these tests. No `#[ignore]` was found. The only conditional test function found is Linux RSS (`semantic/debug.rs:356`). `state/config.rs:729` has an iOS-specific branch that a macOS run does not execute. Do not represent desktop green as mobile runtime validation.

`e2e-wdio` enables the native automation plugins and helpers, not a hidden set of ordinary Rust tests. Its native gate is separately documented in `e2e/README.md` and package scripts; default `cargo test` does not execute native UI journeys. `history_store`'s `cfg(test)` fault injectors deliberately replace only failure triggers. No network-provider integration confidence is implied by fake model/embedding providers.

The repository's visible `.github/workflows` contains documentation automation, not the local full regression gate. The documented Phase 1–3 command sequence must therefore actually be run by maintainers/agents; this is a configuration observation, not a request to add CI during this audit.

## Per-file inventory

All rows: names/gating inventoried; representative bodies inspected. Large files explicitly remain sampled as stated above. Counts are source counts, not fresh execution results.

| Rust source (under `src-tauri/src`) | Tests | Purpose / disposition |
|---|---:|---|
| `agent_guardrails.rs` | 3 | Repeated calls, pagination, token-limit termination; keep. |
| `agent_permissions.rs` | 4 | Correlated decisions, denial/cancel, scoped ephemeral grants; keep. |
| `agent_run_coordinator.rs` | 1 | Source-string routing assertion; coordinate with architecture review. |
| `agent_runtime.rs` | 8 | Provider payload policy and real stream driver with fake model/permission broker; keep. |
| `agent_tools.rs` | 3 | Async blocking-client regression, complete paged read coverage, bounded active context; keep. |
| `app/events.rs` | 1 | Production event serde versus shared fixture; keep. |
| `chat.rs` | 50 | Durable runs, messages, context, proposal convergence, projections and settings; sampled; keep durability cases. |
| `commands/atlas_commands.rs` | 1 | Current-content result-type invalidation; strengthen actual consumer integration. |
| `commands/chat_commands.rs` | 5 | Post-commit conversion result, context ranking, model capability policy; keep. |
| `commands/forgotten_note_commands.rs` | 11 | Retention, reset/recovery, non-overwrite, lifecycle failure outcomes; sampled; keep. |
| `commands/history_commands.rs` | 5 | Closed command contract, same-current restore, bounded Missing paging/restart; keep. |
| `commands/note_persistence.rs` | 1 | Actual save returns authoritative path plus post-commit warning; keep. |
| `commands/proposal_commands.rs` | 1 | Prepared proposal publication preserves finalization warning; keep. |
| `commands/search_commands.rs` | 4 | Cache invalidation, current-content delivery, semantic fallback; strengthen consumer integration. |
| `commands/task_commands.rs` | 5 | Task/hidden filters and capability invalidation; strengthen consumer integration. |
| `commands.rs` | 23 | Open/read semantics, relative paths, hybrid ranking/decay, image safety and serde; sampled; keep. |
| `index.rs` | 13 | Markdown/task projection, cold/warm scan policy, background fairness; sampled; keep. |
| `lexical.rs` | 2 | Actual indexed search and deletion; keep. |
| `note.rs` | 10 | Canonical parser/frontmatter/identity metadata and exact restore bytes; sampled; keep. |
| `proposals.rs` | 12 | Non-writing UTF-16 previews, folding, conflicts, exact publication; sampled; keep. |
| `search.rs` | 2 | Search projection and recent excerpt fixture; keep. |
| `secrets.rs` | 2 | Stable credential namespace and unknown-provider rejection; keep. |
| `semantic/activity.rs` | 2 | Manual pause blocking/release and unpaused completion; keep; synchronization can be improved if edited. |
| `semantic/ann.rs` | 7 | Chunk ANN load/delta/rebuild/manifest recovery; sampled; keep. |
| `semantic/ann_core.rs` | 2 | Capacity/tombstone boundary using actual HNSW state; keep. |
| `semantic/atlas.rs` | 28 | Publication/cache validity, topology and cloud geometry; sampled; strengthen publication and consolidate equality test. |
| `semantic/atlas_labels.rs` | 18 | Label selection, exclusions, caching, fallback, batching; sampled; remove version-spelling test only. |
| `semantic/chunking.rs` | 2 | Chunk fixture and deterministic content hash; keep. |
| `semantic/db.rs` | 12 | Stable identities, edge repair, interrupted jobs and streaming reads; sampled; keep. |
| `semantic/debug.rs` | 4 | Metrics/events and RSS environment behavior; synchronize/consolidate shared-key tests. |
| `semantic/embed.rs` | 3 | Async provider-drop regression and local runtime environment defaults; keep. |
| `semantic/indexer.rs` | 19 | Queue merge/retry, generation alignment, chat recall, corpus work and batching; sampled; keep. |
| `semantic/mod.rs` | 4 | Legacy settings, health/retry transitions; keep. |
| `semantic/note_ann.rs` | 7 | Note ANN query/generation/identity recovery; sampled; keep independently of chunk ANN. |
| `semantic/related.rs` | 4 | Query bounds and authoritative full-file hash; keep. |
| `services/note_catalog.rs` | 4 | Projection policy, duplicate identity, late older work versus newer update/remove; keep. |
| `services/note_timeline/history_store.rs` | 8 | Lossless codec, corrupt payloads, storage budgets and legacy/schema migration; sampled; keep. |
| `services/note_timeline/post_publication.rs` | 5 | One publication/projection outcome and warning classification; sampled; call order meaningful for mutation contract. |
| `services/note_timeline.rs` | 97 | Full Phase 1–3 durability/identity/lifecycle/history seam; sampled; keep distinct fault/recovery cases. |
| `services/retrieval.rs` | 2 | Date policy and capability eligibility/invalidation; strengthen actual consumer integration. |
| `services/task_mutation.rs` | 11 | Dirty preparation, identity, exact write/warning behavior; sampled; replace helper-derived oracle. |
| `state/config.rs` | 8 | Vault location/scaffold/manifest and platform path policy; sampled; keep. |
| `state/task_projection.rs` | 4 | Stable task IDs, completion times, soft deletion and recents; keep. |
| `state.rs` | 15 | Atomic creation, concurrent filenames, cold/warm persisted state and activity decay; sampled; keep. |
| `test_support.rs` | 1 | Shared fixture membership plus real SemanticSettings serde; keep serializer check; membership is only an inventory check. |
| `vault_watcher.rs` | 14 | Event/path filters, exact self-save suppression, observation recovery; sampled; keep. |
