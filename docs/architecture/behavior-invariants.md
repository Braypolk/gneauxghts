# Behavior invariants

These are the non-obvious product outcomes that refactors must preserve. Tests
are the executable authority; this document explains the intent that should
guide new cases. Details not stated here remain open.

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

### Remember changes only the invoking pane

Remember persists one canonical document and rebinds only the invoking pane to
a fresh draft. Other panes displaying that document retain its saved identity
and content.

### Chat context and note navigation agree with visible content

A chat beside an editor follows the nearest editor's current note. Without a
visible editor, it uses its own retained note, which is also its route back to
editing. The note body, path, and selection sent with a message come from that
same resolved context.

Generic note navigation targets the nearest editor when one exists. Otherwise
it reuses the active retained-context pane and reveals its editor. Navigation
always passes through the editor lifecycle before content synchronization is
considered complete.

### Pane changes retain a usable document route

Changing an editor pane to chat retains its document as chat context and as the
return target. Changing it back restores that document. Any pane may close
while another remains, including in a chat-only workspace.

After the active pane closes, the pane immediately to its right becomes active
when present; otherwise the pane immediately to its left becomes active.

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
conflicts abandon their prepared intents immediately; recoverable pending
state is reserved for uncertain post-publication finalization.
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
explicit recovery. Only freshly created current-schema stores are supported;
older schemas and existing files without complete metadata are rejected before
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
code. Identity at an unrelated path is insufficient to
reattach a Missing Note unless the watcher correlated that path change as a
move or rename.

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

A transient indexing failure keeps the last good result visible as stale.
Automatic retries are bounded and cannot overwrite newer queued work. The UI
distinguishes fresh, stale, rebuilding, and degraded states and offers an
explicit retry.

Local search setup stays inside Settings. Its explicit setup action installs
any missing device-local runtime and model, starts the model, and schedules
indexing. Ordinary embedding requests never download executable code. Runtime
downloads are pinned and checksum-verified; extraction and executable startup
must succeed before the complete runtime directory becomes discoverable.
Interrupted setup remains retryable, and keyword search stays available.

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
answer. The app constructs durable destinations; unknown references are unavailable
and never resolved by title or fuzzy matching. Worker references are remapped on
parent admission. Unvalidated streaming markers remain inert.
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

Search, activity listing and research accept explicit half-open start/end ranges
as ISO dates or offset-bearing RFC3339 timestamps, with an optional named timezone.
Dates use local midnight and preserve DST; invalid, reversed, ambiguous or
nonexistent boundaries fail rather than being guessed. The agent interprets the
user's timeframe against the supplied run anchor. There are no named-period tool
enums, question parsers or semantic workflow dispatchers. Independent tool calls
may use different scopes or omit an activity filter; a child research invocation
must retain its inherited scope and range.

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
Current-passage citations validate stable identity, content hash and exact
current range before opening and highlighting the current note. Renames resolve
to the current location; stale or ambiguous passages are unavailable. Search
cursors bind scope and canonical versions, and read continuations preserve selected IDs and provenance positions without
requiring callers to reconstruct offsets. Retained-change citations validate the
exact revision, change kind, coordinates and text and open their content revision. Baseline known-since dates never imply creation or work.
Legacy Revision Citations retain exact Note and Revision Identity and open that revision
in global History Mode without navigating the invoking pane.
Citation navigation seeks bounded surrounding context directly, independent of
how many newer records exist. Newer/older context pages replace at most 31
rows while preserving the selected diff. Clear or restore may leave anchored
context but never transfer the target to the invoking pane's note. Obsolete
entry work stops at asynchronous boundaries, and failed-entry or exit workspace
restoration settles before a newer entry captures that workspace. Cleared, purged,
missing, forgotten, excluded, or no-longer-current citation evidence is withheld
when results or conversations are delivered, including branches. Explicit source
access uses the originating run grants with current exclusions. Earlier note-based
answers remain visible in their transcript but are omitted from later model
context and compaction; source-free dialogue is preserved. Chat must obtain fresh
current evidence. Automatic note context uses canonical bytes, never a pending
proposal snapshot. Revalidation before each model call and final delivery stops
an answer if admitted bytes or scoped search versions change.

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
Research may be invoked repeatedly within shared run budgets, with at most one
active worker. Each invocation has its own twelve-call and 90-second limits. Its
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

### Tool failures preserve safe recovery instructions

Recoverable application errors reach the model with actionable feedback through
the shared tool registration adapter. Error origins choose stable codes,
retryability and recovery actions; the adapter never classifies message wording.
Known budget exhaustion must not look like missing note access. Unknown
internal/provider diagnostics remain available to operators and are redacted
from model feedback. Activity summaries retain safe error feedback and count
delivered note identities; partial delivery must not appear as a complete read.

Read pages prepare and serialize their complete envelope before reserving the
shared evidence allowance or admitting citations. An undeliverable page consumes
no evidence allowance. A failed selection cannot discard independent deliverable
passages; per-item failures and bounded continuations preserve explicit gaps and
progress. Page-level meaning is shared rather than repeated for each small
passage. Ordinary reads default to compact proofs; expanded per-range lineage is opt-in and its requested/delivered coverage is explicit. Compact delivery preserves canonical validation, retained historical identity/timing and activitySupport. Canonical validation occurs during preparation and again at model/final
admission. Recorded proposals are not outstanding commitments merely because
completion evidence is absent.

### Interrupted runs preserve partial output

A crash or interruption keeps the partial assistant message, marks it
incomplete, and makes retry available after restart. Retry creates a traceable
continuation without erasing the interrupted output.

### Related context is explicit and repeatable

Related notes may be suggested but do not enter model context until selected.
At send time the backend resolves stable note identity, reapplies exclusion
policy, rereads canonical content, bounds the excerpt, and stores its hash for
that run. Global exclusion always wins.

Retry reuses the stored context rather than running retrieval again. Context
use and compaction are observable through provider-safe activity; raw model
reasoning and tool arguments are not exposed.

### Draft chats expose their complete configuration

Provider, model, reasoning effort, vault access, web, and attachment choices
are available before a conversation is persisted. The first send applies the
draft choices atomically. Settings supplies defaults for new chats; composer
choices affect only the current conversation or draft.

Provider and model remain separate choices, supported reasoning effort is
validated for the selected model, and a model cannot change during an active
response. Backend-resolved settings are the source of default model identity.

## Proposals

### One proposal review is editable

At most one proposal is editable globally. Other pending proposals remain
queued and durable, and unresolved proposals survive restart.

Navigating away from an unresolved review retains its working copy and hunk
choices for return. Pane and workspace save barriers do not persist or require
a clean baseline for that retained review. Ordinary edits in other documents
still flush, and external-change conflicts and canonical collisions still block
departure of a dirty document.

### Proposal recovery converges without duplicate writes

If proposal content was persisted but its status update failed, recovery first
verifies the target content or hash and then converges status to committed.
Repeated recovery is idempotent and never reapplies content blindly.

### App-owned commits advance the open-document baseline

After a verified proposal commit, an open document adopts the committed
Markdown as its saved baseline instead of treating the write as external.
Local edits made after commit began remain dirty. If disk no longer matches the
committed Markdown, ordinary external-conflict protection applies.

### Proposal arrival does not navigate

Receiving a proposal adds it to the pending queue without opening, activating,
focusing, or repurposing a pane. If its target is already open and clean, review
content may appear there without changing the active pane. Navigation begins
only when the user explicitly chooses to review the target in an editor.

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
baseline. Unknown usage or capacity retains existing limits. Near capacity,
pending tools are skipped and at most one final model request retains evidence,
citation identities and tool-call/result pairs with executable tools disabled and bounded
output. Recent user and source-free assistant messages are not individually
clipped to fit; existing recent-message and compaction rules still apply. The app
never drops history silently to make a request fit. Cancellation,
permissions, scope and final evidence-currentness checks remain authoritative.
An existing non-executable structured result formatter may remain callable on the
final request; no evidence retrieval or other application action remains callable.
