# Main App QA: Not Addressed Items

Date: 2026-04-22

Related docs:
- [Main App Deep QA Audit](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-deep-qa-audit-2026-04-22.md)
- [Main App QA Remediation Playbook](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-qa-remediation-playbook-2026-04-22.md)
- [Remaining Partially Addressed Items](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/docs/main-app-qa-remaining-partial-items-2026-04-22.md)

Scope:
- Items currently still not addressed based on latest implementation pass.

## 1) Major Notepad Decomposition

Current state:
- [Notepad.svelte](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/Notepad.svelte) is still a large orchestration surface.
- Some refresh orchestration moved to:
  - [notepadRefreshController.ts](/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/src/lib/features/notepad/orchestration/notepadRefreshController.ts)

Why this remains not addressed:
- Core pane/session/editor/search/related/proposal orchestration still sits mostly in one route component.

Required implementation steps:
1. Extract pane/session orchestration into a dedicated controller module.
2. Extract persistence/autosave command flow into a separate controller/service.
3. Extract proposal-mode workflows into their own module.
4. Keep `Notepad.svelte` focused on rendering and event wiring only.

Acceptance criteria:
- `Notepad.svelte` no longer contains most multi-step workflow logic.
- Extracted modules each have clear ownership and targeted tests.

## 2) Frontend Automated Test Safety Net

Current state:
- Frontend checks rely on type-check/build, with no established route/store test suite in scripts.
- `package.json` has no frontend test command.

Why this remains not addressed:
- Core UI/store behaviors are still validated mostly via manual testing and static checks.

Required implementation steps:
1. Add frontend test framework and script in `package.json` (for example, `test` / `test:watch`).
2. Add first-wave tests for high-risk logic:
   - split-pane selection behavior
   - settings refresh policy behavior
   - inbox list resource concurrency behavior
3. Add tests for notepad orchestration modules as they are extracted.

Acceptance criteria:
- Frontend tests are runnable in CI/local and cover critical store/orchestration behavior.

## Suggested Implementation Sequence

1. Add frontend test harness first (small initial suite).
2. Execute notepad decomposition in small phases, adding tests per extraction.
3. Expand test coverage to new controllers/services before final cleanup.
