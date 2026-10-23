# App quality pass, 2026-10-22

The user-selected follow-ups are implemented in the [follow-up outcome](app-quality-followup-2026-10-22/README.md). The assessment below records the earlier checkpoint; its proposals are historical.

Historical outcome of a broad architecture, correctness, and usability pass.
This record does not replace [ARCHITECTURE.md](../../ARCHITECTURE.md),
[CONTEXT.md](../../CONTEXT.md), the [behavior invariants](../../docs/architecture/behavior-invariants.md),
or accepted ADRs. Future proposals below are not approved implementation work.

The product direction remains fast idea capture, easy Markdown formatting, and
retrieval without mandatory filing. The strongest immediate improvements were
small correctness and feedback changes around those paths, not a new state model.

## How the app connects

```text
Capture / editor / task action / authorized agent publication
  -> existing document or domain owner -> NoteTimeline -> canonical Markdown
  -> catalog + task + lexical + semantic projections -> retrieval surfaces
```

The arrows describe ownership and data flow, not a single synchronous pipeline.
Required publication outcomes and eventual derived indexing have different contracts.

| Area | Owner and connections | Why this boundary remains useful |
| --- | --- | --- |
| Startup and Settings | `AppStore` admits bootstrap and shared vault/semantic snapshots. `SettingsStore` retains editable controls, actions, and view-specific diagnostics. | Prevents competing running-vault snapshots and stale async results. Applying a vault stages the next launch; it does not rebind open services. |
| Workspace and navigation | `WorkspaceStore` owns pane membership/order/active pane. `PaneEditorSession` owns mounts; `NotepadWorkspaceSession` owns complete navigation, departure ordering, and location history. | Pane layout is separate from document lifetime and save admission. Splits can retain one document without duplicating its durable identity or losing another pane's selection. |
| Open documents | `NotepadState.documentsByHandle` owns `NoteDraftState`; immutable `DocumentHandle` identifies one open lifetime. `DocumentEditingService` adopts committed results across model, runtime, and derived views. | Renames and saved identity changes do not replace the runtime, timer, save queue, or pane references. Newer dirty edits survive older save completion. |
| Editor and formatting | `EditorDocumentRuntime` owns shared text/history; pane CodeMirror states own parsing, selection, viewport, decorations, and input. `PaneTransientUiController` arbitrates competing menus/viewers. | Shared Undo belongs to the document, while DOM, focus, and syntax presentation belong to each view. A generic component store should not absorb either responsibility. |
| Timeline and History Mode | `NoteTimeline` owns canonical mutations, identity, Editing Window capture/recovery, and post-publication coordination. `HistoryModeSession` overlays the mounted workspace for browsing and complete Version Restore. | Markdown stays canonical. Required preparation, committed warnings, and recovery remain one seam; restore creates a new revision and resets shared editor Undo rather than rewriting the past. |
| Tasks | Markdown checkboxes and `@due(...)` text feed the task projection. `TaskMutationService` applies clean-note mutations through NoteTimeline; dirty open notes use their ordinary draft/save route. `TaskListStore` admits group ordering. | Tasks do not acquire a competing content or deadline database. Dirty edits and canonical task actions cannot silently overwrite one another. |
| Retrieval and Related | Native lexical/semantic candidates pass current-content eligibility and canonical preview checks. The dock's search store owns visible query state; Related derives from the active editor without becoming authored content. | Indexes rank; they do not become note authority. Query supersession, exclusions, current drafts, and stale projections require explicit admission. |
| Atlas | Semantic work publishes accepted notes-only generations. Private map storage retains cloud identities, names, and geography; the frontend owns camera, selection, and transitions between admitted layouts. | Learned places survive cache rebuilds. Search, camera movement, and naming do not manufacture themes or continuously rearrange the map. See ADR 0010. |
| Media | Markdown embeds own references/dimensions. Document resources coalesce asset resolution; panes own image DOM, gestures, and viewer state. Imports and resize commits enter the shared editor/save path. | A shared loader can reuse resolution work without sharing DOM or selection. Undoing an embed does not delete asset bytes; image search remains derived retrieval. |
| Pi chat | One shared Pi runtime owns conversations, history, generation, tools, queueing, and compaction. Native `pi_chat` modules own credentials, read/write authority, source receipts, exact approval/effect proof; NoteTimeline publishes notes. | Pi task progress cannot prove an external write. Native reconciliation and editor publication leases prevent replaying a committed effect or overwriting dirty content. See ADR 0012. |

Chat search previews grant no citation authority. Authorized canonical reads issue
native source links; terminal admission checks the binding. Links navigate through
ordinary workspace operations, selecting only a still-valid unique passage.
Chat views own presentation/composer state while the workspace retains pane membership.

Canonical note writes share NoteTimeline; that does not imply merging independent
workspace, history, semantic, and chat state machines. Their lifetimes and failure
recovery differ. Existing typed operations and private coordinators justify their
size better than arbitrary file splitting or a universal service abstraction.

## Implemented in this pass

1. **Block movement preserves line boundaries.** Moving the unterminated final
   block previously moved its separator incorrectly and could join adjacent text.
   `editor/blockTypes.ts` now handles source removal and destination separators
   explicitly. Keyboard and drag regressions cover exact text, caret, Undo, and Redo.
   Removed unused block-description helpers in the same module.

2. **Formatting works at an empty caret.** `editor/inlineFormatting.ts` now inserts
   a balanced pair at an empty position, formats the word when inside it, and
   toggles the appropriate enclosing or empty pair. Nested bold/italic use distinct
   marker characters, including either nesting order and underscore variants.
   Empty-caret actions have deliberate Undo isolation. Tests cover repeated toggles,
   nesting, escaped markers, word edges, and shared history behavior.

3. **The empty bold pair remains writable.** Markdown can parse `****` or `____`
   as a horizontal rule. Its decorator leaves either exact pair plain while the
   caret sits inside ready to type; moving the caret away restores rule rendering.

4. **Selection menus share positioning policy.** `SelectionMenu.svelte` uses
   `ui/floatingPanel.ts`, retaining its top-first fallbacks and measured height
   budget while gaining the existing safe-area collision and disposal behavior.
   The shared helper accepts placement/fallback options and consistently publishes
   its height constraint. A short-window browser case checks the final menu row.

5. **Search failures are visible and retryable.** The dock distinguishes a failed
   lookup from no matches, retaining available results only for a compatible query,
   scope, options, and current path. New targets clear incompatible matches before
   the debounce; superseded work cannot republish them. Note/media outcomes settle
   independently, refreshes can retain matches, and Retry reuses the current query.
   The panel shell stays mounted during refresh and Search/Related exchanges.

6. **Credential requests stay bound to their provider.** Save/remove share one
   request function capturing the provider before awaiting. Provider/key/reveal
   controls are disabled during the request and duplicate submission is guarded.
   Deferred browser requests exercise OpenAI and compatible-server save/removal
   independently; they do not exercise a real secret store or paid provider.

7. **General Settings avoids exhaustive history diagnostics.** The Settings bundle
   no longer calls `history_health`. History Settings requests diagnostics on demand,
   coalesces concurrent reads, and preserves action/disposal revision ordering.
   Loading, unavailable, error, and retry states are explicit; ordinary vault events
   refresh history health only while that section is active. Vault counts are unchanged.

8. **Recent tasks fill the requested visible count.** Native task reads share one
   SELECT and row mapper. Recent tasks filter hidden rows and stream until enough
   visible tasks are found, replacing a guessed overfetch limit that could hide an
   older valid task behind many hidden items. Tests retain recency/title/line order
   and cover hidden notes, hidden tasks, zero, and exact limits. This is not a rewrite
   of the task projection or proof of improved end-to-end task-list performance.

9. **Motion calculation has one implementation.** Search-result reveal and morphing
   containers share `cubicBezierProgress` instead of duplicating cubic-curve inversion.
   Intended curves, timings, and existing reduced-motion behavior remain unchanged.

10. **Browser fixtures represent blank capture accurately.** The fixture supports
    `clear_last_opened_note` and a nullable active note, with a regression test.
    This fixes browser-test fidelity; native blank-note behavior was not changed.
    Isolated browser scenarios cover capture/formatting, search recovery, and
    provider credential requests rather than relying on an unfinished raw export.

The changes reuse specific stable mechanisms: panel placement, curve evaluation,
task row decoding, and request setup. A shared slash/selection-menu row component
was considered but left separate; shared appearance alone did not justify moving
menu-specific focus, filtering, transient, and editor-lifetime behavior together.

## Future proposals, separate from completed work

At this checkpoint, five larger experiments were proposed with scope, owner
constraints and adoption checks. The user later selected follow-ups; their
implementation and remaining filename-tool plan are recorded in the
[follow-up outcome](app-quality-followup-2026-10-22/README.md).

The [primary-source research](../../docs/research/note-taking-friction-2026-10-22.md)
distinguishes original observation, current documented behavior, self-selected
anecdote, inference, and hypothesis. Its ten sources do not establish population
prevalence. Historical competitor reports include subsequent capture work and
announced fixes; they are not evidence of current competitor defects.

| Rank | Experiment and reason | Adoption evidence |
| --- | --- | --- |
| 1 | Immediate capture from interrupted work with no required title/folder/type choice, then return. Short-note studies and first-person accounts support investigating capture overhead. | Invocation-to-first-character, completed captures, abandonment, and recovery after dismissal/background/restart. Durable draft backup needs an explicit design against ADR 0006; do not silently bypass mandatory history preparation. |
| 2 | Find a remembered passage using exact or incomplete wording; preserve obvious exact matches and compare direct passage/occurrence navigation with the current route. | Correct passage reached, elapsed time, query reformulations, and wrong opens using participants' older notes. Existing excerpts already handle ordinary late literal matches; do not replace them without measured benefit. |
| 3 | Offer optional time/type cues at retrieval time, preserving useful voluntary titles, links, and structure. | Delayed refinding success and capture hesitation for both non-filers and people comfortable organizing. Do not infer automatic tags, forced inbox processing, or a resurfacing feed is wanted. |
| 4 | Continue testing caret/formatting predictability and selection/viewport continuity before adding decorative motion. | Corrections, unexpected formatting, Undo recovery, and task completion across keyboard/pointer input and reduced motion. The new formatting behavior is an implemented starting point, not a demonstrated population preference. |

Recruit beyond plugin enthusiasts: ordinary Apple Notes users, newer/established
Obsidian users, and informal note takers. A small counterbalanced formative study
with delayed real-note tasks can compare designs; it cannot estimate market-wide
percentages. Preserve individual disagreements rather than averaging them away.

Other code opportunities require focused follow-up evidence, not a broad rewrite:

- Dock note and media requests can duplicate query embedding/text scoring work.
  Share prepared query work only while retaining independent modality/admission policy.
- `services/retrieval/search.rs::fingerprint` reads eligible file bytes twice while
  holding `notes_index`. Profile corpus-size/lock impact before designing a freshness
  proof that preserves detection of external changes not yet observed by the watcher.
- Task commands call disk-pruning `read_state` on warm list reads, and
  `group_task_records` linearly searches groups per record. Measure larger lists;
  an indexed lookup is a possible bounded cleanup, not a reason to add another store.
- Atlas text search could offer a more direct ranked keyboard route from its input.
  Preserve existing map keyboard opening and accepted geography; do not confuse
  highlighting with a need to reorganize the map.
- Chat's lexical search and the dock's hybrid retrieval can yield different discovery
  behavior. Any shared adapter must preserve chat scope, pagination, limits, canonical
  proof, and source authority rather than directly swapping command implementations.
- Saving selected chat output as a note would reintroduce a deliberately retired
  feature under ADRs 0011/0012. Specify the concrete action, ordinary-link semantics,
  and publication boundary before treating it as reusable UI cleanup.

## Validation and limits

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript checks pass.
- `pnpm test`: 143 support checks pass. Final `pnpm exec vitest run` after the
  last formatting correction: 168 files / 1,544 tests pass; one file/test skipped.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 667 pass, 19 ignored.
- `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness`:
  all 19 pass, including canonical writers, running-vault, and Pi owner seams.
- `pnpm build`: production build succeeds. Existing large-chunk warnings remain;
  this pass does not claim a bundle-size improvement.
- Fresh WDIO replay: capture/formatting (3), search recovery and shell continuity
  (3), credential requests (1), discovery navigation (7), discovery keyboard (5),
  and Settings theme plus History lazy-loading/failure/retry (2) pass: 21 distinct
  scenarios across six maintained specs. The injected History failure verifies
  the existing safe user-facing error rather than exposing raw provider text.
- Independent Standards and Spec review completed; final correction verification
  reports no outstanding findings. Rust formatting and `git diff --check` pass.
  The formatting sweep normalized two existing assertions in architecture_fitness.rs;
  their behavior is unchanged.

The interactive `app-audit` WDIO trace and screenshots are under ignored session
artifacts. The maintained capture regression was cleaned from that export and
passed a fresh replay. The named session and owned fixture server were closed;
replays own and stop their own servers. Capture keyboard tests dispatch logical
key events because this host's native layout maps WebDriver Cmd+B to Cmd+T;
they establish app command behavior, not hardware shortcut portability.

Expected unsupported publication-owner fixture errors remain. Blank-capture
replay also logs unsupported `mark_note_opened`; it verifies draft/save UI and
fixture content, not native opened-note tracking. One compact-navigation replay
emitted a ResizeObserver undelivered-notification warning without an associated
assertion failure; its origin/performance impact is not diagnosed here.

Added checks target authored-text preservation, request races, error recovery,
lazy diagnostics, visible task limits, and actual menu geometry. Browser fixtures
establish frontend behavior, not native filesystem durability, keychain behavior,
physical-device usability, provider quality, or portable shutdown guarantees.

This pass is broad source exploration plus targeted fixes, not exhaustive testing
of every feature combination. No new end-to-end latency, memory, indexing, animation
frame-time, large-vault throughput, or general-population usability measurement was
made. Removing work from a path and consolidating code are structural outcomes;
they do not by themselves establish a quantified performance improvement.
