# 35: Close the measured Note Timeline release latency gaps

**What to build:** Resolve the remaining latency and write-cost evidence from issue 23 before declaring the initial Note Timeline release ready.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] Measure the complete optimized native timeline paging and diff interaction through IPC and paint at the issue 23 scale, against the existing approximately 250 ms ordinary-interaction target. Separate backend and browser timings are insufficient.
- [ ] Diagnose the 1 MiB small-edit save cost: the production command measured 88.5 ms p50 / 132.3 ms p95 for small changes, versus 29.4 / 34.2 ms for random full replacements. Establish whether checkpoint replay, line processing, canonical publication, or another stage dominates, then verify the spec's changed-content cost requirement with comparable geometry and history depth.
- [ ] Reduce or explicitly resolve the 69–74 second cold integrity/recovery delay at 100,000 revisions. Preserve exhaustive payload/hash validation and mandatory preparation; do not skip attestation, silently admit a save, or introduce an unverified cross-operation cache.
- [ ] Re-run the relevant scale and native measurements without overlapping builds/suites, retain failed observations, and update the issue 23 release decision with its exact supported scope.

## Evidence

See [release validation](../../../docs/architecture/note-timeline-release-validation.md) and [machine-readable measurements](../../../docs/architecture/note-timeline-release-measurements.json). The corrected warm backend read budgets pass. This follow-up covers the remaining release attestation, not a rollback of the production availability policy in ADR 0006.

A 1 MiB note with 10,000 revisions and complete-replacement rendering were not measured together in issue 23; do not present separately exercised limits as that combined fixture. Inspect `ARCHITECTURE.md`, behavior invariants, and the applicable ADRs before changing runtime attestation, state ownership, or persistence consistency.
