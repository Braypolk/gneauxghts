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
interactive workspace state that is owned by the frontend. One private command
worker owns AppState lookup and blocking dispatch; named commands retain their
typed arguments and domain errors. Substantial domain operations receive concrete
state references, independently of Tauri dispatch.

## Canonical ownership

| Concern | Canonical owner and seam |
| --- | --- |
| Pane membership, order, active pane, kind, and content references | `WorkspaceStore`; membership transitions use `paneLifecycleMachine.ts` |
| Per-pane editor mount lifecycle | `PaneEditorSession` through `paneLifecycleMachine.ts` |
| Open note content, mutable durable identity/path, saved baseline, operation, publication warning, and conflicts | `NoteDraftState` in `NotepadState.documentsByHandle`; an immutable ephemeral `DocumentHandle` keys the open lifetime and transitions use the document machines |
| Committed open-document adoption across model, runtime, and derived views | Operation-specific methods on `DocumentEditingService`; callers provide authoritative results, not synchronization policy |
| Editor instances, save queues, timers, and resource bindings | `documentRegistry` and the document runtime |
| Canonical note bytes | The Markdown file in the vault |
| Ordinary-note mutation, observation, and role-limited history access | `NoteTimeline`; post-publication catalog, task, lexical, semantic, and warning coordination is private behind this seam |
| Editing Window capture, deadlines, recovery, and finalization | `NoteTimeline`; workspace departure and save flushing remain with existing frontend owners |
| Canonical task toggle and delete behavior | `TaskMutationService` |
| Pane navigation and document-departure ordering | `paneNavigationTransitionPipeline` |
| Global history browsing, bounded revision-label, confirmed history-clear, and complete Version Restore actions, entry/exit, paging, and workspace return | `HistoryModeSession` through `historyModeMachine.ts`; it overlays rather than joins pane or document ownership |
| Chat availability, selection, and request lifecycle | `ChatControllerStore.machine` |
| Durable conversations, runs, events, context, and proposal status | `ChatService` |
| One active proposal review | `ProposalReviewSession.workflow` through `proposalReviewMachine` |
| Mutually exclusive editor transients | `PaneTransientUiController.active` through `paneTransientUiState.ts` |
| Semantic indexing work | The backend semantic work queue and worker context |

`NotepadState` owns documents and its one vault-scoped canonical identity/path
to handle lookup, while `WorkspaceStore` owns ephemeral handle references from
panes to those documents. `DocumentRegistry` uses the same immutable handle for
the open lifetime. Handles are not persisted or migrated. `runtimeStore.svelte.ts`
provides bootstrap and shared resource configuration; it must not mirror either
owner's state. Lookup aliases and collision flags are a wholly derived projection
rebuilt across all owned documents after identity changes. A same-identity
collision admits aliases to the established document; a path-only collision
retains the established path binding without stealing either distinct identity
alias.

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

Frontend adoption of a committed result enters `DocumentEditingService` through
an operation-specific method. That boundary locates any retained document and
shared runtime, atomically adopts identity, saved baseline, publication warning,
and the canonical open-document lookup, and preserves edits that remain newer
than the committed operation. Save and rename never replace the document handle,
shared editor root, timers, save queue, or pane references. If a committed result
collides with another independently dirty open document, both documents remain
open and the collision blocks later persistence; the already completed canonical
write is not retried. A dirty participant cannot leave. Once one participant
matches its own saved baseline, pane close cancels its timer, joins its existing
save queue, rechecks the authoritative document, and removes that side without a
new write; lookup reconciliation then clears and reindexes the survivor.
Version Restore always starts a fresh shared undo root, including when only
unmanaged properties changed; an unopened restore target requires no pane or
document mutation.

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
content captures without another Note Revision. Under the accepted Editing
Window contract, distinct ordinary editor publications replace a durable pending
endpoint; boundary finalization retains its net delta against the preceding
finalized revision. Distinct task, proposal, restore, and observed changes remain
separate. The integrated default uses the
[Editing Window contract](docs/architecture/editing-window-contract.md), with its
trade-offs recorded in [ADR 0007](docs/adr/0007-retain-editor-history-at-editing-window-boundaries.md). Exact finalization
also verifies the managed Note Identity in the published file, and records the
app-owned publication time issued into the durable intent immediately before
the write rather than filesystem metadata or later reconciliation time.

History Mode entry obtains its page and diff through the mandatory recovered
read capability. Browsing requests optional per-note and vault health diagnostics
explicitly instead of repeating an exhaustive scan on entry just to display
storage statistics. Restore and clear still refresh diagnostics after mutation.

Revision Citation entry seeks a Note/immutable Revision pair directly through
History Mode and returns at most 31 surrounding predecessor-ordered records.
Private rebuildable successor indexes avoid walking newer history. Scoped
context cursors carry positions relative to the immutable anchor; nearby pages
replace the viewport and never merge with absolute newest-page coordinates.
Clear/restore leave anchored paging while retaining the independent citation
origin on the existing History Mode target. Request identities stop obsolete
entry work, and workspace restoration completes before a newer entry captures
its snapshot. Behavior and query bounds are protected by the History Mode,
command, browser, and native tests.

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

An ordinary editor/task save crosses `note_persistence` into the complete
`NoteTimeline.save_note` operation. It verifies the target before acquiring the
file owner, drops its preflight lease before waiting for that owner, and then
rechecks canonical identity, runtime proof and pending recovery under the
existing observation replay lock. Changed admission releases the owner and
retries outside it. Durable preparation, canonical publication, abandonment
and finalization belong to this operation; commands convert its authoritative
mutation result into a saved session. A failed rename/write restores the original
path; an indeterminate rollback keeps its intent and returns an error so the
requested edit stays dirty. The private post-publication helper updates the required
in-memory note catalog. Task,
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
prepared intent; only an indeterminate post-publication capture failure
keeps its publication intent pending for restart recovery. Successfully captured
Editing Windows are separate durable state, not unresolved publication intents.
Pending canonical heads and immutable finalized heads serve different hash
checks; private pending identities cannot become citation or naming targets.
Receipt retirement uses scoped tokens and a durable retirement watermark, as
defined in the capture contract, without removing unresolved or referenced evidence.
The token's existing random nonce is the private durable receipt key. Full tokens
remain at the publication boundary, where every store instance, generation,
note, deletion epoch, sequence, and nonce is checked before acting on that key.
Receipts own exact outcomes, scope, disposition kind, status, and liveness;
`prepared_intents` and its pending window disposition exist only until capture
or abandonment completes. One transaction records the outcome and removes all
preparation fields. A PendingWindow receipt keeps that original outcome after
sealing; `revision_window_evidence` is the sole retained interval representation.
Retained revisions, lifecycle events, restore origins, and pending endpoints
reference receipts directly. Window preparation has no public Revision Identity;
point preparation still reserves one before publication for Version Restore.
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
Exhaustive attestation walks each note's complete revision lineage and verifies
all payloads and base/result hashes once, holding only the preceding verified
state during that pass. A prepared publication may retain the canonical authored
bytes already read for its baseline. Its finalization transaction uses those
bytes as a delta base only after matching the exact retained base revision's
hash; mismatches and restart recovery reconstruct from storage. This candidate
belongs to one opaque intent and never becomes a cross-operation cache.
Each `AppState` first admits its selected store and settles actual interrupted
work. Its private NoteTimeline runtime then verifies the required note's complete
payload, hash, head, lifecycle, and window lineage in one consistent read
transaction. A foreground request claims an unstarted target directly or joins
only that target's check. One private worker verifies other histories and whole-store
structure, with cancellation between notes, within long note loops, and during
SQL execution. No readiness lock or canonical file mutation owner is held by the
verifier. Background baseline initialization similarly verifies before acquiring
the file owner and holds bounded operation leases rather than a vault-long lease.

Trusted mutations extend a note's proof without rescanning retained payloads on
every save. This proof has its own per-note replacement identity and runtime
store generation; the current-content mutation generation remains exclusively a
delivery freshness check. Clear and purge prevent verification during their
replacement transaction; reset makes ordinary admission unavailable throughout
store replacement. Both old successes and old corruption failures are discarded. Explicit discard
operations need not reconstruct prose being removed. Clear and purge still require
store admission/recovery and preserve the discovered-corruption gate; explicit
reset may replace the unavailable or corrupt store and resolve the gate. A later
publication verifies the replacement target.
Corruption, whenever discovered, remains latched until explicit reset replaces
the store. This intentionally permits a ready note to be saved before unrelated
history corruption is discovered, as recorded in [ADR 0008](docs/adr/0008-verify-target-note-history-before-background-coverage.md).

The storage-neutral readiness contract exposes recovery pending, target
verification pending, ready, unavailable, or corrupt, correlated by runtime scope,
replacement revision, and Note Identity. It also reports verified/known note counts
and background completion or retryable failure without performing a scan. A private
verification coordinator owns the corruption latch, scoped proof completion, cached
counts, and explicit coverage/close-settlement phases. Recovery, operation draining,
current-content freshness, and Editing Window deadlines remain separate owners. The UI
observes this contract; publication always performs its own admission. Explicit
health diagnostics perform SQL outside runtime locks and apply results only to
the still-current scope. A successful diagnostic cannot clear a corruption latch.
Close cancels background checks before waiting for operation leases, then allows
its private settlement to finish pending work without an exhaustive payload scan.
Settings can explicitly retry pending recovery. A confirmed reset is admitted
only for unavailable or corrupt history; it advances the generation, rebuilds
current Markdown as Baseline Revisions, and retains only a prose-free reset
diagnostic outside the replacement timelines.
Each `AppState` composes one concrete private selected-vault store context inside
`NoteTimelineRuntime`. Its vault root, configured data directory, app-local
observation directory, and vault identity/generation remain bound when global
selection changes. Recovery, reads, deadlines, and clean close use this context;
prepared intent callbacks retain their original scope. An explicit reset advances
the runtime's scope for future work while old intent scopes remain stale. All
canonical path and lifecycle admission checks validate against the bound vault,
including canonical aliases, before publication or staging. Vault switching still
requires clean close and restart; this is not live multi-vault support.
Each `AppState` completes that reconciliation successfully before its first
history read or prepared write. Ordinary reads and later preparations do not
rerun successful startup recovery, so they cannot abandon another live
in-process publication intent; a transient recovery failure remains retryable.
History-facing Tauri commands translate private storage, reconstruction, and
coordination failures into a closed product contract: unavailable, corrupt,
stale, ineligible, missing, or invalid request, each paired with a stable
message and recovery action. Diagnostic causes remain in backend logs and do
not cross the command seam. Storage and reconstruction boundaries preserve typed
failures through recovery and role-limited reads; translating a failure never
performs a diagnostic rescan. Corruption detected during reads or capture is
latched by the runtime before later canonical publications can be admitted.

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
finalizes surviving Editing Windows,
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
Complete forgotten-note forget, recovery and selected purge operations also belong
to `NoteTimeline`. Commands select items and map results; the owner stages only the
selected metadata row, compares current source bytes, guards destination collisions,
rolls back known failures and retains indeterminate recovery evidence. Chat content
continues through `ChatService`. Forgotten metadata still uses the selected app-state
database, so these operations reject a runtime whose vault is no longer selected.
Allocated-byte reporting covers the live SQLite main file, WAL, and ephemeral
SHM sidecar. A compaction pass only checkpoints a WAL that fits wholly inside
its remaining byte budget, then bounds incremental vacuum work with that
remainder.
Only freshly created schema 14 stores are admitted. Older schemas and existing
files without complete metadata fail before schema writes; confirmed Settings
reset advances the generation and rebuilds current Markdown as baselines.
Granular Editor history migration, trust authorization, and Editing Session
grouping have been removed.
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
Naming an existing revision and confirmed note-history clear remain metadata-only
writes. Naming current content first flushes its save and finalizes its window;
History Mode entry finalizes the inspected note’s window after its workspace
persistence barrier.
A complete Version Restore is the sole authored-content write admitted from
this surface: its preview is bound to the current authored-content hash, its
confirmation crosses the canonical `NoteTimeline` mutation seam, and its
committed content is adopted by `NoteDraftState` while the shared editor
runtime starts a fresh undo history. The mutation preserves the selected
authored payload exactly and returns its prepared Revision Identity so the
session cannot mistake an older restore for the new result.

- Reducers choose state; controllers execute effects. The document persistence
  controller starts saves immediately and owns delayed serial readiness observation,
  including operation, note, runtime scope, and replacement checks. The document
  reducer receives only a save-wait reason; readiness never completes a save.
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

The production availability decision is recorded in
[ADR 0006](docs/adr/0006-keep-history-preparation-mandatory-in-production.md).
Performance checks belong in focused benchmarks when needed; historical
measurements are not part of the architecture map.

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
