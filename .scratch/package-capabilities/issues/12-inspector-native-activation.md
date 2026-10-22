# Native inspector activation limitations

Status: needs-triage
Type: task

## Observed behavior

The existing plugin-svelte 7.3.1 inspector is a development aid. Its browser
modifier-only activation and stack menu work. During the authorized disposable
native check, the embedded tauri-plugin-wdio-webdriver 1.5.0 generated special
Control/Alt/Shift events without modifier flags. Its `dispatch_key_event` special
key path constructs KeyboardEvent without `ctrlKey`, `altKey` or `shiftKey`;
only the regular-character path includes them. Consequently WDIO Actions cannot
prove the physical native modifier-only shortcut. Pointer movement also emits
mousemove without mouseover, so the selected inspector target stays stale.

Complete DOM keyboard and hover events in the actual native WebKit proved
activation/hold release, unchanged CodeMirror text/selection, correct component
stack, Escape exit and resumed DOM editing/menu behavior. This is not physical
OS input verification. A desktop lookup found the regular app rather than the
disposable fixture; no input was sent to that regular app.

A bottom-right visible toggle click did not leave inspection enabled. The
installed inspector toggles in its button handler and also disables inspection
on a window click. The documented workflow uses keyboard activation and treats
the button as an active indicator. A source gesture requested the correct
`src/lib/ui/PaneHeader.svelte:53:3`; the local editor launcher failed. Developers
can open the displayed path manually.

## Minimal reproduction

Use a dedicated disposable native fixture after the foreground gate is approved.
Set `showToggleButton` to `"always"` in the documented opt-in JSON so it is
visible while inactive, then click its enable button and inspect its aria-label.
The observed label remained `enable svelte-inspector`.

For the driver event gap, focus CodeMirror, then run a WDIO key action with
Control `\uE009`, Alt `\uE00A` and Shift `\uE008` down/up. A body key listener
can record key/modifier flags without recording document text. Compare with
complete DOM KeyboardEvent flags; only the latter enabled this inspector.
Moving the pointer alone similarly omitted the mouseover needed to change the
inspector target. Do not confuse a driver-generated event with physical input.

## Boundary and reopening condition

No product shortcut, driver patch, persistent setting or permission is added
for this developer tool. Before implementation, choose whether to pursue an
upstream driver correction, a plugin button fix, or a narrowly owned direct OS
input check. A future driver change needs modifier-state and hover regression
coverage; a physical check must identify the disposable app before sending input
and retain the existing explicit foreground authorization gate.

## Evidence

- [Workflow and verified limits](../../../docs/development/component-inspector.md)
- [Completed implementation](../../archive/package-capabilities-2026-10-21.md)
- Ignored reproducible native spec/config and selected screenshots under
  `.scratch/package-capabilities/evidence/inspector/`.
- Local logs `/tmp/gneauxghts-capabilities-native-inspector*.log` preserve failed
  driver/button attempts and the passing explicit-DOM acceptance.

## Comments

2026-10-21: recorded while implementing archived ticket 03. Ordinary app checks
and production inspector exclusion pass; this follow-up concerns developer-tool
activation evidence and the installed upstream button behavior.
