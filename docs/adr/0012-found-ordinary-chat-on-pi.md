---
status: accepted
---

# Found ordinary chat on Pi

For the new-user ordinary-chat rebuild, Pi Durable/Pi AI/Chord own conversations,
immutable history, submissions, generation/tools, scheduling, queueing, progress,
usage, recovery and standard compaction. Gneauxghts keeps presentation, native
storage/transport/credentials, vault authority, source admission and canonical
NoteTimeline publication. This accepts Pi's model and history semantics to remove
a competing application lifecycle; preserving the old ChatApi/controller/event
contract would retain the complexity this rebuild is intended to remove.

Accepted 2026-10-16 under the [rebuild spec](../../.scratch/archive/pi-chat-rebuild-scope.md).
The shared ordinary-chat composition is implemented and is the default. All ten
rebuild tickets, retirement checks, desktop acceptance and iOS simulator acceptance
are complete within the agreed scope. Evidence and remaining limits are in the
[completed rebuild outcome](../../.scratch/archive/pi-chat-rebuild.md).

## Ownership and native execution

One native domain owner persists scoped authority and exact accepted-effect
proof. Pi stores opaque authority/intent/receipt references and owns task
progression. Native commands derive current policy from those records; model
arguments, remembered context and caller-supplied grant flags cannot authorize
execution. Pi documents are suitable for title/presentation and future editable
review working state. Native security must not interpret WebView document
snapshots as trusted policy or maintain a second grant copy.

Read mode is Full vault or Attached notes only, with exclusions winning. A
restriction retires affected in-flight authority and ends the old context; start
a fresh conversation instead of redacting history. Old history may remain human
visible. Write authority is independent: Off, conversation-scoped Temporary
(durable across reopen, never inherited, revoked/deleted expires), or scoped
Running Vault Always. Review is independent and default-on; direct writes require
explicit valid authority and disabled review. Initial model tools are read-only;
synthetic create/update prove the native path without shipping mutation UI.

NoteTimeline still owns canonical note bytes/identity/history coordination, required
preparation, committed-warning outcomes and publication recovery. Pi does not
make uncertain external writes exactly-once. A Pi recovery task first reconciles
native intent/receipt and NoteTimeline proof; revocation blocks new effects without
undoing a published effect. Changed canonical content or dirty editor state blocks
conflicting writes. No generic filesystem executor is introduced.

## History and citation changes

Use normal Pi history/reasoning retention and compaction; earlier note/tool content
may remain working memory. A summary is neither a new read nor permission. A
current-state claim needs another authorized read. Citation IDs bind to a note
and the actual native read state; later edits do not invalidate an honestly
historical source. Do not manufacture an immutable Note Revision for an unfinished
Editing Window. Source links display note titles and open current notes; revision
and hash receipts remain internal read evidence. Optional exact unique quotes
checked by native reads identify passage locations. Navigation rechecks permission
and identity, warns on changed content, and selects only an exact unique match in
the current editor. An unavailable passage opens the note without substituting a
stale location. Semantic entailment checks remain deferred.
Invented/foreign IDs are rejected by mandatory native
admission before a terminal provider message becomes authoritative.

The initial revision-first navigation was amended after desktop acceptance on
2026-10-16: the user requested note citations and optional locations within notes,
instead of opening Note Revisions. Historical read proof is retained independently
of this presentation and navigation choice.

Pi 1.3.0's generation hooks can report/drop exceptions, and its built-in compaction
calls Models directly using the same ProviderDoc session identity. Mandatory
native provider checks therefore apply to every dispatch, including recovery and
compaction, without one-shot generation admission or custom summary machinery.
Minimal structured citation-token validation applies uniformly; an answer-only
formatter cannot be imposed on standard compaction. The current module homes and ownership boundaries are in
[ARCHITECTURE.md](../../ARCHITECTURE.md#agent-runtime).

## Supersession and retained decisions

- Supersedes ADR 0001's app-owned generic runtime, fixed frontend/event model and
  lifecycle/context ownership. Native authorization and product policy remain
  application responsibilities.
- Supersedes ADR 0003's prior-prose/context exclusion and mandatory proposal-only
  future writes; no general History Mode administration or restore capability is
  granted. Future Version Restore needs its own typed authority and decision.
- Supersedes ADR 0009's omission of note-based answers/tool data from later model
  replay/compaction and mandatory current-byte/exact-passage live citation rules.
  Its unused scoped historical-read, activity and Current-Content Provenance
  capabilities are removed, along with their dedicated tests. Historical activity
  still cannot prove current task status, and earlier assistant prose is not
  primary note evidence.
- ADR 0011 still describes ordinary links if explicit chat-to-note promotion is
  reintroduced. Promotion/transcript publication are dropped here; its assertion
  about unchanged live-chat exact-passage rules is superseded by this decision.
- ADRs 0002, 0004–0008 and 0010 retain their native NoteTimeline, identity,
  preparation, Editing Window, rollback, verification and geography ownership.
  Agent writes cannot bypass them. ADR 0007's pending-window/public-revision
  distinction expressly applies to citation read bindings.

No migration, exact Retry, managed transcript/import, research/plans, implicit
editor context, non-note attachments, old ChatApi compatibility or permanent
fallback runtime is required. Desktop establishes behavior first; iOS acceptance
for this rebuild is simulator-only, with physical-device work deferred. Resource
measurements are diagnostics, not permanent numerical architectural budgets.

Amended 2026-10-17: remove the unused activity/provenance APIs and their supporting
implementation instead of retaining speculative capabilities behind dead-code
exceptions. Pi's current search/read tools have no consumer for them. Current
canonical reads, their revision/hash evidence, History Mode and Version Restore
remain supported. This narrows the capability surface described in ADRs 0002,
0007 and 0008; it does not change retained revisions, Editing Window capture,
restore lineage or mandatory history verification. A future historical-read or
provenance feature needs a concrete caller and its own scoped contract and tests.
