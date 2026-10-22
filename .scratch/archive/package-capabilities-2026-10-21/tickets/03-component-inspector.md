# Document and verify opt-in component-stack inspection

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task

## Problem and scope

Plugin-svelte 7.3.1 already supplies a development inspector with a component-stack context menu. Finding the owner of a nested pane/menu/chat control is useful; the application lacks a documented, keyboard-safe invocation. Use the installed plugin's existing opt-in. No new inspector dependency, Vite plugin, app UI toggle, persistent setting or environment-variable framework is needed.

References: [frontend capability research](../../../../docs/research/upgraded-frontend-capabilities-2026-10-21.md), [plugin configuration](https://github.com/sveltejs/vite-plugin-svelte/blob/main/docs/config.md), and installed `node_modules/@sveltejs/vite-plugin-svelte/src/plugins/inspector/{options.js,index.js,runtime/Inspector.svelte}`. The installed code parses `SVELTE_INSPECTOR_OPTIONS` JSON, is disabled without options, and declares `apply: 'serve'`; Kit 3 already forwards inspector options if ever needed.

## Current owners and file boundary

- `vite.config.js` invokes `sveltekit(...)` with no inspector configuration, correctly leaving it off by default.
- `package.json` already exposes `pnpm dev` and `pnpm tauri dev` through existing wrappers.
- `e2e/agent/server.mjs` selects the browser fixture through `VITE_E2E_BROWSER=true`; native runners use `VITE_E2E_NATIVE=true`. Neither flag is an inspector opt-in.
- `src/lib/keyboardShortcuts.svelte.ts` owns configurable app shortcuts, and `src/lib/features/notepad/editor/editorShortcuts.ts` owns editor handling. Do not change them to accommodate a developer tool.
- Own a new `docs/development/component-inspector.md` only, plus selected ignored evidence under `.scratch/package-capabilities/evidence/inspector/`. The parent integrator owns any link from a shared overview. No runtime/test/config/manifest edits are expected unless verification exposes an actual integration defect; report that defect as a new issue instead of broadening this task.

## Exact proposed workflow

Document the following explicit local invocation using the existing environment option:

```sh
SVELTE_INSPECTOR_OPTIONS='{"toggleKeyCombo":"control-alt-shift","holdMode":true,"showToggleButton":"always"}' pnpm dev
```

For a disposable native development vault, use the same prefix with `pnpm tauri dev`. For the existing browser agent fixture, use it with `pnpm agent:serve` only in a dedicated inspector-verification session. Do not enable it for ordinary regression, performance, release or native background runs. Developers must follow existing disposable-vault and foreground authorization policies before using the native path.

The three-modifier combo avoids typing Alt-X into the focused editor and does not match any current default app shortcut. Explain that `control` is the plugin's token; it is not the app shortcut registry's `Ctrl+...` syntax. Hold the modifiers while pointing at a control, then use the component-stack context menu to choose an owner and open its source. A short press can toggle persistent inspector mode; Escape exits. The optional button offers discoverability. Verify exact installed hold/toggle/menu behavior rather than promising an untested gesture.

Developer-custom shortcuts or OS accessibility tools may claim that combination. Provide an example of changing only `toggleKeyCombo` in the JSON, tell users to choose a free modifier-only combination, and offer the inspector button instead. Do not globally reserve a shortcut or suppress normal editor keys. App editing/navigation is expected to resume after inspector exit; the intentionally active inspector may intercept click/navigation actions while selecting components.

The variable applies to that shell invocation, not a committed `.env` file. To force it off even if a developer's shell contains inherited options, document `SVELTE_INSPECTOR_OPTIONS=false <existing command>`. No special E2E enable flag is introduced: setting this inspector variable is the explicit opt-in. Include environment cleanup before acceptance runs.

## Verification and acceptance

1. Start normal development serving with inspector environment variables absent (or explicitly false). Confirm no inspector overlay/button/runtime is injected. Repeat an ordinary E2E fixture start; E2E mode alone must not activate it.
2. Start the opt-in browser fixture through the existing persistent WDIO loop in `docs/agents/ui-verification.md`. Inspect a pane header, a nested notepad control and a nested chat control. Capture the stack/source locations, not private note contents. At least one child and parent component must resolve to their actual `.svelte` file; exercising source navigation must point at the correct file/line. If the local editor opener is unavailable, record that limit separately from verified stack resolution and do not claim the opener passed.
3. In a disposable foreground native dev session, activate/exit with the modifier-only combo while CodeMirror initially has focus. Confirm the document contains no inserted activation character, selection/content are unchanged by activation, normal typing and the app's configured shortcuts work after exit, Escape releases interception, and a menu can still open/dismiss. Do not use native focus overrides in the normal background test configuration. Capture selected before/after evidence and close owned sessions/servers.
4. Run `pnpm build` once with the opt-in environment present deliberately. Inspect production emitted assets and preview DOM/network for absence of `virtual:svelte-inspector`, inspector runtime/overlay and dev source-opening requests; `apply: 'serve'` must keep the tool out of production even when that variable leaks into a build shell. Preview ordinary workspace editing. Do not scan for the generic word `inspector`, which may appear in unrelated dependencies.
5. Record the command, supported version, actual key/menu gestures, local source-opener behavior, default/off/E2E/production results and any OS shortcut caveat. No product test is exported solely to test a third-party developer overlay; selected disposable WDIO session evidence is sufficient for this reversible documentation feature.

## Dependencies and parallelism

No prerequisite package or app changes. Can proceed in parallel with the other capability work, but interactive native foreground verification and builds must be scheduled through the parent so they do not contend with image/search/focus measurements or a shared dev server. Own only the server/session started for this task. No conflict with benchmark files or `vite.config.js`, because the existing environment support is sufficient.

## Comments

Planning only on 2026-10-21. The installed API/source and current shortcuts were inspected; the proposed workflow has not yet been exercised interactively.


Final integration observation, 2026-10-21: browser gestures/stacks and default/off/production exclusion passed. Native WebKit complete-DOM-event acceptance preserved text/selection, resolved the correct PaneHeader/parent stack, exited and resumed editing/menu behavior, and requested PaneHeader.svelte:53:3. The local editor launcher failed. Embedded driver special-key flags/hover transitions and the visible toggle behavior limit physical native activation evidence; see [triage 12](../../../package-capabilities/issues/12-inspector-native-activation.md) and the [workflow](../../../../docs/development/component-inspector.md). No product shortcut or driver patch was introduced.
