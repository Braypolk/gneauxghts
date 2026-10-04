# Replace the procedural Notepad navigation cluster with one concrete workspace session

Status: ready-for-agent
Progress: Design only; awaiting coordinator review. No production edits in this phase.
Owner: audit_documents

## Recommendation

Replace the callback-connected navigation controller graph with **one concrete `NotepadWorkspaceSession`** whose methods accept destinations and user actions. It uses the existing `WorkspaceStore` and `NotepadState` directly, owns the navigation/departure lifetime and location history policy, and calls the existing document editing/persistence and rendered lifecycle boundaries. Its private implementation executes an operation directly; callers no longer construct a nine-phase callback program or coordinate nested public operations with saved/suppressed flags.

Do not merely move `Notepad.svelte` construction into a factory. The acceptance criterion is deletion of the mirrored workspace facade, controller-to-controller dependency interfaces, callback cycle, externally configurable phase requests, and public coordination flags. Keep document reducers, durable adoption, save queues, proposal runtime and pane presentation owners intact. This is an architectural rewrite of navigation coordination, not a new global state owner.

## Evidence in the current source

Metrics below were read with TypeScript AST interface-member counting; these are counts of declared members, not claims that every member is a distinct behavior.

| Current file | Production LOC | Boundary burden |
|---|---:|---|
| `orchestration/notepadCommandFacades.ts` | 244 | Workspace facade 28 members, pane facade 18, persistence 7, derived views 7, root deps 17 |
| `orchestration/notepadCommands.ts` | 311 | Composition glue across six controllers plus pipeline and close animation; `let noteCommands!` breaks a callback cycle |
| `orchestration/noteCommandController.ts` | 745 | 14 dependency members including the entire root deps object; public open has four coordination options |
| `orchestration/workspacePaneController.ts` | 655 | 43 dependency members, many forwarding WorkspaceStore state/membership |
| `orchestration/locationHistoryController.ts` | 485 | 18 dependency members; restoration calls back into open/set-kind, plus global restore suppression count |
| `orchestration/paneCommandController.ts` | 311 | 31 dependency members; picker choice calls public restore/go-previous operations |
| `orchestration/paneCommandGroup.ts` | 45 | 7 dependency members for activation/focus policy |
| `orchestration/paneSessionController.ts` | 116 | 6 dependency members around existing workspace queries and reference setters |
| `orchestration/documentDepartureController.ts` | 103 | 10 dependency members; three departure flags must be coordinated by callers |
| `orchestration/paneNavigationTransitionPipeline.ts` | 300 | 15 request members, nine phases, six statuses; both callback order and caller policy must be understood |

Those ten files total **3,315 production lines**. This is the candidate surface, **not** a promised deletion count: operation implementations remain necessary. The four main controllers alone declare **106 dependency members**. A 28-member workspace adapter mirrors a concrete in-process owner already present in the same feature and casts generic IDs to actual NotepadPaneId on almost every call.

Specific coupling:

- `Notepad.svelte:910–981` constructs a facade and pane/derived-view callback bags before calling another composition factory. Earlier `:388–434` separately constructs document/pane routing over the same state.
- `notepadCommands.ts:96–130` initializes location history with an open-note closure referring to a not-yet-created controller, and a set-kind closure referring to another controller created later. `:202–222` then feeds location methods back into note commands.
- `noteCommandController.ts:529–703` keeps previous/next document, session, leavingChat and operation-id locals across a phase-request object. It duplicates pipeline currentness via `getLatestOperationId` while deciding when to notify proposal lifecycle, update MRU, replace presentation and clean runtime.
- `locationHistoryController.ts:229–334` increments global `activeLocationRestores`, wraps an outer transition with `trackLatestForPane:false`, then invokes public open and kind transitions. `currentDocumentAlreadySaved` becomes `currentNoteAlreadySaved`. The suppression count was required to repair nested-call ordering, not a user-facing state.
- `paneCommandController.ts:89–240` reconstructs source/reference/current/previous/placeholder state and sometimes calls those same nested public operations from `mutateWorkspace`.
- `paneNavigationTransitionPipeline.ts:107–295` supplies useful latest-per-pane admission and serialized departure, but its public 15-member procedural request moves most correctness policy to callers. It repeatedly checks the same cancellation boundary around externally supplied hooks.

The prior complexity reduction already demonstrated that real composition can replace the fake model; it did not remove these production interfaces. That is the starting point for this rewrite.

## Design A — Concrete session with named operations (recommended)

Illustrative constructor (final names can align with existing domain vocabulary):

```ts
const session = new NotepadWorkspaceSession({
  workspace: workspaceStore,        // concrete in-process owner
  documents: notepadState,          // concrete in-process owner
  editing: documentEditing,
  persistence,
  presentation: panePresentation,   // existing lifecycle + focus/teardown effects
  effects: workspaceEffects,        // derived views and proposal notifications
  io: noteSessions,                 // typed Tauri read/forget/recover/finalize adapter
  maxVisiblePanes: 2
});

await session.open({ noteId, path }, { paneId, focus: true });
await session.restoreLocation(paneId, location);
await session.close(paneId);
await session.choose(paneId, 'previous');
```

The external operational surface is deliberately named rather than a one-method disguise over a large union: open, remember/create-draft, forget/recover, split, close, change-kind, activate/focus, picker choose/highlight, restore/previous, refresh/acknowledge, location queries. Exact return types expose applied/blocked/stale results where callers need them; IO failures continue to reject where the existing caller expects rejection. Remove the blanket phases trace from production results; unit tests may inspect externally visible ordering through IO/render effects.

Key implementation change:

1. A public operation resolves a **destination** (existing document, canonical note reference, fresh draft, retained chat location, or close target) and claims a per-pane operation token once.
2. A private operation context owns token checks and a departure lease. Any operation that might leave a document waits on the same global departure tail and re-reads membership/current document after waiting. It holds that lease through membership/reference mutation, then releases before rendered presentation/focus. Preserve current concurrency semantics initially.
3. The session's private `leave(pane, context)` cancels autosave, joins the existing document queue, rechecks the authoritative document, persists if necessary, validates clean/review state, finalizes only the last editor, captures cursor and authoritative location. A private prepared-departure value carries document handle and revision; this replaces caller-provided `currentNoteAlreadySaved` booleans. Reuse is conditional on unchanged handle/revision and still-finalizable membership, never a blanket save bypass.
4. One private `applyDestination` performs reference/kind changes, location bookkeeping and editor binding. Restoring a chat with a changed context loads that context privately, then applies the chat destination. It does **not** call public `open()` and `changeKind()` recursively. Picker Previous/Current resolve into the same destination path. No `trackLatestForPane:false`, global `activeLocationRestores`, or cross-controller `isTouchSuppressed` contract remains. The operation context carries its own `recordLocation` policy.
5. Presentation completion remains awaited before destination reveal or offscreen task/citation selection. Staleness after durable commit does not roll back bytes; it prevents obsolete pane presentation/focus. The same pane lifecycle continues to own scroll/formatting readiness.
6. UI receives its existing reactive WorkspaceStore projections and location-list change notification; the session never mirrors pane order/kind/document identities.

The constructor has concrete collaborating owners and three honest boundaries rather than 60 mirrored callable facade members. These bundles must not recreate the 106 controller-dependency members under new names: internal functions close over the session's concrete state. `WorkspaceStore` stays the only membership writer; `DocumentEditingService` stays the only committed adoption boundary. Editor effect adapters are justified by real rendered production views versus headless boundary spies. Tauri is owned remote IO with production and deterministic fake adapters. In-process state, reducers, MRU collection and routing require no adapter at all.

### Exact module replacement

Delete these ten production files after their operations have migrated; do not leave compatibility facade wrappers:

- `src/lib/features/notepad/orchestration/notepadCommandFacades.ts`
- `src/lib/features/notepad/orchestration/notepadCommands.ts`
- `src/lib/features/notepad/orchestration/noteCommandController.ts`
- `src/lib/features/notepad/orchestration/workspacePaneController.ts`
- `src/lib/features/notepad/orchestration/locationHistoryController.ts`
- `src/lib/features/notepad/orchestration/paneCommandController.ts`
- `src/lib/features/notepad/orchestration/paneCommandGroup.ts`
- `src/lib/features/notepad/orchestration/paneSessionController.ts`
- `src/lib/features/notepad/orchestration/documentDepartureController.ts`
- `src/lib/features/notepad/orchestration/paneNavigationTransitionPipeline.ts`

Replace with `orchestration/notepadWorkspaceSession.ts` plus at most a private `workspaceDestination.ts` for destination resolution if it materially keeps operation code readable. A private data type is acceptable; recreating request/callback interfaces or exported per-step controllers is not. Place pure note-label formatting currently in paneSessionController with existing pane view-model/label helpers; preserve its live-label test. The large existing note refresh/forget implementations become private methods initially, not a new document-state owner. Keep `DocumentPaneCoordinator`'s cursor/presentation behavior as an existing collaborator in the first rewrite; do not simultaneously replace CodeMirror ownership.

Files updated at integration: Notepad.svelte; open/navigation interaction adapters importing OpenNoteOptions; proposal/chat adapter callers that hold semantic command references; composition support; relevant architecture fitness imports/owner expectations. Search/typecheck must find zero imports of the removed files before completion.

## Design B — Typed intent dispatcher and effect interpreter

```ts
await workspace.dispatch({ type: 'open', paneId, destination: {noteId, path} });
await workspace.dispatch({ type: 'restore-location', paneId, location });
```

A pure transition reducer emits effects (save, load, seal, bind, focus), and one interpreter executes effects and feeds token-correlated results back. This has one admission entry and explicit replayable state; it might suit an app with persisted navigation transactions or external command producers.

Reject for this app's current problem. It replaces callbacks with command/effect/result unions, adds intermediate operation state to maintain beside WorkspaceStore and PaneEditorSession, and makes capture of live document revision/last-editor membership more indirect. A two-phase durable/visible operation still needs private queue ordering and post-commit semantics. The interface looks smaller but caller/model burden moves rather than disappears; the domain does not require replayable UI journeys. Useful part retained in Design A: a small typed destination value, without a general effect language.

## Design C — Enrich WorkspaceStore itself with async operations

Make WorkspaceStore.open/close/restore own persistence and pane effects. This deletes facades and query indirection quickly and makes default caller use trivial.

Reject combining persisted-note orchestration into the reactive membership store. Its existing pure structural transitions/invariant checks are valuable independent of editor availability; async IO, document adoption, proposal notifications and runtime disposal would turn a focused owner into the whole feature. The store would need the same adapters and circular initialization, and tests of structure would acquire those dependencies. Design A instead places an application operation owner immediately above the concrete stores while deleting the shallow graph between them.

The independent editor owner is exploring a materially different proposal-overlay/pane-activation design; compare that before choosing the final implementation scope. No separate children spawned here because coordinator is already collecting independent frontend alternatives in the shared six-slot team.

## Invariants and replacement verification

Read ARCHITECTURE.md; behavior-invariants sections Workspace/navigation, committed adoption, save consistency, Editing Windows and proposal arrival; ADRs 0006 and 0007. No ADR decision changes are proposed. Update the architecture owner row from the phase pipeline to the workspace session if accepted.

| Required outcome | Retained/re-targeted owner |
|---|---|
| Shared document remains live when sibling closes; only last editing departure seals | notepad composition + concurrent departure scenarios |
| Failed save/seal leaves original membership/cursor/history untouched | composed failed-close/open tests + departure failure cases |
| Global departure admission rechecks membership; stale pane work cannot mutate a later destination | pipeline/concurrent tests move to semantic open/close calls; delete hook-order-only assertions once observable equivalent exists |
| Collision clean side joins existing queue without rewrite; survivor reindexes | real workspace collision test retained |
| Remember creates a fresh draft only in invoking pane | composition/shared document adoption + browser remember scenarios |
| MRU records committed rename/assigned note identity; failed nested restore releases suppression | composition and location history cases re-targeted; add no second fake controller model |
| Chat retains current document; nearest editor determines navigation context | real pane lifecycle + chat adapter tests |
| Source picker uses active/source pane; Previous failure skips unavailable locations | pane command/location history exact cases re-targeted |
| Canonical publication warning adopts identity once; newer typing wins | existing persistence/adoption tests stay unchanged |
| Proposal arrival does not navigate; admitted review text is not autosaved; leaving exact pane suspends review | existing proposal adapter and real composition tests, coordinated with editor owner's alternative |
| Open resolves only after formatting/scroll restoration completes; later target reveal wins | existing editor lifecycle regression and mounted offscreen task case |
| History overlays without membership mutation; restore exclusion and workspace barrier retry | existing History session/browser and workspacePersistenceService tests unchanged |

Test migration replaces old per-controller fake-dependency tests with existing real composition tests of the session's public actions; do not duplicate both layers. Preserve the previously reproduced bug cases first. No sequence enumeration deletion justified solely by runtime or size.

## Feasibility and risk

This is the strongest feasible rewrite because the navigation graph has one production construction site, all state is in-process, and recent real composition tests already span the graph. It is still consequential: candidate scope is 3,315 lines, and hidden public-operation nesting currently carries important policy. Highest risks are forgetting the departure lease on exceptions, reusing a saved result after new typing, changing when MRU is captured, and presenting a stale destination after commit.

Recommended implementation order after review: (1) concrete WorkspaceStore/NotepadState use and delete mirrored facade; (2) replace nested location/open/picker procedures with destination operations under one private admission context; (3) migrate close/split/kind then merge note lifecycle/refresh methods; (4) remove old factories/interfaces and re-target tests; (5) compare actual dependency members/callback construction/flags and production diff, then focused tests and existing browser boundaries. Stop before implementation if this becomes a factory wrapping all ten old modules: that does not achieve the architectural objective.

No LOC quota is proposed. Completion requires actual deletion of the old contracts and demonstrated simpler callers, even if some operation code remains long. Root review may choose a narrower first slice, but moving construction alone must not be reported as the rewrite complete.
