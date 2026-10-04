# Cursor harness correction

The focus controls did not reproduce the historical timeout. Blurring an element
was recovered by Chromium selection focus. A hidden tab correctly stopped frames;
a headless popup did not remove the original document's focus. Neither is evidence
of the old failure. A no-op view update or focus refresh left an immediate native/
model mismatch but it converged by two frames; do not call that a sustained bug.

Two independent harness weaknesses are nevertheless established in source:
1. Fixture readiness accepts the common text `Wrapped text`, shared by every prior
   case, instead of the exact new authored document.
2. Geometry setup uses asynchronous browser-selection mutation plus accumulated
   rendered text offsets. It neither establishes an admitted model position nor
   distinguishes authored characters from widget text. A visible existing cursor
   is then used as a readiness signal for a new selection.

Correct these test assumptions rather than guessing at a production renderer fix.
Use existing public E2E selection/snapshot capabilities for geometry setup; keep
expected measurements as independent DOM ranges. Map rendered Wrapped tokens to
corresponding known authored tokens rather than summing all DOM text. Real keyboard
range selection and real pointer placement remain separately asserted, including
native/model agreement and focus hiding. All 12 scenarios and current tolerances
remain. No increased timeout, re-applied selection polling, or production change.

This eliminates the identified weak setup path. It does not establish the exact
cause of the older uninstrumented headed run or prove every conceivable cursor
flake impossible. Headless execution also prevents external desktop input from
interfering, without attributing the historical `Wnrapped` to the user.
