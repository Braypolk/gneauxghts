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
typed arguments and domain errors. Chat related-note suggestions enter this worker;
composer typing never runs retrieval on the IPC dispatch thread. Each composer
keeps at most one suggestion request in flight and coalesces pending edits to
the latest query. Substantial domain operations receive concrete
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
| Running vault root, vault-data paths, and app-local observation path | Immutable `RunningVault`, resolved once at composition and retained by `AppState` and startup-bound services |
| Next-launch vault selection | The atomically published vault configuration preference; Settings Apply stages it without rebinding running resources |

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

`AppStore` is the sole frontend admission point for bundled bootstrap and the
shared running/next-launch vault and semantic snapshots. Listener attachment is
part of bootstrap admission and a failed attempt cleans partial listeners before
retry. Snapshot loads and commands claim per-slice revisions when they start, so
older results cannot replace newer events or operations. Settings retains only
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
History Mode and returns at most 31 surrounding predecessor-ordered records.
Private rebuildable successor indexes avoid walking newer history. Scoped
context cursors carry positions relative to the immutable anchor; nearby pages
replace the viewport and never merge with absolute newest-page coordinates.
Clear/restore leave anchored paging while retaining the independent citation
origin on the existing History Mode target. Request identities stop obsolete
entry work, and workspace restoration completes before a newer entry captures
its snapshot.

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

`services/evidence.rs` owns current evidence search, ranking, scoped/versioned
cursors, passage reads and canonical citation validation. `search_evidence` uses
the existing Tantivy paragraphs and reciprocal-rank fusion with local semantic
candidates; literal/regex modes inspect exact canonical Markdown. Semantic
availability and approximate coverage are explicit. Interactive note selection
uses the compatibility adapter in `services/retrieval.rs`; its metadata date
filters are distinct from agent surviving-content activity periods.

NoteTimeline remains the sole owner of activity reconstruction and range
provenance. Evidence consumes its allowed current-content capability and keeps
only surviving modified ranges, with surrounding current text labeled separately.
Monday-start local weeks resolve to half-open intervals. Baseline knowledge is
not an introduction date; Editing Window uncertainty remains intact.

Current-passage citations bind stable note identity, canonical content hash,
exact UTF-8 coordinates and optional retained revision evidence. Delivery and
navigation revalidate current bytes and permissions, recovering explicit grants
from the originating run. The UI opens the current note and focuses the exact,
unambiguous passage. Legacy Revision Citations still enter History Mode.
`passage_json` is an additive chat-store migration; canonical Markdown and
canonical history formats do not change.

`chat/citations.rs` owns ephemeral model references such as `[S1]`. Read tools
issue these only for delivered passage sources; selected research results receive
parent references independently of the worker's registry. ChatService constructs
canonical passage links before terminal persistence/delivery, intersecting the
registry with currently valid sources. Unknown references become explicit inert
unavailable text. The UI never guesses a model reference from a note title.
Transcripts and branches persist durable destinations, never depend on the
run-local registry, and continue to revalidate on navigation. Link integrity
is distinct from whether a claim is supported by its cited passage.

The optional `/sources` turn command selects the source-first preview. Its
composer control edits the existing draft; the saved user message retains the
choice on retry without another settings or persistence owner. ChatService uses
a selection-only prompt and search/read tool set, suppresses raw model text, and
renders validated selections through `chat/source_first.rs`. The existing
run-local citation registry owns stable clause IDs for exact admitted excerpts.
Supporting context is not selectable activity. Code escapes source Markdown and
constructs durable links; source grouping remains a model interpretation.
Invalid selections fail explicitly without a free-form fallback. Existing scope,
budget, cancellation and final freshness checks apply.

The evidence service owns a narrow typed note-inventory interpretation and an
immutable run anchor. Calendar expressions resolve in the named local timezone.
The structured contract accepts only listing/counting notes by recorded text
activity; other questions use ordinary evidence search/read. Older query events
can still decode their date roles, without treating event or deadline dates as
text activity. Plain activity inventories group current surviving
provenance by Note Identity and return a typed terminal result through the
existing runtime. The citation owner renders bounded exact excerpts and recorded
activity metadata directly, without a final model selection or synthesis call.
Runtime tool calls are serialized so this terminal result stops subsequent tools.
Inventories retain scope, cancellation and final source validation. Inventory
admission is separate from the model evidence allowance: pages have a 50-note
limit and a conservative 256,000-byte charge covering serialized rows and durable
sources. Each row keeps one validated representative passage, preferring definite
then recent timing. The renderer shows one linked title, an example recorded edit,
and bounded current context explicitly distinguished from edited text. Clock
uncertainty and actual date-boundary crossing are separate labels. QueryResolved
inventory diagnostics identify model evidence, inventory, display and retrieval
bounds and stop reasons.
Continuation cursors bind normalized bounds, scope, canonical versions and ordered
provenance; each page reports its own count. QueryResolved events reuse the durable
run event store. Follow-ups receive only the primary root query's interpretation,
resolved periods and opaque continuation, never earlier result facts as evidence.
Nonretryable empty reads report their limiting budget and cannot be repeated.
One standalone relative calendar phrase in the user's request can restrict the
tool's period schema and validation; compound or ambiguous phrases are left for
interpretation. The guard never reads note prose. Invalid interpretations receive
one correction, then stop. The former experimental general routing and its
environment flag have been removed.


Automatic active/selected/link context uses current canonical bytes. Editing
reads retain the reviewed proposal working-copy contract. A durable evidence-use
marker omits note-based answers from subsequent model history and compaction;
source-free dialogue remains available. Recent user and source-free assistant
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
search/read tools. It retains the parent's provider/model routing, shares the
run guard and evidence-byte budget, and returns selected issued/read IDs and gap
codes. The backend resolves passages; worker prose and intermediate transcripts
never enter parent context. One worker is allowed, with twelve tool calls and a
90-second timeout, under the parent call/token/time limits. Period-scoped workers
must obtain their own temporal candidates. Provider failure remains explicit;
there is no local-to-hosted fallback.

An empty resolved research scope returns `empty_scope` without starting worker
inference or widening access. Selection accepts raw JSON or one standalone JSON
code fence; both undergo the same closed-schema, gap-code and actually-read-ID
validation. Surrounding prose is rejected. Durable `ResearchCompleted` events
report fixed stage/outcome/reason codes and counters, including selected versus
actually delivered passages. They never contain worker text, identifiers, scope
values or raw provider errors, and do not add user-visible answer parts.

Initial evidence limits are byte-based estimates: 24,000 admitted bytes per run,
6,000 per read, 480 per preview, and 8 candidates per page (20 maximum).
Search cursors and per-passage provenance continuation offsets are separate.
The legacy prompt/history hook has a 128,000-byte admission ceiling; shared measured
usage has a 400,000-token ceiling and 96 tool calls within fifteen minutes.
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
change the allowance. Unavailable metadata backs off for 30 seconds for the same
model; a different model probes immediately. No positive capacity is cached.
Unknown capacity keeps existing fallback limits. The guard reserves
4,096 answer/reasoning tokens, a 1,024-token margin, and an 8,192-token allowance
for another gathering step. Near capacity it skips pending tools, preserves
history/evidence and sends at most one final request with tools disabled and an
explicit output cap. If the final reserve cannot fit it stops explicitly. This
is conservative prevention, not exact tokenization or automatic history trimming.
Counter-only ContextMeasured finishing events are emitted even with optional
request diagnostics off; worker events retain their worker identity.

These bounds are implementation defaults, not measured quality guarantees.
Fixture measurements and unmeasured live-provider questions are recorded in
[the evaluation report](.scratch/current-evidence/evaluation.md).

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
