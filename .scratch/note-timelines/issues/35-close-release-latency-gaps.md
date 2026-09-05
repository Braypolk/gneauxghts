# 35: Close the measured Note Timeline release latency gaps

**What to build:** Resolve the remaining latency and write-cost evidence from issue 23 before declaring the initial Note Timeline release ready.

**Blocked by:** None.

**Status:** ready-for-agent

**Resolution:** Completed; release gate satisfied for the scope documented in the validation report.

- [x] First, make the synthetic 100,000-revision fixture reliably reusable so performance experiments do not repeat the roughly 40-minute write setup. Provide a documented create/reuse/reset workflow that validates fixture identity and revision counts, isolates each run from destructive clear/purge tests, and replaces the manual temporary-path restoration procedure. Keep this test-only and preserve the production-write origin of the fixture.
- [x] Measure the complete optimized native timeline paging and diff interaction through IPC and paint at the issue 23 scale, against the existing approximately 250 ms ordinary-interaction target. Separate backend and browser timings are insufficient.
- [x] Diagnose the 1 MiB small-edit save cost: the production command measured 88.5 ms p50 / 132.3 ms p95 for small changes, versus 29.4 / 34.2 ms for random full replacements. Establish whether checkpoint replay, line processing, canonical publication, or another stage dominates, then verify the spec's changed-content cost requirement with comparable geometry and history depth.
- [x] Reduce or explicitly resolve the 69–74 second cold integrity/recovery delay at 100,000 revisions. Preserve exhaustive payload/hash validation and mandatory preparation; do not skip attestation, silently admit a save, or introduce an unverified cross-operation cache.
- [x] Re-run the relevant scale and native measurements without overlapping builds/suites, retain failed observations, and update the issue 23 release decision with its exact supported scope.
- [x] After the final measurements, consolidate duplicated narrative across the release report, ADR, and issue updates. Keep the availability decision in ADR 0006, reproducible methods/results/limitations in the validation report, and actionable status in the issues, with links between them. Preserve measurement evidence and regression coverage; remove superseded diagnostic instructions once fixture reuse replaces them.

## Evidence

See [release validation](../../../docs/architecture/note-timeline-release-validation.md) and [machine-readable measurements](../../../docs/architecture/note-timeline-release-measurements.json). The corrected warm backend read budgets pass. This follow-up covers the remaining release attestation, not a rollback of the production availability policy in ADR 0006.

A 1 MiB note with 10,000 revisions and complete-replacement rendering were not measured together in issue 23; do not present separately exercised limits as that combined fixture. Inspect `ARCHITECTURE.md`, behavior invariants, and the applicable ADRs before changing runtime attestation, state ownership, or persistence consistency.

## Comments

2026-09-05: Added fixture reuse as the first implementation step and documentation consolidation after final measurements. Both belong to issue 35; no separate prerequisite cleanup issue is required.

2026-09-05: Implemented verified reusable production-write fixtures, disposable destructive/native runs, linear exhaustive attestation, transaction-verified prepared-base reuse, and explicit browsing health checks. Independent Standards/Spec review corrections add checkpoint-base validation and keep fixture checks enabled under Python optimization. On the user's delegated judgment, the spec now applies changed-content cost to additional history work; full-file canonical publication remains measured separately. Reproducible methods, all results, and exact limits live in the linked validation report; failed observations remain in the measurement archive.

2026-09-05: Final correctness suites and optimized scale checks passed; Standards and Spec reviews have no remaining findings. All acceptance items above are complete for the report’s explicitly supported scope.
