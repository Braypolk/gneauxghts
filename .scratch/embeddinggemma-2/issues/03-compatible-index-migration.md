# Compatible staging migration

Status: ready-for-human
Updated: 2026-10-06
Blocked by: 02

## Scope

Add representation/source-aware reuse and resumable staging generations, including ChatService remembered passages. Regenerate chunk/note ANN, text aggregates, edges, Atlas publication and naming caches. Synchronize coherent activation, revalidate intervening mutations, and preserve Jina durable generations/model files for rollback.

## Implementation state

Implemented representation-separated resumable staging, current ordinary-note/startup recall reconciliation, generation read leases, NoteTimeline source admission, bounded publication retries, and next-launch retained Jina recovery. The real native migration/recovery smoke and deterministic interruption/source/read-admission tests provide validation.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
