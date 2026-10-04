# UI, Settings, search, and semantic indexing audit

Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b` (current tree, not a change-only review).
Status: audit complete for the inspected/sampled scope below; no production/test edits made by this audit agent.
Standards: repository `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `docs/architecture/behavior-invariants.md`, issue tracker/triage instructions, code-review and codebase-design skills. This is a maintenance audit against documented outcomes, not verification of one historical issue specification.

The largest opportunities are to strengthen a few weak seams while deleting setup duplication. Raw test count is not evidence that tests are redundant. Chat event correlation, ANN persistence recovery, canonical search freshness, and Settings next-launch vault selection tests protect distinct failure modes and should remain.

## Findings grouped by module

### Search preview and coordinate contracts

#### UIX-01 — P1: Unicode case expansion can panic Rust search; the golden test omits the affected contract

Confidence: confirmed by a standalone reproduction using the unchanged production helper bodies. Axis: correctness/spec. Cleanup risk: medium because coordinates cross Rust/JS and must remain compatible.

- `src-tauri/src/search.rs:250` lowercases original text and obtains byte offsets in that transformed string.
- `src-tauri/src/search.rs:270` passes those offsets to `excerpt_around` over the original string.
- `src-tauri/src/search.rs:331` slices original UTF-8 at that offset. Lowercasing can change byte counts.
- `src-tauri/src/search.rs:374` uses one ASCII fixture; its JSON comparison at lines 392–399 omits both `highlight_ranges` and line coordinates. The only other local test checks a recent-result excerpt.

Reproduction: text `format!("İé{}", "x".repeat(200))`, query `é`. Lowercase match byte offset is 3; byte 3 is inside original `é` (bytes 2–4). Calling the verbatim `excerpt_around` helper panics. Extracted helper repro was written outside the repository to `/tmp/gneauxghts-search-unicode-audit.rs`, compiled with `rustc`, and exited 101 with that exact panic. No application files or test files were modified.

Recommendation: centralize folded-text-to-original coordinate mapping for preview construction. Add a small table at the public `build_search_preview`/`search_note` boundary covering ASCII, case expansion, combining marks, astral characters, long excerpts, whitespace trimming, and multiple merged matches. Verify the displayed substring/highlight coordinate contract, not only file/title text. Establish explicitly whether IPC highlight offsets are Unicode scalar or UTF-16 positions before generalizing the fix. Retain the current fixture as a smoke contract or fold its assertions into this matrix; do not add another large fixture corpus for this defect.

### Chat controller, rendering, and test doubles

#### UIX-02 — P2: Listener initialization needs failure/race coverage; its fake cannot represent duplicate subscriptions

Confidence: high from complete control-flow inspection. Axis: correctness and design. Cleanup risk: medium.

- `src/lib/features/chat/controller.svelte.ts:707` sets `#listenersReady = true` before awaiting registration of eleven listeners. A concurrent `initialize()` therefore treats partially attached listeners as ready.
- At lines 716–718 a failed registration only clears the boolean and rethrows; already registered listeners remain in `#unlisteners`. Retrying initialization attaches those channels again. A text delta can then append twice until disposal.
- `src/lib/features/chat/controller.test.ts:105` stores just one callback per event in a `Map`; registration at line 154 overwrites the previous callback. The fake structurally hides duplicate listener registration.
- The existing disposal test at line 683 checks only the all-success path. The reducer's initialization/disposal tests do not exercise asynchronous listener acquisition.

Recommendation: make registration one joinable in-flight operation, stage acquired unlisteners, and clean up partial acquisition on failure/disposal before retry. Replace the fake event map with a multi-subscriber event bus plus configurable deferred/rejected subscriptions. Preserve existing event-correlation tests, then add sequences: second registration fails → retry → one delivered delta; initialize concurrently while subscription is delayed; dispose while a subscription is in flight. This fixes actual ownership behavior rather than adding more reducer-only cases.

#### UIX-03 — P2: Chat controller test setup duplicates broad contracts and bypasses type checking

Confidence: high. Axis: design heuristic (duplicated fixture construction), not a hard standard violation. Cleanup risk: low for fixture consolidation; high for controller rewrite.

`controller.test.ts:13–160` creates full Settings, Message, Conversation, Proposal, forgotten-chat and ChatApi fixtures before any case, then casts the API `as unknown as ChatApi`. It omits some interface operations while claiming the entire interface. Similar full message/state construction appears in `ChatMessage.svelte.test.ts:6`, `ChatPanel.svelte.test.ts:23`, `agentEvents.test.ts`, and `api.test.ts`. This raises the cost of every additive event/DTO field and masks fixture incompleteness.

The production controller has 1,660 lines and owns subscription lifetime, initialization, selection, streaming settlement, draft configuration, permissions, proposals, excerpts and policy changes. Its 30+ method public interface makes one all-purpose fake attractive. The public seam already supports dependency injection, which is worth keeping.

Recommendation: introduce narrow typed domain builders and a typed event/API harness used by behavioral controller tests. Explicitly default unsupported fake methods to a failure, not silent success. Group tests into lifecycle/selection, stream correlation, configuration/access and proposal/excerpt modules without changing the external controller interface first. Only split production internals where responsibilities change independently; keep one request/selection owner. A wholesale controller rewrite is not justified merely by its line count.

#### UIX-04 — P3: SSR tests contain one vacuous privacy assertion and a few class-name checks; preserve the meaningful escaping cases

Confidence: confirmed. Axis: test value. Cleanup risk: low.

- `ChatMessage.svelte.test.ts:98` asserts absence of `private reasoning payload` but never puts that sentinel in the input. It cannot catch accidental exposure of a supplied private field.
- `ChatPanel.svelte.test.ts:60` checks the literal Tailwind class sequence `min-w-0 w-full max-w-full`; class reordering can fail without a behavior regression.
- `ChatPanel.svelte.test.ts` and `model-selector.svelte.test.ts` use server rendering, so they verify initial markup only, not callback wiring, interaction, or mount cleanup. They should be named/documented accordingly.

Recommendation: remove the vacuous assertion, or inject an actual forbidden/raw field at the adapter boundary and verify it is excluded before rendering. Keep safe Markdown/evidence tests: `chatMarkdown.test.ts` injects actual script/image/javascript-link inputs and `EvidenceSource.svelte.test.ts:18` supplies malicious-looking source text, so their escaping assertions are substantive. Replace layout class checks with existing browser/layout coverage where available; root audit owns that cross-check. Add a minimal mounted interaction test for any uncovered provider selection/permission/send callback rather than duplicating every SSR state in a browser suite.

### Settings store and app snapshot seam

#### UIX-05 — P2: Settings tests reimplement shared snapshot admission instead of exercising the real owner

Confidence: confirmed. Axis: test design/ownership. Cleanup risk: medium.

`src/lib/features/settings/store.test.ts:20–54` implements its own revision counters and `admitSnapshot` algorithm in an `any` mock. The delayed Settings snapshot test at line 570 therefore tests that replica together with the consumer. Changes to the real AppStore admission behavior can leave this test green. AppStore has its own behavioral suite; duplicating its policy in another fake is not an additional integration guarantee.

Recommendation: run a few composition tests using real `createAppStore` (or the existing instance with isolated dependencies) plus a transport/event fake; retain cheap isolated Settings action tests with a shallow capability fake. Assert public snapshots and stale-result rejection at the owner seam. Remove the duplicated admission algorithm once the composition test covers it. A shared fake that copies the same implementation would retain the problem.

#### UIX-06 — P2: Local Settings async state lacks the generations/lifecycle checks already used for vault snapshots

Confidence: high from source; scenarios not run in this audit. Axis: correctness/design. Cleanup risk: medium; do not change Running Vault ownership.

- `store.svelte.ts:319–344` correlates shared vault/status snapshots, but always adopts `semanticSettings`, `semanticDebug` and `historyHealth` from a delayed bundled response.
- `loadHistoryHealth` at line 376 and history retry/reset/clear paths can overwrite one another's outcomes without request or operation correlation.
- `initialize` at line 717 awaits bootstrap before acquiring listeners. `dispose` at line 745 does not invalidate the pending initialization; a Settings page left during bootstrap can attach subscriptions after disposal and start future refresh work. A delayed `loadSemanticState` can also call `#syncSemanticPolling` after disposal.
- `saveSettings` at line 549 and `updateSetting` at line 565 fire saves without ordering/generation admission, unlike `saveVaultDirectory` at line 659. Delayed settings responses can replace newer edits or an in-flight bundled read can restore old settings.
- `store.test.ts` tests stale missing-note page results and vault Apply responses, but has no initialization/disposal, overlapping semantic saves, or history refresh/action race sequence.

Recommendation: explicitly own one Settings view lifetime and per-slice revision/admission for locally owned async state. Keep shared vault/status exclusively in AppStore. Add deferred-promise tests that dispose during bootstrap, resolve old Settings view after a history action, and reverse two setting responses. Existing action tests remain valuable; replace success-only duplication with these boundary sequences. Do not reuse a single global loading flag as a substitute for identities.

#### UIX-07 — P3: Tiny Settings loaders/refresh adapter add navigation without hiding policy

Confidence: high; design judgment. Cleanup risk: low if command ownership and error normalization remain intact.

`loaders/semanticLoader.ts` is a five-line wrapper around `invoke('retry_semantic_index')`. Store's `runAction` then special-cases that one command at line 585 while invoking peers directly. `refreshCoordinator.ts` contains a switch/Promise.all over callbacks supplied only by SettingsStore, while its tests mirror which callback was selected. Other loaders legitimately group history error translation and command payloads.

Recommendation: consolidate Settings transport calls into one typed local API, or inline only the one-off retry adapter and private refresh selection. Prefer an actual SettingsStore visible/hidden refresh test over independently mocking a four-callback router. Do not remove `invokeHistoryCommand`: it implements stable recovery/error redaction policy and earns its seam.

### Semantic work scheduling, ANN, and Atlas

#### UIX-08 — P2: Retry correctness tests spend real backoff time; make scheduling observable and interruptible

Confidence: confirmed from call path; no runtime speed claim made. Axis: test efficiency and design. Cleanup risk: medium.

`semantic/indexer.rs:2324` calls `process_pending_jobs` with a provider that always fails. Production loop sleeps at line 959; retry backoff is 100/200/400ms bounded at lines 978–986. That correctness test therefore waits for actual retry delays. Snapshot publication independently sleeps two seconds at line 629, and Atlas retries sleep at line 962. These sleeps also delay queue barriers and restart settlement while worker work is sleeping.

Recommendation: make the worker choose a next deadline and yield to the queue/condition variable, with a private clock/wait seam. Assert retry counts, pending work and bounded delay decisions under virtual time; keep one real synchronization test for wake/shutdown behavior. Retain the merge-retry matrix at lines 2395–2533: update/delete/move/rebuild order cases protect distinct semantics, not redundant happy paths. A rewrite of the 580-line `process_pending_jobs` into explicit job selection/execution/outcome scheduling phases is justified if it enables cancellation and deterministic tests; keep all state ownership within `SemanticWorkQueue`/worker context.

#### UIX-09 — P3: 20,000-row regression fixture does not actually prove that no full-corpus walk occurred

Confidence: confirmed assertion gap; wall-time impact unmeasured. Axis: test efficiency/value. Cleanup risk: low with replacement observability.

`semantic/indexer.rs:2856–2941` seeds 200 notes × 100 chunks through production SQLite upserts for a test named `remembering_one_excerpt_does_not_rebuild_or_walk_a_twenty_thousand_chunk_corpus`. It asserts input scanned/embedded counts, final SQL row count, and ANN/edge rebuild counters. An added SQL full-table read which increments none of those counters would still pass. The test establishes no rebuild and correct single-item accounting, not no walk.

Recommendation: keep a small ordinary correctness fixture and add explicit rows-visited/query work instrumentation for the relevant inventory/embedding loader. Move the 20k distribution into a named opt-in scaling benchmark/evaluation, or keep it only if root timing demonstrates low cost and its measurement actually guards scale. Do not just reduce corpus size while continuing to claim a no-walk guarantee.

#### UIX-10 — P3: ANN and semantic tests duplicate disposable setup, but the two ANN adapter suites are not wholesale duplicates

Confidence: high. Axis: design heuristic. Cleanup risk: low for setup; medium for shared contract extraction.

`ann.rs:790`, `note_ann.rs:770`, `atlas_labels.rs:1355`, `db.rs:2624`, and `indexer.rs:2577` repeat temp directory, database schema, embedding-provider and seeded-note setup. Several modules define their own `TestDir` despite `src-tauri/src/test_support.rs:20`. Atlas uses a raw `test_dir` helper at `atlas.rs:4510` and explicit end-of-test deletion, so failing assertions leave artifacts.

However `ann_core.rs` already shares graph/vector lifecycle machinery, while chunk ANN and note ANN adapters intentionally have different manifests, identity validation and loaders. Their persisted load, delta recovery and last-good-generation tests exercise those adapters independently. Do not delete these as name-level duplicates.

Recommendation: one semantic test fixture builder, RAII temp storage and reusable deterministic embedding provider; preserve adapter behavior tests. Extract a shared lifecycle contract only if both adapters can satisfy a small test-only interface without production-generalization scaffolding. Test shared atomic write/path rejection/tombstone boundaries at `ann_core` once, with one adapter integration scenario apiece. No wholesale merge of chunk/note ANN is recommended.

#### UIX-11 — P2: Environment-mutating embedding tests are not isolated despite comments claiming serial safety

Confidence: confirmed. Axis: test reliability. Cleanup risk: low.

`semantic/embed.rs:1282–1332` mutates `GNEAUXGHTS_LLAMA_CTX_SIZE`; the comment claims a single serial test, but there is no shared lock or serial annotation. Restoration occurs only after assertions. The adjacent thread/parallel test at line 1336 has the same manual restore shape. `semantic/debug.rs:303` does use RAII restoration for RSS env, but not the repo lock. Other tests can construct providers or sample debug metrics concurrently; grouping cases into one function does not serialize process-global reads.

Recommendation: pull pure parsing/default calculations behind functions accepting optional strings and test those directly. Keep at most one environment adapter smoke test under a shared environment guard with panic-safe restoration. This removes incidental environment coupling without serializing the entire suite. Existing AppState fixture checks in this scope: index tests use `IndexTestFixture` with temp app/vault roots and guard at `index.rs:1800`; command vault-selection tests initialize disposable paths and use the guard at `commands.rs:900`; search command integration fixtures similarly use the guard at `search_commands.rs:1535` and `1663`; lifecycle helper resolves disposable RunningVault and callers lock. No additional unguarded AppState constructor found in this inspected scope. Global restoration/join discipline remains a root audit concern.

### Assets, runtime installer and small boundaries

#### UIX-12 — P2: Asset collision coverage tests path selection, not concurrent publication

Confidence: confirmed check-then-write shape, medium for a reachable application race; concurrent command execution has not been established. Axis: correctness/test coverage review candidate. Cleanup risk: medium.

`commands/asset_commands.rs:51–53` selects a currently unused path, then performs `fs::write`. `path_utils.rs:49` uses existence checks. `commands.rs:1740` tests collisions by pre-creating an existing filename, but never runs two same-name saves simultaneously. Concurrent paste operations can select the same free path and overwrite an asset referenced by the other operation.

Recommendation: verify whether the installed Tauri command dispatcher serializes these synchronous writes before treating this as a reachable regression. If concurrent callers are admitted, have the asset persistence boundary atomically reserve with create-new and retry on collision, returning the actual reserved name. Test two simultaneous writes with distinct bytes and identical names plus failed-publication cleanup. Keep existing traversal and symlink rejection tests at `commands.rs:1760–1792`; they protect meaningful containment behavior. Move asset tests alongside `asset_commands` when touching the module so search/routing test changes no longer share a 1,000-line commands test block. Do not create a generic cross-app filesystem framework for this fix.

#### UIX-13 — P3: Runtime setup needs cheap local failure/success coverage around the publication seam

Confidence: high. Axis: coverage/design. Cleanup risk: low to medium.

`semantic/runtime_install.rs:250` tests checksum failure; line 264 tests missing binary; line 303 has the only successful install/start test, ignored and requiring an official external archive. The installer also verifies executability/shared-library loading, replaces destinations and publishes via rename at lines 118–153. `verify_binary` at line 212 uses unbounded `Command::output`.

Recommendation: keep the ignored official-archive smoke test as the real distribution check, and add tiny local archive/verification-seam tests for successful publication/discovery, verification failure, size/reader interruption and staging cleanup. Bound child verification and test timeout cleanup if implementing that change; no network downloads should enter the default suite. Artifact platform/digest-length tests check configuration shape only and must not be presented as checksum authenticity verification.

### Atlas async lifetime and search

#### UIX-14 — P2: Atlas tests protect refresh staleness but miss equivalent initialization/search lifetimes

Confidence: high from full lifecycle inspection. Axis: correctness/test gap. Cleanup risk: medium.

`atlasStore.svelte.ts:223` awaits persisted visibility and AppStore bootstrap before registering subscriptions at line 238; neither await is followed by a lifetime check. `dispose` at line 280 clears existing subscriptions but cannot prevent a still-pending initializer from adding them afterward. This mirrors the Settings lifetime gap (UIX-06). Reinitialization can then accumulate leaked subscriptions. Tests at `atlasStore.test.ts:350` and `363` defer persisted visibility but never dispose before it resolves.

`runSearch` at line 463 correlates a result with search sequence and query, but not `chatVisibility` or store lifetime. `#applyChatVisibility` at line 506 invalidates refresh sequence only. A delayed search under the old visibility can repopulate cleared search results before the next search starts. `dispose` also leaves search sequence untouched, so in-flight search completes into the retired singleton. Existing stale visibility test at line 383 covers the Atlas response loader, not the separately invoked search command.

Recommendation: add lifetime generation checks after initializer awaits and invalidate the search operation on dispose/visibility/cache replacement. Inject the search loader alongside the existing Atlas and visibility dependencies, then extend the current fake-timer/deferred harness with dispose-during-initialize and old-visibility search-result cases. Keep the existing polling/refresh tests; their semantics are valuable. Apply a consistent ownership pattern in Settings and Atlas, but do not create a generic async-state framework merely to share a counter.

## Architectural directions and order

1. Fix clear boundary defects with targeted regression sequences: Unicode preview, listener lifecycle, Settings/Atlas lifetime and slice admission. Investigate asset publication concurrency before deciding on its fix. Preserve established ownership and Running Vault semantics.
2. Consolidate typed fixtures; replace fake policy implementations with real-owner composition coverage. This can remove boilerplate without deleting valuable behavioral cases.
3. Move semantic scheduling to deadline-driven wakeups if pursuing the larger rewrite. This improves restart responsiveness and test determinism together. Preserve work coalescing, retry merge, last-good generation and canonical freshness invariants.
4. Consider splitting Atlas internals by persisted generation publication, search ranking, cloud/layout calculations and label computation. `atlas.rs` is 5,531 lines; source and tests are navigationally costly, but large size alone does not justify a new public abstraction or changed geometry behavior. Keep one private Atlas publication owner. Frontend Atlas store already has good deferred-result and fake-time polling cases; expand their missing lifetime scenarios instead of broad replacement.

Do not collapse lexical current-content search, semantic candidate discovery, Atlas ranking and evidence search into one universal search abstraction: they have different freshness, permission and display contracts. Shared coordinate conversion, fixture setup and serialization primitives are narrower opportunities.

## Coverage ledger and limits

The root inventory at `../measurements/inventory.json` is the complete static file/case count. This report does not claim line-by-line review of every file in the broad assignment. Inspection classes below are explicit so follow-up work can be delegated without assuming uninspected code is clean.

| Area | Inspection depth | Evidence retained / next work |
| --- | --- | --- |
| Search previews `search.rs`, assets `asset_commands.rs`, `path_utils.rs` | Full relevant implementation and all direct tests | Unicode repro, containment/collision review |
| Settings store/loaders/coordinator, store tests, semantic status/component tests | Full store and tests; component markup sampled | Race ownership, mock-policy duplication, shallow wrappers |
| Chat controller | Full interface, lifecycle, event and async configuration paths; proposal/excerpt branches sampled | Listener defect, fixture weakness; preserve durable event ordering |
| Chat tests | Controller/API test inventory; setup and lifecycle/configuration paths inspected; rendering/Markdown/evidence/scroll/date tests inspected | API translation is legitimate seam coverage, not automatically duplicate with controller tests |
| AppStore/restart | Architecture/docs read; AppStore interactions and tests inventoried, lifecycle backend fixtures sampled | Root owns deeper app/bootstrap/restart composition review |
| Atlas frontend | Full store-test file and helper/public lifecycle paths; map route sampled | Good fake timer/deferred tests; no renderer behavior claim |
| Shared UI/helpers | Search matcher, keyboard shortcuts, text sizes, app settings, citation/model selector tests inspected; list/navigation/modifier tests inventoried | No performance concern established for tiny pure functions |
| Semantic ANN/core/note ANN | Shared core full; persistence/recovery adapter code and all direct test scenarios inspected | Preserve differing adapter invariants; consolidate fixtures |
| Semantic indexer | Worker scheduling/retry, metadata and single-note indexing paths inspected; all test names and majority of tests inspected | Real waits, scale-test observation gap, merge sequences worth keeping |
| Semantic Atlas/labels | Full test inventory, publication/search/tag/cache/label-fixture paths sampled | Large module split is a design review candidate; no geometry rewrite validated |
| Semantic DB | Schema/seeding/persistence interface and all test inventory; edge repair/generation tests sampled | Shared setup candidate, not a proven data-integrity defect |
| Embedding/runtime installer | Runtime installer full; embed initialization/timeout/config code and all tests inspected | Local verification coverage gap, env test isolation |
| Lexical/index | Public path and direct tests inspected, canonical/index ownership delegated to root/other agents | Preserve pending-replacement search test; index fixture isolated |
| Commands/lib/startup/secrets | Registration and test inventory; vault-selection/bootstrap/search/asset targets and fixture boundaries sampled | Not full platform startup/keychain review |
| Source-text pseudo-tests | Searched all chat/settings/atlas tests for `readFileSync` | Only Settings semantic component reads JSON contract fixture (valid data fixture); root owns architecture source-scans |

Validation: static code/test audit plus one compiled standalone Rust Unicode reproduction. No full Rust/frontend/browser suite run by this agent, no live embedding download/provider call, and no measured speedup claim. Documented improvement proposals requiring runtime experiments remain proposals, not established performance defects.
