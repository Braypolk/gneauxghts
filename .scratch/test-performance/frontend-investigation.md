# Frontend collection investigation

Status: Complete — read-only findings; implementation requires coordinator release.

## Confirmed dependency cost candidates

The test configuration in `vite.config.js` uses the Node environment, globals, and `src/**/*.test.ts`. It has no setup files. SvelteKit, Tailwind, the language-data resolver and an E2E server plugin share the Vite configuration. Svelte transforms remain necessary for rune stores and real component SSR tests. The E2E plugin returns early without its token; it is not an established hotspot.

The concrete import leak is:

`state/noteStore.ts` → `document/documentRegistry.ts` → `document/documentRuntime.ts` → `editor/editor.ts` → both `editorDocumentRuntime.ts` and `editorViewController.ts` → `editorExtensions.ts` → pane menus/task-date extensions → `tasks/dateTimePicker.ts` → `DateTimePicker.svelte` → Bits UI and Lucide.

`DocumentRuntime.ensureResources` creates resources lazily, but its imports are eager. `editorExtensions.ts` contains root-state construction alongside pane construction. The root needs history, image resize history and Markdown extensions; it does not need date-picker/menu components. The façade independently reexports pane-controller APIs, so moving root construction alone will not sever the chain.

A TypeScript-AST static import/reexport walk (type-only edges excluded, local files only) found 38 test files reaching `DateTimePicker.svelte`, 28 reaching the document registry and five reaching the composition fixture. Simulating the two edge changes in issue 02 reduces picker reachability from 38 to 12 test files. This is structural evidence, **not measured collection time**: the walk does not account for `vi.mock`, Vite resolution, external modules, dynamic imports or execution. No tests, benchmarks or builds were run by this investigator.

The affected files include document adoption/editing/registry/runtime, workspace store/persistence, pane ownership/lifecycle, real workspace composition, and document-review/session tests. Broad fixture replacement is unnecessary: the production dependency edges explain the reachability even outside the five composition-fixture consumers.

## Minimal experiment

See [issue 02](issues/02-root-editor-import-boundary.md). Move the root construction into the existing runtime's private `documentRoot` function and import resources directly from their owner in `documentRuntime.ts`. Three production files, no new module, no test doubles, no behavior change. Preserve root extension ordering and the subsequent review-field append transaction exactly. Measure the same document-only filter before/after, then the full suite, with the coordinator's chosen pool fixed.

## Secondary findings and rejected shortcuts

* Installed `@lucide/svelte` 1.29.0 exports a supported `./icons/*` path; its root reexports all icons and aliases. Existing tool-header components already use direct default imports. `DateTimePicker.svelte` could use `@lucide/svelte/icons/chevron-down`, `chevron-left`, and `chevron-right` without a private package path. This is a credible separate experiment, not a measured gain. Broad icon rewrites are lower priority than the root dependency cut.
* Installed `bits-ui` 2.18.1 exports only `.`. Do not bypass package exports to reach Calendar internals.
* Changing `dateTimePicker.ts` to lazy async loading would change synchronous close handles and single-picker/focus lifecycle. It is unnecessary for this experiment.
* `editor/testSupport.ts`, `editor/commandTestSupport.ts` and chat fixture support already use narrow imports/type-only edges. Real composition support intentionally exercises actual ownership. Do not replace it with mocks.
* The two `vi.resetModules` users, `appSettings.svelte.test.ts` and `editorTextSize.test.ts`, test import-time singleton/storage initialization. Removing resets or disabling isolation would weaken their contracts, and neither is demonstrated as a major collection cost.
* `vendor/codemirrorLanguageData.ts` filters lazy language descriptions. The full description catalog import does **not** establish that every language parser loads eagerly.
* `enterKey.test.ts` and `undoSelection.test.ts` could import their direct owners instead of `editor.ts`; this is safe but only a small separate experiment. Do not retarget `editorLifecycleController.test.ts` imports without its explicit façade mock, whose calls are part of the fixture.
* Tailwind exclusion in test mode could be measured independently, but there is no evidence yet that plugin startup dominates. Keep SvelteKit and the curated-language resolver.

## Measurement interpretation

Coordinator reports all 1,065 cases/143 files pass for baseline forks/default (19.33s), forks/4 (21.89s), threads/4 (15.42s), and threads/default (11.69s). Those are coordinator measurements, not experiments run here. Repeat promising results under comparable load; pool selection is independent of the production import cut. Aggregate Vitest `collect`/`transform` totals overlap across workers and must not be treated as elapsed wall time.

Progress: inspected config, actual production imports, installed package exports, support fixtures and initialization-sensitive tests; recorded a minimal three-file plan and a static counterfactual. Source untouched.
