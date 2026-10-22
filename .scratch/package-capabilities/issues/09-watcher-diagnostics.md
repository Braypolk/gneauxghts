# Plan truthful watcher health diagnostics

Status: needs-triage
Type: task
Priority: optional, especially for Linux
Depends on: explicit health presentation/ownership design below

## Current behavior and scope

Notify 8.2 reports exhausted Linux watch capacity as `ErrorKind::MaxFilesWatch`. `vault_watcher.rs::collect_watch_result` logs callback errors; initial `RecommendedWatcher::new`/`watch` failures return early and `lib.rs` logs startup failure. The debounce and periodic reconciliation workers are created **after** successful registration in `start_vault_watcher`. Consequently a failed initial registration must not be described as “watching degraded but periodic reconciliation remains active.” [Notify release](https://github.com/notify-rs/notify/releases/tag/notify-8.2.0), current `vault_watcher.rs` and `lib.rs`.

## Proposed stages

1. Define the initial UI location and minimal native state: starting, watching, callback-degraded, unavailable; safe curated reason codes, no raw paths/log text. Decide whether health lives in the existing native lifecycle owner or AppState and how it joins the existing AppStore snapshot revision protocol. Do not create a second vault/service lifecycle or a Settings-only polling mirror.
2. Implement safe classification for startup and callback errors, bounded/deduplicated state updates and truthful presentation of whether reconciliation actually started. A successful reconciliation proves a scan succeeded, not that OS watches have recovered. Do not clear a watch-capacity warning merely because one scan succeeds.
3. Decide separately whether registration failure should still admit reconciliation, and whether/how explicit retry rebuilds watchers without duplicate threads. That is a lifecycle change, not a prerequisite for honest diagnostics. Read ARCHITECTURE.md and restart/bootstrap invariants before selecting that design.
4. After the owner/contract/UI are selected, specify types, bootstrap/listener admission, Settings presentation and focused tests, then change this issue to `ready-for-agent`.

## Acceptance

Use injected `MaxFilesWatch`/generic startup and callback failures, not host watch exhaustion or changing system limits. Confirm deduplication, no false recovery claims, late-bootstrap ordering and no stale event after Running Vault shutdown. Preserve canonical mutation routing, self-save filtering, external reconciliation and stop/join behavior. Native disposable-vault external-edit/restart acceptance is required if lifecycle code changes; Linux behavior must be simulated portably and verified on Linux before claiming platform acceptance.

## Parallelism

Native owner/bootstrap changes touch `lib.rs`, `commands.rs`, AppStore/types and native lifecycle; integrate after 01/04/05 if they share those paths. Classification research and tests can be drafted independently. This record plans that work; it does not introduce the new health state.

## Comments

The current gap needs a selected health owner/UI contract; no new diagnostics state or fallback reconciliation has been implemented.
