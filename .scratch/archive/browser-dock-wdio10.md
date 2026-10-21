# Browser dock regressions and WDIO 10 — 2026-10-21

## Diagnosis and correction

The dependency migration's full sweep exposed four failing browser specs:
`search-results`, `search-row-motion`, `split-pane-consistency`, and
`chat-controls`. Original callback-based tests from `19d16a1d`, run with cached
WDIO 9.32.0 against the same frontend and headless Chrome 155.0.8059.85,
reproduced the popup/motion failures and the clipped Vault access menu.

- Search popup text drifted 26px because it followed the animated body's center
  as neighboring actions clamped the bar. Its layout now uses the expanded
  destination center as well as its existing fixed destination width.
- Inline icon opacity masked the compact responsive rule. A shared opacity
  custom property lets the compact layout hide the glyph and fade it back on
  collapse, including reversals and reduced motion. The dock's width-driven
  option reveal now wins CSS specificity over the ordinary active-state rule.
- Populated compact control rows could flex-shrink the match-option container
  to zero, clipping its buttons. The compact row retains that container's width;
  the regression scrolls each real pointer target into the existing scrollable
  strip and restores the scope controls before checking their geometry.
- Pane sampling previously combined WAAPI's current frame with the dock's prior
  JavaScript frame. The sampler queues behind the app's frame callback without
  dropping assertions or widening tolerances. Unchanged dock states now join
  the existing pane clock, and fractional width reads avoid rounded geometry.
- Review found that an interrupted layout must capture the dock before cancelling
  the prior pane effects. A new mid-entry reversal test failed with a 158.7px
  jump before the correction. Layout preparation now preserves that painted
  origin through same-flush item changes; the original 1px bound passes.
- Fresh layout-only motions start on the pane effects' timestamp, preserving
  the full 380ms duration. The timestamp is consumed once for the matching live
  transition; item exchanges retain their existing clock. Compact rail tests
  retain their exact-duration assertions.
- The composer layer was clipped even after its morph settled. Clipping now
  applies only during the morph, so its upward menus remain reachable. Tests
  retain real WebDriver clicks; strict model selection names the intended first
  model explicitly. Additional desktop and phone cases exercise all five access
  choices after a dock exchange, checked state, Escape and outside dismissal.
- Native verification with real process restarts found an inherited-output-pipe
  teardown deadlock in the replacement launcher. A failing child-process test
  reproduced it; the harness now stops the verified fixture-owned replacement
  before joining pipes, flushing logs and removing data. The final nine-spec
  native run passed all 45 tests, including all four restart opt-ins.

## Verification

Final suite results are recorded in
[the migration report](../../docs/research/webdriverio-full-migration-2026-10-21.md).
The final complete browser sweep passed all 65 specs: 382 tests passed and 40
existing opt-in tests were skipped. Native smoke with real process restarts
passed all 45 tests across nine specs, with no skips. Agent replay, type checks,
production build, 1,396 frontend tests, 130 harness tests, Rust and Python gates
also passed (the frontend suite retains one existing skip). Test-owned servers
were stopped. Independent Standards and Spec reviews verified the interruption
and clock corrections; focused review also covered restart teardown. No findings
remain.

Temporary diagnostic instrumentation and the comparison harness were removed.
The retained regression tests and the baseline commit reproduce the relevant
behavior without depending on local temporary logs or screenshots.
