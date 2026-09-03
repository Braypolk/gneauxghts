# 33: Make Phase 1–3 timeline internals navigable

**What to build:** Contributors can understand and change the completed Note Timeline behavior through a small external interface and focused private modules without altering user-visible Phase 1–3 behavior.

**Blocked by:** 27: Repair revision continuity after history reset; 28: Page Missing Note recovery timelines; 29: Restore exact editor state after History Mode; 30: Encapsulate Note Timeline runtime coordination; 31: Centralize current-content access; 32: Stabilize the timeline command contract.

**Status:** ready-for-agent

- [ ] Keep one canonical external Note Timeline interface while organizing private runtime, mutation, lifecycle and recovery, history projection, health, and persistence concerns into cohesive modules.
- [ ] Organize tests beside the behavior they protect so a contributor can locate a rule and its evidence together.
- [ ] Remove broad dead-code suppression and either use, narrowly gate, or delete unused Phase 1–3 scaffolding.
- [ ] Resolve strict lint diagnostics across all targets and features without suppressing meaningful warnings.
- [ ] Keep the complete Rust, architecture, frontend, and browser end-to-end suites green through the refactor.
