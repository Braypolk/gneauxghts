# 06 — Keep snapshot admission private to AppStore

Status: ready-for-agent
Progress: implemented; focused tests passed; frozen for coordinator integration verification. See ../ui-implementation.md and ../ui-metrics.json.
Owner: audit_ui_semantic
Design: ../ui-design.md (UI-B)

AppStore.loadSettingsView and stageVaultSelection own invoke, revision admission and shared snapshot writes. Private admission retains per-slice precedence and bootstrap/event behavior. Settings receives its diagnostics/current admitted vault and retains only feature-local editable-state admission. Move the view DTO to the existing owner without introducing a forwarding module. Tests enter named operations and event callbacks rather than public revision tokens.

Move complete backend/local map cache clearing to AtlasStore.clearCache, eliminating Settings invoke-then-invalidate ordering. Keep AppStore small: no forgotten/history/semantic editable action state moves into it. App-owned snapshot work may finish after Settings closes; no closed Settings view state revives.

Validation: existing bootstrap, stale-event/operation and Settings write/history races; E2E types; coordinator native staged-vault acceptance.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
