# 18 — Correct and prove backend search command composition

Status: ready-for-agent
Type: task
Audit items: BB-01, BB-02, BB-03, BB-07; related AA-10

Evidence: [backend boundary supplement](../reports/backend-boundaries-supplement.md).

## Work

Reproduce title-only search/related cache collisions with deterministic command tests, then include all behavior inputs in result request identity. Establish intended no-hash input policy. Filter command-eligible document kinds before the final hybrid limit, preserving merger chat-kind behavior for other callers. Keep the fabricated CurrentContent test under honest lower-boundary ownership and add real command cache/deferred retrieval plus concurrent-mutation admission. Remove the ignored refresh-age argument and redundant timing waits only after observable dirty/cold/warm/foreground assertions exist.

## Acceptance and validation

Unchanged-body title changes within cache TTL produce correctly ranked fresh results. A high-scoring chat candidate cannot crowd either of two eligible notes at limit two. A concurrent canonical mutation blocks stale command delivery on fresh and cached query paths. Unicode/tag/selection/body admission remains intact. Keyword fallback before projection, cold discovery and foreground yielding still pass. No online model dependency in the regression tests.

Read ARCHITECTURE.md and linked invariants/ADRs before changing current-access admission, state ownership or runtime seams. Start with reproduced composed failures; static risk alone does not justify changing ranking policy or cache authority. Run affected search/command tests, contracts and Rust architecture checks.
