# 23: Validate scale and production availability policy

**What to build:** The initial Note Timeline feature is exercised at its real operating limits, its failure behavior is measured, and the production policy for history-unavailable writes is made explicit before release.

**Blocked by:** 11: Make cleanly closed vaults portable; 12: Expose history health and recovery controls; 14: Group revisions into Editing Sessions; 15: Inspect deterministic historical diffs; 16: Name revisions and manage retained history; 18: Integrate forgotten notes with Note Timelines; 19: Recover and expire Missing Notes; 20: Compute Current-Content Provenance; 21: Answer chat activity questions with Revision Citations; 22: Propose explicit chat-requested Version Restores.

**Status:** ready-for-agent

- [ ] Run the full temporary-vault, property, fault-injection, component, architecture-fitness, native lifecycle, and end-to-end suites for the completed initial feature.
- [ ] Verify ordinary timeline paging and diff display near 250 ms, deep reconstruction and restore preparation under one second, and write cost primarily proportional to changed content at the agreed scale targets.
- [ ] Exercise 1 MB notes, 10,000 revisions on one note, 100,000 revisions across a vault, large baseline scans, long-running sessions, and bounded compaction.
- [ ] Verify corruption detection, prepared-intent recovery, store replacement, clean-close portability, clear and purge boundaries, and restart behavior under interruption.
- [ ] Confirm architecture checks prevent canonical-write bypass, editable History Mode ownership, unrestricted chat history access, and storage details crossing the domain seam.
- [ ] Collect observed history-preparation and store-availability failures from development testing and evaluate the usability and data-integrity consequences of fail-closed behavior.
- [ ] Record an explicit production availability decision and its evidence; do not silently retain, relax, or add a save-without-history bypass.
- [ ] Keep existing note save, task, proposal, external conflict, forget and recovery, workspace, chat, and Markdown interoperability regression suites green.
