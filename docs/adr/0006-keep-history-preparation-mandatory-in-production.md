---
status: accepted
---

# Keep history preparation mandatory in production

The initial single-writer Note Timeline release keeps app-owned ordinary-note writes fail-closed when durable history preparation is unavailable. Controlled development failures demonstrate that preparation can reject a write without changing canonical Markdown, while failures after publication must return the committed result with a recoverable warning. Allowing an unversioned save would break the mandatory-history contract and make later reconstruction and Current-Content Provenance silently incomplete. The [release validation evidence](../architecture/note-timeline-release-validation.md) records the observations and their limits.

## Consequences

- A blocked save keeps the dirty draft in the editor. The person can retry, copy the draft elsewhere, or use Settings recovery. A process exit or crash before a blocked draft is copied or saved can still lose that draft; retention in memory is not durable draft backup.
- Unavailable, replaced, or corrupt history requires an explicit recovery or confirmed reset. Reset advances the history generation and establishes truthful Baseline Revisions from current Markdown; it does not recover deleted historical prose or silently bless an older store.
- After canonical publication, history-finalization or projection failure returns the authoritative committed result and warning. Recovery finalizes the prepared intent idempotently; callers must not replay the authored mutation.
- No emergency save-without-history option, capture-disable switch, or automatic reset is introduced. External edits remain outside app-owned write admission and are captured through observation/reconciliation.
- The evidence is deterministic fault injection and local scale testing, not production incident-rate data. Reopen this decision if field evidence shows persistent save blockage or unrecoverable draft loss despite actionable recovery. Any alternative must explicitly represent history gaps and preserve truthful provenance before it can replace this policy.

This decides availability policy, not release readiness: every unresolved correctness or performance gate in the validation report still blocks release.
