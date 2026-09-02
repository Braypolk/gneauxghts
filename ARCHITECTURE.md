# Architecture

Gneauxghts is a local-first desktop notes app. The Svelte frontend owns the
interactive workspace and open-document experience; the Rust backend owns
durable files, projections, search, and chat runs. Markdown files in the vault
are the canonical note representation.

Read [behavior invariants](docs/architecture/behavior-invariants.md) before
changing user-visible coordination or recovery behavior. Hard-to-reverse
choices live in [ADRs](docs/adr/).

## System shape

```text
Svelte workspace and editors
        | typed Tauri commands and events
Rust persistence, chat, and retrieval modules
        | canonical writes and derived projections
Markdown vault + SQLite metadata/indexes
```

The Tauri command and event contracts are seams. Frontend modules should not
reimplement backend persistence policy, and backend modules should not infer
interactive workspace state that is owned by the frontend.

## Canonical ownership

| Concern | Canonical owner and seam |
| --- | --- |
| Pane membership, order, active pane, kind, and content references | `WorkspaceStore`; membership transitions use `paneLifecycleMachine.ts` |
| Per-pane editor mount lifecycle | `PaneEditorSession` through `paneLifecycleMachine.ts` |
| Open note content, identity, saved baseline, operation, and external conflict | `NoteDraftState` in `NotepadState.notesByKey`; transitions use the document machines |
| Editor instances, save queues, timers, and resource bindings | `documentRegistry` and the document runtime |
| Canonical note bytes | The Markdown file in the vault |
| Ordinary-note mutation, observation, and role-limited history access | `NoteTimeline`; post-publication catalog, task, lexical, semantic, and warning coordination is private behind this seam |
| Canonical task toggle and delete behavior | `TaskMutationService` |
| Pane navigation and document-departure ordering | `paneNavigationTransitionPipeline` |
| Chat availability, selection, and request lifecycle | `ChatControllerStore.machine` |
| Durable conversations, runs, events, context, and proposal status | `ChatService` |
| One active proposal review | `ProposalReviewSession.workflow` through `proposalReviewMachine` |
| Mutually exclusive editor transients | `PaneTransientUiController.active` through `paneTransientUiState.ts` |
| Semantic indexing work | The backend semantic work queue and worker context |

`NotepadState` owns documents, while `WorkspaceStore` owns references from
panes to those documents. `runtimeStore.svelte.ts` provides bootstrap and
shared resource configuration; it must not mirror either owner's state.

## Canonical write paths

### Notes

`NoteTimeline` is the canonical owner for ordinary-note mutation coordination,
external observations, History Mode reads, current-content provenance, and
explicitly granted agent restores. Editor, task, proposal, lifecycle, watcher,
and reconciliation callers enter its closed typed contract. Post-publication
catalog, task, lexical, semantic, warning, and recovery coordination is a
private timeline implementation detail; no parallel mutation service is
available to callers. The same boundary can deepen durability ordering without
changing those callers or exposing SQL and storage policy.

Before an app-owned writer publishes canonical bytes, it asks `NoteTimeline`
to prepare the publication from path or lifecycle continuity evidence. Identity
repair policy and managed-metadata representation remain hidden inside that
operation; editor, task, proposal, and lifecycle writers never resolve or
rewrite Note Identity themselves. For authored-state mutations, preparation
also commits a durable intent to the private vault-owned SQLite history store
before the Markdown write is admitted. Preparation returns an opaque intent
identity that the writer carries through publication to exact finalization;
finalization never rediscovers an intent from path, source, or content. Editor,
task, and proposal flows remain under the shared note-file mutation owner from
preparation through publication and history finalization. Identical authored
content finalizes without another Note Revision; distinct content finalizes a
versioned, hash-verified delta or compressed checkpoint.

History Mode and agent restore capabilities require grants whose constructors
remain private to the timeline module. Ordinary chat can receive only the
current-content capability unless an app-owned current-turn restore path is
implemented. Revision and Lifecycle Event identities likewise cannot be
minted by callers; their durable issuer belongs inside `NoteTimeline`.

Note Identity follows the logical note rather than its current file path or
authored-content length. The catalog preserves a known identity through empty
content and damaged managed metadata, and reserves that association across
rename, move, disappearance, and safe reattachment even when path refreshes
arrive in either order. Reattachment requires the same missing path or an
operation-correlated move; identity alone at an unrelated path is a copy, not
continuity proof. External observation never repairs Markdown. The next
app-owned commit restores missing or damaged embedded identity metadata in its
original atomic publication. If an observed copy repeats an identity already
owned by another path, the original mapping wins and the copy receives a new
globally unique identity before any catalog, lexical, or task projection sees
it.

A save crosses the `note_persistence` command seam, publishes the vault file,
and immediately enters `NoteTimeline.mutate`, which updates the required
in-memory note catalog through its private post-publication helper. Task,
lexical, and semantic projections follow that same timeline-owned path.
Lexical and semantic work may be queued after the canonical write.
Synchronous reconciliation resolves identity once, commits the catalog, and
hands the exact resolved payload to lexical projection. A failed projection is
retained in a small path-keyed retry ledger independent of file signatures, so
retry does not clone or hold the whole catalog during lexical I/O. Catalog
generations and a per-path projection lock prevent late older work from
clearing, replacing, or applying lexical or task state after a newer payload
for that path. Ordinary timeline publication registers the generation before
its synchronous task projection, and its deferred background lexical job
carries the same generation through the shared coordinator.

Once canonical bytes exist, the returned identity and path are authoritative.
A later history-finalization or required-projection problem is returned as
`commitWarning`; callers adopt the committed result and do not retry the write.
Prepared intents are reconciled idempotently against authoritative Markdown
after restart, so recovery completes history without replaying the file write.
History finalization likewise reads authoritative Markdown from disk and never
substitutes caller fallback bytes when that read fails.
Each `AppState` completes that reconciliation successfully before its first
history read or prepared write. Ordinary reads and later preparations do not
rerun successful startup recovery, so they cannot abandon another live
in-process publication intent; a transient recovery failure remains retryable.

### Tasks

Closed or clean-note mutations go through `TaskMutationService.commit` and the
ordinary `NoteTimeline` mutation path. A mutation targeting a dirty open note
is prepared without writing, applied to `NoteDraftState.working`, and then
persisted by the ordinary save path. Ambiguous duplicate task text is rejected
instead of matching against stale positions.

### Proposals

Agent tools create durable proposals rather than writing notes. Keeping a
proposal commits through the proposal domain and `NoteTimeline`, then
synchronizes durable proposal status.
The open document adopts the verified committed Markdown as its new baseline
without losing local edits made while the commit was running.

### External changes

Watcher events enter the document external-sync machine. Clean documents adopt
disk content; dirty documents retain both versions in an explicit conflict.
App-owned writes carry operation-specific expectations so only their exact
filesystem outcomes are suppressed as self-saves.

## Coordination rules

The application uses small state machines rather than one application-wide
machine. Note persistence, external synchronization, pane lifecycle,
navigation, chat requests, proposal review, and transient UI can progress
independently.

- Reducers choose state; controllers execute effects.
- Async results are serialized by an owner or correlated with an operation,
  request, run, review, or conflict identity so stale results can be ignored.
- Independent dimensions remain separate instead of forming a state
  cross-product.
- Recoverable errors stay on the state whose actions remain valid.
- Durable terminal work is not reopened implicitly; retry starts a new
  operation or uses an explicit recovery transition.
- Navigation that leaves a document crosses the shared document-departure
  phase before history or workspace state changes.

## Agent runtime

`agent_run_coordinator.rs` is the chat-to-runtime handoff.
`agent_runtime.rs` adapts the selected provider to an app-owned request and
event protocol. `ChatService` retains durable run lifecycle and context
assembly. Provider and runtime-library types do not cross those seams.

The protocol keeps run identity, structured activity, plans, usage,
cancellation, bounded guardrails, and transient permission requests under
product control. Reads obey vault access and exclusions. Note-changing tools
produce proposals. New side-effecting tools must declare a permission at the
app-owned pre-tool seam.

See [ADR 0001](docs/adr/0001-keep-agent-runtime-app-owned.md) for the decision
and replacement strategy.

## Fitness checks

Architecture fitness tests protect ownership and routing; behavior tests
protect outcomes.

- `src/lib/architectureFitness.test.ts` checks frontend state ownership and
  reducer seams.
- `src-tauri/tests/architecture_fitness.rs` checks backend write routing, the
  storage-neutral role-limited `NoteTimeline` seam, chat run correlation,
  permissions, and semantic-work ownership.
- `src/lib/contracts/ipcFixtures.test.ts` checks representative command and
  event shapes across the Tauri seam.

When a change introduces a second owner, bypasses a canonical write path, or
changes one of these seams, treat it as an architecture change. Update this
map, the applicable behavior invariant, and an ADR only when the decision is
hard to reverse, surprising without context, and the result of a real
trade-off.
