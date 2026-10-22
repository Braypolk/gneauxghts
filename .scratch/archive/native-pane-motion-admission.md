# Native pane-motion sampling admission

Status: resolved
Type: task
Date: 2026-10-21

## Cause and correction

The native pane-motion check reported a 319 CSS-pixel content-width mismatch
with both the old and upgraded CodeMirror/Lezer graphs. It was an assertion
error, not an application reflow defect. The workspace split command awaits
recent-note loading before publishing pane membership. The sampler legitimately
records visible frames during that wait, but `expectContinuousMotion` compared
every recorded content width with the eventual destination width.

The focused native capture showed an unchanged, focused single pane at 4ms:
pane/content width 1022px, no motion marker and no pane animation. The next
sample had two panes, active motion and the intended fixed 703px content width.
The final split content was also 703px. Comparing the first source-layout frame
with that destination produced exactly 319px. Selected raw frames are retained
in [the evidence](native-pane-motion-admission.frames.json).

The assertion now requires captured source wrapping before admission, then
destination wrapping starting at the first observed motion marker, membership
change, or pane position/width change. That boundary stays latched through the
settled tail. No frames are dropped. The one-pixel content tolerance, opaque
content/controls, editor identity, intermediate and monotonic pane geometry,
border attachment and stable final card checks are preserved. The application,
pane coordinator, membership/departure owners and native spec are unchanged.

## Regression and verification

The maintained browser pane-animation regression holds the existing recent-note
fixture lookup for six real animation frames. The actual workspace command,
Svelte updates and WAAPI motion remain real. It asserts multiple source-layout
frames, complete continuous motion and stable entrance layout. Negative controls
inject a two-pixel content drift into the source phase and first motion frame;
both must still fail. The temporary fixture override is removed in `finally`.

- The original foreground native spec reproduced the 319px failure twice.
- The controlled browser regression failed with the same 319px mismatch before
  the assertion fix, then passed with the fix and both negative controls.
- The original native spec passes in **three fresh invocations**, including
  opening and closing either side, retained editor identity, and OS/DOM focus
  throughout. Native populated-chat motion (1), dock outline (2) and wrapped-
  cursor search focus (2) also pass, each in a fresh disposable invocation.
- All **54 cases across five affected browser specs** pass: pane animation (11),
  split consistency (15), populated chat (3), interruption/cleanup (6) and
  responsive rails (19). Coverage includes reduced motion and resize/reversal.
- `pnpm test`: **139 support checks and 1,418 frontend tests pass**, with one
  existing frontend skip. `pnpm check`: zero Svelte errors/warnings; E2E
  TypeScript passes. Local Standards and Spec review found no actionable issues.
- Owned browser/native listeners and apps are closed; `git diff --check` passes.

The original native reproduction and corrected verification use:

```sh
GNEAUXGHTS_E2E_FOREGROUND=1 TAURI_WEBDRIVER_PORT=4457 \
  pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/native/pane-animation.spec.ts
```

Native foreground runs use the admitted, signed, disposable E2E app with its own
vault and app-data roots. The unchanged pinned native executable is sufficient
because this fix changes only the TypeScript test assertion and its regression.
Its admitted debug SHA-256 is
`6bb1c9ceb97c2db9210dda859db5b7a9a131d08b8c3437080045bfdf2d0ab206`.
Native and browser Vite servers run serially. This investigation establishes
geometry/focus correctness; it does not establish GPU paint cost or a universal
frame budget. No machine-specific latency gate was added.

## Historical context

This resolves former ticket
`.scratch/pane-animation/issues/04-native-content-width-baseline.md`, discovered
during the [editor upgrade](../../docs/research/codemirror-lezer-upgrade-2026-10-21.md).
The original failed native runs remain failed historical evidence; later passing
runs do not rewrite their outcomes. Earlier [pane animation validation](../pane-animation/validation.md)
also remains historical, including its separate profiling limits.
