# Rust dependency refresh audit — 2026-10-21

This is a pre-update research snapshot, not evidence that the proposed upgrades have passed application tests. It covers every direct dependency in `src-tauri/Cargo.toml`, the vendored vector kernel, and `rust-toolchain.toml`. Versions were read directly from the crates.io API on October 21, 2026; release notes and relevant call sites were inspected. The parent dependency-refresh task owns actual edits and validation.

## Recommendation

Refresh compatible packages and the small, reviewed API migrations listed below. Keep `rusqlite` 0.32.1 until its persistence behavior changes are tested deliberately. Keep direct `syn` 2 until the architecture-test parser is migrated. Preserve the `corenn-kernels` patch. Rust 1.95.0 already meets the documented minimum versions of these proposed dependencies; the latest compiler is 1.99.1, but a toolchain upgrade is separately testable work.

A version constraint such as `"1"` or `"2"` does not describe the installed version: `Cargo.lock` does. Some dependencies are already current. Multiple versions of `syn`, `getrandom`, `base64`, `sha2`, and `thiserror` in the lockfile are transitive requirements; the table identifies the application's direct version.

## Complete direct inventory

Each package link is the primary registry endpoint used for latest stable version and release metadata. Prereleases and yanked releases were excluded by using `max_stable_version`.

| Package | Declared before refresh | Locked direct version | Latest stable | Recommendation |
| --- | --- | --- | --- | --- |
| [tauri](https://crates.io/api/v1/crates/tauri) | `2.11` | 2.11.2 | 2.12.5 | Update; validate |
| [tauri-plugin-wdio](https://crates.io/api/v1/crates/tauri-plugin-wdio) | `1.3.0` | 1.3.0 | 1.5.0 | Update; validate |
| [tauri-plugin-wdio-webdriver](https://crates.io/api/v1/crates/tauri-plugin-wdio-webdriver) | `1.3.0` | 1.3.0 | 1.5.0 | Update; validate |
| [tauri-plugin-dialog](https://crates.io/api/v1/crates/tauri-plugin-dialog) | `2` | 2.7.1 | 2.8.3 | Update; validate |
| [tauri-plugin-opener](https://crates.io/api/v1/crates/tauri-plugin-opener) | `2` | 2.5.3 | 2.7.2 | Update; validate |
| [tauri-plugin-process](https://crates.io/api/v1/crates/tauri-plugin-process) | `2` | 2.3.1 | 2.4.0 | Update; validate |
| [tauri-plugin-keyring-store](https://crates.io/api/v1/crates/tauri-plugin-keyring-store) | `=0.2.0` | 0.2.0 | 0.2.0 | Already current |
| [serde](https://crates.io/api/v1/crates/serde) | `1` | 1.0.228 | 1.0.229 | Update; validate |
| [serde_json](https://crates.io/api/v1/crates/serde_json) | `1` | 1.0.151 | 1.0.154 | Update; validate |
| [base64](https://crates.io/api/v1/crates/base64) | `0.22` | 0.22.1 | 0.23.1 | Update; validate |
| [blake3](https://crates.io/api/v1/crates/blake3) | `1.5` | 1.8.3 | 1.8.7 | Update; validate |
| [getrandom](https://crates.io/api/v1/crates/getrandom) | `0.3` | 0.3.4 | 0.4.3 | Update; validate |
| [sha2](https://crates.io/api/v1/crates/sha2) | `0.10` | 0.10.9 | 0.11.1 | Update; validate |
| [libloading](https://crates.io/api/v1/crates/libloading) | `0.7.4` | 0.7.4 | 0.9.0 | Update; validate |
| [image](https://crates.io/api/v1/crates/image) | `=0.25.9` | 0.25.9 | 0.25.10 | Update exact pin; image fixtures |
| [flate2](https://crates.io/api/v1/crates/flate2) | `1` | 1.1.9 | 1.1.10 | Update; validate |
| [tar](https://crates.io/api/v1/crates/tar) | `0.4` | 0.4.46 | 0.4.46 | Already current |
| [zip](https://crates.io/api/v1/crates/zip) | `2` | 2.4.2 | 9.0.5 | Update; validate |
| [hnswlib-rs](https://crates.io/api/v1/crates/hnswlib-rs) | `0.10` | 0.10.0 | 0.10.0 | Already current |
| [leiden-rs](https://crates.io/api/v1/crates/leiden-rs) | `0.8.1` | 0.8.1 | 0.8.1 | Already current |
| [ndarray](https://crates.io/api/v1/crates/ndarray) | `0.17` | 0.17.2 | 0.17.2 | Already current |
| [rayon](https://crates.io/api/v1/crates/rayon) | `1.10` | 1.12.0 | 1.12.0 | Already current |
| [umap-rs](https://crates.io/api/v1/crates/umap-rs) | `0.4.5` | 0.4.5 | 0.4.5 | Already current |
| [tantivy](https://crates.io/api/v1/crates/tantivy) | `0.25` | 0.25.0 | 0.27.0 | Update; validate |
| [reqwest](https://crates.io/api/v1/crates/reqwest) | `0.13` | 0.13.2 | 0.13.5 | Update; validate |
| [futures-util](https://crates.io/api/v1/crates/futures-util) | `0.3` | 0.3.33 | 0.3.34 | Update; validate |
| [tokio](https://crates.io/api/v1/crates/tokio) | `1` | 1.53.1 | 1.54.0 | Update; validate |
| [tokio-util](https://crates.io/api/v1/crates/tokio-util) | `0.7` | 0.7.18 | 0.7.20 | Update; validate |
| [rusqlite](https://crates.io/api/v1/crates/rusqlite) | `0.32` | 0.32.1 | 0.40.2 | Defer: persistence migration |
| [similar](https://crates.io/api/v1/crates/similar) | `3.2` | 3.2.0 | 3.2.0 | Already current |
| [pulldown-cmark](https://crates.io/api/v1/crates/pulldown-cmark) | `0.13.4` | 0.13.4 | 0.13.4 | Already current |
| [zstd](https://crates.io/api/v1/crates/zstd) | `0.13` | 0.13.3 | 0.14.3 | Update; historical payload fixtures |
| [notify](https://crates.io/api/v1/crates/notify) | `6.1` | 6.1.1 | 8.2.0 | Update; validate |
| [thiserror](https://crates.io/api/v1/crates/thiserror) | `2` | 2.0.18 | 2.0.21 | Update; validate |
| [url](https://crates.io/api/v1/crates/url) | `2` | 2.5.8 | 2.5.8 | Already current |
| [percent-encoding](https://crates.io/api/v1/crates/percent-encoding) | `2` | 2.3.2 | 2.3.2 | Already current |
| [regex](https://crates.io/api/v1/crates/regex) | `1` | 1.12.3 | 1.13.1 | Update; validate |
| [chrono](https://crates.io/api/v1/crates/chrono) | `0.4` | 0.4.44 | 0.4.45 | Update; validate |
| [chrono-tz](https://crates.io/api/v1/crates/chrono-tz) | `0.10` | 0.10.4 | 0.10.4 | Already current |
| [iana-time-zone](https://crates.io/api/v1/crates/iana-time-zone) | `0.1` | 0.1.65 | 0.1.65 | Already current |
| [serde_yaml](https://crates.io/api/v1/crates/serde_yaml_ng) | `0.10` | 0.10.0 | 0.10.0 | Already current |
| [tauri-build](https://crates.io/api/v1/crates/tauri-build) | `2` | 2.6.2 | 2.7.4 | Update; validate |
| [syn](https://crates.io/api/v1/crates/syn) | `2` | 2.0.117 | 3.0.9 | Defer: architecture-test AST migration |
| [proc-macro2](https://crates.io/api/v1/crates/proc-macro2) | `1` | 1.0.106 | 1.0.107 | Update; validate |
| [objc2-app-kit](https://crates.io/api/v1/crates/objc2-app-kit) | `0.3.2` | 0.3.2 | 0.3.2 | Already current |
| [security-framework](https://crates.io/api/v1/crates/security-framework) | `3.7` | 3.7.0 | 3.7.0 | Already current |
| [security-framework-sys](https://crates.io/api/v1/crates/security-framework-sys) | `2.17` | 2.17.0 | 2.17.0 | Already current |
| [tauri-plugin-window-state](https://crates.io/api/v1/crates/tauri-plugin-window-state) | `2` | 2.4.1 | 2.5.0 | Update; validate |
| [corenn-kernels](https://crates.io/api/v1/crates/corenn-kernels) | `0.1.1` | 0.1.1 | 0.1.1 | Keep local stable-Rust patch |

## Breaking changes checked against this application

### Tauri and native plugins

Upgrade Tauri to 2.12.5 and tauri-build to 2.7.4 together with the JavaScript Tauri packages and plugins. Tauri 2.12 moves to Rust edition 2024 and MSRV 1.90; this application's own edition need not change. Android's minimum Gradle becomes 8.13. Review generated Android build configuration if Android is shipped. Changes to ACL denial scoping, listeners, channel disposal, and native lifecycle behavior justify a native smoke test even though the Cargo update is semver-compatible. [Tauri changelog](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md).

The dialog, process, and window-state updates share the MSRV 1.90 increase and global-script core-API unification. Opener updates its Windows error dependency; the application does not directly name that Windows type. Opener 2.7.2 fixes nested Tokio-runtime panics when revealing files on Linux/BSD. Check dialogs, external links, reveal-in-folder, restart, and window restore. [Dialog](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/CHANGELOG.md), [process](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/process/CHANGELOG.md), [window-state](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/window-state/CHANGELOG.md), [opener](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/opener/CHANGELOG.md).

The two WDIO native plugins should move together to 1.5.0 and match the frontend WDIO integration. Their registry versions are verified; the GitHub releases feed did not provide a complete 1.3-to-1.5 changelog, so actual native driver/command-mocking tests remain necessary. [Plugin registry](https://crates.io/api/v1/crates/tauri-plugin-wdio), [WebDriver registry](https://crates.io/api/v1/crates/tauri-plugin-wdio-webdriver), [upstream releases](https://github.com/webdriverio/desktop-mobile/releases).

### Small API migrations worth doing now

| Dependency | Relevant upstream change | Application compatibility assessment |
| --- | --- | --- |
| getrandom 0.4.3 | 0.4 moves to edition 2024/MSRV 1.85; adds optional `SysRng`; Windows failure checking was fixed. | Application uses `fill`, which remains available. No custom backend migration needed. [Changelog](https://github.com/rust-random/getrandom/blob/master/CHANGELOG.md). |
| sha2 0.11.1 | Digest 0.11/newtypes, low-level compression API relocation, removal of `std`/assembly-selection features; MSRV now 1.88. | Application uses `Digest`/`Sha256` high-level operations and no removed features. Compilation exposed that output arrays no longer implement `LowerHex`; the implementation now uses `hex::encode`, preserving lowercase, zero-padded SHA-256 strings. The existing Web Crypto known-vector and immutable history archive checks verify this contract. [Changelog](https://github.com/RustCrypto/hashes/blob/master/sha2/CHANGELOG.md). |
| base64 0.23.1 | New SIMD engines, added configuration constants, changed details of `InvalidLastSymbol`; MSRV 1.71. | Application uses the engine interface and does not destructure that error. Keep existing alphabet/padding behavior. SIMD is an optional future optimization, not an automatic speed claim for existing `GeneralPurpose` calls. [Release notes](https://github.com/marshallpierce/rust-base64/blob/master/RELEASE-NOTES.md). |
| libloading 0.9.0 | Adds default `std` feature, uses `AsFilename`, changes error variants, broadens symbol lookup arguments; MSRV 1.88. | Existing path-based `Library::new` and byte-slice `get` calls remain supported. No error-variant matching found. Keep the unsafe lifetime/ownership seam unchanged and run native library fixtures. [Changelog](https://github.com/nagisa/rust_libloading/blob/master/src/changelog.rs). |
| notify 8.2.0 | 7 changes event serialization and crossbeam feature naming; 8 moves notify-types to 2, adds symlink-following configuration; MSRV 1.77. | Callback-based `RecommendedWatcher`, `Event`, `Config`, and `Watcher` usage avoids renamed channel features and serialized-event compatibility. Run watcher rename/delete/self-save tests. 9.0 is still prerelease and excluded. [Changelog](https://github.com/notify-rs/notify/blob/main/notify/CHANGELOG.md). |
| zip 9.0.5 | Numerous removed/deprecated APIs across seven major versions; extraction, symlink permissions, declared-size and enclosed-path handling tightened. | Application only uses `ZipArchive::new`, `len`, `by_index`, `size`, and `extract`, avoiding the documented removed metadata/writer APIs. Retain disabled default features and explicit `deflate`. Verify runtime install archives and symlink handling. [Changelog](https://github.com/zip-rs/zip2/blob/master/CHANGELOG.md). |

### Image exact pin

`image = "=0.25.9"` was introduced in commit `25b4df79524415fd4413f349e2ed5039be835007` with Gemma image input. Neither that commit nor searched repository notes explain a compatibility reason for the old exact version. Preserve exact pinning while moving to `=0.25.10`.

The **tagged** 0.25.10 changelog and published crate were checked: MSRV rises to 1.88, extension hooks normalize casing, buffer-copy paths are optimized, and compile-time monomorphizations are reduced. The application registers no custom hooks and uses PNG/JPEG/static-WebP decode, limits, orientation, RGB conversion, thumbnails, and PNG encoding. Existing `image_input` fixtures are the relevant gate. Some mutable upstream `main` changelog content is stale and must not be mistaken for the release notes. [0.25.10 release](https://github.com/image-rs/image/releases/tag/v0.25.10), [published source](https://docs.rs/crate/image/0.25.10/source/CHANGES.md).

### Tantivy: migration is smaller than the version jump suggests

0.27 changes fast-field tokenizer arguments, adds enum variants, removes several low-level writer/weight APIs, and raises MSRV to 1.88. Those low-level APIs are not used by `src-tauri/src/lexical.rs`. Compilation additionally exposed the collector migration: `TopDocs::with_limit` is now a builder, so both search paths explicitly call `.order_by_score()` to preserve existing relevance ordering. Critically, this application calls `Index::create_in_ram`, so there is no persisted Tantivy index to migrate. Recommend upgrading and running lexical query, ranking, incremental-update, and malformed-query tests. New parser fixes address deeply nested queries, malformed-input hangs, and panics. [Tantivy changelog](https://github.com/quickwit-oss/tantivy/blob/main/CHANGELOG.md).

### rusqlite: defer until persistence compatibility is demonstrated

0.35 begins rejecting trailing/multiple SQL statements in `execute`/`prepare`; 0.38 disables unsigned integer SQL conversions by default, makes statement-cache support optional, changes hook restrictions, and raises the SQLite minimum. 0.40.2 uses bundled SQLite 3.53.2 and supports Rust 1.88. The application uses hooks, raw SQLite FFI, transactions, queries, and several long-lived databases. This is a behavior migration, not merely compiler repair. [rusqlite releases](https://github.com/rusqlite/rusqlite/releases), [bundled SQLite version](https://github.com/rusqlite/rusqlite).

Before adoption, audit all SQL calls for multi-statement assumptions, cached statement use, unsigned conversions, authorization hooks, and raw FFI changes. Test reopening existing history/state/chat databases, interrupted writes, WAL recovery, history compaction, corruption classification, and authorization denial. Read `ARCHITECTURE.md` and its persistence invariants before any application changes. Existing SQLite files should be tested directly; do not infer safety solely from successful compilation.

### zstd: API-compatible call sites, historical data still matters

0.14 tightens prepared-dictionary lifetimes and changes `Decoder::finish()` to consume the frame tail; the license changes to BSD-3-Clause. Application code uses only `stream::encode_all` and `decode_all`, so neither API break applies directly. 0.14.2 adds ownership-preserving decoder recovery APIs. Recommend 0.14.3 if Cargo resolves its native dependency alongside Tantivy, with old/new payload roundtrip checks against note-history fixtures. No format change was identified, but persisted history warrants explicit validation. Registry confirms 0.14.3; the available release feed documents through 0.14.2. [0.14 release](https://github.com/gyscos/zstd-rs/releases/tag/v0.14.0), [0.14.2 release](https://github.com/gyscos/zstd-rs/releases/tag/v0.14.2), [registry](https://crates.io/api/v1/crates/zstd).

### syn: keep the direct test dependency on 2 for this pass

Syn 3 reorganizes AST modifiers, safety, receivers, patterns, and types. This application's architecture tests traverse `syn` structures; migrating them deserves focused review so the standards checks do not silently lose coverage. New serde/thiserror/futures macros may depend on syn 3 transitively; that does not require changing the application's direct syn 2 dependency. [Syn 3 release](https://github.com/dtolnay/syn/releases/tag/3.0.0).

## Compatible updates with relevant fixes

| Dependency | Changelog finding and check |
| --- | --- |
| blake3 1.8.7 | Removes `arrayref` after its crate owner's compromise. Digest 0.11 only changes the optional `traits-preview` interface, which this app does not enable. Hash-output fixtures remain useful. [Releases](https://github.com/BLAKE3-team/BLAKE3/releases). |
| reqwest 0.13.5 | Fixes blocking timeout panic, proxy credential selection, and timeout classification; adds `Error::is_dns` and response-header limit configuration. Keep current rustls/blocking/json/stream features and verify provider streaming/downloads. [Releases](https://github.com/seanmonstar/reqwest/releases). |
| flate2 1.1.10 | Rejects incomplete deflate streams/oversized gzip extra fields and fixes a gzip-writing infinite loop; removes Cloudflare backend unused here. Test extraction of valid and truncated runtime downloads. [Release](https://github.com/rust-lang/flate2-rs/releases/tag/1.1.10). |
| regex 1.13.1 | Fixes incorrect match offsets; 1.13 adds a lazy `regex!` macro. Existing parsing/offset tests matter even without a public API break. [Changelog](https://github.com/rust-lang/regex/blob/master/CHANGELOG.md). |
| tokio 1.54 / tokio-util 0.7.20 | MSRV rises to 1.85. Zero-capacity buffers now panic in more APIs; test subprocess streaming and cancellation. Util fixes cancellation notification while locks were held and adds `AbortOnDrop` in 0.7.19. [Tokio](https://github.com/tokio-rs/tokio/blob/master/tokio/CHANGELOG.md), [tokio-util](https://github.com/tokio-rs/tokio/blob/master/tokio-util/CHANGELOG.md). |
| serde 1.0.229 / thiserror 2.0.21 / futures-util 0.3.34 | Internal syn 3 migrations; thiserror improves generic display parsing, futures preserves cloned-waker identity. Existing serialization/error/runtime tests are the gate. [Serde](https://github.com/serde-rs/serde/releases), [thiserror](https://github.com/dtolnay/thiserror/releases), [futures](https://github.com/rust-lang/futures-rs/releases). |
| serde_json 1.0.154 | Fixes invalid UTF-8 error location; numeric fixes are mainly for optional arbitrary-precision mode. Preserve serialized chat/state fixtures. [Releases](https://github.com/serde-rs/json/releases). |
| chrono 0.4.45 / proc-macro2 1.0.107 | Chrono fixes extreme TZ offsets and Android timezone-data paths. Proc-macro2 release is documentation-only. [Chrono](https://github.com/chronotope/chrono/releases), [proc-macro2](https://github.com/dtolnay/proc-macro2/releases). |

## Vector ecosystem and vendored code

`hnswlib-rs` 0.10.0, `umap-rs` 0.4.5, `leiden-rs` 0.8.1, `ndarray` 0.17.2, and `rayon` 1.12.0 are already latest stable. The published UMAP manifest explicitly requires ndarray 0.17 and Rayon 1.10-compatible releases, matching this graph. HNSW explicitly requires corenn-kernels 0.1.1 and half 2.7.1-compatible releases. [UMAP manifest](https://docs.rs/crate/umap-rs/0.4.5/source/Cargo.toml), [HNSW manifest](https://docs.rs/crate/hnswlib-rs/0.10.0/source/Cargo.toml), [Leiden manifest](https://docs.rs/crate/leiden-rs/0.8.1/source/Cargo.toml).

The local corenn source was diffed against the published 0.1.1 crate. Local changes remove `#![feature(f16)]` and architecture-specific unstable f16 feature gates, plus conditional/unreachable-code warnings. Replacing the vendor directory with the identically numbered published package would restore nightly gates. Keep the patch and validate vector/ANN tests after transitive updates. No newer stable kernel release exists. [Published source](https://docs.rs/crate/corenn-kernels/0.1.1/source/src/lib.rs).

## Capabilities worth considering after the update

- **More responsive native asset loading:** Tauri loads asset-protocol files off the event-loop thread; relevant to a notes app opening local images or slow filesystem paths. Its configurable app-directory root could support a future portable installation, but changes to persistence paths require design work. [Tauri changelog](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/CHANGELOG.md).
- **Better search:** Tantivy adds exists queries, tie-breaker fast fields, snippet fragment ranges, and faster top-K intersections. Evaluate improvements with the application's actual lexical workload; upstream benchmark multipliers are not application performance promises. Calculated fields/JIT are experimental and should not be enabled as part of dependency housekeeping. [Tantivy changelog](https://github.com/quickwit-oss/tantivy/blob/main/CHANGELOG.md).
- **Clearer connection failures:** Reqwest's DNS-specific error classification can distinguish connectivity issues from provider rejection in setup/chat UI. [Reqwest release](https://github.com/seanmonstar/reqwest/releases/tag/v0.13.5).
- **Simpler reusable regexes:** `regex!` can replace repetitive lazy-static/OnceLock boilerplate for literal patterns if desired. [Regex changelog](https://github.com/rust-lang/regex/blob/master/CHANGELOG.md).
- **More robust cancellation:** `tokio-util::task::AbortOnDrop` could simplify ownership of spawned tasks, but adopting it changes task lifecycle behavior and should follow the architecture invariants. [Tokio-util changelog](https://github.com/tokio-rs/tokio/blob/master/tokio-util/CHANGELOG.md).

## Toolchain and evidence limits

Rust stable is 1.99.1, published October 15. Its fixes include x86_64 FFI-bool miscompilation and macOS rust-lld library paths; 1.99 also adds a `debug` Cargo profile while preserving current `dev` behavior. The repository pins 1.95.0, which is sufficient for the proposed package MSRVs. Keeping that pin isolates dependency changes; a later 1.99.1 upgrade should run fmt/clippy plus native/FFI and platform builds. [Official release notes](https://doc.rust-lang.org/releases.html).

This audit does not claim Windows/Linux/iOS execution or compatibility from compilation alone. Changelog coverage is strongest for the breaking upgrades; WDIO 1.5 and zstd 0.14.3 have the release-note gaps identified above. The separate implementation summary must record exactly which upgrades landed, tests actually run, and remaining platform validation.
