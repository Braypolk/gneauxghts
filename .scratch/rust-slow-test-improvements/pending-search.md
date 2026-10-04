# Pending keyword search fixture reduction

Progress: Implemented and source frozen; coordinator validation pending.

Changed only `bulk_notes_are_keyword_searchable_before_background_indexing_finishes` in `src-tauri/src/commands/search_commands.rs`. Its name and the file's test inventory are unchanged. Comparison against the saved phase baseline confirms all bytes outside this function are unchanged.

The fixture now writes two explicitly named imports: one manually indexed note and one pending note. This removes 62 file writes and 62 queued projections while preserving the real foreground guard, catalog prewarm, production current-content search boundary, and real background queue. There is no production 64-note branch in the inspected prewarm/fallback paths.

Retained assertions cover catalog population, pending signature absence before search and after body/title searches, keyword reason, note identity, highlights, indexed-note deduplication, successful indexing of every fixture note, cache invalidation, and the exact single pending-note result with keyword reason after indexing. Shutdown and environment cleanup remain intact.

The post-release 30-second signature polling loop is replaced by the existing condition-variable `wait_until_idle_for_test`, followed by explicit successful-signature assertions for both notes. Its five-second bound is deliberate and approved for this two-note fixture, matching existing queue tests. Idle alone is not treated as successful indexing.

The target function decreases from 92 to 83 lines. No test/build/benchmark was run by this agent; root owns execution and timing. No speedup is claimed before those measurements.

## Final coordinator acceptance

All 725 library tests and 21 architecture checks pass, with unchanged inventory. Targeted comparisons and repetitions pass; mutation-sensitivity checks fail as intended and all sources are restored. Exact timing and full-suite variability are in README.md. Implementation is complete.
