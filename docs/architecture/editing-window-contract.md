# Editing Window contract

Status: accepted and implemented. Tests are the executable authority. This file
records ordering and evidence semantics that are easy to violate while changing
the Note Timeline seam. The decision and trade-offs are in
[ADR 0007](../adr/0007-retain-editor-history-at-editing-window-boundaries.md).

## Retained model

Gneauxghts keeps one-second debounced canonical autosave but groups distinct
ordinary editor publications into a durable Editing Window lasting at most five
minutes. The first successful publication opens the window; later successful
publications replace its one pending endpoint without sliding the deadline.
Identical authored content and managed-metadata-only saves do neither.

Finalization atomically compares the latest endpoint with the preceding immutable
anchor. A changed endpoint creates one reconstructable Revision for the net
change and removes the pending window. Returning to the anchor removes the window
without inventing a Revision, label, citation, or retyping evidence. Pending
windows have private identities and never appear in navigation, naming, citations,
or public Revision counts.

Creation and baseline remain standalone point Revisions. Task actions, accepted
proposals, Version Restore, external observations, and explicit editor rename or
move publications remain distinct point boundaries.

## Publication admission and capture

Before Markdown publication, the timeline durably records an opaque operation
scope, source, expected identity and hashes, publication time, and either a point
Revision or a specific pending window and anchor. Recovery uses this exact choice;
it never guesses from current time, path, source, or matching bytes.

After publication, capture verifies authoritative disk bytes and managed Note
Identity against that preparation. The captured canonical head is the latest
successful authored state and may still be pending. The finalized head is the
immutable anchor. Self-observation, no-op detection, freshness, and restore
preconditions use the captured head; net-delta encoding uses the finalized head.

A preparation failure publishes nothing. A known publication failure abandons
its preparation. If publication succeeds but capture or a required projection
fails, callers receive the authoritative committed result with a warning and must
not replay the Markdown write.

## Deadline, restart, and ordering

The deadline is exactly 300,000 elapsed milliseconds from the first successful
publication's admission. Use a process-local continuous clock that includes
system suspension; persisted wall time is evidence, not a reusable monotonic
deadline. A save at 299,999 ms joins the old window. At 300,000 ms, the old window
must finalize before a new publication is admitted. A pre-deadline admission may
complete after the deadline; timer work waits for it through the existing mutation
owner.

Timer, publication, observation, lifecycle, and deletion work serialize through
the timeline mutation barrier. Callbacks carry store generation and window
identity so stale work cannot finalize replacement history. Wall-clock changes
never move the elapsed deadline.

After interruption, settle deletion and publication recovery first. Then verify
each surviving window's scope, anchor, identity, hash, eligibility, and canonical
continuity before finalizing it once. Newer external bytes are observed separately
after the recovered editor endpoint. Unresolved evidence remains retryable and
blocks conflicting admission. Successful startup recovery is not rerun against
live in-process work.

Earlier boundaries have the following ordering:

| Boundary | Required behavior |
| --- | --- |
| Last editor leaves a document | Flush the shared document, then finalize before departure. One of several editors leaving is not a boundary. |
| Enter History Mode | Flush workspace saves, then finalize the inspected note before delivering history. |
| Name current content | Flush, finalize, and name the resulting Revision; naming an existing Revision is metadata-only. |
| Explicit temporal evidence | Finalize only eligible selected notes required for immutable evidence, then revalidate bytes, scope, ordering, and cursors. Never save an editor buffer implicitly. |
| Action or external observation | Finalize preceding editor work before retaining the distinct task, proposal, restore, or observed state. |
| Lifecycle change | Finalize prior editor work before rename, move, forget, recovery, Missing, or reattachment state. |
| Clean close or vault switch | Stop admission, settle live work, finalize windows, finish recovery, and complete the WAL/portability barrier. |
| Clear, reset, or purge | Delete affected pending work with retained history and invalidate its callbacks; never append a window merely to delete it. |

App blur, focus, cursor changes, health polling, and routine chat loading are not
boundaries. There is no second idle timer.

## Time and provenance evidence

Point events retain their existing `committed`, `observed`, or `knownSince`
evidence. Finalized windows use versioned `editingWindow` evidence containing
first/last and minimum/maximum successful-publication wall times plus an explicit
clock-discontinuity flag. Finalization time is operational metadata, not authored
change time. Raw wall values remain unchanged even if the clock moves backward.

For an activity interval `[start, end)`, a normal window overlaps when its last
time is at or after `start` and its first time is before `end`. Point evidence
matches when `start <= time < end`. Clock-discontinuous windows are included
conservatively and marked uncertain. Counts represent retained transitions, not
saves or keystrokes.

Provenance compares retained anchors and endpoints. Unchanged ranges retain prior
evidence; changed ranges receive the window interval. Edits that disappear within
one window are unknowable. Citations use only finalized immutable identities and
are revalidated against current eligibility, canonical bytes, and mutation
generation at delivery.

## Receipts and store boundary

Publication tokens are opaque and scoped to store instance, generation, Note
Identity, deletion epoch, sequence, and a random nonce. Every operation validates
the complete scope before the nonce can select its private receipt. A nonce from
another scope never authorizes work.

Only unresolved preparations retain authored bytes, paths, source, publication
time, reserved point identities, and window disposition. Capture or abandonment
records the exact outcome and removes preparation-only fields atomically. Live,
pending, Revision-, Lifecycle-, and restore-referenced receipts remain protected.
A window endpoint references one receipt rather than every save.

Each note retains at most the newest 64 otherwise-unreferenced terminal retry
receipts. A durable retired-through watermark makes an absent old token stale;
an absent newer token is unknown. Neither state may infer success, replay Markdown,
or create history. Clear, reset, and purge remove affected receipts with history
and invalidate their scopes transactionally.

Only freshly created schema 14 stores are supported. Older, newer, or incomplete
stores fail before schema writes. There is no migration, trust-old-store command,
or dual writer. Confirmed Settings reset advances the generation and rebuilds
current Markdown as truthful baselines without rewriting files or migrating old
history, labels, or citations.
