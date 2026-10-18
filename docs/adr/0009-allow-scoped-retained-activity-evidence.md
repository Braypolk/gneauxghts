---
status: superseded by ADR-0012
---

# Allow scoped retained activity evidence

[ADR 0012](0012-found-ordinary-chat-on-pi.md) records the accepted new-user Pi
rebuild and its scoped supersessions. The implementation described below is
historical and retired from ordinary chat; it is not a current runtime requirement.
The 2026-10-17 amendment removes its unused native activity-history capability
and supporting activity/provenance implementation and tests.


Activity questions need the specific changes recorded during an interval, including content that was subsequently removed or superseded. Ordinary chat may now request read-only retained authored changes through NoteTimeline using an explicit activity range and the existing current-note access policy. This supersedes ADR 0003's prohibition on historical prose for this bounded activity use case; it does not grant History Mode administration, Version Restore, or direct write authority.

Historical passages are labeled as added or removed lines and cite their retained content revision. They do not establish current task status. The agent must retrieve current evidence when deriving follow-ups, distinguish inferred recommendations, and qualify uncertain timing and incomplete coverage. Baselines, discarded Editing Window intermediates, cleared history, missing/forgotten notes, and excluded notes cannot be represented as known work. Title/lifecycle events are outside the authored-change interface and its coverage declaration says so.

Citation delivery and navigation recheck current access, captured canonical identity and retained change proofs. Historical citations open the retained content revision; current citations open current text. Earlier assistant answers are not primary evidence. Note-based answers are omitted from later model-history replay and compaction; source-free assistant dialogue remains available under the ordinary history limits.
