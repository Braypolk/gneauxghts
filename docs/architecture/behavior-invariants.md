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
visible editor, it uses its retained note as context and as its route back to
editing. The note body, path, and selection sent with a message come from that
same resolved context.

Generic note navigation targets the nearest editor when one exists. Otherwise
it reuses the active retained-context pane and reveals its editor. Navigation
always completes the editor lifecycle before reporting synchronized content.

### Pane changes retain a usable document route

Changing an editor pane to chat retains its document as chat context and as the
return target. Changing it back restores that document. Any pane may close while
another remains, including in a chat-only workspace. After the active pane
closes, the pane to its right becomes active when present; otherwise the pane to
its left becomes active.

### History browsing leaves the workspace untouched

History Mode is a global overlay, not a pane. Entry flushes pending saves and
finalizes the inspected note's Editing Window; failure leaves the user in the
editor with an actionable error. The mounted workspace remains inert and keeps
pane membership, document state, editor resources, selection, and scroll. Exit
restores the captured pane and focus. History Mode never survives restart.

History pages and diffs are read-only. Revision labels and explicitly confirmed
history clearing do not mutate Markdown or workspace state. Forgotten notes
must be recovered before ordinary history access. Missing-note history remains
available only through recovery UI. Every history read waits for required
recovery and verification of its target; exhaustive vault diagnostics are a
separate explicit action. Results from an exited session cannot populate a later
session.

### Version Restore is complete, deliberate, and append-only

Version Restore requires a complete-replacement preview bound to the current
authored-content hash and explicit confirmation. A concurrent edit invalidates
the preview. The restore preserves managed identity and lifecycle metadata,
retains the selected authored payload exactly, appends a new restore revision,
and never removes intervening history. Every open editor for that document gets
one fresh shared undo root; selection and scroll remain pane-owned. Unopened
targets can be restored without creating or navigating a pane. Missing or
forgotten notes must first cross their recovery flow.

## Documents, tasks, and persistence

### External changes never overwrite dirty local work

Clean documents adopt external changes everywhere they are displayed. Dirty
documents retain both local and external states until the user resolves the
conflict, and navigation cannot orphan that conflict. Each distinct external
state is durably recorded before it is applied; retry and restart replay the
recorded observation rather than substituting newer disk bytes.

### Committed adoption belongs to the document boundary

Save, Version Restore, accepted proposal, clean external refresh, and transient
Forgotten-Note Recovery enter fixed-purpose document adoption methods. Callers
do not choose identity, baseline, warning, rekey, runtime-reset, or refresh
policy. Committed warnings are part of successful results and never authorize a
second write. Eligible edits made after an operation began remain newer than the
adopted baseline.

Every open document has one immutable, process-local handle. Save, rename, and
committed adoption may change durable identity and path but never replace the
document object, shared editor root, timer, save queue, or pane references.
Canonical identity/path lookup is vault-scoped and prevents duplicate opens.
If a committed result collides with another independently dirty document, both
remain open and later persistence is blocked; the completed write is not replayed.
A participant that becomes clean may close after its existing queue settles,
allowing the survivor to be reindexed without another canonical write.

### Task mutations respect dirty documents

A task mutation targeting a dirty open note changes the open document and then
uses ordinary persistence. It never writes behind the editor. Ambiguous duplicate
task text fails rather than guessing from stale positions.

### Save completion has one consistency boundary

A successful save means canonical Markdown, the required in-memory catalog, and
durable history capture agree. Durable history preparation precedes publication;
a preparation failure publishes nothing. Publication and finalization remain
inside one timeline-owned operation. Target verification happens before file
ownership and is rechecked under ownership, so one blocked note does not stall an
already-ready note.

Once canonical bytes exist, their returned identity and path are authoritative.
A later history or required-projection failure returns that committed result with
a warning and is recovered idempotently without replaying the write. Known write
failures abandon their intent. Uncertain post-publication work retains only the
evidence required for recovery. Authoritative Markdown and managed Note Identity
must match before history finalizes; caller fallback bytes are never history
truth.

Readiness is observational, never write permission. A requested note is verified
before use while unrelated histories and structural checks proceed in the
background. Later discovered corruption blocks new publications globally until
explicit reset. Retryable I/O and cancellation do not become corruption, and
stale verification results cannot bless or poison replaced history. See
[ADR 0006](../adr/0006-keep-history-preparation-mandatory-in-production.md) and
[ADR 0008](../adr/0008-verify-target-note-history-before-background-coverage.md).

### History lifecycle remains truthful

Managed metadata changes alone do not create revisions. Existing notes receive
one baseline without a Markdown write; its time states only when Gneauxghts first
retained it. Races, retries, and restart cannot duplicate that baseline.

Vault manifest, store metadata, and app-local observations must agree on vault,
format, generation, store instance, and clean-close continuity. Clean close stops
admission, cancels background verification, drains admitted work, settles durable
recovery, finalizes Editing Windows, checkpoints the WAL, and only then reports
portability. Failure never claims a portable close. Work stays bound to the vault
and generation in which it was admitted.

Clear, reset, and purge invalidate affected callbacks and retained evidence
atomically. Clear replaces readable history with a truthful current baseline;
purge removes the complete timeline without harming a different note that reused
the old path. Confirmed reset is the only operation allowed to replace an
unavailable or corrupt store, advances its generation, and never rewrites current
Markdown. Logical deletion is distinct from later bounded physical reclamation.

History errors cross the frontend as closed product states with stable recovery
guidance. Database paths, queries, and diagnostic causes remain backend-only.
Translating an error never starts another exhaustive scan.

### Note Identity follows the note

A managed note keeps its identity through empty content, rename, move, forgetting,
recovery, disappearance, and safe reattachment. Observation never repairs damaged
Markdown metadata; the next app-owned commit performs that repair atomically.
Identity at an unrelated path is a copy unless an operation correlated the move.
A copied identity receives a new globally unique identity before projections see
it. Revision and Lifecycle Event identities are opaque domain values, not database
row IDs.

### Self-save suppression is operation-aware

An app-owned write, move, or delete suppresses only its declared filesystem
outcome. Failed or mismatched operations cannot hide later external changes.

### Semantic search preserves the last usable result

A transient indexing failure keeps the last good result visible as stale.
Retries are bounded and cannot overwrite newer work. The UI distinguishes fresh,
stale, rebuilding, and degraded states and offers explicit retry.

### Editing Windows preserve explicit boundaries

Ordinary editor publications accumulate in a fixed, non-sliding five-minute
window; finalization retains one immutable net change. Pending windows are not
public revisions. Actions, lifecycle changes, explicit evidence requests, last
editor departure, History Mode, and clean close provide earlier boundaries.
Restart recovers and finalizes surviving work exactly once. The normative
ordering, time-evidence, and receipt rules are in the
[Editing Window contract](editing-window-contract.md) and the decision is in
[ADR 0007](../adr/0007-retain-editor-history-at-editing-window-boundaries.md).

## Chat

### Provenance explains only current authored content

Ordinary chat may receive activity metadata and provenance for current eligible
content, never removed historical prose. Evidence is derived from retained states
and revalidated against current bytes, eligibility, and generation at delivery.
Unprovable movement or retyping remains unknown. Temporal answers and revision
citations do not re-enter later model context as historical prose.

Revision Citation navigation binds directly to the cited Note and immutable
Revision Identity, returns bounded surrounding history without walking every
newer record, ignores obsolete requests, and restores the existing workspace.

### Interrupted runs preserve partial output

Completed assistant output remains visible after interruption. A retry creates a
new correlated run while retaining the interrupted message and durable lineage;
late events cannot resurrect a terminal run.

### Related context is explicit and repeatable

Related context is generated from explicit request inputs and stable scope rules.
Retrying does not silently widen access or include removed historical prose.

### Draft chats expose their complete configuration

A draft conversation presents the model, reasoning effort, web access, and
attachment capabilities that will be used when its first message creates the
durable conversation.

## Proposals

### One proposal review is editable

Only the active validated review can edit its preview or decision state. Review
state cannot silently rebind to another note or autosave unapproved content.

### Proposal recovery converges without duplicate writes

Accepting a proposal records enough evidence to recover durable proposal status
after publication. Recovery never reapplies an already committed note mutation.

### App-owned commits advance the open-document baseline

A committed proposal result is adopted through the document boundary. Later local
edits remain dirty; committed warnings remain visible; stale read-back enters the
ordinary conflict flow.

### Proposal arrival does not navigate

Receiving or updating a proposal never changes the active pane or note. Navigation
occurs only through an explicit user action.
