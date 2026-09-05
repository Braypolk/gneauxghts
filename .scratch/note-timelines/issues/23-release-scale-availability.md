# 23: Validate scale and production availability policy

**What to build:** The initial Note Timeline feature is exercised at its real operating limits, its failure behavior is measured, and the production policy for history-unavailable writes is made explicit before release.

**Blocked by:** 11: Make cleanly closed vaults portable; 12: Expose history health and recovery controls; 14: Group revisions into Editing Sessions; 15: Inspect deterministic historical diffs; 16: Name revisions and manage retained history; 18: Integrate forgotten notes with Note Timelines; 19: Recover and expire Missing Notes; 20: Compute Current-Content Provenance; 21: Answer chat activity questions with Revision Citations.

**Status:** ready-for-agent

**Resolution:** Completed; release gate satisfied for the scope documented in the validation report.

- [x] Run the full temporary-vault, property, fault-injection, component, architecture-fitness, native lifecycle, and end-to-end suites for the completed initial feature.
- [x] Verify ordinary timeline paging and diff display near 250 ms, deep reconstruction and restore preparation under one second, and additional history write work proportional to changed content at the agreed scale targets, reporting the full-file canonical publication floor separately (clarified in issue 35).
- [x] Exercise 1 MB notes, 10,000 revisions on one note, 100,000 revisions across a vault, large baseline scans, long-running sessions, and bounded compaction.
- [x] Verify corruption detection, prepared-intent recovery, store replacement, clean-close portability, clear and purge boundaries, and restart behavior under interruption.
- [x] Confirm architecture checks prevent canonical-write bypass, editable History Mode ownership, unrestricted chat history access, and storage details crossing the domain seam.
- [x] Collect observed history-preparation and store-availability failures from development testing and evaluate the usability and data-integrity consequences of fail-closed behavior.
- [x] Record an explicit production availability decision and its evidence; do not silently retain, relax, or add a save-without-history bypass.
- [x] Keep existing note save, task, proposal, external conflict, forget and recovery, workspace, chat, and Markdown interoperability regression suites green.

## Comments

2026-09-04: Removed issue 22 from the release dependencies. Chat-requested Version Restore grants and proposals are deferred until there is demonstrated demand; their implementation and validation are outside this release gate. History Mode restoration and chat activity/provenance with Revision Citations remain in scope.


2026-09-05: Initial implementation and corrected warm backend runs passed correctness checks but left combined native latency, small-edit save cost, and cold recovery unresolved. Original measurements and failed observations are retained in [the validation evidence](../../../docs/architecture/note-timeline-release-measurements.json); follow-up is [issue 35](35-close-release-latency-gaps.md).

2026-09-05: Issue 35 resolves the measured gaps and clarifies the changed-content criterion as additional history work, with full-file canonical publication reported separately. Final release status and supported limits are in [the validation report](../../../docs/architecture/note-timeline-release-validation.md). Production availability remains owned by [ADR 0006](../../../docs/adr/0006-keep-history-preparation-mandatory-in-production.md).

2026-09-05: Final correctness suites and optimized scale checks passed; Standards and Spec reviews have no remaining findings. All acceptance items above are complete for the report’s explicitly supported scope.
