# Native Pi validation (in progress)

2026-10-15. Branch `codex/pi-durable-native-prototype`. Baseline plan/research
checkpoint `c9d949f`; bridge checkpoint `d96eff8`; provider extension checkpoint in progress. Published Pi
Durable/AI/Chord are pinned at 1.3.0 in the application lockfile.

## Environment and isolation

Apple Silicon host, Xcode 27.0 (27A266a), Simulator SDK 27.0. Installed
runtimes include 18.5, 26.1 and 26.4/26.4.1; no 27.0 runtime. Dedicated
simulator created for this experiment: `FBAC4D90-9149-4B49-B40D-EA5B90B7069C`
(`Gneauxghts Pi Prototype`, iPhone 17 Pro, 26.4.1 runtime).

`pi-prototype` Rust feature plus `VITE_PI_PROTOTYPE=true`; separate bundle ID
`com.braypolkinghorne.gneauxghts.pi-prototype`, separate Keychain service,
forced disposable vault (desktop app-data `PROTOTYPE-wipe-me/vault`; iOS Documents `PROTOTYPE-wipe-me`). Native desktop uses the background E2E
presentation policy. No ordinary vault, app, credentials, or original checkout
files were edited. Build artifacts were APFS-cloned into this worktree.

## Observations

| Check | Result and limit |
| --- | --- |
| Initial Rust feature check | Pass: `cargo check --manifest-path src-tauri/Cargo.toml --features pi-prototype,e2e-wdio` |
| Frontend/E2E type check | Pass: `pnpm check`, zero errors/warnings |
| Actual desktop WKWebView → IPC → SQLite | Pass: mounted `/pi-prototype`, embedded WebDriver observed live document and diagnostic |
| Native callback rollback | Pass: intentionally thrown callback leaves no inserted row and preserves callback error |
| Competing facade operations | Pass: ordinary query waits for transaction commit, reads committed row |
| Stale facade transaction handle | Pass: escaped handle rejects after callback settlement |
| Pi submit/committed history | Pass: `pi.user`/`pi.assistant` entries, submission 8 `done` |
| Pi document/receipt close-reopen and process relaunch | Pass on desktop (SIGKILL) and actual iOS simulator (terminate/relaunch); prior committed submission receipt restored |
| iOS Tauri CLI build | Tooling failure before Rust compilation: SDK/runtime preflight requires runtime >=27.0 |
| iOS Xcode build targeting installed simulator | Pass: actual signed simulator app, observed WKWebView diagnostic and native SQLite |
| Native provider protocols | Pass on desktop and simulator: Responses and compatible Chat SSE; split tool arguments, streamed text, scoped read, follow-up, cancellation and broken stream |
| Native storage unit probes | Pass: 2 focused rollback/stale-owner tests; 956 unrelated tests filtered |
| Real chat/review UI and publication matrix | Pending issue 03/04; diagnostics are not chat UI acceptance |

Initial native probe diagnostic (before disposable-root correction) is in the
separate prototype bundle's Application Support directory. Subsequent runs use
`state::app_data_dir()` so the runner's disposable app-data override owns both
Pi's DB and diagnostics. No database is in the ordinary app namespace.

## iOS preflight diagnosis and bounded workaround

`xcodebuild -showsdks` and `xcrun --sdk iphonesimulator --show-sdk-path` confirm
SDK 27.0 exists. `xcodebuild -showdestinations` lists the dedicated 26.4.1
simulator as eligible. [cargo-mobile2 source](https://github.com/tauri-apps/cargo-mobile2/blob/dev/src/apple/target.rs)
`validate_sdk` compares the default SDK's Version with installed runtime versions
and rejects older ones before asking Xcode to build. A read-only source checkout
is retained under `/private/tmp/gneauxghts-pi-cargo-mobile2`.

The runner's iOS lane builds the same Rust library with `pi-prototype` and
`tauri/custom-protocol` (embedded frontend), then uses an isolated generated
Xcode project copy whose redundant Rust prebuild phase is replaced by that
already-completed build. Xcode retains its actual compile/link/resource/signing
steps and explicitly targets the disposable simulator. No installed SDK/runtime,
Tauri binary, or Pi package is patched. This workaround is prototype harness
cost, not evidence of stock Tauri CLI compatibility.

## Reproduction and local logs

- `pnpm pi:prototype desktop` (background native app; retain printed data root).
- `PI_PROTOTYPE_DATA=/absolute/disposable/root pnpm pi:prototype desktop` to reuse
  its Pi database for process-relaunch checks.
- `PI_PROTOTYPE_SIMULATOR=<disposable-udid> pnpm pi:prototype ios` builds a signed
  simulator app; install/launch and inspect its reported diagnostic separately.
- Logs: `/private/tmp/gneauxghts-pi-{check,ts-check,desktop,desktop-2,ios-build,ios-xcode,ios-destinations}.log`.

Physical-device, live-provider, radio, lock/suspension and physical memory
acceptance are unverified. Simulator checks cannot establish those behaviors.

## Bridge protocol evidence

Synthetic requests and actual webview reports: [desktop](evidence/desktop-bridge.json), [simulator](evidence/ios-bridge.json), [simulator relaunch screenshot](evidence/ios-bridge-relaunch.png). Twenty native HTTP requests per gate cover first launch and relaunch. Fixtures reject Authorization headers; no live provider was called. Native inference retains credentials and owns only one HTTP request at a time per call; Pi owns tool/model coordination.

iOS startup initially failed because the prototype vault was under Application Support, violating the existing iOS immediate-Documents-child policy. The prototype now selects Documents/PROTOTYPE-wipe-me inside its separate bundle container; no policy bypass was added. WKWebView reports a compatibility user agent (`iPhone OS 18_7`); runtime identity comes from simctl/Xcode, not that string.
