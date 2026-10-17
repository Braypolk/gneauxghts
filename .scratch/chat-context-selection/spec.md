# Historical chat context selection audit

> Superseded as executable scope by [the Pi rebuild](../archive/pi-chat-rebuild-scope.md). Implicit editor context, selected excerpts, exact passage navigation and filtered/frozen old-chat history are intentionally retired. The original measurements and outcomes below remain historical; current explicit note reads and source admission have new acceptance.

Trace why note context reaches the model before changing retrieval behavior. Cover automatic editor hints, explicit linked notes and attached context, conversation history, model-selected searches and reads, backend scope/ranking/deduplication, and coverage/continuation feedback. Measure representative requests using synthetic vaults and an offline scripted model. Keep private notes and credentials out of artifacts; make no paid provider requests for this audit.

Distinguish verified application behavior from hypotheses about model choices. Retain repeatable diagnostic traces and recommendations with enough evidence to choose the next focused change. Preserve current access, freshness, citations, proposal validation and Keep behavior. Do not change production context policy during the audit.

Audit complete. See [findings and selection map](audit.md), [compact measurements](summary.json), and the four numbered follow-up issues. The offline diagnostic and 14 affected tests passed; formatting and artifact checks passed. No paid model calls or production policy changes were made.

Subsequent authorized implementation: issues 01 and 02 are implemented; see [fixes and verification](fixes.md). The audit's original no-production-change restriction applied to its diagnostic phase.

Issue 03 is subsequently implemented; see [coverage and reuse](coverage-and-reuse.md). Live synthetic trace capture and repeated provider comparison remain issue 04.

## Live selection evaluation

Issue 04 is implemented and its bounded repeated comparison is complete. See [live evaluation](live-selection.md) for actual provider usage, equal 11/12 manual success per variant, retained capped failures, and the absence of demonstrated savings. [Issue 05](issues/05-named-source-gathering.md) tracks the observed next gathering problem.


Issue 05 has a measured instruction/guidance change and a corrected intent-aware comparison; see [related evidence and gathering](named-source.md). The user permits relevant related-note answers with source attribution. Explicit prose attribution improved in this sample, but overall quality and gathering savings remain unproven, so issue05 stays open. Offline96 and architecture21 checks pass; live failures remain retained.


2026-10-10: Issue05's reliability follow-up is implemented; see [report](reliability.md) and [approved plan](reliability-plan.md). Canonical coverage is explicit and actionable, evidence selectors are compact and context-local, and the scope rule now permits discovery for unresolved factual gaps while preserving named-record absence checks. Offline75/architecture21 pass. Thirty retained synthetic runs include all comparison failures; revised scope passes6/6 intent cases and the adopted production shortcut checks pass3/3. The shared core remains3,161 bytes. These small synthetic comparisons do not establish general reliability or savings; remaining retrieval opportunities and untested branches are explicit in the report.

2026-10-10: The user-requested real native multi-turn/semantic pass is complete;
see [validation](native-validation.md). Four of five answers were correct. The
updated-note follow-up selected the open draft instead of the production note,
reproducing a prior native failure; [issue 07](issues/07-followup-note-referents.md)
tracks it. An ordinary-search cache bug exposed by semantic enablement toggling
was corrected; search15/architecture21/type checks pass. Enabled semantic
retrieval, exact citation navigation, explicit topic change, new-topic follow-up
and durable reload were exercised. The native gate remains failing on the
unresolved referent case. No general success rate or source-identity fix is claimed.


2026-10-10: Issue07 is implemented; see [conversational referent validation](referent-validation.md).
Current permitted note identities survive old-answer omission and compaction in
bounded fresh app context linked to historical user intent. Editor metadata is
separate from authored dialogue; updated bodies require fresh reads. Final native
replays7/8 pass all five turns and citation/semantic/navigation/reload gates;
all prior failures remain retained. Targeted offline120 pass, and independent
review corrections are verified. The shared core remains3,161 bytes. Earlier
inline-citation omissions remain separately open in issue08; no general savings
or universal reliability is claimed.

2026-10-10: A subsequent [native citation reproduction](../chat-reliability/citation-entailment/native-validation.md)
exposed an explicit excerpt-only answer that broadens to the full canonical
note and misattributes the result to the excerpt. The unrestricted companion
correctly gathers the full-note answer. [Issue 09](issues/09-selection-only-answer-scope.md)
tracks that task-scope distinction; production context policy remains unchanged.

2026-10-14: [Issue 09 is resolved](../archive/excerpt-only-answer-scope.md).
Selections now expose exact-range canonical answer reads and excerpt-only scope
guidance. Native acceptance verifies the original restricted question, its
unrestricted full-note companion, and selection through the editor hint alone.
General semantic citation entailment and issue 08 remain separate follow-ups.
