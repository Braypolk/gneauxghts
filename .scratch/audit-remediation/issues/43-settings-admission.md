# settings admission

Status: ready-for-agent
Progress: implemented; focused regressions pass, browser integration verification tracked in ../ui.md
Findings: AA08 / UIX05 / UIX06

Use real AppStore in Settings tests. Correlate view lifetime, history health and semantic writes; prevent late reattachment and stale overwrites without duplicating shared ownership.

Validation: focused frontend Vitest cases, Svelte/TypeScript diagnostics for touched modules; no full suite. Preserve prior patches and app ownership invariants.
