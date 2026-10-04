# Architecture guards by actual boundaries

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: root

## Scope

H1/2, CC01/02, FD09, BT12. Preserve useful forbidden ownership guards; replace fragile whitespace/source tokens with parsed production syntax where warranted. No new heavy scanner dependency; TS compiler already installed.

## Verification and acceptance

Intentional forbidden access fails; formatting/comments/test-only tokens cannot spoof ownership; pure module extraction remains legal. Retain ordinary typecheck.

## Outcome

Implementation and focused validation are recorded in [root report](../root.md). Independent review and integrated native validation remain in progress; discovered follow-ups have separate child issues.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
