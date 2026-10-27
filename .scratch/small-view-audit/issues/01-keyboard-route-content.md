# Keep Settings and List content reachable with the landscape keyboard

Status: needs-triage
Disposition: deferred — user requested leaving landscape issues out of current scope.
Priority: P1
Type: task

## Reproduction

Use the browser fixture at 844×390 with coarse pointer/touch emulation. Open Settings and focus Search settings, then override visualViewport height to 126 and dispatch resize (same approach as `e2e/specs/browser/mobile-viewport.spec.ts`). Repeat in List with Search tasks focused.

Settings shrinks the shell to 126px, but its toolbar and padding occupy the card. `.settings-content` starts at y=116 and is clipped by the card ending around y=110. List's task scroller starts at y=226, completely below the visible viewport. Searching cannot show accessible results until the keyboard is dismissed.

Sources: `src/lib/features/settings/settings.css:23–30`; `src/routes/list/+page.svelte:169–244`; shared shell measurement is `src/lib/ui/mobileViewport.ts:16–37`. Preserve the existing shared visual-viewport owner when fixing route layout.

## Acceptance

- Search stays visible and useful result content remains scrollable/tappable above the keyboard at visual height 126; route chrome may compact or join the scroll area.
- Entering a query shows accessible Settings results/task matches while the keyboard is still open.
- Rotation, keyboard dismissal/reopening, normal phone portrait and ordinary desktop layout recover without stale offsets or lost query/filter state.
- Add meaningful mounted regressions for both routes; verify real iPhone/WebKit behavior separately.

See [audit](../report.md), [Settings screenshot](../evidence/probe-settings-keyboard.png), and [List screenshot](../evidence/probe-list-keyboard.png).
