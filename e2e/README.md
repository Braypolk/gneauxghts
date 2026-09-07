# End-to-end testing

The end-to-end gate has a fast browser layer and a native Tauri layer. Both drive
the production Svelte workspace and preserve the application state-machine
boundaries.

## Fast browser layer

```sh
pnpm test:e2e:browser
```

Vite runs with `VITE_E2E_BROWSER=true`, installing a deterministic development-only
Tauri IPC implementation. WebdriverIO then drives the application in Chrome.

Use this layer for behavior whose backend can be deterministic:

- note, chat, and proposal interactions;
- pane transitions and editor isolation;
- History Mode presentation and navigation;
- external-conflict UI states.

## Native Tauri layer

```sh
pnpm test:e2e:native
```

This command runs the shared TypeScript and Rust timeline-contract checks, builds
a debug binary with the `e2e-wdio` Cargo feature, and drives the real macOS Tauri
window through its embedded WebDriver provider. Each spec receives temporary
application-data, documents, vault, and Keychain namespaces that are removed on
completion. Specs run as separate WebDriver invocations so fixture and window
state cannot leak between them.

Use this layer only when behavior depends on native integration:

- application and embedded-driver lifecycle;
- real filesystem publication, observation, and recovery;
- Editing Window capture and finalization;
- History Mode paging, diff, restore, and exact editor-state return;
- corrupt-store reset and forgotten or missing-note recovery;
- Tauri plugins or real window geometry.

The automation bridge, deterministic watcher flush, and fault helpers compile
only with `e2e-wdio`; ordinary builds do not expose them. The watcher helper
consumes the real temporary-vault state at the same adapter boundary as OS
notifications.

## Full gate

```sh
pnpm check
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:e2e:native
```

## Scenario ownership

| Scenario | Browser | Native |
| --- | --- | --- |
| Note/proposal switching and stale completions | Primary | Smoke only |
| External edit conflict choices | Primary | Filesystem smoke |
| Note/chat scroll and pane lifecycle | Primary | Window smoke |
| Rig run start, cancel, retry, and reopen | Primary | Not required |
| Window geometry and driver reconnection | Not applicable | Primary |
| Timeline capture, paging, diff, and restore | Fixture coverage | Primary |
| Missing-note and corrupt-store recovery | Fixture coverage | Primary |

Extend the browser IPC fixture or a native temporary-vault fixture for new cases.
Do not bypass document, pane, chat, proposal, timeline, or external-sync owners.
