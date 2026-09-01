---
status: accepted
---

# Limit chat history access to current content

Ordinary chat may use Note Timelines only as Current-Content Provenance and activity metadata for notes allowed by the existing vault policy. It cannot search, quote, or recall removed historical prose. This keeps historical noise and deleted content out of ordinary model context while still allowing chat to answer when current information was introduced or changed.

Historical content becomes available to chat only when the current user message explicitly requests a complete Version Restore. An app-owned current-turn grant enables that narrow read path, and chat may only produce a durable restore proposal for review; it never commits the restore. Partial historical recovery is deliberately unsupported, and ambiguous requests receive no grant.
