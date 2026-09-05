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
| Open note content, identity, saved baseline, operation, publication warning, and external conflict | `NoteDraftState` in `NotepadState.notesByKey`; transitions use the document machines |
| Editor instances, save queues, timers, and resource bindings | `documentRegistry` and the document runtime |
| Canonical note bytes | The Markdown file in the vault |
| Ordinary-note mutation, observation, and role-limited history access | `NoteTimeline`; post-publication catalog, task, lexical, semantic, and warning coordination is private behind this seam |
| Canonical task toggle and delete behavior | `TaskMutationService` |
| Pane navigation and document-departure ordering | `paneNavigationTransitionPipeline` |
| Global history browsing, bounded revision-label, confirmed history-clear, and complete Version Restore actions, entry/exit, paging, and workspace return | `HistoryModeSession` through `historyModeMachine.ts`; it overlays rather than joins pane or document ownership |
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
the future explicitly granted agent-restore path. Editor, task, proposal,
lifecycle, watcher, and reconciliation callers enter its closed typed contract. Post-publication
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
versioned, hash-verified delta or compressed checkpoint. Exact finalization
also verifies the managed Note Identity in the published file, and records the
app-owned publication time issued into the durable intent immediately before
the write rather than filesystem metadata or later reconciliation time.

History Mode requires a grant whose constructor remains private to the timeline
module. The agent-restore capability is intentionally absent until its
app-owned current-turn proposal path is implemented; ordinary chat can receive
only the current-content capability. Revision and Lifecycle Event identities
likewise cannot be minted by callers; their durable issuer belongs inside
`NoteTimeline`.

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

Current-Content Provenance rebuilds on demand in the private `provenance`
module from retained revisions and Lifecycle Events. Only
`current_content(AllowedScope).provenance` exposes its line groupings and UTF-8
ranges. Reads check current eligibility, canonical authored bytes, and the
runtime mutation generation before delivery. Restore selection is durable
domain evidence attached to the prepared publication before Markdown is
written; its reference survives finalization recovery and is removed with the
retained timeline. The projection itself has no durable cache.

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
Known publication failures and proposal conflicts explicitly abandon their
prepared intent; only an indeterminate post-publication finalization failure
remains pending for restart recovery.
External observations retain their exact captured Markdown in a vault-owned
durable ledger before timeline application. `NoteTimeline` replays that ledger
in order before later observations, authored publications, reconciliation, or
history reads, so a transient failure or process restart cannot replace an
already observed state with newer disk bytes.
Existing managed notes receive one background `Baseline Revision` without a
Markdown write. If an authored mutation or watcher observation reaches an
uninitialized note first, the timeline establishes that baseline atomically
before the newer revision. Baselines record only when their content became
known; they do not infer creation or change time from filesystem metadata.
Initialization progress and per-note readiness are durable diagnostics, so an
interrupted scan resumes idempotently after restart. Per-note failures are
retained as typed failed states, the vault enters a degraded phase, and a
later scan clears each failure only after that note becomes ready.
The same timeline boundary exposes storage-neutral vault and per-note health
contracts. Vault health verifies store integrity and retained revision
reconstruction, reports initialization plus allocated and reclaimable bytes,
and distinguishes retryable warnings from unavailable or corrupt history.
Each `AppState` caches that exhaustive integrity attestation for its selected
vault, while corruption remains latched until an explicit reset replaces the
store. Prepared writes consult the cached gate in constant time, so routine
write cost continues to scale with the changed content rather than the full
retained timeline.
Settings can explicitly retry pending recovery. A confirmed reset is admitted
only for unavailable or corrupt history; it advances the generation, rebuilds
current Markdown as Baseline Revisions, and retains only a prose-free reset
diagnostic outside the replacement timelines.
Each `AppState` completes that reconciliation successfully before its first
history read or prepared write. Ordinary reads and later preparations do not
rerun successful startup recovery, so they cannot abandon another live
in-process publication intent; a transient recovery failure remains retryable.
History-facing Tauri commands translate private storage, reconstruction, and
coordination failures into a closed product contract: unavailable, corrupt,
stale, ineligible, missing, or invalid request, each paired with a stable
message and recovery action. Diagnostic causes remain in backend logs and do
not cross the command seam.

The vault manifest selects the active history format and monotonic store
generation. The SQLite metadata repeats the vault identity, format, and
generation; disagreement fails open explicitly instead of accepting replaced
or copied history. The SQLite implementation owns its initial format selection;
general vault configuration only persists the supplied selector. An app-local
observation record remembers the greatest generation opened for each Vault
Identity, so rolling back the manifest and store together is also rejected. A
stable store-instance identity and monotonic clean-close watermark extend that
check within one generation. `NoteTimeline.clean_close` stops new operations,
waits for admitted work, settles prepared intent and deletion recovery,
checkpoints and truncates the WAL, and only then marks the store portable.
Vault switch and application exit cross this seam before releasing the vault.
The observing installation may recover its own open store and WAL after an
interrupted run, while store replacement, watermark rollback, and a live
main-file-only copy require explicit recovery. A development reset advances the
manifest generation first, records its operation
and generation boundary outside the replacement timeline, removes the
superseded store, and rebuilds current notes as truthful baselines.
Note and vault history clears, plus whole-note lifecycle purge, cross the same
timeline-owned mutation barrier. Their SQLite transaction removes readable
records before exposing a fresh baseline where applicable and retains only a
storage-neutral deletion marker without authored prose. SQLite page reclamation
is a later bounded maintenance operation scheduled after background vault
reconciliation; storage diagnostics report allocated and reclaimable bytes
separately so physical compaction cannot be confused with logical deletion. A
whole-note purge first records a prose-free durable deletion intent, atomically
stages the canonical file under hidden vault data, commits the timeline deletion,
and removes the staging file. Recovery uses that staging evidence before
observation replay or history access, so interruption or reuse of the original
path cannot make the purged identity readable or appendable again.
Allocated-byte reporting covers the live SQLite main file, WAL, and ephemeral
SHM sidecar. A compaction pass only checkpoints a WAL that fits wholly inside
its remaining byte budget, then bounds incremental vacuum work with that
remainder.
Schema-five stores migrate once behind the storage-opening barrier to enable
incremental auto-vacuum before the current schema is admitted.
See [ADR 0004](docs/adr/0004-treat-sqlite-as-the-first-note-timeline-store.md)
for the initial store boundary and
[ADR 0005](docs/adr/0005-remember-observed-history-generations-outside-the-vault.md)
for the app-local rollback authority and portability trade-off.

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

History Mode is a global authored-content-read-only session alongside those owners. Entry first
crosses the workspace persistence barrier, then obtains role-limited timeline
pages. The normal workspace stays mounted behind an inert overlay, so pane
membership, note context, editor resources, selection, and scroll are neither
recreated nor transferred to a history pane. Exit restores the captured active
pane and focus. The session itself is intentionally not persisted; restart
returns to the normal persisted workspace.
Revision naming and confirmed note-history clear remain metadata-only writes.
A complete Version Restore is the sole authored-content write admitted from
this surface: its preview is bound to the current authored-content hash, its
confirmation crosses the canonical `NoteTimeline` mutation seam, and its
committed content is adopted by `NoteDraftState` while the shared editor
runtime starts a fresh undo history. The mutation preserves the selected
authored payload exactly and returns its prepared Revision Identity so the
session cannot mistake an older restore for the new result.

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

Chat exposes `current_note_history` on demand through the current-content
capability. Activity and paged provenance carry current excerpts and retained
revision evidence; full revision reconstruction remains private to History Mode.
Revision Citations are revalidated at delivery, including conversation branches.
A durable message marker prevents temporal answers from becoming historical
prose in later model context or compaction. Citation entry binds History Mode to
the cited Note Identity and revision independently of the invoking pane.

The protocol keeps run identity, structured activity, plans, usage,
cancellation, bounded guardrails, and transient permission requests under
product control. Reads obey vault access and exclusions. Note-changing tools
produce proposals. New side-effecting tools must declare a permission at the
app-owned pre-tool seam.

See [ADR 0001](docs/adr/0001-keep-agent-runtime-app-owned.md) for the decision
and replacement strategy.

## Fitness checks

The [release validation report](docs/architecture/note-timeline-release-validation.md)
records scale measurements, regression gates, and the production availability
decision in [ADR 0006](docs/adr/0006-keep-history-preparation-mandatory-in-production.md).

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
