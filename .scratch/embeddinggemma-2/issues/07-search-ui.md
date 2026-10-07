# Image query and result UI

Status: ready-for-human
Updated: 2026-10-06
Blocked by: 06

## Scope

Extend shared SearchBar/SearchDock/store with bounded temporary choose/paste/drop, previews, clear/cancel, focus and lifecycle cleanup. Do not import or persist query bytes. Use the existing bounded thumbnail loader; opening a result rechecks note/asset identity and uses the current viewer occurrence. Expose text/image readiness, coverage, migration, capability failure and retry in Settings.

## Implementation state

Implemented temporary choose/paste/drop query controls, bounded previews, supersession/cancellation, keyboard navigation, current viewer validation, distinct readiness/capability/coverage/migration status, retry, and next-launch recovery Settings. Focused frontend and Chrome tests pass.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
