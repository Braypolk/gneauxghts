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

### Task mutations respect dirty documents

A task mutation targeting a dirty open note changes the open document and then
uses ordinary persistence. It never writes behind the editor. If duplicate
task text makes the intended task ambiguous, the mutation fails instead of
guessing from stale positions.

### Save completion has a consistency boundary

A successful save means canonical bytes and the required in-memory note
catalog are committed, and its distinct user-authored state has one durable
Note Revision. History intent is durably prepared before Markdown publication;
a preparation failure publishes nothing. Task reads provide read-your-write
consistency. Lexical and semantic indexing may finish later and cannot turn a
completed canonical save into failure.

If bytes were committed but a required projection degraded, the result carries
the authoritative identity and a warning; callers do not retry the mutation.
A history-finalization failure follows the same committed-warning rule and is
completed idempotently from its prepared intent and authoritative Markdown.
Managed metadata changes alone do not create Note Revisions.
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
