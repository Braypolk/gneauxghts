# 01 — Replace Notepad's procedural navigation controller graph

Status: ready-for-agent
Progress: Implemented and source frozen for independent review. All ten old modules deleted, proposal presentation consolidated, document-bound Reload Disk and disposal/capacity regressions added. Original focused89 and follow-up49 tests pass; coordinator combined frontend/typecheck passed. Final browser/native gates remain coordinator-owned.
Owner: audit_documents
Design: ../documents-design.md

## Objective

Introduce one concrete `NotepadWorkspaceSession` that owns pane-navigation operations and their private admission/departure context. Delete the old graph, not just its construction site. Public callers ask to open/restore/split/close/choose; they do not specify execution phases, bypass saves, or recursively assemble other public actions.

WorkspaceStore remains membership/reference owner. NotepadState remains document owner. DocumentEditingService remains committed-adoption owner. Existing document registry/save queue, pane editor lifecycle and HistoryModeSession remain authoritative. No new dispatcher/effect language, mirrored state or runtime flag choosing old versus new behavior.

## Exclusive source scope

Owner edits `src/lib/features/notepad/Notepad.svelte` integration and these ten command-cluster files, deleting them when replacement is complete:

1. `orchestration/notepadCommandFacades.ts`
2. `orchestration/notepadCommands.ts`
3. `orchestration/noteCommandController.ts`
4. `orchestration/workspacePaneController.ts`
5. `orchestration/locationHistoryController.ts`
6. `orchestration/paneCommandController.ts`
7. `orchestration/paneCommandGroup.ts`
8. `orchestration/paneSessionController.ts`
9. `orchestration/documentDepartureController.ts`
10. `orchestration/paneNavigationTransitionPipeline.ts`

Paths above are relative to `src/lib/features/notepad/`. New production owner: `orchestration/notepadWorkspaceSession.ts`. A private destination-resolution file is allowed only if it removes reader burden; no exported per-step callback interface. Pure labels can move to the existing pane label/view-model module, with live derivation protection retained.

Necessary bounded integration changes: old OpenNoteOptions/command type imports in interaction/navigation adapters, proposal adapter and chat adapter semantic call sites, composition test support, architecture owner documentation/fitness references. Editor owner supplies proposed Notepad integration changes to this owner; no concurrent editing of Notepad.svelte. Other owners retain editor-runtime/proposal internals, backend persistence and chat internals.

DocumentPaneCoordinator, persistenceController, workspacePersistenceService and document adoption/reducer modules are retained initially. Deeper save-barrier unification requires a separately reviewed policy comparison: the workspace barrier repeats dirty saves while single departure rejects remaining unsaved work, and previous mutation evidence proves those contracts are not interchangeable.

## Interfaces and concrete deletion criteria

The new constructor receives concrete WorkspaceStore and NotepadState, existing editing/persistence and document-presentation owners, and actual IO/render/derived-view boundaries. It must not recreate the old 28-member workspace facade or the four controllers' 106 dependency members in new bags.

Named semantic operations retain discoverable behavior: open, new/remember, forget/recover, split, close, change-kind, activate/focus, picker actions, restore/previous, refresh/acknowledge and location queries. Small typed destination data is acceptable; a generic `dispatch`/effect interpreter is not.

Delete:

- all ten factory/controller modules and their imported aliases;
- callback initialization cycle (`let noteCommands!`, open forwarding closure, callbacks into set-kind);
- caller-built fifteen-member phase requests and production phase tracing;
- public `trackLatestForPane`, `currentNoteAlreadySaved` and `currentDocumentAlreadySaved` coordination choices;
- nested public restore → open → kind/picker → restore execution;
- cross-controller `isTouchSuppressed` and paired global restore-counter protocol.

The last item requires care: existing external chat-location notifications can arrive during an admitted restore. Private operation context must suppress feedback for that operation through final completion. Do not accidentally change unrelated concurrent-pane MRU semantics while removing the global counter; characterize simultaneous restores and conversation notifications before deciding the minimal private representation. This is a guard against replacing one counter with unproven locality, not authorization to add another public suppression interface.

## Implementation sequence after approval gate

1. Freeze the pre-rewrite file/API inventory. Reuse the existing real composition support and named scenarios; save a focused baseline command/result.
2. Implement the concrete session's workspace/document queries and private admission context. Use actual NotepadPaneId rather than casting generic string IDs through a facade. Keep query/focus helpers private or on the one semantic owner.
3. Move open, previous/restore and picker resolution into one destination path. Admit once, resolve source once after queue wait, save/capture authoritative source, load destination, mutate references, await presentation, then focus if current. Private prepared-departure data binds handle/revision; it cannot authorize a save bypass after newer typing.
4. Move split/close/kind operations onto the same admission/departure ownership. Preserve close animation and rendered retirement order. Keep teardown and stale cleanup explicit in try/finally; no general phase-hook array.
5. Move remaining note refresh/forget/recover operations and location queries behind the owner. Keep existing read-vs-save baseline identity correlation, coalesced trailing reads, warning adoption and transient recovery behavior.
6. Integrate Notepad and semantic adapters, remove old imports/files, migrate tests across the public seam and delete per-controller callback-fake tests only when their named externally visible contract survives.
7. Verify API/protocol deletion, focused suite and agreed mounted boundaries, then independent review before coordinator integration. No old/new feature switch or compatibility wrappers left behind.

## Invariant checklist

- [x] Last visible pane cannot close; adjacent activation uses right then left.
- [x] Shared editing document remains live; only final editor departure seals its Editing Window.
- [x] Departure queue serializes through membership mutation; it re-reads membership/document after waiting, including a failed first departure.
- [x] Save/seal failure preserves source pane, editable dirty text, cursor and MRU; no target read after a failed prerequisite save.
- [x] Dirty collision blocks departure; deliberately clean side cancels timer, joins existing queue, rechecks, closes without rewriting, reindexes survivor.
- [x] Committed rename/new identity is captured before source MRU recording; stale operation cannot roll back a committed file or adopt obsolete pane content.
- [x] Per-pane latest admission survives unrelated pane operations; shared panes may independently navigate.
- [x] Remember creates a fresh draft only in invoking pane; shared sibling keeps committed source.
- [x] Chat split/context and editor↔chat transitions preserve retained document; correct pane receives proposal departure notification until editor overlay rewrite removes that notification entirely.
- [x] Split source is active/source pane; failure cleans creating runtime; close removes membership before rendered disposal and releases retained state last.
- [x] Previous retries unavailable locations; nested restoration cleanup cannot leave location recording suppressed after failure; no feedback duplicates during restoration.
- [x] Picker no-target Previous retains picker; Current shares intended document; choice honors captured source/context.
- [x] Proposal review text is not saved by generic navigation; arrival never navigates. Coordinate retained document lifetimes with editor owner.
- [x] External refresh stale after canonical adoption is discarded; typing during read becomes conflict; duplicate refreshes have one trailing reread and independent documents do not block each other.
- [x] Forget/recover preserves warning/identity/runtime cleanup and unopened targets remain unaffected.
- [x] Open completion awaits existing pane lifecycle formatting and scroll restoration; later verified offscreen reveal is not overwritten.
- [x] History overlay, save barrier retry, restore exclusion and exact focus/selection return remain unchanged.

## Verification owners and commands

Use the existing real `notepadComposition.test.ts` and `workspacePaneController.test.ts` scenarios re-targeted to the new session. Migrate unique locationHistory/paneCommand/departure/pipeline assertions to semantic operation tests; preserve current proven race cases, not just final steady states. Keep persistence, conflict/adoption and document state tests unchanged unless imports require adjustment.

Run explicit focused Vitest files affected by the rewrite plus retained composition/persistence/conflict/History owners. Run typecheck after integration. Coordinator controls full suite and browser execution. Mounted boundary set: pane splitting/closing/chat context, history entry/return/restoration, source MRU/Remember, offscreen task navigation, startup save failure. Do not launch browser/native concurrently with coordinator.

Acceptance evidence records constructor/member counts, removed controller objects/protocol flags/cycles, caller changes and actual production/test/helper LOC. LOC is descriptive, not a quota. A shorter factory that still constructs the old graph does not meet this issue.

## Coordination

- Root accepted Design A in principle and specifically requested final audit gate before source edits.
- Editor alternative stores proposal hunk/status on the shared document runtime and may remove departure/open/present hooks. This owner integrates the resulting Notepad changes. Keep destination admission separate from proposal state ownership; neither should reintroduce a general callback pipeline.
- Architecture map's pane-navigation owner row changes to NotepadWorkspaceSession only after implementation. Existing ADR availability/Editing Window decisions are preserved.

## Implementation evidence

See `../documents-implementation.md` and machine-readable `../documents-metrics.json`. The checklist is covered by focused executable owners and unchanged retained owners; mounted integration is explicitly still pending with the coordinator.

The final owner is `notepadWorkspaceSession.ts`, not a compatibility constructor. No old factory imports or public phase requests remain under `src`. Its private Navigation object owns admission, freshness and the departure lease. Restoration uses private destination helpers, not recursive public calls. Global restore feedback is derived from active operation contexts; no paired restore counter survives.

## Approved teardown ownership correction

Independent Standards review found that route teardown cleared review suppression while the defensive asynchronous workspace barrier was still pending. The singleton document model also survives remount, so deferred metadata deletion alone would turn proposed dirty text into ordinary autosave input later.

Coordinator approved retaining the same global review session/document root across route disposal. Disposal retires the old local orchestration's asynchronous/UI admissions; it does not erase the retained working draft or its review ownership. The next orchestration rebinds root callbacks to current owners without a second Markdown/hunk snapshot. Editor owner implements this handoff and convergence of in-flight durable completion so the global workflow cannot remain stuck committing/dismissing. This owner makes durable proposal request callbacks route-independent through the existing ChatApi, rather than capturing a disposable ChatController. Notepad keeps its normal barrier; no generic captured exclusion weakens normal navigation saves. Verification must include ordinary-document flush alongside retained proposed text, remount continuation, and durable completion spanning disposal.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
