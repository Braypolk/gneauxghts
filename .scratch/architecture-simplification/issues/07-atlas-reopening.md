# 07 — Revalidate Atlas on every activation

Status: ready-for-agent
Progress: implemented; focused tests passed; frozen for coordinator integration verification. See ../ui-implementation.md and ../ui-metrics.json.
Owner: audit_ui_semantic
Design: ../ui-design.md (UI-C)

Retain the last response for rendering, mark it stale and always revalidate through backend on Map activation. Remove frontend cached-response freshness authority and redundant response-visibility bookkeeping. Preserve current one-in-flight/coalesced refresh, search invalidation, polling and obsolete lifetime guards. Stage-only Next-launch Vault Selection changes must not clear a Running Vault graph or selection.

Validation: completed cache/deactivate/offscreen change/reactivate; stale payload visible while delayed revalidation runs; old response rejection; existing search/polling/geometry suite. Backend generation compatibility remains authoritative; no frontend dependency cache or permanent background observer is added.


## Coordinator acceptance

Progress: Complete. Independent review findings closed; combined frontend/Rust/typechecks, all browser files, seven-file native smoke and actual process restart verified. See ../validation.md for exact counts, failed-run history and remaining test-environment uncertainty.
