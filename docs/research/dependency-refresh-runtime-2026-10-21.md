# Runtime dependency refresh — 2026-10-21

Registry versions and upstream changes were checked on 2026-10-21. This is compatibility research, not a claim that the proposed versions have passed this application's tests. The integration report records the actual installed versions and verification results. Sources are maintainer repositories and package registries.

## Recommended targets

| Dependency | Starting manifest | Latest / recommendation |
| --- | --- | --- |
| `@earendil-works/chord`, `pi-ai`, `pi-durable` | exact `1.3.0` | Keep `1.3.0`; already latest, published October 15 |
| `@tauri-apps/api` | exact `2.11.0` | `2.12.4` |
| `@tauri-apps/cli` | exact `2.11.2` | `2.12.4` (published October 21) |
| Rust `tauri` / `tauri-build` | `2.11` / `2` | `2.12.5` / `2.7.4`; their patch numbers need not equal JS API/CLI |
| Tauri dialog / opener / process, both JS and Rust | `2.7.1` / `2.x` / `2.3.1` JS ranges | `2.8.3` / `2.7.2` / `2.4.0`, coordinated pairs |
| WDIO CLI, local-runner, mocha-framework, spec-reporter, types | exact `9.30.1` | `9.32.0`; defer latest major `10.1.0` |
| `@wdio/globals` | exact `9.29.1` | `9.31.3`, latest stable 9.x |
| `@wdio/tauri-service`, `@wdio/tauri-plugin`, Rust `tauri-plugin-wdio`, `tauri-plugin-wdio-webdriver` | `1.3.0` | Upgrade all four to `1.5.0` |
| `diff` | exact `8.0.4` | `9.0.0` |
| `markdown-it` | `^14.1.0` | `15.0.3` with bundled types; `14.3.3` is the conservative patched fallback |
| `clsx` | `^2.1.1` | Already latest `2.1.1` |

Version evidence: [Pi AI registry](https://registry.npmjs.org/@earendil-works/pi-ai), [Pi Durable registry](https://registry.npmjs.org/@earendil-works/pi-durable), [Chord registry](https://registry.npmjs.org/@earendil-works/chord), [Tauri API registry](https://registry.npmjs.org/@tauri-apps/api), [CLI registry](https://registry.npmjs.org/@tauri-apps/cli), [Rust Tauri registry](https://crates.io/api/v1/crates/tauri), [Rust build registry](https://crates.io/api/v1/crates/tauri-build), [WDIO CLI](https://registry.npmjs.org/@wdio/cli), [WDIO globals](https://registry.npmjs.org/@wdio/globals), [Tauri service](https://registry.npmjs.org/@wdio/tauri-service), [Tauri plugin](https://registry.npmjs.org/@wdio/tauri-plugin), [diff](https://registry.npmjs.org/diff), [markdown-it](https://registry.npmjs.org/markdown-it), [clsx](https://registry.npmjs.org/clsx).

## Pi: retain the current runtime and OAuth patch

The three direct Pi packages are already current. Preserve the exact coordinated pins and `patches/@earendil-works__pi-ai@1.3.0.patch`. The local patch implements returning-client OAuth registration reuse, callbacks without a repeated client ID, rejection of changed client IDs, and structured terminal OAuth errors. The repository's [patch rationale](../../patches/README.md) requires exercising the real loopback helper tests against source and bundled code before removing it. There is no newer published Pi version to justify patch removal. Registry metadata declares Node `>=22.19.0` for these packages.

[Architecture](../../ARCHITECTURE.md) and [ADR 0012](../adr/0012-found-ordinary-chat-on-pi.md) make Pi the conversation/task/history owner while native code owns authority and exact publication proof. A future Pi migration must preserve task recovery, review document upgrades, native commit reconciliation and OAuth isolation; it must not silently replace this seam with an independent scheduler or provider SDK. This refresh does not require an architecture change.

The initial npm audit's Pi paths concern `undici` reached through the optional peer of the pinned OpenAI SDK. [`openai@7.19.0` metadata](https://registry.npmjs.org/openai/7.19.0) accepts `undici >=5 <9`; updating its resolved 7.x instance to `>=7.29.1` is compatible with that declared range and does not require changing Pi. Prefer a fresh transitive resolution before a scoped override. See the [Undici advisory](https://github.com/advisories/GHSA-3wwx-pv8p-q78v). Do not interpret an advisory's dependency path as proof that the application exposes its affected API: native transport supplies the ordinary model HTTP path.

## Tauri: coordinated upgrade, useful reliability fixes

The Rust and JS API 2.12 series add asynchronous `asset://` loading, which can prevent slow filesystem access from blocking every window. Later fixes preserve channel delivery after a JavaScript callback throws, avoid mobile process aborts on late plugin replies, clean up window-bound listeners and improve macOS restart via LaunchServices. These are relevant to images, event-driven state, cancellation and restart. [Rust changelog](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md), [JS API changelog](https://github.com/tauri-apps/tauri/blob/dev/packages/api/CHANGELOG.md).

Potential follow-ups available after the update:

- Explicit async resource disposal (`await using`) can simplify cleanup of supported resource handles. Browser/polyfill support still needs checking before adoption.
- `appDirectoriesOverride` could support a deliberate portable installation mode. It must remain a separate product/architecture decision because the app currently has explicit running-vault and app-local path ownership.
- The core `app.exit` API can remove a process-plugin dependency when an app only needs exit. This application also has coordinated restart, so do not remove the plugin automatically.
- New fullscreen-on-monitor controls and macOS Liquid Glass effects are optional UI capabilities; no need to change presentation during a dependency refresh.

All these capabilities are documented in the [2.12 changelogs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md).

Compatibility checks: plugins now declare Rust 1.95 in the registry (the project already declares 1.95). The core 2.12 Android build change raises Gradle's minimum to 8.13; this matters if the Android target is generated/built. Opener's public Windows error payload moved to `windows` 0.62; inspect callers only if they name that concrete error type. JS plugin global scripts now reuse `window.__TAURI__` instead of bundling another core API. Dialog fixes browser confirm permissions; opener fixes nested-runtime panics in Linux reveal operations. [Dialog changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/CHANGELOG.md), [Opener changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/opener/CHANGELOG.md), [Process changelog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/process/CHANGELOG.md).

The current CLI 2.12.4 also updates its bundled Rust zip dependency to address three advisories. This does not update the application's separate direct Rust zip dependency. [CLI changelog](https://github.com/tauri-apps/tauri/blob/dev/packages/cli/CHANGELOG.md).

## WebdriverIO: update version 9; defer version 10

The latest [`@wdio/tauri-service@1.5.0`](https://registry.npmjs.org/@wdio/tauri-service/1.5.0) still declares a `webdriverio ^9.0.0` peer and pins its own runtime to 9.31.9. A blanket WDIO 10 upgrade would violate that compatibility contract. In addition, version 10 removes `executeAsync`, used extensively in `e2e/support/browserPi.ts`, `liveNative.ts`, `piChatAcceptance.ts`, and many browser specifications. Migration requires converting callback completion to promise-returning `execute`, evaluating strict selector behavior, and moving to Node >=22.19.0 and the new assertion/runtime peers. [Official v10 migration guide](https://webdriver.io/docs/v10-migration).

Keep the 9.x maintenance line and refresh the paired Tauri service/plugins to 1.5.0. Upstream's [tagged 1.3-to-1.5 comparison](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service%40v1.3.0...wdio-tauri-service%40v1.5.0) fixes embedded window dimensions to use CSS pixels, waits for actual window state after resize, avoids repeated-window-event panics, evaluates scripts on their own session's port, and improves failed-start/teardown cleanup. Those address useful sources of native-test flakiness. Confirm native resize measurements after upgrading because correcting physical-vs-CSS pixel handling can legitimately change geometry. The logging cleanup in this range removes internal aliases; the app's current `captureBackendLogs` and `captureFrontendLogs` options remain in use upstream.

A later WDIO 10 migration could provide portable traces, live debugging and richer browser emulation, useful for diagnosing editor focus and motion tests. It is a separate migration after Tauri-service declares support. [Official v10 release](https://webdriver.io/blog/2026/10/05/webdriverio-v10-release).

Security caveat: version 9.32's [`@wdio/utils`](https://registry.npmjs.org/@wdio/utils/9.32.0) upgrades `deepmerge-ts` to 8, but Tauri service can retain older nested WDIO packages. WDIO 9's Mocha adapter still requests Mocha 10, and its browser downloader still requests Puppeteer browsers 2; older transitive advisory paths may remain. Do not force Mocha 12/Puppeteer 3 across their majors just to make audit output green. Re-audit the actual final graph and document unresolved tool-only paths separately from production runtime exposure.

## Markdown and diff majors are locally manageable

`markdown-it` 15 bundles TypeScript declarations, removes internal subpath exports, moves URL methods onto the prototype and adopts `linkify-it` 6 with changed fuzzy-link defaults. The app imports only the root package and disables linkify in `src/lib/features/chat/ui/piMarkdown.ts`; the obsolete internal-token name exists only in the local ambient declaration. Remove the any-only `src/types/markdown-it.d.ts` shim and its triple-slash references when adopting native types, then typecheck and exercise admitted citations, external links and unsafe-link rejection. Instance assignment of `validateLink` remains a suitable override. [Upstream changelog](https://github.com/markdown-it/markdown-it/blob/master/CHANGELOG.md).

Useful gains: shipped types can replace local `any`, reference-label/token metadata could support future rendering features, and 15.0.1–15.0.3 fix quadratic behavior in link/reference/HTML/smartquote parsing. The current HTML/linkify-disabled configuration limits some affected paths, but reference parsing still makes the update valuable. These capabilities are optional; citation authority must remain in the native admission seam.

`diff` 9 drops ES5 and changes patch filename quoting, malformed-header handling and `StructuredPatch` filename types. The only direct application import is `diffArrays` in edit review highlighting, so those patch APIs are not used here. Modern Tauri WebViews support the required JS features. Run the existing edit review tests to check whitespace highlighting, max-edit limits and the exact-patch fallback. Git-style patch support is new but is not a reason to replace Pi's publication/patch ownership. The upstream 4x performance claim belongs to unreleased version 10, not the proposed stable 9 update. [Diff release notes](https://github.com/kpdecker/jsdiff/blob/master/release-notes.md).
