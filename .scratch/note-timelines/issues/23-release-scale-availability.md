# 23: Validate scale and production availability policy

**What to build:** The initial Note Timeline feature is exercised at its real operating limits, its failure behavior is measured, and the production policy for history-unavailable writes is made explicit before release.

**Blocked by:** 11: Make cleanly closed vaults portable; 12: Expose history health and recovery controls; 14: Group revisions into Editing Sessions; 15: Inspect deterministic historical diffs; 16: Name revisions and manage retained history; 18: Integrate forgotten notes with Note Timelines; 19: Recover and expire Missing Notes; 20: Compute Current-Content Provenance; 21: Answer chat activity questions with Revision Citations.

**Status:** ready-for-agent

- [x] Run the full temporary-vault, property, fault-injection, component, architecture-fitness, native lifecycle, and end-to-end suites for the completed initial feature.
- [ ] Verify ordinary timeline paging and diff display near 250 ms, deep reconstruction and restore preparation under one second, and write cost primarily proportional to changed content at the agreed scale targets.
- [x] Exercise 1 MB notes, 10,000 revisions on one note, 100,000 revisions across a vault, large baseline scans, long-running sessions, and bounded compaction.
- [x] Verify corruption detection, prepared-intent recovery, store replacement, clean-close portability, clear and purge boundaries, and restart behavior under interruption.
- [x] Confirm architecture checks prevent canonical-write bypass, editable History Mode ownership, unrestricted chat history access, and storage details crossing the domain seam.
- [x] Collect observed history-preparation and store-availability failures from development testing and evaluate the usability and data-integrity consequences of fail-closed behavior.
- [x] Record an explicit production availability decision and its evidence; do not silently retain, relax, or add a save-without-history bypass.
- [x] Keep existing note save, task, proposal, external conflict, forget and recovery, workspace, chat, and Markdown interoperability regression suites green.

## Comments

2026-09-04: Removed issue 22 from the release dependencies. Chat-requested Version Restore grants and proposals are deferred until there is demonstrated demand; their implementation and validation are outside this release gate. History Mode restoration and chat activity/provenance with Revision Citations remain in scope.


2026-09-05: Implemented the release harness and recorded [the validation report](../../../docs/architecture/note-timeline-release-validation.md), [all measured runs](../../../docs/architecture/note-timeline-release-measurements.json), and accepted production availability [ADR 0006](../../../docs/adr/0006-keep-history-preparation-mandatory-in-production.md). Corrected repeated page reconstruction, quadratic revision ordering, unchanged-diff rendering cost, native E2E server isolation, and native editor focus/selection restoration. Standards and Spec reviews have no outstanding code findings.

2026-09-05: Typechecking, 778 frontend tests, 465 Rust tests, 16 architecture checks, 11 browser journeys, and 7 native journeys passed. The fixture completed 100,000 durable revisions, and the corrected common read/recovery phase passed all assertions, including exhaustive hot-note paging, exact reconstruction, preparation failure/retry, restart, clear, and bounded compaction. Warm backend p95 measurements met their 250 ms / 1 second budgets. The rendering fixture measured 123.6 ms, excluding Rust and IPC.

2026-09-05: **Release gate remains held.** The remaining unchecked latency/write-cost requirement is tracked in [issue 35](35-close-release-latency-gaps.md): combined native interaction latency is not yet attested, small-edit saves were slower than full replacements in the measured workloads, and cold recovery took 69–74 seconds. No save-without-history bypass or relaxed integrity policy was introduced. The report distinguishes those remaining limits from the successful correctness checks.
