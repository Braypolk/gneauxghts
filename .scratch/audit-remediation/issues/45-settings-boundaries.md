# settings boundaries

Status: ready-for-agent
Progress: implemented; focused regressions pass, browser integration verification tracked in ../ui.md
Findings: UIX07 / AA14 frontend

Remove the one-off retry loader/router where they hide no policy; consolidate catalog as app-owned data with backend coordination, preserving existing values and custom/default model behavior.

Validation: focused frontend Vitest cases, Svelte/TypeScript diagnostics for touched modules; no full suite. Preserve prior patches and app ownership invariants.
