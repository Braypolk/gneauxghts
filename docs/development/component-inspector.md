# Inspect Svelte component owners

The installed `@sveltejs/vite-plugin-svelte` 7.3.1 includes a development-only
component inspector. It is off by default. Start an existing development command
with a one-command opt-in:

```sh
SVELTE_INSPECTOR_OPTIONS='{"toggleKeyCombo":"control-alt-shift","holdMode":true,"showToggleButton":"active","toggleButtonPos":"bottom-right"}' pnpm dev
```

Use the same prefix with `pnpm agent:serve` for a dedicated disposable browser
fixture, or with `pnpm tauri dev` for a disposable native development vault.
Follow [UI verification](../agents/ui-verification.md) and the native foreground
policy in [E2E conventions](../../e2e/README.md). Keep this tool off during ordinary
regression tests, measurements and release runs.

The plugin spells the modifier `control`; this is separate from the app's
`Ctrl+...` shortcut notation. Hold Control, Alt/Option and Shift, then point at a
control. Right-click to display its component stack. Choose a stack entry to
request opening that source file and line in the local editor. Arrow keys move
among inspected elements; Space opens the stack menu and Enter opens the selected
element's source. A short press (under 250 ms) leaves inspection toggled on;
releasing a longer hold disables it. Escape exits and closes the inspector menu.
Use the keyboard combination for activation. The active indicator sits at the
bottom right to avoid the app's top drag region. In the installed 7.3.1 native
check, clicking the visible toggle did not leave inspection enabled; the plugin
also disables inspection on a window click. Do not rely on that button as a
fallback. While active, inspection intercepts clicks used for source selection.

This modifier-only combination avoids inserting an activation character into
CodeMirror and does not overlap the current default application shortcuts.
Custom shortcuts or accessibility tools may already use it. Choose a free
modifier-only combination, for example changing only `toggleKeyCombo` to
`"control-alt-meta"`. No application shortcut is
reserved or changed by this workflow.

The variable applies only to that shell invocation; do not add it to a committed
`.env` file. Explicitly disable inherited settings when checking normal behavior:

```sh
SVELTE_INSPECTOR_OPTIONS=false pnpm dev
SVELTE_INSPECTOR_OPTIONS=false pnpm agent:serve
```

The plugin applies to Vite development serving only. Production builds must not
contain its overlay/runtime even if the opt-in variable is present during the
build. E2E mode alone does not enable it.

## Verification record

The browser fixture resolved `PaneHeader.svelte` and its parent `NotepadPane`,
and the chat composer resolved `ChatPanel.svelte` through `NotepadPane` and
`Notepad` to the page. Holding/releasing modifiers, short-press toggling,
Space/right-click menus, Escape exit, subsequent typing and app menus passed.
The browser trace lives in the ignored `capabilities-inspector` WDIO session.

The authorized disposable native check resolved the same pane stack and
requested `src/lib/ui/PaneHeader.svelte:53:3` through `__open-in-editor`.
The dev server reported that it could not open the editor. Open the displayed
repository path and line manually if no local editor launcher is configured.
This verifies the requested location, not successful editor launch.

Native activation preserved editor text and selection; Escape restored DOM
text input and normal menu opening/dismissal. The embedded driver omits modifier
flags on special keys and does not synthesize mouseover transitions. This check
therefore supplied complete DOM keyboard/hover events to real native WebKit;
it does not establish delivery of the physical OS keyboard chord. See the
[activation follow-up](../../.scratch/package-capabilities/issues/12-inspector-native-activation.md).
No driver or application shortcut behavior was changed to accommodate it.

Ordinary development serving with inspector/E2E variables unset injected no
inspector into the page or Vite client. An ordinary native E2E start also had no
inspector DOM/runtime. A production build deliberately ran with the opt-in
present: emitted assets contained no inspector runtime/overlay/source-opener
path, and the actual production frontend rendered and accepted DOM editing in
the disposable native app without inspector resources. Selected native
screenshots and reproducible checks are ignored under
`.scratch/package-capabilities/evidence/inspector/`; the
[implementation outcome](../../.scratch/archive/package-capabilities-2026-10-21.md)
records combined acceptance and limits.
