# Preserve faithful Save and existing-note addition semantics

> Historical specification/issue record; outside the executable backlog. Original triage/dependency lines are a historical snapshot. See [outcome](../outcome.md).

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 05, 06

Follow [the spec](../spec.md) and ADR 0011. Targeted Save currently stages a
replacement body rather than production append/heading behavior.

## Work

- Reuse/extract deterministic whole-answer and verified-selection promotion,
  including Markdown, recorded source associations, repeated occurrences and
  source links outside the highlight.
- Produce ordinary source wikilinks with valid block/paragraph fragments or
  note-level fallback, plus one durable Open in chat backlink under ADR 0011.
- Default to a new note; existing targets require explicit intent and Note Identity.
  Preserve append/heading placement and separable-addition conflict refresh.
- Store origin deduplication/exact selection with Pi review state. Repeat Save
  reopens the pending origin or committed note; another copy is a new explicit
  intent. Direct Save never dispatches a model.

## Acceptance

- Whole answers and source-bearing repeated-text selections transfer faithfully;
  generated passage labels/unavailable markers do not corrupt selection.
- Edited/historical fragments need unique surviving text or fall back to the note.
  Authored links/fragments survive without inserting source anchors.
- Existing-note Save adds at the requested location and preserves surrounding
  content; changed/ambiguous bases retain drafts and require reapproval.
- Duplicate Save/Keep, restart and publication interruption preserve origin,
  receipt and one effect. New-note Discard creates none; model request count is zero.
- Source links and Open in chat work after relaunch. Selection Save does not need
  standalone excerpt creation; usable origin navigation is required at 08 before
  full managed transcript work in 11.

## Starting points

`src-tauri/src/chat/note_proposals.rs`, Pi reviews/ChatApi, selection capture/
promotion contracts, ADR 0011 and native publication adapter.

## Comments


2026-10-15 implementation: extracted the retained deterministic Markdown, verified-selection, occurrence and insertion policy into `proposal_policy.rs`; ordinary source-link resolution is shared through the read-only `note_promotion.rs` leaf. Pi direct Save now reads its completed answer and recorded associations from Pi, stages a review with exact origin/selection metadata, and defaults to creation. Explicit Note Identity targets append or insert at a unique heading; separable additions refresh on the latest canonical base for another approval, while surrounding edits/ambiguous headings retain the original draft. The native adapter rejects a changed base during preview preparation.

`save.ts` normalizes durable origin keys, joins repeated/concurrent Save, reopens pending/committed origins, and uses explicit copy intents. Generated passage controls and unavailable markers are excluded from selected author Markdown; recorded associations recover valid source links beyond the highlight. Each promotion adds the reserved `Chats/Pi/pi-N/Origin#^msg_pi-assistant-M` backlink, resolved through Pi's existing conversation and chat-pane route without standalone excerpts or managed transcript files. Wikilink routing preserves the message anchor.

Validation: focused Vitest `save.test.ts` and `wikilinkInteractionController.test.ts` passed 10/10 (concurrent Save, repeated occurrence key, Harness restart with retained backing state, committed reopen, Discard/no publication, reserved origin routing). Shared Rust fixtures cover Unicode/repeated/structured selections, unavailable controls, authored links, edited/historical passage fallback, explicit block/paragraph links and separable additions. Native checks and normal-desktop acceptance remain with the root's exclusive native-build lease and ticket 08; this comment does not claim those passed.


Review hardening: fragment lookup now receives an explicitly authorized current Note Identity resolver. Pi checks current access, selected grants and global exclusions before consulting the note catalog; the retained default checks its conversation policy before unique disk lookup. Recorded source paths never authorize reads or select replacement notes. Canonicalized source paths must remain inside the running vault and the current ordinary-note identity must match; missing, duplicate or replaced identities fail explicitly. Edited/historical excerpts still fall back to note-level links when they are ambiguous within the verified same note. Additional Rust fixtures cover rename plus path replacement, stale catalog ownership, duplicate identity, revoked/excluded lookup rejection and outside-vault paths; native execution remains pending the root lease.

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

Deterministic whole-answer and verified-selection Save are integrated. Matrix **P** records whole Save/origin, explicit selection append and closed duplicates; **M** records normal Save → approved Keep → Open in chat through the persistent local-live app.

The final full Save/platform matrix remains open. **I** failed the normal Save editor-readiness race; wait/publication-proof corrections are prepared, with no corrected native pass yet. See the [current validation matrix](../../../pi-durable-chat-evaluation/validation-matrix.md) for exact scope and failure provenance.

### 2026-10-16 — Final acceptance reconciliation

Implementation is integrated and bounded acceptance is complete under the [root semantic acceptance](/private/tmp/pi-v51-root-final-acceptance-20261016.json). Retained P/M/L/I/E and current [v51 desktop](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-interactive-O7czrc/desktop-interactive-gate.json)/[v51 iOS](/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-BTSO9O/ios-interactive-gate.json) cover whole/selection Save, explicit additions, duplicate suppression, exact canonical read-backs and Open in chat. [final manual](/private/tmp/pi-v51-manual-acceptance-20261016.json) extends final persistent review/Keep and note/history retention.

Material limits: Some explicit append/recovery actions use the public API and normal review editor; that scope is recorded separately from ordinary UI actions. Final manual was not a new complete Save/citation cross-product.

The original triage/dependency lines above are historical; this record is outside the executable backlog. Default production adoption and migration remain deferred.

See [ticket 07 outcome](../outcome.md#ticket-07) for bounded acceptance and material limits.
