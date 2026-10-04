# Frontend editor, Markdown, image, search, task and UI audit

Status: needs-triage
Scope: current working tree, audited 2026-10-02. Audit only; no production or test files changed.

## Assessment

The strongest cleanup opportunity is replacing scattered async admission conventions with explicit request/lifetime rules, then reducing duplicated test harnesses. Four defects were reproduced against the current production modules without changing repository tests. A fifth parsing defect was reproduced through the actual selection surround command and a real CodeMirror Markdown state. There is sufficient evidence to implement small admission fixes now. A whole editor rewrite is not justified by file size alone; an incremental Markdown decoration redesign is a substantial, worthwhile measured follow-up.

Priority meanings: P1 correctness/lifetime issue; P2 maintenance or test quality issue; P3 focused measurement/optional cleanup. Findings distinguish confirmed defects from design judgments. Every finding has a proposed migration and validation path; recommendations are not permission to bypass existing owners.

## Search and related notes

### FE-01 — P1: retire an old search when replacement input is scheduled

**Confirmed defect; high confidence.** `src/lib/features/notepad/search/store.svelte.ts:306` changes `searchQuery` immediately, but only empty input increments `#activeSearchRequest` (`:309-310`). For nonempty replacement text, invalidation waits until `runSearch` (`:128`) after the 120 ms debounce. The older request remains admissible at `:162-166`. Its success or error can therefore populate/clear results for the new visible query before the replacement fires.

Current `store.test.ts:92-131` tests debounce scheduling with an already-resolved mock; `:227-269` tests cancellation before the timer fires. Neither keeps a request unresolved across a nonempty query change. The recent-note supersession case (`:76`) is a different channel and does not cover this.

**Reproduction:** transpile the current TypeScript, compile its Svelte module for server execution, replace only the imported IPC function with a controlled deferred dependency. Start `runSearch('old')`, call `handleSearchInput('new')`, resolve the old request. Observed `{ query: 'new', result: 'OLD RESULT' }`. This is a control-flow probe, not a browser timing claim.

**Recommendation:** advance the result admission generation when replacement input is scheduled, independently of debounce/highlight emission. Preserve delayed highlight emission. Add deferred success/error cases for nonempty edits, clearing, mode changes and disposal. Decide explicitly whether results already displayed remain visible while a new query waits; rejection of newly arriving stale results should not depend on that presentation choice.

**Migration/invariants:** retain local current-note search, backend all-note search, one debounce timer, and `clearSearch` immediate highlight clearing. No backend ownership change is required.

### FE-02 — P1: resetting related results must retire the active retrieval

**Confirmed defect; high confidence.** `related/store.svelte.ts:61-70` clears the visible result but leaves `#activeRelatedRequest` unchanged. `runRelatedNotes:165-175` uses that reset for an absent selection or empty note. A previously admitted request can then write its old response at `:204-212` after the reset. This survives the ordinary request-ID guard because no replacement request was started.

The entire related store suite (`related/store.test.ts:36-81`) contains two scheduling cases: collapsed panels avoid Markdown reads, expanded panels defer reads. They do not verify actual asynchronous result admission, failure/retry, cancellation, scope switches, deduplication or disposal.

**Reproduction:** start an expanded panel retrieval for Markdown `old`, replace Markdown with `''`, call `runRelatedNotes` (which resets), then resolve the old response. Observed `{ markdown: '', status: 'ready', items: [{ label: 'OLD' }] }`.

**Recommendation:** make reset invalidate outstanding work and clear any obsolete timer. Retire earlier requests when scheduling a changed scope/content target, while retaining the existing deferred Markdown reads. Add deferred cases for empty note/selection, collapsed panel, reset/dispose, and old errors. Tests should assert full `items/status/reason/isLoading` outcomes, not just that IPC ran.

**Migration/invariants:** related suggestions remain explicit, collapsed panels remain cheap, document content is not read on every keystroke, and cancellation does not mutate authored content.

### FE-03 — P2: consolidate recent collection mechanics without flattening their distinct contracts

**Design judgment; high confidence.** `search/store.svelte.ts:193-256` repeats note/task load and refresh paths with the same request counter, `loadLatestCollection`, assignment and failure reset. `loadRecentNotes` deliberately returns `null` on failure/supersession so location history does not receive an authoritative empty seed, whereas the private refresh returns `result.items`. That distinction is meaningful; merging the functions blindly would lose it.

`draftRef.test.ts`, `search.test.ts` and `wikilinks/state.test.ts` repeat first-body/acknowledged-hash examples. Keep the pure protocol tests plus a representative payload check per caller; tests at the Tauri command seam protect routing, rather than being redundant merely because they send similar bodies. Missing caller checks: related/retrieval payloads, optional currentTags, section resolution and bounded cache-miss retry.

**Recommendation/migration:** extract one private note collection acquisition helper returning the existing outcome object, keep explicit admission policies at the callers, and use typed fixture builders in search store tests (some mocks use obsolete `noteTitle/snippets` shapes instead of current `SearchItem`). Replace repeated `await Promise.resolve()` chains (`store.test.ts:218-220`) with an awaited method or controlled completion signal. Validate supersession across `list_recent_focus` and `list_recent_notes`, failure versus successful empty seeding, and stale recent navigation. Do not merge command contracts into one generic untyped test matrix.

## Task frontend

### FE-04 — P1: disposed task screens can attach persistent listeners later

**Confirmed defect; high confidence.** `tasks/taskListStore.svelte.ts:418-437` attaches three `AppStore` listeners after an asynchronous bootstrap. The cleanup at `:440-447` only removes listeners already attached. If the page unmounts while bootstrap is pending, cleanup runs first and bootstrap then creates three orphan subscriptions. The late subscriptions can keep fetching projections and retain the disposed store. No rejection handler is attached either. `src/routes/list/+page.svelte:137-139` correctly returns this cleanup from `onMount`; the race is in the store.

`taskListStore.test.ts` never calls `initialize`, so its command mocks cannot expose the race.

**Reproduction:** defer injected `appStore.bootstrap`, call `initialize`, immediately call its disposer, then complete bootstrap. Observed `{ subscriptions: 3, unsubscribes: 0 }`.

**Recommendation/migration:** use a per-initialization lifetime token checked before listener attachment; cleanup retires its token and pending result admission. Handle bootstrap failure explicitly and keep retry semantics coherent. Test delayed bootstrap completion after disposal, rejection, repeated initialize/dispose and in-flight load completion. Keep AppStore as shared snapshot/listener admission owner; this token belongs to the screen subscription lifetime.

### FE-05 — P1: task group patches bypass the request/view ordering used by full loads

**Confirmed defect; high confidence.** `taskListStore.load:102-131` rejects stale full loads, but `refreshGroup:184-190` always applies its result. Group-patch mutations likewise apply responses without verifying which completion/hidden view requested them. `#applyGroupPatch:165-181` blindly replaces or removes the group. A delayed refresh requested for `all` can replace a newer `completed` group with open tasks; two same-note refreshes can also complete out of order.

The suite tests routing and one current-view patch, but no deferred loads/patches or dispose ordering (`taskListStore.test.ts:46-128`).

**Reproduction:** begin `refreshGroup('a')` for `all`, change filter to `completed`, await a full load containing a completed task, resolve the older group containing an open task. Observed `{ filter: 'completed', tasks: [{ completed: false }] }`.

**Recommendation:** introduce explicit view generation plus per-note response ordering, or route every patch through a single projection admission method that has both view and note context. Apply the policy to refresh, collapsed/hidden writes and canonical toggle/delete/due-date responses. Never retry a successful canonical mutation merely because its projection response was superseded; request a current projection instead.

**Migration/test plan:** deferred matrix for full-load-before/after-patch, same-note refreshes, filter/showHidden change during mutation and disposed screen. Preserve note order, dirty-open-document routing, authoritative commitWarning success, and NoteTimeline/TaskMutationService canonical write ownership.

### FE-06 — P2: unify task mutation bookkeeping and strengthen warning/error assertions

**Design judgment; high confidence.** `taskListStore.svelte.ts:245-280` (toggle), `:284-304` (due date) and `:365-408` (delete) repeat note mutation admission, dirty-document routing, canonical command, projection warning, refresh and cleanup. Some behavioral differences are intentional: due-date commits throw to keep the picker error visible, while toggle/delete store errors. Share private orchestration with explicit operation-specific error handling instead of hiding that distinction in booleans.

`taskListStore.test.ts:94-128` merely asserts an error message is *not* a generic failure, allowing `''` or the wrong warning to pass; it installs a `console.warn` spy without restoring it locally. `openDocumentTaskMutation.test.ts` exercises preparation retry and initial external conflict well, but lacks bad hash/target, conflict arriving during prepare, retry exhaustion, replacement failure, attribution cancellation, and save failure outcomes. Some might be covered at document orchestration layers; trace before adding repeated tests.

**Migration/test plan:** table-driven operation cases for canonical/open-dirty/warning/failure, assert exact command, no second canonical write, final mutating-key cleanup, and appropriate picker rejection. Retain SHA-256 known-vector test and Rust-owned portable task date fixtures: these are useful cross-language contracts, not duplicates to delete. Put fake-timer cleanup in hooks/finally in `taskDates.test.ts:47-54` and `dateCommands.test.ts:38-51`, so an assertion failure cannot leave mocked time behind.

## Markdown/editor commands and runtime

### FE-07 — P1: duplicated regex fence scanners disagree with the editor parser

**Confirmed defect; high confidence.** `editor/selectionSurround.ts:24-52` and `wikilinks/wikilinks.ts:31-57` independently toggle an inside-fence flag for every line matching a backtick/tilde prefix. Neither tracks opening fence kind or length. The surround command scans/stringifies the entire document (`:96`) despite already having a Markdown language state. Wikilink input does the same (`wikilinks.ts:205-206`).

**Reproduction through production command:** real CodeMirror Markdown state with `"````\n```\nhello\n````"` parses `hello` under `FencedCode`. Calling `surroundRange(...,'*')` returns true and writes `*hello*` inside that code because the shorter triple fence falsely closed the boolean scanner. Current surround coverage only uses a simple triple-fence case (`selectionSurround.test.ts:80-85`). `wikilinks.test.ts:116-120` tests syntax parsing, not the bracket input handler's guard.

**Recommendation/migration:** use a shared internal syntax-context query for input commands, including fenced and indented code as the product contract requires. If partial parsing requires a fallback, make it bounded and parser-consistent rather than a second whole-document Markdown grammar. Tests: long fence containing shorter fence, mixed tilde/backtick line, quoted/list-nested code, inline code and partially parsed large-document caret. Preserve intentional differences between surrounding plain authored text and formatting commands before broadening exclusions.

### FE-08 — P2: retire algorithm-copy undo tests in favor of the actual runtime boundary

**High confidence test-maintenance finding.** `undoSelection.test.ts:28-64` manually recreates pane forwarding and the runtime's pre-edit selection synchronization. In particular `paneEditAfterCursorMove` updates the root selection itself before using `buildRootForwardSpec`. If `EditorDocumentRuntime.dispatchFromPane:148-155` loses that synchronization, this test still passes because its local copy remains correct. The production runtime suite verifies basic requesting-pane selection at `editorDocumentRuntime.test.ts:96-112`, but does not carry the header/list deep-cursor regression cases from the algorithm-copy suite.

**Recommendation:** move cursor-only/deep-caret isolated-edit cases to real `EditorDocumentRuntime.dispatchFromPane` + `undo/redo` through one narrow headless pane harness. Retain only focused `buildRootForwardSpec` annotation/selection contract cases. Block-move minimal-change tests have a separate causal regression and should remain. Add forwarding checks for `addToHistory=false`, isolateHistory and userEvent, which are not interchangeable with document-content assertions.

**Migration/invariants:** shared undo root, requesting pane receives undo selection, sibling scroll/selection remain independent, save/rename retain handle/runtime, committed Version Restore clears undo including properties-only changes. Port cases first, verify sensitivity to removal of production selection sync, then delete mirrored tests.

### FE-09 — P2: replace inconsistent fake EditorView copies with two small test adapters

**Design judgment; high confidence.** Stateful `get state`/dispatch/Transaction conversion shims are repeated in inline formatting (`:9-51`), surround (`:8-33`), block undo (`:32-50`), structural indentation (`:44-57`), Markdown task toggle (`markdown.test.ts:283-299`), editor capabilities (`:17-40`), shared runtime (`editorDocumentRuntime.test.ts:22-70`), image commands (`:9-22`) and dates. Their semantics differ: some accept Transaction, some only TransactionSpec, some route to runtime and others replace local state directly. Those differences can hide integration errors or force scattered fixture changes.

**Recommendation/migration:** one typed command harness using real EditorState and complete supported dispatch forms; one runtime pane adapter that delegates edits to the actual runtime. Avoid a fake that reconstructs runtime/persistence policy. Keep geometry/listener lifecycle mocks separate; headless adapters do not prove actual DOM behavior. Replace one command family at a time; preserve transaction count, reversed selection, undo, and sibling-pane isolation assertions. This yields local test maintenance, not a reason to add new production interfaces purely for testing.

`editorCapabilities.test.ts:44` says “undoable” but the fixture has no history and never calls undo; rename it to its tested transaction contract or run an actual history round-trip. The lifecycle routing regression (`editorLifecycleController.test.ts:64-119`) describes save “rekeying” by replacing a note object and asserting a different handle (`:117`). Accepted architecture guarantees stable handles across save. Keep live-document callback routing as a navigation/lifetime test; update its name/setup/comment so it does not teach a forbidden save model, and retain the existing real identity-adoption runtime test.

### FE-10 — P2: make Markdown decoration performance testable, then redesign its hot path

**Confirmed full-scan implementation; performance impact not yet measured.** `markdown/markdownExtensions.ts:44-57` rebuilds for every selection/viewport change. `:71-83` walks the entire parsed tree and calls all eight decorators on every node; `:86-103` sorts and rebuilds all ranges. `editor/passiveTableExtension.ts:278-280` separately scans every document line on viewport change even though its table layout inventory is document-derived. A multi-pane note pays per-view decoration work despite shared authored content. Image inventory caches don't cover these paths.

`markdown.test.ts:94-124` correctly tests background tree publication, but the other cases invoke decorators one at a time with custom overlap, bypassing the composed plugin. `imagePerformance.test.ts` tests image selection reuse, not production Markdown/table rebuilds. The silent catch in `markdownExtensions.ts:76-81` hides any decorator exception, not just invalid partial-tree offsets; composed tests need to exercise failure scope.

**Substantial rewrite option:** immutable document/tree-derived block/inline inventory; pane-local conceal/selection overlay; update only changed blocks and old/new selection neighborhoods. As a lower-cost first step, cache passive table ranges on document identity, and avoid table decoration rebuild for viewport-only changes. Measure before choosing viewport-scoped rendering: block replacements, atomic ranges and multiline geometry impose constraints, so simply skipping offscreen ranges is not automatically correct.

**Migration/validation:** preserve background syntax publication, marker reveal, atomic nested indent/alias concealment, nonempty-selection highlight layering, task checkboxes, link widgets and measured presentation-before-reveal. Use deterministic visited-node/line counts for fast complexity tests and a separate opt-in real browser benchmark for 1/2/4-pane long notes. Compare rendered output and cursor navigation on existing editor-cursor/document fidelity cases. There is no demonstrated runtime threshold or justified global editor rewrite yet.

### FE-11 — P2: CSS/catalog assertions are weak evidence for visual behavior

`markdown/inlineFormatSpec.test.ts:22-78` copies most of the catalog verbatim; `:80-87` checks derived maps and `:90-96` searches for a class-name substring in CSS. Substrings can be present in comments or unrelated selectors and cannot prove computed styles; these checks couple tests to filenames while missing actual rendering. The explicit supported format set and shared delimiter mappings are real contracts and should survive a refactor.

**Recommendation:** keep a compact table for intended delimiter/node semantics and derived-map consistency; replace stylesheet substring searches with representative actual computed-style browser assertions at the existing rendered editor journey. Do not introduce screenshots for every delimiter. SSR `ExternalConflictResolver.svelte.test.ts` accurately checks warning/collision/busy copy but cannot establish interaction or focus behavior; preserve it as a content contract and rely on conflict workflow coverage elsewhere.

## Images and general UI

### FE-12 — P2/P3: separate algorithm regression from image scale measurement and fill lifetime gaps cheaply

`images/imagePerformance.test.ts:7-20` creates 500 images and runs 500 selection transactions in the default suite while merely logging timings. A pass establishes inventory reference reuse, not a latency target. `imageEmbedWidgets.test.ts:24-31` already checks same-pane inventory reuse in a small document, but large-input and cross-pane sharing are separate claims. `imageAssetLoader.test.ts:26-32` creates a 25 MiB string twice to check the budget; the count eviction case performs 130 async loads.

**Recommendation:** keep a bounded deterministic inventory-reuse regression (include two panes sharing the same Text), move full scale/logging to an opt-in benchmark, and permit private test configuration of cache budgets to exercise eviction with small inputs. Do not claim memory/runtime savings until root baseline or benchmark provides them.

The image browser suite already covers paste failure/retry and stale navigation, drag cancellation, viewer focus, source preview, sibling widget identity and reference preservation. These are intentionally richer than unit math tests. It would be unsafe to label image e2e as redundant. Unit coverage for `imagePaste.ts` state/job lifecycle is absent; port controlled deferred jobs into a focused extension-state harness for cancellation, changed range, partial success and read-only takeover while retaining a few DOM acceptance journeys. The dense one-line image implementations make cancellation/cleanup paths hard to inspect; format and split named pure state transitions before any ownership rewrite. Keep bytes cache document-owned and widgets/gesture/source state view-owned.

General UI pure helper tests (`listSelection`, menu keyboard, modifier hints, searchMatch) are short and valuable. Do not merge wrapping list navigation and clamped/grouped editor-menu navigation: their policies differ. Missing useful small cases are all-disabled/empty list selection, absent/edge group, navigation rejection and successful retry, corrupt pending-note JSON, and unsupported pending-note payload shape. `noteNavigation.ts:25-27` casts parsed JSON directly, so malformed-but-valid JSON is not validated by its single round-trip test. These are bounded follow-ups, not a reason to replace the navigation coordinator or introduce a general UI framework.

## Invariants and migration order

1. Fix FE-01/02 with controlled unresolved promises; no changes to authored content, canonical persistence or ownership.
2. Fix FE-04/05 and check task dirty-document/canonical warning pathways through their existing owners.
3. Replace regex context checks FE-07 with parser-consistent input admission; use real language states.
4. Consolidate test adapters FE-08/09 and strengthen FE-06/11 while retaining regression responsibility mapping. Delete tests only after equivalent behavior is established at the production boundary.
5. Isolate FE-12 scale work and collect actual metrics. Prototype FE-10 incrementally, beginning with table inventory caching. The broad decoration redesign needs real browser comparison and separate review.

Read: CONTEXT.md, ARCHITECTURE.md, docs/architecture/behavior-invariants.md, ADR 0007 and local issue/domain/triage instructions. Recommendations retain WorkspaceStore pane ownership, DocumentHandle identity, EditorDocumentRuntime undo/resource ownership, DocumentEditingService committed adoption, NoteTimeline canonical persistence, TaskMutationService canonical tasks, PaneTransientUiController transient exclusivity, measured readiness and authored-source image authority. Large boundary changes must reread linked applicable ADRs and update architecture evidence; this audit does not authorize replacing those decisions silently.

## Validation and limitations

No heavy suites were run by this agent; root owns baseline measurement. Transient Node probes compiled the actual TS/Svelte source and injected controlled external dependencies. Confirmed outputs: stale search, stale related empty reset, three post-disposal task subscriptions, completed-view corruption by stale task patch, and surround edit inside a parser-recognized longer code fence. Browser runtime/performance and native behavior remain unmeasured here. An initial task probe used the wrong relative import binding and was corrected; another allowed an unawaited full load to obscure the patch scenario, then the corrected probe awaited the newer full load. Only corrected outputs support findings.

Every unit test in the inventory below was read, not merely counted. Production implementations of direct test targets and key callers were inspected; very large DOM/controllers were additionally traced by entrypoints and targeted branches, not comprehensively line-reviewed. E2E files were searched for responsibilities and inspected around relevant behavior; exhaustive browser/native suite auditing belongs to root's separate test-infrastructure scope. No backend duplication claims are made. Performance cleanup remains a hypothesis where not explicitly measured.

## Reviewed test inventory

46 files, 5,269 lines. All test bodies reviewed.

- `src/lib/features/notepad/editor/blockHandleExtension.test.ts`
- `src/lib/features/notepad/editor/blockMoveUndo.test.ts`
- `src/lib/features/notepad/editor/dateCommands.test.ts`
- `src/lib/features/notepad/editor/editorCapabilities.test.ts`
- `src/lib/features/notepad/editor/editorChromeInset.test.ts`
- `src/lib/features/notepad/editor/editorDocumentRuntime.test.ts`
- `src/lib/features/notepad/editor/editorLifecycleController.test.ts`
- `src/lib/features/notepad/editor/editorMenuKeyboard.test.ts`
- `src/lib/features/notepad/editor/editorPresentation.test.ts`
- `src/lib/features/notepad/editor/editorViewState.test.ts`
- `src/lib/features/notepad/editor/enterKey.test.ts`
- `src/lib/features/notepad/editor/indentConfig.test.ts`
- `src/lib/features/notepad/editor/inlineFormatting.test.ts`
- `src/lib/features/notepad/editor/passiveTableExtension.test.ts`
- `src/lib/features/notepad/editor/searchHighlightExtension.test.ts`
- `src/lib/features/notepad/editor/selectionSurround.test.ts`
- `src/lib/features/notepad/editor/structuralIndentation.test.ts`
- `src/lib/features/notepad/editor/taskDateExtension.test.ts`
- `src/lib/features/notepad/editor/undoSelection.test.ts`
- `src/lib/features/notepad/images/imageAssetLoader.test.ts`
- `src/lib/features/notepad/images/imageCommands.test.ts`
- `src/lib/features/notepad/images/imageEmbedParser.test.ts`
- `src/lib/features/notepad/images/imageEmbedWidgets.test.ts`
- `src/lib/features/notepad/images/imagePerformance.test.ts`
- `src/lib/features/notepad/images/imageViewerModel.test.ts`
- `src/lib/features/notepad/markdown/inlineFormatSpec.test.ts`
- `src/lib/features/notepad/markdown/markdown.test.ts`
- `src/lib/features/notepad/related/store.test.ts`
- `src/lib/features/notepad/search/currentNoteSearch.test.ts`
- `src/lib/features/notepad/search/draftRef.test.ts`
- `src/lib/features/notepad/search/search.test.ts`
- `src/lib/features/notepad/search/searchReturnFocus.test.ts`
- `src/lib/features/notepad/search/store.test.ts`
- `src/lib/features/notepad/ui/ExternalConflictResolver.svelte.test.ts`
- `src/lib/features/notepad/ui/notepadCommandBarState.test.ts`
- `src/lib/features/notepad/wikilinks/state.test.ts`
- `src/lib/features/notepad/wikilinks/wikilinks.test.ts`
- `src/lib/features/tasks/openDocumentTaskMutation.test.ts`
- `src/lib/features/tasks/taskDates.test.ts`
- `src/lib/features/tasks/taskListStore.test.ts`
- `src/lib/keyboardShortcuts.test.ts`
- `src/lib/noteNavigation.test.ts`
- `src/lib/ui/listSelection.test.ts`
- `src/lib/ui/modifierHints.test.ts`
- `src/lib/ui/navigationCoordinator.test.ts`
- `src/lib/ui/search/searchMatch.test.ts`

## Production implementation inventory

Fully read production implementations: editorDocumentRuntime, editorExtensions, editor facade, selectionSurround, inlineFormatting, passiveTableExtension, editorMenuKeyboard, editorDispatch and editorPresentation; Markdown extension composition and all decorators; imageAssetLoader, imagePaste and imageState; search store/draftRef/search IPC/currentNoteSearch/recent/searchReturnFocus; related store/layout; wikilinks state/runtime/plugin; taskListStore/openDocumentTaskMutation/taskDates; general UI listSelection/navigationCoordinator/modifierHints/mobileViewport/searchMatch and noteNavigation.

Targeted branch/caller inspection or interface/import review, not comprehensive line review: structuralIndentation, dateCommands/taskDateExtension, Markdown custom parsers/catalog/language assembly, imageEmbeds/parser/widgets/viewer model, wikilink parse, taskMutationGateway, editorLifecycleController, editorViewController, editorViewState, editorCapabilities, blockTypes, blockHandleExtension, slashMenu/selectionMenu controllers, editor presentation/theme/CSS, NotepadCommandBar.svelte, ImageViewer.svelte, task route, keyboardShortcuts.svelte.ts, RelatedPanel/RelatedPanelHost, date picker, navigation/openFlow, pane/document orchestration call sites. These were traced to establish ownership and finding applicability.

E2E responsibility inventory: browser document-and-pane.spec.ts, editor-cursor.spec.ts, selection-menu.spec.ts, dates.spec.ts, image-interactions.spec.ts, window-resize.spec.ts, pane-animation.spec.ts; native image-interactions.spec.ts. No blanket e2e deletion recommended.

## Coverage reconciliation supplement

Completed after the initial report and first implementation tranche. This supplement is a static review only; no source/test changes or additional test execution. Three additional frontend test files (10 tests, 159 lines) and their complete direct production targets were read. The original inventory is the initial audit snapshot; the reconciled frontend inventory is 49 files. Search/related tests have since changed, so the original total line count is not a current repository count.

- `src/lib/features/notepad/paneCommandPicker.test.ts` and `paneCommandPicker.ts`: all five tests and full target reviewed. Ordered shared choices, mode-specific numeric slots, unavailable previous-note choices and enabled-choice navigation have compact, meaningful coverage. Although navigation uses the separately tested `listSelection` helper, these tests establish the picker-specific mapping and disabled slots; retain them. Invalid indices/keys and DOM option IDs are small optional additions, not grounds for expanding or rewriting this suite. Inspected callers/references in the picker/split button and workspace choice controller.
- `src/lib/appSettings.svelte.test.ts` and `appSettings.svelte.ts`: both tests and full target reviewed. Tests establish backend acknowledgement before visible retention updates and canonical backend loading despite stale local storage. The dynamic import/resetModules boundary is justified by the module-owned singleton and serialized retention operations. Retain these tests.
- `src/lib/editorTextSize.test.ts` and `editorTextSize.svelte.ts`: all three tests and full target reviewed. Current cases test pure preset/custom scaling only, with modest overlap and no demonstrated inefficiency. Inspected the settings panel caller.

### FE-13 — P2: retention preference tests omit the operation queue contract

Evidence: `appSettings.svelte.ts:88-106` chains reads and writes through `retentionPreferenceWrite`, explicitly recovers a rejected prior operation, and commits visible state after backend acknowledgement. `appSettings.svelte.test.ts:25-64` exercises one write and one independent load, without overlap or rejection. This is a coverage gap, not a reproduced defect.

Recommendation: add a small deferred-promise sequence covering queued set/set and load/write ordering, failure retaining the last acknowledged preference, and a subsequent operation proceeding after rejection. Include an invalid backend preference result remaining uncommitted. Do not merge retention into local preference persistence: its backend authority and acknowledgement semantics are intentional. Existing `vi.waitFor` can optionally become an explicit invocation signal when introducing this harness; polling here is not evidence of a material suite performance problem. Confidence: high on missing local test coverage, no runtime defect claimed.

### FE-14 — P2: typography tests never cross the persistence/CSS boundary

Evidence: `editorTextSize.test.ts:9-27` calls only `resolveEditorTextSizes`. The store seeds custom settings from the active preset (`editorTextSize.svelte.ts:92-104`), switches to custom after direct edits (`107-117`), normalizes/clamps values (`194-205`), reads malformed storage defensively (`223-267`), and applies seven CSS variables (`208-220`). None of those paths are asserted in this file.

Recommendation: use a fresh module singleton with a tiny localStorage map and document style spy to cover custom seeding, normalization boundaries, corrupted storage defaults and CSS/persistence updates. One expected property map is clearer than separate repetitive heading tests. Retain pure scaling tests; a representative computed-style browser test remains useful under FE-11. Preserve saved preference keys, step sizes and current preset values. No production rewrite is justified by this small module alone. Confidence: high on the coverage gap; browser appearance remains unmeasured.

### Focused Rust task-date supplement

Fully read `src-tauri/src/services/task_dates.rs` (417 lines), all six inline Rust tests, and all 23 entries of `src-tauri/test-fixtures/contracts/task-dates.json`. Traced the evidence metadata caller (`services/evidence.rs:1149`) and searched evidence tests for task-date assertions. This is a focused portable-date/metadata review, not a renewed audit of the complete Rust evidence subsystem.

The shared-fixture test (`task_dates.rs:308`) deliberately checks the same authored Markdown/date contract as the frontend `taskDates.test.ts`; this is valuable cross-language parity, not duplicate test waste. Strict Gregorian validation, protected inline code/link/escaped syntax, duplicate annotation cleanup, nested/ordered/plus checkbox recognition, fenced-code exclusion, CRLF/Unicode/children preservation and hardbreak/unfinished-code behavior each have distinct responsibilities. The unique-text canonical edit (`257-289`) intentionally ignores the legacy projected line number and rejects ambiguous/missing tasks. Preserve that identity rule and source-preserving edit behavior in any future unification.

The metadata test (`295-305`) covers parser-recognized checkbox lines that cannot be projected and the resulting `complete:false`. `passage_task_dates` (`180-206`) also has unasserted successful item serialization, byte clipping, the 16-item ceiling and the no-items/null boundary. No direct assertions for these metadata branches were located in the searched evidence tests. Add a compact boundary table for full versus clipped passages, exactly 16 versus 17 tasks, completed/effective due-date fields, UTF-8/CRLF offsets and no eligible markers. This would test an external evidence contract rather than copying the scanner. Priority P2; confidence high for the local coverage gap, no reproduced Rust defect or production rewrite recommended.
