# Editor, discovery, navigation, images, and task frontend audit

Status: needs-triage
Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`
Audit date: 2026-10-02 (America/Denver)
Scope: existing tests and their targets, not a branch diff. No production/test source was edited during this audit.

## Assessment

The strongest cleanup is to replace duplicated editor simulations with a small faithful command/runtime harness, repair asynchronous response admission, and move navigation from rendered DOM matching to document coordinates. Most small Markdown and date tests are useful; deleting them wholesale would remove inexpensive regression protection. The problematic test distribution is many helper-level assertions and mocked orchestration calls beside relatively little direct coverage of asynchronous lifetimes, real editor composition, and coordinate conversion.

Architecture/standards sources: `CONTEXT.md`, `ARCHITECTURE.md` (canonical owners and frontend state coordination), `docs/architecture/behavior-invariants.md` (workspace/navigation, tasks, images), ADR 0007, repository `code-review` and `codebase-design` skills. Maintain the document-owned shared undo root and pane-owned selection/viewport/transients. Task authored mutations must still pass through dirty-open-document preparation and ordinary save or the canonical backend mutation seam. No recommendation below calls for removing these consistency boundaries.

## Confirmed findings and specific test replacements

### ED-01 — Shared editor batch synchronization is not exercised faithfully (P2, correctness plus test design)

Evidence: `src/lib/features/notepad/editor/editorDocumentRuntime.ts:134` accepts a transaction array, updates the source pane, and advances the root sequentially. At `:318–334`, sibling updates are all constructed from the same unchanged `controller.view.state`. Two sequential edits that change length therefore apply the second change set to the wrong document length; equal-length changes also create transactions whose start states do not form a chain. The production `editorViewController.ts:126–131` supplies this array directly from CodeMirror's `dispatchTransactions` callback.

The fixture in `editorDocumentRuntime.test.ts:37–47` simply assigns each `transaction.state` and does not enforce CodeMirror's start-state invariant. `images/imageCommands.test.ts:13` repeats the permissive fake. All ten runtime tests pass single document-changing transactions. `undoSelection.test.ts:50–68` duplicates the root synchronization algorithm instead of calling the owning runtime, so a regression in runtime ordering can leave those tests green.

Read-only reproduction using installed CodeMirror state: construct `ab -> abc -> abcd`, then execute the exact existing `transactions.map(t => firstState.update({ changes: t.changes }))` expression. It throws `Applying change set to a document with the wrong length`. This proves the expression-level defect; no browser gesture producing a multi-transaction batch was exercised, so user-event frequency is unmeasured.

Recommendation: build each sibling transaction from the previous sibling transaction's resulting state; preserve one markdown callback and pane viewport rules. Replace the copied undo-forwarding scenarios with tests through `EditorDocumentRuntime`: batched insertions, equal-length edits, selection-only transactions interleaved with edits, undo from a different pane, save identity adoption, and Version Restore. Use a shared state-backed harness that rejects mismatched start states. Keep one real mounted editor integration scenario for dispatch, extension composition, keyboard undo, and sibling viewport preservation. Do not delete the Version Restore or save-identity tests.

Risk: medium. Transaction annotations and selection history are product behavior, not incidental implementation.

### ED-02 — Task list lifecycle and response admission need one owner (P2, correctness)

Evidence: `src/lib/features/tasks/taskListStore.svelte.ts:418–437` attaches app subscriptions when asynchronous bootstrap resolves. Its disposer at `:440–448` has no lifetime flag/generation, so navigating away before bootstrap completes removes nothing; the later continuation attaches listeners to the retired store. `src/routes/list/+page.svelte:130` returns that disposer from mount. The bootstrap chain also has no rejection handler.

Separately, full `load()` has request correlation, but `refreshGroup()` at `:184–195` and mutation patch application at `:165–181` do not. A group request started under `filter='all'` may resolve after a newer `filter='open'` load and replace the current group's tasks with the old view. Two refreshes for one note can arrive in reverse order. `reorderNote()` at `:328–351` restores a captured whole groups array after failure, potentially overwriting a later load/reorder. These all originate from the same missing view/lifetime admission rule.

`taskListStore.test.ts` currently has five scenarios, chiefly route/call assertions and date filtering; none initialize/dispose the store or reverse the completion order of loads/group refreshes/mutations. The warning test at `:95–124` only asserts the message is not the generic failure, so it does not prove synchronization status survives the background load.

Recommendation: keep the mutation gateway; place view revision, per-note refresh revision, disposal, and mutation result admission behind TaskListStore. Snapshot filter/showHidden with requests; reject obsolete projections without retrying a committed mutation. Replace repeated toggle/delete/due-date happy-path call checks with a parameterized mutation contract plus deterministic deferred-response scenarios: dispose-before-bootstrap, bootstrap failure, old filter refresh, same-note reversed refresh, mutation warning, concurrent reorder failure, and refresh after disposal. Preserve explicit distinction between committed warning and retryable write failure.

Risk: medium. Ignoring a stale UI patch must not discard durable success or issue the canonical mutation again.

### ED-03 — Discovery request invalidation is inconsistent during debounce/reset (P2, correctness)

Evidence: `search/store.svelte.ts:306–321` immediately publishes the new query but increments `#activeSearchRequest` only for empty input; a nonempty replacement receives its new identity later in `runSearch()` at `:128`, after the 120 ms debounce. An old response completing in that window is accepted as results for the new displayed query. In `related/store.svelte.ts:64–69`, `resetRelatedResults()` clears items but does not invalidate an in-flight request. `runRelatedNotes():165–175` calls this reset for missing selection/empty content, so an old response may repopulate results after the reset and remain authoritative indefinitely until another request starts. `scheduleRelated():150–156` similarly leaves an older request current while its replacement waits.

The two related-store tests only prove that Markdown reads are delayed while collapsed/scheduled. Their fake timer records one callback rather than exercising cancellation or request ordering. The search suite covers debounce, explicit clear, and recent-note races but not nonempty query replacement while a prior request is in flight.

Recommendation: invalidate ownership when input/context becomes obsolete, not only when replacement I/O starts. Keep current results during typing only if explicitly associated with the resolved query; never relabel an accepted old result with new input. Use fake timers plus deferred promises for query A/new query B, reset-to-empty content, selected text replaced, collapse/disposal, error-after-newer-success, and latest request identity. Consolidate the duplicated `loadRecentNotes`/`#refreshRecentNotesNow` and task equivalents only after their intentionally different return contracts (null vs items) are preserved.

Risk: low to medium. Delay tuning and result retention policy need explicit assertions.

### ED-04 — Current-note excerpt offsets disagree with the renderer (P2, correctness)

Evidence: `search/currentNoteSearch.ts:41–56,94–104` derives excerpt ranges from CodeMirror/JavaScript UTF-16 offsets. `ui/notepadCommandBarState.svelte.ts:81–95` converts text with `Array.from` and interprets ranges as Unicode code-point indices. For excerpt `💡 needle`, the generated start is 3; the renderer highlights `eedle`, not `needle`. With cropping near an astral character the excerpt can also split a surrogate pair.

Read-only Node reproduction of the exact index/slice operations produced `{ matchStart: 3, actual: 'eedle' }`. Existing current-note tests use ASCII, and `notepadCommandBarState.test.ts` never tests `buildHighlightedSegments`.

Recommendation: define and document the UI `highlightRanges` coordinate contract, convert current-note excerpt offsets to it, and retain `currentMatchRange` as CodeMirror UTF-16. Add one integrated result-builder-to-segment test with emoji before/inside matches, cropped lines, and multiline text. Check the backend's range contract before changing the renderer globally. Keep the existing frontmatter/body offset and whole-word tests.

Risk: low for a local conversion; high if all backend/UI offsets are reinterpreted without checking their units.

### ED-05 — Offscreen destinations still depend on visible DOM (P2, correctness plus justified larger rewrite)

Evidence: `navigation/openFlow.ts:134–139` passes only `sectionLabel` and `matchText`, ignoring search `startLine/endLine`. `navigateToSectionTarget():68–73` searches DOM and silently returns when absent. `navigation/navigation.ts:123–149` only queries mounted `.cm-line` elements. CodeMirror virtualizes long documents; a match outside the restored viewport has no DOM target. The same path serves related notes and resolved wikilinks. Recent-task navigation at `openFlow.ts:153–166` forwards `lineNumber` but no `editorLineNumber`; only the latter activates the coordinate route at `:98–100`.

`interaction/navigationSelectionController.test.ts:43–62` mocks `openSearchResult` and `openRecentTask` entirely. `locationMru.test.ts` tests correct MRU behavior, not actual destination resolution. No direct tests of `openFlow.ts` or `findBestEditorTarget` were found. Current-note search already takes the healthier exact-range path in `navigationSelectionController.ts:72–84`.

Recommendation: replace DOM/plaintext normalization fallback as primary navigation with a document target resolver returning a line/range tied to current note identity. Verify target text against current editor content, then ask CodeMirror to reveal it; keep semantic-only navigation's no-focus rule and title-only remembered-position behavior. Do not naïvely treat canonical file line numbers as editor line numbers; metadata/frontmatter offsets differ. Add a browser case opening a result near the end of a long note with its saved viewport at the beginning, duplicates of the same text, stale results after editing, related/wikilink entry, and title/semantic behavior. Then delete redundant DOM matching and normalization code once its replacement owns every caller.

Risk: medium/high; worth a dedicated module-level change, not a tiny test-only cleanup.

### ED-06 — Async custom cut-line deletes the current block after copying an older block (P2, correctness)

Evidence: `editor/editorShortcuts.ts:130–139` captures block Markdown before `navigator.clipboard.writeText`, then calls `deleteCurrentBlock(view)` on completion without checking the document, selection, pane lifetime, or read-only state. A custom cut-line binding followed by a caret move/typing while clipboard permission/I/O is pending can copy one block and delete another. The default native-cut branch bypasses this code, so exposure is specifically the custom non-native shortcut path. The image cut branch in `images/imageEmbeds.ts` already captures document/lifetime before its asynchronous clipboard write.

No `editorShortcuts.test.ts` exists. `blockMoveUndo.test.ts` covers the lower-level block operation only; it cannot detect delayed shortcut targeting.

Recommendation: capture a stable block/document operation before clipboard I/O and reject or safely map stale completion. Add deferred clipboard scenarios for selection move, typing, runtime swap, destruction, rejection, and unchanged successful cut. Share a guarded async edit mechanism only if image/block commands genuinely have the same contract; do not introduce a generic command framework just to remove a few lines.

Risk: low to medium. Cancellation should retain text; a successful copy is harmless if deletion becomes stale.

## Cleanup/design judgments (not measured regressions)

### ED-07 — Replace duplicate ad hoc Markdown scans where semantic authority already exists

Confirmed duplication: `editor/selectionSurround.ts:24–51` and `wikilinks/wikilinks.ts:31–56` both enumerate full-document line starts and toggle a boolean at every fence-looking line. They do not distinguish fence characters or opening length, so a shorter backtick sequence inside a longer fenced block toggles the scanner incorrectly. `editor/passiveTableExtension.ts:33–83` identifies tables from raw lines and has no code-fence exclusion, so table-shaped examples inside code are classified as tables. The editor already installs the shared Lezer Markdown language.

Recommendation: use a small syntax-context query from the installed grammar for “may edit prose here” and real table nodes where possible, with bounded parse-completion behavior for long notes. Remove the two hand-written fence scanners after covering four-backtick fences containing triple backticks, tilde/backtick mixing, blockquote/list fences, inline/indented code, and incomplete input. Preserve separate image destination containment checks; they defend a different boundary. Keep the Rust/TS task-date parsers' shared fixture parity tests: cross-language implementations are justified, not duplicate tests to delete.

Existing gaps: selection-surround covers one simple fenced block; wikilink tests cover parsed/resolved links in code but never invoke the input auto-close handler; passive table tests cover only raw happy/invalid pipe lines. The small test helpers are cheap and should remain after adding composition cases.

### ED-08 — Move costly lifecycle enumeration out of browser journeys, retaining real layout/native checks

`images/imageCommands.test.ts` and `editorDocumentRuntime.test.ts` repeat incompatible EditorView fakes; formatting, surrounding, indentation, dates, and block undo each have local state/dispatch simulators too. Prefer one narrowly scoped headless command harness, one shared-runtime harness, and browser tests for actual DOM behavior. Do not force geometry, Svelte lifecycle, and simple transforms through one giant harness.

`e2e/specs/browser/image-interactions.spec.ts:170–185` uses a 1000 ms delayed save plus `pause(1100)` to prove retired-view safety. This can become deterministic through a released backend promise and a completion signal. Extract upload coordination behind a small view-scoped operation seam so failure/retry, overlapping range mutation, cancel, destruction, read-only takeover, and late completion can be enumerated quickly. Keep browser checks for clipboard event integration, drag geometry, viewer focus restoration, and sibling widget stability. Keep `e2e/specs/native/image-interactions.spec.ts` as the real WebKit/native persistence smoke; browser fake-backend coverage is not its replacement.

`imagePerformance.test.ts:7–20` is a useful cache-identity invariant but its 500 selection-update iterations plus console timings are not a benchmark with a regression threshold. Rename/move the timing probe to a focused benchmark; retain a few representative selection updates in the ordinary unit invariant. Benchmark full edit and sibling-pane update cost before optimizing.

`markdown/markdownExtensions.ts:59–83` walks the entire available syntax tree, trying eight decorators for each node; `:41–51` repeats this on selection/viewport changes. `imageEmbeds.ts:87–105` rebuilds every image decoration on selection/effects. These are identifiable work multipliers, not evidence of user-visible slowness. Measure long-note typing, selection, and scrolling (one/two panes) before considering cached syntax inventories or visible-range rendering. Preserve block-widget layout correctness while optimizing.

### ED-09 — Replace mirrored data-shape tests with contracts and add the missing boundary cases

`markdown/inlineFormatSpec.test.ts:22–77` copies nearly the entire production catalog into the expected value; `:80–87` tests maps derived directly from that same catalog; `:90–96` checks that a class name occurs somewhere in a stylesheet. The latter can pass for a comment/dead selector and does not prove a user-visible format. Replace the full catalog copy with uniqueness/required-format invariants and parameterized command -> parser -> decoration behavior. Keep a small browser style assertion for properties that matter (e.g. code font, selection layering); do not snapshot every CSS declaration.

`editor/undoSelection.test.ts` can shrink materially after ED-01 moves its meaningful regression cases to the runtime seam. Keep direct transform tests in `inlineFormatting`, `selectionSurround`, `dateCommands`, and `structuralIndentation`; their fixtures overlap syntactically but exercise distinct commands.

`navigation/locationMru.test.ts:40` claims “dedupe and cap” but only touches two notes. Add a >20-note overflow case, seed-when-already-at-cap case, and migration failure coverage if legacy localStorage migration remains. `loadPersistedChatLocation()` currently clears legacy storage even if `persistChatLocation()` swallowed a write error; consider removing legacy migration only with an explicit compatibility decision, or preserve legacy on failed migration. This migration concern was inspected statically but not reproduced.

`wikilinks/state.test.ts` only checks four IPC payload shapes despite the module also owning begin/complete/dismiss/select transitions. Keep one parameterized payload contract per draft-aware endpoint; move repeated first/subsequent cache behavior to `search/draftRef.test.ts`, and add state/runtime scenarios for stale completion after dismiss, query replacement, note switch, and suggestion insertion. Add at least one real autocomplete interaction that traverses extension -> runtime -> state -> insert command.

## Coverage ledger

This is an exhaustive inventory of the scoped unit-test files, not a claim that every production line was exhaustively proven. Tests were inspected statically; production call paths are classified below. Parent audit owns full-suite metrics and other frontend/backend modules.

| Module | Unit test files reviewed | Production depth / recommendation |
| --- | --- | --- |
| Editor runtime/lifecycle/capability | `editorDocumentRuntime`, `editorLifecycleController`, `editorCapabilities`, `editorPresentation`, `editorViewState`, `editorChromeInset` | Runtime, view controller, lifecycle controller, extensions, capability, view-state storage inspected. Presentation/geometry internals sampled against tests. Preserve boundaries; replace permissive fakes and copied algorithms. |
| Editor commands | `blockMoveUndo`, `dateCommands`, `enterKey`, `indentConfig`, `inlineFormatting`, `selectionSurround`, `structuralIndentation`, `undoSelection` | Shortcut, surround, root/pane wiring inspected; block-type/indent/format implementations sampled through exported seams and tests. Keep pure behavior cases; replace copied undo plumbing. |
| Editor visual helpers | `blockHandleExtension`, `editorMenuKeyboard`, `passiveTableExtension`, `searchHighlightExtension`, `taskDateExtension` | Table parsing and shortcut/date composition inspected; block/menu geometry and date rendering sampled. Unit geometry complements browser checks. |
| Markdown | `inlineFormatSpec`, `markdown` | Language/extension bundle, decorator dispatch and test contracts inspected; individual decorators sampled. Retain behavior; remove catalog mirrors after replacement. |
| Images | `imageAssetLoader`, `imageCommands`, `imageEmbedParser`, `imageEmbedWidgets`, `imagePerformance`, `imageViewerModel` | Loader, paste lifecycle, embed controller, state, shared resources inspected. Parser/widget/viewer internals sampled; DOM lifecycle/gesture paths matched to browser tests. Keep safety/undo/cache contracts; add deterministic async owner cases. |
| Search | `currentNoteSearch`, `draftRef`, `search`, `searchReturnFocus`, `store` | Entire local result builder, IPC/draft adapter, store and focus contract inspected; recent collection helper inspected through callers. Fix units/admission, consolidate payload duplication. |
| Related | `store` | Store and layout/request-key module inspected. Only two timing/read-avoidance tests exist; race coverage is missing. |
| Wikilinks | `state`, `wikilinks` | State, runtime, input extension, parser and interaction call path inspected; Svelte autocomplete display sampled. Preserve alias/source offsets; add runtime/auto-close behavior. |
| Navigation | `locationMru` | MRU implementation, openFlow, DOM-target navigation and navigation selection controller/tests inspected. Replace DOM targeting, keep MRU behavior. |
| UI | `ExternalConflictResolver.svelte`, `notepadCommandBarState` | SSR rendering contracts and command bar controller/highlight conversion inspected. Full component markup/styles sampled. SSR tests do not prove click behavior; retain browser ownership coverage. |
| Tasks | `openDocumentTaskMutation`, `taskDates`, `taskListStore` | Entire mutation handler/gateway, dates/parser and list store inspected. DateTimePicker owner inspected, component commit/close/positioning sampled. Preserve backend parity and dirty-document mutation seam; strengthen lifecycle tests. |

The inventory contains 41 scoped test files, approximately 5,147 test lines (before any implementation changes). Names in the table omit `.test.ts`; UI `.svelte` name means `.svelte.test.ts`.

Browser test bodies inspected most deeply: `image-interactions.spec.ts`; browser `dates`, `due-date-scroll`, `editor-cursor`, `selection-menu`, `editor-formatting-load` inventoried by cases and sampled. Native image interaction smoke inspected by scenario; native harness/default execution selection belongs to parent. Navigation interaction test bodies were additionally reviewed to verify the mocked seam. No browser/native suite was executed by this sub-audit.

Validation: read-only Node probes reproduced the CodeMirror change-set length failure and Unicode offset mismatch. Initial attempt failed because packages were absent; repeated successfully after parent installed locked dependencies. No existing tests were changed or executed by this sub-audit, avoiding overlap with the parent's baseline run. Findings about request/lifetime ordering are deterministic static traces and need focused regression tests before fixes. No test deletion is authorized by this report alone; every removal above names replacement coverage.

## Recommended implementation order

1. Correct ED-01, ED-02, ED-04, ED-06 with focused regression cases; these have concrete failing inputs/lifetimes.
2. Correct ED-03 and strengthen async discovery tests; decide whether retained results are explicitly tied to their resolved query.
3. Replace copied runtime test algorithms and payload/catalog mirrors only once owner-level cases pass.
4. Implement ED-05 as a coordinated navigation module change, then remove DOM matching code.
5. Consolidate grammar-context scans (ED-07), followed by measured rendering performance work and deterministic browser waits (ED-08).

No broad rewrite of the editor/document ownership model is recommended. The concrete large rewrite opportunity is destination resolution and the concrete test reduction opportunity is replacing simulations/mirrored contracts, not eliminating independent behavioral cases.

## Independent follow-up: bootstrap listener disposal

### ED-10 — Staged AppStore listeners escape disposal in two interleavings (P2, confirmed by production-method probe)

Additional scope requested by parent: `src/lib/app/appStore.svelte.ts` and its seven tests were inspected in full. These are additional to the original 41-file ledger above.

1. **All four listeners complete while payload is pending.** `bootstrap():101–103` retains the unlisteners only in local `attemptListeners`. `dispose():139–143` detaches only admitted `#unlisteners`; staged listeners are not there. When payload succeeds, `:112` returns on generation mismatch without releasing the staged listeners. All four native listeners remain registered, although their generation guard prevents delivery.
2. **Some listeners complete before disposal, others later.** `#createListeners():250–257` unregisters only the attachments whose own promise completes after the generation changed. Previously fulfilled unlisteners survive. Once all attachments settle, `:287` returns an empty admission without releasing the previously attached subscriptions. This loses their cleanup handles. The existing reentry test at `appStore.svelte.test.ts:42–50` actually exercises this ordering with three immediately resolved listeners and one delayed listener, but asserts cleanup only for the delayed listener's spy; the other three leaks remain invisible.

Reproduction (read-only): transpiled the current production TypeScript source in memory with TypeScript, supplied mocked imported collaborators and identity `$state` (reactive tracking is irrelevant to listener ownership), invoked the real `bootstrap`, `dispose`, and private listener methods, and controlled payload/listener promises. Results:

| Ordering | Unlisten calls immediately after dispose | Calls after all promises complete |
| --- | --- | --- |
| Four listeners complete, payload pending | `[0, 0, 0, 0]` | `[0, 0, 0, 0]` |
| Three listeners complete, fourth and payload pending | `[0, 0, 0, 0]` | `[0, 0, 0, 1]` |

In both cases `ready` correctly stayed false; state invalidation is therefore protected while resource cleanup is not. This is not a claim that stale events alter the new store: the generation check at `:252` prevents that. Repeated teardown/reentry accumulates native subscriptions and retained closures; disposal also cannot immediately release an early completed listener if another listen call never settles.

Recommendation: give each bootstrap attempt an owned staged-listener collection registered for disposal as each attachment succeeds; release it exactly once on retirement/failure and transfer ownership on admission. Guard against double-unlisten when late successful attachment and aggregate failure overlap. Extend the existing disposal test rather than adding another superficially similar one: use distinct spies for all four channels and a completion-order matrix covering none/some/all attached before disposal, successful/rejected payload, one failed late attachment, and a new admitted generation. Preserve ready gating and per-slice snapshot admission tests. Risk is low/medium; listener ownership must change without admitting queued obsolete events. No production or test files were edited for this follow-up.
