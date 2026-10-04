# Unexplained headed cursor selection failure

Status: ready-for-agent
Progress: Cursor harness correction complete and reviewed; all 110 headless browser cases pass. Historical headed timeout cause remains unproven.

See ../cursor-review.md and ../results.md. Three headless traces passed all
36 existing cases with no wrapped-fixture/model mismatch. No further production
cursor edit is justified. Preserve the next real failure's native/model
selection, focus and update-order trace using cursor-trace.spec.ts; never replace
the already corrected live sampler with the older pre-merge diagnostic copy.

## Cursor harness follow-up (2026-10-03)

Corrected exact fixture admission and authored selection setup, replaced synthetic
native ranges with real Shift+Arrow plus native/model agreement, and preserved
independent DOM geometry and all 12 cases/tolerances. No production cursor change.
Focused 12/12 and full headless 110/110 cases across 26 files passed; E2E types and
independent review passed. The old timeout was not reproduced, so its exact cause
remains unproven. No speculative renderer fix or further retry loop is warranted.
Native WebKit is unverified. See ../../cursor-stability/results.md and
../../cursor-stability/findings.md; earlier paragraphs describe historical stages.
