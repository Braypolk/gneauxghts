# Useful frontend and verification capabilities — 2026-10-21

This pre-implementation research record revisits the original [frontend refresh](dependency-refresh-frontend-2026-10-21.md) against the current application, including the subsequent Kit, WDIO and Bits/Vitest migrations. Its ready proposals have since been implemented or evaluated; the [outcome record](../../.scratch/archive/package-capabilities-2026-10-21.md) owns actual results and verification limits. No new dependency migration was introduced by those capability changes. Recommendations and priority are repository-specific judgments, rather than upstream performance promises.

The installed versions examined are Svelte **5.57.2**, SvelteKit **3.1.0**, adapter-static **4.0.0**, plugin-svelte **7.3.1**, Vite **8.3.5**, Vitest **5.0.5**, WDIO **10.1.0**, Bits UI **2.20.0**, Floating UI DOM **1.8.0**, Tailwind and its Vite plugin **4.3.3**. Sources were checked against the installed types/implementation where a documentation page could describe newer behavior. The application's frontend remains a static Tauri SPA; `src/routes/+layout.ts` disables SSR and `vite.config.js` configures an `index.html` fallback.

## Recommended opportunities

| Priority | Opportunity | Why it fits this application | Effort and acceptance |
| --- | --- | --- | --- |
| High | Opt-in Svelte component-stack inspector | Find the Svelte owner of a pane, menu or nested chat control directly from the visible UI. | Small; verify source navigation, keyboard conflict avoidance, and absence from production/E2E unless explicitly enabled. |
| High | Vitest comparison benchmarks and saved results | Extend the existing large Markdown/image benchmarks into repeatable evidence for future performance changes. | Small–medium; correctness checks outside measured loops, comparable machine/runtime metadata, deliberate baseline refresh and matched native acceptance. |
| Medium | Kit 3 client rendering-error presentation | Provide a useful application error screen and local diagnostic identifier when rendering fails. | Medium; initial safe presentation only. Root-shell handling and stateful recovery require a separate owner/settlement design; see [the implementation plan](../../.scratch/archive/package-capabilities-2026-10-21/tickets/04-render-error-recovery.md). |
| Medium | Vitest `doctor` measurement | Identify whether pool/worker changes would materially shorten the large unit suite. | Small experiment; preserve isolation unless a separately justified change proves safe, rerun shuffled/full suite under any selected configuration. |
| Low, when editing tests | `vi.when` argument-specific mocks | Make branching note/session lookup mocks clearer and optionally reject unexpected inputs. | Small per test; preserve race ordering, rejection behavior and coverage rather than mass-rewriting tests. |
| Low, when editing related code | Svelte typed context presence and map insertion helpers | Remove a little optional-context/cache boilerplate. | Small; retain explicit lifecycle/consumer-count/cleanup rules and verify optional-provider behavior. |

## Original opportunities, explained and checked

### Component-stack inspection: useful and currently opt-in

Plugin 7.2 adds an inspector context menu listing the component stack. This means pointing at an element can reveal both its immediate Svelte component and the containing components, useful for tracing layered controls in `src/lib/features/notepad/NotepadPane.svelte`, the chat UI, and `src/lib/ui/PaneHeader.svelte`. [Plugin changelog](https://github.com/sveltejs/vite-plugin-svelte/blob/main/packages/vite-plugin-svelte/CHANGELOG.md#720).

Current `vite.config.js` sets no inspector option. The installed plugin disables itself without configuration or an environment opt-in. A reversible developer invocation can use `SVELTE_INSPECTOR_OPTIONS=true pnpm dev`; the existing plugin supports this environment variable. Alternatively, Kit 3 forwards an `inspector` option directly from `sveltekit(...)`. No extra plugin package is needed. The installed defaults use Alt-X, arrow navigation, Space for the menu and Enter to open source; a modifier-only toggle is preferable around an editor to avoid inserting characters. The plugin applies to development serving. [Plugin configuration](https://github.com/sveltejs/vite-plugin-svelte/blob/main/docs/config.md), [inspector options source](https://github.com/sveltejs/vite-plugin-svelte/blob/main/packages/vite-plugin-svelte/src/plugins/inspector/options.js). Confirmed against local `node_modules/@sveltejs/vite-plugin-svelte/src/plugins/inspector/{index,options}.js` at 7.3.1.

### Svelte collections/context: modest cleanup, not a state rewrite

Svelte 5.57 adds `SvelteMap.getOrInsert` and lazy `getOrInsertComputed`, and adds a **third presence-check function** to `createContext`'s return tuple: `[get, set, has]`. The original shorthand “createContext.has” should not be read as a property on the factory. `createContext` itself dates to 5.40 and was already available before this refresh. The same 5.57 release adds native `<select defaultValue>`. [Svelte changelog](https://raw.githubusercontent.com/sveltejs/svelte/main/packages/svelte/CHANGELOG.md), [context API](https://svelte.dev/docs/svelte/svelte#createContext).

The concrete context seam is `src/lib/ui/workspaceTitleSlot.ts`, provided in `src/routes/+layout.svelte` and optionally consumed by `src/lib/ui/PaneHeader.svelte`. A typed `[get, set, has]` helper could retain that optional behavior while coupling the getter/setter types. Current symbol-based context already works.

`RelatedNotesStore.acquire` in `src/lib/features/notepad/related/store.svelte.ts` has a genuine get-or-create branch that could use the lazy map helper. The surrounding update, consumer count, epoch invalidation and release behavior remain essential. `notepadChatCoordinator.svelte.ts` also uses `SvelteMap`, but its binding creation and subscription cleanup span several maps, so replacing it with one insertion call would not simplify its lifecycle. `atlasStore.svelte.ts` builds maps from results rather than lazily inserting entries. Reactive map values are not automatically made deeply reactive; the existing `RelatedResult` rune fields still matter. [Reactive collection API](https://svelte.dev/docs/svelte/svelte-reactivity#SvelteMap).

Existing native select controls are bound to settings or filter state. `defaultValue` is mainly useful for an uncontrolled select with native form reset semantics; it supplies no obvious improvement to those controls.

### Floating UI: keep visible-area collision behavior by default

DOM 1.8 introduces `rootBoundary: 'layoutViewport'`, which remains stable during pinch zoom and software-keyboard changes. Existing fixes for fixed-position clipping, observers and scrollbar space arrive automatically. [Floating UI changelog](https://github.com/floating-ui/floating-ui/blob/master/packages/dom/CHANGELOG.md#180).

The app's custom positioning lives in `src/lib/ui/floatingPanel.ts`, `src/lib/features/notepad/editor/SelectionMenu.svelte` and `src/lib/features/notepad/wikilinks/WikilinkAutocomplete.svelte`; it already honors pane boundaries and, in the shared helper, safe-area padding. Switching globally to the layout viewport could place menus behind an open mobile keyboard. Treat the new option as a targeted tool for a reproduced zoom/keyboard positioning problem. Acceptance would need narrow panes, safe areas, mobile keyboard and native WebKit, not only desktop screenshots.

## Additional useful capabilities from later upgrades

### Vitest 5: use the benchmark migration as a foundation

The six workloads in `src/lib/features/notepad/markdown/markdownDecorations.bench.ts` and `src/lib/features/notepad/images/imageInventory.bench.ts` already run through the new test-context fixture. What remains available is `bench.compare`, `writeResult`, `bench.from`, and relative performance assertions with an explicit `delta`. These can compare a candidate implementation against a reference or preserve a measured result for a later run. [Benchmark guide](https://vitest.dev/guide/benchmarking).

The [comparison workflow](../development/benchmark-comparisons.md) is now implemented, with one capture and three actual saved-baseline comparisons documented in the [validation report](editor-benchmark-comparisons-2026-10-21.md). It uses no universal millisecond threshold. Consume results so work remains observable, validate outputs outside timed loops, record hardware/Node/fixture/package versions, and refresh saved results intentionally. Historical Vitest 4/Tinybench results are not directly comparable to v5. Node microbenchmarks still cannot establish native typing/focus/frame performance; retain the native large-document checks.

Vitest 5's `doctor` runs the suite under alternative configurations and reports measured recommendations. It also probes worker counts and checks shuffled orders before recommending disabled isolation. The completed [bounded doctor investigation](vitest-doctor-2026-10-21.md) retained the existing threads pool, isolation and worker defaults: five workers were 31% slower, and disabling isolation failed. Normal and seeded-shuffle isolated suites passed. [Doctor command](https://vitest.dev/guide/cli#vitest-doctor).

Persistent transformed-module caching is now stable and **already enabled by default** in installed 5.0.5 (`fsModuleCache`, default cache `node_modules/.vitest-cache`). It is an automatic benefit, not an unimplemented switch to turn on. The installed declarations confirm the defaults. An eventual cache investigation should include the custom curated-language resolver and changed plugin/config invalidation. [Vitest 5 release](https://vitest.dev/blog/vitest-5#performance-improvements).

`vi.when` is new in 5.0 and can express a spy's response for particular arguments, with optional failure for unmatched calls. A concrete example is the two-document `readNoteSession` branching mock in `src/lib/features/notepad/orchestration/notepadComposition.test.ts`. The two-document pilot now uses scoped exact ID/path registrations and returns the original controlled promises. No wider rewrite was made. [Conditional mocking](https://vitest.dev/guide/recipes/conditional-mocking).

### Kit 3: useful rendering-error handling without a server

Kit 3 routes child rendering failures through `handleError` and the nearest `+error.svelte` boundary; it also sends expected errors through the hook and includes status on `App.Error`. The app now has a synchronous `hooks.client.ts` and a plain `+error.svelte`, backed by a curated status/copy catalog and an ephemeral selectable local reference. Unknown exception content is not inspected or logged. Ten focused tests and three real Kit browser-render regressions pass; native acceptance remains in the combined verification record. The planning audit established that the root layout is outside this route boundary and a failed child tears down the workspace/save handlers. Therefore the first stage adds no recovery/reload/restart controls and makes no claim that dirty drafts are preserved. Stateful recovery needs a separate owner/settlement design. An asynchronous client error hook needs experimental async compilation, so it is unnecessary for this first version. [Kit 3 error handling](https://svelte.dev/docs/kit/migrating-to-sveltekit-3#Error-handling).

Kit 3's standard `#lib` imports, environment-module migration and Rolldown chunk configuration are already adopted. Remote functions still require an application server and experimental async Svelte; they do not replace this static Tauri app's IPC. The new service-worker conveniences do not establish a current requirement for another cache/update lifecycle around bundled native assets. [Kit 3 announcement](https://svelte.dev/blog/sveltekit-3-is-here).

### WDIO 10: the chosen verification loop is already implemented

Persistent sessions, snapshots, screenshots/traces, deterministic export/replay and failure artifacts are in `e2e/agent`, `package.json`, `.github/workflows/tests.yml` and `docs/agents/ui-verification.md`. The same guide already documents `--debug=agent` for inspecting a paused failing worker and then resuming it. This is not remaining implementation work. Its long timeout makes it an explicit interactive debugging path. [Session debugging](https://webdriver.io/docs/session/debug), [repository verification workflow](../agents/ui-verification.md).

`browser.act`/`extract` remains a separate optional experiment requiring `@wdio/ai-service` and a model/provider. `act` records/replays actions but does not assert outcomes; `extract` calls a model rather than replaying a cache. Ordinary commands plus explicit assertions suit the maintained flows already present. If adopted later, use disposable fixtures, review/eject recorded commands, and locked replay in CI. Our browser runner deliberately uses Classic after startup script-context problems, so richer BiDi effect verification needs its own compatibility proof. [AI steps](https://webdriver.io/docs/ai-steps).

### Bits UI: substantial automatic fixes, little new application API work

Bits 2.20 supplies focus restoration without page scrolling, prompt pointer-lock release, Calendar fixes, initially-open Collapsible fixes, Tooltip dismissal on scrolling, and LinkPreview listener cleanup. Those benefits apply through existing Calendar (`features/tasks/DateTimePicker.svelte`), DropdownMenu (`ui/NavBar.svelte`, `features/notepad/NotepadPane.svelte`), Tooltip (`features/chat/ui/PiContextUsage.svelte`), Collapsible and hover-card wrappers. The Calendar timezone correction specifically concerns `ZonedDateTime`; our picker uses `parseDate` calendar dates and already binds its placeholder. The release's Safari VoiceOver Select fix applies to the Bits Select primitive; the app's settings/filter selects are native HTML, so do not claim they received that fix. The new RadioGroup autocomplete prop has no current consumer. [Bits 2.20 changelog](https://raw.githubusercontent.com/huntabyte/bits-ui/main/packages/bits-ui/CHANGELOG.md).

## Improvements already received, or not justified as projects

Vite 8 already supplies Rolldown/Oxc and the application already uses explicit code-splitting groups. Upstream build-speed examples are not measurements of this repository. More aggressive chunk splitting or experimental development bundling should follow a measured startup bottleneck, not be adopted for novelty. [Vite 8 release](https://vite.dev/blog/announcing-vite8), [migration](https://vite.dev/guide/migration).

Tailwind moved only from 4.3.1 to 4.3.3: HMR/reload, font-selection and scanner fixes are automatic. Earlier Tailwind 4 features are not new capabilities unlocked by this patch update. The same restraint applies to date/icon/merge utilities: no concrete new workflow justified a rewrite during this review. [Tailwind 4.3.2](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.2), [4.3.3](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.3).

Vitest's Browser Mode Trace View is new, but the repository currently runs unit tests in Node and uses WDIO for browser/native journeys. Adding a second browser harness solely for traces duplicates the already selected verification loop. Reconsider only for a specific component-testing gap. [Vitest 5 Trace View](https://vitest.dev/blog/vitest-5#trace-view).

## Research validation

Read current configuration, package manifests, relevant application/test call sites, the existing migration reports, official release documentation and installed API declarations/source. No application files, tests, dependency versions or existing uncommitted upgrade work were changed. Research does not establish runtime acceptance of any proposed feature.
