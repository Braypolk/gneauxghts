---
status: accepted
---

# Retain editor history at Editing Window boundaries

Keep one-second debounced canonical autosave and durable preparation, but accumulate ordinary editor saves in a durable Editing Window of at most five minutes. Finalizing the window creates one immutable Note Revision of the net change; intermediate states inside it need not remain recoverable. This chooses useful retained states and bounded per-save bookkeeping over permanently recording every typing pause.

## Consequences

- A pending window is not a public Note Revision. Named Revisions and Revision Citations refer only to finalized immutable states; explicit naming, history inspection, or citation production may finalize a window early.
- Important actions and lifecycle boundaries remain distinct. Granular Editor history compatibility is deliberately dropped. Fresh-only admission uses schema 14; existing stores require a confirmed reset that rebuilds current Markdown as truthful baselines. No migration or trust-old-store path remains.
- Current-Content Provenance reports window intervals and retained transitions instead of claiming exact timing or retyping evidence for discarded intermediate states.
- This revises ADR 0002's immediate-per-commit finalization model and the granularity assumed by ADR 0006. Mandatory durable preparation, committed-result warnings, truthful recovery, and the no-bypass availability decision remain. ADR 0004's finalized identity and portability guarantees remain.
- Adopted 2026-09-05. The [capture contract](../architecture/editing-window-contract.md) defines fixed deadlines, time evidence, receipt retirement, and boundary ordering. The integrated default provides capture, read, lifecycle, and evidence behavior.

The current format (2026-09-05) supersedes the earlier compatibility promise. Point evidence remains valid for creation, baseline, task/proposal/restore/external revisions and explicit Editor rename/move publications. Ordinary Editor revisions require Editing Window evidence. A relabeled old store cannot bypass this validation. The reset preserves current Markdown and advances the generation; old labels, citations, and retained prose are not migrated.

The compact receipt design (2026-09-06) separates unresolved recovery preparation from completed
receipts and uses each publication token's existing nonce as its private durable
key. This avoids repeating full scope tokens and retaining completed preparation
copies; it deliberately requires full token validation at every publication
boundary. Exact retry outcomes remain durable, including PendingWindow after
sealing. Only the retained revision interval survives sealing, while point
operations continue reserving public Revision Identities before publication for
Version Restore. Schema 13 is rejected before writes; no migration, automatic
reset, or identity translation is introduced. Historical schema-13 measurements
remain evidence of their original build; new large-scale acceptance follows the
storage and startup implementation.
