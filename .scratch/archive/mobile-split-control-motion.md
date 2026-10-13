# Split control continuity

2026-10-11. Resolved the unnecessary header and dock changes reported in the
5.7-second narrow-window recording.

## Causes and corrections

- Below 480px, split headers shrank all four action targets from 32px to 28px
  and removed the separator before the last action. Solo and split now retain
  the same sizes and spacing. The last action still correctly changes between
  Split and Close.
- The compact tab selector derived its insets immediately from collapsed-pane
  attributes, outside the pane animation. It now participates in the existing
  pane presentation coordinator, including interruption and cancellation.
  Opening the right pane retains its solo position; a right-side rail reserves
  enough space for the full-size left pane actions. Closing destinations release
  retiring rail space before animation, avoiding a second jump after removal.
- The two-row search layout introduced during semantic testing was measured as
  the dock's circle diameter. Focusing and blurring search therefore changed
  circular action sizes and horizontal exchange distances. The resolved search
  minimum height now supplies the circle diameter; separately measured content
  height grows the main bar and compresses before the circle exchange.

Pane membership, navigation, note ownership and persistence remain with their
existing owners. The image-upload search control stays removed.

## Verification

- New mounted regression reproduces the original shrink/spacer mismatch, then
  checks equal sizes/spacing, reachable controls and continuous selector travel
  at 320, 420, 480 and 638px.
- New dock geometry regression first failed, then passed with an 88px two-row
  search body and unchanged 40px circles and horizontal endpoints.
- Full retained-pane rail, search controls, workspace input dock and new control
  continuity suites: 53 passed. The retained-chat search/chat curve regression
  failed identically with the previous pane animation implementation, then
  passed after separating search content height from circle size.
- Dock, pane-close, top-action and architecture unit checks: 29 passed.
- Final navigation, animation cleanup and ordinary pane animation suites:
  another 32 passed (85 mounted checks total on the completed correction).
- Svelte/TypeScript checks: zero errors and warnings. Diff whitespace check passed.
- Updated the ordinary signed iOS simulator app. Native control checks exercised
  blank split opening/closing, opening the current note in a second pane,
  exchanging rail sides, closing the left pane, and expanding mobile search.
  The retained synthetic note and its title remained intact.

Two Related geometry tests now use two note panes, respecting the earlier
decision to hide Related over chat while retaining rail/Related coverage. The
desktop-title restoration test waits for the same retained element to return
after the media-query change instead of sampling before that DOM update.

Simulator checks establish UI behavior, not physical touch or device performance.
