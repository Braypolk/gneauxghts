# Evaluate regressions and release the Gemma text/image feature

Status: needs-triage
Type: task
Depends on: 03, 05, 06, 07
Triage reason: implementation and runtime decision must be complete before rollout.

## Deliverable

A reproducible judged evaluation, appropriate automated checks, documented setup/migration/rollback behavior, and a release decision against the budgets established in ticket 01.

## Work

Compare current Jina with Gemma on identical text/chunk/ranking conditions, including multilingual/code notes, remembered chats, Related Notes and Atlas/name behavior. Evaluate all image retrieval directions with positives and hard negatives, screenshots, diagrams and text-bearing images. Record regressions and threshold decisions; parameter count and vendor scores are not acceptance criteria.

Measure cold/warm p50/p95 latency, indexing throughput, artifact/download size, peak RAM/VRAM, idle footprint and UI responsiveness on target hardware using the actual shipped projector. Record limits and untested platforms. Verify interrupted upgrade, explicit retry, source reconciliation and rollback with real runtime smoke tests.

Run appropriate Rust tests, `pnpm check`, focused Vitest/browser/native suites, and the separate real-runtime evaluation. Ordinary automated tests must not download models. Update feature/architecture documentation for actual shipped owners/contracts; leave audio/video ingestion disabled.

## Acceptance

All spec gates pass with recorded evidence before default deployment switches to Gemma. Failed quality/resources or inconsistent migration keeps Jina active and creates focused follow-up work. Documentation accurately states capabilities, platform support, measured footprint, indexing scope, and rollback.
