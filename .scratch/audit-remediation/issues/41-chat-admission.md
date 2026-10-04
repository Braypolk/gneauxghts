# chat admission

Status: ready-for-agent
Progress: implemented; focused regressions pass, browser integration verification tracked in ../ui.md
Findings: AA01 / AA02 / UIX02

Preserve event-advanced messages and terminal state when send receipts arrive late. Make listener acquisition joinable, attempt-owned and failure/disposal safe; use a multi-subscriber typed API fixture.

Validation: focused frontend Vitest cases, Svelte/TypeScript diagnostics for touched modules; no full suite. Preserve prior patches and app ownership invariants.
