# Frontend dependency refresh — 2026-10-21

Research snapshot, not a claim that these changes have already been installed or validated. Versions below came from live npm registry metadata on 2026-10-21; the “before” column uses the original lockfile rather than the often much older minimum versions in package.json. This explains why Svelte, Kit, and Tailwind were already considerably newer than their manifest minimums.

> Follow-up: the user subsequently requested Kit 3. The migration is applied; see [the refresh report](dependency-refresh-2026-10-21.md#sveltekit-3-follow-up) for final versions, compatibility caveats, and validation. The recommendations below record the initial review.

## Recommendation

Upgrade the compatible toolchain together: **Kit 2.70.3, adapter-static 3.0.10, Svelte 5.57.2, Svelte Vite plugin 7.3.1, Vite 8.3.5, TypeScript 6.0.3, svelte-check 4.7.7, Vitest 4.1.12, esbuild 0.28.2, and Node 24 types 24.19.2**. These versions satisfy the published package peer requirements. Keep the three editor/parser patches until their native focus and large-document performance regressions can be revalidated. Defer Kit 3, TS 7, and Vitest 5 for the specific compatibility reasons below.

## Inventory

Registry links are the primary source for latest versions and package metadata. “Target” records the research recommendation; the final implementation and validation record may choose a more conservative version.

| Package | Before (locked) | Registry latest stable | Recommended target |
|---|---|---|---|
| `@codemirror/commands` | 6.10.3 | [6.11.1](https://registry.npmjs.org/@codemirror%2fcommands) | 6.11.1 |
| `@codemirror/lang-markdown` | 6.5.0 | [6.5.2](https://registry.npmjs.org/@codemirror%2flang-markdown) | 6.5.2 |
| `@codemirror/language` | 6.12.3 | [6.13.1](https://registry.npmjs.org/@codemirror%2flanguage) | 6.13.1 |
| `@codemirror/language-data` | 6.5.2 | [6.5.2](https://registry.npmjs.org/@codemirror%2flanguage-data) | 6.5.2 |
| `@codemirror/search` | 6.7.1 | [6.7.2](https://registry.npmjs.org/@codemirror%2fsearch) | 6.7.2 |
| `@codemirror/state` | 6.6.0 | [6.7.6](https://registry.npmjs.org/@codemirror%2fstate) | 6.7.6 |
| `@codemirror/view` | 6.43.1 | [6.43.15](https://registry.npmjs.org/@codemirror%2fview) | 6.43.1 (retain patch) |
| `@floating-ui/dom` | 1.7.6 | [1.8.0](https://registry.npmjs.org/@floating-ui%2fdom) | 1.8.0 |
| `@internationalized/date` | 3.12.3 | [3.12.4](https://registry.npmjs.org/@internationalized%2fdate) | 3.12.4 |
| `@lezer/common` | 1.5.2 | [1.5.3](https://registry.npmjs.org/@lezer%2fcommon) | 1.5.2 (retain patch) |
| `@lezer/highlight` | 1.2.3 | [1.2.5](https://registry.npmjs.org/@lezer%2fhighlight) | 1.2.5 |
| `@lucide/svelte` | 1.29.0 | [1.61.0](https://registry.npmjs.org/@lucide%2fsvelte) | 1.60.0 (selected lockfile) |
| `@tailwindcss/vite` | 4.3.1 | [4.3.3](https://registry.npmjs.org/@tailwindcss%2fvite) | 4.3.3 |
| `bits-ui` | 2.18.1 | [2.20.0](https://registry.npmjs.org/bits-ui) | 2.19.5 (selected lockfile) |
| `clsx` | 2.1.1 | [2.1.1](https://registry.npmjs.org/clsx) | 2.1.1 |
| `diff` | 8.0.4 | [9.0.0](https://registry.npmjs.org/diff) | 9.0.0 |
| `markdown-it` | 14.2.0 | [15.0.3](https://registry.npmjs.org/markdown-it) | 15.0.3 |
| `tailwind-merge` | 3.6.0 | [3.7.0](https://registry.npmjs.org/tailwind-merge) | 3.7.0 |
| `tailwind-variants` | 3.3.1 | [3.3.1](https://registry.npmjs.org/tailwind-variants) | 3.3.1 |
| `tailwindcss` | 4.3.1 | [4.3.3](https://registry.npmjs.org/tailwindcss) | 4.3.3 |
| `@sveltejs/adapter-static` | 3.0.10 | [4.0.0](https://registry.npmjs.org/@sveltejs%2fadapter-static) | 3.0.10 |
| `@sveltejs/kit` | 2.66.0 | [3.1.0](https://registry.npmjs.org/@sveltejs%2fkit) | 2.70.3 |
| `@sveltejs/vite-plugin-svelte` | 5.1.1 | [7.3.1](https://registry.npmjs.org/@sveltejs%2fvite-plugin-svelte) | 7.3.1 |
| `@types/mocha` | 10.0.10 | [10.0.10](https://registry.npmjs.org/@types%2fmocha) | 10.0.10 |
| `@types/node` | 24.13.2 | [26.6.5](https://registry.npmjs.org/@types%2fnode) | 24.19.2 |
| `esbuild` | 0.25.12 | [0.28.2](https://registry.npmjs.org/esbuild) | 0.28.2 |
| `svelte` | 5.56.3 | [5.57.2](https://registry.npmjs.org/svelte) | 5.57.2 |
| `svelte-check` | 4.6.0 | [4.7.7](https://registry.npmjs.org/svelte-check) | 4.7.7 |
| `typescript` | 5.6.3 | [7.0.2](https://registry.npmjs.org/typescript) | 6.0.3 |
| `vite` | 6.4.3 | [8.3.5](https://registry.npmjs.org/vite) | 8.3.5 |
| `vitest` | 3.2.6 | [5.0.5](https://registry.npmjs.org/vitest) | 4.1.12 |
| `@lezer/markdown` (transitive) | 1.6.4 | [1.8.1](https://registry.npmjs.org/@lezer%2fmarkdown) | 1.6.4 (retain patch) |

The latest Lucide 1.61.0 and Vite 8.3.5 were published on the day of the review; Bits UI 2.20.0 on the preceding day. Respect the configured package-manager release-age policy if it excludes them; publication recency is not a reason to silently weaken that policy. Packages already at their latest stable release (`clsx`, language-data, tailwind-variants, Mocha types) need no artificial version change.

The installed refresh uses Lucide 1.60.0 and Bits UI 2.19.5. Registry metadata also exposed newer 1.61.0/2.20.0 releases during research; those were not selected by the compatible lockfile refresh. Capabilities specifically attributed to Bits UI 2.20 below are follow-up opportunities, not delivered changes.

## Compatibility and breaking changes

### SvelteKit and Svelte plugin

Kit 2.70.3 explicitly accepts Vite 8, plugin-svelte 7 and TypeScript 6, so this refresh does **not** require Kit 3. Adapter-static 3.0.10 accepts Kit 2; adapter-static 4 requires Kit 3. Latest Kit 3.1.0 requires Node >=22.17, Vite ^8.0.12, Svelte ^5.57.1 and TS ^6.0.0. [Kit metadata](https://registry.npmjs.org/@sveltejs%2fkit), [adapter metadata](https://registry.npmjs.org/@sveltejs%2fadapter-static).

Kit 3 removes svelte.config.js, replaces $lib with #lib and changes the generated tsconfig entry point; those are broad changes to this repository's existing config and imports. Treat it as a separate migration. [Official Kit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3).

Plugin-svelte 7 requires Vite 8 and Svelte >=5.46.4. It removes old hot/preprocessor plugin options and changes CSS hash handling; this repository's config does not set the removed options. Its inspector is integrated into the package. [Plugin changelog](https://github.com/sveltejs/vite-plugin-svelte/blob/main/packages/vite-plugin-svelte/CHANGELOG.md).

### Vite 6 → 8

Vite 7 raises the Node floor to 20.19/22.12 and changes the default browser baseline. Vite 8 changes the bundler/transformer to Rolldown/Oxc and raises the default Safari target to 16.4. This matters for Tauri's system WebView: decide an explicit supported browser target rather than silently accepting a changed minimum. [Vite 7 migration](https://v7.vite.dev/guide/migration), [Vite 8 migration](https://vite.dev/guide/migration).

The existing build.rollupOptions.output.manualChunks **function** remains supported but deprecated; object-form manualChunks is removed. Migrate to build.rolldownOptions and Rolldown codeSplitting when practical, preserving the shared CodeMirror chunk. Check the custom curated-language-data resolveId plugin in both tests and production builds. Vite 8 also changes CJS interop, so a successful type check alone does not prove the packaged bundle works. [Vite 8 migration](https://vite.dev/guide/migration).

Keep the direct esbuild dependency: scripts/buildChatgptAuth.mjs uses it to bundle the authentication helper independently of Vite. Esbuild 0.28 adds fallback binary-download integrity verification and text import attributes; validate the helper build after upgrading. [Esbuild changelog](https://github.com/evanw/esbuild/blob/main/CHANGELOG.md).

### TypeScript 5.6 → 6; defer 7

TS 6 changes defaults for rootDir, types, strict, target and side-effect import checking, and deprecates baseUrl. This repository already explicitly selects strict and types and uses bundler resolution; inspect the generated Kit config and E2E config for inherited rootDir/baseUrl behavior. Prefer fixing concrete diagnostics over globally hiding deprecations. TS 6 also provides improved generic-function inference. [TS 6 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/).

**Do not select npm's TypeScript 7.0.2 latest tag**: svelte-check 4.7.7 declares only ^5 or ^6, and Kit 2.70.3 also declares only ^5.3.3 or ^6. TS 6.0.3 is the newest compatible major. Keep @types/node on Node 24, matching the installed Node 24.2.0 and the auth helper's node24 target. [svelte-check metadata](https://registry.npmjs.org/svelte-check), [Kit metadata](https://registry.npmjs.org/@sveltejs%2fkit), [TypeScript metadata](https://registry.npmjs.org/typescript).

### Vitest 3 → 4; defer 5

Vitest 4 replaces vite-node with Vite's module runner, reorganizes pools, and changes spy/mock cleanup semantics: restoreAllMocks restores manual spies without clearing their history; automocks are no longer reset by that call. The existing simple threads/node/globals config avoids the removed poolOptions/workspace/coverage settings. Existing tests use vi.restoreAllMocks and module mocks, so run the entire suite. [Vitest 4 migration](https://v4.vitest.dev/guide/migration).

Vitest 5 additionally clears mock history before every test by default and removes the top-level bench API. The repository has two real users: imageInventory.bench.ts and markdownDecorations.bench.ts; preserving them makes 4.1.12 the useful compatible target for this refresh. A later v5 migration must convert them to test-context benchmarks and verify CLI/filter behavior. No beforeAll or deprecated sequential API usage was found in src during this review. [Vitest 5 migration](https://vitest.dev/guide/migration/).

### Markdown rendering and diffing

markdown-it 15 removes internal subpath exports, bundles TypeScript types, changes linkify defaults and exposes parser internals as static classes. The only runtime use here imports the package root and explicitly sets linkify:false, so the fuzzy-link change should not affect chat rendering. Remove the obsolete any-typed src/types/markdown-it.d.ts shim to benefit from the new declarations. Test admitted source links and external links. Version 15.0.3 fixes pathological quadratic parsing of multiline references and unclosed inline HTML constructs. [markdown-it changelog](https://github.com/markdown-it/markdown-it/blob/master/CHANGELOG.md).

Diff 9 drops ES5 support and changes patch filename quoting, malformed-header handling and StructuredPatch filename types. The application imports only diffArrays, so the patch-format changes do not directly affect current use. New Git patch metadata support could help a future file-change review feature. The substantial performance claims in the current upstream changelog belong to **10.0.0 prerelease**, not installed stable 9.0.0; do not advertise them as available from this update. [jsdiff release notes](https://github.com/kpdecker/jsdiff/blob/master/release-notes.md).

## Editor patches and dependency constraints

The current local patches protect WebKit focus (view), mixed-tree traversal performance (common), and large Markdown paragraph/quote parsing performance (markdown). They are version-keyed in pnpm-workspace.yaml. Updating those packages without moving their patches can remove behavior even when the package manager installs successfully.

Tagged upstream source confirms the exact fixes are **not** fully incorporated:

- View 6.43.15 still returns early only for composition in enforceCursorAssoc, without the local !view.hasFocus guard. [Tagged source](https://code.haverbeke.berlin/codemirror/view/src/tag/6.43.15/src/docview.ts).
- Common 1.5.3 still calls moveTo before checking cursor.tree in StructureCursor.hasNode. Its release notes describe a related mixed-parsing performance fix, but that does not establish equivalence with our local guard. [Tagged source](https://code.haverbeke.berlin/lezer/common/src/tag/1.5.3/src/mix.ts), [changelog](https://code.haverbeke.berlin/lezer/common/src/branch/main/CHANGELOG.md).
- Markdown 1.8.1 still scans all inline parsers and splices marks, without the dispatch table or linear merge in our patch. Rebase all three local optimizations explicitly before adopting it. [Tagged source](https://code.haverbeke.berlin/lezer/markdown/src/tag/1.8.1/src/markdown.ts).

Other CodeMirror upgrades accept the retained versions. commands 6.11.1 requires state ^6.7.0, so update those together. language 6.13.1 needs common ^1.5.0 and view ^6.23.0; lang-markdown 6.5.2 accepts markdown ^1.0.0. language now introduces @codemirror/streamparser; old exported types remain re-exported. Pin the patched transitive markdown version with an override if resolution would otherwise select 1.8.1. [Commands metadata](https://registry.npmjs.org/@codemirror%2fcommands), [language metadata](https://registry.npmjs.org/@codemirror%2flanguage), [Markdown language metadata](https://registry.npmjs.org/@codemirror%2flang-markdown), [language changelog](https://code.haverbeke.berlin/codemirror/language/src/branch/main/CHANGELOG.md).

## Useful capabilities and fixes

- **Svelte developer tooling:** plugin 7.2 adds an inspector context menu showing the component stack, useful for navigating this large UI. [Plugin changelog](https://github.com/sveltejs/vite-plugin-svelte/blob/main/packages/vite-plugin-svelte/CHANGELOG.md).
- **Reactive collections and context:** Svelte 5.57 adds getOrInsert/getOrInsertComputed to SvelteMap, createContext.has, and select defaultValue. Recent patches fix disconnected dependencies and duplicate derived subscriptions. Consider these when touching caches/context, rather than rewriting working state ownership during a dependency refresh. [Svelte changelog](https://github.com/sveltejs/svelte/blob/main/packages/svelte/CHANGELOG.md).
- **Editing:** commands 6.11 adds canUndoSelection/canRedoSelection, and language 6.12.4 makes bulk fold-range creation linear. These could improve editor menu state and large-note folding. [Commands changelog](https://code.haverbeke.berlin/codemirror/commands/src/branch/main/CHANGELOG.md), [language changelog](https://code.haverbeke.berlin/codemirror/language/src/branch/main/CHANGELOG.md).
- **Popover positioning:** Floating UI 1.8 adds layoutViewport boundaries and fixes clipping/scrollbar-gutter behavior, potentially useful for editor menus and overlays. [Floating UI changelog](https://github.com/floating-ui/floating-ui/blob/master/packages/dom/CHANGELOG.md).
- **Accessibility and focus:** Bits UI 2.20 fixes VoiceOver activation of Select on Safari, focus restoration without scrolling, stale deferred callbacks, and date labels across time zones. Its peer requirements are satisfied by the proposed Svelte/date versions. [Bits UI changelog](https://github.com/huntabyte/bits-ui/blob/main/packages/bits-ui/CHANGELOG.md).
- **CSS:** Tailwind 4.3.2/3 fixes Vite HMR failures and unnecessary full reloads, Windows CJK font selection, and source scanning. Keep Tailwind and its Vite plugin at the same version; 4.3.3 accepts Vite 8. [Tailwind changelog](https://github.com/tailwindlabs/tailwindcss/blob/main/CHANGELOG.md), [plugin metadata](https://registry.npmjs.org/@tailwindcss%2fvite).
- **Future parser refresh:** Lezer Markdown 1.8 exposes emphasis delimiter types and improves incremental reuse of node groups in 1.8.1. Those may help custom Markdown extensions after the local performance patch is rebased and measured. [Markdown parser changelog](https://code.haverbeke.berlin/lezer/markdown/src/branch/main/CHANGELOG.md).

## Validation gates

Resolve the lockfile with peer checks; confirm a single coherent CodeMirror state/view graph and all retained patch hashes. Run pnpm check, pnpm test and pnpm build, plus the auth-helper build/artifact checks. Run browser E2E for menus, chat links, Markdown edits, task dates, and large-note behavior where available. Native WebKit focus and native performance checks remain necessary before declaring the editor patches safely replaceable. Validation outcomes belong in the implementation record; this research note alone does not establish runtime compatibility.
