# Pi acceptance observer lifetime

Date: 2026-10-21
Outcome: implemented and verified

## Cause and correction

`observePi()` retained the native E2E bridge belonging to one mounted Notepad.
Settings destroys that workspace and its derived pane state. Later DOM mutations
and queued commit callbacks still called the old bridge, producing `Unknown
workspace pane` errors outside the observer error counter.

The process-local observer now resolves the current workspace bridge at each
sample. It skips workspace sampling while Settings is mounted and follows the
replacement bridge on return. Runtime watches and process totals remain intact.
Stopping is idempotent; queued callbacks, late watch deliveries and pending watch
acquisition cannot resume observations. A watch that finishes opening after stop
is immediately closed. Callback failures increment `observerErrors` without
retaining exception text. No application or Rust behavior changed.

## Regression and verification

- Four support tests execute the actual WebDriver callback with controlled
  renderer/runtime dependencies: workspace replacement, queued/late callbacks,
  pending watch cleanup and synchronous error accounting. Before the fix, three
  fail and one passes; all four pass afterward.
- A maintained native test navigates the real app to Settings, triggers a DOM
  mutation after workspace destruction, returns and streams a new conversation
  without reinstalling the observer. The original code reads the retired bridge
  six times and fails. The fix records zero retired reads/errors and observes
  runtime text/reasoning plus real DOM streaming after return.
- Full native smoke: **55 tests across 12 specs pass**, with process restarts
  enabled. All reported observer error counters are zero; no `Unknown workspace
  pane` error remains. Editing, creation, publication, compaction, connections,
  adapters, images, lifecycle and native events are covered.
- `pnpm check`: zero Svelte errors/warnings and passing E2E TypeScript.
- `pnpm test`: **143 support tests and 1,418 frontend tests pass**, with one
  existing frontend skip. `pnpm build` passes, retaining the existing chunk-size
  and environment-color warnings.

Commands:

```sh
pnpm check
pnpm test
pnpm build
TAURI_WEBDRIVER_PORT=4457 pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/native/piChatNative.spec.ts \
  --mochaOpts.grep 'keeps observing the current workspace'
GNEAUX_PI_PROCESS_RESTART=1 TAURI_WEBDRIVER_PORT=4457 pnpm test:e2e:native:run
```

Native verification uses background macOS WebKit and disposable app/vault roots,
with deterministic provider fixtures. It establishes no live-model or other-OS
claim. The unchanged admitted debug binary SHA-256 is
`6bb1c9ceb97c2db9210dda859db5b7a9a131d08b8c3437080045bfdf2d0ab206`.
Logs are local under `/tmp/gneauxghts-pi-observer-*.log`.

One remaining Svelte `derived_inert` warning was traced using temporary warning
stack capture to `Notepad.svelte`'s `waitForPaneMotion()` reading `compactPanes`
after an awaited motion. It is separate from the Pi observer and remains a
[tracked follow-up](../workspace-dock-motion/issues/01-motion-wait-after-unmount.md).
The diagnostic instrumentation was removed. Existing nonfatal native
ResizeObserver-loop diagnostics also remain; no warnings are suppressed.
