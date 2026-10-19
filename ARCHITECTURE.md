# Architecture

Gneauxghts is a local-first desktop notes app. The Svelte frontend owns the
interactive workspace and open-document experience; the Rust backend owns
durable files, projections, search, chat authority and external-effect proof. Pi owns
ordinary chat execution and history in the shared WebView runtime. Markdown files in the vault
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
| Background save notification routing | App-shell `backgroundPersistence` subscriptions; workspace and composer owners retain their existing write queues |
| Canonical note bytes | The Markdown file in the vault |
| Ordinary-note mutation, observation, and role-limited history access | `NoteTimeline`; post-publication catalog, task, lexical, semantic, and warning coordination is private behind this seam |
| Editing Window capture, deadlines, recovery, and finalization | `NoteTimeline`; workspace departure and save flushing remain with existing frontend owners |
| Canonical task toggle, delete, and due-date behavior | `TaskMutationService` |
| Task-group ordering | `TaskListStore` admits one pending reorder for drag and menu actions; the existing SQLite order transaction merges filtered submissions while preserving omitted ranks |
| Complete pane navigation, departure ordering, and location history | `NotepadWorkspaceSession` using concrete workspace/document owners and private operation admission |
| Global history browsing, bounded revision-label, confirmed history-clear, and complete Version Restore actions, entry/exit, paging, and workspace return | `HistoryModeSession` through `historyModeMachine.ts`; it overlays rather than joins pane or document ownership |
| Conversations, immutable entries, submissions, generation/tool tasks, queue, usage, recovery and compaction | Pi Durable/Pi AI/Chord through `features/chat/pi/runtime.ts` |
| Selected conversation, composer and mounted chat views | `ChatPanel.svelte` and its disposable Pi view binding; workspace retains pane membership |
| Read/write authority, source identity and exact external-effect proof | Native `pi_chat/authority.rs`, `notes.rs`, `citations.rs` and `publication.rs`; NoteTimeline remains canonical publication owner |
| Mutually exclusive editor transients | `PaneTransientUiController.active` through `paneTransientUiState.ts` |
| Semantic indexing work | The backend semantic work queue and worker context |
| Device-local search runtime and model setup | `GemmaLiteRtEmbeddingProvider`; desktop setup verifies pinned native LiteRT/model bytes; iOS loads the build-verified, signed framework from the app bundle and setup installs model data only. Explicit Settings setup uses semantic work admission; shared snapshots expose setup phases and byte progress independently of inference |
| Compatible semantic generation and query admission | `SemanticGeneration` gates the vault-lifetime provider/database/ANN bundle; the semantic worker publishes after source/recall reconciliation through NoteTimeline source admission |
| Next-launch semantic recovery | Vault-local `semantic-provider.json` stages Gemma or retained Jina; composition selects one provider on launch |
| Running vault root, vault-data paths, and app-local observation path | Immutable `RunningVault`, resolved once at composition and retained by `AppState` and startup-bound services |
| Next-launch vault selection | The atomically published vault configuration preference; Settings Apply stages it without rebinding running resources |

Compact pane rails derive their geometry from measured workspace space and
WorkspaceStore's active pane. They retain editor/chat mounts and share the
existing pane layout motion seam. The shared dock keeps its workspace width;
its actions follow the expanded pane. At every width, dock presentation follows
active-pane changes while preserving explicit mode choices within the same pane.
An open chat keeps the dock's existing chat/search presentation and return
button at every width; that button activates the retained chat pane and composer.
Compact header controls retain their geometry across split membership changes;
the global compact tab selector participates in that same pane presentation
coordinator. Search content height is separate from the dock's circular action
size, so wrapping controls cannot change the circle exchange endpoints.

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
external observations, History Mode reads, scoped current-content reads, and
the future explicitly granted agent-restore path. Editor, task, typed agent-publication,
lifecycle, watcher, and reconciliation callers enter its closed typed contract. Post-publication
catalog, task, lexical, semantic, warning, and recovery coordination is a
private timeline implementation detail; no parallel mutation service is
available to callers. The same boundary can deepen durability ordering without
changing those callers or exposing SQL and storage policy.

Frontend adoption of a committed result enters `DocumentEditingService` through
an operation-specific method. That boundary locates any retained document and
shared runtime, atomically adopts identity, saved baseline, publication warning,
and the canonical open-document lookup, and preserves edits that remain newer
than the committed operation. Agent publication verifies canonical read-back
against its receipt while the operation-specific editor lease protects the target. Save and rename
never replace the document handle, shared editor root, timers, save queue, or pane
references. If a committed result
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
operations. Task and typed agent-publication owners supply their domain transform
or authorized content; they do not receive prepared tokens or orchestrate canonical writes,
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
finalized revision. Distinct task, agent publication, restore, and observed changes remain
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
module. The agent-restore capability remains absent; future Version Restore
authority requires its own typed operation and decision. Native current-content
reads remain role-limited; unused activity-history and provenance capabilities
are removed under ADR 0012. Pi tools expose search/read, targeted saved-note updates and explicit note creation. Revision and Lifecycle Event identities
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

Current-content reads check current eligibility, canonical authored bytes, and
the runtime mutation generation before delivery. Restore selection is durable
domain evidence attached to the prepared publication before Markdown is
written; its reference survives finalization recovery and is removed with the
retained timeline.

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
Known publication failures and prepublication conflicts explicitly abandon their
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
On iOS, `VaultInfo.canRelaunch` is false: Settings explains manually closing the
app in the App Switcher and reopening it. `prepare_restart` rejects automatic
restart before accessing lifecycle owners, without authorizing resume; Apply and
backgrounding retain the Running Vault. A manual force-quit does not claim a
portable clean close or guaranteed completion of frontend background saves.
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
rolls back known failures and retains indeterminate recovery evidence. Forgotten
metadata contains notes only; Pi chat forgetting is presentation metadata in its
own store. Forgotten metadata uses the `AppState`-bound app-state database, so a
staged next-launch selection cannot redirect lifecycle records away from the
running vault.
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

### Agent publication foundation

Ordinary chat exposes native search/read, targeted `edit_note` and `create_note` tools. The public
Pi edit factory stages replacements against the exact issued read in memory;
Pi memo retains the computed edit candidate; creation reuses Pi's checkpointed
tool arguments. Pi task and document state own exact review and replay.
Write grants are independent of read access, with review enabled by default.
The Pi publication task carries review and publication phases through
`pi_chat/publication.rs`. Agent mutation admission uses strict update and create payloads. Updates require
the exact issued read and raw base hash. Creation binds one existing visible folder,
a native-derived filename, fresh native identity and canonical bytes before review.
The separate create operation is never inferred from an update grant.
Native admission binds operation, scoped grant, authority revision, exact payload,
review acceptance when required, and the expected native read state. The retained
`DocumentEditingService.withAgentPublication` operation supplies a short editor
publication lease: dirty body/title/tags/identity, unresolved conflicts or pending
operations block admission, and edits cannot race an admitted publication.

NoteTimeline owns canonical create/update and retained publication proof. A Pi task
stores opaque intent/receipt references and reconciles existing proof before retrying
an uncertain acknowledgement. Revocation prevents new effects without undoing a
published effect. Canonical adoption uses the verified receipt and read-back through
the document owner; an external mismatch remains a conflict. Pi owns publication
task checkpoints; no generic filesystem executor or competing chat status store participates.
The mutation source is `AgentPublication` (`agentPublication` in IPC and new history
records). Native history readers accept the former `acceptedChatProposal` tag only
as the same source, preserving retained revisions and pending-intent recovery.

### External changes

Watcher events enter the document external-sync machine. Clean documents adopt
disk content; dirty documents retain both versions in an explicit conflict.
App-owned writes carry operation-specific expectations so only their exact
filesystem outcomes are suppressed as self-saves.

## Coordination rules

The application uses small state machines rather than one application-wide
machine. Note persistence, external synchronization, pane lifecycle,
navigation, mounted chat presentation and transient UI can progress
independently. Pi coordinates generic chat tasks and submissions.

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
Atlas owns complete cache clearing and one notes-only map generation. Chat
conversations are not map documents, semantic recall rows or navigation nodes.
Chat settings do not configure or invalidate Atlas.

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

Automatic cloud names belong to `semantic/atlas_labels/topic_names.rs`. Parents
score umbrella words across equally weighted child themes and reserve descendant
names before sibling assignment. Label publication refreshes automatic parent
names under this policy while retaining independent user overrides.

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

Pi's public conversation/submission operations admit chat work. Mounted bindings
watch Pi documents/views and page immutable entries for the human-visible transcript;
they do not persist a second projection or drive a generic application scheduler.
The composer retains unsent text through the existing native draft owner. Explicit
note attachments contain Note Identities, resolved through current native authority.
Pane return targets remain workspace navigation state and never become implicit
model context.

The notepad's shared input dock owns only the expanded search/chat mode and
which pane supplies its chat slot. Search stays mounted in its existing owner;
`mountInSlot` places the selected pane's mounted composer in the dock without
copying its text, attachments, configuration, or draft persistence into workspace
state. `workspaceDockMachine` owns the presentation transition between editor
search, chat search, and chat input. One correlated frame clock drives the bar,
circles, joining material, and controls; input contents reveal near settling and
finish fading after motion completes. The dock adapter measures mounted
inputs and blends coordinate spaces, including the adjacent actions, when
Related layout changes during a morph. `paneLayoutMotion` coordinates every split
entry and departure on the dock's existing editor transition clock, regardless
of pane kind or viewport width. It interpolates the measured dock flex bounds
alongside the panes, keeping width caps from reversing the bar during expansion.
When a dock morph accompanies the layout change, both sample the same remaining
clock and easing; the coordinator publishes the dock's final flex bounds in a
correlated presentation event after installing their effects.
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
Split choices enter through one `notepadWorkspaceSession.splitWorkspace` command.
Current and previous locations determine the new pane's kind before completing
creation, then use the same location application as the pane picker. A chat
destination therefore mounts directly as chat, without a temporary editor or a
second layout transition. Focus waits for the shared presentation barrier.

## Agent runtime

[ADR 0012](docs/adr/0012-found-ordinary-chat-on-pi.md) records the implemented
ordinary-chat decision. Desktop and iOS use `features/chat/pi/runtime.ts` and the
native `pi_chat` module; the old ChatService/ChatController, Rig execution loop,
managed transcript projection, research/proposal workflow and opt-in evaluation
composition are retired. Existing authored files and native notes/settings are
preserved. There is no old-chat import, exact Retry, migration or fallback runtime.
Desktop replacement, retirement checks and simulator acceptance are recorded in
[the completed rebuild outcome](.scratch/archive/pi-chat-rebuild.md). Physical-device
acceptance remains deferred.

The subsequent [provider/observation adapter alignment](.scratch/archive/pi-chat-adapter-alignment/outcome.md)
uses Pi's public factory, option mapping and Chord lifecycle APIs, with sanitized
runtime diagnostics and incremental list metadata. Its desktop and bounded simulator
acceptance preserve the native guarantees below.

### Pi-owned execution and history

One Running Vault composition opens upstream `SqliteStorage`, `Harness` and Pi AI
models. Pi owns immutable history, conversation documents, submissions/inbox,
generation/tool/compaction tasks, scheduling, queueing, cancellation, recovery,
usage and progress. `ChatDoc` stores title, opaque native authority reference and
presentation metadata; provider/agent/usage/inbox state uses Pi's built-in documents.
Pi's `conversationCreated` hook initializes `ChatDoc` and `EditReviewDoc` in every
creation/fork transaction, including raw transaction creation. Opening a selection
does not initialize documents or resolve an agent: metadata comes from the initial
custom-document watch value and model configuration from the built-in view's
`AgentDoc`. Subsequent updates use those same watches.
Titles derive from the first message without inference. Svelte selection and live
views are disposable, while composer drafts use their existing presentation owner.
Forget is a reversible presentation archive in `ChatDoc`: idle chats leave the
conversation picker, and the pane keeps an ephemeral undo reference. Undo restores
the same Pi history without inference. Forget does not purge history or alter native
authority; permanent deletion must retire authority independently. Other mounted
panes observe the archive and release their selection.
The composer reuses the ordinary layout and model/reasoning controls. Note names
are entered in chat text rather than attached through a note picker; the agent
searches and reads through native authority. The access control offers Full vault
or No notes, using the native empty attached-notes scope for No notes.
The UI scans entries for persisted human-visible history rather than assuming the
active post-compaction `ConversationView.entries` contains the full transcript.

Mounted selections use cancellable Chord observation contexts for watches and
history reads. Cancelling a selection releases observation only; submissions,
Stop, withdrawal and native retirement retain their separate operations. Pi's
view operations trigger transcript merging only for entry changes or full
replacement frames; progress-only updates retain the loaded history array.
Older-page loads still merge complete human-visible history independently.
Committed-edit feedback comes from retained terminal publication tasks and public
task commit notifications, joined by task ownership to Pi tool-result entries.
The selection keeps only a disposable result projection, so Stop can report an
already applied edit and its repair warning after reopen without resuming
generation or changing native publication. Task working documents are not treated
as retained outcome records.
Pi reports and watch failures feed the bounded ephemeral `pi/diagnostics.ts` sink.
It publishes curated codes/messages rather than exception or provider payloads;
reports do not settle work. Actual Harness termination makes the runtime
unavailable, while normal shutdown clears its diagnostic presentation.
Conversation-list summaries scan Pi conversations and snapshot `ChatDoc` and
`AgentDoc` without resolving full agents. Public commit publications update loaded
metadata; serialized page reads replay intervening metadata changes. This
disposable list state retains loaded older pages without a native index or durable
summary mirror. Streaming and usage commits do not rehydrate list rows.

Pi's `Conversation.abort` and submission cancellation own Stop and queue withdrawal.
Switching panes or conversations does not cancel work. Reopening installs native
provider-session/authority mappings and model metadata before `harness.resume()`;
retired authority is denied and its work aborted. Explicitly stopped work stays
stopped, and terminal failure offers a new submission under current settings.
There is no frozen request-history copy, exact Retry or extra resume ledger.

Normal Pi history retains provider-emitted reasoning, earlier tool results and
answers as working memory. Reasoning is collapsed by default in presentation and
uses Pi history/events rather than a transient legacy channel. Standard Pi
compaction inherits upstream scheduling, summary and recovery defaults without an
application override. `modelLimits.ts` only translates observed positive model
limits; unknown capacity remains unknown. Summaries are fallible
memory, never fresh note evidence or authority. Current-state claims require another
authorized read. No custom summary engine or background title/research inference runs.

### Native transport, storage and authority

`nativeSqlite.ts` implements upstream `SqliteDatabase` through `pi_chat/storage.rs`.
The native fresh Pi store is separate from legacy chat/evaluation stores and keeps
SQLite transaction ownership, rollback, durable commits and orderly close/checkpoint.
No native message/task mirror or durable UI projection is added. Bridge call/byte,
provider and database/WAL measurements are diagnostics, not permanent numerical caps.

`nativeProvider.ts` uses Pi AI's compatible local and OpenAI providers through
`pi_chat/transport.rs`. Rust resolves configured endpoints and credentials; model
arguments cannot choose arbitrary URLs, headers or native paths. Native authority
checks occur before dispatch and again before terminal delivery, including ordinary
tool continuations, recovery and standard compaction. Generation-hook exceptions
are not a security boundary. Provider response parsing/streaming remains Pi AI owned.

Public Pi AI `createProvider` composes the native transport/admission wrapper with
the built-in OpenAI provider's `stream`/`streamSimple` methods and the local
Completions implementation. Catalogued hosted models inherit Pi's complete model
definitions, including compatibility flags, input limits, pricing and model limits;
the wrapper clones them before applying native-selected reasoning settings.
Settings and composer model suggestions use Pi's built-in OpenAI catalog IDs,
names and ordering; reasoning controls derive their supported positive levels
from Pi's public helper. API-key discovery intersects that supplied catalog with
native account availability. Subscription discovery retains the account's visible
models, including IDs absent from the installed Pi catalog. Saved defaults,
current/recent choices and custom model entry remain available.
Native auth is represented to Pi with a nonsecret placeholder whose shape selects
its API-key or ChatGPT subscription serializer. Real credentials remain native,
and caller URLs/headers never choose native routing or credentials.
Uncatalogued models retain conservative custom metadata, and arbitrary local servers
use native discovery and existing compatibility settings. Startup deduplicates
selected-model discovery within that pass while restoring every native binding
before scheduling. The factory catalog holds selected models only. A narrow
compatibility adapter updates an already-resolved model record after successful
native discovery, including a first-inference observation of previously unknown
local capacity, before terminal admission permits the next compaction decision.
Explicit configuration refresh invalidates that observation; no persisted model
catalog or whole-server discovery cache is added.

Desktop ChatGPT sign-in uses Pi's public built-in OAuth login and refresh flows in
`scripts/chatgptAuth.mjs`. The desktop build bundles this helper and a licensed
Node runtime; installed users do not need a separate JavaScript runtime. Native
`chatgpt_auth.rs` owns the helper's private stdio, OS-keyring credentials, serialized
refresh/rotation, cancellation and device-scoped auth-method preferences. Native
retains the issued app client ID with the host ID across reconnect and disconnect,
adopting existing keyring registration metadata before removing tokens. A pinned
Pi patch adds returning-client login and callback support; sign-in without a saved
registration uses dynamic registration. The issued ID is saved before token storage
so a failed keyring write can retry without registering another app. Native also
owns the active login and its curated progress, so leaving Settings only
releases its polling view. Browser reopening and Pi's optional pasted callback
share the same attempt and cancellation lifetime; callback input travels over
private helper stdio and is never logged. Safe progress, the temporary browser
sign-in URL, connection status and the selected method cross WebView IPC. OAuth credentials
and API keys occupy separate keyring accounts; switching methods is explicit,
and subscription failures never fall back to billable API-key requests. Neither
credential type belongs to a vault or Pi history. `secrets.rs::CredentialStore`
lazily retains successfully read desktop credentials for the process lifetime,
coalescing concurrent cold reads and updating memory only after durable store
writes. Removal/replacement evicts stale cached values even on store failure;
errors are retryable and a fresh process reads the OS store again. External OS
credential changes become visible after restart. Opening Settings reads metadata
only; model discovery runs after sign-in, explicit method selection or Check
connection. This avoids repeated decryption prompts during ordinary desktop use.
Settings offers sign-in only when no subscription credential remains; native
login is idempotent for an existing connection. On subscription HTTP 401, native
checks the rejected token against the current credential under the auth gate and
attempts Pi refresh. Confirmed terminal refresh errors retain the registration and
remove unusable tokens, exposing sign-in again without changing billing methods.
Transient refresh failures keep credentials. Pi's patched token errors carry a
machine-readable OAuth code privately; only a curated recovery code crosses
helper stdio. Model checks refresh the safe status after completion or failure.
Mobile retains per-read protected-storage policy and API-key support;
the subscription helper is desktop-only.

Subscription inference uses the public Responses endpoint and the signed-in
account's visible model catalog. Pi serializes full conversation input; native
transport rechecks unsupported request fields and groups the four note functions
under the supported `gneauxghts_notes` namespace, preserving Pi's schemas and call parser.
Call namespaces follow the selected billing method when continuing existing
history. Native note authority, review, publication and citations are unchanged.

`pi_chat/authority.rs` owns durable native read/write scope and authority revisions.
Full-vault and note-scoped authority both honor exclusions and current eligibility.
The composer offers Full vault or No notes; model-discovered Note Identities resolve
to canonical authorized reads. Unsaved editor buffers, automatic editor hints and
arbitrary files are not model inputs. Restricting
access retires affected authority and in-flight deliveries, aborts the old Pi context
and starts a fresh conversation/provider identity. Old history remains human-visible
but cannot enter the narrower context. Widening read access grants no writes.

The existing `ChatDomain` remains a settings, exclusion, model-capability and composer
draft owner; provider settings and credentials survive retirement.
Native `pi_chat_*` records in vault data own only domain authority/source/effect proof.
Pi stores opaque references and task progression. Temporary write grants belong to
one conversation across reopen; Always grants belong to the Running Vault; explicit
revocation/deletion ends the relevant authority. Review is independent and default-on.
The model registry exposes `edit_note` and `create_note` under separate explicit
update/create authority. Chat and Settings expose creation as an unchecked permission
option; duration changes preserve already granted operations and folder scope.
Choosing Temporary or Off replaces vault Always permission atomically;
Always remains visible in every chat, including those with retained Temporary
grants. Native policy changes invalidate mounted authority views.

### Notes and citations

`pi_chat/notes.rs` supplies native lexical search and authorized canonical reads.
Search previews issue no citation authority. Reads create immutable native source
receipts bound to Note Identity and actual read state. Pi tool details retain the
full structured read metadata; model-facing output contains canonical Markdown,
note/source identities, title, optional passage and a complete native-issued Markdown
citation. `ReadSource::citation` owns its escaped note-title/passage label and
opaque source destination; read tools and terminal admission use that same form.
Revision/hash proof is not repeated in model-facing output, including
post-publication reads. An existing finalized revision may identify the read; an unfinished
Editing Window uses an observed hash/time receipt without inventing a Note Revision. Native reads
use canonical metadata identity checks rather than treating a path as authority.

`pi/citations.ts` parses only reserved Markdown source links;
`pi_chat/citations.rs` validates every terminal text block against the native binding,
current authority and issued receipts before Pi receives successful terminal output.
Admission returns only the admitted Markdown blocks; issued receipt metadata stays
with the native read owner and Pi tool details, not a second answer-source array.
Malformed/unissued IDs become inert unavailable markers; excluded or retired authority
cannot deliver fresh answers. Reasoning, usage, signatures and tool handoffs retain
their Pi protocol shape. This uniform seam also admits standard compaction output
without imposing an answer formatter or custom summary schema. There is no token
encoder/decoder, legacy label renderer or source-free admission fallback.

Source links display escaped native note titles and open the current note through
ordinary workspace navigation. Revision/hash receipts remain internal evidence of
the actual read; later edits do not invalidate it, and navigation warns when current
content differs. Optional exact unique quotes supplied to `read_note` create native
passage locations. Navigation rechecks current exclusions, eligibility and quote
uniqueness, then the live editor verifies and selects the exact quote. Changed or
ambiguous passages open the note with a limitation instead of a stale selection.
Citation admission establishes identity and location, not semantic entailment.

History Mode remains a native NoteTimeline facility; unused current-content
provenance and retained activity capabilities are removed. Ordinary Pi tools expose
search/read, targeted updates and note creation; no general filesystem or history administration is available. Interactive query search uses `services/retrieval.rs` and its private `search` module
under the native current-content delivery boundary. Lexical and semantic indexes
rank candidates; canonical snapshots supply bounded previews. Pending lexical
projections use catalog paragraphs, and external-byte changes invalidate delivery.
`services/content_hash.rs` preserves the authored-content identity shared by search
and Pi read receipts. The retired evidence session, worker budgets, inventory/read
protocol and passage-citation coordinator are removed. Native NoteTimeline reads,
History Mode and publication remain independently testable.

### External effects and lifetime

`pi/edit.ts` exposes targeted `edit_note` updates using Pi's public `createEditTool`
against a one-note staging environment. The adapter uses its public
`prepareArguments` hook for edit-shape repair before Pi validates the note/source
schema; identifiers remain exact strings and arbitrary path arguments are rejected. Native `pi_chat_read_mutation_base` recovers
only bytes matching the exact issued source; it cannot silently rebase an old edit.
Pi persists the computed edit candidate before native preparation, then atomically records its
publication child task and review document in one commit. `PublicationTask` owns
durable review and publication phases; new task inputs retain intent/target
references and the approval hash, without a duplicate title or patch.
`EditReviewDoc` holds an explicit edit (patch) or create (destination and Markdown)
review plus the user decision, starts empty on fork, and is cleared on terminal
review/cancellation. Its Pi document upgrade preserves pending reviews from the
previous shape; consumers use only the current representation. No older task-input migration
is retained. Pi's generic tool task delegates to this task because its abort
protocol reconciles an already committed native effect.
No separate proposal scheduler, mutable native draft or hunk engine is retained.

The same Pi tool adapter, publication task, review document and native
prepare/approve/publish/reconcile flow serve both tools. Creation uses Pi's saved,
validated tool arguments without a second candidate memo. Creation review shows the
exact relative destination and complete authored Markdown, without managed metadata.
Native creation owns its identity and metadata; it uses NoteTimeline and the
existing atomic create-only primitive. An existing or late-arriving file blocks
publication, with no overwrite or automatic filename suffix. One stable Pi request
reopens the same native intent, identity and bytes; proof reconciliation establishes
a committed creation before any replay.
The document publication lease blocks dirty/conflicted targets and adopts committed canonical results through
the established editor owner. Lost acknowledgements reconcile before another effect;
Pi recovery alone cannot guarantee exactly-once external publication.
Native initialization declares the current authority and grant schema directly;
there are no older authority/grant upgrades. Retained publication payloads use the
same strict mutation type as new requests. Updates retain a raw base hash;
creations retain their exact native-prepared canonical content. No retired-create
decoder or old-chat migration is retained.

After a committed result, both mutation tools use the same authorized native canonical
read as `read_note` and return the saved content and a fresh citation to the
model. Final confirmations use that post-publication read. Creation permission
does not implicitly widen independent note-read access. A read failure preserves
the committed receipt and explicitly withholds current-content evidence; it
cannot turn a proven commit into a blocked write or trigger another publication.

WebView page generations bind editor-owner registrations so an actual refresh can
replace a stale page without admitting concurrent owners. Restart requests the
frontend Harness close, joins effects and native transport, then checkpoints/closes
storage and NoteTimeline before relaunch. The first native frontend-close request
begins irreversible terminal release; timeouts or later failure cannot reopen it.
Native shutdown re-delivers the same pending request until acknowledged, including
when the frontend listener is still starting. Retry retains that token and joins
the same release.
Background best-effort persistence keeps the Running Vault open. See
[behavior invariants](docs/architecture/behavior-invariants.md) for these boundaries.

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
  storage-neutral role-limited `NoteTimeline` seam, the single Pi runtime graph,
  native authority/publication separation, and semantic-work ownership.
- `src/lib/contracts/ipcFixtures.test.ts` checks representative command and
  event shapes across the Tauri seam.

When a change introduces a second owner, bypasses a canonical write path, or
changes one of these seams, treat it as an architecture change. Update this
map, the applicable behavior invariant, and an ADR only when the decision is
hard to reverse, surprising without context, and the result of a real
trade-off.
