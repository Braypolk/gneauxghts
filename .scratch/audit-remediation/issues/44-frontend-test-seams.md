# frontend test seams

Status: ready-for-agent
Progress: implemented; focused regressions pass, browser integration verification tracked in ../ui.md
Findings: UIX03 / UIX04 / AA12 frontend / AA13

Extract typed Chat test builders/harness by behavior, replace ineffective privacy/style assertions and exercise user actions at a mounted narrow component seam if available.

Validation: focused frontend Vitest cases, Svelte/TypeScript diagnostics for touched modules; no full suite. Preserve prior patches and app ownership invariants.
