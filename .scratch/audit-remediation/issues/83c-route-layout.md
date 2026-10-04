# Establish Related layout before the first route-return paint

Status: ready-for-agent
Progress: complete
Owner: root

## Reproduction

Full browser integration editor-route-layout at868px sees36px card-width change
on return from Settings. Related starts as side/reserve0 then measures bottom;
first explicit measurement follows awaited editor/bootstrap/refresh work. The
ResizeObserver callback also occurs after an initial rendering opportunity.

## Fix and verification

Measure synchronously when the mounted shell is available, before async session
work. Preserve later resize/layout updates. Existing real browser first-frame
geometry test is the regression owner; rerun both widths and navigation lifecycle
unit tests. This is a discovered integration defect, not a reason to weaken the
first-visible-frame assertion.

## Outcome

Synchronous initial measurement fixes the first-visible width. Existing browser
checks at868px and1440px pass on three repeated route returns each; focused session
lifecycle tests pass. No geometry assertion was weakened.
