# Async store lifetimes and stale-result admission

Status: ready-for-agent

## Audit sources

reports/editor-and-discovery.md ED-02/03; reports/ui-settings-and-indexing.md UIX-02/06/14

## Problem and intended result

Chat listener partial failure/retry, Settings and Atlas disposal during initialization, TaskListStore late bootstrap, and search/related debounce invalidation leave obsolete work authoritative. Keep each existing owner and use a common testing pattern, not a shared global state machine.

## Acceptance and replacement coverage

Use a multi-subscriber event fake and deferred promises; prove failure then retry attaches once; dispose before and after partial attachment; reverse response order for view/filter/setting/history changes; obsolete success and errors do not mutate new state. A committed mutation must never be retried merely because its UI projection is stale.

## Constraints and handoff

Separate small changes per owner. AppStore bootstrap disposal must also cover already-completed listeners with a pending payload; see root review.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
