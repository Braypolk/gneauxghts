# Behavior invariants

These are the non-obvious product outcomes that refactors must preserve.
Verify their implementation against current production owners and focused tests;
this document records intended constraints rather than proving every path enforces
them. Known implementation gaps are identified explicitly. Details not stated
here remain open.

## Workspace and navigation

### Vault selection applies on the next launch

Settings Apply validates and atomically stages a next-launch vault selection.
It does not close or rebind the running vault. Until the user explicitly
restarts, ordinary reads, saves, events, watcher reconciliation, forgotten-note
metadata, and app-local rollback observations continue to use the immutable
running-vault context. Applying another folder replaces the staged selection;
applying the running vault, including a canonical alias, clears the pending
restart. A failed selection leaves the running vault editable. A newly started
process resolves and binds only the persisted selection.

On iOS, Settings offers manual close/reopen instructions rather than automatic
restart. Returning to the Home Screen keeps the Running Vault open. The native
`prepare_restart` command rejects a platform without relaunch capability before
quiescing any owner. Settings avoids dispatching that command, retaining editing;
the native rejection cannot authorize resume if an ordinary exit is already
releasing the vault. The selection remains
replaceable or cancellable until the next process starts. Manual force-quit
does not establish a portable clean close or guarantee pending draft durability.

App-state schema initialization acquires SQLite's write reservation before
inspecting or changing the schema, including when independent connections open
the same vault concurrently. Bootstrap and migrations commit together; failure
rolls them back without removing existing metadata or publishing an incomplete
storage handle. Contention waits within the connection's bounded busy timeout.

### Restart releases one running vault before relaunch

Restart immediately makes the workspace inert, then joins the existing pending
Version Restore and save/departure work. It does not create a parallel save
queue. Backend preparation joins concurrent callers and returns ready only after
chat/tool/permission/title work is cancelled and settled, watcher debounce and
reconciliation are stopped and joined, admitted durable metadata/task writes
are settled, rebuildable projection and semantic work is quiesced, and the
bound Note Timeline reports a portable clean close. Queued rebuildable indexes
may be discarded; a complete index catch-up is not required for portability.

Process relaunch is never requested before that ready receipt. A save, conflict,
restore, producer-settlement, or clean-close failure therefore cannot trigger
relaunch. Editing resumes after a preparation failure only when every required
owner confirms reversible admission can be restored. Once terminal release has
begun—or when IPC cannot prove otherwise—the workspace stays inert while Retry
Restart joins or retries backend settlement. If relaunch itself fails, the
portable ready state remains closed and Retry Restart retries only relaunch.
Ordinary process exit uses the same backend settlement operation off the event
loop, but it does not imply unsent browser drafts were saved.

Closing the main desktop window requests ordinary process exit. The retained
Jina provider's embedding subprocess is tied to an app-owned pipe: its headless
supervisor kills and reaps that subprocess when the pipe closes, including after
abrupt app death or development-process termination. Gemma LiteRT runs in-process,
with its native engine owned by the application. Native macOS termination may bypass the
exit-request callback; its final exit event releases the runtime without
claiming a portable vault close or saved frontend drafts.

### Backgrounding requests saves without closing the running vault

The app shell routes hidden visibility, pagehide and the native mobile suspension
notification to mounted persistence owners. The workspace joins an admitted
Version Restore, cancels note debounce timers and requests ordinary note saves
through the existing per-document queues. Independent notes proceed even when
another note has a conflict or save failure. Protected proposal reviews are not
published; external conflicts remain unresolved and failed edits remain dirty.
Backgrounding does not finalize a review, close the Running Vault or request
process relaunch.

Each mounted composer captures its live unsent text and flushes through its
draft owner without sending or creating a conversation. Writes to one slot are
serialized across remounts, and a flush joins that owner's in-flight writes.
Failed draft writes retain the in-memory text/cache, report a visible error, and
can retry when the composer next records and flushes its live text. Subscriptions
are retired with their owners, including late native listener attachment.

These signals admit best-effort saves while JavaScript is available. They do not
guarantee durability after immediate OS suspension or termination, persist
unsent attachments, or establish a portable clean close. Protected review edits
are checkpointed through the proposal owner while JavaScript is available; a failed
checkpoint remains visible and cannot be reported as durable. Physical iPhone background/lock/termination recovery remains a separate
release-validation requirement.

### Bootstrap admits one coherent backend snapshot

The bundled application bootstrap is the only initial-session retrieval path.
Editing remains unavailable until both its payload and every required backend
listener are admitted; a failed attempt removes partial listeners and may be
retried. Newer events and operations win over delayed bootstrap, Settings, and
command results independently for each shared snapshot. Settings consumes the
same running/next-launch vault and semantic snapshots rather than retaining a
second copy. Editor asset paths always derive from the Running Vault, including
after a different Next-launch Vault Selection has been staged. Backend readiness
does not itself mean the mounted editor has adopted the session, and obsolete
mount work never applies to a later editor lifetime.

Initial editor mount and note navigation reveal the new body only after Markdown
formatting covers the restored viewport and its layout/scroll have settled.
Loading keeps the editor measurable but hides its content. Parsing runs in
bounded slices through the existing serialized pane lifecycle; obsolete or
disposed work cannot reveal a document.
Already formatted, stable viewports need no repeated frame waits. The loading
label appears only after 150 ms; its absence is not an editor readiness signal.

### New Idea changes only the invoking pane

Starting a New Idea leaves a nonempty document through the existing save/departure
boundary and rebinds only the invoking pane to a fresh draft. Pending proposal
reviews retain their protected working copy. Other panes retain the existing
document. Starting from an empty draft reuses it.

### Chat context and note navigation agree with visible content

A chat beside an editor follows the nearest editor's current note. Without a
visible editor, it uses its own retained note, which is also its route back to
editing. The note body, path, and selection sent with a message come from that
same resolved context. The model receives the allowed canonical note identity and
validated selection as a relevance hint; the conversation is not bound to that
note, and its body is retrieved only when relevant. The title header does not
present a current-note binding. Privacy scope and explicit access grants remain
separate from relevance selection.

Generic note navigation targets the nearest editor when one exists. Otherwise
it reuses the active retained-context pane and reveals its editor. Navigation
always passes through the editor lifecycle before content synchronization is
considered complete.

App-directed editor destinations, including current-note and all-notes search,
share one minimal-scroll policy: leave an in-band result still, otherwise reveal
it at the nearest edge of the 20–60% height band, subject to chrome and document
limits. Short wrapped matches fit as a whole; oversized passages reveal their
start. Measure rendered geometry and retain that boundary while virtualized
line heights settle. Newer cursor/edit actions supersede queued destinations;
native typing and saved scroll-offset restoration keep their existing behavior.

In this-note search, Enter previews the active occurrence and subsequent Enter
presses advance; Shift+Enter moves backward. Both directions wrap through every
occurrence, including matches sharing a result row. Previews retain search-input
focus and the original saved cursor. Hovering a result row or moving to it with
Up/Down previews and scrolls to its first occurrence using the same policy.
Enter continues from that preview. The current occurrence is yellow; other
matches use a muted secondary highlight. Clicking a result commits it and takes
editor focus; Enter in all-notes search still commits the active result.

### Pane changes retain a usable document route

Changing an editor pane to chat retains its document as chat context and as the
return target. Changing it back restores that document. Any pane may close
while another remains, including in a chat-only workspace.

Each chat pane retains a reading position per conversation for its open lifetime,
including while the pane displays a note. Returning restores that position after
history rendering settles. Explicit message links take precedence; unseen chats
and chats that were following the latest message open at the bottom. Loading and
partial history rendering cannot overwrite a retained reading position.

Retiring an editor closes its pane-owned transient menus before disconnecting
its view bridges, so its formatting popup cannot remain over chat content.
Touch external-link actions use the same pane transient owner and a keyed Svelte
surface. Pane collapse, retirement, History entry and competing editor menus close
them; editor document, selection and configuration changes invalidate their saved
range. Opening a URL remains an explicit choice separate from editing its Markdown.

After the active pane closes, the pane immediately to its right becomes active
when present; otherwise the pane immediately to its left becomes active.

### Compact splits keep every pane visibly reachable

Explicit Split commands can start a split in an edge-to-edge narrow workspace;
creation uses the ordinary workspace command and opens the retained rail layout.
When the retained split cannot provide useful pane widths, the active pane
expands beside a persistent title rail for its neighbor. Pane order stays fixed:
activating a left rail expands the left pane and leaves a right rail, and vice
versa. Enough card space restores the ordinary split. This is presentation
derived from the canonical active pane, never a membership or document departure.
Editors and chat inputs remain mounted; drafts, undo, selection, reading position
and pending work survive. Collapsed frames are inert and their transients close.
The rail supports pointer and keyboard activation, reserves space alongside
content, and exposes the pane title and pending/error state. The shared dock's
actions follow the expanded pane. The shared dock retains full workspace width
and the rail's hit target stops above it. Related stays within the expanded pane's
horizontal space. Rails sit below the maximum measured retained-header extent
and above the dock, with matching top/bottom fades; shared clearance stays
stable while exchanging panes. Pointer and keyboard activation wait for settled presentation
before focusing and yield to newer user input. Pane and dock transitions use the
existing coordinated presentation clock; resize and reduced motion settle immediately.
Compact text stays anchored to the outer edge of its pane's side while moving
pane bounds reveal it; text does not travel with the divider or rewrap during
the exchange. A subtle text-body fade accompanies the reveal; header frames
stay opaque so their backdrop blur keeps sampling the text beneath them.
The first compact split starts its rail just outside the card and uses the
same reveal as retained-pane exchanges. The outgoing solo frame keeps its
original wrapping until covered; the entering frame holds its final width.
Exactly one opaque rail travels between sides, starting at the displayed rail
position when interrupted. Its title/icon/status label crossfades on the same
clock, retaining the displayed blend on reversal. Temporary label snapshots
are accessibility-hidden and removed when motion settles or is cancelled.
Retained content clips independently at the moving rail's inner edges, so
outgoing text cannot show past it near completion. Closing retains compact
frames and rails until departure completes: the same rail/clip reveal runs
outward while the outgoing frame holds its captured wrapping and outer edge.
Clip widths clamp at zero without shifting the frame, and use overflow clipping
so header backdrop sampling remains intact. Opening, exchange and closing share
one presentation coordinator and cancellation path.
Every split-opening choice (options, current location, previous location, and
new chat) uses that coordinator and the existing 380ms editor easing at wide and
compact widths. The destination kind is selected before the new pane becomes
visible; duplicating or restoring chat cannot introduce a temporary editor.
Related's bottom-sheet insets and width share the same geometry clock, including
interrupted switches. Note-to-note
rail exchanges use the dock's morph duration and editor curve even when the
dock itself remains settled. Closing from rail layout retains that same duration
and curve after the surviving pane returns to solo layout. While a chat remains
open, its editor/chat handoff reuses the ordinary `chat-search`/`chat-input` dock
edge. A collapsed chat keeps its mounted composer, expanded reading clearance,
and visible dock button while search is presented for the editor.
Narrow header controls retain their sizes and action spacing across solo and
split layouts. The compact tab selector shares the pane presentation clock and
cancellation path; retiring a rail releases its space in the closing destination,
without another selector jump after the pane is removed.

### History browsing leaves the workspace untouched

Entering global History Mode first flushes pending canonical note saves and
finalizes the inspected note’s pending Editing Window. A
failed save leaves the user in the editor with a clear error. While history is
open, the normal workspace remains mounted but inert: history is not a pane,
does not create an editor runtime, and cannot change pane membership or Note
Draft State. Exiting restores the captured active pane and focus while the
mounted editors retain their selection and scroll. The selected historical
revision remains pinned when newer timeline records arrive, and History Mode
never survives an application restart. Opening or selecting a version defaults
to comparing it with its previous revision: additions and removals describe
what changed in the selected version. Comparing with the current note is an
explicit alternative. A forgotten note retains its complete
timeline but cannot enter History Mode or expose timeline records until
Forgotten-Note Recovery returns it to the active vault.
An externally deleted note follows the same ordinary-access gate while it is
Missing, but its retained timeline remains inspectable from recovery UI.
History Mode entry awaits mandatory prepared-write recovery and complete
verification of its target Note Timeline through its read capability. Optional exhaustive health/storage
checks during browsing are explicit actions; their absence never means history
is verified. Restore and clear refresh diagnostics after mutation.
A health result from an exited session cannot populate a later session.
History Mode browsing and diff surfaces are read-only. It may add, edit, or
remove a revision label and may clear retained history only after explicit
confirmation through `NoteTimeline`; those metadata/history-retention actions
never mutate canonical Markdown, pane membership, editor state, or Note Draft
State. Complete Version Restore is the one authored-content mutation described
below.

### Version Restore is complete, deliberate, and append-only

History Mode may replace authored note content only through an explicit
complete-replacement preview and confirmation. The preview is bound to the
current authored-content hash; a concurrent canonical edit invalidates it.
Confirmation restores the selected body and unmanaged frontmatter while
preserving current Note Identity, title, path, creation time, lifecycle state,
and other managed metadata semantics with a fresh update time. The mutation
appends a Version Restore revision without removing intervening revisions or
Lifecycle Events, and the editor begins a fresh undo history so reversal must
be another Version Restore. Forgotten and Missing notes must be recovered
before ordinary timeline inspection or Version Restore, keeping lifecycle
recovery distinct from authored-state replacement. The selected authored
payload, including exact line endings and unmanaged-frontmatter whitespace, is
preserved byte-for-byte. Workspace exit stays unavailable, and route navigation
waits, until publication and editor adoption finish. A properties-only restore
also resets editor undo even when the rendered body is unchanged. Selecting
content that is already current asks the user to choose another revision; it
does not require lifecycle recovery.

## Documents, tasks, and persistence

### Cancelled block gestures preserve authored content

The explicit Move block handle owns touch dragging; surrounding note content
retains native scrolling and selection. Only a matching pointerup commits a
drop or opens the formatting menu after a tap. Pointer cancellation, capture
loss, window blur, hidden visibility, document changes and editor teardown
discard the drag and its preview without publishing a move. A later pointerup
cannot revive it. Successful moves retain ordinary Undo behavior.

### Optional note tags are authored content

The top-level YAML `tags` field is canonical. Inline tag controls mutate the
shared Note Draft State and use the existing save queue, Note Timeline capture,
and external-conflict handling. Save requests carry a tag edit only when tags
changed; its previous value is checked under the note-file mutation owner before
publication. Keeping local edits after a conflict uses the reviewed external
snapshot as the next save expectation; failed publication retains conflict choices
unless a newer observation or committed adoption supersedes them. Other
frontmatter, including adjacent comments, is preserved. Invalid YAML blocks tag editing,
not ordinary body-only saves. Parsing-error changes refresh even when authored
content is unchanged, without making a clean note dirty. Removing all tags writes
an explicit empty list.
Tag-row visibility is one app-wide local preference, defaults to hidden, and
never saves a note. Tags scroll with note content; renaming edits the chip in
place rather than taking over the add-tag field.

Vault search and Atlas accept both `tag:name` and `#name`; multiple tag filters
intersect and remaining words use ordinary relevance. Tags are normalized to
lowercase and matched exactly by filters. Only the authored `tags` field is
indexed as tags; body hashtags remain prose. Tag changes refresh search and Atlas
metadata without changing content embeddings, graph edges, or geometry inputs.
Atlas tag searches highlight existing positions; they do not regroup notes.

### External changes never overwrite dirty local work

Clean documents refresh everywhere they are displayed. A dirty document keeps
its local content and the external snapshot or deletion until the user chooses
how to resolve the conflict. Navigation and destructive note actions cannot
orphan an unresolved conflict.

Every distinct external state captured by the watcher or reconciliation is
retained durably before history application. A transient history failure or
process restart replays that exact snapshot before a newer observation,
authored publication, or history read; recovery never substitutes whatever
bytes happen to be on disk later.

### Committed adoption belongs to the document boundary

Ordinary save, Version Restore, accepted proposal, clean external refresh, and
transient Forgotten-Note Recovery enter fixed-purpose document adoption methods.
Callers do not choose identity, baseline, warning, rekey, runtime-reset, or
derived-refresh policy. A committed warning is adopted as part of the successful
result and never authorizes another write. Save and proposal adoption preserve
eligible later title and body edits. A canonical proposal read-back that no
longer matches the committed Markdown enters ordinary external-conflict handling.

Version Restore succeeds when its target is unopened without creating or
navigating a pane. If the document is retained only by chat, adoption updates
the document and any existing shared runtime so a later editor mount sees the
restored state without the previous undo root. Every open-document Version
Restore starts one fresh shared undo root across sibling panes while their
selection and scroll remain pane-owned.

### Task reads distinguish invalidation from an empty list

The master task list, recent tasks, and per-note task refreshes wait briefly for
active current-content mutations and retry a projection invalidated during its
query. Retry and waiting are bounded; persistent contention returns a failure,
never a successful empty list or missing group. Stable results still enforce
current-note eligibility and the selected task filters. Only repeatable reads
use this protocol; canonical mutation commands are never retried by it.

### Task groups share one order across input methods

Pointer dragging and the keyboard/touch group menu enter the same TaskListStore
order operation and persistence path. Move up/down targets the neighboring
visible group, translated back into the loaded order so search/date projections
do not replace it with a searched subset. Due-date sorting stays within groups.
Impossible directions are disabled; menu selection returns focus to the moved
group's trigger. Failed persistence restores the prior order and reports the error.
One reorder write is admitted at a time. Rollback restores ranks without
discarding task/group changes admitted during that write. A committed reorder
invalidates reads started before its commit; if a concurrent read or group patch
already published, the current view refreshes without replaying the order write.
Persistence merges
filtered submissions under one transaction, retaining omitted groups in their
existing slots and appending newly ordered groups.

### Task mutations respect dirty documents

A task mutation targeting a dirty open note changes the open document and then
uses ordinary persistence. It never writes behind the editor. If duplicate
task text makes the intended task ambiguous, the mutation fails instead of
guessing from stale positions.

### Task deadlines are authored calendar dates

A valid `@due(YYYY-MM-DD)` on a checkbox marker line is the task's explicit
calendar deadline. Each nested task owns its own annotation. The first valid
annotation wins; an explicit date edit consolidates valid duplicates, and removal
clears only supported valid annotations. Invalid, escaped, code, and link text
remain recoverable. Code examples are not projected as tasks. Deadline changes
use the existing canonical task/open-document boundaries and retain task identity
across date edits, external reconciliation, and note moves. Projection recognition
timestamps never become authored creation dates.

Adding a deadline inserts ordinary editable `due` wording before its annotation
unless the task already ends with that word. Editing an existing deadline keeps
the first annotation's position and surrounding authored wording; removing it
preserves that wording. Display formatting never adds a `Due` prefix of its own.

Due today becomes overdue on the next local calendar day. Completed tasks never
appear in the actionable overdue filter. Date filters intersect the existing
completion/hidden/search view; default note grouping/order remains unchanged.
Relative labels and membership refresh at midnight and on resume without a
Markdown mutation. Calendar day addition does not mean adding 24 elapsed hours.

### Date/time text stays fixed and editable

Date/time slash insertions resolve at invocation in the system locale/timezone
and replace only the standalone invoked token as one undo step. Code, links and
ordinary slash-containing words/paths do not invoke them. Chips are a presentation
of current-locale date/time text, with no hidden authoring metadata or reactive
clock value. Clicking a chip selects its existing note text for native inline
editing and opens a calendar/time picker without moving keyboard focus. Typing
uses ordinary note edits and dismisses the picker; undo restores the edited text.
Calendar/time Apply edits only the originally selected text range. The formatting
toolbar stays hidden while this picker owns the selection.
Plain date text in a task never becomes a deadline. Picking a wall-clock
time during a daylight-saving gap does not silently reschedule the chosen text.
Cancelling a picker applies none of its pending calendar/time choices; native note
edits remain ordinary authored edits. Inline pickers close when the editor document
changes. Due-date Apply refuses a stale document and asks the user to reopen it.
Clicking an existing deadline in an editor selects only the ISO date inside its
annotation for native typing, retaining editor focus and the portable annotation
syntax. Like ordinary inline dates, its picker has no date textbox and closes
on note edits. Direct typing uses ordinary saving and undo; calendar Apply and
deadline removal keep their existing task-date transform. Adding a deadline or
editing from the master task list retains the popup date input.

### Save completion has a consistency boundary

A successful save means canonical bytes and the required in-memory note
catalog are committed, and its successful authored state has durable history
capture. Ordinary Editor saves replace a pending Editing Window endpoint;
immutable Note Revisions are retained at its boundaries. The integrated
contract is [Editing Window capture](editing-window-contract.md). History intent is durably prepared before Markdown publication;
a preparation failure publishes nothing. Target verification and retryable
recovery admission do not hold the canonical file owner. A ready note remains
saveable while another save waits for its target. Admission is checked again
under ownership; newly retained observations settle before the authored save.
A failed rename/save restores the original path when rollback succeeds and
returns an error, preserving the requested dirty edit. An indeterminate rollback
retains recovery evidence and must never report old bytes as a successful save. An opaque intent identity correlates
that preparation with exact finalization, and the shared note-file mutation
owner serializes preparation, publication, and finalization end to end. Task
reads provide read-your-write consistency. Lexical and semantic indexing may
finish later and cannot turn a completed canonical save into failure.

If bytes were committed but a required projection degraded, the result carries
the authoritative identity and a warning; callers do not retry the mutation.
A history-finalization failure follows the same committed-warning rule and is
completed idempotently from its prepared intent and authoritative Markdown.
If authoritative Markdown cannot be read after publication, history remains
pending and the committed result carries a warning; caller fallback bytes are
never finalized as history truth.
Finalization verifies both authored bytes and managed Note Identity, and the
revision's committed time is issued by the app into the durable intent
immediately before publication, so immediate finalization and restart recovery
use the same app-owned time and later filesystem metadata cannot rewrite
history. Known write failures and
conflicts abandon their prepared intents immediately; indeterminate publication,
rollback, or post-publication capture outcomes retain recovery evidence.
Pending-intent recovery must succeed once per application state before its
first history read or prepared write. It is not rerun after success by
concurrent history reads or commits, which must never classify a live prepared
intent as abandoned crash residue; a transient recovery failure remains
retryable. Explicit recovery retry uses the same note-file mutation owner as
canonical writers. Once an intent is finalized or abandoned, its full authored
payload is retired atomically; correlation metadata remains while live, pending,
or retained references need it.
Completed operations retain exact outcomes in compact scoped receipts; all
preparation-only fields disappear in the same transaction that captures or
abandons them. The receipt's nonce never authorizes a mismatched full boundary
token. A sealed Editing Window does not rewrite its endpoint receipt's original
PendingWindow outcome. Retained interval verification depends on the retained
revision and receipt, with one authoritative interval record and no completed
preparation. Live/unresolved and retained references survive below the retirement
watermark; missing old tokens cannot infer success from current content.
Unreferenced terminal retry receipts are bounded to 64 per note; a durable scoped
retirement watermark distinguishes stale tokens from unknown ones without
replaying writes or inventing successful outcomes (see the capture contract).
Existing stores are never migrated; unsupported formats require the confirmed
reset that advances the generation and rebuilds current Markdown as baselines.
A prepared publication's in-memory base candidate may avoid checkpoint replay
only when its authored-byte hash matches the exact retained base revision inside
the append transaction. It cannot substitute a different canonical state as the
history base. Crash recovery needs no candidate and reconstructs from the store.
Before ordinary work consumes or changes a retained Note Timeline, verify that
note's complete payloads, hashes, head, lifecycle, and window lineage in one
consistent read snapshot. Previous verified bytes live only within that pass;
trusted mutations extend the resulting runtime proof. Unrelated histories and
whole-store structural checks run in background or explicit diagnostics. A ready
note may therefore be saved before unrelated corruption is discovered; any
subsequently discovered corruption blocks new canonical publications globally.
No publication bypasses durable preparation. This selected availability trade-off
is recorded in [ADR 0008](../adr/0008-verify-target-note-history-before-background-coverage.md).
Foreground work never waits for an unrelated verifier's readiness lock. Concurrent
requests share only the target note's check, and background verification can stop
within a long note. Clear, purge, and reset replace proof identity around the
entire replacement interval; neither a stale success nor a stale failure can
bless or poison replacement history. Retryable I/O and cancellation do not become
corruption. Readiness and background completion are observable without a scan;
UI observations never authorize writes.
Managed metadata changes alone do not create Note Revisions.
A managed note that predates history receives one Baseline Revision without a
Markdown write. Its `knownSince` time says only when Gneauxghts first retained
the state; introduction and last-change time remain unknown. A mutation that
beats background initialization establishes the current canonical state as its
baseline in the same durable preparation transaction before the new revision.
Repeated scans, watcher races, interruption, and restart never duplicate that
baseline. Initialization failures produce durable degraded progress and a
typed failed state for any resolved Note Identity; a successful retry clears
that note's failure.
The vault-local manifest and selected history store must agree on Vault
Identity, storage format, and generation. The app also remembers the greatest
generation it has opened outside the vault, so a synchronized rollback of both
vault-local records is not silently accepted. Development resets retain an
operation and generation diagnostic outside the replacement timelines.
A clean close stops admitting Note Timeline operations, cancels background
verification before waiting for admitted work, settles prepared intent, finalizes Editing Windows, checkpoints and
truncates the SQLite WAL, and
advances a durable clean-close watermark before reporting the vault portable.
Failure at any step reports an error and never claims portability. Completing
background payload coverage is not a portability prerequisite. Application exit
and explicit Restart cross this seam first. Merely staging a next-launch
selection does not release the running vault and therefore does not cross the
close seam.
Admitted work, retained recovery evidence, deadlines, and clean close remain bound
to the original vault and app-local observation context if the next-launch
selection changes. A stale runtime cannot admit a canonical or lifecycle mutation
targeting the newly selected vault, even when both vaults contain the same Note Identity.
Reset admits future work under its new generation but never rebinds old intent
callbacks to it. The observing installation may
recover its own open store and WAL after interruption, while a new installation
rejects an open main-file-only copy. Store-instance changes, same-generation
watermark rollback, and manifest/store/app-observation mismatches require
explicit recovery. Compatible existing current-schema stores reopen after
identity, generation, and portability validation; incompatible schemas and
existing files without complete metadata are rejected before
schema writes. Confirmed Settings reset advances the generation and rebuilds
current Markdown without migrating old history. Ordinary Editor revisions
require Editing Window evidence; explicit creation and rename/move publication
boundaries retain their correlated point evidence.
SHM remains ephemeral and is never required backup data.
Explicitly confirmed clear, reset, and purge need not reconstruct prose being
discarded. Clear and purge retain current-store admission/recovery and the existing
discovered-corruption gate. Explicit reset remains allowed to replace an unavailable
or corrupt store and resolve that gate. Replacement guards invalidate old proof,
canonical baselines are rebuilt where applicable, and any later publication still
verifies its target.
Clear, reset, and purge remove affected pending windows and publication receipts
with retained history, invalidate old tokens and callbacks, and never append
pending prose just to delete it. Clearing one Note Timeline atomically removes
every previously readable record
and establishes the current canonical authored state as a fresh Baseline
Revision. A vault clear applies the same boundary independently to every active
ordinary note without rewriting Markdown; missing and forgotten timelines stay
retained. Permanent purge removes the complete timeline and all
revision-dependent labels, citations, and rebuildable projections. Clear and
purge leave only a versioned, prose-free deletion marker with stable scope,
operation identity, time, and history generation. They become unreadable when
their transaction commits, regardless of whether SQLite still has allocated
pages. A whole-note purge durably prepares its deletion before atomically staging
the canonical file under hidden vault data; pending deletion recovery uses that
filesystem evidence before history reads and observation replay, and the purged
Note Identity cannot acquire new records even when the original path is reused.
Missing-note purge uses the same durable deletion boundary without staging or
deleting an unrelated file that may have reused the missing note's old path.
Allocated and reclaimable byte totals remain distinct, and physical compaction
is separately budgeted across WAL checkpoint and incremental-vacuum work and
never chooses what history to retain. Allocated totals include the live SQLite
main file, WAL, and SHM sidecar; reclaimable totals include database freelist
pages and checkpoint net reduction that the store can prove are reclaimable.
The WAL autocheckpoint and retained-size limits keep normal persistent WAL
allocation within the background pass budget; larger live WALs remain reported
and are never truncated by a smaller pass.
History health is observable without making current Markdown depend on the
history store. Healthy, initializing, degraded, warning, unavailable, and
corrupt states cross typed contracts; storage implementation errors do not
become product concepts. Per-note diagnostics report readiness and logical
retained usage. A retry settles pending observations, deletions, publication
intents, and failed baselines without replaying an authoritative Markdown
write.

Every history read or history-changing command failure crosses the frontend
boundary as a closed Note Timeline state with stable recovery guidance.
Storage paths, query text, database errors, and reconstruction details remain
backend diagnostics and never become user-visible command errors. Failure
translation performs no exhaustive health scan. A typed corruption failure
detected after successful attestation still latches the runtime gate, including
History Mode, Missing Note recovery browsing, current-content evidence, and
deadline finalization; subsequent app-owned publication remains blocked until
explicit reset.

An unavailable or corrupt history store can be reset only after explicit
confirmation. Reset never rewrites current Markdown: it advances the history
generation, removes the affected retained histories and their labels and
citations, creates truthful Baseline Revisions from current notes, and keeps a
prose-free reset diagnostic across restart. Before reset, the UI directs the
user to make a cleanly closed vault backup.
A failed pre-commit save leaves navigation in the editor and remains retryable.
During synchronous reconciliation, a failed lexical projection retains the
exact identity-resolved payload in retry state independent of catalog file
signatures. Retry neither depends on another filesystem change nor repeats
identity resolution. Per-path projection ordering and catalog generations make
newest catalog state win in both lexical and task projections even when older
projection work finishes later.

### Note Identity follows the note

A managed ordinary note keeps its identity when its authored content becomes
empty, its path changes, it is forgotten or recovered, or it temporarily
disappears and safely reattaches. A known path whose embedded managed identity
is missing or damaged retains its catalog identity without rewriting the file
during observation; repair is included in the original atomic publication of
the next app-owned commit. Every canonical writer obtains those prepared bytes
through `NoteTimeline`; identity repair is not duplicated in writer-specific
code. Reconciliation can establish relocation continuity for an embedded
identity when its former path is absent. That continuity alone does not clear an
already-recorded Missing Note: automatic reattachment still requires the retained
missing path; explicit Missing Note recovery can publish a `Recovered` Lifecycle
Event at an available destination. Copy detection and missing-record transitions
belong to `services/note_timeline/observation.rs` and
`history_store.rs::synchronize_missing_record`.

An observed file whose embedded identity is already owned by another path is
a distinct copy. The existing owner keeps the identity and the copy receives a
new globally unique identity, independent of catalog refresh order. Revision
and Lifecycle Event identities are opaque, globally unique domain values with
operating-system random entropy and explicit predecessor relationships;
database row IDs or insertion order never define timeline identity or lineage.

### Self-save suppression is operation-aware

An app-owned write, move, or delete suppresses only the exact filesystem
outcome it declared. Failed or uncommitted operations cannot hide later
external changes, and a non-matching watcher event is external even inside a
deduplication window. Managed chat projection observations additionally wait
for app-owned publication to settle and compare current bytes with the committed
SQLite receipt. A stale queued event or an in-flight app write cannot detach a
conversation. Genuine external edits and deletion remain conflicts.

### Semantic search preserves the last usable result

Discovered ordinary notes are keyword-searchable as soon as they enter the
note catalog. While their lexical projection is missing or outdated, search
uses the current catalog paragraphs without waiting for background indexing
or embeddings. Once the lexical projection catches up, search uses it without
adding duplicate fallback results.

Reopening Atlas revalidates its retained display against the backend even when
its previous response was ready. Chat-default changes and Atlas visibility changes
persist independently; an older snapshot in either screen cannot revert the other.

Atlas continuity advances only with an admitted durable generation. Failed,
superseded or cache-invalidated calculations cannot advance cloud identity,
branch evidence or geography. User cloud names survive semantic cache clearing
and provider changes; compatible names and accepted world placements survive
restart. The previous valid metadata generation remains available for recovery.
Unrecoverable authored map metadata is preserved and reported.

Stationary inputs, polling, naming, activity, search and camera changes do not
move map geometry or manufacture semantic evidence. Supported subgroups become
visible before promotion; the bounded presentation interval may admit already
strong evidence without another content edit. Provider changes reset incompatible
candidate evidence. Navigation-only vectors do not establish a semantic theme.
Each note has one primary cloud or remains isolated. Excluded, missing and
forgotten content leaves the rendered inventory even while rebuilding; stable
geography cannot override current-content admission.
Deletion and same-footprint renaming cannot repack accepted notes or push
anchored regions away. Subgroup repartitioning and promotion may repair affected
territories to keep distinct concepts readable. Enlarged filenames and new
notes resolve actual footprint collisions across all notes, including isolated
notes; unchanged accepted placements are fixed obstacles. New clouds receive
deterministic local seeds and newly isolated notes leave their former region.
Reassignment starts from accepted positions rather than legacy cache hints. Repair of runaway legacy geometry is
limited to affected clouds, preserves identities and names, and is recorded in
the admitted placement revision so reopening cannot repeatedly compact the map.
Excessive legacy inter-region gaps receive one rigid neighborhood translation
migration: nearby roots, internal note spacing, identities and names stay together;
the largest retained neighborhood stays anchored. Initial maps use the same
spacing policy. Placement revision 3 permits one bounded relationship-based
translation of whole roots using strong graph affinities, normalized for cloud
size and endpoint degree. It preserves internal geometry, names and identities,
prevents new footprint collisions, and penalizes displacement. Newly born regions
use the same aggregate affinities for seeding. Accepted maps do not gradually
attract regions together on edits; admitting the revision prevents repeat work.
Placement revision 4 corrects interpenetrating sibling and root cloud territories
once using conservative envelopes of their rendered contours. Siblings translate
as units before enclosing parent outlines are rebuilt; whole roots then separate
with isolated notes fixed. Region attraction obeys the same territory clearance.
Revision-3 maps receive separation without repeated attraction. Core/outlier
classification, child centroids, radii and outlines are finalized from the accepted
coordinates so restart cannot change geometry or interpretation. Revision 5 adds
leaf density constraints and checks changed memberships/footprints after ordinary
updates. Excessively sparse leaves contract around their member center with
filename clearance; sibling separation then root separation protect final
territories. Unchanged siblings are fixed within their parent during sibling repair; an
affected parent may translate rigidly to clear another root. Unrelated roots
remain fixed during incremental repair. Deletion and same-footprint renaming do not trigger reflow.
Accepted unchanged layouts remain exact on replay; attraction remains migration-only.
Revision 6 closes excessive internal footprint gaps before evaluating overall leaf
density. Nearby notes translate together, anchored by the largest neighborhood;
long horizontal titles cannot mask vertical empty space. This geometric repair
does not create subclouds or change theme membership.

A transient indexing failure keeps the last good result visible as stale.
Automatic retries are bounded and cannot overwrite newer queued work. The UI
distinguishes fresh, stale, rebuilding, and degraded states and offers an
explicit retry.

Local search setup stays inside Settings. Its explicit setup action installs
any missing device-local runtime and model, starts the model, and schedules
indexing. Ordinary embedding requests never download executable code. Runtime
downloads are pinned and checksum-verified. For Gemma LiteRT, extraction and
native-library loading/symbol verification succeed before the desktop runtime directory
is published. iOS builds stage the checksum-pinned official XCFramework through
`scripts/ios_litert_runtime.py`; Xcode embeds and signs the matching slice. The
provider resolves only `Frameworks/CLiteRTLM.framework/CLiteRTLM` beside the app
executable and verifies its required C symbols. iOS setup never downloads an
executable, including when the bundle is missing; Settings reports that case as
an app-build repair. Simulator admission uses a separate representation namespace,
four CPU threads and the existing serialized provider/workqueue. Physical iPhone
admission remains disabled pending full-app device validation. Model installation
and initialization complete before setup reports
success. These stages belong to `semantic/litert_install.rs` and `semantic/litert.rs`.
Interrupted setup remains retryable, and keyword search stays available.
The provider owns setup progress independently of its inference lock. Settings
shows the current runtime/model artifact, transferred bytes and a percentage
only when the file size is known; checking, verification, installation and model
startup remain distinct phases. Active setup supersedes prior indexing errors
in the overview, and failed setup retains its artifact and byte count for retry.

A semantic provider change uses a separate representation namespace and one
resident model. Semantic queries hold a generation read lease; activation waits
for current ordinary-note and remembered-chat reconciliation and durable ANN
publication. NoteTimeline validates the prepared source version at publication.
Busy or superseded source proofs retry outside the producer lock with a bounded,
interruptible delay. Rebuild withdraws new read admission before the worker waits
for existing readers. Keyword search remains available while staging. Retained
Jina files permit a next-launch recovery choice without rebinding the running
vault or mixing vectors. Image vectors/ANN are separate derived data; changing
70/140 tokens rebuilds image work without changing text/Atlas identity.

### Editing Windows preserve explicit boundaries

The first distinct successful Editor publication starts a fixed five-minute
elapsed deadline that includes suspension and ignores wall-clock adjustments.
A save admitted at the deadline starts a new window after prior finalization;
subsequent saves never slide the deadline. Last-editor departure, History Mode,
naming current content, explicit temporal evidence requests, distinct actions, lifecycle
transitions, and clean close finalize prior work through the shared mutation
barrier. One of several editors leaving, app blur, cursor changes, health polls,
and ordinary chat loading do not. Restart recovers publication evidence before
validating and finalizing surviving windows exactly once. Finalization atomically
retains the net change against the immutable anchor and deletes the pending
window; A → B → A creates no revision. Its private identity never escapes as a
revision, and stale generation/window callbacks cannot resurrect deleted history.

## Chat

### Vault relocation preserves chat authorization and conflict boundaries

Chat startup rebinds known vault-owned locations before interrupted-run/commit
recovery or transcript observation. Location changes and the recorded vault root
commit atomically. Legacy migration requires a surviving managed transcript
identity at the generated relative location; arbitrary external paths and parent
traversal do not acquire vault authority. Relocation changes no authored content,
permission, hash or proposal status. Missing or edited transcripts remain conflicts;
a stale detached flag clears only after every relocated publication hash matches.
Pending proposals still require explicit Keep. Interrupted commits converge from
filesystem proof without replay, and update commits retain Note Identity and base
hash validation through NoteTimeline.

### Surviving transcripts recover missing conversations

When vault-local chat data is lost, startup discovers complete managed transcripts
in `Chats` and restores missing conversations to the chat list. Existing database
conversations win over Markdown. Recovery retains stable conversation and message
identities, title, creation date, part order, visible terminal status, source links,
and explicitly remembered quotes, without rewriting the surviving files. Imports
commit atomically; damaged or ambiguous conversations cannot leave partial rows.
Forgotten folders are not reactivated. Imported projection receipts retain the
ordinary external-edit conflict boundary.

Legacy Markdown lacks attachment bytes, tool events, proposals, per-message dates,
provider configuration, access grants, and authoritative evidence metadata.
Recovery uses current provider defaults, starts with no vault access, and omits
potentially note-based recovered answers from fresh model context. Source links
remain display links; remembered quotes do not invent historical offsets.
Attachment inventories remain visible with an unavailable-content notice.

### Provenance explains only current authored content

Current-Content Provenance is available only through the allowed current-note
capability. Exclusions win over an explicit allow list; missing, forgotten,
and uncaptured canonical states cannot deliver retained prose. Output contains
only current body, unmanaged properties, and title, with evidence identities
and authoritative point or versioned Editing Window interval evidence. Discarded
within-window states cannot prove exact introduction times or deletion/retyping.
Clock-discontinuous intervals are explicitly uncertain. Filesystem modification
time never
becomes introduction or last-change evidence.

Unique correspondence between adjacent retained states preserves moved
content. Adding or removing a final line separator preserves the unchanged
line's content lineage; an appended paragraph cannot borrow that line's dates.
Ambiguous correspondence and text retyped after a deletion visible in retained
states receive new introduction evidence; an unchanged window endpoint cannot
prove that text was retyped inside the window. Authored word edits, including Markdown delimiters,
update affected ranges while unchanged words retain their evidence. Markdown
parser context extends formatting changes across inline spans and multiline
blocks, including headings and fenced code. Baselines
and history clears establish `knownSince` with unknown prior introduction and
change. Complete Version Restore retains selected lineage for returned ranges
and records their new `restoredAt`; ranges still present retain their current
lineage. Older restores without a selected-revision reference report unknown
earlier lineage for returning ranges. Title provenance follows lifecycle
predecessor order and ignores moves that preserve the filename title.

### Chat activity and citations preserve explicit evidence boundaries

Activity and Current-Content Provenance enter chat only on demand. They reapply
vault access, explicit turn grants, global exclusions, current eligibility, and
canonical-byte checks. Default current activity carries surviving modified ranges, authoritative times,
and Mutation Sources. Explicit activity queries may additionally request retained
added/removed body/property lines through the scoped read-only capability in ADR
0009. Historical text must be labeled and checked against current content before
it is treated as an actionable commitment. Surrounding current context is labeled separately
and never presented as activity in the requested period. Ordinary intervals match half-open activity queries by overlap and
uncertain clock-discontinuous evidence is marked explicitly. Historical labels stay private; removed prose is available only through the
explicit retained-activity interface. That interface grants no restore or write authority. Explicit provenance/citation or temporal activity
requests finalize only the eligible notes needed as evidence; routine chat loading and health polling do not.

Task activity includes current checkbox status and its retained status-change
evidence, separately from the matched word's provenance. Corresponding task
wording edits and equivalent `[x]`/`[X]` spellings preserve status timing. Whole-file
modification times never date task completion. Baselines leave earlier status
timing unknown; restores retain selected status lineage and identify restoration
instead of inventing a new completion. A later real status change supersedes the
restore. Windows crossing a requested period boundary remain uncertain. These
facts describe recorded checkbox status, not independent proof of real-world work.
Model citation references bind only to exact sources delivered to the originating
answer. `chat/citations.rs` constructs durable destinations; recognized but unissued
`[S#]` references and invalid passage destinations become unavailable. Other
malformed model citation text is not automatically recognized. References are
never resolved by title or fuzzy matching. Worker references are remapped on
parent admission. Tool-capable chat selects exact run-local IDs in structured
answer segments. Reads return exact `sourceId` fields and the dispatched answer
formatter enumerates only currently validated IDs issued to that run, preserving
their original numbers. Discovery selectors and worker-local IDs grant no answer
selection authority. The app rejects malformed or duplicate references and stale or
excluded sources before constructing any durable citation. A well-formed unissued
selection becomes inert `[citation unavailable]` text; other segments and validated
sources survive without granting authority to the invented selection. This validates the citation selection,
not whether the source entails the claim. Structured drafts render decoded text
literally with no Markdown or clickable links. Draft snapshots are transient and
scoped by request/message identity, dispatch attempt and sequence. Retry resets
replace them; late events cannot revive a terminal answer. Final validated Markdown
and its selected sources replace a draft only after the terminal transaction commits.
Source and quotation requests use ordinary chat capabilities, context and streaming.
Show evidence expands delivered source excerpts on the answer without another model
call. Excerpts render as literal text, with current/historical labels and recorded
timing; the panel does not claim exhaustive coverage or validate model prose.
Read references require exact excerpt equality with an admitted passage, regardless
of the user's requested response format.
Every successful retrieval tool returns intermediate data and permits subsequent
model/tool calls. The agent decides which capabilities to combine and when to
answer; a search or activity inventory cannot terminate a run or replace the
response contract. Ordinary chat can discover activity, read provenance, search
other current content, plan, research and propose changes in one run.
Capability restrictions only remove authority; child execution never restores
capabilities absent from its parent. Evidence inspection does not change retrieval authority.
Access, canonical identity, freshness, and citation destinations are backend
checks. Claim support, attribution, completion, and date interpretation are model
instructions owned by `chat/assistant_instructions.txt` and
`services/evidence/guidance.rs`; a valid citation does not verify those conclusions.
The five model-facing tools group operations without merging their authority.
read_notes purpose=answer returns canonical evidence; purpose=edit returns the
current working copy for proposals. purpose=draft reads versioned pending working
content; purpose=chat reads authored completed answers for transfer, not evidence.
The schema exposes only granted purposes and
the handler rejects unavailable branches. An evidence-only child cannot access
working content or proposals through a combined tool. propose_note_change keeps
edit/replace/create/save/refine validation, exact current hashes, versioned drafts, full current read coverage
for replacements, existing stored proposal formats and explicit Keep before writes.
Adjacent-editor identity and selection come from the hint; content comes from
ordinary reads, with no separate active-note tool.


Search, activity listing and research accept explicit half-open start/end ranges
as ISO dates or offset-bearing RFC3339 timestamps, with an optional named timezone.
Dates use local midnight and preserve DST; invalid, reversed, ambiguous or
nonexistent boundaries fail rather than being guessed. The agent interprets the
user's timeframe against the supplied run anchor. There are no named-period tool
enums, question parsers or semantic workflow dispatchers. Independent tool calls
may use different scopes or omit an activity filter; a child research invocation
must retain its inherited scope and range.

Chat sends and retries capture current editor locale, numeric date order, hour
cycle and timezone as optional validated turn-local configuration. The timezone
sets the reference anchor shared with research, not an older note's authoring
format. Old ambiguous numeric dates remain ambiguous. Fixed wall-clock text has
no implicit UTC offset and date-only deadlines never shift through UTC or DST.

Canonical current body evidence may carry task deadline metadata for complete
delivered checkbox lines only, with exact line text and canonical coordinates.
The existing parser determines valid annotations,
first-valid precedence and completion; children never inherit dates. Metadata is
bounded by `services/task_dates.rs`, reports omitted/clipped lines, and consumes the same
payload allowance under existing access/freshness checks. Historical reads cannot
establish current task deadlines. Deadline comparisons use the reference's local
calendar day, exclude completed tasks from actionable overdue work, and never
reuse deadline dates as recorded-activity filters. Date edits remain exact reviewed
proposals; the research worker receives reading semantics, not edit instructions.

Distinct-note activity pages return one bounded preview and evidence ID per note,
with a representative recorded-change interval, explicit coverage and continuation.
Counts describe only that page's notes with matching recorded changes, not work
completed. All matching passages require further search/read; the representative
preview does not establish whole-note activity. Model-facing inventory previews consume the shared evidence allowance;
private proof collection has separate bounded work/storage accounting. A preview
is not a citable read. The agent reads selected IDs for canonical passage citations
and may search for additional passages or unfinished commitments. A continuation
is invalidated by scope, content or provenance changes. Query metadata can carry
explicit configuration into a follow-up, never old result facts. Legacy events
retain their date role during conversion; event/deadline dates are never re-used
as text-activity bounds. All follow-ups retrieve fresh evidence.
Lexical matches preserve their typed title/body location through discovery and
validate against that canonical location; display section labels do not choose
coordinates. Invalid or ambiguous body matches remain withheld.
Current-passage citations validate stable identity, content hash and exact
current range before opening and highlighting the current note. Renames resolve
to the current location; stale or ambiguous passages are unavailable. Search
cursors bind scope and canonical versions, and read continuations preserve selected IDs and provenance positions without
requiring callers to reconstruct offsets. Retained-change citations validate the
exact revision, change kind, coordinates and text and open their content revision. Baseline known-since dates never imply creation or work.
Legacy Revision Citations retain exact Note and Revision Identity and open that revision
in global History Mode without navigating the invoking pane.
Citation navigation seeks bounded surrounding context directly, independent of
how many newer records exist. Newer/older context pages replace a bounded viewport
while preserving the selected diff; the bound belongs to
`history_store.rs::bounded_revision_context`. Clear or restore may leave anchored
context but never transfer the target to the invoking pane's note. Obsolete
entry work stops at asynchronous boundaries, and failed-entry or exit workspace
restoration settles before a newer entry captures that workspace. Cleared, purged,
missing, forgotten, excluded, or no-longer-current citation evidence is withheld
when results or conversations are delivered, including branches. Explicit source
access uses the originating run grants with current exclusions. Earlier note-based
answers remain visible in their transcript but are omitted from later model
context and compaction; source-free dialogue is preserved. Editing acknowledgements
retain working-note identities separately from selected citation sources. Those
IDs commit with the terminal answer and survive reloads and branches; they carry
no working-copy content or citation authority. Bounded note references
may remain as navigation hints associated with earlier turns, including compacted
turns. Fresh app-issued metadata stays separate from old assistant prose. Note
fields contain only currently permitted canonical Note Identity and title. Each
group also carries its answer ordinal, a bounded preceding user request as historical
intent, and whether it belongs to the latest completed answer. Old assistant claims,
excerpts and citation authority never accompany them. Rebuild hints
against current policy on each request, and recheck admitted identity/location
before inference and delivery, including requests without executable tools.
References rejected by the history byte allowance do not bind validation. Chat
must obtain fresh current evidence. The
automatic editor hint appears in separate app context before conversation history.
The assembled user prompt places the authored request after other turn-local app
context.
Automatic note context uses canonical bytes, never a pending proposal snapshot.
An automatic editor hint does not admit primary evidence or
satisfy full-read requirements for proposals. Its freshness binding alone does
not mark ordinary dialogue for history omission. Delivered note evidence retains
its durable omission marker even if sources are hidden before completion. Failure
to save that marker withholds the content and does not grant proposal read coverage.
Structurally relevant evidence
interpretation contracts are delivered once per independent runtime context,
count against the complete read envelope, and remain in that runtime's history.
Failed delivery must preserve undelivered interpretation guidance for retry.
**Implementation gap:** `services/evidence/reads.rs::deliver_read` reserves bytes
and records guidance before the tool adapter's cancellation, policy, durable
evidence-marker, and citation-admission checks. A later failure returns no payload
without rolling back that accounting or guidance state. This path does not yet
enforce the retry requirement; see `agent_tools/evidence.rs` and the research
handoff in `agent_tools/research.rs`.
Research workers receive their own contracts under the shared allowance.
Revalidation before each model call and final delivery stops
an answer if admitted bytes or scoped search versions change. Scoped search
versions compare actual paths and file bytes, not filesystem timestamps or
derived index digests. Assigning an internal identity to an unchanged unrelated
legacy note cannot invalidate that search. Citation delivery waits for internal
current-content operations to settle and repeats canonical identity, byte,
access and proof checks; settlement cannot authorize genuinely stale evidence.

Read coverage identifies canonical-note versus selected-passage scope and carries
that scope through continuations. Completeness applies to the selected read across
its pages, not exhaustive work or retained history; earlier unavailable passages
remain incomplete. `wholeNoteComplete` requires a complete canonical-note read
across its pages; selected-passage completeness cannot satisfy it. Safe `nextReads`
selectors suggest canonical reads for untimed current passages or continue the
exact canonical cursor. They are sized in the envelope before admission and grant
no access or automatic reads. Search delivery identifies previews while retrieval coverage
retains its truthful limits. Explicit linked bodies and selected excerpts report
clipping with a safe canonical-read selector.
Already-read metadata describes exact delivered text overlap in the same runtime,
under the same canonical version/location or historical proof. Discovery previews,
editor hints and working-copy proposal reads do not count. Independent workers
start without the parent's delivered text, and only actual parent handoff counts
there. Reuse grants no citations, proves no provenance completeness, and never
bypasses current validation, exclusions or read budgets.

Compact evidence selectors are exact mappings owned by each tool context. They
never replace durable passage identity or grant citation authority. Independent
workers and later runs reject each other's references; worker hints alone cannot
be selected as read evidence. Resolving references preserves existing candidate,
canonical freshness, exclusion, scope and budget validation. Duplicate aliases
and canonical selectors deliver one passage, while the raw argument limit still
applies. Parent handoff revalidates durable IDs and uses its own references.

A research worker receives only its focused question, validated tool-facing scope
and explicit range, compact eligible discovery hints and evidence discovery/read
tools. Parent answer/planning/proposal instructions and internal query defaults do
not cross this seam. Its independent closed result formatter is non-executable:
it returns selection arguments, grants no application action, and keeps gathering
tools usable before final submission. Schema formatting and bounded output retries
do not replace backend validation of actually read IDs and closed gap codes.
It shares parent budgets and
cancellation, cannot delegate or mutate notes, and cannot change provider routing.
Only backend-validated selected passages and gap codes return to the parent.
Research may be invoked repeatedly, with at most one active worker. Production
has no cumulative evidence, tool-call, token or elapsed-time quota. Explicit
caller limits, cancellation and stalled-call detection remain authoritative.
`agent_tools/research.rs` supports an optional caller-supplied timeout. Its
lease releases on every exit, including failure/cancellation, and all invocations
contribute to cumulative usage without double-counting streaming usage updates.
A standalone JSON fence may be removed before strict selection validation;
surrounding prose, unknown fields, invalid gap codes and unread IDs remain invalid.
An empty resolved scope returns without worker inference or broader access.
Counter-only terminal diagnostics distinguish model/tool attempts, discovery/read
calls, tool errors, failure, empty scope, selected IDs and actually delivered
passages. Completed reads remain counted after failure without becoming delivered
evidence; an empty selection without a reported gap is unavailable, not proof of
no match. Neither worker output nor private identifiers
enter those events. A completed parent fallback does not prove worker success. Invalid or empty
selections and failed/timed-out workers return explicit partial outcomes with
fixed reason/gap codes and direct-evidence recovery, never worker text or unread
identifiers. A research return sizes its full parent-facing envelope against the
shared allowance before charging or admitting passages. Undelivered selected IDs
may transfer as candidates for a later explicit read, never as delivered evidence.
A period cannot be bypassed through inherited undated evidence or direct canonical reads in a period-scoped worker; the parent performs current-status reads. Aggregate token
exhaustion blocks subsequent model calls in both worker and parent.
Worker reads inherit the invocation range when omitted and cannot widen it;
continuations retain their original read options. Research-delivered items are
already-read primary evidence. Completing a partial handoff requires only the
remaining selected IDs, not repeated reads of the delivered items.

### Runtime context admission and diagnostics

Opt-in context measurements observe the assembled completion request without
mutating it or changing admission limits. Diagnostic events carry counters and
operational identities, never prompt, note, credential, tool-result or reasoning
text. Approximate counts cannot authorize admission; absent provider usage and
loaded capacity remain unknown. Every observed attempt closes with either usage
or an explicit unreported outcome, including cancelled research workers.


Each runtime instance uses its own reported input-token baseline for context
headroom; parent/worker aggregate spending is not context occupancy. Capacity
must come from a fresh loaded-model observation; unavailable metadata may defer
retries briefly but cannot reuse an earlier positive capacity. New retained messages receive a
conservative allowance; changed instructions/tools/model/history invalidate the
baseline. Near capacity, run-local compaction replaces older provider-facing
context with a bounded continuation summary and lets tools continue. The original
user prompt, system instructions and latest assistant/tool-result group remain
verbatim. A checkpoint is reusable only against its matching original prefix and
configuration. Invalid, oversized or insufficient summaries never install partial
state. Malformed summaries receive bounded retries; every attempt contributes to
usage. A failed compaction stops explicitly with original history retained.
Unknown capacity uses a conservative serialized-byte working-context threshold,
not an invented context window or cumulative quota. Summary inference uses the
same provider/model without executable tools and contributes to run usage. Local
summary requests disable reasoning. Source freshness is rechecked after summary
inference before dispatching the continuation.
Cancellation and explicit deadlines interrupt it. Completed parent compaction is
visible without discarding selected-note metadata; worker summaries stay private.
Summaries preserve continuation state but confer no evidence or action authority.
Existing durable history compaction remains app-owned between user messages.
Permissions, scope, proposal read coverage and final evidence-currentness checks
remain authoritative even for sources summarized out of provider context. Search
cursor eviction must retain earlier scope/version validation bindings.

### Tool failures preserve safe recovery instructions

Recoverable application errors reach the model with actionable feedback through
the shared tool registration adapter. Error origins choose stable codes,
retryability and recovery actions; the adapter never classifies message wording.
Known budget exhaustion must not look like missing note access. Unknown
internal/provider diagnostics remain available to operators and are redacted
from model feedback. Activity summaries retain safe error feedback and count
delivered note identities; partial delivery must not appear as a complete read.

Read pages prepare and serialize their complete envelope before reserving the
shared evidence allowance or admitting citations. An envelope that cannot fit
consumes no evidence allowance; later adapter failures have the accounting gap
described above. A failed selection cannot discard independent deliverable
passages; per-item failures and bounded continuations preserve explicit gaps and
progress. Page-level meaning is shared rather than repeated for each small
passage. Ordinary reads default to compact proofs; expanded per-range lineage is opt-in and its requested/delivered coverage is explicit. Compact delivery preserves canonical validation, retained historical identity/timing and activitySupport. Canonical validation occurs during preparation and again at model/final
admission. Recorded proposals are not outstanding commitments merely because
completion evidence is absent.

### Request acceptance and completion are durable units

Accepting a request commits its user message, attachments, assistant placeholder,
run identity, and context together. A failed admission leaves no partial turn.
Managed transcript publication follows admission; a projection failure cannot
turn an accepted request into a rejected send. Completion commits the terminal
message, citation sources, usage, and run receipt together before emitting success.
A failed terminal transaction never announces completion or uncommitted sources;
when storage remains available it marks the retained partial message failed so
retry is available. If storage is unavailable, startup recovery settles the run.

### Interrupted runs preserve partial output

After a crash, ordinary text responses retain the last durable partial assistant
checkpoint and become retryable after restart. `chat/answer_stream.rs` ignores
checkpoint write errors while continuing ordinary UI delta delivery, so visible
text can lead that durable checkpoint. Structured answer drafts are not persisted:
cancellation, failed validation, failed final persistence or a crash leaves the
empty assistant placeholder retryable, with no provisional sources or answer text.
Retry creates a traceable
continuation without erasing the interrupted output. Its original user message
and context come from the same durable run, including repeated retries after
newer turns. Checkpoint branches remap that lineage to copied messages; transcript
proximity cannot replace missing run identity.

### Explicit context references are repeatable

When a send request supplies selected-note references, the backend resolves
stable note identity, reapplies exclusion policy, rereads canonical content,
bounds the excerpt, and stores its hash for that run. Global exclusion always
wins. The current composer has no suggestion picker; this is the selected-context
API contract in `commands/chat_commands.rs`.

Retry reuses the original run's stored selection, then validates its excerpts
against current canonical content; it does not rerun suggestions. Context
use and compaction are observable through provider-safe activity; raw model
reasoning and tool arguments are not exposed.

Activity lists the notes and passages actually delivered by each successful read,
including reads not selected as final answer citations. Named destinations and
bounded passage previews survive chat reopening in the existing event history;
they do not add answer sources or model-history context. Discovery previews,
invented references and failed reads cannot acquire links. Source access,
exclusions and passage freshness are rechecked before delivery/navigation, using
the same current or retained-revision navigation as answer citations. Older
count-only events remain count-only rather than guessing what was read.

### Draft chats expose their complete configuration

Starting a new draft or selecting another conversation retires pending selection
and configuration results from the old target. A successfully created branch or
conversation may remain durable without replacing a newer visible selection.
First send captures the originating draft and configuration; only that draft's
successful promotion can clear its composer. Creation followed by failed send
preserves the created conversation and unsent content for retry. Duplicate
terminal delivery cannot invoke completion effects more than once.

Provider, model, reasoning effort, vault access, web, and attachment choices
are available before a conversation is persisted. The first send applies the
draft choices atomically. Settings supplies defaults for new chats; composer
choices affect only the current conversation or draft.

Provider and model remain separate choices, supported reasoning effort is
validated for the selected model, and a model cannot change during an active
response. Backend-resolved settings are the source of default model identity.
Local reasoning choices come from server capability metadata, independent of
model names. The runtime revalidates persisted choices against that metadata;
unsupported choices use its default, and unavailable metadata sends no override.
The picker must represent the compatible transport honestly: `off` disables
reasoning, while `on` preserves an enabled server default without sending a
literal unsupported `on` value.

### Search and chat share a dock without replacing their drafts

When a chat pane is open, search and the selected chat composer share the bottom
dock. Expanding one collapses the other to an icon. Explicit mode selection
survives repeated activation within the same pane. Switching the active pane
shows search for an editor and the selected composer for chat, at every width.
Replacing the active pane’s kind applies the same selection even when its ID
is unchanged and another chat remains open.
While any chat pane remains open, the dock retains its chat/search presentation
and chat button, including when that pane is collapsed to a rail. Clicking the
chat button activates its pane and focuses its retained composer. Incoming
search follows its own focus state throughout the existing handoff; switching
panes cannot briefly reveal an idle placeholder or match options.
Switching modes keeps the mounted search and composer, preserving the search
query, unsent text, attachments, and
configuration without creating or sending a conversation. Search shortcuts can
expand hidden search, and returning focus to chat expands its composer.
The presentation machine has three settled states: editor search, chat search,
and chat input. Both inputs remain mounted while one main bar morphs between
them. Chat/search exchange keeps that bar's width constant: the composer compresses
with its contents hidden, controls fade, the magnifier enters the bar,
and send becomes the detached chat circle. The reverse uses the same geometry.
Opening chat splits the magnifier from editor search and finishes with chat input
expanded. Closing the last chat absorbs the remaining circle and contracts to
the ordinary editor search width. Each mounted input retains its own text;
placeholders are shown only for empty inputs.
Returning to editor search keeps scope-label widths consistent with its focus
and query state throughout the handoff; idle labels never briefly expand.
Opening chat retains the outgoing scope-label widths until search has faded
away, including the phone's two-row control layout, so controls do not reflow
as the handoff starts. Split header pointer actions preserve input focus until
navigation takes over, matching solo header actions.
Bar, circles, and controls share one correlated frame clock through
compression, exchange, and settling. A separate material layer joins the shapes;
its filter never applies to text or controls. Entry begins at the visible editor
geometry even when the Related drawer changes the available space. Those
layout changes also project the adjacent actions on that clock so the dock never
passes through Forget or New Chat/New Idea. Mounted input contents fade out
over 100ms as motion starts and stay hidden through the exchange. At 90% geometry
progress, the selected surface begins a 280ms fade-in that continues after the
bar settles without restarting. Another morph fades from the displayed opacity;
reduced motion reveals the selected surface immediately. Glyphs hand off
sequentially; editor transitions never detour through a chat glyph.
Circle exchange finishes at compact bar height before the composer unfolds.
Wrapped search controls grow the main bar's height independently of the circular
actions. Focus, blur and pane changes cannot resize those circles or change the
horizontal search/chat travel distance. In the compact search layout, scope
buttons stay anchored at the right on the same bottom baseline. Match options
reveal toward the left while the query row and measured dock background unfold
on the existing search expansion curve; a retained query keeps its row on blur.
The same background/outline renderer remains mounted in settled and moving
states. The shared results panel reveals upward from its existing base over
350ms and collapses over 275ms without moving or rewrapping its text. Its reveal
waits for dock geometry to settle; its collapse retains the displayed position
while the dock switches back to chat. Input text fades do not hide the results
animation. Action-label handoffs do not change the action's current pane semantics. Rapid
reversals begin at the current pose, obsolete frames are ignored, and resize or
reduced motion settles the current target immediately. Programmatic input focus
does not scroll the workspace, and the dock's bottom baseline stays anchored.
During search/chat exchange the main bar and foreground glyph paths are monotonic;
both background circle shells stay full-size and opaque. Editor/chat paths use
measured endpoints rather than recomputing against the moving flex width, so the
first painted frame retains the displayed origin and width-cap changes do not hitch.
Standalone editor search balances Related’s reservation using the drawer’s
existing layout curve. Settled search geometry stays relative to its available
flex space; resizing that space does not restart search expansion. Chat input
and chat search use the card’s available space with balanced gaps beside the
adjacent actions.
Ordinary editor-search CSS transitions resume only after projected margins are
released and the settled local coordinates have flushed, avoiding a second
transition from stale bounds at the end of the shared morph.
All pane entry and departure use a shared cubic Bézier easing for the pane and dock: gentle
departure and arrival with a faster middle. Measured dock bounds travel directly
between endpoints even when its input mode stays unchanged. Input switching retains its pinch
pacing, and the selected curve follows the remaining clock when interrupted.
Content scrolls beneath the shared dock fade. With a chat open, end padding
reserves the measured expanded composer height in both chat input and search.
Switching between those modes preserves message positions throughout the morph
and after settling, including at the bottom and when reading older messages.
Draft growth and shrinkage update that clearance; a growing draft keeps the
latest message visible when the chat is following without pulling a user away
from older messages. Editor/chat morphs hold maximum reading clearance until
settling instead of moving the scrollbar every frame.

## Proposals

### One proposal review is editable

The active review's editable body and hunk state follow its document lifetime,
not any pane. Leaving the last pane or workspace route retains that state and
autosave protection; returning reconnects to the same document root. In-flight
durable settlement converges once across route disposal. Reopening does not restore
from a second snapshot. Stale pane widgets cannot resolve another review. Terminal
resolution saves any remaining ordinary edits before releasing an unreferenced
document. Failed follow-on persistence leaves that document available and reports
an error without repeating the already completed durable proposal action.

At most one proposal is editable globally. Other pending proposals remain
queued and durable, and unresolved proposals survive restart. Opening a different
review first durably checkpoints the current body, title, location and hunk choices,
then releases its live review. A failed checkpoint blocks handoff and retains text.
Two saves to the same note remain distinct; target identity cannot supersede them.
Confirmed Reload Disk reads the reviewed document even when another note is visible;
it discards review text through canonical adoption and cannot save that discarded text.
Repeated clicks while dismissal or reload is pending do not repeat those operations.

Navigating away from an unresolved review retains its working copy and hunk
choices for return. Pane and workspace save barriers checkpoint the working
review without publishing it or requiring a clean canonical baseline. Ordinary edits in other documents
still flush even if the independent review checkpoint fails. External-change
conflicts and canonical collisions still block departure of a dirty document.

### Chat content becomes notes only through review

Whole completed answers and verified selections default to new notes; an adjacent
editor never supplies an implicit destination. Direct Save makes no model call.
Existing destinations require explicit user intent and follow Note Identity.
Selected Markdown and recorded sources transfer faithfully, with ordinary source
wikilinks and one Open in chat backlink under ADR 0011. Repeated selections bind
the captured occurrence; source controls outside the highlight remain associated
without copying neighboring claims. App-generated passage labels, including
unavailable-passage placeholders, are excluded from both selection matching and
selected Markdown; recorded answer associations recover their source links.
Authored note and web links remain authored selection content.
Saved links are user-maintained and do not
retain live chat evidence semantics. Authored heading/block fragments survive
promotion; passage citations retain the located block/paragraph destination.
Old offsets cannot select a position in edited or historical content; only a
unique surviving excerpt can establish it. Otherwise the source-note link remains.

Title/location/body and decisions survive acknowledged checkpoints and restart.
Keep alone publishes through NoteTimeline; Discard cannot autosave a creation.
Initial occupied filenames get an unused suggestion; a collision at Keep retains
text, suggests another path and requires another Keep. Changed existing notes
refresh only separable additions on the latest base. Ambiguous headings, missing
or revoked targets, overlapping edits and failed persistence retain the draft.

Repeated Save reopens the same pending origin, or opens its committed Note Identity.
An additional copy requires a new explicit intent. Keep retries/concurrent calls
return the authoritative receipt without replaying publication. Explicit model
refinement reads the latest version and revises the same proposal; late output
cannot replace newer checkpoints or revive kept/discarded work.

### Proposal recovery converges without duplicate writes

If proposal content was persisted but its status update failed, recovery first
verifies the target content or hash and then converges status to committed.
Repeated recovery is idempotent and never reapplies content blindly.

### App-owned commits advance the open-document baseline

After a verified proposal commit, an open document adopts the committed
Markdown as its saved baseline instead of treating the write as external.
The commit receipt supplies editor-visible Markdown from the canonical publication;
read-back compares against that receipt so title-heading and newline normalization
cannot manufacture a conflict. The submitted working text separately identifies
local edits made after commit began, which remain dirty. The submitted title
likewise distinguishes later user edits from the canonical filename chosen for
sanitation or a collision; receipt adoption cannot rename that file back. If disk no longer matches
the committed Markdown, ordinary external-conflict protection applies.

### Proposal arrival does not navigate

Receiving a proposal adds it to the pending queue without opening, activating,
focusing, or repurposing a pane. If its target is already open and clean, review
content may appear there without changing the active pane. Navigation begins
only when the user explicitly chooses to review the target in an editor, saves a
message/selection, or asks conversationally for a save/refinement. Passive replay
of a historical requested-review event does not authorize new navigation.

Passive admission and final review installation check complete document cleanliness,
including title, tags, and identity, through the canonical document predicate.

## Image interactions

- Markdown remains the image layout authority: size commands patch its suffix
  without rewriting destinations, titles, labels or encoding. Wiki and standard
  Markdown embeds resolve only contained local assets; backend canonicalization
  rejects traversal and symlink escapes.
- Image widgets and interaction state belong to one editor view. Asset loading
  shares bytes through document resources, never DOM, selection or gesture state.
- Image mutations use the shared editor undo root and ordinary note saving.
  Selection/source visibility, viewer zoom/pan and unfinished resize previews
  never create authored edits or Editing Window boundaries.
- A resize commits once at pointer release. Escape, pointer cancellation, blur,
  document mutation, read-only takeover and destruction cancel previews and
  listeners. A resize's trailing click cannot open the viewer.
- Paste keeps the selected authored text until every file has saved. A failed or
  canceled job retains it; retry reuses successful files. Results from a retired
  view or a changed replacement range cannot insert into a different document.
- The viewer shares the existing transient owner. Closing returns focus, scroll
  and selection only to a still-live origin. Image-list changes, replacement and
  history/review takeover invalidate it. Gallery navigation includes offscreen
  images and never changes note layout.
- Embed delete/cut/undo do not delete asset files. Note history versions authored
  references and dimensions, rather than historical image bytes.
