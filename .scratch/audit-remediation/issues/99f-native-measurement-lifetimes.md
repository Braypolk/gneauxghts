# Bound native measurement frame work and teardown

Status: ready-for-agent
Progress: implemented; four focused callback lifetime tests and E2E typecheck pass.
Owner: audit_ui_semantic
Findings: EH-09 remaining native measurement callbacks

## Plan before source edits

The sustained Editing Window continuous rAF loop stops only on success; per-input nested rAF completion can race its timer and callback twice. Chat typing's two-frame wait has no wall deadline; a throttled webview can strand the listener. Timeline native metric timeout disconnects its observer but leaves pending rAF callbacks alive.

Preserve all measurement inputs, durations, sample counts, debounce spacing, visibility requirements and budgets. Add finally cleanup of the continuous sampler including its exact rAF ID; make per-input completion idempotent and cancel rAF/timer on either outcome. Bound chat typing's overall browser operation and two-frame wait, clean pending waits and event listener including late attachment, and prevent mutations after terminal completion. Track/cancel nested timeline rAF IDs in its existing finish function. Edit only the second opt-in editing-windows describe; timeline owner retains first functional test. Verify E2E types and focused existing support checks; no UI/provider/performance run or changed performance claims.

## Outcome

Continuous Editing Window sampler now tracks/cancels its frame and always stops/deletes the probe in finally. Per-input completion is exactly once, clears its timer/frame, suppresses late deadline events and attaches rejection handling immediately. Chat typing uses a 20-second whole-operation wall deadline and 5-second two-frame deadline; finish cancels pending pause/frame work, releases listeners and releases a listener acquired after completion without typing. Timeline measurement cancels nested rAF from its existing 15-second finish path. Existing sample durations, 450ms debounce spacing, 10-second suggestion settlement period, counts and performance budgets are preserved.

`node --test e2e/support/nativeMeasurementLifetime.test.mjs`: **4/4 passed**, evaluating the actual self-contained WebDriver callbacks in a deterministic renderer with queued timers/frames; tests exercise cancellation and late callback/attachment behavior rather than source spelling. `pnpm exec tsc --project e2e/tsconfig.json`: passed. No native UI or performance run and no changed performance claim. Only the second opt-in measurement describe in editing-windows was edited; the first functional test remained with timeline owner.
