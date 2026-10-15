# Preserve faithful Save and existing-note addition semantics

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
