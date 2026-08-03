# Responsibility and trace map

This map identifies the intended owner of each mutable concept and traces
high-value user actions to canonical state. It is a review aid: if a new feature
needs to update more than the named owner or bypasses the named boundary, treat
that as an architecture decision rather than an incidental edge-case fix.

## Canonical ownership

| Concern | Canonical owner | Derived or transient consumers |
| --- | --- | --- |
| Pane membership, order, active pane, pane kind, pane-to-note and pane-to-chat references | `WorkspaceStore`; membership transitions use `paneLifecycleMachine.ts` | Pane view models, command facades, session serialization |
| Per-pane editor mount/unmount lifecycle | `PaneEditorSession` through `paneLifecycleMachine.ts` | CodeMirror controller and pane runtime readiness |
| Note working content, persisted identity, saved baseline, operation state, external conflict lifecycle | `NoteDraftState` in `NotepadState.notesByKey`; conflict transitions are owned by `documentExternalSyncMachine.ts`, while clean/dirty is derived from working content and baseline | Editors, pane view models, chat context, persistence controllers |
| Editor instances, save queues, timers and resource bindings | `documentRegistry` / document runtime | Pane editor lifecycle |
| Canonical note bytes | Vault Markdown file | Note catalog, task projection, lexical index, semantic index |
| In-memory note identity and path lookup after a commit | `PostCommitNoteMutationService` updating the note catalog | Navigation, save response, downstream indexing |
| Canonical task toggle/delete mutation | `TaskMutationService` | Task list patches and the post-commit note pipeline |
| Durable agent proposal status | `ChatService` proposal storage | Proposal review UI |
| Active proposal review lifecycle | `ProposalReviewSession.workflow` through `proposalReviewMachine` | Proposal orchestration, review UI, and autosave suppression |
| Note operation lifecycle | `NoteDraftState.operation` through `documentOperationMachine` | Persistence and note command controllers |
| Chat controller, selection and request lifecycles | `ChatControllerStore.machine` parallel regions | Chat panels and pane coordination |
| Mutually exclusive slash, selection, and wikilink surfaces | `PaneTransientUiController.active` through `paneTransientUiState.ts` | Per-pane runtime menu details and overlay presentation |

`runtimeStore.svelte.ts` contains bootstrap and shared resource configuration
only. It must not mirror workspace or document state. `NotepadState` owns
documents only; pane references are supplied through its `PaneNoteReferences`
boundary and remain owned by `WorkspaceStore`.

## Action traces

| User action | Frontend controller or gateway | Backend/domain boundary | Canonical state written | Derived projections |
| --- | --- | --- | --- | --- |
| Split, close, activate, change a pane kind, or open a note | Pane command controllers through the pane transition workflow and lifecycle machines | Note load command for opening | `WorkspaceStore`; loaded `NoteDraftState` for an opened note | Pane view models, focus, cursor restoration, location history |
| Edit title or Markdown | Editor lifecycle / document editing service | None until persistence | `NoteDraftState.working` | Editor view and all panes referencing the same note key |
| Save or autosave a note | `persistenceController` → `saveNoteSession` | `note_persistence` → `PostCommitNoteMutationService` | Vault file, then required in-memory note catalog | Task projection is reconciled for read-your-write; lexical and semantic work may queue |
| Remember a note | `noteCommandController` → pane transition `document-departed` phase → ordinary persistence controller | `save_note` → `PostCommitNoteMutationService`, then session restore is cleared | Vault file and note catalog; invoking pane is rebound to a fresh draft | Cursor and location history use the saved identity; other panes retain the saved note; indexes update through the shared post-commit path |
| Toggle or delete a task in a clean or closed note | `TaskListStore` → task mutation gateway fallback | `task_commands` → `TaskMutationService.commit` → `PostCommitNoteMutationService` | Vault file and note catalog | Task group patch, task projection, lexical and semantic indexing |
| Toggle or delete a task in a dirty open note | Task mutation gateway → open-document handler | `prepare_task_document_mutation` → `TaskMutationService.prepare` (non-writing) | `NoteDraftState.working`, followed by the ordinary save trace | Same post-save projections as any other note save |
| Keep a durable proposal | Proposal orchestration → proposal review workflow machine | Agent proposal commit command → proposal domain commit → `PostCommitNoteMutationService` | Vault file and durable agent proposal status through `ChatService`; verified committed Markdown advances the open document baseline | Note catalog and queued indexes; open editors retain later local edits without manufacturing an external conflict |
| Receive an external vault change | Notepad refresh controller | Watcher event and note load commands | Clean `NoteDraftState` is refreshed; dirty state records an explicit conflict | Every pane referencing that document observes the same state |
| Resolve an external conflict | Document conflict controller → external-sync machine | Ordinary save boundary only for Keep my edits | Working document is explicitly saved, replaced from the retained snapshot, or detached after deletion; stale conflict IDs are rejected | Every editor pane bound to the document updates in place |
| Leave the editor route | Navigation coordinator → workspace persistence service | Ordinary save boundary for every dirty document | Navigation proceeds only after all documents are clean | Failed saves or conflicts remain visible and retryable in the editor |

Canonical note and task writes distinguish pre-commit failure from
post-commit degradation. After bytes exist on disk, commands return an
authoritative result with optional `commitWarning`; callers adopt that result
and must not retry the mutation. Dirty-document task preparation also rejects
ambiguous duplicate task text instead of using stale positional proximity.

## Fitness checks

The executable checks intentionally inspect only the files that define these
boundaries:

- `src/lib/architectureFitness.test.ts` verifies workspace ownership, the
  structured `NoteDraftState` schema, and typed consumers of that schema.
- `src-tauri/tests/architecture_fitness.rs` verifies task command routing,
  save/proposal post-commit routing, and registration of the dirty-document task
  prepare contract.
- `src/lib/contracts/ipcFixtures.test.ts` exercises representative Rust-owned
  fixtures against frontend invocation shapes, including task preparation.

These checks do not replace behavior tests. They make accidental duplication or
boundary bypass visible while behavior tests continue to define the supported
outcomes in [behavior-decisions.md](./behavior-decisions.md).
