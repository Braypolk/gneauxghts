# iPhone simulator smoke validation

Tested checkout `c9b8a990` on an iPhone 17 Pro simulator, iOS 26.1 (23B86), with Xcode 26.4.1 (17E202), using the iOS 26.4 simulator SDK. This is a bounded native smoke test, not release acceptance.

## Build setup and limits

Installed the Rust `aarch64-apple-ios-sim` target. Both the simulator Rust library build and `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios-sim --lib --offline` passed, including the mobile suspension branch. The check reports one existing unused-mut warning in `semantic/legacy_jina.rs`.

The ordinary `pnpm tauri ios build --debug --target aarch64-sim --no-sign --ci` path stops because the installed simulator runtimes (18.5 and 26.1) do not match Xcode's 26.4 SDK. Direct Xcode target compilation succeeds for Rust but fails when compiling the icon catalog and launch storyboard. A matching 8.46 GB runtime download was started, then stopped while pursuing a smaller smoke-test path.

The successful temporary Xcode project used the current compiled native library, omitted the icon catalog, and substituted an empty `UILaunchScreen` dictionary for the launch storyboard. No application source or tracked Xcode configuration changed. The temporary project was removed after packaging. The build is therefore suitable for application smoke checks, but does not validate production packaging, icons or the real launch storyboard.

The frontend runs from the current checkout through a separate Vite server on port 1438, started by:

```sh
pnpm tauri ios dev 'iPhone 17 Pro' --no-watch --config '{"build":{"beforeDevCommand":"pnpm dev --port 1438","devUrl":"http://localhost:1438"}}'
```

That CLI opens Xcode after its runtime check fails; direct `xcodebuild -target gneauxghts_iOS -sdk iphonesimulator` supplied native compilation. The smoke app was installed and launched with `simctl`. The simulator and frontend server were left running for inspection; the smoke app needs that server.

## Observed results

| Check | Result |
| --- | --- |
| Native launch and editor rendering | Passed after frontend startup; blank initial screen eventually rendered |
| Touch software-keyboard note editing | Passed; entered `test` through keyboard buttons |
| Note background and process restart | Passed; backgrounded immediately after editing, verified `test` in the vault Markdown file, terminated/relaunched, and saw `test` restored |
| List and Settings navigation | Passed; routes and portrait controls rendered and responded to taps |
| Portrait software keyboard | Editor dock and chat composer remained visible above the keyboard |
| Unsent chat background and restart | Passed; entered `Test`, backgrounded, found it in `ai.sqlite3`'s `chat_composer_drafts`, terminated/relaunched, reopened thought partner, and saw `Test` restored |
| No accidental chat submission | Passed; the disposable vault's `chat_conversations` table remained empty |
| Landscape layout at original smoke checkpoint | Reproduced safe-area and keyboard overlap; subsequently fixed in the working-tree frontend, as recorded below |

Tests used the simulator's app-local disposable vault. No desktop vault or provider credentials were used. Hardware text injection produced incorrect characters in the simulator; software-keyboard taps were used for the verified note/chat markers.

The lifecycle checks establish observed persistence across these simulator journeys. They do not isolate native-event dispatch from DOM signals or prove completion before the debounce deadline, since UI automation timing was not controlled. Browser tests separately cover the before-debounce requirement. Termination happened after durable text was verified, so immediate process-kill recovery remains untested.

## Findings and remaining validation

The [landscape implementation record](../archive/mobile-landscape-viewport.md) consolidates issues 09 and 10. A follow-up with this same native smoke package and the current working-tree frontend reproduced a 402px layout viewport shrinking to a 126px visual viewport when the landscape keyboard opened (offsetTop 0, scrollY 0). The shell now fits that visible height.

Follow-up observations: Settings clears the right-side Dynamic Island; editor controls and a text line stay visible with the keyboard on both landscape edges; returning from Settings restores usable editor focus; the chat input/tools/send remain above the landscape keyboard; upright portrait rotation and keyboard dismissal retain the unsent `Test` draft. No message was submitted. Browser regressions separately cover both cutout edges on all routes and selected overlays, end-of-note caret scrolling, keyboard reopening and retained drafts.

Repeat these with the normal packaged app and a physical iPhone before treating the temporary smoke package as release acceptance. This validates current frontend geometry, not later native vault-switching changes.

The [device release gate](issues/08-ios-device-release-gate.md) remains open for standard packaging, actual lock/suspension/abrupt termination, attachments, IME/selection, accessibility, representative vault performance and on-device model memory. Semantic search and private local AI parity were not validated by this smoke test.

## Touch editing follow-up

With the current [touch editing implementation](../archive/mobile-touch-editing.md) and the same temporary native package, a clean relaunch restored the unsent `Test` draft. Tapping software Return inserted a newline; subsequent software-keyboard taps produced `Test` on a second line. Both lines remained after keyboard dismissal in New chat without a visible submitted message. Native Send was not pressed. Native link opening/return, real IME and physical attached-keyboard behavior remain release-gate checks; the mounted browser suite covers those app handlers with controlled external dependencies.
