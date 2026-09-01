# 21: Answer chat activity questions with Revision Citations

**What to build:** Chat can answer temporal questions about current notes using activity metadata and Current-Content Provenance, with clickable evidence, without gaining ordinary access to removed historical prose.

**Blocked by:** 13: Open and navigate History Mode; 19: Recover and expire Missing Notes; 20: Compute Current-Content Provenance.

**Status:** ready-for-agent

- [ ] Add an on-demand current-content history capability to chat context assembly rather than injecting provenance into every request.
- [ ] Reapply stable Note Identity, vault-access, global exclusion, and current-note eligibility rules when resolving activity or provenance.
- [ ] Answer activity-period questions with current notes, current excerpts, revision counts, times, and Mutation Sources only.
- [ ] Prevent ordinary chat from searching, quoting, summarizing, or recalling prose that is absent from the current note.
- [ ] Exclude forgotten, Missing, purged, and otherwise disallowed notes from activity and provenance results.
- [ ] Return Revision Citations containing Note Identity, revision identity, timestamp, Mutation Source, and current excerpt.
- [ ] Open a citation in History Mode at its supporting revision without changing the existing workspace state.
- [ ] Add capability-isolation, context-policy, component, and end-to-end tests proving removed prose cannot cross the ordinary chat boundary.
