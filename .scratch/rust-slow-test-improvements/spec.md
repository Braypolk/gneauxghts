# Focused Rust slow-test improvements

Progress: Complete. See README.md for final acceptance and timing limits.

Implement the three recommended first improvements from ../rust-slow-tests/: pending keyword search, verification cancellation, and deterministic released-capture recovery. Preserve real production operations, all existing behavioral assertions and regular test inventory. No checkpoint/inventory production optimization or reduction of corruption/paging coverage belongs in this phase.

1. Pending search: two roles (indexed and pending), real foreground pause/prewarm/search/projection drain. Retain signature absence, keyword/identity/highlight, duplicate, post-drain and cache invalidation checks. Use existing idle wait plus successful-signature assertions; its five-second failure bound is sufficient for two notes and matches existing queue tests.
2. Cancellation: smaller real chain, cancellation after payload replay begins, typed Unavailable, explicit proof it does not traverse later corrupt payload. Removing the replay-loop cancellation must fail the test. Do not add production interfaces only to label callback phases.
3. Recovery: replace ten probabilistic repetitions with reader-first and writer-first contention schedules. Gate real recovery ownership, prove competing callers reach the blocked mutex, release unconditionally on failure, retain real failed B publication and C save plus all final-state checks. Any hook must be cfg(test), runtime-local where practical, small, and avoid duplicating production locking behavior. Removing shared recovery ownership should be detected.

Root owns all builds/runs and integration. Subagents may edit disjoint assigned files. Snapshot baseline captures previous uncommitted work; diff only this phase. Validate focused tests and mutation sensitivity, repeat deterministic races, then run full Rust and architecture checks once changes settle. Record runtime separately from compilation; preserve exact source after temporary mutation checks.
