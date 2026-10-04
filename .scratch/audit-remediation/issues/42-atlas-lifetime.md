# atlas lifetime

Status: ready-for-agent
Progress: implemented; focused regressions pass, browser integration verification tracked in ../ui.md
Findings: AA03 / AA04 / UIX14

Correlate Atlas initialization and search with lifetime, visibility and query. Inject search transport and preserve stale published geometry/polling.

Validation: focused frontend Vitest cases, Svelte/TypeScript diagnostics for touched modules; no full suite. Preserve prior patches and app ownership invariants.
