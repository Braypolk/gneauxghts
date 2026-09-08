# 41: Show one combined diff per finalized Editing Window

**What to build:** New editor history appears as a sequence of meaningful finalized states with one selectable row and combined diff per window, while older links remain navigable.

**Blocked by:** 40: Preserve truthful window provenance and stable citations.

**Status:** ready-for-agent

**Resolution:** Completed; integrated and validated by issue 42, including production activation, full regressions, storage measurements, native gates, and independent reviews.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Render one selectable finalized editor revision with its start/end interval, net summary, source, and optional name; do not build expandable autosave-member lists for new windows.
- [x] Compare each window endpoint to its preceding finalized revision. Preserve collapsed unchanged diff context and current-content comparison behavior.
- [x] Show important standalone actions and Lifecycle Events distinctly; finalize and name current state safely, while existing revision labels stay metadata-only.
- [x] Retain legacy individual-revision navigation and exact citation selection without rewriting stored identities or synthesizing missing data. Make any legacy presentation distinction clear.
- [x] Handle seal failures on History Mode entry with existing typed recovery UX; maintain immutable selection, stable paging, workspace focus/scroll/selection, restore preview freshness, and undo-reset behavior.
- [x] Update component/API/machine tests and native journeys, including an open window on entry, interval display, naming, concurrent newer arrivals, legacy citations, restore, and two-pane workspace return.

## Primary implementation surfaces

- [HistoryMode.svelte](../../../src/lib/features/history/HistoryMode.svelte)
- [HistoryEditingSession.svelte](../../../src/lib/features/history/HistoryEditingSession.svelte)
- [historyTimeline.ts](../../../src/lib/features/history/historyTimeline.ts)
- [historyModeMachine.ts](../../../src/lib/features/history/historyModeMachine.ts)
- [historyModeSession.svelte.ts](../../../src/lib/features/history/historyModeSession.svelte.ts)
- [historyApi.ts](../../../src/lib/features/history/historyApi.ts)
- [history_commands.rs](../../../src-tauri/src/commands/history_commands.rs)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.


2026-09-05 implementation handoff:

- Window rows bypass Editing Session grouping in both the bounded backend projection/seeding and the frontend. Each finalized window is directly selectable, with its immutable identity, endpoint line/character counts, Editor source, optional name, and first/last save interval. Clock changes display explicitly uncertain time, raw first/last evidence, and the min/max wall-time range. Missing interval evidence is labelled unavailable rather than replaced with a point timestamp.
- The selected combined diff includes deterministic net added/removed line counts across authored body and unmanaged properties. Its parent remains the preceding finalized revision; unchanged context collapse is preserved. Legacy groups are visibly labelled Legacy Editing Session and still expose individual retained identities. Task, proposal, restore, creation, baseline, and recovery action rows remain standalone; Lifecycle Events remain distinct.
- Naming current content follows the existing History Mode entry flow: workspace flush, target seal, then selection of the resulting head (including the anchor for a net no-op). Once selected, naming/removing a name remains metadata-only and does not reseal later or unrelated windows. Existing entry failure/retry, citation selection, paging, restore freshness, editor adoption/undo reset, and workspace return paths remain intact.
- A new integrated regression exposed that Current note comparison still used the finalized head while newer saved content was pending. Comparison now includes the verified captured pending endpoint under the note-file mutation barrier without sealing it. The diff DTO uses `toRevisionId: null` for that non-revision endpoint; finalized comparisons retain their original identities. No private window identifier is exposed.
- Mandatory issue-39 audit correction: the existing pane-navigation pipeline owns an async queue for departing leaf requests, held from before guard through the actual workspace mutation. It releases before editor/complete/focus effects and on stale, blocked, or failed work. Composite restore-location stays outside the queue and delegates open-note/kind leaves normally. Preliminary restorable-location capture saves/cursors only; an actual `persist: false` departure still checks the buffer and finalizes. Editor-to-chat restoration uses `workspacePaneController.setPaneKind`; the conversation changes only after that leaf succeeds.

Focused checks: 100 tests across the History UI/API/machine/session and navigation/departure/location/workspace/note controllers passed; frontend architecture fitness adds 9 passing tests. `pnpm check` reports zero errors/warnings. Rust `editing_session` (2), `editing_window_history` (2), and `historical_diffs` (1) passed. The integrated window-history test covers open endpoint→seal→one row, net diff excluding intermediate prose, live-current comparison without sealing, metadata-only naming with a newer pending window, immutable parent diff, and an older page cursor after a newer window arrives. `cargo check --features editing-window-internal` and `git diff --check` pass.

The new native journey is `e2e/specs/native/editing-windows.spec.ts`. It is written but **not executed in issue 41**, per the sequential issue-42 native/release assignment. It uses real editor saves, an open window on entry, one direct row/interval/net diff, naming, two-pane selection/focus return, complete restore, and undo reset. Issue 42 should run `node e2e/support/buildNative.mjs --editing-windows`, then `pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/editing-windows.spec.ts`. The optional build flag enables `e2e-wdio,editing-window-internal`; omitting it preserves the default/legacy native build. Existing legacy citation/restore/scroll journeys remain separate and must also pass. Full regressions, browser/native execution, performance, and policy activation remain issue 42.
