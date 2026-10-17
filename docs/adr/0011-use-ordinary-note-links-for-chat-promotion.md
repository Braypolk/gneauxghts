---
status: superseded in part by ADR-0012
---

# Use ordinary note links when saving chat content

[ADR 0012](0012-found-ordinary-chat-on-pi.md) records the accepted new-user Pi
rebuild and its scoped supersessions. The implementation described below is
historical and retired from ordinary chat; it is not a current runtime requirement.


When chat content becomes a note, its note citations become ordinary wikilinks
to the source notes, maintained by the user. This chooses normal authored
Markdown over retaining chat-bound passage references or introducing an
independent evidence archive. Saved content also includes an unobtrusive link
back to its originating chat.

Preserve authored heading/block fragments. For chat passage citations, locate
the passage in the current source and emit its ordinary block link when a unique
explicit block ID exists, otherwise its paragraph link. Unchanged current
sources retain the recorded occurrence; edited or historical sources require a
unique surviving excerpt. Missing or ambiguous passages fall back to the source
note rather than assigning an unrelated position. No source anchors are inserted.

## Consequences

- Saved wikilinks navigate like other note links, including their position
  fragments. They do not promise a retained original supporting passage or
  revision, automatic freshness checking,
  or continued claim support after source edits. Users maintain them as usual.
- Source-note links work independently of the originating conversation. The chat
  backlink depends on that conversation remaining available, like any other link.
- Live chat keeps its existing evidence admission, access, freshness and exact
  passage-navigation rules under ADR 0009. This decision changes the promoted
  Markdown representation, not model citation authority.
- Promoting an answer transfers its selected content and source-note links; it
  does not silently copy source excerpts, historical proofs or the conversation
  into a second evidence store. Reintroducing exact historical references would
  be a separate design decision; ordinary wikilinks cannot reconstruct them.

Accepted 2026-10-14 in the confirmed
[chat-to-note design](../../.scratch/chat-to-note/spec.md).
