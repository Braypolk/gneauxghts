# Native pane-motion content width assertion fails on the current baseline

Status: needs-triage
Type: task

The foreground native `pane-animation.spec.ts` fails `expectContinuousMotion` at
`e2e/support/paneMotion.ts:234`: a sampled content width differs from final content
width by **319 CSS pixels** (allowed ≤1). The UI includes an entering pane chooser.

## Reproduction and comparison

On 2026-10-21, with the embedded macOS driver 1.5.0, request logical window size
1440×900 (do not multiply by Retina devicePixelRatio), then run:

```sh
GNEAUXGHTS_E2E_FOREGROUND=1 TAURI_WEBDRIVER_PORT=4457 \
  pnpm exec wdio run e2e/wdio.native.conf.ts \
  --spec e2e/specs/native/pane-animation.spec.ts
```

The same assertion and exact 319-pixel mismatch reproduce with both patched
CodeMirror/Lezer graphs: view/common/Markdown **6.43.1/1.5.2/1.6.4** from
`84fea1a4`, and upgraded **6.43.15/1.5.3/1.8.1**. Application source and corrected
fixture geometry were identical in the comparison. The upgrade is not the cause. Local raw [previous-version](../evidence/editor-upgrade-2026-10-21/previous-versions.log) and [upgraded-version](../evidence/editor-upgrade-2026-10-21/upgraded-versions.log) failure output is retained for triage.
The existing [validation limits](../validation.md#remaining-profiling) already
acknowledge live text reflow during width animation. Investigate whether the
assertion incorrectly includes pre-transition layout or exposes a behavior gap;
do not weaken its tolerance without establishing the intended contract.

## Acceptance

Determine which frame and pane produce the width mismatch, verify the intended
content-width contract against current motion ownership, and correct either the
sampling/admission or product behavior. Preserve editor identity, continuous
pane/border motion, focused visible sampling and cleanup checks. Reproduce on
actual foreground WebKit; headless Chrome alone is insufficient.

## Comments

Discovered during the [editor dependency upgrade](../../../docs/research/codemirror-lezer-upgrade-2026-10-21.md).
Native wrapped-cursor focus (three fresh invocations), editor cursor (12 cases),
visible Markdown (7), dock outline (2) and giant quote (2) acceptance passed on the
upgraded graph. No application pane-motion fix was attempted in that task.
