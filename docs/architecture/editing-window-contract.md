# Editing Window capture contract

Accepted by [ADR 0007](../adr/0007-retain-editor-history-at-editing-window-boundaries.md).
The implementation spans storage, coordination, evidence, and UI. The integrated
default uses window capture. This contract
supersedes the original per-editor-save retention and new-history Editing
Session requirements, and the current format rejects old-store compatibility.

## Publication and retained state

The one-second debounced Markdown autosave remains. Every app-owned publication
requires durable preparation before any Markdown write. Preparation binds the
opaque publication token to Note Identity, store instance/generation, exact
intended authored bytes/hash, source, and capture disposition. A disposition is
a distinct action revision or a particular private Editing Window and its
finalized anchor. Immediately before publication, while holding the existing
mutation owner, persist the app-issued publication timestamp and boundary
choice. Recovery uses that choice; it never guesses a window from current time,
path, source, or matching bytes. Admission at or after an old window's deadline
must finalize the old window before preparing the next publication; failure
blocks the new write. The timestamp is issued at this publication admission
point, not on eventual I/O completion. A pre-deadline admitted write may complete
after the deadline; the timer waits for it under the same mutation owner.

A successful publication is captured only after verifying authoritative disk
bytes and managed Note Identity against its exact prepared intent. Its captured
canonical head is the latest successful authored state, possibly pending. Its
finalized revision head is the immutable anchor preceding the window. Compare
self-observations, unchanged saves, current-content eligibility, and restore
preconditions against the captured canonical head. Encode the eventual net delta
against the finalized anchor, never an overwritten intermediate canonical state.
These heads may differ without indicating an external change or corrupt history.

The first distinct ordinary Editor publication opens a window. Later distinct
successful Editor publications replace its one compressed authored state;
identical authored saves and managed-metadata-only saves neither open a window
nor extend its timing evidence. Creation and initial/baseline states remain
separate revisions. Finalization atomically appends one reconstructable immutable
revision, if the endpoint differs from the anchor, and removes the pending
window. A → B → C → D retains A → D; A → B → A removes the pending window with no
revision, label, citation, or invented retyping evidence. Failure leaves the
window retryable; retry cannot duplicate a revision. Pending identity is private,
not a Revision Identity, and never appears in navigation, names, citations, or
public revision counts. Canonical publication followed by capture/projection
failure returns committed bytes plus a warning; never retry the Markdown write.

## Fixed deadline and ordering

A window expires 300,000 elapsed milliseconds after its first distinct successful
publication's admission timestamp; later saves never slide the deadline. Use a
continuous elapsed clock that includes system suspension, not wall time or a
platform timer that pauses during sleep. Its origin is process-local. Persist
first publication wall time and duration for evidence and recovery diagnostics;
do not persist a monotonic counter as a reusable cross-process deadline.

Check expiry before admitting each publication as well as on timer/resume work.
At 299,999 ms the save joins the old window; at 300,000 ms it belongs to a new
window after old finalization. A delayed timer finalizes only the latest admitted
successful capture, not unsaved editor text. Suspension that spans the deadline
finalizes on resume before another publication is admitted. Wall-clock jumps
cannot prolong or prematurely expire the window. Serialize timer, publication,
observation, clear, and lifecycle work through the existing mutation barrier;
a callback also carries store generation and window identity so old work cannot
finalize a replacement window or recreate deleted history.

After interruption, finish deletion recovery and prepared-publication recovery
in their existing order, then verify each surviving window's anchor, hash, Note
Identity, eligibility, and canonical continuity before finalizing it once, even
if five minutes have not elapsed. If newer external bytes are present, preserve
the recovered successful editor endpoint first and observe the external state
separately; never overwrite either with current disk bytes. Unresolved publication
or continuity evidence stays retryable and blocks admission. Never reopen a
surviving window with a guessed deadline; new work starts a new window. Health
polling must not repeat successful startup recovery or close live windows.

| Earlier boundary | Required ordering and scope |
| --- | --- |
| Last editor pane leaves a note | Flush that shared document, then finalize it before departure. Leaving one of several editor panes does not finalize; chat references are not editing panes. |
| Enter History Mode | Flush workspace saves, then finalize the inspected note’s eligible pending window before delivering history. A failed save/finalization refuses entry. |
| Name current content | Flush the target note, finalize, and name the resulting revision (the anchor for a net no-op). Naming an existing immutable revision is metadata-only and does not finalize unrelated work. |
| Explicit provenance/citation or temporal activity request | Finalize only eligible notes selected for immutable evidence, after pending publication recovery. Cite canonical saved content; this does not silently save unsaved editor buffers. Temporal activity requests first select bounded candidate notes and finalize only windows required for their evidence; revalidate ordering, cursors, overlap, bytes, eligibility, and generations afterward. Ordinary chat initialization and background conversation loading do not finalize. |
| Task Action, Accepted Chat Proposal, Version Restore, external observation | Finalize preceding editor work before the distinct action/observation. Preserve source even when a task action passes through a dirty document's save route. Unchanged action bytes do not invent a revision. |
| Rename/move, forget/recovery, Missing/reattachment | Finalize prior editor work before the separate Lifecycle Event or eligibility change; preserve existing missing/external observation evidence ordering. |
| Clean close / vault switch | Stop admission, settle live publications, finalize windows, complete deletion/recovery and the existing WAL/portability barrier. Failure never reports a portable close. |
| Clear/reset/purge | Atomically delete affected pending work with retained history and invalidate its tokens/callbacks. Do not append a window just to delete it. Keep existing active-note scope and fresh-baseline rules. |

App blur, focus/cursor changes, health polling, and routine chat loading are not
boundaries. There is no second idle timer. An ordinary save failure does not
replace the successful endpoint. A boundary finalization failure prevents its
dependent action; a timer failure keeps the window pending and retryable.

## Versioned time evidence

Keep action, creation, baseline, and observation point evidence (`committed`, `observed`, `knownSince`) intact. Add a
versioned `editingWindow` variant with evidence version 1, first and last
successful publication admission wall timestamps, minimum and maximum successful
publication wall timestamps, and a `clockDiscontinuity` flag. Finalization time
is operational metadata, never introduction/change time. Duration is at most
five minutes of elapsed admission time, even when wall evidence spans more or
less time. Preserve raw first/last values if the wall clock moves backward;
never silently reorder them or infer exact timing from the finalization clock.
Detect a wall/continuous-clock offset change during capture/resume and mark the
window uncertain. For ordinary windows, current changed ranges have interval
evidence from first through last successful publication, inclusive. This may be
a point for one publication but does not imply knowledge of keystroke timing.

For activity query [start, end), an ordinary window overlaps iff its last time
is >= start and first time is < end; point revisions match start <= time < end.
Reject empty/reversed queries. Count each matching finalized revision once,
regardless of how many intervals/ranges match. Counts mean retained transitions,
not saves, keystrokes, or all edits. Pending windows are not revisions. For a
clock-discontinuous window, include it conservatively in time-filtered activity
with an explicit uncertain-time indication rather than assert exclusion using
misleading wall bounds; consumers cannot treat it as proven to occur in the
query interval. The min/max timestamps support display, not false certainty.

Provenance compares retained anchor and endpoint. Unchanged ranges retain earlier
evidence; changed ranges carry the window interval. A deletion and retyping
wholly within one window is unobservable when the endpoint is unchanged. Only
transitions supported by retained states can establish a new introduction;
discarded granular history is not imported. Restores keep their
selected finalized identity and point return evidence. Citations contain only
finalized immutable identities and versioned point/interval evidence, revalidated
against current eligibility, canonical bytes, and mutation generation at delivery.

## Bounded publication receipts

Before retiring terminal metadata, issue opaque tokens scoped to store instance,
generation, and note deletion epoch, with a private monotonically issued sequence.
Keep full payloads for unresolved preparations; retire terminal payloads at
capture completion as today. Keep terminal receipts while any live operation,
pending window, finalized revision, or restore reference needs them. A pending
window references only the receipt needed for its latest successful endpoint;
replacement releases the previous reference. A window revision references its
retained endpoint receipt, never all autosaves. Thus metadata grows with live/pending/referenced work and retained history,
not the number of saves inside a window.

Bound unreferenced terminal retry receipts to the newest 64 per note. Atomically
advance a durable per-note retired-through sequence watermark and remove older
unreferenced terminal rows. Protected receipts may remain as explicit exceptions
below the watermark; inspect retained receipts first. This watermark is distinct
from history generation and the clean-close portability watermark. A missing
token at/below it is `stale` and cannot prove whether its former operation
succeeded; a missing token above it is invalid/unknown. A retained finalized token
returns its exact original capture outcome without appending again; a retained
abandoned token remains abandoned; an unresolved token recovers only its own
prepared evidence. Wrong store/generation/deletion epoch is stale regardless of
sequence. No stale or unknown token can prepare a fresh operation, replay Markdown,
recreate history, or infer success from coincidentally matching current bytes.
Private durable references use the token's existing random nonce. The complete
boundary token must match store metadata plus the receipt's note, deletion epoch,
and sequence before its nonce can authorize any operation, including release,
reserved Revision Identity lookup, or Version Restore lineage attachment.
A known nonce with another sequence or note never authorizes the real receipt.

Only unresolved preparations retain authored bytes, target paths, source,
publication time, reserved point identities, and any pending window disposition.
Receipts retain exact terminal status/outcome and scope/liveness. Capture or
abandonment updates the receipt and removes preparation fields atomically.
PendingWindow outcomes remain unchanged after sealing; retained interval evidence
lives only in `revision_window_evidence`, independently of deleted preparations.
Point operations reserve real Revision Identities before publication; private
window preparation uses an explicit disposition without a synthetic revision.

Recovery requires durable unresolved records, not a retired receipt. Receipt
retirement and window finalization must preserve references transactionally;
clear/reset/purge remove affected receipts and invalidate old scopes together.

## Cross-module integration coverage

Producers and consumers share these regression fixtures:

- History-store current-schema/export and incompatible-store rejection fixtures, terminal receipt
  retry tests, pending recovery, anchor reconstruction, and integrity attestation.
- `note_timeline.rs` mutation conformance and warning tests;
  `note_timeline/runtime.rs` barrier/generation tests; document save/departure,
  multi-pane navigation, History Mode entry, naming-current, close/switch,
  observation/reconciliation, task-dirty-document attribution, and deletion tests.
- `RevisionTimeEvidence`, History Mode time DTOs, current-content
  evidence and activity filtering, chat citation persistence/delivery, shared
  `src/lib/contracts/timelineContractFixtures.test.ts` (versioned point and interval evidence), `ipcFixtures.test.ts`, and their Rust/JSON fixtures. Add interval,
  clock-discontinuous, no-op, mixed action/window, stale-citation and count cases.
- `historyTimeline.test.ts`, `HistoryEditingSession.svelte.test.ts`,
  History Mode/session/component fixtures: new windows are one selectable entry
  and combined diff; point revisions and lifecycle events remain standalone.
- Release coverage uses a current-schema window fixture with 300 saves/window and twelve
  windows, bounded receipts, byte/WAL/I/O/latency/cold-recovery measurements.
  Passing policy tests alone does not prove persistence, storage reduction, or
  native responsiveness; final release acceptance requires the available native gates.

## Supported store boundary

Only freshly created schema 14 stores are supported. Existing schema 13 and all
older stores, future schemas, and files without complete metadata fail before
schema writes. No migration, old-store trust command, or per-save Editor policy
switch remains. Settings offers the existing confirmed history reset: it advances
the generation and rebuilds exact current Markdown as Baseline Revisions without
rewriting the files. Historical prose, names, and citations are not migrated.
No automatic deletion or reset occurs.

Every ordinary Editor revision requires retained Editing Window evidence. A
point Editor revision is valid only when its immediate same-note predecessor is
the correlated creation or rename/move event at that publication time. Rename
with changed content settles the prior window and retains its explicit action
boundary. External observations and other actions remain standalone point rows.
History Mode has no Editing Session grouping or Individual revisions view.
Missing citation time evidence cannot validate against current revision evidence.

Historical reports remain immutable evidence of the builds they measured. Current
fixture tooling creates only the current window policy and rejects old fixture
schemas/kinds instead of converting or relabeling them.
