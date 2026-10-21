# Full WebdriverIO 10 migration — 2026-10-21

## Finding

There is no source-level reason to replace Tauri or its embedded WebDriver. The blockers are in the JavaScript Tauri service and its support packages, plus our callback-style tests. The installed embedded driver already awaits promises from `/execute/sync`. Runtime verification now confirms the migrated native smoke suite works with WDIO 10; see the verification record below.

This investigation read the published packages installed in the repository: `@wdio/tauri-service` 1.5.0, `@wdio/native-core` 1.3.0, `@wdio/native-utils` 2.8.0, and Rust `tauri-plugin-wdio-webdriver` 1.5.0. Registry metadata captured earlier on this date reports Tauri service 1.5.0 as latest. The source conclusions below concern those exact versions, not a promise about all Tauri integrations.

## Precise integration blockers

| Location | Finding | Required treatment |
| --- | --- | --- |
| Tauri service `patchBrowserExecute` | Unconditionally binds `browser.executeAsync` before choosing the embedded branch. The embedded branch merely delegates to original `execute`. | Avoid the removed command entirely for embedded mode. Migrate remaining service callbacks if keeping the complete service. |
| Tauri service `resolveLabelToHandle` | Uses `executeAsync` to ask each window for its Tauri label. | Return the IPC promise from `execute`; preserve failure-to-null behavior. |
| Tauri service mock `withImplementation` | Executes a generated function through `executeAsync`. | Return/await the generated function through `execute`, preserving error propagation. |
| Native utils `installMockSyncOverride` | Calls `overwriteCommand(name, override, true)`. The service catches its failure and logs a warning. | Change to `{ attachToElement: true }`; otherwise mock synchronization silently stops working. |
| Dependency metadata | Tauri service pins WDIO 9 globals, logger, spec reporter, types and webdriverio; native core and native utils also pin logger 9. | Upgrade the whole relevant dependency graph, not only root packages or the peer range. |

Evidence: installed published `dist/esm/index.js` and `package.json` files; [Tauri service package](https://registry.npmjs.org/@wdio/tauri-service/-/tauri-service-1.5.0.tgz), [native utils package](https://registry.npmjs.org/@wdio/native-utils/-/native-utils-2.8.0.tgz), [native core package](https://registry.npmjs.org/@wdio/native-core/-/native-core-1.3.0.tgz). The [upstream worker source](https://github.com/webdriverio/desktop-mobile/blob/main/packages/tauri-service/src/service.ts) shows the service setup, execution patch, interaction overrides, and window-recovery hooks.

`@wdio/native-types` lists WDIO 9 packages as development dependencies, which do not themselves install those runtimes for consumers. Distinguish this from the hard runtime dependencies above. No `browser.tauri`, `withExecuteOptions`, or service-specific mock calls were found in the repository's E2E tests during this investigation. They primarily use standard browser commands and the app's IPC bridge.

## Embedded driver support

Rust `src/server/handlers/script.rs` routes `/execute/sync` to `execute_script`. `src/platform/executor.rs` wraps the script as a function body, awaits its result, serializes the value, and polls until completion or the configured script timeout. It catches thrown/rejected errors and returns a WebDriver error. This supports migration to an async function passed to `browser.execute` without a Rust change. Source inspected in the downloaded crate under the Cargo registry; authoritative distribution: [tauri-plugin-wdio-webdriver 1.5.0](https://crates.io/crates/tauri-plugin-wdio-webdriver/1.5.0), [upstream repository](https://github.com/webdriverio/desktop-mobile).

The service documents embedded support on macOS, Linux and Windows; external `tauri-driver` is a different integration, with different platform support. A generic advertised Tauri session does not establish that every service/provider combination supports v10. [Tauri service platform documentation](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-service#platform-support)

## Other v10 changes to audit

Use Node 22.19 or newer and matching WDIO 10 runner, globals, framework and reporter packages with expect-webdriverio 8. Replace callback-based `executeAsync` with promise-returning `execute`. `$` now rejects multiple matches: narrow ambiguous selectors instead of disabling strictness globally. Element lists require care: an out-of-range nonnegative index can be a waiting element, so use length checks rather than truthiness. Change boolean command-override options to the new object form. BiDi window/frame navigation uses held contexts; retaining Classic for the existing native driver keeps this a separate concern. [Official migration guide](https://webdriver.io/docs/v10-migration)

Our tests include asynchronous animation sampling and listeners as well as IPC promises. Returning a new Promise is appropriate where the underlying API is callback based; simply renaming `executeAsync` would leave an undefined `done` callback or finish before observation ends. Preserve listener cleanup, error handling, timeout behavior and sample lifetime. The existing `nativeMeasurementLifetime` support tests inspect this logic and must migrate with it.

## Recommendation and verification gates

The implementation decision is a local embedded-only launcher, with plain Chrome for browser fixtures. Our suite uses standard WebDriver commands and the app IPC bridge rather than `browser.tauri` or the service's mock facade. Removing the unused facade avoids carrying patches for window-label fallback and mock synchronization, plus cascading overrides across the service's WDIO 9 dependency graph. Native lifecycle ownership is the functionality that needs a replacement; the embedded Rust driver remains.

The replacement must take ownership of launching the pinned app, driver readiness, app arguments/environment, port exclusivity, logs, child-process termination and failure cleanup. Preserve `nativeHarness.prepare`/`cleanup`, the existing fixture and background-presentation guards, owned-child admission, platform PID checks, signal cleanup and restart behavior. The existing `processRelaunch` coverage provides a repository precedent for raw W3C control. This is a deliberately narrower integration, not a replacement implementation of every upstream service feature.

A version-pinned package patch remains an alternative for repositories that need the full Tauri API/mock facade. That route requires both service and native-utils patches, plus dependency overrides; merely relaxing the peer range is insufficient. It would also need tests for both distributed module formats and a removal gate when an upstream release incorporates the fixes.

Before calling the migration complete:

1. Inspect the installed tree to ensure no active WDIO 9 runner/globals/logger/webdriverio remain behind the migrated entry points.
2. Run type checks and support tests, then existing browser tests plus exported-agent replay. Keep strict selectors enabled and fix actual ambiguity.
3. Run the native smoke suite with the pinned/hash-checked E2E binary, disposable vault/data/documents roots and background default. Assert no OS focus acquisition.
4. Exercise promise resolution and rejection, native IPC, navigation, multi-window behavior, fixture isolation and cleanup after both success and failure. Include a production-bundle native smoke run if claiming production WebView compatibility.
5. Keep credential-dependent and foreground-only acceptance separate, and report anything not run explicitly.

## Implementation and verification record

All JavaScript WDIO runner, globals, framework, reporter, type and client packages now resolve to 10.1.0, with expect-webdriverio 8.0.0. The lockfile no longer contains the v9 client or runner graph. The repository owns a small embedded-only native launcher instead of the v9-bound Tauri service; the existing Rust driver remains unchanged. The unused JavaScript Tauri automation plugin import is removed. Browser fixtures now own their Tauri event-unlisten registry and use ordinary Chrome sessions.

Real-process restart verification exposed a teardown ordering bug: the replacement inherited the original app's output pipes, so waiting for their closure before stopping the replacement blocked cleanup. A focused child-process regression reproduced the deadlock. The harness now stops the receipt-identified replacement (checking its executable and all three fixture roots, with bounded TERM/KILL escalation) before joining output streams, flushing logs and removing the fixture.

The migration converts 136 asynchronous script calls to promise-returning `execute`. Review compared all 135 inline callback bodies structurally with their originals; the remaining named animation-frame helper was checked separately. Strict selectors remain enabled. Tests explicitly select the intended pane, queued item, calendar day or conversation control, and wait for filtered lists to settle before asserting their single row.

Verified locally on macOS with Node 24.2:

- Svelte/TypeScript checks: no errors or warnings; E2E TypeScript passes.
- Frontend unit tests: 1,396 passed, one existing skip.
- Harness/support tests: 130 passed, including startup admission, occupied-port refusal, cancellation, logfile failures, inherited restart pipes, final-output flushing and forced runner exit cleanup.
- Production frontend build: passed (existing chunk-size advisory).
- Exported agent regression: fresh WDIO 10 replay passed, including Settings navigation, theme selection and reload persistence.
- Browser sweep: all 65 specs passed in a fresh complete run (382 tests passed, 40 existing opt-in tests skipped). The four initially failing specs are repaired. The original callback tests from `19d16a1d` on WDIO 9.32.0 reproduced the initial failures, separating them from the migration. The fixes preserve assertion tolerances and real pointer clicks; new regressions cover interrupted split motion and all access-menu choices at desktop/phone widths. The compact navigation test now waits for its responsive control after a viewport change. See the [archived diagnosis and corrections](../../.scratch/archive/browser-dock-wdio10.md). All test-owned browser, agent and native listeners stopped after verification.
- Rust unit tests: 652 passed, 19 existing ignored tests; architecture fitness: 19 passed.
- Python fixture tests: 16 passed; native build-artifact guard: one passed.
- Native background smoke: the final run enabled real-process restart coverage (`GNEAUX_PI_PROCESS_RESTART=1`) and passed all nine specs, 45 tests, with no skips. Used the hash-checked debug E2E binary and disposable app-data/documents/vault. Verified focus denial, promise resolution/rejection, IPC/events, images, editing/publication, compaction, adapters, driver-session reconnection and restart persistence of chats, permissions, pending edits and note creation. The native and agent fixture listeners stopped after their suites.

The native result covers the macOS debug WebView with the current frontend. Foreground/paint measurements, credential-dependent provider acceptance, other operating systems and an optimized native binary were not run. No production bundle/native-release claim is inferred from the frontend build alone.
