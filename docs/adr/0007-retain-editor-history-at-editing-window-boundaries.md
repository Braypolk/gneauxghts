---
status: accepted
---

# Retain editor history at Editing Window boundaries

Keep one-second debounced canonical autosave and durable preparation, but accumulate ordinary editor saves in a durable Editing Window of at most five minutes. Finalizing the window creates one immutable Note Revision of the net change; intermediate states inside it need not remain recoverable. This chooses useful retained states and bounded per-save bookkeeping over permanently recording every typing pause.

## Consequences

- A pending window is not a public Note Revision. Named Revisions and Revision Citations refer only to finalized immutable states; explicit naming, history inspection, or citation production may finalize a window early.
- Important actions and lifecycle boundaries remain distinct. Granular Editor
  history compatibility is deliberately unsupported. Only fresh schema 14 stores
  are admitted; existing stores require confirmed reset. No migration or
  trust-old-store path remains.
- Current-Content Provenance reports window intervals and retained transitions instead of claiming exact timing or retyping evidence for discarded intermediate states.
- This revises ADR 0002's immediate-per-commit finalization model and the granularity assumed by ADR 0006. Mandatory durable preparation, committed-result warnings, truthful recovery, and the no-bypass availability decision remain. ADR 0004's finalized identity and portability guarantees remain.
- The [Editing Window contract](../architecture/editing-window-contract.md)
  defines fixed deadlines, time evidence, receipt retirement, and boundary
  ordering.

Point evidence remains valid for creation, baseline, task, proposal, restore,
external revisions, and explicit Editor rename or move publications. Ordinary
Editor revisions require Editing Window evidence. Confirmed reset preserves
current Markdown and advances the generation; old labels, citations, and retained
prose are not migrated.

Unresolved recovery preparation is separate from completed receipts. Publication
tokens use their existing nonce as the compact private key but validate their
complete store, generation, note, deletion-epoch, and sequence scope at every
boundary. Exact retry outcomes remain durable, including a pending-window result
after sealing. Only the retained Revision interval survives sealing; point
operations continue reserving public Revision Identities before publication for
Version Restore.
