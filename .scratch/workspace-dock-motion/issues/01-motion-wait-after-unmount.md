# Pane-motion wait reads destroyed workspace state

Status: needs-triage
Type: task
Date: 2026-10-21

## Evidence

The native `piChatEditing.spec.ts` case `configures vault editing defaults
through Settings and enforces them in chat` passes but emits Svelte
`derived_inert` during Settings navigation. It persists with the corrected
process-local Pi observer and zero observer errors/retired bridge reads.

A temporary `console.warn` stack capture, removed after diagnosis, identifies:

```text
derived_inert → execute_derived → update_derived → get → waitForPaneMotion
```

In `src/lib/features/notepad/Notepad.svelte`, `waitForPaneMotion()` awaits
`paneLayoutMotion.wait()` and then reads component-derived `compactPanes`.
Unmount cancels motion; the resumed wait needs its own lifetime admission before
reading destroyed component state. The stack locates the read; the originating
command and any later effects still need a focused investigation.

Reproduce with the admitted native E2E binary and disposable fixture:

```sh
TAURI_WEBDRIVER_PORT=4457 pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/native/piChatEditing.spec.ts \
  --mochaOpts.grep 'configures vault editing defaults'
```

Observed once in the 55-test native smoke and again in an isolated passing run.
Logs: `/tmp/gneauxghts-pi-observer-native-smoke.log` and
`/tmp/gneauxghts-pi-observer-warning.log`. No user-visible failure is established.
Before implementation, read current architecture/lifecycle invariants and cover
unmount during an outstanding motion wait without weakening focus admission.
