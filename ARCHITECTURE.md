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
interactive workspace state that is owned by the frontend. Blocking domain
commands routed through `commands.rs::on_app_worker` perform AppState lookup and
work in per-invocation blocking tasks; named commands retain their typed arguments
and domain errors. Other command paths have their own dispatch, so this helper is
not a serialized application worker. Substantial domain operations receive
concrete state references, independently of Tauri dispatch.

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
| Canonical task toggle, delete, and due-date behavior | `TaskMutationService` |
| Task-group ordering | `TaskListStore` admits one pending reorder for drag and menu actions; the existing SQLite order transaction merges filtered submissions while preserving omitted ranks |
| Complete pane navigation, departure ordering, and location history | `NotepadWorkspaceSession` using concrete workspace/document owners and private operation admission |
| Global history browsing, bounded revision-label, confirmed history-clear, and complete Version Restore actions, entry/exit, paging, and workspace return | `HistoryModeSession` through `historyModeMachine.ts`; it overlays rather than joins pane or document ownership |
| Chat availability, selection, request lifecycle, and admitted conversation projection | One aggregate ChatController transition; effects submit correlated results |
| Durable conversations, runs, events, context, and proposal status | `ChatService` |
| One active proposal review | `ProposalReviewSession.workflow` owns admission/commit; the retained document runtime owns editable body and hunk state |
| Mutually exclusive editor transients | `PaneTransientUiController.active` through `paneTransientUiState.ts` |
| Semantic indexing work | The backend semantic work queue and worker context |
| Device-local search runtime and model setup | `GemmaLiteRtEmbeddingProvider`; its private installer verifies pinned native LiteRT/model bytes, explicit Settings setup uses semantic work admission, and shared semantic snapshots expose setup phases and byte progress independently of inference |
| Compatible semantic generation and query admission | `SemanticGeneration` gates the vault-lifetime provider/database/ANN bundle; the semantic worker publishes after source/recall reconciliation through NoteTimeline source admission |
| Next-launch semantic recovery | Vault-local `semantic-provider.json` stages Gemma or retained Jina; composition selects one provider on launch |
| Running vault root, vault-data paths, and app-local observation path | Immutable `RunningVault`, resolved once at composition and retained by `AppState` and startup-bound services |
| Next-launch vault selection | The atomically published vault configuration preference; Settings Apply stages it without rebinding running resources |

Compact pane rails derive their geometry from measured workspace space and
WorkspaceStore's active pane. They retain editor/chat mounts and share the
existing pane layout motion seam. The shared dock keeps its workspace width;
its actions follow the expanded pane.

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

`NotepadWorkspaceSession` exposes named user operations and consumes the real
WorkspaceStore and document owners. It privately owns per-pane supersession,
serialized departure, destination application, and location bookkeeping. A
restored location or picker choice uses the same private destination operation;
it does not recursively start another public navigation operation. The UI supplies
rendered effects, not getter/setter mirrors or a configurable phase program.

`AppStore` is the sole frontend admission point for bundled bootstrap and the
shared running/next-launch vault and semantic snapshots. Listener attachment is
part of bootstrap admission and a failed attempt cleans partial listeners before
retry. Snapshot loads and commands claim per-slice revisions when they start, so
older results cannot replace newer events or operations. AppStore also owns complete Settings-view loading and next-launch vault staging;
its snapshot revision/admission protocol stays private. Settings retains only
its editable inputs, action state, and Settings-only diagnostics; the mounted
Notepad session separately records whether an admitted bootstrap session has
been adopted by the current editor lifetime.

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

Ordinary-note callers use complete `NoteTimeline` save, edit, or exclusive-create
operations. Task and proposal owners supply their domain transform or approved
content; they do not receive prepared tokens or orchestrate canonical writes,
watcher suppression, abandonment, finalization, or projection repair. Target
readiness is admitted before acquiring canonical file ownership and checked again
inside it. The authoritative read and transform remain under that same ownership
through durable preparation, publication, and finalization. Identity repair and
managed metadata stay private. Preparation records the exact durable intent before
Markdown publication; its identity and runtime leases never cross the caller seam.
Version Restore shares the private publication lifetime while retaining its exact
authored bytes, selected lineage, and reserved revision identity. External
observation replay and staged lifecycle deletion retain their distinct protocols. Identical authored
content captures without another Note Revision. Under the accepted Editing
Window contract, distinct ordinary editor publications replace a durable pending
endpoint; boundary finalization retains its net delta against the preceding
finalized revision. Distinct task, proposal, restore, and observed changes remain
separate. The integrated default uses this window contract; see the
[capture contract](docs/architecture/editing-window-contract.md). Exact finalization
also verifies the managed Note Identity in the published file, and records the
app-owned publication time issued into the durable intent immediately before
the write rather than filesystem metadata or later reconciliation time.

History Mode entry obtains its page and diff through the mandatory recovered
read capability. Browsing requests optional per-note and vault health diagnostics
explicitly instead of repeating an exhaustive scan on entry just to display
storage statistics. Restore and clear still refresh diagnostics after mutation.

Revision Citation entry seeks a Note/immutable Revision pair directly through
History Mode and returns bounded surrounding predecessor-ordered records; the
context limit belongs to `history_store.rs::bounded_revision_context` inside
`services/note_timeline`.
Private rebuildable successor indexes avoid walking newer history. Scoped
context cursors carry positions relative to the immutable anchor; nearby pages
replace the viewport and never merge with absolute newest-page coordinates.
Clear/restore leave anchored paging while retaining the independent citation
origin on the existing History Mode target. Request identities stop obsolete
entry work, and workspace restoration completes before a newer entry captures
its snapshot.

History Mode requires a grant whose constructor remains private to the timeline
module. The agent-restore capability is intentionally absent until its
app-owned current-turn proposal path is implemented; ordinary chat can receive the current-content capability and the scoped read-only
activity-history capability from ADR 0009. Revision and Lifecycle Event identities
likewise cannot be minted by callers; their durable issuer belongs inside
`NoteTimeline`.

Note Identity follows the logical note rather than its current file path or
authored-content length. The catalog preserves a known identity through empty
content and damaged managed metadata, and reserves that association across
rename, move, disappearance, and safe reattachment even when path refreshes
arrive in either order. Continuity can be established by same-path reattachment,
an operation-correlated move, or reconciliation of an embedded identity at a new
path when its former owner is absent. External observation never repairs
Markdown. The next
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

An ordinary editor save (including a dirty editor task edit) crosses `note_persistence`
into the complete `NoteTimeline.save_note` operation. Clean task commands instead submit
their transform to `NoteTimeline.edit_note`. Each verifies the target before acquiring the
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
prepared intent; indeterminate publication outcomes, including failed rename
rollback and post-publication capture failure, retain recovery evidence.
Successfully captured Editing Windows are separate durable state, not unresolved
publication intents.
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
SQL execution. Ordinary publication preflight and background verification run
outside the canonical file mutation owner; clean-close settlement can verify
while holding it. Background baseline initialization verifies before acquiring
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
Each process resolves one concrete immutable `RunningVault` at composition. Its
canonical root identity, vault-data directory, and app-local observation
directory are carried into `AppState`, `NoteTimelineRuntime`, semantic/chat
construction, app-state storage, and watcher registration. App-state SQLite is
opened only from that bound context; ordinary operations do not reread the
next-launch preference or swap its connection. Recovery, reads, deadlines, and
clean close use this context;
prepared intent callbacks retain their original scope. An explicit reset advances
the runtime's scope for future work while old intent scopes remain stale. All
canonical path and lifecycle admission checks validate against the bound vault,
including canonical aliases, before publication or staging. Settings Apply
validates, scaffolds, and atomically publishes only the next-launch selection. Repeated
selection is allowed, and selecting the running vault by a canonical alias clears
the pending-restart indication. The running vault remains usable until explicit
Restart performs the clean-close lifecycle; this is not live multi-vault support.
One frontend `RestartLifecycle` action closes workspace mutation admission, joins
the existing restore/save/departure barrier, and only requests process relaunch
after the backend returns an explicit ready receipt. The backend `AppLifecycle`
joins concurrent preparations and owns the ordered release of that same
`RunningVault`: reversibly cancel and settle chat, tool, permission, title, and
semantic producers; stop and join watcher debounce/reconciliation; join admitted
app-state/catalog/task writes; discard queued rebuildable projections; then invoke
`NoteTimeline.clean_close` before terminal semantic shutdown. Full lexical or
semantic catch-up is not a portability prerequisite. A failure after terminal
release begins keeps the workspace inert and retryable; admission is restored
only when every reversibly quiesced owner reports itself usable. Relaunch failure
therefore leaves a ready-to-restart closed state whose only action is Retry
Restart. Ordinary exit dispatches this same lifecycle off the application event
loop as a settlement fallback, without claiming it can save unsent frontend
drafts.
Each `AppState` completes that reconciliation successfully before its first
history read or prepared write. Ordinary reads and later preparations do not
rerun successful startup recovery, so they cannot abandon another live
in-process publication intent; a transient recovery failure remains retryable.
History-facing Tauri commands translate private storage, reconstruction, and
coordination failures into the closed `HistoryCommandErrorState` contract in
`commands/history_commands.rs`, paired with stable messages and recovery actions.
Diagnostic causes remain in backend logs and do not cross the command seam.
Storage and reconstruction boundaries preserve typed
failures through recovery and role-limited reads; translating a failure never
performs a diagnostic rescan. Corruption detected during reads or capture is
latched by the runtime before later canonical publications can be admitted.

The vault manifest selects the active history format and monotonic store
generation. The SQLite metadata repeats the vault identity, format, and
generation; disagreement rejects store admission instead of accepting replaced
or copied history. The SQLite implementation owns its initial format selection;
general vault configuration only persists the supplied selector. An app-local
observation record remembers the greatest generation opened for each Vault
Identity, so rolling back the manifest and store together is also rejected. A
stable store-instance identity and monotonic clean-close watermark extend that
check within one generation. `NoteTimeline.clean_close` stops new operations,
waits for admitted work, settles prepared intent and deletion recovery,
finalizes surviving Editing Windows, and reports a successful portable close
only after WAL checkpointing and observation-watermark recording complete.
The storage implementation owns the transaction and failure-recovery ordering.
Explicit Restart and application exit cross this seam before releasing the running vault.
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
continues through `ChatService`. Forgotten metadata uses the `AppState`-bound
app-state database, so a staged next-launch selection cannot redirect lifecycle
records away from the running vault.
Allocated-byte reporting covers the live SQLite main file, WAL, and ephemeral
SHM sidecar. A compaction pass only checkpoints a WAL that fits wholly inside
its remaining byte budget, then bounds incremental vacuum work with that
remainder.
Existing compatible stores reopen after identity, generation, schema, and
portability checks. Incompatible schemas and existing files without complete
metadata fail before schema writes; the current schema is defined in
`services/note_timeline/history_store.rs`. Confirmed Settings
reset advances the generation and rebuilds current Markdown as baselines.
Granular Editor history migration, trust authorization, and Editing Session
grouping have been removed.
See [ADR 0004](docs/adr/0004-treat-sqlite-as-the-first-note-timeline-store.md)
for the initial store boundary and
[ADR 0005](docs/adr/0005-remember-observed-history-generations-outside-the-vault.md)
for the app-local rollback authority and portability trade-off.

### Authored tags

`NoteDraftState.working` and its saved baseline carry the note's authored tags
alongside title and body. `DocumentEditingService.updateTags` schedules ordinary
autosave; visibility is an app-wide local preference in `AppSettingsStore`.
Tag controls mount outside the editable body inside the existing CodeMirror
scroll owner, and reserve measured space above the first body line. The existing save commands accept an
optional tag edit through `NoteTimeline.save_note_with_tags`, which patches only
the canonical YAML `tags` field under the same file owner before history intent
preparation and publication. No independent tag writer or durable tag store exists.
`tags.rs` owns normalization, safe field patching, and the shared `tag:` / `#`
interactive query grammar. The note catalog and semantic metadata carry derived
tag values; embeddings and Atlas structure hashes remain content-based.

### Images

`images/` projects wiki and Markdown image embeds from authored Markdown into a
complete-document inventory. Each pane owns its direct CodeMirror decorations,
DOM, rendered/source selection and pointer gestures. Image elements are never
shared between views. Document resources own only the bounded asset loader,
which coalesces reads and checks file metadata within the immutable Running Vault.

Width, reset, deletion, cut and successful imports dispatch ordinary isolated
editor transactions through `EditorDocumentRuntime`; they share its undo root and
the existing save/Editing Window path. Paste jobs preserve selected text until
success, map unaffected ranges, reuse partial successes, and discard results after
replacement, navigation, read-only takeover or view destruction. Removing an
embed never removes asset bytes.

The modal viewer is a payload of `PaneTransientUiController.active`, alongside
existing mutually exclusive editor surfaces. It pins the note's full image list,
maps its origin through non-image edits, and closes on inventory or lifetime
invalidation. Native dialog modality supplies focus trapping and background
inertness. Source display, viewer transforms and temporary drag styles are
pane-local, ephemeral state. Closed menu notifications do not republish unchanged
transient state during focus restoration. History continues to show literal
Markdown diffs and resolves encoded local asset references for missing-file checks.

### Tasks

Closed or clean-note mutations go through `TaskMutationService.commit` and the
ordinary `NoteTimeline` mutation path. A mutation targeting a dirty open note
is prepared without writing, applied to `NoteDraftState.working`, and then
persisted by the ordinary save path. Ambiguous duplicate task text is rejected
instead of matching against stale positions. Due dates are authored `@due(YYYY-MM-DD)`
annotations; command responses derive them from the existing task text projection,
without a separate stored deadline authority. Explicit deadline transforms retain
unsupported text and use the same task and Note Timeline mutation boundaries.
Editor date/time chips and due controls dispatch ordinary isolated CodeMirror edits
through the shared runtime; their anchored picker owns only temporary input and focus,
and shares floating-panel positioning with the slash menu. Plain date/time typing
stays in the selected native editor text, with ordinary undo and persistence; any
document edit dismisses the inline picker before it can apply a stale range.
The task list derives date filters and optional within-note sorting from that
Markdown text, with a local-calendar clock for midnight and resume refresh.

### Proposals

Editable proposal body and hunk coordinates/status have one document-runtime
owner, shared by all pane render projections. An active review retains that
runtime when the last pane leaves or the workspace route unmounts. A returning
workspace reconnects callbacks to that same root; route disposal retires local
navigation and review admissions without making proposed bytes eligible for
ordinary autosave. Durable settlement uses route-independent API calls and an
already-admitted completion may settle its exact retained document once.
The global review workflow owns admission and
durable completion; it does not retain a pane editor or fallback text/hunk copies.
Keep/undo operations address the retained review identity, including without a
mounted pane. `NotepadWorkspaceSession.presentReviewDocument` owns explicit review
presentation; passive arrivals only inspect existing rendered capabilities. Explicit
reload addresses the retained document, reads and adopts canonical content, and
rejects stale read completion. Terminal resolution releases review retention, saves
any remaining ordinary edits, and then reclaims a clean unreferenced document.
Follow-on save errors remain visible without retrying the durable proposal action.

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
- Navigation that leaves a document crosses the workspace session's private
  departure operation before history or workspace state changes. Callers cannot
  bypass it by asserting that a document was already saved.

The semantic worker claims one job category from its existing queue. Unselected
work stays in place and newer producers coalesce there; successful jobs never
reconstruct an old deferred batch over new work. Job outcomes return directly to
the scheduler. Retry requeues only claimed work under the newer-wins policy,
including Atlas request batches; runtime status is not a result mailbox.

Atlas retains its last response for display across route changes but revalidates
on every activation. Backend publication compatibility decides freshness; a cached
ready flag cannot prove that no changes occurred while listeners were detached.
Atlas owns complete cache clearing. Chat defaults and Atlas chat visibility use
separate backend column updates, so stale settings forms cannot overwrite the
other operation's fields.

Atlas keeps one semantic worker queue and immutable published generations. Its
private `semantic/atlas/publication.rs` owns generation/label publication, ready
pointers, compatibility and garbage collection. `geometry.rs` contains the coupled
graph, community and layout calculations; `query.rs` owns search scoring. The
worker retains its existing supersession checkpoints between calculation stages
and before pointer publication. These private modules introduce no second owner
or public facade. `semantic/similarity.rs` owns cosine calculations and the legacy
Jina floor; provider-specific retrieval floors belong to `EmbeddingProvider` in
`semantic/embed.rs` and its implementations. Atlas graph and layout policies live
in `semantic/atlas.rs` and its private layout modules.

Atlas's private `map_store.rs` owns durable vault-local cloud identity, names,
lineage and accepted world placements separately from rebuildable semantic data.
`continuity.rs` reconciles current communities and candidate evidence with that
memory; `stable_layout::calculate` owns the complete accepted-layout calculation
used by publication and sequence tests. It restores accepted positions, resolves
new or enlarged footprints against fixed notes in one map-wide index, and derives
cloud bounds and contours. Private initial-placement, legacy-recovery and outline
modules keep bulk separation and drawing out of ordinary incremental placement.
The private affinity calculation aggregates corrected connection weights for
one-time region placement revisions and new-region seeds; no second scheduler
or persisted layout owner is introduced. Placement revisions constrain affinity
with rendered sibling/root territories, then finalize semantic geometry metadata
and contours from the accepted coordinates. Leaf density and sibling/root
territory constraints run during initialization,
an admitted placement migration, or changed membership/footprints. Only affected
clouds and their ancestors can move on ordinary updates; unrelated roots stay
fixed. Unchanged siblings retain their placement within the parent, which may
translate rigidly to clear another root. Compact leaf footprints are preserved;
excessive empty space is
contracted around the member center before territory clearance. Large internal
footprint gaps close first by rigidly translating disconnected note neighborhoods;
this shares the existing inter-region gap calculation and creates no semantic groups.
Canonical centroid/radius derivation is shared by placement and repairs. Contour
smoothing visits only intersecting arc segments; intermediate child repair
rebuilds only moved clouds and their ancestors. Freshness checks read dependency
fields without decoding embedding vectors. SQLite placement hints are loaded only
at bootstrap; accepted-map builds restore durable geometry and seed arrivals
through the same backend layout owner.
Entirely new regions receive deterministic local seeds; newly isolated notes are
placed outside accepted regions. Structural publication, labels, naming and cache
clearing share the map store admission lock. The durable head commits a generation; derived ready pointers
are repairable. The existing queue remains the only calculation scheduler.
See [ADR 0010](docs/adr/0010-retain-atlas-geography-outside-derived-caches.md).
For current world-layout generations, the renderer consumes backend coordinates
directly and interpolates admitted endpoints without persisting or repacking
another layout. `atlasLayout.ts` retains a compatibility layout for legacy
responses without the world-layout flag.
Deletion and same-footprint renaming preserve accepted note positions;
subgroup changes repair only affected territories; root-circle overlap cannot translate established regions.
Larger filenames and isolated notes use the same local collision policy.
The durable map records its placement-policy version. Initialization and admitted
policy migrations may repair accepted geometry; ordinary updates restrict repairs
to affected clouds and their ancestors. The current version and migration policy
live in `semantic/atlas/stable_layout.rs` and its private modules.

Chat's frontend transition admits selection/request events and their conversation
projection together, then notifies the existing Readable boundary once. Effects
cannot separately patch selected conversation data after rejected admission. The
controller owns first-send draft creation and exposes its promotion identity;
the composer retains text, attachments, draft persistence, and the editor save
barrier without coordinating create-then-send timing.

The notepad's shared input dock owns only the expanded search/chat mode and
which pane supplies its chat slot. Search stays mounted in its existing owner;
`mountInSlot` places the selected pane's mounted composer in the dock without
copying its text, attachments, configuration, or draft persistence into workspace
state. `workspaceDockMachine` owns the presentation transition between editor
search, chat search, and chat input. One correlated frame clock drives the bar,
circles, joining material, and controls; input contents reveal near settling and
finish fading after motion completes. The dock adapter measures mounted
inputs and blends coordinate spaces, including the adjacent actions, when
Related layout changes during a morph. Pane layout changes accompanying an
editor/chat edge sample the dock's remaining clock and shared easing, and publish
the dock's final flex bounds in a correlated presentation event after installing
their effects.
The dock interpolates its displayed origin to that endpoint directly, avoiding
temporary destination measurements and width-cap discontinuities, and balances
Related against the displayed margins. Search/chat exchange anchors full-size
opaque background circles while the foreground send control morphs independently.
One SVG group draws the joined background and outline, avoiding separate filtered
HTML backing layers. Ordinary editor expansion moves the absorbed circles with
that rectangle on the same duration.
Pane kind changes participate alongside membership changes. Interrupted requests start from the
current pose. Mounted input contents fade out as a morph starts; the selected
surface begins revealing near settling and finishes after the bar settles.
Timing and easing belong to `workspaceDockMachine.ts` and
`ui/workspaceDockMotion.css`. Another morph fades
from the currently displayed opacity; reduced motion skips the fades. Glyphs
hand off sequentially; editor transitions skip the chat-search glyph.
The dock reserves the measured expanded composer height in both chat input and
chat search, so switching modes preserves the reading surface's scroll extent.
Draft growth and shrinkage update that clearance; editor/chat morphs reserve
their maximum clearance until settling.
The reading surfaces extend behind its shared fade rather than clipping above it.

## Agent runtime

`agent_run_coordinator.rs` is the chat-to-runtime handoff.
`agent_runtime.rs` adapts the selected provider behind an app-owned runtime entry
point and event protocol. `ChatService` retains durable run lifecycle and context
assembly. Private `chat/admission.rs` commits the user message, attachments,
assistant placeholder, run, and context in one transaction. Private `chat/store.rs`
owns connection policy and atomic terminal message/source/run persistence; all
connections enforce foreign keys. `chat/runtime.rs` reports successful completion
only after that transaction commits. `chat/answer_stream.rs` owns transient
structured drafts separately from ordinary text. Structured answers are never
checkpointed before final validation; a failed or cancelled draft has no durable
answer text or sources. Ordinary text checkpoints use one connection per response;
checkpoint errors do not prevent UI delta delivery, so that text can lead its
durable checkpoint. `chat/projection.rs` serializes managed
transcript publication (filesystem bytes and SQLite hash receipts) with conflict
classification; a projection failure after admission cannot reject an already
accepted request. The watcher rechecks current
projection bytes after publication; queued own-write events cannot detach chats.
Provider client/model construction belongs to `agent_runtime.rs`. The internal
chat/runtime request still uses Rig messages; usage, persisted chat and frontend
contracts use app-owned types.

At startup, `ChatService` recovers missing conversation identities from surviving
managed Markdown in `Chats` through its private transcript recovery module.
Each import commits messages and projection hash receipts atomically without
rewriting files or replacing existing database conversations. Legacy transcripts
cannot reconstruct runtime events, attachment bytes, permissions, or evidence
provenance; recovered chats start with no vault access and conservative assistant
history evidence markers. SQLite remains authoritative after recovery.

`services/evidence.rs` owns current evidence search, ranking, scoped/versioned
cursors, passage reads and canonical citation validation. `find_notes` uses
the existing Tantivy paragraphs and reciprocal-rank fusion with local semantic
candidates; literal/regex modes inspect exact canonical Markdown. Semantic
availability and approximate coverage are explicit. Interactive note selection
uses the compatibility adapter in `services/retrieval.rs`; its metadata date
filters are distinct from agent surviving-content activity periods.

NoteTimeline remains the sole owner of activity reconstruction and range
provenance. Evidence consumes allowed current-content provenance and, for explicit activity
queries with `include_history`, the read-only `activity_history` capability. The
latter reconstructs retained added/removed body and property lines through the
private timeline store. Historical text is separate from current status; surrounding
current context is labeled separately.
Monday-start local weeks resolve to half-open intervals. Baseline knowledge is
not an introduction date; Editing Window uncertainty remains intact.

Current-passage citations bind stable note identity, canonical content hash,
exact UTF-8 coordinates and optional retained revision evidence. Delivery and
navigation revalidate current bytes and permissions, recovering explicit grants
from the originating run. The UI opens the current note and focuses the exact,
unambiguous passage. Historical passage citations instead bind retained UTF-8 coordinates and a validated change proof, and open the retained content revision in History Mode. Legacy Revision Citations also enter History Mode.
`passage_json` is an additive chat-store migration; canonical Markdown and
canonical history formats do not change.

`chat/citations.rs` owns ephemeral model references such as `[S1]`. Read tools
issue these only for delivered passage sources; selected research results receive
parent references independently of the worker's registry. ChatService constructs
canonical passage links before terminal persistence/delivery, intersecting the
registry with currently valid sources. Recognized but unissued `[S#]` references
and invalid passage destinations become inert unavailable text; other malformed
model citation text is not automatically recognized. The UI never guesses a
model reference from a note title.
Transcripts and branches persist durable destinations, never depend on the
run-local registry, and continue to revalidate on navigation. Link integrity
is distinct from whether a claim is supported by its cited passage.

Evidence presentation belongs to the answer. The expandable Show evidence section
renders exact delivered excerpts as literal text, identifies current passages and
retained changes, and displays recorded timing without implying complete coverage.
Citation admission checks exact excerpt bytes for every read. Source links retain
the same access/freshness validation and current/revision navigation.
Requests for sources or quotations use the ordinary prompt, history, streaming,
provider policy and capability set. There is no source-preview command, composer
mode, restricted registry or selection-only terminal renderer. Legacy `/sources`
message text remains ordinary user content when retried; saved answers/citations
are unchanged. Model-written quotations remain distinct from the exact excerpts
in the evidence panel; citation identity does not validate semantic entailment.

`chat/assistant_instructions.txt` owns the shared assistant core. Tool mechanics
are owned by registered descriptions and schemas, and `chat/date_time.rs` supplies
compact date interpretation beside the run reference. Disabled-tool requests omit
tool descriptions and receive an explicit unavailable-capability statement.
Web citation guidance is included only when web access is enabled.
`agent_tools/capabilities.rs` owns the application-owned capability sets: evidence,
working-note reads, proposals, research, and planning. Capability restrictions
intersect the parent's grants; worker identity and response presentation do not
choose tools inside the runtime. Ordinary chat grants the complete set when
executable tools are enabled; local model capability settings can disable them. The
agent chooses and sequences available tools to fulfill the user's objective;
retrieval never chooses a final response format or terminates a successful run.

The model-facing interface exposes five tools: `find_notes`, `read_notes`,
`propose_note_change`, `research_notes`, and `update_plan`. The private interface
adapter groups operations without moving evidence or proposal ownership.
`read_notes` requires `purpose=answer` for canonical evidence or `purpose=edit`
for the current working copy. Schemas expose only granted branches, and handlers
recheck capability grants; an evidence-only research worker cannot regain edit
reads through the shared tool name. `propose_note_change` requires an explicit
edit, replace or create operation and retains existing stored proposal formats,
full-read replacement requirements, current hashes and Keep before publication.
There is no separate active-note tool; the editor hint supplies identity and
selection, and ordinary reads obtain the needed content.

Automatic adjacent-editor context carries only an allowed canonical note identity,
bounded title and validated selection as a relevance hint. It does not deliver the
body, admit primary evidence or satisfy rewrite read coverage. It retains canonical
hash/access revalidation without marking a hint-only response as note evidence.
The automatic editor hint is an app context message before conversation history,
separate from the authored user message. Other turn-local app context precedes
an explicitly labeled authored request, keeping the user's question last.
Delivered note content keeps a durable history marker even when its sources are
later hidden, so ordinary dialogue remains usable while note-based answers require
fresh evidence. Working-copy content is read through `read_notes` with `purpose=edit` when relevant.

Lexical evidence matches retain a typed title/body location through retrieval.
The evidence owner validates coordinates against that canonical location rather
than inferring it from a display label or locating every match in body text.

EvidenceSession separately tracks actual delivered text for run-local reuse;
discovery freshness proofs, editor hints and working-copy reads grant no answer
reuse. Exact same-note/version/location overlaps report none, partial or full,
keeping historical proofs separate. Independent workers reset this tracking and
only selected evidence delivered back to the parent enters its context.
Canonical-note and selected-passage coverage follow each read's continuation;
an earlier unavailable passage prevents a false complete result on the final page.
`wholeNoteComplete` is true only for a complete canonical-note read across its
pages. Selected passages never establish this flag. Normal untimed selected reads
supply canonical `nextReads` selectors; incomplete canonical pages supply their
exact cursor. These suggestions grant no new access or automatic retrieval.
Search coverage describes retrieval, and delivery identifies previews. Explicit
linked bodies and attachments disclose their own completeness, with a canonical
read selector when clipped. These signals neither suppress evidence nor choose
when the model must stop.

The tool boundary's `evidence_references.rs` issues compact, context-local evidence
selectors for discovery and reads, resolving them exactly to canonical IDs before
ordinary evidence admission. Clones share one registry; independent workers and
later runs have distinct namespaces. Worker hints use the worker's references,
and only references backed by actual worker reads may be selected for handoff.
Parent delivery revalidates canonical identities and issues parent references.
The registry translates selectors only: durable passage IDs and read-only `[S#]`
citation authority remain separate. Unknown references are rejected without
fuzzy matching; legacy canonical selectors retain their normal validation.

`services/evidence/guidance.rs` owns app-authored interpretation contracts for
source scope, prose, checkbox status facts and current task deadline metadata.
Named notes are starting points for factual discovery; named-record omissions
require complete canonical content. The first read
with each corresponding structure includes its contract in the tool envelope.
If guidance crowds out an otherwise deliverable passage, a bounded bootstrap
returns that guidance with a continuation (or research remaining IDs), without
admitting the pending source. Both the bootstrap and conservative followup
envelopes must fit the shared allowance.
The entire normal/research envelope, including pending guidance, is sized before
charging or admitting anything. The service records guidance during admission,
before the tool adapter's remaining fallible checks. Failed outer delivery does
not roll that state back; the intended retry guarantee and current gap are
recorded in [behavior invariants](docs/architecture/behavior-invariants.md).
Each independent EvidenceSession tracks delivered contracts. Worker forks reset
that state while sharing the evidence allowance. Tool history is retained throughout
a runtime; between-turn compaction starts a new session, so it cannot discard a
contract while retaining the session's delivery marker. No question classifier or
new authority crosses the runtime seam.

Search, activity listing and research accept the same explicit `activity_range`:
start inclusive and end exclusive, each an ISO date or RFC3339 timestamp, with
an optional named timezone for local dates. The model interprets the user's
wording against the supplied run instant and local timezone. The evidence owner
validates dates, timezone boundaries and scope; it does not parse the question,
restrict tools to named periods, or route semantic intents. Activity bounds filter recorded text changes, not event dates, deadlines or accomplishments.
`include_history` requires those bounds and includes retained superseded/removed
lines; it supports literal/regex content filters, while semantic current searches
remain separate. Scope excludes non-note transcripts. Each call
can select its own query, scope and range; only a research worker's inherited
scope/range is mandatory within that worker.

Sends and retries snapshot the editor's current Intl locale, numeric Gregorian
date order, hour cycle and IANA timezone into optional turn-local configuration.
The validated timezone sets the run reference; legacy callers retain the backend
local default. The configuration is not persisted authoring provenance and cannot
reinterpret older note text. Parent and research prompts share date-reading
semantics; reviewed-edit guidance stays in the parent.

Current body reads optionally include bounded `taskDates` metadata from the same
Markdown checkbox and portable `@due` parsers used by tasks. Entries cover only
complete delivered marker lines with exact text and canonical UTF-8 coordinates; clipping or
exceeding the entry bound marks the metadata incomplete. The bound belongs to
`services/task_dates.rs`. They consume the same
read/evidence budgets and inherit permission, hash and citation checks. Historical
reads do not claim current deadlines. The agent composes current reads and local
calendar comparisons for deadline questions, and working-note reads plus reviewed
proposals for edits.

`find_notes` with `result=notes` returns bounded intermediate data grouped by Note Identity,
with one representative evidence ID, preview and recorded change per note. This
is discovery only; search with the same scope/range retrieves the other changed
passages, preserving different revisions at overlapping offsets.
`find_notes` defaults to passage discovery; `read_notes` with `purpose=answer` accepts selected IDs or a
known note ID and delivers canonical current content or labeled historical changes,
with compact validated citations and interval support. Expanded per-range provenance is opt-in; historical identity and timing remain present without expansion. `read_notes` with `purpose=edit`
is reserved for proposal preparation. Read continuations preserve remaining IDs,
provenance position, and options. Search continuations preserve scope/range/configuration;
model callers pass cursor only to find_notes (including retained result kind),
and purpose=answer plus cursor to read_notes. Delivery completeness is separate from retrieval coverage.
Passing an activity range to a read returns backend-checked `activitySupport`:
supported, uncertain, or not_established. Broad current reads and baseline dates
do not establish whole-passage activity. This check does not validate semantic entailment. Activity results can
be followed by reads, unrelated searches, planning, research and proposals.
The private inventory collection has a bounded storage-proof allowance;
model-facing pages contain bounded previews and consume the same evidence-byte
allowance as other tools. Limits belong to `services/evidence/inventory.rs` and
`services/evidence.rs`. Counts are
per page and coverage/uncertainty remain explicit. Cursors bind range, scope,
canonical versions and provenance. Model references are issued only on reads.

QueryResolved events retain explicit submitted configuration, resolved range and
continuation in the existing durable event store. Follow-ups receive only this
configuration, never earlier result facts as evidence. Legacy query events are
converted to explicit ranges only for text activity; other date roles never
become edit filters. Invalid inputs return tool errors for correction within the
ordinary run guardrails. Nonretryable empty reads report their limiting budget
and cannot be repeated. No terminal inventory path or question-specific router
exists.


The automatic editor hint is metadata and a validated selection; selected and
explicit-link excerpts are checked against current canonical bytes. Editing
reads retain the reviewed proposal working-copy contract. A durable evidence-use
marker omits note-based answers from subsequent model history and compaction;
source-free dialogue remains available. Later model history retains bounded,
currently permitted cited note references in a fresh app-issued context message,
separate from earlier assistant prose. The bounds and history assembly belong to
`chat.rs::normalized_rig_history`. Each group links current
canonical note identities and titles to its answer ordinal and a bounded copy of
the preceding user request, and marks the latest completed answer. That historical
user wording preserves conversational intent; it does not establish note facts.
These navigation hints carry no old excerpts, assistant claims or citation authority. Compacted references
are rebuilt from stored sources and separate working-note reference IDs on every
request rather than persisted in summaries. Successful editing acknowledgements
save those IDs in the terminal transaction, including across reloads and branches;
working-copy excerpts never become citation sources or later context.
Access, identity and location are rechecked before inference and delivery; body
changes alone do not invalidate these metadata hints. Only references admitted
to the rendered history retain validation bindings. Runtime observers carry an
independent evidence context so disabling executable tools cannot disable the
pre-inference checks. Recent user and source-free assistant
messages retain their full text, subject to the existing recent-message window
and explicit compaction. Oversized assembled requests fail through context
admission instead of clipping each message. Old unversioned compactions are ignored.
Before every model request and final delivery, context versions, search scope
versions and admitted citations are checked; stale evidence stops the answer.
Historical UI transcripts are not fresh evidence. Each validation pass assembles
permissions once, validates each admitted passage identity with all delivered
provenance proofs, and fingerprints each distinct search scope once. These are
per-operation reuse rules, never caches across freshness boundaries. Repeated
payloads still consume the model evidence allowance.

The runtime's `research_notes` worker has a separate prompt/history and only
evidence discovery/read tools. Its role contract gathers and selects evidence rather
than inheriting the full assistant's answer, planning and proposal instructions.
The final JSON contract applies after intermediate tool calls. Its prompt contains
the focused question, tool-facing scope and explicit range, discovery hints and run
instant; hints are unread metadata, and internal normalized bounds/default queries
are not model inputs. It retains the parent's provider/model routing, shares the
run guard and evidence-byte budget, and returns selected issued/read IDs and gap
codes. The backend resolves passages; worker prose and intermediate transcripts
never enter parent context. One worker may run at a time, with invocation-specific
tool-call and timeout limits owned by `agent_tools/research.rs`, under shared
parent call/token/time and evidence limits. The agent may invoke research again
for another question or scope; a lease is released on every exit, and cumulative
usage includes all invocations. Period-scoped workers
must obtain their own temporal candidates; direct canonical reads for current-status checks remain with the parent. Provider failure remains explicit;
there is no local-to-hosted fallback.
Worker reads inherit the invocation's explicit range when omitted, reject a wider
submitted range, and preserve cursor-owned options. The handoff identifies already
read primary items separately from remaining selected candidates: the parent can
cite delivered items directly and read only remaining IDs, preserving room for
independent current-context retrieval in the shared allowance.

`AgentRuntimeRequest.output_schema` is an optional app-owned result contract,
independent of executable capability grants. The private adapter uses the pinned
engine's Tool output mode so schema formatting does not suppress gathering calls
on local backends. Its appended result formatter is non-executable: the engine
returns its arguments rather than dispatching an application action. Research
uses a closed evidence-ID/gap schema; accidental terminal prose receives the
engine's bounded output retry under the same call/token/time limits. The evidence
owner still rejects unread IDs, unknown fields/gaps and oversized selections.
Isolation clears any parent result schema before assigning the worker contract.
OpenAI forced web search selects the hosted tool on the initial completion only.
The app-owned dispatch policy releases that raw selection on subsequent requests,
including output retries, so gathering tools and the result formatter can run.
During context finishing, only this appended formatter remains callable; all
executable tools are removed. The private compatibility check matches the final
definition's exact result schema, including collision-renamed formatters, and is
covered through the production streaming runner. Measurement separates formatter
count from executable tool count without recording their definitions or content.

Tool-capable chat uses a readable `segments`/`text`/`sources` answer schema.
`agent_runtime/result_stream.rs` identifies the appended formatter by its exact
schema on each actual dispatch (including output retries and renamed formatters),
then emits internal, non-durable `ResultStream` fragments for that part only.
Executable arguments and ordinary formatter commentary are not draft answer text.
`chat/structured_answer.rs` decodes only segment text from bounded JSON prefixes;
`chat://answer-draft` carries a full literal-text snapshot with request/message
identity, dispatch attempt and sequence. Raw JSON never enters frontend activity
or durable event history. The controller rejects old attempts, sequences and
terminal-run events; draft text has no Markdown, links or citation controls.
At finalization the app independently rejects malformed/unknown fields, duplicate
or unissued IDs and stale/excluded passages, then constructs Markdown links and
persists only selected validated sources. Rig Tool mode retries malformed JSON;
it does not enforce the app's closed schema. App validation failures are terminal
and retryable by the user, without an extra automatic model call. Final Markdown
replaces the draft only after terminal persistence succeeds. Local models without
tool support keep their ordinary text path. These checks establish source identity
and shape, not semantic entailment of a model's claims.

An empty resolved research scope returns `empty_scope` without starting worker
inference or widening access. Selection accepts raw JSON or one standalone JSON
code fence; both undergo the same closed-schema, gap-code and actually-read-ID
validation. Surrounding prose is rejected. Durable `ResearchCompleted` events
report fixed stage/outcome/reason codes and counters, including selected versus
actually delivered passages, model/tool attempts, discovery/read calls and tool
errors. Completed reads remain counted after failure/timeout, without becoming
delivered evidence. Empty selection preserves a supplied closed gap code; absent
one it reports unavailable rather than asserting no matching evidence. Events never contain worker text, identifiers, scope
values or raw provider errors, and do not add user-visible answer parts.

Evidence limits are byte-based allowances owned by `services/evidence.rs` and
its read implementation; they are not token counts or quality guarantees.
Model-facing search and read cursors retain their configuration inside the evidence
session; internal provenance offsets are not model inputs. Historical proofs are
persisted additively in passage JSON and navigation opens their content revision.
`agent_guardrails.rs::AgentRunLimits` owns shared context-byte, aggregate-token,
tool-call and elapsed-time ceilings; `agent_runtime.rs` owns model-call and retry
limits.
Opt-in `GNEAUXGHTS_CONTEXT_DIAGNOSTICS=1` wraps the completion model inside the
runtime seam and observes assembled instructions, messages, tools, documents,
output schema and provider parameters. ContextMeasured events contain counters
and runtime/attempt identities only. A bytes/4 baseline is explicitly approximate,
not eligible for enforcement; media token counts and absent usage remain unknown.
Configured output limits and independently observed LM Studio loaded capacity are
reported without inventing an output reserve or substituting advertised capacity.
The read-only metadata probe is bounded, nonredirecting and nonfatal; its result
is shared with the usage-driven guard on each local completion attempt. Research forwards these counters but never its
prose or raw tool content. A pending attempt closes with unknown usage on dropped
or superseded work. Existing byte admission and cumulative limits remain ceilings.

A separate per-runtime usage context guard uses reported input tokens and observed
loaded capacity. Parent and research worker baselines are independent. Only new
retained text is projected (serialized UTF-8 bytes plus message framing), and
configuration changes, replaced history, media or absent usage invalidate the
baseline. Each local runtime reuses one metadata HTTP client. Successful loaded
capacity observations are refreshed on every request, so server reloads can
change the allowance. Unavailable metadata uses the model-specific retry backoff
in `agent_runtime/context_measurement.rs`; a different model probes immediately.
No positive capacity is cached. Unknown capacity keeps existing fallback limits.
`agent_runtime/usage_context.rs` owns the answer/reasoning reserve, safety margin,
and allowance for another gathering step. Near capacity it skips pending tools,
preserves history/evidence and sends at most one final request with tools disabled and an
explicit output cap. If the final reserve cannot fit it stops explicitly. This
is conservative prevention, not exact tokenization or automatic history trimming.
Counter-only ContextMeasured finishing events are emitted even with optional
request diagnostics off; worker events retain their worker identity.

These bounds are implementation defaults, not measured quality guarantees.

Application tools register through `agent_tools/feedback.rs`. It preserves exact,
known application validation/recovery messages across Rig's error normalization;
unknown dependency diagnostics retain redacted feedback. Parent and research use
the same registration seam. Durable activity summaries consume only model-safe
feedback (including text errors), count distinct delivered notes, and distinguish
incomplete delivery. They do not persist raw arguments or internal error strings.

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

- `src/lib/architectureFitness.test.ts` checks frontend owner separation, external-sync write routing and
  capability bypasses. Document shapes and reducer behavior are checked by types
  and behavioral tests rather than duplicating their implementation in source scans.
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
