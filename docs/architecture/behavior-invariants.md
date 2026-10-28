# Behavior invariants

These are the non-obvious product outcomes that refactors must preserve.
Verify their implementation against current production owners and focused tests;
this document records intended constraints rather than proving every path enforces
them. Known implementation gaps are identified explicitly. Details not stated
here remain open.

## Workspace and navigation

### Keyboard assignments come from one command catalog

`keyboardShortcuts.svelte.ts` owns app commands and explicit editor shortcuts.
Settings and command dispatch consume the same arrays of bindings; an empty
array disables the command. Adding an alternative retains existing bindings,
and removing one does not revive its default. Legacy single-binding preferences
and both former Redo entries migrate without losing remaps or disabled bindings.
Explicit assignments retain their exact keys across reload even when they equal
a different platform's defaults; resetting restores the current platform's defaults.
Basic text movement and standard control navigation retain their native behavior.

Recording a binding suppresses app shortcuts until it is saved or cancelled.
History Mode, image viewing and publication recovery suspend the retained dock's
Search/Forget shortcuts and cancel any pending Forget hold or confirmation.
Search-result split keys and modifier-click alternatives share one configured
action. Show Split Options separately owns the editor's held-modifier cue;
its modifier-only bindings can be recorded, removed and reset in Settings.
Commands, held previews and modifier-click alternatives require exactly the
assigned modifiers. Adding an unassigned modifier hides a held preview, and
releasing it restores the matching preview. External links likewise open only
with Cmd-click or Ctrl-click without extra modifiers; unmodified touch/pen taps
retain their Open/Edit choices.
Forget's keyboard hold cancels when its modifiers change and rechecks the
assignment and action admission before completing; a normal short press still
opens confirmation.
Settings shows one row per command, grouping its editable bindings together.
A customized command has User as its source; otherwise it has Default. Search
matches any one binding and keeps every alternative visible. Reset is available
per command or globally.

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
Pi chat/tool/compaction work is closed and settled, watcher debounce and
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
The first native request to close Pi's frontend Harness begins terminal release;
a timeout or later preparation failure cannot reopen that closed owner. Retry
Restart joins the same pending acknowledgement and completes settlement. The
pending request is re-delivered until acknowledged so starting the frontend
listener after native storage opens cannot lose the close request.
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
another note has a conflict or save failure. External conflicts remain unresolved
and failed edits remain dirty. Backgrounding does not close the Running Vault or
request process relaunch.

Each mounted composer captures its live unsent text and flushes through its
draft owner without sending or creating a conversation. Writes to one slot are
serialized across remounts, and a flush joins that owner's in-flight writes.
Failed draft writes retain the in-memory text/cache, report a visible error, and
can retry when the composer next records and flushes its live text. Subscriptions
are retired with their owners, including late native listener attachment.

These signals admit best-effort saves while JavaScript is available. They do not
guarantee durability after immediate OS suspension or termination, persist
unsent attachments, or establish a portable clean close. Physical iPhone
background/lock/termination recovery remains outside the rebuild's simulator-only
acceptance and must not be inferred from it.

### Bootstrap admits one coherent backend snapshot

The bundled application bootstrap is the only initial-session retrieval path.
Editing remains unavailable until both its payload and every required backend
listener are admitted. Listeners attach before the payload request; a failed
attempt removes partial listeners and may be retried. Newer events and operations
win over delayed bootstrap, Settings, and command results independently for each
shared snapshot. Settings consumes the same running/next-launch vault, watcher
health and semantic snapshots rather than retaining a second copy. Editor asset
paths always derive from the Running Vault, including
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

### File-watching health describes the Running Vault

Vault Settings consumes retained native health through AppStore, including
failures that preceded opening Settings. Startup failure means watching and
periodic reconciliation did not start; a callback error after successful startup
keeps periodic scanning active but does not establish reliable OS notifications.
Reasons are bounded, curated categories rather than filesystem paths or raw logs.
Repeated errors do not flood health updates. A watch-capacity warning cannot be
replaced by a less specific later error. Callback warnings remain until process
restart; file events and successful scans do not prove watcher recovery.

Health belongs to the immutable Running Vault even when a different next-launch
vault is staged. Native revisions order retained snapshots and events; older
delivery cannot replace newer state. Terminal shutdown retires health admission
before watcher teardown, including when registration has not produced a handle,
so late startup/callback work cannot revive it. This diagnostic slice introduces
no watcher retry, registration-failure fallback scanning or new service lifecycle.

### New Idea changes only the invoking pane

Starting a New Idea leaves a nonempty document through the existing save/departure
boundary and rebinds only the invoking pane to a fresh draft. Other panes retain
the existing document. Starting from an empty draft reuses it.

### Recovery Drafts restore unfinished work to its original Note Identity

Dirty body, tags and title input are coalesced into vault-private Recovery Drafts
alongside the saved content they were based on.
A clean canonical adoption clears only its matching work; newer edits remain.
Versioned tombstones prevent delayed writes from reviving saved/discarded work or
old removals from deleting newer work. Backup errors are visible and retryable,
independent of canonical save errors. Coalescing and abrupt platform termination
retain a loss window; typing is not synchronously durable.

Recovered work is offered explicitly and opens the original Note Identity through
ordinary workspace navigation before restoring unfinished edits. Never-saved ideas
resume as drafts. Already-saved matching content is acknowledged without replay.
Changed or unknown saved bases (including legacy backups) require the existing
conflict choice; current unsaved edits and unresolved conflicts cannot be replaced.
A second interruption preserves that conflict requirement. Missing originals retain
the backup without publishing a replacement. Restored work is backed up before
the old backup is retired. Normal departure, editor ownership and mandatory Note
Timeline preparation still apply. Next-launch vault staging cannot redirect the
Running Vault's Recovery Drafts.

### Chat context and note navigation agree with visible content

The composer context indicator estimates Pi's derived active model context,
including current streaming output, against the selected model's reported
capacity. Loading older transcript pages does not increase context usage;
compaction and reset follow Pi's context. For local models, native configuration
retains the last observed loaded capacity per server and model across restart.
Unloading or missing metadata preserves it; a fresh loaded observation replaces
it, including a smaller configured window. Successful local inference refreshes
metadata before terminal admission. An advertised maximum is never used as a
configured window, and a model without any observed capacity has no percentage.

A chat never receives implicit editor content or selection. The model discovers and reads canonical notes through the conversation's native
read mode and current exclusions. A pane retains its ordinary document return
target independently of chat authority and context. Search previews do not count
as reads or issue citation sources.

Generic note navigation targets the nearest editor when one exists. Otherwise
it reuses the active retained-context pane and reveals its editor. Navigation
always passes through the editor lifecycle before content synchronization is
considered complete.

Previous-note navigation restores keyboard editing at the pane's saved cursor.
The outgoing document releases native editing focus before its mounted editor
is hidden and rebound; destination focus follows completed presentation and
still yields to newer user interaction.
Startup's default editor focus also yields to interaction that occurs while the
session is loading, so finishing restoration cannot dismiss an open search popup.

Committed selections in the shared discovery popup (Search, Related, pinned
notes, images and Recent) open in the active pane, replacing its chat view when
necessary. The selected pane is captured before asynchronous navigation; other
split panes retain their locations. Selecting the retained note still reveals
the editor. Current-note match previews retain their existing editor target.
With one pane and room for discovery splits, Recent's Thought partner entry
supports the same split button and shortcuts as saved notes. It opens directly
as chat with its retained conversation and document return target, preserving
the source pane and its unfinished edits.

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

Changing an editor pane to chat retains its document as the workspace return
target. Changing it back restores that document. Any pane may close
while another remains, including in a chat-only workspace.

Opening chat without an explicit conversation restores the last viewed conversation
from the Running Vault's persisted chat location. Missing or forgotten conversations
leave a fresh composer. Explicit conversation navigation takes precedence, and New
chat stays empty until the user starts a conversation.

The conversation picker can forget a chat without opening it. Confirmed row
actions retain the open picker and its scroll position; forgetting another chat
does not replace the selected conversation or its composer draft. Forgetting the
selected chat leaves a fresh composer. Picker Undo restores the last forgotten
chat to the list without navigating. Pi's transaction checks reject forgetting
while that target has active response, compaction or queued work.

Each chat pane retains a reading position per conversation for its open lifetime,
including while the pane displays a note. Returning restores that position after
history rendering settles. Explicit message links take precedence; unseen chats
and chats that were following the latest message open at the bottom. Loading and
partial history rendering cannot overwrite a retained reading position.

Streaming chat follows rendered content growth smoothly while the viewport is
following the latest message. Scrolling upward cancels following immediately,
and returning to the bottom resumes it. Reading above the bottom retains the
scroll offset through streamed markdown replacement and delayed content layout.
An intermediate scroll clamp while replacing markdown or admitting a completed
message cannot reset the viewport or count as user input; the pre-render offset
is restored before paint, with conversation changes invalidating that repair.
Viewport width, height and dock-clearance changes reconcile following before
paint so layout reflow cannot start a second scrolling animation. Reduced motion
uses immediate following. `chatMessageScroll.ts` owns this viewport
behavior, including restoration and earlier-history prepend correction.

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
and the rail's hit target stops above it. Changing the active rail dismisses
the Related popup; collapsed editors do not drive Related retrieval. Rails sit below the maximum measured retained-header extent
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
Note-to-note rail exchanges use the dock's morph duration and editor curve even when the
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
loss, Escape, window blur, hidden visibility, document changes and editor teardown
discard the drag and its preview without publishing a move. A later pointerup
cannot revive it. Successful moves retain ordinary Undo behavior.

While dragging, approaching the visible pane's top or bottom scrolls that pane
with proportional edge speed, including under a stationary pointer. The drop
preview follows the newly revealed content. Leaving the edge or ending the
gesture stops scrolling.

### Tables retain canonical Markdown and shared undo

Top-level GFM tables expose editable cells, row/column controls, alignment and
keyboard navigation. Cell and structural edits use ordinary Markdown transactions
and the document's shared Undo/Redo history. Moving a table moves all its rows.
Composition, source replacement and widget disposal cannot publish stale input.
Rendered cell selections use the same inline formatting popup and shared history
as source selections while retaining cell focus. Block conversion remains a source
editing action. Replaced cell DOM cannot retain an actionable selection or author
late input. Table spacing participates in the editor's measured height; pointer
placement and vertical cursor movement stay accurate across multiple tables.
Entering and leaving a cell editor preserves rendered column widths.
Source mode remains available; nested tables and irregular extra-cell rows retain
literal editing so visual controls cannot discard authored content.

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
Atlas searches filter rendered nodes, filenames and connections at their existing
positions; clearing the filter restores the admitted inventory. Search never
regroups notes or changes accepted geography, and does not offer an editor-style
note suggestion panel. Native query relevance requires every query word across
title, filename, vault-relative path, preview and tags, or strong semantic evidence.
Text matching uses word boundaries, with prefix completion for the final word
once it contains at least three characters. Semantic-only matches must exceed a
stricter floor derived from the active provider's text floor and remain close to
the best similarity in the tag-filtered inventory. Recency, opening frequency
and structural boosts affect ordering only. The frontend does not apply another
model-independent similarity threshold.

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

Explicit formatting actions are isolated shared Undo steps, including selected
text, caret commands and table cells. Empty paired markers remain writable;
inline code chooses a delimiter longer than backticks in its content and toggles
that complete delimiter. Formatting shortcuts yield from composition start,
including the interval before the first composing edit. Pane presentation may
conceal markers without changing the canonical source or shared Undo history.

Editor changes update the authoritative draft synchronously using an immutable
body value. A captured save retains that exact body and metadata even if editing
continues or every pane unmounts. Undo back to saved content is clean; revisions
and body identity alone do not establish different authored content. Canonical
files and native payloads remain Markdown strings. Exact boundary line endings
remain intact until editing; root and pane offsets use the same CodeMirror
line-ending normalization.

Ordinary save, Version Restore, admitted agent publication, clean external refresh, and
transient Forgotten-Note Recovery and Recovery Drafts enter fixed-purpose document adoption methods.
Callers do not choose identity, baseline, warning, rekey, runtime-reset, or
derived-refresh policy. A committed warning is adopted as part of the successful
result and never authorizes another write. Ordinary save preserves eligible later
title and body edits. Agent publication leases prevent edits during admission and
adopt verified receipt content; a canonical read-back that no longer matches the
committed Markdown enters ordinary external-conflict handling.

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
Opening an editor task's add-date picker establishes the invoked task position
as its selection before Apply. Its undo/redo restores a position on that task,
rather than an unrelated caret left elsewhere in the note.

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
A failed ordinary editor rename/save restores the original path when rollback succeeds and
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
never finalized as history truth. A raw-preserving agent rename instead retains a
two-location journal: exact destination bytes/identity and source absence must be
witnessed before its unchanged authored history can settle. A durable witnessed
effect may finish that original lifecycle capture after a subsequent external
edit; recovery never republishes the retained bytes. Without that witness, mixed
or changed states remain uncertain and untouched.
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
deduplication window. Every canonical Markdown document follows ordinary note
observation and publication. No managed chat projection classification or
transcript-specific write restriction participates.

### Semantic search preserves the last usable result

Optional result-type and edited-time cues constrain admission before ranking and
limits. They remain reversible retrieval controls; writing needs no classification.
Date/type changes supersede old requests and participate in cache compatibility.
The search popup retains its displayed list across query edits and filter changes.
That presentation snapshot stays inert and cannot supply click, keyboard or split
navigation. Replacements appear after 250 ms of quiet input and both retrieval
channels settle; canonical note/image results publish together. No skeleton or
visible loading label interrupts the list. A failed replacement keeps the preview
with Retry unless a successful channel supplies usable replacement results.
Clear, scope/image-source changes and dismissal retire the preview and its timer.
The popup has a fixed height bounded by available viewport space, with results
scrolling beneath the filter controls.
Current-note passage search retains occurrence navigation and opening behavior.
Atlas ranked results and highlights use the same admitted scores and cannot
reorganize accepted geography.

Ordinary text media retrieval omits duplicate passage ranking when the note
channel already owns it. Image-query defaults retain passage retrieval. Shared
query preparation retains only the last exact text embedding for one compatible
provider generation; it caches neither authority nor results. Canonical byte
fingerprints still detect watcher-missed changes, with file reads outside the
notes catalog mutex and identity/path bindings checked around those reads.

Discovered ordinary notes are keyword-searchable as soon as they enter the
note catalog. While their lexical projection is missing or outdated, search
uses the current catalog paragraphs without waiting for background indexing
or embeddings. Once the lexical projection catches up, search uses it without
adding duplicate fallback results.

Reopening Atlas revalidates its retained display against the backend even when
its previous response was ready. Atlas has one notes-only generation and no chat
visibility setting. Pi conversations never create synthetic map nodes.

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
for current ordinary-note reconciliation and durable ANN publication. Retained
absent-note semantic rows are removed as derived state. NoteTimeline validates the
prepared source version at publication.
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

### Ordinary chat has one Pi execution owner

[ADR 0012](../adr/0012-found-ordinary-chat-on-pi.md) governs the implemented shared
Pi runtime. Pi owns immutable history, submissions, queue, generation/tools,
recovery, cancellation, progress, usage and standard compaction. Native Rust owns
Running Vault policy, credentials, canonical notes, source identity and effect
proof; Svelte owns disposable views/selection/composer. No legacy ChatService,
ChatController, runtime fallback, durable UI projection or app scheduler remains.
No existing-user migration, transcript import/publication, exact Retry, research,
plans, implicit editor context, selected excerpts or non-note attachments are
required. Existing authored files, Note Timelines, settings and credentials survive.

Tools expose native search/read and targeted saved-note editing with independent
write authority and optional exact review. New titles derive from the first
message without inference. Local and hosted providers use the same composition;
live hosted credentials and physical-device acceptance are outside this rebuild's
gates. Desktop acceptance precedes simulator validation, and previous evaluation
results do not stand in for either post-retirement or current-platform checks.

### Provider sign-in remains native and device-local

The OS credential store remains the persistent owner of API keys and ChatGPT
OAuth credentials. Desktop access is lazy and coalesced once per credential per
process; successful rotation/replacement is persisted before cached reuse.
Removal/replacement evicts stale cache entries, and failed reads are retryable.
A restart restores the OS-store access boundary; mobile protected-storage reads
retain their existing policy. No credential value is readable over WebView IPC.
Settings metadata inspection does not decrypt credentials or call model discovery.

Native owns the active ChatGPT sign-in, safe progress and cancellation. Closing
Settings releases its view without cancelling the attempt. Reopening Settings
reattaches to the active progress. Only explicit Cancel, timeout or process exit
ends that attempt. Pi validates browser/pasted callback state and owns token
exchange; native persists the completed credential before selecting subscription
billing. Subscription failures never fall back to API-key billing. Reconnect and
disconnect retain the issued app registration and stable host ID; later sign-in
reuses that client rather than creating another ChatGPT app entry.
Disconnect removes tokens, while registration metadata remains device-local.
An existing connection offers no sign-in action, including while API-key billing
is selected. Native also suppresses redundant login attempts. A subscription
request or connection check rejected with HTTP 401 confirms session usability by
serialized refresh before removing credentials. Only a terminal refresh error
exposes sign-in again; network failures, service errors, and usage limits do not
discard tokens or switch billing. A late rejection for a replaced access token
cannot invalidate the newer connection. Settings reads safe status after explicit
model checks; opening Settings remains metadata-only.
Development rebuilds can still require OS access approval until a stable signing
identity is configured; the app does not weaken Keychain access rules to suppress prompts.

### History, progress and compaction use Pi semantics

The complete human-visible transcript is paged from immutable Pi entries; the
active post-compaction view is not treated as complete history. Earlier tool text,
answers and provider-emitted reasoning may remain working memory and compaction
input. Reasoning uses normal Pi retention and is collapsed by default in the UI.
Observable generation/tool/compaction state, safe tool failures and elapsed time
are displayed without inventing thinking or stuck diagnoses.

Pi's creation hook establishes app chat, read cursor and empty review documents in the same
transaction as conversation creation, including raw creation and forks. Selection
loads their watch values without initialization writes or full agent resolution.
Metadata changes during attachment remain observable. Progress-only view frames
retain loaded transcript entries; entry operations and full replacement frames
merge active entries while preserving previously loaded history pages.

Runtime reports and observation failures use bounded ephemeral diagnostics with
curated messages. Unknown exceptions use a fixed fallback; raw exception strings,
provider payloads, note content and credentials are not diagnostic records. A
report cannot change task settlement, retry, permission or publication decisions.
Only actual Harness termination establishes terminal runtime unavailability;
cancelling a mounted Chord observation is not proof that durable work has stopped.

Standard Pi compaction uses observed model metadata and the same mandatory native
provider admission as ordinary generation. Unknown capacity remains unknown, with
upstream overflow recovery available. No custom summary engine or purpose classifier
is required. A summary is fallible memory, never a new read, citation proof or
permission. Claims about current note state require another authorized read.
Measurements of provider time, bridge traffic and database/WAL size are diagnostic;
no temporary target becomes a permanent runtime cap or architectural invariant.

Stop uses Pi abort and withdraws queued work; a queued submission can be cancelled
before placement. Changing selection does not cancel work. On reopen, native
binding/current authority and models are installed before scheduling resumes.
Stopped work stays stopped; terminal failure offers a new attempt under current
settings rather than exact Retry. Human-visible history does not itself authorize
inference or fetching excluded content.

The vault-lifetime chat activity projection observes Pi live/inbox state and
terminal input submissions independently of mounted panes and paginated lists.
Chat switcher and conversation-history buttons show a grey pulsing dot while
work runs, and a solid green dot for unread results; unread results take
precedence when another chat is still running. Conversation rows show their own
state. Reduced motion keeps the running dot static. Forgotten chats, internal
note-title jobs, passive history writes and explicitly aborted inputs do not
produce unread notifications; a failed placed input does, even without an answer.
Only a loaded, expanded chat in a visible, focused window acknowledges a result.
History Mode hides retained chats from read admission. The exact completed answer
must be loaded, or an answerless failure must be the displayed input; a newer
aborted input cannot acknowledge an older result that compaction has hidden.
Its displayed completion ID advances the monotonic Pi `ChatReadDoc` cursor, so a
late acknowledgement cannot clear a newer result and unread status survives
reopen. Existing controls attach to each successfully opened runtime, including
an explicit open after failed startup. Existing history without an initialized cursor starts read. Indicators
derive execution and outcomes from Pi; they do not schedule or settle work.

Tool activity distinguishes expected domain outcomes from execution failures using
structured native codes and Pi diagnostics. Rejected reviews, stopped/unstarted
calls, permission limits, unavailable or changed notes, invalid requests and editor
admission blocks have neutral labels and do not increase the failure count. The
model still receives unsuccessful tool results so it can respond appropriately.
Native codes survive publication/review task settlement into retained tool details;
terminal results supersede stale live progress. Storage errors, unknown failures,
and interrupted or unconfirmed effects remain failures. An editor block is neutral
only before the publication effect begins; adoption errors cannot imply no write.
If Stop interrupts the edit tool after its publication child confirms a commit,
the activity shows that the edit was applied while generation remains stopped.
Selection reads retained terminal publication-task results and observes subsequent
task commits, joining their owner IDs to immutable tool-result entries. This is a
disposable presentation projection, not another outcome ledger or write authority.
An aborted tool result alone cannot establish either a write or its absence.

### Read restrictions end the old context

Full vault and Attached notes only both obey exclusions and current eligibility.
Default settings apply to new conversations; existing conversations retain their
explicit policy. Attachments contain Note Identities and resolve canonical bytes
through native checks. Search previews cannot authorize citations.

A restriction or new exclusion retires affected native authority and in-flight
delivery before aborting old Pi work, including background compaction. The host
creates a fresh conversation/provider identity under the narrower policy; no old
history, fork or summary enters it. Old history may remain human-visible. Retired
authority is denied across reopen, and widening reads never widens a write grant.

### Citations represent actual native reads

Issued source IDs bind Note Identity and actual canonical read state. Full read
proof stays native and in Pi tool details; model-facing read output supplies
content and complete native-issued Markdown citation links without revision/hash
proof. Reads, answers and summaries use this single representation; no legacy
token decoding or label conversion is retained. Admission returns
verified Markdown only and does not duplicate structured read receipts. Mandatory
native admission validates all terminal provider text blocks and the conversation
binding, including empty tool-only responses and standard compaction. Foreign or
invented source IDs never become clickable references. Admission checks identity
and shape, not semantic entailment. An optional passage location requires an exact
unique quote checked against the canonical native read; model-supplied coordinates
cannot authorize a location.

Source links display the native note title, optionally with a quoted passage, and
open the current note rather than History Mode. Finalized revision and observed
hash/time receipts remain internal read evidence; an unfinished Editing Window
cannot mint a Note Revision. Later edits do not invalidate an honestly historical
read. Navigation rechecks current exclusions, eligibility and identity, and gives
informational feedback if the current content differs, including after the
agent's own edit. Successful navigation limitations stay local to the mounted
chat surface and do not become retained chat errors. A passage selects only an
exact unique quote in the current note and live editor; changed or ambiguous
passages open the note with a limitation and no substituted selection. Saved history grants no permission
to fetch excluded current content. Ordinary workspace/departure and focus
supersession behavior applies to source navigation.

After a committed edit, the edit tool performs an authorized canonical read and
returns its content and fresh citation for the final confirmation. The pre-edit
read remains historical. If that new read fails, the committed receipt remains
successful, no new source evidence is supplied, and current-content claims
require another authorized read. The read cannot cause a second publication.

### Conversation configuration and composer remain explicit

A mounted pane retains its composer draft and per-conversation reading position.
Sending clears only the admitted originating text; failed submission preserves
unsent content. Native draft persistence serializes writes across remounts and
background saves without creating or sending a conversation. Settings supply
new-conversation defaults; explicit model/read/attachment choices affect the
current target and do not silently inherit a Temporary write grant.

Provider and model remain distinct choices. Local capability/reasoning metadata
is discovered and validated rather than guessed from model names. The compatible
transport maps supported reasoning options; unavailable metadata sends no invented
override. Switching conversations or deriving ordinary chat titles does not trigger inference.

### Related notes do not resize authored content

Notes expose Related through a floating button beside Search. The button opens
the existing search popup in Related mode, even with no query or Recent notes.
It retains ordinary search
query/scope state. Related is absent from chat and History; changing the active
pane or document dismisses its popup. Escape restores the captured editor/title
focus, and pointer/keyboard selection uses ordinary passage navigation.
Search, Related, pinned and idle saved-note results offer an explicit split action
while one pane is open and the viewport admits a split. Unsaved draft matches
retain ordinary selection without offering an unavailable split action.
The action loads and activates a new editor through the workspace
session while preserving the source pane. Existing splits retain ordinary result
selection. The idle Recent / Last edited switch preserves the query and Recent
shortcuts; Last edited orders saved eligible notes by authored edit time rather
than opening activity, using existing filesystem time for legacy notes.
Related replaces its floating icon with a floating Search control on the left;
the Related icon is absorbed into the bar through the same dock exchange as Chat.
Its idle icon stays adjacent to the painted Search bar. The active bar keeps
Search's width and height, including its compact two-row sizing, and returning
to Search preserves query/scope and input focus. The existing chat return control
and composer remain available independently.
Opening from idle and dismissing back to idle animate the painted width and
circles together, without applying a new width cap ahead of the exchange or
starting another expansion after settling. Both input presentations remain
mounted through their outgoing fade; an interrupted exchange starts from the
displayed geometry.
Related opening, dismissal and Search/Related exchanges use the same reusable
container component and shared 380ms exchange duration. The component
accepts arbitrary keyed items in caller order with icon, compact or expanded
presentation, configured widths and configured or measured heights. Feature
contents and activation remain caller-owned. Reversals continue from the painted
pose with proportional remaining travel; simultaneous pane changes retain their
coordinated clock. The Related glyph remains visible throughout that exchange.
Outgoing Search scope labels retain their layout until their fade completes.
Search and Related share the popup shell, heading and note-row components;
Related supplies its heading, notes and extra row detail. A Related / Backlinks
switch uses the same segmented control as Recent / Last edited. Backlinks lists
one row per other saved, eligible note linking to the current saved note, with
its first linking line as a passage preview. Wikilinks match the existing title,
filename and vault-relative path rules, including aliases and section fragments;
relative Markdown links to `.md` files also count. Code, escaped syntax and image
embeds do not count. Backlinks uses the ordinary note index independently of
semantic model availability. Unsaved notes explain that saving is required;
empty results never substitute related matches. Switching retires the previous
view's request, resets row selection and preserves ordinary search state.
The popup anchors to the center of the whole discovery dock and fills its
available width up to the existing popup cap. Switching Search/Related or
dismissing either view preserves its painted position and width while the
controls below exchange or contract. The popup begins revealing while the bar
expands, and switching an already-open Search/Related popup replaces its content
without remounting the panel.

Opening the popup preserves editor width, wrapping, selection and Markdown.
Related adds no content at the end of the note. Retrieval belongs to the open
popup and is scoped by document lifetime. A closed popup initiates no assessment
loop.
Draft changes reject old responses and mark visible matches stale without
reordering them. Refresh/Retry retains the previous rows until a new assessment
finishes. Vault target changes remove affected rows; final release/teardown
retires the result entry. Loading, insufficient content, empty and unavailable
states remain explicit and never substitute Recent notes. Saved-source native
shortcuts must match both the requested draft and indexed bytes.

### Search and chat share a dock without replacing their drafts

When a chat pane is open, search and the selected chat composer share the bottom
dock. The capped input centers across the workspace when there is room for its
sibling icons; narrow layouts use the available input width and keep those icons
inside the dock. Expanding one collapses the other to an icon. Explicit mode selection
survives repeated activation within the same pane. Switching the active pane
shows search for an editor and the selected composer for chat, at every width.
Replacing the active pane’s kind applies the same selection even when its ID
is unchanged and another chat remains open.
During pane collapse, dock presentation uses the workspace's same right-then-left
close destination before retirement; it does not take an intermediate Search
step on the way to a surviving chat. Canonical activation still changes only
when retirement commits.
While any chat pane remains open, the dock retains its chat/search presentation
and chat button, including when that pane is collapsed to a rail. Clicking the
chat button activates its pane and focuses its retained composer. Incoming
search follows its own focus state throughout the existing handoff; switching
panes cannot briefly reveal an idle placeholder or match options.
Switching modes keeps the mounted search and composer, preserving the search
query, unsent text, attachments, and
configuration without creating or sending a conversation. Search shortcuts can
expand hidden search, and returning focus to chat expands its composer.
The shared presentation component knows keyed containers and their icon, compact
or expanded states. The workspace adapter maps Search, Related and Chat to those
items. Inputs remain mounted while one main bar morphs between them. Chat/search exchange keeps that bar's width constant: the composer compresses
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
geometry. Pane layout changes project the adjacent actions on that clock so the dock never
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
both background circle shells stay full-size and opaque. Capped centered inputs
translate both shells together; narrow exchanges retain fixed shell endpoints.
Editor/chat paths use
measured endpoints rather than recomputing against the moving flex width, so the
first painted frame retains the displayed origin and width-cap changes do not hitch.
Settled search geometry stays relative to its available flex space; resizing that space does not restart search expansion. Chat input
and chat search use the card’s available space with balanced gaps beside the
adjacent actions.
Ordinary editor-search CSS transitions resume only after projected margins are
released and the settled local coordinates have flushed, avoiding a second
transition from stale bounds at the end of the shared morph.
All container morphs and pane entry and departure use a shared
`cubic-bezier(0.65, 0, 0.35, 1)` easing for the pane and dock: gentle
departure and arrival with a faster middle. Measured dock bounds travel directly
between endpoints even when its input mode stays unchanged. Input switching uses
the same curve, which follows the remaining clock when interrupted.
Content scrolls beneath the shared dock fade. With a chat open, end padding
reserves the measured expanded composer height in both chat input and search.
The outer dock frame reserves the larger input height while its bottom-aligned
bar animates inside it; unused frame space lets pointer input reach the content.
Switching between those modes preserves message positions throughout the morph
and after settling, including at the bottom and when reading older messages.
Draft growth and shrinkage update that clearance; a growing draft keeps the
latest message visible when the chat is following without pulling a user away
from older messages. Editor/chat morphs hold maximum reading clearance until
settling instead of moving the scrollbar every frame.

## Agent publication

Chat exposes targeted saved-note updates, new Markdown note creation and same-folder filename renaming with
shared existing-note write permission for edits/renames, separate creation permission,
and a common default-on review setting. Pi's public edit tool prepares edit arguments and computes staged
replacements; domain identifiers remain exact strings and arbitrary path arguments
are rejected. Only native
authority, the document owner and NoteTimeline can publish them. The original
issued read source must match the note, canonical path and exact bytes before
staging; publication checks that same base again. The computed edit candidate is durable before
native preparation. Tool replay reuses its publication task instead of rerunning
replacements against new canonical content. Pending review survives reopen in the
same conversation and starts empty on fork. Discard/stop removes the review and
permits no new effect; authority retirement cannot strand an actionable review.
Both review layouts show changed text with a short preceding section excerpt when
available in Pi's patch. Whitespace-only edits expose changed spaces, tabs and line
breaks with a legend. These are presentation transforms; exact candidate bytes and
the full technical diff remain unchanged.
The review document is seeded atomically with its publication task. New task inputs
retain references and the approval hash, without a duplicate review title/patch.
Review data is explicitly an edit patch, a creation destination and authored
Markdown, or exact rename source/destination paths; creations and renames carry no
empty patch. Pi's document upgrade preserves
pending review content and decisions across this representation change.
There is no older review-input migration. Update admission requires the exact raw
base hash. Create admission requires its own explicit operation grant and an
existing visible vault folder. Native code fixes the safe destination, fresh
identity, metadata and canonical bytes at preparation. Creation review shows that
destination and complete authored Markdown. Atomic create-only publication rejects
all existing destinations, including late arrivals; it never overwrites or chooses
a suffix. Creation reuses Pi's checkpointed validated tool arguments without a
duplicate candidate memo. The same stable Pi request reopens its original intent, and native
proof/result reconciliation survives restart and lost acknowledgements without
creating a second note. All three operations retain the same publication task and
document-owner lease; neither creation nor rename introduces a separate scheduler.

Rename requires Update permission, an exact issued read and source identity/location
admission. The same explicit note or descendant-folder scope applies to edits and
renames. The normal review setting applies to both; enabled rename review binds the
exact source and destination paths. Prepared intents retain their original review requirement.
Native code derives one safe visible Markdown filename in the existing folder;
ambiguous case/normalization-only names, unsafe/reserved names, symlinks and occupied
destinations are rejected. There is no suffix, overwrite, directory creation,
arbitrary-path input or backlink rewrite. ID references retain identity; ordinary
filename/path links may stop resolving, as the review explains.
NoteTimeline durably prepares both paths and exact raw source bytes before the
platform atomic no-replace move, rechecks the source and destination under the
canonical owner, and retains the existing identity and history chain. Managed
metadata and authored bytes remain unchanged; the existing rename Lifecycle Event
adds no duplicate content revision. Unsupported primitives fail closed. Recovery
observes the original proof and repairs projections, never moves or republishes
bytes, and preserves a foreign file that has reoccupied either path. Uncertain
outcomes retain their evidence. See [ADR 0015](../adr/0015-prove-agent-renames-across-both-locations.md).

A read grant cannot authorize a write. Off/Temporary/Always grants specify
operations and explicit note/folder scope; Temporary belongs to one conversation
across reopen and ends on revocation or deletion, while Always belongs to the
Running Vault. Update permission includes content, properties and filename
changes; it never implies Create permission. Review is independent and default-on. Always is projected into every chat rather than hidden by an earlier
Temporary grant. Choosing Temporary or Off atomically removes Always; other
independently granted Temporary conversations retain their grants. Mounted views
refresh from native policy changes. Direct publication requires a current scoped
grant and explicitly disabled review. When enabled, approval binds one exact
payload and cannot widen its scope.
First-use permission creation and selection stay bound to the originating draft.
If selection changes or the view is disposed before the target chat is ready, no
permission command is sent. A delayed response never adopts authority into a
different selected chat; native revision and scope validation remain mandatory.

Chat and Settings expose shared content/property/filename editing permission and
a separate, default-unchecked Create permission. Changing duration preserves already
explicit operations and scope. Both surfaces expose existing relative folders;
all enabled operations include descendants, and renames remain in the current
folder. Saving folders preserves note identity scopes and the selected operations, and stays bound to the originating
authority revision.
Settings exposes that same vault-owned Off/Always grant and review policy without
requiring or creating a conversation. Saving applies to existing and new chats,
invalidates affected authority revisions, and preserves individually granted
Temporary permissions. Chat and Settings never retain independent write defaults.

Changed canonical content, dirty editor body/title/tags/identity, unresolved
conflict or a pending operation blocks conflicting publication. A short
`DocumentEditingService.withAgentPublication` lease prevents editor races and adopts
the verified canonical receipt through the document boundary. Rename leases bind
both source and destination, freeze matching shared editor runtimes, and preserve
the Document Handle and shared undo root while adopting the new canonical path.
A proven committed rename recovered with newer local edits adopts its new path
and saved baseline while preserving working text and an explicit external
conflict. Adoption failure retains the lease and committed fact for retry; it
cannot authorize an old-path autosave or another rename effect. A rename
reconciliation lease freezes both locations before awaiting its first native
proof query. If that query or a later outcome check fails before a receipt is
available, the original intent and visible Retry remain with the retained lease.
Retry joins active publication/cancellation work and any pending native admission
release, then only reconciles: committed proof adopts the canonical location,
confirmed non-publication releases the pause, and unavailable proof retains it.
A previously proven commit cannot be downgraded by a later proof failure.
Ordinary saved-buffer captures also retain the expected Note
Identity into Timeline admission: a delayed old-path save is rejected after that
identity has moved, including when another note has reoccupied the old path.
New drafts remain explicit creations, and Keep My Edits may restore a disappeared
note whose identity has not moved. A refreshed WebView
must bind a new native page generation rather than wait forever on a stale owner.
When a native session read/open supplies a Note Identity, an existing path hint
or warm catalog hint is accepted only if it still belongs to that identity.
Post-read validation rejects a replacement that races resolution. Missing
metadata may retain catalog ownership only at a location admitted by Note
Timeline's durable continuity evidence; an old filename reused after rename
cannot become the original document. Path-only reads keep their explicit path
semantics.
Ordinary save, external refresh and History Mode keep their existing owners.

Pi tasks own checkpoints and progression; native intent/receipt and NoteTimeline
proof establish external effects. An uncertain acknowledgement reconciles before
another write, and repeated recovery never blindly reapplies content. Revocation
blocks new effects without pretending a published effect was undone. Committed
warnings remain successful canonical outcomes and cannot authorize replay.
Their repair messages survive Pi task settlement and tool output, and remain
visible outside collapsed activity, including after Stop and reopening.
Agent updates replace the complete authored body and unmanaged frontmatter from
the reviewed candidate, including removing the final authored property. Managed
identity and lifecycle metadata remain native-owned; an update candidate containing
the reserved managed block is rejected before review.
Legacy editable proposal workflows and chat-to-note promotion are retired; the native
publication/conflict/proof requirements continue independently of that UI.

## Note naming

A blank editable title exposes a manual Generate title button, disabled until its
body has content. A click sends bounded current editor content
to the configured model through a tool-free Pi task; excluded saved notes remain
blocked by native attachment authority. Progress and retryable failure are visible.
Body edits, title input, navigation, teardown or editor blocking withdraw the
captured intent. Only a still-current result enters the ordinary title/save action;
typing a title always wins. Each input updates the shared document before any
pending save resumes; departure saves newer input before replacing the pane.
Departure retries recheck blank titles after pending saves; nonblank typed titles
remain authoritative. Ordinary save completion does not cancel a still-current
generation request.
Task source text remains in memory, and internal title
scopes never appear in human chat navigation. A blank title remains blank across
autosave, backgrounding and reopening. Native saving uses a unique filename bound
to Note Identity plus a managed marker; that filename never becomes a title or
visible note label. An explicit filesystem rename supplies an ordinary title.
Leaving the last editor of an untitled note, or navigating away from the workspace,
derives its title from the first eight words of the first nonempty body line,
capped at 80 Unicode characters. Empty, never-saved drafts create no file; saved
notes without body text use “Untitled note”. Typed/generated titles take precedence.
The ordinary save must settle before navigation; failure retains the note and
requested title for retry. Reopening the same note or an uncompleted picker does
not finalize its title. Background saving does not finalize titles. Naming never
removes an authored heading, even when it matches the filename; task/search line
locations include that heading in the editor body.
Explicit Pi renaming retains its separate grant, exact review and Note Timeline
publication boundary.

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
- Image file drops insert at the drop position through the same upload jobs,
  asset storage, shared undo and save paths; they never import binary bytes as text
  or replace an unrelated selected range. Failed drops retain the authored text.
- Slash-menu image picking uses the same import owner as paste. Its destination
  maps through unrelated edits and retires on overlap, replacement, read-only
  takeover or view disposal. Cancelling the chooser or a failed import retains
  authored command text; a successful import remains one shared Undo step.
- The desktop native image chooser filters to supported asset formats and revalidates
  selected extensions before returning bytes. Mobile and browser selection checks
  both extension and MIME compatibility; unsupported choices never reach storage.
- The viewer shares the existing transient owner. Closing returns focus, scroll
  and selection only to a still-live origin. Image-list changes, replacement and
  history/review takeover invalidate it. Gallery navigation includes offscreen
  images and never changes note layout.
- Embed delete/cut/undo do not delete asset files. Note history versions authored
  references and dimensions, rather than historical image bytes.
