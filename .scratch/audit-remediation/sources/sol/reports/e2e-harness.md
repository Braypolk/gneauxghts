# E2E, fixtures, execution scripts and CI audit

Status: needs-triage
Date: 2026-10-02 (America/Denver)
Scope: current working tree; read-only audit before implementation. No application/test source changed by this auditor.

## Assessment

The browser/native distinction is valuable and should survive the cleanup. Most browser tests protect layout, native selection, CodeMirror decorations, real pointer hit testing and asynchronous remounts that Node/SSR assertions cannot establish. Native history recovery, real filesystem mutations and actual process interruption are also distinct contracts. The strongest improvements are execution discoverability, strict and resettable fixture behavior, reliable bounded instrumentation and smaller scenario ownership groups. Deleting all tests with overlapping words such as “restore” would remove different persistence boundaries.

The execution system has concrete gaps: the default native command selects three files and omits three deterministic WebKit suites; eight very cheap Node harness tests have no package entry; the only checked-in GitHub workflow builds documentation, not code/tests. A live inventory assertion still expects source-preview behavior already removed from production. Browser fixtures quietly accept unknown commands and approximate save ownership, so successful browser runs are weaker evidence than the names of the journeys suggest.

## Validation and constraints

- Read every listed E2E spec, support module, fixture JSON, configuration and script (inventory below), plus `e2e/README.md`, `ARCHITECTURE.md`, `docs/architecture/behavior-invariants.md`, local issue/triage instructions and `vite.config.js`/`package.json`.
- Traced renderer boundaries into `Notepad.svelte` (E2E bridge/mount/disposal), `navigation/navigation.ts`, `workspace/paneLayoutMotion.ts`, `ChatMessageList.svelte` (8-message frame batches and cancellation), app bootstrap/startup observation and native `chat.rs` text-delta persistence. Reviewed native fixture/build admission and command registration in `src-tauri/src/lib.rs`.
- `node --test e2e/support/*.test.mjs`: **8/8 pass**, about 71 ms wall duration reported by Node. These require no browser/native executable.
- `python3 -B -m unittest discover -s scripts/tests -v`: **8/8 pass**, 54 ms test time, with confirmed unclosed SQLite `ResourceWarning`s.
- No WDIO/browser/native launch, model request, Rust build, large-history generation or timed benchmark run. Runtime failures/flakiness described below are supported by control flow, not reproduced on the unlocked desktop. Root owns frontend/Rust baselines and build-artifact-test measurement.
- Reviewed assertions and targets; no claim of complete coverage of production modules assigned to other audit agents. No externally configured CI or local hooks can be ruled out from this repository inventory.

## Findings by module

### Execution ownership and admission

**EH-01 — P1, confirmed discovery gap: cheap preflight tests are outside every declared ordinary gate.** `vite.config.js:77-80` includes only `src/**/*.test.ts`; `package.json:13` invokes only `scripts/tests/rustBuildArtifacts.test.mjs`. `e2e/support/currentScaleFixture.test.mjs` (five cases) and `nativeE2EBinary.test.mjs` (three cases) have no package command/reference. These protect symlink containment, E2E feature-marker/hash/profile admission and debug-port correspondence, and all eight run in about 71 ms. Add a `test:harness` Node entry over support `.test.mjs` files and wire a documented quick gate to it. Keep the Cargo compilation artifact test separate because it has platform/toolchain cost. Verify with Node and package-script discovery; no new unit tests mirroring dispatch are needed.

**EH-02 — P1, confirmed omission: deterministic native WebKit coverage is opt-in by accident.** `package.json:22` invokes only `app-lifecycle`, `note-timeline-phase-1-3` and `editing-windows`, while `e2e/wdio.native.conf.ts:43` discovers all native specs when run directly. `native/image-interactions`, `native/pane-animation`, and `native/chat-pane-animation` have unconditional `describe` blocks, yet none runs through `pnpm test:e2e:native`. Other native specs intentionally gate on environment flags and must stay separate. Create an explicit manifest of deterministic smoke, opt-in performance, opt-in model evaluation and process durability scenarios, then derive sequential invocations from it. Preserve separate fixture/app lifetimes for reset/restart cases. README instructions to run selected browser cursor/due-date journeys against native are also manually discoverable, not part of any script. Decide explicitly whether WebKit cursor/due-date geometry belongs to native smoke or a documented platform UI lane. Verify selected-file enumeration without launching the application, then run added native smoke on an unlocked macOS display.

**EH-03 — P1, confirmed repository gap: there is no checked-in test CI workflow.** `.github/workflows/openwiki-update.yml:1-63` is the entire workflow inventory; it runs OpenWiki and creates documentation PRs. Thus documented full gate (`e2e/README.md:107-115`) is entirely manual in repository-owned CI. Add one bounded quick workflow for dependency install, type checks, TS tests and Node/Python harness tests; keep native/macOS and expensive durable history workloads separate. Rust CI requires the platform dependencies/target decision from the backend audit. This is an execution omission, not evidence that external CI does not exist. Verify resulting commands against an explicit test manifest, and avoid claiming Linux Chrome proves native WebKit/window behavior.

**EH-04 — P1, high-confidence harness defect: Vite readiness can admit an unrelated listener or strand startup cleanup.** `e2e/support/viteServer.ts:5-16` considers any HTTP 200 at the requested port ready, has no fetch abort timeout and never checks the spawned child's exit/error. At `19-30`, `--strictPort` can terminate Vite for a port collision while the foreign server still answers 200; the harness can continue against that server. Spawn failure has no error listener. `stopVite:37` sends group SIGTERM without guarding an already-exited group, so cleanup can throw before it reaches its wait/escalation handling. Browser port is hard-coded `1421` (`wdio.browser.conf.ts:6`) despite multiple-checkout support elsewhere. Introduce an owned-server lifecycle with port admission, bounded requests, early child failure and cleanup on failed preparation; support an explicit browser port override. Existing `processRelaunch`/`currentScaleNative` already show listener ownership checks, which must be preserved if shared. Verify using tiny temporary child/HTTP fixtures for collision, early exit, hung response, successful startup and already-exited cleanup; no heavy application launch required.

### Browser IPC fixture and contract fidelity

**EH-05 — P1, confirmed fixture weakness: unknown commands succeed and events are never delivered.** `src/lib/e2e/browserBackend.ts:897-901` accepts unimplemented list commands as `[]` and everything else as `null`; event listen returns an unrelated counter while callbacks are only stored (`904-915`), never looked up and dispatched by channel. This permits unsupported actions to appear successful and prevents realistic stale completion, watcher, streaming, proposal arrival and listener teardown journeys. Browser README scenario guidance includes proposal/external-sync/run lifecycle, but no browser spec currently drives these flows. Rewrite the fixture as an explicit command registry with a named permissive allowlist only for intentional no-ops, plus event subscription/emit and controlled operation settlement. Keep all UI actions through existing document/pane/chat/proposal owners. Seed result DTOs from contract fixtures where useful; do not recreate the Rust evidence/history algorithms in TypeScript. Verify unknown-command rejection, event listener setup/unlisten/disposal, and at least one browser stale-event/streaming/proposal/external-sync journey. Additions should cover integration seams missing from unit tests, not replay every reducer transition.

**EH-06 — P1, confirmed fixture ownership divergence: saves target mutable active state instead of command identity.** `browserBackend.ts:628-641` waits on a held save and then spreads `activeNote`, ignoring `currentPath`; `read_note` also changes `activeNote` (`623-625`) and `findNote` falls back to Alpha for unknown identity (`239-249`). A read of another note while an A save is pending can make its completion mutate B in the fixture even if its command names A. Conversely a wrong save path or nonexistent open target can be accepted. This is test-double corruption/false confidence, not a confirmed production save bug. Snapshot the target at command admission and resolve saves by explicit path/identity; require explicit creation for null-path saves; make unknown identities fail. Put fixture state inside a factory instead of module-level maps/flags (`19-180`), expose reset/seed and a typed bridge shared with `e2e/support/browserBackend.d.ts`. Ordinary full reload currently reconstructs module state; internal route navigation does not, so avoid claiming arbitrary cross-test leakage without reproducing it. Verify an A-save/B-read/release interaction, invalid target rejection and two panes editing one identity. Preserve production writer ownership.

**EH-07 — P2, confirmed unused branch: remove the unexercised large-diff switch after ownership review.** `browserBackend.ts:380-399` synthesizes 16,384 diff lines under `largeHistoryEnabled`; `seedLargeHistory` is declared in both bridge shapes and implemented at `939`, but no caller exists in `src`/`e2e`. Retire the setter/flag/branch and duplicate declaration unless the history audit identifies a needed browser DOM performance case; if retained, give it an explicit benchmark owner and command. Real 10k/100k retained-history probes remain native/backend and must not be deleted with this unused browser switch.

### Browser UI scenarios, timing and instrumentation

**EH-08 — P2, confirmed maintenance duplication: split scenario ownership before trimming suites.** `browser/document-and-pane.spec.ts` is 916 lines and combines Forget, pointer geometry, switching, history shortcuts/layout/diff/naming/clear, revision citations, editor state return, restore, pin/search hints, settings purge/recovery and Markdown fidelity. Its `369-521` single history case crosses naming, duplicate labels, cancel/focus, empty revisions, paging, history clear, editor return and reload. Native timeline's 619 lines similarly combine persistence + UI. Split into history browsing/naming, history restore/return, note lifecycle, navigation/search and editor rendering modules using a small shared app-driver vocabulary (`ready`, `openNote`, `invoke`, `readEditorState`). Split long journeys at independently seedable boundaries to improve failure localization; retain at least one end-to-end persistence flow. Preserve native real watcher collision recovery/properties-only restore/reset recovery and browser presentation/focus behavior; do not replace these with only pure-machine assertions. Consolidate repeated native invoke/bridge/error wrappers across 12 specs, but avoid wrapping assertions away into generic helpers.

**EH-09 — P2, high-confidence flake/timeout exposure: transient frame waits have no terminal condition.** `browser/chat-pane-animation.spec.ts:85-92` loops until a frame with 1–99 messages; if restoration fails or the intermediate phase is missed, it never calls `done`. `browser/pane-animation.spec.ts:111-121` loops until both the second pane and moving marker appear. They depend on a transient state, not just a stable endpoint. `support/paneMotion.ts:81-92` samples exactly 700 ms; assertions require motion finished and multiple intermediate frames, while ready helpers use fixed 400 ms sleeps. Several related specs use ad hoc 400/500/1200 ms observation windows. Add an in-renderer deadline and exactly-once finish/dispose to every sampler; use observed transition completion + a small settled tail instead of an unconditional duration; retain real frame sampling for “no flash/continuous width” contracts. For interruption tests, record whether the interruption point was observed and fail descriptively rather than spin. Reuse production `ChatMessageList`'s busy state without hard-coding its 8-message batch size. Verify normal, reduced-motion, no-intermediate-frame and missing-target fixtures. Timed paint checks should record focus/visibility during measured frames and reject loss instead of just logging it (`native/pane-animation.spec.ts:49-55`).

**EH-10 — P2, confirmed cleanup risk: ad hoc instrumentation is inconsistently restored and tied to Vite's dependency URLs.** `browser/animation-navigation.spec.ts:19,21-22,102-103` imports production/source modules and discovers optimized CodeMirror/deck modules through ResourceTiming URL naming. This asserts direct implementation dispatch/counts using monkeypatches rather than entirely user-driven paths. It is useful evidence but a fragile E2E dependency on bundling. In `browser/image-interactions.spec.ts:229-234`, `DataTransfer.prototype.setData` and `navigator.clipboard.writeText` are patched without restoring; chat animation patches `CSSStyleDeclaration.prototype.setProperty` and disconnects its observer only when the 700 ms success timer runs (`40-61`). Full document reload generally removes these mutations, but a failed operation can leave work active for the remainder of the same document. Use scoped instrumentation with `finally`/single finish cleanup and bounded observation. Move exact one-scroll-owner/one-layer-update implementation contracts to focused browser-adapter tests if a real DOM adapter lane is added; retain actual scroll position, camera keyboard behavior and pointer navigation as E2E. Do not pretend current Node SSR tests can replace browser geometry. Screenshots throughout settings/tags/images are fixed `/tmp` paths with no comparison; make them failure-only artifacts or an explicit visual evidence option to remove routine I/O/collision noise.

### Performance versus functional native journeys

**EH-11 — P2, confirmed classification/cost mismatch: a 1 MiB sustained measurement is inside the default native functional gate without a performance threshold.** `native/editing-windows.spec.ts:122-214` runs 12 real one-second debounced saves, continuous frame sampling and deadline advancement. It asserts canonical durability/window counts but reports `budget_ms: null, passed: true` at `207-209` regardless of paint delay. The test can collect poor responsiveness while its name says it remains responsive. Move this workload to an explicitly requested responsiveness/measurement lane; keep a smaller default native save/deadline-sealing scenario with the essential functional assertions. Either select a justified platform/profile budget or label outputs observations rather than pass/fail performance claims. Do not invent a latency SLA during cleanup. Keep `native/chat-typing`'s deliberate slow related-search case separate, and keep native populated-chat's justified regression ceiling and 64 KiB/large-history optimized p95 budgets. Validate scenario enumeration, functional window count/save outcomes, then run the opt-in workload sequentially on the unlocked display.

**EH-12 — P2, confirmed harness duplication and safety drift: centralize owned transport/process primitives, retain distinct runners.** `support/processRelaunch.mjs:24-127`, `currentScaleNative.mjs:27-128` and `restartLifecycle.mjs:26-129` repeat polling, HTTP transport, owned child spawn/exit, listener PID admission, WebDriver session and vault verification. Two later runners have cancellation admission and signal cleanup; `restartLifecycle.mjs` lacks SIGINT/SIGTERM handling and has hardcoded dev/driver ports despite admission checking configured dev port. `timelineNativeMetrics.ts:24-54` checks visibility only and leaves a MutationObserver attached on timeout; `currentScaleNative:134-163` has a finish guard/disconnect/final focus check. Extract a narrowly scoped owner object for transport, child ownership, cleanup and measured renderer action, then keep scenario logic as separate files. Preserve exact listener PID, canonical disposable vault, feature/hash/profile and symlink checks; no global “kill all app processes” shortcut. A fake child/HTTP server can verify teardown/cancel/timeout cheaply. Native fault matrices and first-visible Swift WindowServer probe remain separate evidence because driver reconnection cannot replace process relaunch or sub-WebDriver visible-frame sampling.

### Live evaluation and script maintenance

**EH-13 — P1, confirmed stale contract: sources-request mode incorrectly requires empty streaming content.** `native/query-inventory.spec.ts:96` checks `answer.content === ''` whenever `scenario.mode === 'sources'` and status is streaming. The same file merely appends an ordinary source-request sentence (`83`); production `src-tauri/src/chat.rs:2475-2489` persists every TextDelta and emits `chat://text-delta`, independent of any mode. `ARCHITECTURE.md:548` states there is no source-preview command/composer mode/selection-only terminal renderer. This assertion rejects ordinary correct streaming or passes by missing the streaming observation between polls. Remove only the obsolete empty-stream expectation; preserve terminal completion, citation navigation/resolution, exclusion, activity bounds and budget behavior. Add no test mirroring a deleted branch. `docs/architecture/current-evidence-integration.md:9,26` also calls source-first preview current/optional, contradicting the architecture; update the integration record as part of the same correction. Verify static references, type checking and relevant chat streaming unit contracts; live model evaluation remains optional.

**EH-14 — P2, confirmed evaluation duplication/contract ambiguity: separate common execution from semantic grading.** The six model suites repeat local-provider settings, grants/exclusion, save/finalize/watcher flush, terminal polling, source resolution and output persistence. Keep unique questions/fixtures: activity follow-ups require fresh cross-note current status plus retained history; worker suite proves delivered worker reads without parent substitution; chat-dates proves task-date interpretation and pending proposals; research comparison intentionally contrasts lanes; date-evidence has UI citation freshness invalidation; inventory checks bounded composition/usage and date ranges. Extract one live fixture/client and structured artifact writer, recording case failures/timeouts as well as successes. Keep explicit endpoint/model/output and no hosted fallback. Files often describe semantic rubric expectations but assert structural execution only; comparison even permits empty citation lists via `every` (`research-comparison.spec.ts:83-117`) while reporting coverage for separate grading. This is appropriate for measurement if labeled, not a comprehensive correctness gate. Do not merge all opt-in flags into the ordinary native command. `query-inventory` has multiple Boolean scenario switches with silent precedence (`68-76`); replace with an explicit mode or reject conflicting flags. Date-evidence's “this week” depends on actual time while other prose dates are fixed; make evaluation instant explicit where reproducibility matters, preserving runtime timezone semantics.

**EH-15 — P2, reproduced resource leak: Python SQLite contexts commit/rollback but do not close.** `scripts/tests/test_timeline_fixture.py:29` creates seven in-memory connections in corruption subcases using `with sqlite3.connect(...)`, and later tests do the same for file databases (`85,100,110`). The 8/8 run emitted unclosed connection ResourceWarnings. Production fixture script `scripts/timeline_fixture.py:166-176` uses the same pattern during cloning, leaving its connection live while validating/returning the disposable DB. Other paths already use `contextlib.closing` correctly (`61`, `129-130`). Use `with closing(sqlite3.connect(...)) as db, db:` or explicit close while preserving the transaction. Add `subTest` around corruption rows to identify failures instead of rewriting seven equivalent tests. Verify existing tests with ResourceWarnings elevated and confirm clone path-relocation/payload immutability still pass. Keep receipt corruption, fixture tampering, symlink escape and policy mismatch cases; they guard different admission invariants.

**EH-16 — P3, design judgment: retire prototypes/archived experiments from the active harness boundary.** `scripts/history_index_baseline.py:1,27,99-114` is explicitly schema-13/old-format and cannot consume current schema-14 masters; it is a controlled historical index allocation experiment, not a regression suite. `scripts/atlasPrototype.mjs:63-78` rewrites browser fixture source via string markers and binds an unrelated read-only Atlas lab to fixture internals; a fixture rewrite otherwise breaks this launcher. Move historic experiment code under an archive with its evidence references and keep the schema caveat; replace prototype source rewriting with an explicit fixture command hook or keep prototype code separate. No deletion of historical evidence without tracing backlinks. `scripts/tauri.mjs` is production release/icon plumbing, not a duplicate test harness; no evidenced rewrite recommendation from this audit. Rust artifact probe intentionally compiles a dependency-free surrogate with app library/profile settings; preserve its macOS-only opt-in status rather than pulling repeated compilation into the millisecond harness gate.

## Proposed ownership and consolidation plan

| Module | Primary executable contract | Preserve native/other distinct owner | Candidate consolidation/deletion |
| --- | --- | --- | --- |
| Document navigation/panes | Browser switching, mounted-editor identity, focus and scroll return | Native window integration smoke | Shared ready/openNote/readState helpers; split mixed document file |
| History UI | Browser diff display, labels/menu/shortcut/layout, read-only presentation, exact selection direction | Native real capture/reconstruction/properties-only restore, watcher collision/recovery/reset | Independently seeded browser subjourneys; retain one complete real persistence journey |
| Pane/chat rendering | Browser wide/narrow/Related/reduced-motion/interruption | Native WebKit continuous motion and populated-chat stall regression | Shared bounded sampler and native setup; no deletion based solely on same selectors |
| Editor dates/cursor/images | Browser full geometry, keyboard/pointer/undo/remount | Native WebKit clipboard/file persistence + selected platform geometry journeys | Driver helpers + explicit cross-platform scenario list; keep viewport and native-input distinctions |
| Chat/evidence/proposals | Deterministic browser owner integration after event fixture exists | Opt-in native model tool composition/evidence freshness/evaluation | Shared live client/artifact writer; remove obsolete sources empty-stream assertion |
| Harness admission | Fast Node/Python containment/profile/hash/receipt checks | Rust build artifact profile probe separately | One discoverable quick harness command; retain refusal cases |
| Durability | Native process fault/recovery and graceful restart | WindowServer first-visible geometry probe | Common owned-process/WebDriver primitive; scenario runners stay separate |
| Performance | Explicit local optimized probes with measured budgets/metadata | Native 1 MiB sustained observational workload, typing delay probe | Move repeated 1 MiB saves outside functional gate; remove unused browser large-diff branch if unneeded |
| CI | Quick deterministic commands | Platform/native/model/scale lanes explicit | Test manifest plus quick workflow; no all-glob model/performance execution |

## Migration order and verification

1. Make all quick harness tests discoverable, correct obsolete streaming/doc claims and close leaked SQLite connections. These are narrow, independently reviewable changes. Run existing Node/Python checks and type checking.
2. Before any fixture rewrite, record current browser scenario IDs and controlled command/event behavior. Add strict explicit command handling, per-instance/reset state, correct save targeting and usable event subscription/emit. Keep the app-owned controllers and native IPC adapters as test entry points. Run browser suite and compare assertion ownership, not raw test count.
3. Split mixed browser/native specs and introduce only the small shared drivers/samplers with demonstrated duplication. Preserve every behavior in the ownership table; use bounded stop/cleanup and failure artifacts. Run affected browser files, native WebKit smoke and cheap harness teardown tests.
4. Implement explicit lane manifests, sequential native invocation and quick CI. Move observational 1 MiB workload to a named optional lane; list live flags/workloads in README. Verify discovery without build/inference, then execute native smoke on supported macOS.
5. Refactor owned-process transport after cancellation/listener/vault fixture checks exist. Run graceful restart, crash matrix, first-visible geometry and optimized scale workloads sequentially when the relevant backend changes require them. These are expensive evidence contracts, not substitutes for a fast daily suite.

## Reviewed-file inventory

Every file below was inspected. Inventory includes test targets/harness boundaries within this assignment; other report modules own comprehensive application-code audits.

### Browser E2E (18 files)

- `e2e/specs/browser/animation-cleanup.spec.ts` — 174 lines; inspected fully.
- `e2e/specs/browser/animation-navigation.spec.ts` — 146 lines; inspected fully.
- `e2e/specs/browser/chat-pane-animation.spec.ts` — 100 lines; inspected fully.
- `e2e/specs/browser/dates.spec.ts` — 277 lines; inspected fully.
- `e2e/specs/browser/document-and-pane.spec.ts` — 916 lines; inspected fully.
- `e2e/specs/browser/due-date-scroll.spec.ts` — 57 lines; inspected fully.
- `e2e/specs/browser/editor-cursor.spec.ts` — 318 lines; inspected fully.
- `e2e/specs/browser/editor-formatting-load.spec.ts` — 152 lines; inspected fully.
- `e2e/specs/browser/editor-readiness.spec.ts` — 69 lines; inspected fully.
- `e2e/specs/browser/editor-route-layout.spec.ts` — 50 lines; inspected fully.
- `e2e/specs/browser/image-interactions.spec.ts` — 243 lines; inspected fully.
- `e2e/specs/browser/map-navigation.spec.ts` — 67 lines; inspected fully.
- `e2e/specs/browser/note-tags.spec.ts` — 133 lines; inspected fully.
- `e2e/specs/browser/pane-animation.spec.ts` — 133 lines; inspected fully.
- `e2e/specs/browser/selection-menu.spec.ts` — 79 lines; inspected fully.
- `e2e/specs/browser/settings.spec.ts` — 323 lines; inspected fully.
- `e2e/specs/browser/startup-readiness.spec.ts` — 39 lines; inspected fully.
- `e2e/specs/browser/window-resize.spec.ts` — 58 lines; inspected fully.

### Native E2E (13 files)

- `e2e/specs/native/activity-followups.spec.ts` — 272 lines; inspected fully.
- `e2e/specs/native/agent-date-evidence.spec.ts` — 221 lines; inspected fully.
- `e2e/specs/native/app-lifecycle.spec.ts` — 38 lines; inspected fully.
- `e2e/specs/native/chat-dates.spec.ts` — 140 lines; inspected fully.
- `e2e/specs/native/chat-pane-animation.spec.ts` — 74 lines; inspected fully.
- `e2e/specs/native/chat-typing.spec.ts` — 82 lines; inspected fully.
- `e2e/specs/native/editing-windows.spec.ts` — 214 lines; inspected fully.
- `e2e/specs/native/image-interactions.spec.ts` — 60 lines; inspected fully.
- `e2e/specs/native/note-timeline-phase-1-3.spec.ts` — 619 lines; inspected fully.
- `e2e/specs/native/pane-animation.spec.ts` — 56 lines; inspected fully.
- `e2e/specs/native/query-inventory.spec.ts` — 183 lines; inspected fully.
- `e2e/specs/native/research-comparison.spec.ts` — 124 lines; inspected fully.
- `e2e/specs/native/research-worker.spec.ts` — 171 lines; inspected fully.

### Scale E2E (1 files)

- `e2e/specs/scale/editing-window-native-scale.spec.ts` — 37 lines; inspected fully.

### Support (17 files)

- `e2e/support/browserBackend.d.ts` — 33 lines; inspected fully.
- `e2e/support/buildNative.mjs` — 65 lines; inspected fully.
- `e2e/support/chatHistoryFixture.ts` — 17 lines; inspected fully.
- `e2e/support/citationScaleInteraction.mjs` — 74 lines; inspected fully.
- `e2e/support/currentScaleFixture.mjs` — 26 lines; inspected fully.
- `e2e/support/currentScaleFixture.test.mjs` — 33 lines; inspected fully.
- `e2e/support/currentScaleNative.mjs` — 257 lines; inspected fully.
- `e2e/support/nativeE2EBinary.mjs` — 63 lines; inspected fully.
- `e2e/support/nativeE2EBinary.test.mjs` — 58 lines; inspected fully.
- `e2e/support/paneMotion.ts` — 182 lines; inspected fully.
- `e2e/support/processRelaunch.mjs` — 368 lines; inspected fully.
- `e2e/support/relaunchSnapshot.py` — 50 lines; inspected fully.
- `e2e/support/restartLifecycle.mjs` — 193 lines; inspected fully.
- `e2e/support/timelineNativeMetrics.ts` — 69 lines; inspected fully.
- `e2e/support/viteServer.ts` — 49 lines; inspected fully.
- `e2e/support/windowRestore.mjs` — 22 lines; inspected fully.
- `e2e/support/windowRestore.swift` — 79 lines; inspected fully.

### E2E fixtures and config (6 files)

- `e2e/fixtures/autonomous-agent.json` — 362 lines; inspected fully.
- `e2e/fixtures/query-inventory.json` — 100 lines; inspected fully.
- `e2e/README.md` — 334 lines; inspected fully.
- `e2e/tsconfig.json` — 15 lines; inspected fully.
- `e2e/wdio.browser.conf.ts` — 40 lines; inspected fully.
- `e2e/wdio.native.conf.ts` — 84 lines; inspected fully.

### Production E2E adapters (2 files)

- `src/lib/e2e/browserBackend.ts` — 972 lines; inspected fully.
- `src/lib/e2e/startupMetrics.ts` — 51 lines; inspected fully.

### Scripts and tests (6 files)

- `scripts/atlasPrototype.mjs` — 116 lines; inspected fully.
- `scripts/history_index_baseline.py` — 180 lines; inspected fully.
- `scripts/tauri.mjs` — 175 lines; inspected fully.
- `scripts/timeline_fixture.py` — 261 lines; inspected fully.
- `scripts/tests/rustBuildArtifacts.test.mjs` — 66 lines; inspected fully.
- `scripts/tests/test_timeline_fixture.py` — 120 lines; inspected fully.

### Execution/configuration (3 files)

- `package.json` — 85 lines; inspected fully.
- `vite.config.js` — 105 lines; inspected fully.
- `.github/workflows/openwiki-update.yml` — 63 lines; inspected fully.

Additional traced application boundaries: `src/routes/+layout.svelte`, `src/lib/app/appStore.svelte.ts`, `src/lib/features/notepad/Notepad.svelte`, `src/lib/features/notepad/navigation/navigation.ts`, `src/lib/features/notepad/workspace/paneLayoutMotion.ts`, `src/lib/features/chat/ui/ChatMessageList.svelte`, `src/lib/ui/motion.ts`, `src-tauri/src/chat.rs` (streaming path), and `src-tauri/src/lib.rs` (E2E feature/command registration). These were targeted reads, not full-file production audit claims.
