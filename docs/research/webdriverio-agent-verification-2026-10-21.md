# WebdriverIO agent verification — 2026-10-21

## Initial integration (superseded)

The initial v10 session loop lived in the separately versioned `e2e/agent` workspace, using headless Chrome against the existing `VITE_E2E_BROWSER` app fixture. That first stage retained WDIO 9 for existing suites. The subsequent [full migration](webdriverio-full-migration-2026-10-21.md) removes the JavaScript Tauri service and moves all suites to WDIO 10. Use the [operating workflow](../agents/ui-verification.md) for current instructions.

The useful loop is: start an owned fixture server; open a named session; inspect interactive elements; perform the journey; assert the observable outcome; retain evidence; export a deterministic test; rerun that test in a fresh session; close the session and server. It needs no separate model-provider key. Browser fixture results establish frontend behavior; retain native checks for persistence, plugins, lifecycle and window behavior.

## What v10 actually provides

- `wdio session`, bundled in `@wdio/cli`, keeps a browser alive between shell commands. It offers snapshots with element references, interactions, `exec` assertions and test export. Chrome is headless by default. Do not install `@wdio/session` directly. [Session guide](https://webdriver.io/docs/session)
- Export replaces references with unique stable selectors. Exported files must be reviewed for assertions and fixture assumptions, then rerun. `.wdio/helpers` can register reusable commands. [Export guide](https://webdriver.io/docs/session/export)
- `wdio run --debug=agent` pauses on a failed test or `browser.debug()`, allowing session commands to inspect the paused worker; `resume` continues it. Framework timeouts increase to 24 hours, so this belongs in an explicitly invoked debugging command, not ordinary CI. [Debug guide](https://webdriver.io/docs/session/debug)
- Basic evidence is built in: `session trace start` / `trace stop` creates `trace.trace`, `transcript.md`, screenshots and snapshot resources. The implementation uses ordinary screenshot/snapshot calls and does not gate this basic trace on BiDi. This is distinct from the richer DevTools archive. [Published session 10.1.0 source](https://registry.npmjs.org/@wdio/session/-/session-10.1.0.tgz), `build/daemon.js`, source sections `actions/evidence.ts`; CLI help in `build/cli.js`.
- `@wdio/mcp` is an alternative tool interface, not necessary for the shell loop. `@wdio/ai-service` is another separate feature: `act()` records model-selected commands and later replays them; `extract()` calls the model every run. Use normal commands for known flows, explicit assertions for outcomes, and `locked` cache mode if adding AI steps to CI. BiDi supplies stronger effect verification than Classic. [AI steps guide](https://webdriver.io/docs/ai-steps), [release announcement](https://webdriver.io/blog/2026/10/05/webdriverio-v10-release)

## Compatibility findings

| Package / behavior | Evidence and implication |
| --- | --- |
| `@wdio/cli` 10.1.0 | Published engine is Node `>=22.19.0`. Local Node 24.2 meets it; the repository's current `>=22.17.0` declaration does not express the new minimum. [Registry metadata](https://registry.npmjs.org/@wdio%2fcli/10.1.0) |
| `@wdio/tauri-service` latest 1.5.0 | Declares `webdriverio: ^9.0.0` peer and hard dependencies on `webdriverio` 9.31.9, `@wdio/globals` 9.31.3 and other WDIO 9 packages. Installed ESM source binds `browser.executeAsync`; v10 removes that command. A peer override cannot repair this API mismatch. [Registry metadata](https://registry.npmjs.org/@wdio%2ftauri-service/1.5.0), [published source](https://registry.npmjs.org/@wdio/tauri-service/-/tauri-service-1.5.0.tgz), [migration guide](https://webdriver.io/docs/v10-migration) |
| Generic `session open tauri` | Session 10.1.0 calls `startWdioSession([plan.capabilities], ...)`; Tauri 1.5.0's standalone entry expects a capability object. The generic advertised target is not evidence that our pinned embedded-driver integration works. [Session source](https://registry.npmjs.org/@wdio/session/-/session-10.1.0.tgz), `targets/webview.ts`; [Tauri source](https://registry.npmjs.org/@wdio/tauri-service/-/tauri-service-1.5.0.tgz), standalone `init` |
| `session open <config>` | Extracts capabilities and connection settings rather than running ordinary runner lifecycle hooks. Do not assume existing `onPrepare`, `beforeSuite`, or custom fixture cleanup will execute. [Session source](https://registry.npmjs.org/@wdio/session/-/session-10.1.0.tgz), `targets/config.ts` and `targets/launch.ts`; [targets guide](https://webdriver.io/docs/session/targets) |
| DevTools service 10.11.0 | Peers allow WDIO 9 and 10, so it is not inherently v10-only. However, desktop trace-mode documentation requires BiDi. Our current Chrome harness explicitly forces Classic because of startup script-context loss. Use built-in session evidence first; do not promise full DevTools DOM/network traces without testing a BiDi lane. [Registry metadata](https://registry.npmjs.org/@wdio%2fdevtools-service/10.11.0), [DevTools guide](https://webdriver.io/docs/wdio-devtools-service) |

## Repository integration constraints

These come from the current repository, not upstream promises:

- Preserve the app-owned in-memory IPC fixture (`src/lib/e2e/browserBackend.ts`) and owned-server cleanup (`e2e/support/ownedServer.mjs`). A plain Chrome lane can avoid the Tauri service's WDIO 9 dependency, but must prove fixture readiness and startup/navigation behavior.
- Keep v10 dependencies isolated from root `@wdio/globals` 9 imports when replaying exported tests. Use one documented entry point rather than an unpinned global `npx` command.
- Ignore session state/evidence directories; retain a selected failing trace when needed for diagnosis. Export tests to an explicit destination instead of silently overwriting maintained tests.
- The stock session skill says idle sessions need not be closed. Our owned fixture-server lifecycle should close them explicitly to avoid stale processes and ports.
- Preserve headless browser defaults and background native defaults. Generic desktop launch must not bypass `nativeE2EBinary`, `createNativeFixture`, `admitNativePresentation`, isolated app-data/vault roots, or focus-denial assertions. See [E2E conventions](../../e2e/README.md).

## Initial-stage runtime findings and validation

- A named session opened the actual app, asserted Alpha note, navigated to Settings, changed the theme, and returned/reloaded. Snapshots, a screenshot and a trace with transcript/resources were created and inspected. A deliberately false `exec` assertion exited 1.
- Export generated `settings-roundtrip.e2e.js`. Review replaced a structural label selector with a semantic input/label selector, split assertions for readability, and made the URL relative. Fresh WDIO 10 replay passed on the default and an alternate port. CI now runs the maintained exported specs and uploads failure screenshots.
- WDIO's plugin loader resolves from its own ancestry before the working directory. With pnpm's shared store, short plugin names loaded root v9 packages even under the v10 CLI. Explicit workspace resolution fixes this; the worker still needs the literal `local` runner name for framework selection. The full migration eliminates mixed-version resolution, so those explicit paths have now been removed. Role-selector replay exercises the v10 path.
- Standalone Chrome lacked the service-provided event cleanup global. The app fixture now installs its own registry, tested through the public Tauri `listen`/`unlisten` API. Native theme setting is a fixture no-op; DOM preference and reload persistence are asserted. Editor publication binding remains explicitly unsupported, so this is not a native publication test.
- Failed replays produced screenshots and released their server. An occupied-port startup was rejected without disturbing the existing owned server; SIGTERM cleanup released that server's port.
- Final verification: 1,396 frontend tests passed (one skipped), 125 support tests passed, two existing WDIO 9 startup tests passed, and the WDIO 10 exported regression passed. Type/Svelte checks, frozen-lockfile installation and production build passed. The hosted CI job has been configured but was not run from this local task.

Existing native checks remain the gate for actual persistence, plugins and window behavior; the initial stage did not upgrade their runner or establish new native coverage. See the full migration report for subsequent results.
