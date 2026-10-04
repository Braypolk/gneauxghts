# Editor, tasks, and discovery remediation

Status: ready-for-agent
Progress: complete; final integrated acceptance recorded in validation.md
Baseline audit: `.scratch/test-suite-audit/reports/editor-and-discovery.md`; Sol `frontend-editor.md` and local `sol-comparison.md`.
Scope: ED01–09 and FE01–12. ED10/AppStore and FE13–14/settings belong to the UI agent; navigation operation correlation belongs to the documents agent; Rust and e2e belong to root. No commits or full-suite runs were made here.

## Planning and ownership

Detailed issues 30–39 were written before this implementation. Existing bounded ED01 fix was retained. Both audits and architecture invariants were reviewed. Sol search/related changes were transferred only after checking those four paths had no local overlap. Navigation interfaces were coordinated directly with the documents agent; its open-flow code now calls the full-document adapter. No second persistence owner was introduced.

## Disposition by finding

| Findings | Disposition and evidence |
| --- | --- |
| ED01 / FE08 | Implemented. `editorDocumentRuntime.ts` chains sibling transaction start states. `testSupport.ts` enforces those states and routes all edits through the real runtime. Runtime tests cover length-changing/equal-length/interleaved batches, sibling viewport and callback semantics. `undoSelection.test.ts` now uses the runtime for deep heading/list cursor cases; the copied root algorithm was removed. One focused forwarding test retains selection, userEvent, addToHistory and isolateHistory contracts. Existing save-identity/Version Restore tests retained. |
| ED02 / FE04–06 | Implemented. TaskListStore owns initialization lifetime, request/view and per-note projection tickets, plus full-load admission against intervening patches. Late bootstrap subscriptions and loads cannot revive disposed stores; bootstrap rejection is handled. Reinitialization disposes prior subscription/calendar lifetime. Metadata and authored mutation responses are admitted against their original view; successful obsolete writes request a current projection and are never repeated. Reorder rollback requires the same request/lifetime and unchanged optimistic groups. Toggle/delete/due-date orchestration consolidated with explicit due-date rejection. Exact committed-warning, key cleanup, stale-filter/reversed-response/reorder/disposal tests replace the weak warning assertion. Prepare tests add target/hash mismatch, conflict during prepare, retry exhaustion, replacement failure/attribution cancellation, and save failure retaining authored work. Calendar fake timers are cleaned in hooks. |
| ED03 / FE01–03 | Implemented. Reconciled Sol debounce/reset admission repairs and deferred tests. Recent note/task acquisition duplicated code is consolidated while authoritative null vs successful empty semantics remain explicit. Superseded forced-navigation refreshes now return no item instead of opening stale data. `handleSearchOpen` returns its existing completion promise, removing triple-microtask polling. Obsolete SearchItem fixtures replaced. Search/related/retrieval endpoint payloads are tested independently; bounded draft cache-miss retry remains covered by the existing protocol suite. |
| ED04 | Implemented. Current-note excerpt cropping now uses Unicode code points and cannot split surrogate pairs; editor match positions remain UTF-16. Tests cover emoji before/inside matches and cropped long lines. Backend scalar-index renderer contract is unchanged. |
| ED05 | Implemented with documents agent. `navigation.ts` resolves full immutable document text, verifies optional line hints, supports normalized multiline paragraphs, and rejects ambiguous matches. Reveal uses CodeMirror scroll effects, which work without rendered target DOM. Semantic reveal preserves selection/focus. Old mounted-line matcher and DOM-target helper removed after caller migration. Documents agent owns post-open/current-operation checks. Root owns offscreen rendered browser confirmation. |
| ED06 | Implemented. Custom asynchronous cut captures the document, selection, controller/pane/runtime identity, connected lifetime and read-only/composing state. Stale completion copies but does not delete another block. Six deferred success/selection/edit/owner/destruction/rejection tests call the actual cut operation. Native default cut path remains intact. |
| ED07 / FE07 | Implemented. Both boolean fence scanners removed. Input commands use the installed Markdown parser with a bounded parse budget and decline optional edits if context is unavailable. Shared table code ranges reuse a complete published grammar tree or a cached complete parse keyed by immutable Text. Four-backtick/short fence, mixed fence, quoted/list/indented/inline code and actual wikilink input handler are covered. Table-shaped fenced examples are excluded. No new regex Markdown grammar. |
| ED08 / FE09 | Implemented. Separate small state-backed command and runtime pane adapters replace fakes in formatting, surround, block undo, indentation, task toggles, capabilities, dates and image commands. Dispatch validates sequential transaction start states; command fixtures do not simulate layout. Misleading save-rekey lifecycle test is now named/documented as navigation to another document; real stable-handle identity adoption coverage remains. Capabilities test describes the authored transaction it actually proves. |
| ED08 / FE12 | Implemented. Image upload StateField/mapping and async runner extracted into `imageUpload.ts`; widgets and view lifetime remain in imagePaste. Seven deterministic tests cover partial success/retry, no duplicate stores, cancellation, overlapping edits, retirement, read-only takeover, external reset, range mapping and single undo. Default inventory test retains reuse assertions with three selection updates; scale loops live in opt-in `.bench.ts`. Loader default budgets unchanged; tests inject small entry/byte limits instead of 129 entries/25 MiB allocations. Root retains browser/native clipboard, geometry and viewer checks. |
| ED08 / FE10 | Bounded optimization implemented; larger incremental rewrite not justified by current evidence. Markdown and table inventories no longer rebuild solely because the viewport changes. Markdown still reacts to selection and background tree publication. Unexpected decorator exceptions are no longer silently swallowed; only structurally invalid tree offsets are skipped. Scoped benchmark below measures full rebuilds; no claim of end-to-end browser speedup. |
| ED09 / FE11 | Implemented. Mirrored full catalog and stylesheet substring assertions removed. Compact required-format uniqueness plus command→actual parser→composed decoration→unwrap tests retain behavioral coverage. Composed plugin export is the same function used by production. Root owns representative computed-style browser assertions. |
| ED09 (MRU/wiki) | Implemented. MRU now tests exceeding 20 entries and fixes seed-when-already-full overflow. Failed legacy SQLite migration retains its localStorage source. Wikilink replacement requests clear stale suggestions; runtime only inserts a currently offered suggestion. Tests cover reversed completion, dismissal, alias, keyboard insertion and cycling. |

The shared Rust/TS task-date fixtures and SHA-256 vector are retained as cross-language contracts. Task-date passage clipping/serialization is Rust-owned and assigned to root; no frontend reimplementation exists to consolidate. Existing geometry/native tests were not deleted or claimed redundant.

## Measurement and rewrite decision

Opt-in command: `pnpm exec vitest bench src/lib/features/notepad/markdown/markdownDecorations.bench.ts --run`.
Raw output: `editor-decoration-benchmark.txt`. Fixture: 54,890 UTF-16 units, 500 headings/paragraphs/tables, completed syntax tree. Measured in Node on this host: one-pane rebuild mean 1.70 ms; two-pane rebuilds 3.43 ms; table scan 0.43 ms; standalone cold code-context parse 4.43 ms. Cached context is identity reused; input handlers now query their installed parser rather than performing that cold parse. Complete published trees are reused by table context.

This establishes linear work and a removable redundant viewport trigger. It does not establish a typing/scrolling browser regression, layout cost, or a safe viewport-only replacement scheme. A wholesale incremental overlay/cache rewrite is therefore specifically not justified by this evidence; this is a disposition, not a size-based deferral. Benchmark files remain opt-in for future measured changes. Image benchmark likewise stays separate from correctness tests.

## Validation

- Scoped editor/image/Markdown/search/related/wiki/navigation/task sweep: **44 files, 341 tests pass**. Full output `editor-focused-tests.txt`. Runtime uses real CodeMirror state and history.
- After the final parser-context reuse refinement: **4 files, 33 tests pass** (code context, surround, wikilink handler, passive tables).
- Svelte typecheck after final parser changes: **0 errors, 0 warnings** (`/tmp/editor-check-final.log`).
- `git diff --check` clean.
- No full Vitest, Rust, browser or native suite run by this agent. Root integration owns those checks. Browser validation is still needed to establish actual layout/native behavior; the headless adapters intentionally do not claim it.

## Review notes

Conservative navigation ambiguity means an obsolete duplicate excerpt leaves remembered position intact instead of choosing an arbitrary occurrence. Optional cut/Markdown transformations cancel when their target/context is stale. Both are intentional protections of authored content. Canonical task commits are never retried merely because a projection is obsolete. Image upload persistence semantics were preserved while isolating its view-owned coordination for deterministic tests.

## Final coordinator acceptance

All delegated work in this report is resolved. Earlier integration-pending notes
are chronological evidence; [validation](validation.md) records the completed
combined and targeted checks. Additional ledger discoveries and their closures
are documented in [ledger review](ledger-review.md). No external/live/scale
performance or model-quality result is inferred from deterministic acceptance.
