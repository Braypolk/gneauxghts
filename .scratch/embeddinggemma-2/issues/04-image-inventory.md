# Backend image inventory

Status: ready-for-human
Updated: 2026-10-06
Blocked by: None

## Scope

Derive complete-document wiki/Markdown/reference image occurrences with shared frontend/backend fixtures. Extract and retain the canonical asset resolver; reject traversal and symlink escapes. Persist stable Note Identity, current source hash, asset name and occurrence range. Reconcile asset byte replacements, renames, removal and recovery through reverse references and watcher/periodic handling without changing Markdown/history.

## Implementation state

Implemented complete-document image inventory with shared parser fixtures, canonical contained resolver, note/source/occurrence identity, reverse references, watcher and periodic asset reconciliation. Duplicate, replacement, stale/deleted, corrupt, and unsafe-path tests pass.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
