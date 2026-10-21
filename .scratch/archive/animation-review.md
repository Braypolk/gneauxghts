# Animation review — completed

Reviewed the inventory through the animation lab using recorded frames and measured bounds.

## Changes

- Closing an active editor or Chat now hands dock presentation directly to the surviving adjacent Chat. Previously Search appeared between the old and new owners, producing two consecutive morphs. WorkspaceStore exposes the same right-then-left destination used at retirement; canonical activation still commits at retirement.
- Fixed the lab recording clock: negative virtual RAF IDs collided with CodeMirror’s no-frame cancellation sentinel and froze Related → replace editor with Chat. Virtual IDs now occupy a positive reserved range. Cancellation works for transferred native handles and callbacks in the same batch.
- Lab outside-focus actions now focus the actual editor. Search and other scripted clicks issue pointer intent before click so interrupted navigation does not restore stale composer focus.

Existing timing values were retained. Draft resize remains immediate for typing responsiveness.

## Verification

- All 36 desktop baseline scenarios recorded through completion, with intermediate geometry inspected at 0/100/200/300/400/600/1200ms and expected final surfaces.
- Eleven phone baseline cases: Search focus/blur, Related open/close, Chat/Search exchanges, Related/Chat, split Chat, active editor closure, one-of-many Chat closure and last Chat closure.
- Phone interruption checks: reversal, retargeting and reduced motion enabled during motion. Reversing retained Chat activation now stays in Search after the newer pointer intent.
- Closing an editor or one of multiple Chats remains in Chat throughout collapse at desktop and phone widths; dock settles by 400ms without the extra Search step.
- 59 targeted unit tests passed. Svelte/type checks passed. Production build passed. Diff whitespace check passed.
- Added browser regression cases for both close destinations; typechecked, with behavior verified through the lab. The browser E2E runner was not executed.

## Limits

Coverage is representative, not every combination of viewport, content and interruption. Native WebKit painting and a real mobile keyboard still require native verification. Current ChatPanel has no attachment picker. Recorded DOM frames complement normal-clock/native inspection; they do not reproduce browser paint or rewind application state.

## Split input centering follow-up

Reproduced a settled split composer centered at x=635 in a workspace centered at x=720. The 52rem dock host was left-aligned inside a wider discovery flex region. Centering only that host would still offset the input by its unequal sibling icons.

The host now fills the discovery region; capped content sizes remain unchanged. MorphingContainers can center the content body while clamping its sibling icons inside the host. The default group alignment remains unchanged for other callers. Narrow layouts retain their full available input width.

Validation: two new geometry regressions cover asymmetric sibling layouts and narrow clamping. All 39 motion tests and three recording tests pass. Type checks and production build pass. Recorded desktop splits at 1440 and 1920 center Chat, Search and Related exactly; normal-clock split Chat also centers at 720/720. Controls remain inside their row at 900 and 390. Added browser integration coverage for both input modes at wide split widths; the E2E runner was not executed.

## Pre-commit audit — 2026-10-21

Independent standards and spec reviews found two lab defects: Reverse used a
layout-based fallback that could open an unrelated surface, and Live replay
ignored interruption settings. Reversals now use explicit scenario return
actions, reporting unsupported cases as unavailable. Recording and Live replay
share the selected interruption and delay.

The user approved retaining centered capped inputs. Reconciled the former
fixed-position circle requirement and browser assertions: centered inputs retain
their body position while both full-size opaque shells translate together;
narrow exchanges retain fixed shell endpoints. Motion sampling now uses the RAF
timestamp and bounds foreground glyph speed by its composed easing rather than
the bar's slower curve.

Validation: 95 focused Vitest tests and four source-edit tests passed; Svelte
checks report zero errors/warnings, browser TypeScript checks and the production
build pass. Browser
suites passed for split discovery selection and Related layout. All 19 responsive
pane cases and 28 dock cases passed, followed by the remaining wide motion case
after correcting its obsolete geometry and clock assertions. Lab browser checks
verified Search focus reversal, recorded/live Chat reversal, live reduced-motion
interruption and the unsupported-reversal message.

Concurrent dependency upgrades belong to another chat and are excluded from this
audit and commit. Final checks used an isolated source copy with the original
lockfile. Native WebKit painting and physical mobile keyboard behavior remain
unverified by this audit.
