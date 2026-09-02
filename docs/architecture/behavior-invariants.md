# Behavior invariants

These are the non-obvious product outcomes that refactors must preserve. Tests
are the executable authority; this document explains the intent that should
guide new cases. Details not stated here remain open.

## Workspace and navigation

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

## Documents, tasks, and persistence

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

### Task mutations respect dirty documents

A task mutation targeting a dirty open note changes the open document and then
uses ordinary persistence. It never writes behind the editor. If duplicate
task text makes the intended task ambiguous, the mutation fails instead of
guessing from stale positions.

### Save completion has a consistency boundary

A successful save means canonical bytes and the required in-memory note
catalog are committed, and its distinct user-authored state has one durable
Note Revision. History intent is durably prepared before Markdown publication;
a preparation failure publishes nothing. An opaque intent identity correlates
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
retryable.
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
Clearing one Note Timeline atomically removes every previously readable record
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
Allocated and reclaimable byte totals remain distinct, and physical compaction
is separately budgeted across WAL checkpoint and incremental-vacuum work and
never chooses what history to retain. Allocated totals include the live SQLite
main file, WAL, and SHM sidecar; reclaimable totals include database freelist
pages and checkpoint net reduction that the store can prove are reclaimable.
The WAL autocheckpoint and retained-size limits keep normal persistent WAL
allocation within the background pass budget; larger live WALs remain reported
and are never truncated by a smaller pass.
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
deduplication window.

### Semantic search preserves the last usable result

A transient indexing failure keeps the last good result visible as stale.
Automatic retries are bounded and cannot overwrite newer queued work. The UI
distinguishes fresh, stale, rebuilding, and degraded states and offers an
explicit retry.

## Chat

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
