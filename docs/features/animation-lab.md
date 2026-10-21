# Animation lab

Run `pnpm animation:lab` from the repository, then open
<http://127.0.0.1:1423/__animation-lab/>. The launcher uses a separate loopback
Vite server (override with `GNEAUXGHTS_ANIMATION_LAB_PORT`) and the existing
in-memory browser backend. No native app or running vault is required.

## Iteration

1. Choose a transition from the header picker. Use the arrows to move between cases. The 36 cases cover
   Search, Related, Chat, editor/chat departure and return, and pane ownership.
2. Open Settings → Scene for Search/composer/Related variants. Choose a viewport above the preview. Custom widths let
   you inspect either side of the dock, touch and pane breakpoints. Test both
   one-row and two-row bars, wide splits, collapsed rails and short windows.
3. Select Record, scrub the timeline, step one frame at a time, or play at 0.1–1x.
   The status line reports the painted dock position and dimensions.
4. Pin A, open Settings → Motion, adjust values, then select Preview changes.
   Toggle Show A / Show B to compare at the same timeline position.
5. Use Live replay for a normal-clock replay, or Interact for keyboard,
   focus and pointer inspection with the real components.
6. Save to source after previewing the values. This edits only the four motion
   sources listed in the inspector. Concurrent edits since launch reject the
   entire edit plan; restart the lab to adopt them. Commit through normal Git.

Copy configuration copies the scenario, dimensions, variants and tuning values
as JSON so a specific observation can be discussed and reproduced. Case links
retain the selected transition; the remaining controls are explicit in that JSON.
Inventory displays the original inventory beside the scenario controls.

## Recording and boundaries

The launcher injects the workbench runtime only into its browser fixture build.
It controls requestAnimationFrame/performance time and newly scheduled timeouts,
and advances finite CSS/WAAPI effects at 60 sampled frames per animation second.
Each snapshot retains the real DOM/SVG geometry and freezes animated properties.
Scrubbing replays these visual snapshots; it does not rewind application state.
Live mode always starts a fresh fixture document. This keeps the development
clock out of ordinary `pnpm dev`, production bundles and native app behavior.

Controlled recordings are an inspection aid. Existing timers and asynchronous
backend work can complete on real time, so compare with live replay before
choosing timings. Snapshot playback is inert; use live mode for focus and input.
Live replay uses the selected interruption and delay as well as the initial
action. Reverse is available for local focus/surface exchanges and pane
activation; cases without an explicit return action report it as unavailable.
Reduced-motion controls exercise JavaScript media listeners and suppress CSS
motion inside the fixture. Insets simulate shell space; native mobile keyboard
behavior and native WebKit material/outline paint need inspection in the app.

Image-query cases use the real paste path. The current ChatPanel has no attachment
picker, although the inventory lists attachments; no attachment UI is fabricated.
Other invalid combinations report an unavailable case and leave the live fixture
visible instead of silently substituting another transition.

## Verification

Run `node --test scripts/tests/animationLab.test.mjs` for edit validation,
concurrent-source guards and reversible timing substitution. Run `pnpm check`
and `pnpm build` for the ordinary application. Motion tuning itself should also
run the relevant dock/pane tests documented in the animation inventory.
