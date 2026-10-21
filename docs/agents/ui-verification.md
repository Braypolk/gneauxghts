# UI verification with WebdriverIO sessions

Use this loop to inspect the real Svelte UI, verify a change, and retain a useful
regression test. Commands run from the repository root after `pnpm install`.
All browser, native and agent suites use WDIO 10. The `e2e/agent` workspace
organizes session artifacts and exported tests. Native tests connect directly
to the embedded driver through the repository's owned-app launcher.

## Open and verify

1. Run `pnpm agent:serve` in a persistent terminal. Wait for “Agent fixture
   ready”. It owns a loopback Vite process, refuses an occupied port, and enables
   the development-only, in-memory IPC fixture. Keep its process handle for cleanup.
2. Pick a unique session name for this task and use it on every command:

   ```sh
   pnpm agent:session -s my-change open ./wdio.conf.js 0
   pnpm agent:session -s my-change trace start
   pnpm agent:session -s my-change navigate http://127.0.0.1:1423
   pnpm agent:session -s my-change snapshot --interactive
   ```

   Config-based `open` takes a capability index, not a URL, and does not run
   server lifecycle hooks. Chrome is headless with a disposable profile. For
   concurrent work, set `GNEAUXGHTS_AGENT_PORT` consistently for the server,
   session and replay commands; navigate to the URL printed by your server.
3. Act on refs from the latest snapshot (`click e4`, `fill e7 'New title'`).
   Refresh refs after navigation. Use `exec` for awaited assertions, keeping
   shell code in single quotes:

   ```sh
   pnpm agent:session -s my-change exec -e 'await expect($("[data-testid=note-title]")).toHaveValue("Alpha note")'
   ```

   `$` is strict in v10: resolve ambiguous selectors rather than selecting an
   arbitrary match. Assert the user-visible result; successful clicks alone do
   not establish correctness. Fixture IPC assertions can supplement UI assertions.
4. Capture the relevant final state with `screenshot`, then `trace stop`. The
   CLI prints evidence paths under `e2e/agent/.wdio/session/<name>/`. Inspect the
   screenshot for layout claims. On a failed assertion, retain the trace and
   investigate before retrying. Use `pnpm agent:session <command> --help` for
   command flags and `pnpm agent:session doctor chrome` for prerequisites.

## Export and replay

For a lasting regression, export to a new filename (export overwrites its target):

```sh
pnpm agent:session -s my-change export --out specs/my-change.e2e.js
pnpm agent:session -s my-change close
```

Stop the owned `agent:serve` process with Ctrl-C/SIGTERM and wait for it to exit.
Then run:

```sh
pnpm agent:test --spec ./specs/my-change.e2e.js
```

Replay starts and stops its own fixture server. Export paths and `--spec` paths
are relative to **e2e/agent**, where WDIO 10 imports resolve. Keep exported
specs there; the main TypeScript suite excludes this JavaScript workspace. Review the export:
preserve assertions, remove investigative/intentional failure steps, replace
fragile selectors, and use relative app URLs so port overrides work. Each test
should establish its own starting state. An export is complete only after a
fresh replay passes. Maintained `.e2e.js` specs run in CI through `agent:test`.

Always close your named session and stop your owned server, including after a
failure. Avoid `close --all` or killing a port's PID: another task may own it.
Session artifacts are ignored by Git; promote only a reviewed test or selected
evidence supporting an unresolved issue. The basic trace records commands,
snapshots and screenshots, not a full network/performance trace.

## Coverage boundary

The fixture starts with Alpha/Beta notes and does not access the user's vault.
It proves frontend behavior against simulated IPC. Use the existing native
harness for filesystem persistence, Tauri plugins, restart durability and window
behavior; follow [E2E conventions](../../e2e/README.md). Native tests retain
their pinned binary, disposable app-data/vault, and background presentation.
The fixture rejects unsupported IPC commands. For example, editor publication
owner binding currently logs an unsupported-command error; this browser loop
does not establish chat publication correctness. Use the native publication
suite for that behavior rather than adding a blanket successful IPC fallback.

For explicitly requested interactive failure debugging, run
`pnpm agent:test --debug=agent --spec ./specs/my-change.e2e.js`, inspect the
reported debug session with `agent:session -s <reported-name>`, then `resume`.
This waits for an agent and belongs outside unattended CI.

References: [session commands](https://webdriver.io/docs/session),
[export](https://webdriver.io/docs/session/export),
[compatibility research](../research/webdriverio-agent-verification-2026-10-21.md).
