# End-to-end testing

The end-to-end gate has two intentionally different test layers without changing the application state-machine boundaries.

## Fast browser layer

Run:

```bash
pnpm test:e2e:browser
```

This starts Vite on port 1421 with `VITE_E2E_BROWSER=true`, installs a deterministic in-browser implementation of Tauri IPC, and lets `@wdio/tauri-service` drive the real Svelte application in Chrome. The fixture is development-only and is inert in normal development and release builds.

Covered regressions:

- Initial app bootstrap through the same Svelte workspace used in Tauri.
- Repeated note A / note B switching with assertions that editor documents never cross-contaminate.
- Note → chat → note lifecycle with scroll restoration.

Use this layer for note operations, proposal projection/review, chat rendering, pane transitions, and external-sync UI states whenever backend behavior can be deterministic.

## Native Tauri layer

Run:

```bash
pnpm test:e2e:native
```

The command builds the debug binary with the `e2e-wdio` Cargo feature, starts Vite on port 1420 with `VITE_E2E_NATIVE=true`, and drives the real macOS Tauri window through the embedded WebDriver provider. The lifecycle and timeline specs run as separate WebDriver invocations so restart/window-state mutations cannot leak between them. Each invocation gets a temporary app-data directory, documents directory, vault, and Keychain service namespace, then removes its filesystem fixture. The E2E app uses a separate bundle identifier, and the WebDriver Rust plugins, frontend bridge, and permissions are excluded from normal and release builds.

Covered checks:

- Real application startup through the embedded driver.
- Stable first-painted window geometry after a real WebDriver session restart, guarding against the restore-growth regression.
- Availability of the debug-only Tauri automation bridge.
- Real note edits through capture, paged History Mode, deterministic diff, complete Version Restore, and exact editor scroll/selection restoration.
- Real external file deletion through the watcher adapter, Missing Note discovery, incremental retained-history loading, collision-safe recovery, and continued editing.
- Corrupt-store reset, forgotten-note recovery, restart, and selection, diff, and restore of the recovered timeline.

The native command first runs the shared TypeScript and Rust timeline-contract fixture checks. Its fault and watcher-flush helpers are compiled only by the `e2e-wdio` feature; release builds do not expose them. The deterministic watcher flush consumes the real temporary-vault filesystem state at the same adapter boundary used by OS notifications, avoiding platform event-delivery timing in the assertion path.

Keep this suite focused. Add native cases only for behavior that depends on real window state, filesystem persistence, OS events, restart durability, or Tauri plugins.

## Full Phase 1–3 gate

```bash
pnpm check
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:e2e:native
```

## Scenario ownership

| Scenario | Browser | Native |
| --- | --- | --- |
| Note/proposal switching isolation | Primary | Smoke only |
| External edit conflict choices and stale completions | Primary | Filesystem event smoke |
| Note/chat scroll and pane lifecycle | Primary | Window integration smoke |
| Rig run start/cancel/retry/reopen | Primary | Not required |
| App restart and window geometry | Not applicable | Primary |
| Note Timeline capture, paging, diff, restore, and editor-state return | Fixture coverage | Primary |
| Missing Note deletion, retained-history paging, and safe recovery | Fixture coverage | Primary |
| Corrupt reset and forgotten recovery across restart | Fixture coverage | Primary |

Future cases should extend the app-owned IPC fixture or a native temp-vault fixture. They should not bypass document, pane, chat, proposal, or external-sync controllers.
