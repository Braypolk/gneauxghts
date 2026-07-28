# Responsibility and trace map

This map identifies the intended owner of each mutable concept and traces
high-value user actions to canonical state. It is a review aid: if a new feature
needs to update more than the named owner or bypasses the named boundary, treat
that as an architecture decision rather than an incidental edge-case fix.

## Canonical ownership

| Concern | Canonical owner | Derived or transient consumers |
| --- | --- | --- |
| Pane order, active pane, pane kind, pane-to-note and pane-to-chat references | `WorkspaceStore` | Pane view models, command facades, session serialization |
| Note working content, persisted identity, saved baseline, operation state, external conflict | `NoteDraftState` in `NotepadState.notesByKey` | Editors, pane view models, chat context, persistence controllers |
| Editor instances, save queues, timers and resource bindings | `documentRegistry` / document runtime | Pane editor lifecycle |
| Canonical note bytes | Vault Markdown file | Note catalog, task projection, lexical index, semantic index |
| In-memory note identity and path lookup after a commit | `PostCommitNoteMutationService` updating the note catalog | Navigation, save response, downstream indexing |
| Canonical task toggle/delete mutation | `TaskMutationService` | Task list patches and the post-commit note pipeline |
| Durable agent proposal status | `ChatService` proposal storage | Proposal review UI |

`runtimeStore.svelte.ts` contains bootstrap and shared resource configuration
only. It must not mirror workspace or document state. `NotepadState` owns
documents only; pane references are supplied through its `PaneNoteReferences`
boundary and remain owned by `WorkspaceStore`.

## Action traces

| User action | Frontend controller or gateway | Backend/domain boundary | Canonical state written | Derived projections |
| --- | --- | --- | --- | --- |
| Split, close, activate, or change a pane kind | `workspacePaneController` through the pane transition pipeline | None | `WorkspaceStore` | Pane view models, focus, location history |
| Edit title or Markdown | Editor lifecycle / document editing service | None until persistence | `NoteDraftState.working` | Editor view and all panes referencing the same note key |
| Save or autosave a note | `persistenceController` → `saveNoteSession` | `note_persistence` → `PostCommitNoteMutationService` | Vault file, then required in-memory note catalog | Task projection is reconciled for read-your-write; lexical and semantic work may queue |
| Remember a note | `noteCommandController` → `rememberNoteSession` | `note_persistence` → `PostCommitNoteMutationService` | Vault file and note catalog; invoking pane is rebound to a fresh draft | Other panes retain the saved note; indexes update through the shared post-commit path |
| Toggle or delete a task in a clean or closed note | `TaskListStore` → task mutation gateway fallback | `task_commands` → `TaskMutationService.commit` → `PostCommitNoteMutationService` | Vault file and note catalog | Task group patch, task projection, lexical and semantic indexing |
| Toggle or delete a task in a dirty open note | Task mutation gateway → open-document handler | `prepare_task_document_mutation` → `TaskMutationService.prepare` (non-writing) | `NoteDraftState.working`, followed by the ordinary save trace | Same post-save projections as any other note save |
| Keep a direct or durable proposal | Proposal orchestration or chat controller | Proposal commit command → proposal domain commit → `PostCommitNoteMutationService` | Vault file; durable agent proposal status also converges through `ChatService` | Note catalog and queued indexes; open document refresh |
| Receive an external vault change | Notepad refresh controller | Watcher event and note load commands | Clean `NoteDraftState` is refreshed; dirty state records an explicit conflict | Every pane referencing that document observes the same state |
| Resolve an external conflict | Document conflict controller | Ordinary save boundary only for Keep my edits | Working document is explicitly saved, replaced from the retained snapshot, or detached after deletion | Every editor pane bound to the document updates in place |
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
