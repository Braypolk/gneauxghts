# Clarify context scope and repeated delivery

Status: ready-for-agent
Type: task
Resolution: implemented

Linked-note prefixes are clipped without an explicit clipping notice. Answer reads use identical generic coverage wording for selected passages and direct note reads. Search delivery completeness and retrieval exhaustiveness are distinct, but neither establishes how much of the user's named note has been read. Follow-up searches can return already-read text under the same ID or a different overlapping range ID.

Design compact model-facing context metadata that exposes what was selected, whether the note/excerpt is complete, safe continuation and already-delivered overlap. Keep discovery previews distinct from citable reads. Preserve truthful hybrid-search limitations and canonical version/range validation; repeated results must not become unread authoritative claims or hide meaningful changes. Avoid a question parser, implicit open-note scope lock, or a fixed search-count cutoff.

Decide whether short linked-note body inclusion is worth its saved round trip before replacing all links with identity-only hints. Include selection-only questions and long linked notes in evaluation. Measure complete request cost, not just source text or schema bytes.

Evidence: [audit](../audit.md), starting case `long_linked_note`, `passageRead`, `directNoteRead`, `repeatRead`, `sameReadTextPreviews` in [trace](../offline-trace.json).

## Implementation scope

Keep compact metadata in existing result envelopes and explicit context, owned by EvidenceSession and the existing context helpers. Direct answer reads identify canonical-note scope and completeness across their continuation chain; evidence-ID/research reads identify selected-passage scope. Search delivery identifies previews and its coverage describes retrieval only. Linked body context and explicit selections disclose their own completeness and canonical-read recovery when clipped.

Track actual delivered text separately from freshness-admitted discovery candidates. Report `alreadyRead` as `none`, `partial`, or `full` from exact same-note/version/location range overlap, with historical proof separation. Apply it to discovery and read items; independent workers begin with no delivered text, and parent delivery records only returned evidence. Keep all content/citations available and revalidate normally; do not suppress reads or claim provenance was already delivered from text overlap alone. Explicit canonical body context counts only its unambiguous delivered range; working-copy proposal reads and editor selections/hints grant no answer reuse.

Retain short linked excerpts until measured live comparisons justify changing that policy. Evaluate complete assembled requests offline for selected text, short/long links and repeated overlapping discovery/read paths. This phase establishes behavior and metadata cost, not reduced live tokens or model stopping behavior.

## Comments

2026-10-09: Proceeding from the user's accepted direction. No additional product input required; preserve existing access, canonical validation, citations, proposal coverage and shared budgets. Paid/live trace collection remains issue 04.

2026-10-09: Implemented explicit read/search/context coverage and actual-delivery overlap tracking. Short links retained; clipping has canonical recovery. Independent reviews found no actionable issues. Offline complete-request comparison measures modest metadata overhead under identical scripted choices, not live savings. See [implementation, measurements and verification](../coverage-and-reuse.md).
