# Pane-motion wait lifetime

Date: 2026-10-21
Outcome: implemented and verified

## Cause and correction

Workspace teardown cancels pane layout motion, releasing outstanding
`paneLayoutMotion.wait()` calls. `Notepad.svelte`'s continuation then read its
component-derived `compactPanes`, even after Svelte destroyed the workspace.
The warning stack in the original native Settings/editing journey identified
that read as `derived_inert`.

After motion settles, the presentation wait now requires a connected workspace
shell before reading component-derived state. The existing compact paint waits,
activation checks and focus-intent admission remain in place for mounted
workspaces. Pane membership, navigation and persistence owners are unchanged.

## Regression

Two browser cases request real Settings navigation as pane entrance effects
start, at 1,440px and 640px. They retain the actual Svelte workspace, navigation
coordinator and WAAPI clock. They verify that animations cancel, no
`derived_inert` warning occurs, Settings retains focus, and returning to the
workspace permits normal search input. Diagnostic listeners and console capture
are cleaned up; fixture storage resets even after assertion failures.

The desktop case fails on the original implementation with one warning and
passes after the lifetime guard. Both corrected cases pass. The compact case
also covers the retained rail layout. Dedicated pane-motion geometry tolerances
and focus admission remain unchanged.

The broad run also exposed an existing interruption-test assertion that treated
the last rAF sample as the final collapse frame. Two runs observed 1.125px and
1.0625px against a 1px limit; the original production code passed an isolated
run, consistent with timing sensitivity. The test now observes the actual pane
animation's `finished` promise and requires completion while its pane is still
mounted. Early cancellation cannot satisfy that check. It retains the Related
interruption, multiple intermediate width samples and settled-removal checks.

## Verification

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passes.
- `pnpm test`: 143 support tests and 1,418 frontend tests pass, with one existing
  frontend skip.
- `pnpm build`: passes with the existing chunk-size and color-environment
  warnings.
- All 56 affected browser cases pass across animation cleanup (8), pane motion
  (11), responsive rails (19), split consistency (15) and populated chat (3).
  The cleanup suite was rerun after correcting its completion assertion; the
  earlier sampling failures remain in their original logs.
- All 55 native tests across 12 specs pass with process restarts enabled,
  including the original Settings/editing journey. There are no `derived_inert`
  warnings, stale-workspace errors or nonzero Pi observer error counters.
- Local Standards and Spec review found no remaining actionable issues.
  `git diff --check` passes; owned browser/native listeners are closed.

The native command was:

```sh
GNEAUX_PI_PROCESS_RESTART=1 TAURI_WEBDRIVER_PORT=4457 pnpm test:e2e:native:run
```

The unchanged admitted native binary is sufficient because the application fix
is confined to Svelte presentation code, served by the test harness. Its debug
SHA-256 is `6bb1c9ceb97c2db9210dda859db5b7a9a131d08b8c3437080045bfdf2d0ab206`.
No Rust or dependency changes were made. Existing nonfatal ResizeObserver-loop
diagnostics and the browser fixture's unsupported publication-owner command
remain distinct from the corrected Svelte lifetime warning.

Logs are local under `/tmp/gneauxghts-pane-wait-*.log`. Browser evidence uses
headless Chrome with simulated IPC; native evidence uses a disposable background
macOS WebKit app and deterministic provider fixtures. No live-model, other-OS or
GPU-performance claim is established.
