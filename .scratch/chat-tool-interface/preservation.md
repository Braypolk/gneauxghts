# Five-tool interface preservation

| Previous tools | New surface | Preserved internal contract |
| --- | --- | --- |
| search_evidence, list_note_activity | find_notes; optional result=passages/notes | Same search/activity owner, scope/freshness, historical modes, half-open ranges, limits and preview semantics. Notes grouping requires a range. Cursor lookup retains the original presentation; mixed continuation options are rejected. |
| read_evidence, read_working_note | read_notes; required purpose=answer/edit | Original read schemas are tagged without removing constraints. Canonical answer reads retain citations, historical support, provenance, guidance delivery and continuation admission. Edit reads retain pending content, current hash, page limits and full-read coverage. |
| get_active_note | Removed | Adjacent canonical identity/title/validated selection still supplied as the bounded hint. Relevant content comes through ordinary reads. Hint revalidation and no-source/no-full-read meaning unchanged. |
| propose_note_edits, propose_note_rewrite, propose_create_note | propose_note_change; required operation=edit/replace/create | Original operation schemas tagged; same validators and review storage owners. Surfaced/access/current-hash checks, exact edits, pending combined proposals, complete replacement coverage, frontmatter preservation, unique creation and Keep remain. Stored payloads/kinds remain old owner formats, without the interface discriminator. |
| research_notes | Unchanged name | Shared scope/model/budgets, sequential workers, already-read results and recovery remain. Workers advertise only find_notes and answer-purpose read_notes; edit branch absent from schema and rejected by handler. Worker instructions/counters use new names. |
| update_plan | Unchanged | Original tool and plan semantics retained. |

Schemas are composed from existing operation schema owners; each branch denies additional properties. Typed enums reject mixed operation fields. Unified read and proposal handlers recheck capability grants. No operation guesses intent from question wording, and no write occurs outside the existing proposal/Keep path.

Model recovery messages now refer to available tools, read_notes purpose=answer and read_notes purpose=edit. Structured progress supports new names and retains legacy names for older activity. Logical query metadata identifiers remain compatible. The assistant core, specialized result interpretation, persisted conversations/citations/proposals, provider adapter and user-facing note-selection behavior are unchanged.
