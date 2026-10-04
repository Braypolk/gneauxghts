# app listener lifetime

Status: ready-for-agent
Progress: implemented; focused regressions pass, browser integration verification tracked in ../ui.md
Findings: ED10 / AA08

Repair attempt-owned AppStore listener acquisition, immediate retirement cleanup, joinable bootstrap and complete typed payload fixtures. Validate partial/all acquisition plus payload/listener failure and reentry.

Validation: focused frontend Vitest cases, Svelte/TypeScript diagnostics for touched modules; no full suite. Preserve prior patches and app ownership invariants.
