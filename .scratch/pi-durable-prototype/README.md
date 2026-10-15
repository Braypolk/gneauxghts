# Isolated native Pi experiment

Read [results](results.md) and [validation](validation.md) first. The recommendation
is to defer adoption; this is disposable native experiment code, not a migration.

All commands run from this worktree with installed pnpm/Cargo dependencies.

```sh
pnpm pi:prototype desktop       # opt-in app; link from diagnostic to actual UI
pnpm pi:prototype ui-gate       # builds desktop, fixtures, real editor, kill/relaunch
pnpm pi:prototype fault-gate    # desktop intent/publication/receipt/network faults
pnpm pi:prototype ios-ui-gate   # builds and tests dedicated simulator app
```

Desktop gates use the repository's background embedded WebDriver. They do not
foreground the ordinary app. Simulator default UDID is the disposable
`FBAC4D90-9149-4B49-B40D-EA5B90B7069C`; override `PI_PROTOTYPE_SIMULATOR` only
with another disposable simulator. `PI_PROTOTYPE_IOS_APP` can reuse an explicitly
built prototype app. The iOS gate uninstalls **only its prototype bundle** on that
simulator for its fresh first pass.

The runner prints the disposable data/evidence root. To manually reuse data,
set `PI_PROTOTYPE_DATA=/absolute/disposable/path`. Never point it at a real vault.
The app enforces a separate bundle identity, Keychain service and forced synthetic
vault; Pi and native effect DBs live under `PROTOTYPE-wipe-me`.

`gate`/`ios-gate` are diagnostic/API gates; `ui-gate`/`ios-ui-gate` additionally
operate the actual existing chat/editor UI. Fixture HTTP is loopback only, rejects
credentials, and enables bounded diagnostic/fault commands. No live provider or
physical device is required for these commands.

Pin: Durable/AI/Chord 1.3.0, no upstream patch. The iOS runner has a documented
SDK/runtime preflight workaround in [validation](validation.md). It uses normal
Xcode compile/link/signing against the installed simulator after compiling the
same Rust library itself; it does not patch Tauri or the SDK.
