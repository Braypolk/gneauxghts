# State-machine boundaries

The application uses small, independently scoped state machines. It does not
have one application-wide machine: note persistence, chat streaming, pane
teardown and proposal review may progress concurrently.

## Implemented state machines

| Concern | State owner | Transition module |
| --- | --- | --- |
| Note save/forget operation | `NoteDraftState.operation` | `documentOperationMachine.ts` |
| Note external synchronization | `NoteDraftState.externalSync` | `documentExternalSyncMachine.ts` |
| Pane membership and editor runtime | `WorkspaceStore` membership registry and `PaneEditorSession` | `paneLifecycleMachine.ts` |
| Chat availability, selection and request regions | `ChatControllerStore.machine` | `controllerMachine.ts` |
| Pane navigation/departure workflow | `paneNavigationTransitionPipeline` operation | `paneNavigationTransitionPipeline.ts` |
| Proposal review workflow | `ProposalReviewSession.workflow` | `proposalReviewMachine.ts` |
| Mutually exclusive pane transient UI | `PaneTransientUiController.active` | `paneTransientUiState.ts` |

The legacy chat booleans exposed to presentation are derived projections. They
must not become writable state owners again. Chat request results are
correlated by conversation and request ID. Note operation results are
correlated by operation token and working-content revision. Note opening is
pane-scoped and uses the pane-navigation operation ID rather than mutating the
document being left.

External note synchronization is independent from note persistence. It owns
only the absence or lifecycle of an external conflict; saved versus dirty is
derived from working content and the saved baseline. Conflicts retain the
external snapshot or deletion, carry a monotonic conflict ID, and move from
`awaitingChoice` to `applyingExternal` while the editor effect runs. Failed
effects return the same conflict to `awaitingChoice`; late effects with an old
conflict ID cannot resolve or overwrite a newer conflict.

Chat transcripts and indexes are backend-owned projections, not editable note
documents. Sending with note context coordinates the two domains by flushing
that note's save queue before the chat request may begin.

New Note, note opening, pane closing, and editor-to-chat transitions share the
pipeline's document-departure phase. That phase establishes persisted identity
before saving cursor position and recording location history. “Remember” is a
product action composed from the ordinary save operation and this navigation
phase; it is not a second persistence implementation or document-operation
state.

Pane lifecycle has two independent reducer regions. Membership progresses
through `absent`, `creating`, `ready`, `closing`, `retiring`, and `disposed`;
editor runtime progresses through `unmounted`, `mounting`, `mounted`,
`unmounting`, and `disposed`. Creation, close, mount, and unmount completions
are serialized by their existing owners: membership reuses the enclosing pane
navigation operation ID, while editor effects reuse `PaneEditorSession`'s
queue. A blocked or failed close returns the same pane to `ready`, while
disposal changes the editor phase immediately so queued or in-flight work
cannot revive it.

Proposal review progresses through `idle`, `opening`, `reviewing`,
`confirmingDiscard`,
`committing`/`dismissing`, and recoverable `conflicted` states. The workflow
context owns the active review and discard confirmation; editor attachment is
read from the editor runtime rather than copied into the machine. Presentation
flags, active-proposal details, hunk counts, and autosave suppression are
derived from the workflow runtime. The existing
durable-load queue serializes openings, while review and proposal IDs reject
stale events. A new proposal may replace `reviewing`, `conflicted`, or
`confirmingDiscard`, but it
cannot interrupt `opening`, `committing`, or `dismissing`. Any review
interaction disarms `confirmingDiscard`, so destructive reload always requires
two consecutive requests. Durable proposal
status remains backend-owned.

The pane-navigation module is a stateful workflow executor rather than a
long-lived reducer state. It owns phase ordering and per-pane operation
identity while the durable pane and document state remain in their domain
owners.

## Transition rules

- Controllers execute effects; reducers only choose the next state.
- Async effects are serialized by an existing owner or their completion events
  carry a token, operation ID, request ID or conflict ID so stale results are
  ignored.
- Independent dimensions remain separate machines instead of creating a state
  cross-product.
- Recoverable errors stay as context on the state whose actions remain valid.
- Durable terminal states do not reopen; retries create a new operation or
  explicitly transition from a recoverable conflict.
