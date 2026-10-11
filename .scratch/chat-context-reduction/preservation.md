# Description preservation

All ten tools remain advertised. The non-description JSON comparison verifies names/order, types, required fields, enums, limits, alternatives and additionalProperties are unchanged. This comparison establishes schema structure, not semantic equivalence; the following accounts for prose.

| Tool | Retained contract / destination |
| --- | --- |
| search_evidence | Discovery before read/citation; scopes from metadata, not topics; period work requires include_history and range; edit time differs from event/deadline time; timestamps/backlog insufficient; cursor-only continuation; @due discovery. History query matching, superseded lines and literal/regex live in fields; half-open local dates in ActivityRange schema. |
| list_note_activity | Distinct notes/representative passage; same search discovery rules explicitly referenced; range required in schema; include_history for activity; counts/timestamps/backlog insufficient; scoped search for additional passages; cursor-only. Shared search description supplies unchanged/later-authored-event distinction. |
| read_evidence | Selected evidence/known canonical ID; cursor-only; exact returned references and app-built links; temporal/semantic distinction, uncertainty/not_established/context; actor/date/negation/status; retained-history coverage limits. Provenance off by default and validation/timing always present in field prose. Core keeps exact citations, sufficient context and app-issued handles. |
| get_active_note | Adjacent ID, bounded body, selection/hash. Intentional efficiency clarification: use the existing hint's ID directly for canonical evidence or working-copy reads. The hint remains neither evidence nor full rewrite coverage. |
| read_working_note | Bounded working pages, 1-based lines, unapproved pending content not answer evidence; canonical recall goes through read_evidence. Access enforcement and stable-ID input unchanged. |
| propose_note_edits | Surfaced target, pending combined proposal, Keep before writes, tool submission. Boundary edits, exact nonempty replace text, unique insert anchors and Markdown separators in field prose. Deadline syntax/year limits, exact checkbox, preservation, valid supported consolidation, unavailable time/reminders/slash storage remain. |
| propose_note_rewrite | Whole-note transformation vs local edits, every working page in this run including pending content; Keep; tool submission; complete retained body/no frontmatter in markdown field; same deadline contracts. |
| propose_create_note | Reviewed creation, unique file after Keep. |
| research_notes | Focused gap vs known direct reads, shared model/scope/budgets, allowance, already-read validated returned evidence, only remaining IDs on partial delivery, recovery, sequential different gaps/scopes, no transcript/web/write/delegation. Confirmed scopes in fields; activity range explicit in schema. |
| update_plan | Unchanged. |

Core assistant instructions, specialized evidence-result guidance, date reference, tool implementation and provider adapter are unchanged in this phase. Access, freshness, history, citation, full-read rewrite, proposal review and runtime budgets remain enforced by their existing owners.
