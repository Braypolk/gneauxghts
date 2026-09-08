# Ordinary save and Version Restore architecture investigation

Ticket 14 source wayfinding: the historical `note_timeline.rs:<line>` anchors below predate physical organization. Use the named symbol in `note_timeline/publication.rs` for save/publication, `history_mode.rs` for restore/read access, `administration.rs` for finalization/close, `domain.rs` for records/results, `observation.rs` for replay, `lifecycle.rs` for missing-note work, and `tests.rs` for the former inline tests. Ownership and call order are unchanged.

Read-only investigation, 2026-09-07. Baseline: current dirty workspace after the history consolidation. No source changes, tests, native app, or user database operations were performed. References below are current workspace lines, not HEAD lines. Paths are repository-relative.

Read: `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, behavior invariants, Editing Window contract, ADRs 0002/0004/0005/0006/0007/0008, and codebase-design `SKILL.md`/`DEEPENING.md`.

The ordinary backend save already has the desired deep transaction boundary: `NoteTimeline::save_note` owns preflight, admission, preparation, rename/publication, rollback, finalization and committed warnings. Do not recreate the removed command-owned publication protocol or split this boundary. The largest remaining caller burden is frontend committed-content adoption: path-based resource identity and generic model/runtime callbacks force the composition root to coordinate document, workspace, pane, editor and persistence resources. Restore also still uses the older verification-under-file-owner ordering.

## Counting convention

These are inspection counts, not performance measurements or theoretical state-space products. An authoritative owner is a component holding truth that another participant must respect. A reducer and its controller are one owner when the controller only executes that state's effects. Internal runtime coordinators are inventoried as independent state dimensions, not inflated into separate top-level owners. Canonical Markdown and private durable history are different authorities. Resource handles and derived caches are listed separately. A coordination step is an admission, handoff, or publication/adoption boundary; nested function calls, SQL statements and each field assignment are not additional steps. The restore entry's optional save expansion is explicitly accounted for rather than counted twice invisibly.

### Ordinary save owners: 7

1. **Note Draft State / NotepadState**: working title/body, identity, baseline, operation, conflict, warning; `src/lib/features/notepad/document/documentState.ts:77`, `src/lib/features/notepad/state/noteStore.ts:31`.
2. **WorkspaceStore**: pane references to the document and active-pane context. `PaneNoteReferences` is the real ownership seam, not a second document store: `src/lib/features/notepad/state/noteStore.ts:19`.
3. **EditorDocumentRuntime**: actual live CodeMirror document and shared undo/redo root; `src/lib/features/notepad/editor/editorDocumentRuntime.ts:84`. This currently overlaps the draft's body authority and requires explicit synchronization.
4. **NoteTimeline runtime**: bound store/vault, operation admission, recovery, verification, current-content freshness and Editing Window deadlines; `src-tauri/src/services/note_timeline/runtime.rs:80`.
5. **Canonical Markdown file**: published current content and managed metadata. `NoteTimeline::mutate` reads it before finalization: `src-tauri/src/services/note_timeline.rs:4752`.
6. **Private history store**: durable intent/receipt, retained revisions, captured endpoint, lifecycle and restore evidence. `src-tauri/src/services/note_timeline/history_store/editing_windows.rs:61` and `:86`; `src-tauri/src/services/note_timeline.rs:4756`.
7. **Note catalog continuity mapping**: the required in-memory catalog is a projection of files, but its remembered identity association is consulted as authoritative continuity evidence; do not classify that association as a freely replaceable text cache. `src-tauri/src/services/note_timeline.rs:4426` and `:4450`; `src-tauri/src/services/note_timeline/post_publication.rs:142`.

### Separate caches/resources participating in save: 8 categories

1. DocumentRegistry and DocumentRuntime resource map, save debounce timer, running drain promise, latest pending callback (`documentRegistry.ts:13`, `documentRuntime.ts:13`, `:95`). States: resources absent/present; timer absent/present; drain absent/present; pending callback absent/present.
2. Per-pane editor lifecycle queue/binding, view selection, scroll, focus and cursor-save timers. These can legitimately vary per pane while the document is shared; document coordinator cursor resources appear at `documentPaneCoordinator.ts:100`, lifecycle content dispatch at `:159`.
3. `EditorDocumentRuntime.#markdownCache`: absent/materialized cached string (`editorDocumentRuntime.ts:95`); not another body owner.
4. Advisory readiness observation: stopped flag, timer, in-flight serial request and first scope/replacement identity (`persistenceController.ts:198`). Never a write permit.
5. Task-source attribution WeakMap: absent/exact `{revision, markdown}` expectation (`persistenceController.ts:51`, `:287`). It affects task-routed saves, not an additional ordinary editor authority.
6. Watcher expected-removal/write guards: staged/committed/dropped resources scoped to exact filesystem outcomes (`note_timeline.rs:4562`, `:4578`, `:4614`).
7. Required task projection plus deferred lexical/semantic work and path/generation retry resources (`post_publication.rs:164`, `:174`). They are derived; failure cannot authorize a second canonical write.
8. File mutation owner, replay mutex, operation leases and worker execution handles (`note_timeline.rs:4523`, `runtime.rs:20`, `:46`, `:92`; `commands.rs:53`). Locks/promise handles are not duplicate document state.

### Save state dimensions: 26 domain/coordination dimensions, plus the 8 resource categories above

Payload fields forming one domain value are grouped, explicitly; flags with different meaning are named. There is no multiplication of these dimensions.

| # | Dimension | Current values / fields and reference |
|---|---|---|
| 1 | Working title | string; `documentState.ts:31` |
| 2 | Working Markdown | string; `documentState.ts:31` |
| 3 | Current identity | draft / persisted `{noteId: string|null,path}`; `documentState.ts:36` |
| 4 | Saved baseline | absent / saved `{content,identity}`; `documentState.ts:44` |
| 5 | Operation phase | idle / saving / forgetting / failed with failed operation + message; `documentOperationMachine.ts:12` |
| 6 | Operation correlation | monotonically advanced token; `documentOperationMachine.ts:7` |
| 7 | Edit revision | advances on working-content changes; `documentOperationMachine.ts:101` |
| 8 | Save wait presentation | absent / recovery / verification / unavailable / corrupt; `documentOperationMachine.ts:1` |
| 9 | External synchronization | noConflict / conflict; conflict has sequence/id, awaitingChoice/applyingExternal, snapshot/deletion + source; `documentExternalSyncMachine.ts:8` |
| 10 | Publication warning | null / stage-specific committed warning; `documentState.ts:49` |
| 11 | Workspace references | each pane points to a NoteKey; one active pane; `noteStore.ts:19`, `Notepad.svelte:596` |
| 12 | Editor live root | CodeMirror text + shared undo/redo history; `editorDocumentRuntime.ts:95` |
| 13 | Editor transaction revision | runtime revision number, distinct from title-inclusive edit revision; `editorDocumentRuntime.ts:90`, `:155` |
| 14 | Canonical file state | nonexistent / original / new or renamed published bytes / uncertain rollback evidence; `note_timeline.rs:4564`–`:4613` |
| 15 | Catalog continuity | retained identity/path association and catalog generation; `note_timeline.rs:4426`, `post_publication.rs:144` |
| 16 | Bound runtime scope | vault root, store instance/generation and app-local observation context; `runtime.rs:84`, `history_store.rs:31` |
| 17 | Operation admission | active count, closing flag, closed flag; `runtime.rs:13` |
| 18 | Recovery condition | history_recovered, recovery_unavailable, released_capture_pending; `runtime.rs:89`–`:91` |
| 19 | Target proof | missing / Running / Replacing / Ready / Unavailable plus per-note identity; `runtime/verification.rs:8` |
| 20 | Coverage | Idle / Running / Complete / Unavailable / Stopped / Settling; cached verified/total and stop flag; `runtime/verification.rs:19`, `:44` |
| 21 | Store replacement/corruption gate | corrupt, replacement revision, replacing_store, active_replacements; `runtime/verification.rs:53` |
| 22 | Current-content freshness | generation + active mutation count; `runtime.rs:26` |
| 23 | Durable publication lifecycle | prepared / finalized / abandoned receipt, live/released, scope/epoch/sequence/nonce; `history_store/editing_windows.rs:86`, `:113`; `note_timeline.rs:4772` |
| 24 | Exact capture outcome | PendingWindow / Unchanged / Revision; `history_store/editing_windows.rs:72` |
| 25 | Window and retained head | absent/pending endpoint, anchor revision, exact result hash, time evidence, fixed deadline origin; `history_store/editing_windows.rs:20`, `:61`; `runtime/windows.rs:91` |
| 26 | Timeline lifecycle eligibility | active versus missing/forgotten/purged continuity, evaluated before ordinary access; `note_timeline.rs:2713`, `:3510` |

Important distinctions: dirty is derived from dimensions 1–4 (`documentState.ts:220`), not a stored boolean; current and saved content are intentionally different; title edits need not increment the CodeMirror transaction revision; captured canonical and finalized history heads intentionally diverge during a window; readiness observations and proof are not competing authorities. Document `key`, `identity.path` and catalog path are not three independent concepts, but the mutable path-based runtime key adds migration coordination.

## Ordinary save: 16 coordination boundaries

1. Editor transaction changes the shared root and notifies the document projection (`editorDocumentRuntime.ts:133`, `:157` → `Notepad.svelte:487` → `documentEditingService.ts:51`). Title input uses the same document edit revision (`documentEditingService.ts:146`).
2. Editing service schedules autosave; runtime coalesces requests into one running + one latest pending save (`documentEditingService.ts:68`; `persistenceController.ts:247`; `documentRuntime.ts:100`).
3. Persistence admits the current note only if dirty and without conflict/proposal suppression, captures title/body/id/path/revision, and starts a saving token (`persistenceController.ts:92`–`:130`). A clean empty draft is a no-op; a dirty new note follows NoteCreation below.
4. IPC starts immediately; the delayed readiness observer runs independently and cannot gate/retry it (`persistenceController.ts:133`; `session/session.ts:149`).
5. `save_note` Tauri dispatches onto the private app worker; command adapter calls complete `NoteTimeline::save_note` (`commands.rs:521`; `commands/note_persistence.rs:50`). `save_task_note` chooses source but shares this route. The adapter does not coordinate publication.
6. Timeline validates against its bound vault and resolves new-note identity/source or current path. It settles recovery and verifies its target before acquiring the file owner (`note_timeline.rs:4476`–`:4513`).
7. After dropping the preflight lease, timeline acquires file ownership, obtains a fresh operation lease, enters replay exclusion and re-resolves canonical identity/proof. Pending replay or changed admission releases ownership and retries step 6 (`note_timeline.rs:4521`–`:4548`).
8. Timeline begins current-content mutation and durably prepares the exact canonical publication, including window/point disposition (`note_timeline.rs:4550`–`:4558`). No successful preparation means no file write.
9. If renamed, register removal expectation and move the existing path; then register expected write and atomically publish. Failed move/write abandons intent after known rollback; failed rollback retains recovery evidence and returns failure (`note_timeline.rs:4559`–`:4617`). New notes skip the move. Identity/title/path remain authoritative from the resulting file.
10. `mutate` reads authoritative disk bytes and finalizes the exact receipt; release/repair state is retained if capture is indeterminate (`note_timeline.rs:4742`–`:4785`). Never finalize fallback caller bytes as history truth.
11. Timeline's private post-publication path synchronizes required catalog/task state, queues derived indexing, and packages committed warnings (`note_timeline.rs:4786`; `post_publication.rs:142`).
12. Command converts authoritative mutation to `NoteSession`; frontend expands it to `SessionSnapshot`. Rejected command leaves the requested draft dirty and operation failed; committed warning is a successful adoption input (`note_persistence.rs:14`; `session.ts:76`; `persistenceController.ts:74`, `:139`).
13. Persistence rejects obsolete presentation tokens and decides whether later working edits/title focus must be preserved (`persistenceController.ts:149`–`:159`).
14. New/renamed path rekeys the note store and pane references, may rebind colliding editor resources, transfers timer/save-queue ownership and cleans old key (`Notepad.svelte:528`; `noteStore.ts:128`; `documentRegistry.ts:41`; `documentRuntime.ts:149`). Existing same-path save skips this conditional boundary.
15. Apply saved baseline/identity/warning, preserve newer working draft as required, and synchronize editor via another composition-root callback (`persistenceController.ts:165`; `Notepad.svelte:576`; `documentEditingService.ts:102`; `documentState.ts:300`).
16. Best-effort mark-open for an active newly created note, then mark operation succeeded. Session bookkeeping failure never retries publication (`persistenceController.ts:176`–`:195`).

Conditional steps are included in 16 because the requested workflow includes new/rename. Existing same-path save takes 15 listed boundaries. A pre-publication failure exits at its failing boundary through step 12's error branch; it does not execute committed adoption. Autosave completion alone does not mean an immutable Note Revision; it may be a durable pending endpoint.

## History Mode Version Restore

### Owners and state

Restore uses the same 7 owners plus **HistoryModeSession**, for **8 top-level authorities**. HistoryModeSession owns global exclusion, target, selection/preview, request and workspace return (`historyModeSession.svelte.ts:55`; `historyModeMachine.ts:118`). The document does not become owned by History Mode. No history editor is created.

The workflow spans the same 26 dimensions because entry can save any dirty open document, plus these **10 history dimensions = 36**. These are grouped at the same domain-value granularity as the save list:

1. Phase: inactive / entering / open / historyUnavailable / noteUnavailable / exiting / restoring (`historyModeMachine.ts:118`).
2. Target: note id/title/path, optional fromCitation and citationRevisionId; origin remains distinct from paging anchor (`:99`).
3. Workspace return snapshot: active pane, focus target/element, optional editor note/view state (`:108`). It is a restoration snapshot, not duplicate ownership of live pane state.
4. Timeline viewport: records + next/previous cursors; newest absolute page or anchored citation context (`:131`).
5. Selected immutable revision id: null/value (`:134`).
6. Comparison: parent/current (`:135`).
7. Selected diff: absent/present payload, correlated with selection/comparison (`:136`).
8. Restore preview: absent/present `{revisionId,currentAuthoredContentHash,unmanagedFrontmatter,body}` (`:137`; `historyModeSession.svelte.ts:304`).
9. Request: none / page / refresh / diagnostics / diff / restorePreview / restoreCommit, request identity and entering origin entry/retry (`:123`, `:139`).
10. Session diagnostics/errors: optional cached diagnostics and recoverable error (phase-appropriate); never authorize a mutation (`:138`, `:143`).

Three additional resource categories make **11 resource/cache categories** in the complete workflow: (9) restore completion promise and exit completion promise, each null/running; (10) coalesced pending refresh flag; (11) monotonic request-id issuer (`historyModeSession.svelte.ts:58`). These are actual independent resource lifetimes: the restore promise is joinable by route navigation, while request kind drives UI exclusion. Removing one because both are “busy” would lose behavior.

### Restore path: 21 top-level coordination boundaries

1. User invokes pane history or a citation; HistoryModeSession waits prior workspace restoration, captures return context and admits entering with request identity (`Notepad.svelte:711`, `:1160`; `historyModeSession.svelte.ts:103`).
2. Cross workspace persistence barrier: cancel timers, wait even apparently clean running saves, then drain dirty documents with conflict refusal (`workspacePersistenceService.ts:28`). This step expands into the save workflow above for each dirty note; the 21-step total counts it once as a nested operation. It is not 21 plus every save step unconditionally.
3. Re-read ordinary target after save, but preserve explicitly cited target; refuse failed save/identity and restore workspace (`historyModeSession.svelte.ts:125`–`:150`).
4. Finalize inspected Editing Window through `finalize_note_editing_window` → worker → timeline mutation barrier; refuse entry on failure (`historyApi.ts:106`; `history_commands.rs:346`; `note_timeline.rs:3502`).
5. Read a bounded page or citation context through role-limited recovered access (recovery, verification, eligibility), then read the selected diff; correlate every completion (`historyModeSession.svelte.ts:153`; `history_commands.rs:367`; `note_timeline.rs:2695`, `:2789`). No exhaustive diagnostics required on entry.
6. Publish open history state while ordinary workspace remains mounted/inert. Selected revision can be changed with correlated diff requests (`historyModeMachine.ts:334`; `historyModeSession.svelte.ts:226`).
7. User requests full-replacement preview; backend recovered access checks current file identity/captured hash, then reconstructs selected immutable revision (`historyModeSession.svelte.ts:250`; `historyApi.ts:54`; `history_commands.rs:452`; `note_timeline.rs:2833`, `:2873`).
8. Preview becomes confirmable or user cancels it; cancellation is frontend preview removal, no backend mutation (`historyModeMachine.ts:394`, `:404`).
9. Explicit confirmation starts restoreCommit and creates a joinable completion promise; exit is barred and navigation waits (`historyModeSession.svelte.ts:283`; `historyModeMachine.ts:242`; `Notepad.svelte:1427`).
10. `restore_note_revision` checks confirmed/id/hash, dispatches once to `HistoryModeAccess::confirm_restore` (`historyApi.ts:64`; `history_commands.rs:474`).
11. Backend acquires file owner, then recovered/verified access; reads current content and rejects preview-hash mismatch (`note_timeline.rs:2908`). This order differs from ordinary save preflight.
12. Reconstruct selected payload, preserve current managed metadata, verify exact authored hash, and reject already-current state (`note_timeline.rs:2918`–`:2945`).
13. Durably prepare exact VersionRestore publication and attach selected revision as restore-origin evidence; abandon known failure (`note_timeline.rs:2946`–`:2971`).
14. Re-read preview hash before write, obtain reserved result Revision Identity, register watcher expectation, publish atomic file; fail without retrying when stale (`note_timeline.rs:2972`–`:3006`).
15. Finalize exact history and required projections through the same `mutate` path as save; return reserved revision id + authoritative NoteSession including warnings (`note_timeline.rs:3007`; `history_commands.rs:504`).
16. History session hands committed result to document adoption (`historyModeSession.svelte.ts:323`); current composition root looks up already-open note by Note Identity, applies SessionSnapshot and requests shared editor replacement/reset (`Notepad.svelte:805`).
17. Document editing service updates draft/baseline; pane coordinator chooses an editor, lifecycle executes shared runtime reset, even for properties-only change (`documentEditingService.ts:102`; `documentPaneCoordinator.ts:152`; `editorDocumentRuntime.ts:183`). Adoption failure is reported as post-commit, not a new restore request.
18. Re-read page, exact returned revision's parent diff, and diagnostics. Never pick an older VersionRestore when the returned revision is absent (`historyModeSession.svelte.ts:333`).
19. Publish restored selection, leave citation-anchored paging but preserve citation origin, drain pending refresh and settle restore completion (`historyModeMachine.ts:484`; `historyModeSession.svelte.ts:362`, `:283`).
20. Explicit exit restores active workspace pane, then focus and editor view state; editor viewport restored last so focus cannot overwrite it (`historyModeSession.svelte.ts:579`).
21. Mark session inactive and release exit barrier so a newer entry captures its own snapshot afterward (`historyModeSession.svelte.ts:580`, `:634`).

## Actionable plan candidates

### A. Own committed document adoption behind a document-facing API

**Evidence.** `PersistenceControllerParams` exposes both `rekeyNoteWithRuntime` and `applySavedSnapshot` (`persistenceController.ts:34`–`:42`). The root assembles their required ordering (`Notepad.svelte:528`, `:576`). Restore has a third bespoke adoption path (`:805`), which requires an existing draft and editor pane after canonical commit. Citation entry explicitly targets a note independently of the invoking pane (`:1160`; `historyModeSession.svelte.ts:99`), yet `:810`–`:815` throws if that note is not already open, and `documentPaneCoordinator.ts:157`–`:158` returns unavailable for a chat-only retained document. These structural failure paths are verified by reading code; no runtime reproduction was attempted.

The generic editing API additionally asks every caller to supply model/runtime coordination and flags: `applySnapshot(document,snapshot,applyMarkdownToRuntime,{preserveDraft,resetUndoHistory,autosave,scheduleDerived,immediateRelated})` (`documentEditingService.ts:102`). In particular the restore callback repeats `resetUndoHistory:true` at both `Notepad.svelte:823` and `:829`; one controls whether the effect runs for properties-only restores, the other controls its actual editor effect. They must agree but are independently specified.

**Cost.** A committed operation can fail adoption solely because the viewport topology is different. Callers must know the editor reset flag twice, when to update the baseline, how to retain newer local edits, and which runtime synchronization operation to use. Working Markdown and editor root are both independently mutable, and `applyRuntimeAtCurrentRevision` compensates after an awaited effect (`documentEditingService.ts:30`). This is genuine overlapping live-body authority at a seam; baseline versus working text is legitimate independent state.

**Resulting API/owner.** Deepen the existing document editing boundary into committed adoption, with fixed operation-specific policy: `adoptSave(document, capturedEdit, committedNote)` and `adoptVersionRestore(committedNote)`; dependencies for store lookup, runtime lookup and derived refresh live inside this boundary. A save preserves working edits admitted after its captured edit; a confirmed restore adopts authoritative content and starts fresh shared undo history. Update the shared document runtime directly, without choosing a pane to perform a document operation. Existing pane controllers continue to own selection/viewport and receive runtime broadcasts. If the restored note has no open document, return a successful “no open document” adoption disposition: canonical persistence already succeeded and no pane should be created. If its document is retained only by chat, update it and an existing runtime; on later mount initialize fresh runtime from restored body. Preserve any runtime that already exists so old undo cannot reappear.

**Delete/replace.** Replace the two persistence params and root callbacks with `adoptSave`; delete the restore closure's required-open-note and preferred-editor assumptions. Remove `applyMarkdownToRuntime` from the public committed-adoption API and the dual caller-owned reset flag. Keep internal pure `applySessionSnapshotToDocument` and editor reset machinery as implementation seams. Replace the save boundary's expanded `SessionSnapshot` argument with authoritative `NoteSession` plus explicit captured edit; do not delete SessionSnapshot from unrelated session restoration without a separate caller audit. Correct `documentEditingService.ts:23`'s canonical-owner comment as part of making ownership explicit.

**Sequence.** (1) Add outcome tests through the document adoption seam for ordinary saves and restore; use real local CodeMirror runtime in appropriate existing test setup. (2) Move fixed restore policy and runtime lookup inside it; wire save and restore callers. (3) Replace root callbacks/flags and their white-box tests. (4) Remove obsolete exports after caller search; update architecture map/invariants to identify the model/runtime admission owner. (5) Only then consider making all live-body edits enter one boundary; do not opportunistically rewrite proposal preview logic in this ticket.

**Focused validation.** New note and rename warning still adopt exact identity; edits/title changes during save remain dirty; failed preparation preserves draft; restore to an already-open two-pane note resets shared undo in both panes; properties-only restore resets undo; citation restore of unopened note leaves workspace unchanged; chat-only document adopts successfully; adoption error remains post-commit and never invokes backend restore again; navigation remains blocked until adoption settles. Existing tests to preserve include `persistenceController.test.ts:227`, `:354`, `:377`; `historyModeSession.test.ts:207`, `:268`, `:284`, `:777`.

**Simpler alternative.** Merely move the existing closures to an adapter file. This improves composition-root readability but preserves caller-owned ordering, dual reset flags and pane-required document mutation. It is acceptable as a staging move, not the final improvement. Conversely moving all CodeMirror state into NoteDraftState would overcouple the serializable/open-note model to a UI library; keep its runtime private.

**Non-goals.** No new global application machine, no proposal-body semantics change, no backend persistence change, no forced pane navigation, no changes to canonical-first warnings or undo meaning. Domain-owner count is not claimed to shrink merely because policy becomes local.

### B. Replace mutable path-based document keys with stable open-document handles

**Evidence.** `NoteKey` is `path:* | draft:*` (`documentState.ts:29`); `noteKeyFromPath` sets the resource identity (`noteStore.ts:43`). Ordinary save changes key and can replace the actual note object with a pre-existing target (`noteStore.ts:128`), then `Notepad.svelte:545` rebinds panes and transfers runtime. `DocumentRuntime.adoptFrom` arbitrates resources, timers, pending operation and active queues (`documentRuntime.ts:149`). The registry comment acknowledges callbacks close over the old instance (`documentRegistry.ts:55`).

**Cost.** A title rename migrates running-save infrastructure although the logical open document remains the same. Identity is repeated in mutable key/path/store-map/runtime-map/workspace references. This is a representation-induced migration protocol, not necessary independent state. Collision resource merge also must preserve whichever editor is attached and whichever queue is running, making late-save review expensive.

**Resulting API/owner.** NotepadState creates an opaque immutable open-document handle for each draft/open lifetime. Workspace and DocumentRegistry reference that handle forever. A bound Note Identity and canonical path remain mutable properties of the document; an internal identity/path lookup index resolves open requests to an existing handle. The lookup is vault-scoped and must be updated together with committed identity adoption. A normal draft-to-save or rename updates identity/baseline and lookup only; it never transfers a save queue/editor runtime. Durable Note Identity must not be invented in the frontend for unsaved drafts.

**Delete/replace.** Replace path-based `NoteKey`, `noteKeyFromPath`, `rekeyNote`, `Notepad.svelte::rekeyNoteWithRuntime`, `transferNoteRuntime`, `DocumentRegistry.transfer`, `DocumentRuntime.rekey` and collision-only `adoptFrom`/external queue-joining infrastructure once all remaining callers are migrated. Preserve `replaceNoteAcrossPanes` only for actual document replacement/navigation callers; stop using it for save identity changes. Audit `noteRuntime.ts:20`–`:41` wrappers and remove those with no remaining caller rather than recreating a compatibility facade.

**Sequence.** Implement A first or share its internal document adoption boundary. (1) Introduce stable handles and identity/path lookup; migrate open/restore/empty-draft construction and workspace serialization references without touching saved vault data. (2) Deduplicate open requests by the bound identity/path lookup before creating another document. (3) Update save adoption to change document identity and lookup atomically, keeping handle/resources stable. (4) Adapt external rename/reattachment navigation callers. (5) Delete key-transfer infrastructure and replace tests that assert transfer mechanics with outcomes at open/adopt boundaries. Handle cross-vault scope explicitly; no live multi-vault support.

**Focused validation.** New-save/rename with pending autosave keeps exactly one drain and one runtime, both panes retain independent selection/scroll and shared undo, opening the newly saved path resolves to the same document, external moves update lookup, saved filename collision does not silently merge two independently dirty drafts, Remember creates a fresh handle only for the invoking pane, stale callback cannot cross vault binding. Save queue-coalescing tests remain necessary; runtime-transfer-only tests are replaced after boundary coverage.

**Alternative and decision.** Keep mutable path keys and hide transfer inside A. That is smaller and worthwhile, but removes caller knowledge rather than underlying queue/resource migration. Stable handles have greater scope (open/navigation/persistence shape) and should be a separate ticket, after A. Do not promise LOC savings or owner-count reduction. Expected reduction is removal of save's conditional boundary 14; proving this requires enumerating the final implementation, so this report makes no numerical target-count promise.

**Non-goals.** No changes to canonical path/title semantics, backend identity continuity, disk format, existing durable workspace data without explicit decoding support, or removal of per-pane view state.

### C. Give Version Restore the same verification-before-file-owner admission ordering as save

**Evidence.** Restore: `confirm_restore` takes `with_note_file_mutation` at `note_timeline.rs:2908`, then `prepare_access` at `:2909`, which reaches full target verification at `:2712`. Save: target verification at `:4511`, lease dropped before ownership, then proof/replay recheck at `:4521`–`:4548`. The first issue is surviving code after the history consolidation. Normal History entry usually makes the target ready, but a reset/replacement or a directly issued command can make access cold; the code structure can hold the global canonical file owner while target verification waits. This is a conditional contention hazard established from ordering, not a measured latency regression.

**Resulting API/owner.** Keep the complete `HistoryModeAccess::confirm_restore` operation and role grant. Extract the existing save preflight/recheck/replay mechanics into **one private admission implementation inside NoteTimeline**, then migrate restore and the other complete authored-publication operations identified by the companion agent-action investigation (accepted proposal and closed-task publication). It performs bound-vault recovery and target verification before waiting for file ownership, drops that lease, and then reacquires admission under owner + replay exclusion. Any changed proof/scope or retained observation requires releasing ownership and retrying preflight. Only after this recheck perform current identity/hash, reconstruction, exact publication preparation and publication. Recheck preview hash immediately before write as today. TaskMutationService continues to own pure targeting; the proposal domain continues to own durable review/status lifecycle.

**Delete/replace.** Replace the `with_note_file_mutation(|| prepare_access()...)` nesting in `confirm_restore` and migrate save's existing loop behind the same private admission code; no new public preflight token, readiness permit, boolean or command is introduced. The restore public input stays `(revision_id, expected_current_authored_content_hash)` bound to the role-limited access's Note Identity, and result stays `HistoryRestoreResult { revision_id, mutation: NoteMutationResult }` (`note_timeline.rs:2897`, `:3007`), not transport callbacks or SQL handles. A possible private input is a closed target enum covering existing-note `{note_id, continuity_path}` and save-candidate `{title, body, current_path}`; candidate re-resolution must occur under ownership. Exact internal target representation remains a design decision to resolve against proposal/task inputs before implementation. Do not expose an admitted lease to commands, and do not extract a callback-heavy generic transaction framework or another writer owner.

**Sequence.** (1) Add target-verification blocked/cancelled restore concurrency cases through timeline operation API using temporary test vaults. (2) Move restore preflight outside writer ownership with release/re-admission. (3) Add replacement/pending-observation injection between preflight and owner. (4) Keep exact-byte, lineage and committed-warning tests; adjust architecture invariant wording only if needed.

**Focused validation.** A ready unrelated note saves while restore's target verification waits; close/reset can cancel/drain without a lease/owner inversion; proof replaced between preflight and owner is not accepted; stale preview publishes nothing; foreign-vault path/same Note Identity cannot bind; restore origin is durable before bytes and returned reserved id remains exact; post-publication failure returns committed warning; restore properties/line endings remain byte-exact. Existing restore backend cases start at `note_timeline.rs:11363`, `:11503`, `:11571`.

**Simpler alternative.** Rely on History entry warming the proof. This leaves a public command order assumption and fails after replacement, so it is insufficient. Do not remove target verification or weaken canonical preparation to improve contention.

**Non-goals.** No parallel canonical writers, no whole-vault verification, no new history policy, no cross-vault store selection changes. This preserves necessary coordination rather than pretending fewer checks are safer.

### D. Remove unused alternate persistence entry points and duplicate dirty predicate

**Evidence.** Production search finds `persistenceController.persistNote`, `queueNoteOperation`, and `awaitAllSaveQueues` exported (`persistenceController.ts:303`) but only called privately; workspace owns a second implementation of the queue sweep (`workspacePersistenceService.ts:22`). `session.ts:92` exports unused `shouldSkipAutosave`, duplicating document cleanliness comparisons while missing the empty-draft semantics expressed by `documentHasCleanBuffer` (`documentState.ts:220`).

**Resulting API.** Persistence exposes request/schedule/cancel/flush and exact save-queue joins needed by actual callers; persist implementation stays private. Workspace remains the sole all-document navigation barrier. Document state remains the single dirty predicate.

**Delete/replace.** Remove unused returned `persistNote`, `queueNoteOperation`, persistence `awaitAllSaveQueues` function/export, and `shouldSkipAutosave` plus tests that exist only for that obsolete predicate. Keep private persist/queue implementation. Search whole repo including tests and external fixtures before deleting unused noteRuntime wrappers.

**Sequence/validation.** Caller search → remove unused surface → typecheck and focused existing persistence/workspace barrier tests. Do not write tests that just assert an export disappeared. Preserve dirty conflict refusal, coalesced save behavior and save-warning adoption. This is a small independent cleanup and not a substitute for A–C.

**Non-goals/alternative.** No abstraction for shared queue sweeping is needed because only one live owner needs it. Keeping a reusable helper would preserve a hypothetical seam without a real second caller.

## Priority and implementation ordering

Land D as a small cleanup. Implement A next because it fixes the meaningful adoption seam and removes viewport assumptions; implement C independently because its backend ordering can be validated without frontend identity changes. B follows A as a separate broader representation change. Preserve all source-of-truth distinctions above: mandatory durable intent, authoritative committed warning, original vault binding, cancellation/close order, Editing Window capture versus immutable heads, newer dirty draft adoption, and one shared undo root with independent pane viewport state.

No target counts are asserted for A/C/D: a deep module reduces exposed coordination without magically deleting domain state. B identifies one removable conditional handoff, but its complete resulting workflows should be recounted after design covers navigation and collision behavior. The current reproducible baseline is save 7 owners / 26 grouped domain dimensions / 8 resource categories / 16 listed boundaries (15 for same-path); complete restore 8 owners / 36 grouped dimensions / 11 resource categories / 21 top-level boundaries with save work explicitly nested at entry.
