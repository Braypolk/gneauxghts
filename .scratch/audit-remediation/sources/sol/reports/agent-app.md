# Agent, chat, retrieval, semantic search, Atlas, settings and app audit

Status: needs-triage
Date: 2026-10-02 (America/Denver)
Scope owner: backend_agent

This report was written before any production or test edits. It records an audit of the existing code, not validation of a proposed patch. No builds, full suites, live inference, package installs, or provider calls were run by this audit worker. The root audit owns baseline execution and fitness/contract consolidation.

## Scope and evidence limits

The assigned inventory is 42 Rust files, 42,130 lines and 277 `#[test]`/`#[tokio::test]` attributes, plus 32 frontend test files containing 5,402 lines. Counts are textual inventory, not runtime test counts (table tests and platform gates differ). [The file and test-name inventory](agent-app-inventory.md) records every discovered scoped Rust test and frontend test declaration, production target and review depth.

Reviewed domain constraints: `CONTEXT.md`, `ARCHITECTURE.md`, `docs/architecture/behavior-invariants.md`, ADRs 0001, 0003 and 0009, and the historical current-evidence integration report. Recommendations preserve Running Vault ownership, startup/restart admission, app-owned runtime/events/permissions, bounded evidence delivery, currentness revalidation, no historical assistant prose as fresh evidence, retained-change labels, and reviewed write authority. Proposal ownership and Note Timeline storage are assigned to other workers; references here establish callers, not a competing redesign.

Detailed review covers the failure paths below and their tests, controller/event reduction, evidence discovery/read/admission and worker isolation, semantic scheduling/ANN publication tests, chat startup/recovery/projection tests, settings snapshot admission and SSR UI coverage. Very large layout, DB and runtime implementations received test-name/interface surveys plus selected test-body/caller tracing. This is not a claim that all 42,130 Rust lines or every numerical algorithm branch were exhaustively verified. Unlisted lower-risk tests are inventory/interface-reviewed, not certified defect-free. Native/browser integration cases were searched for overlap; their harness ownership remains with the root audit.

## Prioritized module groups

| Group | Findings | Priority | Recommended order |
| --- | --- | --- | --- |
| Chat controller and event transport | AA-01, AA-02 | P1 | Fix concrete admission failures before restructuring |
| Atlas frontend lifecycle and search | AA-03, AA-04 | P1/P2 | Add missing deferred-order scenarios, repair lifecycle ownership |
| Interactive retrieval and evidence | AA-05, AA-09, AA-10 | P2 | Repair note-level adapter; then cover hybrid and profile repeated reads |
| Semantic/agent test execution | AA-06, AA-07 | P2 | Remove fixed waits and process-env mutation hazards |
| App/settings test fidelity | AA-08 | P2 | Exercise real shared snapshot owner in a narrow integration harness |
| Runtime/evaluation/test organization | AA-11, AA-12 | P2 | Retire stale experimental protocol; split modules at existing seams |
| Rendering and product catalog | AA-13, AA-14 | P2/P3 | Strengthen action wiring coverage; consolidate duplicated catalog policy |

## Chat controller and event transport

### AA-01 — P1: A delayed send receipt can erase observed assistant output and restore an already completed request

**Evidence.** `src/lib/features/chat/controller.svelte.ts:1108–1138` dispatches `accepted` but ignores whether the transition was admitted, then sets `activeRequestId` and replaces the assistant using ordinary `upsertMessage`. `upsertMessage` at line 158 replaces the entire existing message. The API manufactures an optimistic empty/streaming assistant from the receipt rather than loading its latest durable state (`src/lib/features/chat/api.ts:454–492`, `sendMessage`). Backend `chat.rs:2161–2164` starts `run_request` before returning the accepted receipt; `chat.rs:2180` emits `chat://started`, so frontend event and receipt ordering is not guaranteed. The request machine deliberately rejects an accepted event after terminal (`machines/controllerMachine.ts:235–268`), but the controller writes anyway.

**Scenario.** Hold `sendMessage`'s promise. Emit started → text delta → source/agent event → completed for the returned request. Resolve the promise with the empty optimistic assistant. The completed message is replaced, its evidence/runtime fields are lost, and `conversation.activeRequestId` becomes non-null while the machine remains idle. A started/delta-only interleaving can also drop partial output.

**Test weakness.** `controller.test.ts:577–597` resolves the send receipt before observing events; `:598–669` exercises stale stream/terminal events separately. Pure machine tests cannot detect the unconditional controller write.

**Recommendation.** Merge the receipt as missing user/assistant identity data, never as authority to overwrite a message already advanced by events. Preserve observed content, parts, citations and terminal status; update active request only when the correlated machine still owns that request. Keep this policy inside the controller's one message-admission path.

**Migration/validation.** Add deterministic deferred-receipt cases for started/delta-before-receipt and terminal-before-receipt, including evidence parts and callbacks; then change admission. Run controller, reducer, machine and API suites together. Avoid a broad runtime rewrite for this defect.

**Confidence:** high, traced production race; not executed in this worker.

### AA-02 — P1: Chat listener initialization treats in-progress subscription as ready and leaves partial listeners behind

**Evidence.** `controller.svelte.ts:707–720` sets `#listenersReady = true` before awaiting eleven sequential subscriptions. If subscription N rejects, previous off-functions remain registered and readiness is reset. Retry registers those earlier events again. A second `initialize` concurrently returns immediately from `#ensureListeners`, potentially admits settings/conversation before subscriptions finish. The controller's sequence protects initialization results, not subscription completeness.

**Test weakness.** `controller.test.ts:108–170` represents listeners using `Map<event, handler>`: `handlers.set` overwrites earlier handlers and `off` deletes the shared event entry. This fake cannot represent multiple subscriptions, so it would hide the duplication and misrepresent independent cleanup. The only listener assertions are the happy-path count at `:195` and dispose at `:683–689`.

**Recommendation.** Track an in-flight listener promise separately from successfully admitted listeners. Keep pending subscriptions local to that attempt, clean all admitted ones on failure, and make overlapping callers await the same attempt. Use event → set-of-subscriptions in the fake, with per-subscription removal. `appStore.svelte.ts:250–298` already shows bounded aggregate listener admission/cleanup; reuse the pattern, not a second global state owner.

**Migration/validation.** First improve the fake. Add failure-at-middle-then-retry, overlapping initialization, dispose-while-subscription-pending, and late failure cases. Assert each emitted text delta applies once and every acquired listener is released once.

**Confidence:** high, concrete code/fake mismatch.

## Atlas frontend lifecycle and search

### AA-03 — P1/P2: Atlas search admission ignores visibility and lifetime changes

**Evidence.** `atlasStore.svelte.ts:462–486` checks only the search sequence and query. `:502–516` clears results and changes chat visibility without advancing `#searchSequence`; `:280–296` disposal and `:320–329` cache invalidation likewise advance refresh sequence only. A delayed same-query search for `all` can repopulate results after the user selects `hidden`, or after dispose. A late rejection writes `searchError` even after the query has changed because catch validates only sequence. `runSearch` has no disposed guard.

**Test weakness.** `atlasStore.test.ts:383–413` validates obsolete visibility **refresh** responses, not searches. The suite injects the Atlas loader and visibility persistence but leaves search on a hardcoded Tauri invoke; no search-race cases exist.

**Recommendation.** Give search an injected loader and capture `{generation, visibility, query}`. Invalidate its admission token immediately on visibility changes, cache invalidation, disposal and new query (including clear), and validate error/finally mutations against the same identity. Preserve published Atlas geometry and stale-while-revalidate behavior.

**Migration/validation.** Deferred same-query searches across all→hidden, dispose/reopen, invalidate, query-change-and-error, and clear-query. Assert no obsolete matches/errors/busy state are admitted. Retain existing refresh/polling tests.

**Confidence:** high for stale admission; user-visible severity depends on when the next search arrives, hence P1/P2.

### AA-04 — P2: Pending Atlas initialization can subscribe after disposal or attach duplicate listeners on reentry

**Evidence.** `atlasStore.svelte.ts:222–238` awaits persisted visibility and app bootstrap, then unconditionally pushes listeners. Dispose clears the current list (`:280–296`) but there is no generation check after either await; resolving the pending load afterwards attaches listeners to the disposed owner. Calling initialize twice also attaches a second subscription set; `#initialized` does not gate duplicate initialization. Callers include the map route's mounted lifecycle.

**Test weakness.** Tests cover persisted-visibility versus local selection (`atlasStore.test.ts:363`) but none cover initialization versus dispose/reentry. AppStore tests already exercise exactly this lifetime boundary (`appStore.svelte.test.ts:42–73`), making the missing Atlas case conspicuous.

**Recommendation.** Use one initialization generation and in-flight promise, check generation after awaits, and invalidate it on dispose. Keep reentry legal because the route reuses the store. Ensure queued-refresh flags and `isLoading` cannot leak from a retired generation into the next one.

**Migration/validation.** Defer visibility/bootstrap, dispose, resolve, assert zero live subscriptions and no new requests; then initialize again and assert one subscription set. Add overlap case. Do not change app-wide bootstrap ownership.

**Confidence:** high for subscriptions; reentry loading-state interactions require the specified regression.

## Interactive retrieval and evidence

### AA-05 — P2: The note picker adapter exposes passage multiplicity as duplicate notes and lacks a production-path test

**Evidence.** `services/retrieval.rs:114–162` requests one evidence page limited by passages and maps every item directly to `VaultRetrievalItem`, without collapsing Note Identity or following continuation. `commands/chat_commands.rs:716–737` turns each into a note-only `ChatNoteCandidate`. `settings/excludedNotes.ts:availableExclusionCandidates` only removes excluded IDs, so duplicate rows survive into the exclusion picker. More than one disjoint matching passage in a long note can consume the page and crowd out other notes. Suggestion aggregation at `chat_commands.rs:807` deduplicates later, but the picker path does not.

**Test weakness.** `retrieval.rs:200–269` calls `NoteTimeline.current_content(...).read` with hand-built items; it never calls `retrieve_vault_notes`. It therefore tests the timeline gate, not the adapter whose name suggests a distinct-note result. Evidence fixtures accumulate found IDs in a HashSet, also hiding multiplicity (`evidence/tests.rs:47–83`).

**Recommendation.** Decide and document the interactive note-level contract. Collapse by stable Note Identity before applying the returned-note limit, consume bounded continuation as needed, and choose one deterministic representative passage. Keep the agent's passage-level evidence API unchanged. Fields always set to None (`retrieval.rs:155–159`) should be removed from this adapter's contract or explicitly justified by callers, rather than perpetuating obsolete positional/scoring promises.

**Migration/validation.** Add a real adapter fixture with one note containing many disjoint matches, another matching note, exclusions, date filters, and request limit 2. Assert unique IDs and both eligible notes. Exercise picker response through the command seam. Preserve current-access and clear invalidation tests in the owning timeline module; do not remove their behavior without coverage mapping.

**Confidence:** high for duplication shape, expected note-level contract inferred from picker caller.

### AA-09 — P2: Evidence search repeats canonical reads, parsing and hashing per passage; freshness checks must be preserved in any optimization

**Evidence.** `evidence.rs:765–800` reads/parses canonical Markdown for every lexical result, while `make_candidate_at` (`:1278–1314`) reads/parses/hashes that same note again per slice. Literal search reads once at `:689`, then the same constructor rereads per match (`:721`). Final candidates are individually validated at `:922`, and validation itself performs two reads (`:1378`, `:1430`) plus timeline checks. `is_current` (`:1164–1201`) reuses scope fingerprints within one pass, but admitted citations still validate separately; a large note with many passages multiplies file IO under each request boundary. The lexical read at `:766` also executes filesystem IO while holding the shared notes-index mutex.

**Test weakness.** Current tests verify identity/budgets, not IO counts or index-lock hold time. Dense byte sweeps (`evidence/tests.rs:421–457`, `:505–581`) multiply those operations; do not remove their boundary coverage just because they are long.

**Recommendation.** Introduce a request-local canonical-note snapshot containing exact bytes, parsed locations and hash, keyed by Note Identity; build candidates from it after releasing the index lock. Reuse only within a preparation/validation operation. Continue a fresh recheck at model/final/cursor admission; validate every retained proof and charge repeated payload delivery. A persistent/global memoization would contradict currentness invariants.

**Migration/validation.** First instrument note-read/hash counts on multiple passages from one note, compare with distinct-note cases, and profile baseline. Retain concurrent edit, exclusion, clear-history, duplicate occurrence and Unicode tests. Add a controlled edit between preparation and admission to prove reuse cannot authorize stale evidence. Only then replace redundant within-operation work.

**Confidence:** high repeated work; performance impact unmeasured here. Larger redesign, not a first-pass deletion.

### AA-10 — P2: The evidence fixture suite predominantly exercises lexical/disabled-semantic paths and does not validate hybrid composition

**Evidence.** `evidence/tests.rs:10–15`, `:405–414`, `:466–475` construct disabled SemanticState. The rank-fusion test at `:180–189` only checks `reciprocal_rank(5) * 2 > reciprocal_rank(0)`; it does not execute merging of lexical/semantic candidates, overlapping passages, widening or partial failure. Hybrid branch `evidence.rs:803–886` inspects model/ANN availability, widens candidate width 64→256→1024→4096, filters IDs and merges overlapping results. Pure ANN/DB/indexer tests elsewhere do not exercise this composition.

**Recommendation.** Retain one real disk/timeline evidence fixture for canonical freshness, but add deterministic hybrid integration at the retrieval seam with a controlled embedding/ANN adapter (the existing semantic tests already have mock EmbeddingProviders). Cover lexical+semantic agreement, semantic-only match, excluded nearest neighbors requiring widening, stale semantic content, provider failure with lexical fallback, and bounded coverage gaps. No live model is needed for this logic.

**Migration/validation.** Establish the smallest internal seam that accepts retrieval results/availability without exposing another state owner. Run hybrid composition plus existing canonical/currentness tests; compare admitted exact ranges and coverage, not model prose. Do not convert all disk tests to mocks or claim live answer quality from deterministic fixtures.

**Confidence:** high coverage gap within reviewed evidence tests; full native semantic retrieval acceptance outside this worker remains an integration limit.

## Semantic/agent test execution

### AA-06 — P2: Responsiveness test spends two fixed seconds under the global environment lock; other concurrency tests rely on elapsed-time or polling guesses

**Evidence.** `commands/chat_commands.rs:1559–1658` acquires `lock_test_env`, starts a thread holding the index mutex, unconditionally sleeps two seconds (`:1620`), joins it, and asserts dispatch <250ms (`:1653`). This adds at least two seconds to every run and serializes every other path-configuration test behind it. It checks dispatch duration, not progress of a second IPC while the search is blocked. `semantic/activity.rs:90` waits 40ms to infer worker blocking; `agent_permissions.rs:384–397` polls registration with 1ms sleeps. `context_measurement.rs:453–495` uses a fixed-five-request socket server with blocking accept and no accept deadline; if the probe makes fewer requests without panicking before join, the server can wait indefinitely.

**Recommendation.** Replace the index sleep with an explicit release channel/guard. Dispatch while the lock is held, verify a second inexpensive draft IPC completes before release, release in guaranteed cleanup, then await search completion with a bounded deadline. Use explicit observation signals for checkpoint/permission registration; keep negative progress assertions after known arrival. Give fake servers a shutdown path and bounded accept/read deadline.

**Migration/validation.** Preserve an outer timeout so a synchronous-dispatch regression fails rather than deadlocks. Compare the fixed-cost reduction in the root's timing run; retain one separate measured responsiveness benchmark where thresholds are deliberately machine-dependent. Do not weaken the restart/quiescence assertions in chat.rs:5117 or indexer.rs:2104; those use causal channels and protect distinct admitted owners.

**Confidence:** high for the fixed two-second cost; other changes improve determinism, not necessarily measured speed.

### AA-07 — P2: Runtime diagnostics and embedding tests mutate process environment unsafely or fail to restore preexisting configuration

**Evidence.** `semantic/embed.rs:1283–1360` saves environment values and restores them only after assertions, without `lock_test_env`; panic skips restoration. The comment that putting cases into one serial test avoids parallel impact is inaccurate for Rust's multithreaded harness. `agent_runtime.rs:1102–1138` takes the lock but sets diagnostics to 1 and unconditionally removes it, losing a preexisting value and not restoring on panic. `semantic/debug.rs:303–338` has a good Drop restore but no shared lock. Production `Measurement::configured` reads diagnostics for each runtime (`context_measurement.rs:25–42`), while parallel runtime tests do not take that lock; merely locking writers cannot keep readers from seeing transient values.

**Recommendation.** Separate pure option parsing from environment lookup and table-test parsed inputs; read environment once at the owning configuration boundary. Retain a few wrapper integration tests with RAII restoration and the shared lock, or run environment scenarios in subprocesses when readers cannot be isolated. Avoid introducing a global lock into every unrelated runtime test.

**Migration/validation.** Check non-default preexisting values survive successful and failing scenarios; run affected suites under ordinary parallelism and explicit environment overrides. This overlaps the root's global harness-state finding and should produce one coordinated cleanup, not competing locks.

**Confidence:** high, static restoration/thread-safety defect in tests; no observed flaky failure claimed.

## App/settings test fidelity

### AA-08 — P2: Settings race tests reproduce the snapshot-admission algorithm inside the mock instead of exercising the real owner

**Evidence.** `settings/store.test.ts:17–51` reimplements `beginSnapshotAdmission` and `admitSnapshot`. The fake lacks real AppStore generation/dispose behavior and does not advance revisions on successful admission as production does (`appStore.svelte.ts:190–225`). Tests at `settings/store.test.ts:543–594` establish Settings' interaction with this simplified shadow, while appStore tests separately test the real algorithm. The split does not protect their actual integration. `appStore.svelte.test.ts:13–14` also casts a structurally incomplete bootstrap payload and settles exactly 15 microtasks; that count ties scheduling to current promise depth.

**Recommendation.** Use a real fresh AppStore instance in a narrow Settings integration harness with only IPC/listen/bootstrap mocked; if needed inject the owner into SettingsStore. Keep smaller Settings action tests with a simple spy adapter, but do not reproduce policy there. Replace arbitrary microtask counts with named deferred listener/bootstrap arrivals, without adding general wait helpers that hide races.

**Migration/validation.** Port existing older/newer Apply and event-versus-settings cases to the real owner. Add a disposed-generation result and duplicate-admission scenario. Retain AppStore's concentrated unit tests for independent slices; do not delete them merely because Settings now crosses the same seam.

**Confidence:** high test-policy duplication; production failure is not asserted.

## Runtime/evaluation/test organization

### AA-11 — P2: Live evidence evaluation maintains an outdated shadow agent protocol and cannot certify production tool behavior

**Evidence.** `services/evidence/live_evaluation.rs:10–16` hardcodes its own tools; search requires query, read lacks direct-note/continuation/activity options, and the hand-copied worker prompt/selection contract omits the production result-schema adapter. The gap spellings overlap current production definitions; the concrete drift is the tool input surface and independently maintained runtime behavior. `Run::retrieve` (`:94–185`) implements its own completion/tool loop, currentness checks, budgets and worker selection via raw HTTP, outside the production runtime cancellation/admission seam. Current production tool definitions live in `agent_tools/evidence.rs:136–150`, `:168–419`; research selection and schema are owned by `agent_tools/research.rs`. The harness clearly labels itself an opt-in protocol benchmark, which is good, but its location under test modules and separate three ignored entry points make maintenance drift easy. `chat/grounding_evaluation.rs` additionally compares supplied-evidence prompts and manually graded answers, not actual retrieval/validated citations.

**Recommendation.** Either retain this explicitly as an archived experiment outside the core test modules, or rebase acceptance checks on the production AgentRuntime/tool registration seam with synthetic vaults and explicit live opt-in. Keep raw-HTTP transport probes only for provider diagnostics. Share fixture inputs and rubric/output schemas, not a duplicated production loop. The production streaming mock tests in `agent_runtime.rs` remain valuable and should survive.

**Migration/validation.** Inventory every README/script reference before moving/removing entry points; replace requested production acceptance scenarios with actual runtime/worker executions. Existing native `agent-date-evidence.spec.ts` and `chat-dates.spec.ts` already exercise actual agent/citation paths under live opt-in and should anchor this consolidation. Keep manual quality grading separate from automated protocol assertions.

**Confidence:** high protocol divergence; no claim that the intentionally historical benchmark currently fails.

### AA-12 — P2: Split chat storage/projection/runtime and Atlas publication/layout behind their existing owners, then group tests by behavior

**Evidence.** `chat.rs` mixes >5,000 production lines of DTOs, SQLite bootstrap/migrations (`:723`), conversation settings/policies, durable events (`:2685`), runtime/context assembly (`:2167`, `:2373`), proposal recovery (`:3596`), compaction (`:3633`), Markdown projections (`:3884`), attachments (`:4454`) and titles (`:4912`). Its inline tests span 56 scenarios from `:5103` through `:7538`; many seed SQL rows through helpers at `:5150`, `:5215`. `semantic/atlas.rs` mixes publication/GC (`:497–606`), worker build orchestration (`:838`), graph/community/layout (`:1670–4318`), search and 27 tests starting `:4502`. `semantic/db.rs` and `indexer.rs` similarly interleave schema/vector/edge algorithms and worker coordination.

**Recommendation.** Keep ChatService and app-owned runtime boundaries; move implementation into private `chat/{store,projection,history_context,attachments,conversation_configuration}` modules, and make service tests concentrate on public observable lifecycle/persistence. Group specialized tests separately with bounded SQL seeding helpers for states only recovery tests need. Split Atlas into private generation publication, graph/community/layout, and query modules while preserving one semantic worker queue and immutable published generations. Do not add a forest of public facades. The ANN machinery is already appropriately factored into `ann_core.rs`; chunk and note ANN intentionally retain different schemas/EF scores and should not be merged into one giant configurable class merely to reduce line counts.

**Migration/validation.** Move code/tests without behavior changes first; compare discovered test IDs before/after. Retain schema migration, rollback/recovery, projection publication ordering, chat history privacy, grant/exclusion, worker isolation, quiescence, generation compatibility and geometry invariants. Only then eliminate tests shown to assert the same behavior at the same boundary. Separate low-cost pure graph/numerical cases from disk/ANN publication contracts, and move the 20,000-chunk regression (`indexer.rs:2856–2941`) to an explicit scale lane only after a smaller invariant test protects no-full-rebuild behavior in the default suite. Its metrics are valuable; a large fixture is not automatically waste.

**Confidence:** high locality/maintenance benefit, design judgment rather than demonstrated runtime defect. Large rewrite should be phased; not recommended for immediate all-at-once implementation.

## Rendering and product catalog

### AA-13 — P2: SSR rendering tests assert markup but leave most chat action wiring untested; one privacy assertion has no canary in its input

**Evidence.** `ChatPanel.svelte.test.ts`, `ChatMessage.svelte.test.ts`, `ChatMarkdown.svelte.test.ts`, `EvidenceSource.svelte.test.ts`, model-selector and inline-citation tests use `svelte/server.render`. They meaningfully protect escaping, labels, initial availability and evidence distinction, but event callbacks/effects are never invoked. `ChatMessage.svelte.test.ts:98` asserts absence of `private reasoning payload` although that string is not supplied anywhere in the tested input. ChatComposer's substantive flows (`ChatComposer.svelte:187–284`) include effects, draft graduation, async active-note flush, submit, attachment selection and model switching, without its own mounted component tests. Existing browser chat tests focus on pane animation; settings browser tests do exercise setup and unsaved settings.

**Recommendation.** Keep fast SSR tests for text safety/initial rendering, trim styling-only expectations such as `ChatPanel.svelte.test.ts:60`, and replace the vacuous privacy assertion with canary-bearing event input at the reducer/transport boundary. Add a small mounted/browser chat interaction suite using a typed fake controller: send from draft, failed flush/send retains draft, late receipt/event race, permission button carries complete identity, valid evidence click uses app resolution, local model discovery/action wiring. Cover behavior once at the narrowest effective boundary rather than copying every assertion into every layer.

**Migration/validation.** Port selected behavioral cases to the existing browser harness or a DOM Svelte runner. Avoid asserting long serialized HTML or exact CSS class ordering. Track which SSR checks are removed and the replacement case. Ordinary native tests must remain provider-free; live evidence acceptance stays explicitly opt-in.

**Confidence:** high coverage distinction; coverage gaps do not establish current UI failure.

### AA-14 — P2/P3: Model catalog policy and numerical similarity implementations are duplicated; consolidate only after deciding their semantics

**Evidence.** `chatConfiguration.ts:29–58` and `commands/chat_commands.rs:150–158` independently list the same curated hosted IDs; frontend test `chatConfiguration.test.ts:53–65` repeats the full catalog order, while backend test at `chat_commands.rs:1483` independently asserts filtering. A catalog edit therefore requires coordinated production/test updates across languages with no shared contract fixture. `semantic/similarity.rs:15–35` and `semantic/atlas.rs:4164–4180` both implement cosine; the Atlas copy rejects tiny norms and clamps whereas the shared copy only rejects exactly zero. These are not mechanically interchangeable.

**Recommendation.** Put curated IDs/order and applicable reasoning policies in one versioned app-owned catalog data source exposed/generated for both languages; test availability/current/default preservation and one catalog contract instead of copying every literal into consumers' tests. For cosine, explicitly name whether tiny vectors/clamping are desired and centralize a shared implementation with explicit policy if necessary. Preserve appropriate independent tests for ranking/geometry outcomes.

**Migration/validation.** Add a frontend/backend catalog contract case with an unavailable current/custom model. Add pure vector cases for zero, tiny, mismatched dimensions, ordinary identical/opposite and non-finite inputs before changing either numerical caller. Evaluate Atlas grouping/edge thresholds against fixtures. Do not refresh the product's model list as part of this code audit without a separately verified product requirement.

**Confidence:** high duplication; numerical consolidation is a design question with potentially different intended behavior. Lower priority than admission/freshness fixes.

## What should remain

- Layered tests that protect different boundaries are not redundant: runtime streaming/tool dispatch versus permission broker correlation; evidence canonical identity versus Note Timeline retained-proof reconstruction; API normalization versus event reducer replay; live UI rendering versus pure markdown escaping.
- Shared worker token allowance and separate per-runtime context occupancy are deliberately different (`agent_guardrails.rs` versus `usage_context.rs`). Do not merge their budgets or tests.
- Restart and publication race tests protect irreversible/durable ordering; SQL fixtures for interrupted/recovered states are justified where no public API can create the interrupted state. Centralize fixture construction rather than substituting happy-path mocks.
- Optional live/scale checks are not ordinary fast-suite failures and should remain explicit. Fixture answer measurements must not be reported as broad answer-quality guarantees.
- Existing interfaces in `appStore`, `NoteTimeline`, `agent_runtime` and `ann_core` have real ownership responsibilities. Test count/file length alone is not justification for deleting them.

## Suggested execution plan

1. Root consolidates this report with other module audits and baseline timings; preserve these findings before any code edits.
2. Fix AA-01/AA-02 and Atlas AA-03/AA-04 with deterministic adversarial ordering tests. Update only affected admission owners and tests.
3. Remove AA-06's fixed delay and eliminate AA-07 process-env hazards; compare normal parallel runs and timing without weakening invariants.
4. Repair AA-05 through a real adapter fixture; improve AA-08 test fidelity and AA-10 hybrid composition coverage.
5. Profile AA-09 before redesign; phase AA-12 structural moves with exact test inventory mapping, then archive/rebase AA-11 experiments.
6. Add the smallest missing mounted UI cases and consolidate catalog/numerical policies when the preceding groups are stable.

No code changes were made by this worker. All failure conclusions above are static code/caller evidence unless explicitly marked as measurements or design judgments. The root's execution results should be appended separately rather than retroactively implied here.
