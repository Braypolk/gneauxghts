# Dependency refresh — 2026-10-21

Reviewed all 47 direct npm dependencies and every direct Cargo dependency against registry metadata, upstream release notes, local API usage, patches, and declared peer/MSRV constraints. Updated 37 direct npm dependencies, compatible transitive dependencies, and the native dependency graph. Existing unrelated working-tree changes were preserved.

Detailed inventories and primary sources:

- [Frontend and build tooling](dependency-refresh-frontend-2026-10-21.md)
- [Pi, Tauri, WebdriverIO, Markdown, and diff](dependency-refresh-runtime-2026-10-21.md)
- [Rust libraries, compiler constraints, and vendored code](dependency-refresh-rust-2026-10-21.md)

## Applied versions and compatibility work

| Area | Selected upgrade |
| --- | --- |
| Frontend toolchain | Svelte 5.57.2, Kit 3.1.0, adapter-static 4.0.0, plugin-svelte 7.3.1, Vite 8.3.5, TypeScript 6.0.3, svelte-check 4.7.7 |
| Testing | Vitest 4.1.12; WDIO packages 9.32.0 (globals 9.31.3); Tauri service/plugin 1.5.0 in JS and Rust |
| Desktop runtime | Tauri Rust 2.12.5, build 2.7.4, JS API/CLI 2.12.4; dialog 2.8.3, opener 2.7.2, process 2.4.0 |
| Editor libraries | Commands 6.11.1, Markdown language 6.5.2, language 6.13.1, search 6.7.2, state 6.7.6, highlight 1.2.5 |
| UI | Tailwind/plugin 4.3.3, Floating UI 1.8.0, date 3.12.4, Lucide 1.60.0, Bits UI 2.19.5, tailwind-merge 3.7.0 |
| Markdown and patches | markdown-it 15.0.3, diff 9.0.0; removed obsolete ambient `any` Markdown declarations in favor of bundled types |
| Build helper | esbuild 0.28.2; Node types 24.19.2 match the existing Node 24 runtime family |
| Native major/minor migrations | base64 0.23.1, getrandom 0.4.3, sha2 0.11.1, libloading 0.9.0, image exactly 0.25.10, zip 9.0.5, notify 8.2.0, Tantivy 0.27.0, zstd 0.14.3 |
| Other Rust updates | Compatible updates include serde/json, blake3, flate2, reqwest, futures, Tokio/util, thiserror, regex, chrono, proc-macro2, and window-state |

Tantivy now requires `.order_by_score()` after `TopDocs::with_limit`; both call sites preserve existing relevance sorting. Its index is in memory, so this change does not migrate an on-disk search index. SHA-256 outputs now use `hex::encode` (hex 0.4.3 was already transitive) because digest output arrays dropped `LowerHex`. Hash algorithm, padding, case, and stored representations remain unchanged. The existing known-vector and immutable history-fixture tests cover that contract.

TypeScript's updated DOM definitions permit `HTMLElement.hidden` to be a string as well as a boolean. The animation-lab toggle now explicitly converts it with `Boolean`. No state ownership or persistence policy changes were needed.

The four npm patches and vendored `corenn-kernels` patch remain intact. Explicit pnpm overrides keep all consumers on the three patched editor/parser versions during deep dependency refreshes. Newly encountered optional-provider install scripts are explicitly disabled; the required esbuild build remains allowed. pnpm recorded version-scoped release-age exceptions for the explicitly selected Vite and Tauri CLI releases.

## Deliberately retained versions

| Dependency | Reason |
| --- | --- |
| Pi/Chord 1.3.0 | Already current; retain returning-client OAuth/error-code patch |
| CodeMirror view 6.43.1, Lezer common 1.5.2, Lezer Markdown 1.6.4 | Tagged upstream source still lacks our focus/performance fixes; rebase and native focus/performance acceptance are separate work |
| TypeScript 6 | Svelte tooling peers do not support TypeScript 7 |
| Vitest 4 | Vitest 5 removes the top-level benchmark API used by both existing benchmark files |
| WebdriverIO 9 | Tauri service requires WDIO 9; WDIO 10 removes extensively used `executeAsync` |
| rusqlite 0.32.1 | Later versions change SQL statement validation, unsigned conversions, cache features, hooks, and bundled SQLite; requires a dedicated persistence migration |
| Direct syn 2 | Architecture tests use its syntax-tree visitor API; latest compatible 2.0.119 resolves separately from upstream dependencies' syn 3 |
| Rust 1.95.0 | Meets the upgraded graph's MSRV; a compiler/platform migration was not combined with this dependency refresh |
| corenn-kernels 0.1.1 vendor patch | Latest upstream is still 0.1.1 and still has nightly-only feature gates removed locally |

The remaining unchanged direct libraries were already current within their supported ecosystem. Newly observed Lucide 1.61.0 and Bits UI 2.20.0 are recorded in the research inventory but were not selected by this lockfile refresh.

## Security audit

`pnpm audit --json` decreased from **61 advisories (2 critical, 26 high, 26 moderate, 7 low)** to **6 (0 critical, 5 high, 1 moderate, 0 low)** after the compatible deep refresh and Kit 3 migration. Audit counts are advisory records, not distinct vulnerable packages or demonstrated application exploits.

Remaining findings are classified as development dependencies by pnpm:

- WDIO → Mocha → serialize-javascript 6.0.2: [code injection](https://github.com/advisories/GHSA-5c6j-r48x-rmvq), [serialization advisory](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v).
- WDIO → Puppeteer browser download tooling → extract-zip 2.0.1: [first extraction advisory](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), [second extraction advisory](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3); audit lists no patched release.
- Browser download/proxy tooling → basic-ftp: [FTP advisory](https://github.com/advisories/GHSA-c475-qrg2-pj4r).
- Mocha → chokidar → braces 3.0.3: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); audit lists no patched release.

No unsupported transitive major overrides were introduced merely to suppress these findings. This is an npm audit, not a RustSec scan or an exhaustive security assessment.

## Useful capabilities to consider

- **Component-stack inspection** from the newer Svelte Vite plugin can make navigation through the large workspace UI easier.
- **Selection undo/redo availability** in CodeMirror can improve editor menu enabled states; newer folding code also avoids quadratic bulk range construction.
- **Tauri asynchronous asset loading** can reduce UI stalls while opening local images/files. Native driver updates fix CSS-pixel window geometry and resize synchronization.
- **Reqwest DNS error classification** can give clearer provider/setup connection errors.
- **Tantivy snippet ranges and richer ordering/query options** may help search presentation; any performance claim needs the app's real workload measured.
- **Svelte reactive-map/context helpers** and Tokio abort-on-drop utilities may simplify future implementation work, but adopting them should follow the existing ownership/lifetime boundaries.

These are opportunities, not additional features implemented in this refresh. The linked research notes cite the owning upstream changelogs.

## Validation

- Before changes: frontend check clean; 125 support tests and 1,395 frontend tests passed; 652 native library tests passed (19 intentionally ignored).
- After changes: frontend/E2E type check clean, 125 support tests and 1,395 frontend tests passed, production static build passed, frozen pnpm install passed.
- Selected headless browser suites: startup readiness, visible Markdown, and chat reopen passed. Split-pane animation failed; the exact failing case reproduced with the original package/lockfiles in an isolated copy of the same source. Original excursion was 23.48 px; updated excursion was 23.83 px, with zero net travel in both. This is an existing working-tree animation failure, not evidence of a dependency regression.
- After native API adaptations: 652 native library tests passed (19 intentionally ignored), 19 architecture fitness tests passed, 4 Pi lifecycle-exclusion tests passed, and the debug native E2E binary plus bundled authentication helper built successfully. The runtime-lifetime integration test also passed, as did all 17 OAuth fixture tests against the newly bundled helper. All 9 native background smoke suites passed: 41 tests passed and 4 opt-in tests skipped. These exercised app lifecycle, command/events, images, Pi native chat, publication, editing, creation, compaction, and adapters.

Windows, Linux, physical iOS, native foreground focus/paint, and live hosted-provider sign-in were not exercised by these checks. Retaining the native-focus patch does not claim new foreground acceptance.

## SvelteKit 3 follow-up

At the user's request, ran `npx sv migrate sveltekit-3 --tasks all --confirm` (sv 1.1.1), installing **Kit 3.1.0 and adapter-static 4.0.0**. The existing Node 24, TypeScript 6, Svelte 5.57.2 and Vite 8 toolchain meets the minimum versions. See the [announcement](https://svelte.dev/blog/sveltekit-3-is-here) and [migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3).

- Moved preprocessing and static SPA fallback configuration into `sveltekit(...)` in `vite.config.js`; removed `svelte.config.js`. Adopted `$app/tsconfig`, `$app/types`, `$app/env`, and standard `#lib` subpath imports with explicit extensions.
- Repaired inline type imports missed by the tool. Prototype navigation copies `page.url.href` and uses `{ replace: true, reset: false }`; navigation links use preload-data `"false"`. Reviewed all `goto` targets: they resolve to internal app routes. There are no affected `invalidateAll`, server-form, cookie, remote-function, or service-worker call sites.
- Preserved disabled deployment polling (`version.pollInterval: 0`) for bundled desktop assets. Dev assets use the existing same-origin Vite server; no broader CORS configuration is needed.
- Converted the vendor chunk policy to `build.rolldownOptions.output.codeSplitting.groups`: Kit 3's own groups caused the old `manualChunks` callback to be ignored. The CodeMirror/Lezer and D3 groups retain the existing dependency boundaries. See [Rolldown code splitting](https://rolldown.rs/reference/OutputOptions.codeSplitting).
- **Known optional peer warning:** Bits UI/toolbelt use runed 0.35.1, whose optional Kit peer still declares `^2.21.0`. Its separate `runed/kit` / `UseSearchParams` entry contains old Kit navigation APIs. Neither our app nor Bits UI/toolbelt imports that entry; their core runed imports do not export it. Registry checks also found no Kit 3 peer support in runed 0.37.1. The warning remains visible rather than claiming that unused entry is compatible. Do not adopt `runed/kit` until upstream supports Kit 3 or it is migrated separately.

The immediate benefits are standard package imports, consolidated configuration, and improved framework error handling. Remote functions remain experimental and require a server, so they are not a replacement for this app's Tauri IPC. The cookie v2 update removes the previous low-severity cookie advisory.

### Kit 3 validation

- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript passed, including the final Rolldown configuration.
- `pnpm test`: 125 support tests and 1,395 frontend tests passed; one frontend test remains intentionally skipped.
- Browser: all four selected suites passed (23 tests): app navigation, startup readiness, visible Markdown, chat reopen.
- Native: all nine background smoke suites passed again (41 tests; four opt-in tests skipped) using disposable vaults and the previously rebuilt, hash-verified debug E2E binary. The Rust implementation was unchanged by this Kit migration.
- `pnpm install --frozen-lockfile` and the final `pnpm build` passed. The static fallback was emitted, the CodeMirror vendor group appears in the client manifest, and the ignored-`manualChunks` warning is gone. Existing large-chunk warnings remain.
- A temporary native preview check loaded the actual production output, opened the editor, navigated Settings/Map/List/home, and reloaded `/settings` successfully. Its temporary config/spec were removed after verification; evidence remains in `/tmp/gneauxghts-kit3-production.log` for this session. This checks production frontend execution in the native WebView, not a newly signed installer.
- `pnpm audit --json`: six development-tooling advisories (five high, one moderate). The optional runed Kit peer warning described above remains visible.
- No stale application `$lib`, `$app/environment`, `$app/stores`, extensionless `#lib` imports, or `@migration-task` markers remain. The generated migration checklist was resolved and removed. `git diff --check` passed.

The earlier split-pane animation failure remains a pre-existing baseline limitation; this follow-up did not change animation behavior or repeat that already-isolated failure.

### Pre-commit review fixes

- Migrated all shadcn aliases in `components.json` to `#lib`. The config stores extensionless alias prefixes; shadcn-svelte 1.7.0 appends `.js` or `/index.js` to generated imports. Adding extensions to those prefixes would produce doubled suffixes.
- Verified the actual CLI in a disposable copy by generating button, collapsible, sidebar, their supporting components, a hook, and utilities. All 44 generated `#lib` imports resolve. Generated components and hooks pass `svelte-check` with the project's existing `utils.ts`. No generated component or new generator dependency was added to the app.
- Removed the unused bare `#lib` package-import entry pointing to a nonexistent barrel. The `#lib/*` mapping also lets the generator resolve the `#lib` directory prefix without that entry.
- Declared `engines.node >=22.17.0` in package.json and added `pnpm build` to the frontend CI job.
- Repeated the final frozen install, application/E2E type checks, 125 support tests, 1,395 frontend tests (one skipped), production build, and 16 Python fixture tests: all passed. These final edits only affect generator configuration, package metadata, and CI; the earlier browser/native and production-WebView validation still covers the unchanged application runtime.
