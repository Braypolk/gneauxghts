# Consume bounded read continuation in surviving-evidence test

Status: ready-for-agent
Progress: Complete; implemented and validated. See ../README.md.

## Evidence

Coordinator repeated the unchanged exact test in original and candidate binaries: original failed2/10, candidate failed1/10, all at the same launch-decision assertion. `evidence-read-failure-audit.md` records the source/log diagnosis: equal-score candidates sort by citation hash, whose random note identity varies ordering; the6000-byte read envelope may return only part of the selected IDs with a valid continuation. The test mistakenly treats that first response as complete.

## Exact change

In `editing_window_capture/tests.rs::focused_evidence_returns_surviving_period_ranges_after_later_edits_and_clear_invalidates` only: import `ReadRequest` locally; retain the initial read of all discovered IDs; follow its actual continuation with a loop bounded by selected-ID count; require progress, empty failure arrays, complete terminal delivery, and each selected ID exactly once. Aggregate items/sources and keep the existing launch/forbidden-excerpt/provenance assertions against that aggregate. Preserve all fixture writes, search calls, currentness, lexical/regex checks and history-clear invalidation.

No production limits, fixture recipe, test count, unrelated assertions or other tests change. Coordinator owns compilation, repeated exact-test verification, and full suite validation. Implementer does not run tests/builds.

## Implementation

The read now follows actual cursors, permits at most one page per requested ID, rejects empty progress/duplicate delivery/failures, requires complete terminal delivery, and verifies the selected-ID set exactly. Existing content assertions use aggregated items and sources. All subsequent currentness, lexical/regex and clear assertions remain unchanged. Source frozen; no tests/builds run by implementer.
