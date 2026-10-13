# Mobile transition follow-up audit

2026-10-11. Follow-up to [split control continuity](mobile-split-control-motion.md),
checking the other button and layout transitions affected by the mobile work.

## Corrections

- Phone search used live expansion state for its two-row layout while the
  existing dock handoff retained visual expansion for its fade. Opening chat
  collapsed the controls into the input row while they were still visible.
  `SearchBar.svelte` now applies the retained presentation to both layouts.
- Split header actions took mouse focus before navigation, unlike solo header
  actions. That prematurely blurred and collapsed empty search before the dock
  captured its origin. Split actions now preserve pointer focus through the
  same mousedown behavior as solo actions; keyboard activation remains available.

A frame capture reproduced the outgoing controls changing their vertical offset
from 52px to 2px during the fade. The real pointer regression distinguished solo
and split behavior: retaining layout fixed solo, and split still failed until
its focus behavior matched solo. The completed checks assert unchanged row
placement throughout the visible fade with both mouse and emulated touch.

## Other transitions checked

- Search focus, scope labels, search/chat reversal, reduced motion, and dock
  geometry, interrupted motion, retained inputs, drafts and attachments.
- Split opening, rail exchange and closing; navigation and title-slot restoration.
- Related expansion/closing and return from chat with expanded state preserved.
- Model/provider menus, reasoning choices, composer geometry and unsent drafts.
- Chat history rendering, response scrolling, dock scrolling and message actions.
- History entry/return, revision naming and restore confirmation controls.
- Settings categories/search, unsaved configuration and model configuration.
- Touch formatting, block actions, task dates, inline image controls, viewer
  gestures and attachment previews.
- Portrait/landscape controls, safe-area collisions and keyboard viewport geometry.

No further application regression was reproduced in these checked journeys.
Two older assertions needed to follow intentional changes: the provider menu
now says Server, and the narrow two-row search hides the duplicate inner
magnifier. Image checks still assert contained preview geometry, separation from
its input, readable query width and unchanged authored image behavior. The
search image-upload picker stays removed.

## Verification

- 132 distinct mounted browser checks passed across 17 suites, including six
  focused presentation checks. The initially stale provider/image expectations
  passed after correction. The added Related check initially assumed an
  `aria-pressed` attribute; it now asserts the existing visible selected state
  and passed in the complete focused rerun. No checks were skipped.
- Dock, pane-action and architecture unit checks: 27 passed.
- Svelte/TypeScript checks: zero errors or warnings; diff whitespace check passed.
- Built and installed the ordinary signed iOS simulator app, preserving app data.
  Native smoke checks exercised expanded search to chat from solo and split
  notes, model-picker opening/dismissal, return to the original note, and closing
  the chat split. The retained synthetic note title and content remained intact.

Browser frame checks establish presentation continuity with real mounted owners.
Simulator checks establish native WebKit integration; physical-device touch and
performance acceptance remains in the existing iOS release gate.
