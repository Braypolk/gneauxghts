# Animation lab — completed

Implemented the inventory-based development workbench with 36 transition cases,
Search/composer/Related variants, responsive viewport and inset controls,
interruption/reduced-motion conditions, 60fps DOM-frame inspection, normal-clock
live replay, A/B recording comparison and editable motion values.

Run `pnpm animation:lab`; guide: `docs/features/animation-lab.md`.
The launcher alone injects the fixture/runtime; ordinary app sources do not
import it. Applying settings checks every targeted source for concurrent edits
before planning narrowly scoped replacements.

Validation: `pnpm check` passed with zero errors/warnings; `pnpm build` passed;
37 existing container-motion tests and four source-edit regression tests passed.
Production artifacts contain none of the lab runtime markers. Browser inspection
verified Search/Related exchanges, Related/Chat, independent pane owners,
running/Stop, last-chat closure, Related Retry, mobile Related geometry,
retained previous-chat split, timeline stepping and A/B playback. A 760ms preview
reported 760ms on the recorded dock, then launch values were restored without
applying to source.

Limits: representative browser inspection is not an exhaustive cross-product
run. Snapshots do not rewind application state; the simulated clock and inset
controls need comparison with live/native behavior. Native WebKit material paint
and a real mobile keyboard were not tested. Current ChatPanel has no attachment
picker, so inventory attachment variants are explicitly excluded rather than
mocked. Existing timers/backend promises may finish on wall time during capture.

## Interface refinement

Replaced the permanent transition catalog with a grouped header picker and adjacent-case navigation. The preview fills the available space; Settings opens Motion/Scene tabs. Removed repeated descriptions and moved implementation notes into Inventory. Source saving stays disabled until changed values have been previewed. A/B preserves the inspected time and paused/playing state. Recording and live mode disable unavailable frame controls.

Verified preview-before-save states, frame-preserving A/B (200ms), reset, conditional interruption controls, and interactive mode in the browser. `pnpm check`, four launcher tests, and `git diff --check` passed after the redesign.
