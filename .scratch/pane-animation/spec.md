# Smooth pane opening and closing

Planning date: 2026-09-22
Scope: coordinated pane motion, populated-chat lag fixes, and animation cleanup implemented. See [validation results](validation.md).

## Goal and evidence

Adding or removing a pane should produce one continuous movement into its final layout, without the immediate half-width snap, delayed removal snap, or overshoot/settling sequence documented in [the findings](validation.md#causes-and-corrections).

The browser baseline showed those defects at approximately 60 fps. Treat broken animation wiring and conflicting geometry changes as the first work to fix. Text rendering performance remains a separate, unproven concern.

## First pass

Implement [01](issues/01-restore-pane-motion-styles.md) → [02](issues/02-coordinate-pane-and-workspace-motion.md) → [03](issues/03-verify-motion-and-interruption.md).

1. Move pane motion CSS into the component that renders the pane. Remove the ineffective parent-scoped rules. Keep the active border inside its pane so it follows the live bounds.
2. Add a small view-layer layout animation helper that coordinates actual pane widths, surrounding workspace geometry, Related-panel reservation, and opacity from measured start to final geometry. Opening begins with zero allocated width for the entering pane. Closing reaches zero before membership removal. Retain the existing 220 ms duration and easing for the first evaluation.
3. Use actual constrained start/end dimensions rather than animating a max-width ceiling past the available viewport. During pane motion, bypass the independent card width/margin transition and prevent Related layout observation from repeatedly retargeting the animation. Determine its final reservation using the final shell geometry and the existing layout policy.
4. Resolve close preparation from the actual visual completion, cancellation, or no-motion path rather than relying solely on the duplicate 220 ms JavaScript sleep. Keep a bounded failure fallback and unconditional cleanup so animation events cannot strand a pane.
5. Verify behavior and compare geometry/frame traces on the original scenario, then check the native Tauri renderer.

## Implementation boundaries

`WorkspaceStore` continues to own membership, order, active pane, and document references. The navigation pipeline continues to own departure/save ordering and stale-operation checks. Begin close motion only after those checks admit it. Failed or superseded closes restore the surviving element's normal presentation.

The helper owns only temporary presentation measurements, animation handles, and cancellation cleanup. It must not create another membership state machine, persist animation state, replace editor instances, or mutate note content. Read `ARCHITECTURE.md` and the pane/document behavior invariants when integrating it. Update architecture documentation only if the actual implementation changes an ownership seam.

Use one normalized progress curve for the participating dimensions. Measure at transition boundaries; do not build a per-frame read/write measurement loop. Animate explicit start/end pane widths rather than relying on flex-grow ratios while the outer width also changes. Keep underlying responsive layout rules authoritative once temporary animation styles are cleared. Initial mount and session restoration should not replay an entrance animation for every existing pane.

Keep the existing editor and chat DOM mounted during movement. Live text reflow remains in this pass. Preserve selection, scroll, focus, and input behavior. User-triggered Related expand/collapse outside pane motion retains its normal animation.

## Acceptance

- Opening has intermediate pane widths; the existing pane does not immediately halve before the movement starts.
- Closing either side has intermediate widths and no large jump when the removed pane leaves the DOM.
- Each pane's measured width moves toward its final width without the diagnosed reversal/overshoot; allow small subpixel rounding differences.
- Workspace, card, reservation, pane, and border settle together; clearing temporary styles does not cause another visible shift.
- Reduced motion reaches the final layout without an artificial animation wait.
- Rapid commands, resize during motion, disposal, and failed/stale close leave no stuck styles or orphaned animation work. Existing save/departure and active-pane behavior remain correct.
- The baseline browser fixture shows no reproducible frame-time regression. Native verification confirms that correct Chrome geometry also looks continuous in Tauri/WebKit.

## Evaluation and conditional follow-up

After the first pass, report before/after geometry and frame timing, native visual results, and any remaining text movement. If the movement is satisfactory, stop.

If it remains visibly rough, first reproduce and profile the residual symptom with native WebKit, wrapped long notes, rich blocks, and note/chat combinations. Distinguish frame stalls from unavoidable line-break changes. Only then evaluate a fixed text width with clipping/translation and one final reflow, or target measured CodeMirror/ResizeObserver/layout/paint costs. That work is deferred; do not add it to the initial patch without evidence that the first pass is insufficient.
