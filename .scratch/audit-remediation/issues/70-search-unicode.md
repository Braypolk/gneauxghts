# Original-text search coordinates

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: root

## Scope

UIX01. Map case-folded match offsets back to original UTF8 character boundaries; keep IPC scalar-coordinate convention. Verify case expansion, astral characters, combining marks, whitespace/clipping and line positions.

## Verification and acceptance

Regressions at build_search_preview/search_note boundary must panic or mismatch before repair and pass after.

## Outcome

Implementation and focused validation are recorded in [root report](../root.md). Independent review and integrated native validation remain in progress; discovered follow-ups have separate child issues.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
