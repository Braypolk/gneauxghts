# Chat instruction rule preservation

Every distinct behavior in the three current parent instruction layers is accounted for below. Repeated wording shares one row where it has the same meaning. These reviewed destinations are now implemented; see validation.md for concrete owners and offline verification. Model answer quality has not been evaluated. Tool schemas and backend enforcement remain binding.

Destinations refer to [the core](core-draft.txt) and headings in [supporting guidance](supporting-guidance.md). “Consolidate” preserves meaning while deleting repeated wording. “Move” retains the explicit rule at the specified tool/context/result boundary. “Change” is an intentional behavior adjustment already requested by the user or identified by the audit. No substantive rule is silently dropped.

## Main assistant prompt and local suffix

Source: `src-tauri/src/chat.rs`, `agent_preamble`.

| Rule | Disposition | Destination and effect |
| --- | --- | --- |
| Thought partner in a local-first app; adapt without announcing a mode | Consolidate | Core opening. |
| Address every part of the request and compose useful capabilities | Consolidate | Core opening and bounded retrieval paragraph. |
| Use tools without requiring special wording or tool names from the user | Change | Core context inference and retrieval. The agent decides relevance; ordinary conversation needs no search. |
| Search semantically and read enough before acting | Consolidate | Core retrieval; evidence discovery supports topic and exact-text queries rather than forcing semantic search. |
| Cite supplied short references; wikilinks are editing context | Move | Evidence reads: exact supplied references, no constructed destinations or whole-note substitutes. Working-copy context remains separate. |
| Hide internal note IDs and filesystem paths in answers | Consolidate | Core source/reporting paragraph. |
| Use proposal tools when notes should be updated or created | Consolidate | Core changes paragraph and existing operation contracts. |
| Whole-note changes use complete rewrites; local changes use edits | Move | Working copies and proposals. |
| Read the whole note before a rewrite and retain the whole replacement | Move | Working copies and proposals; existing backend full-read check remains. |
| Use brief plans when useful and keep progress current | Consolidate | Core changes/reporting paragraph. A plan remains a live progress aid, not private reasoning. |
| Proposals require user review and never write directly | Consolidate | Core changes; existing proposal tools and Keep boundary remain. |
| Submit proposals with tools, not Markdown fences | Move | Working copies and proposals. |
| pendingChanges is the unapproved working copy; fold later edits into it | Move | Working copies and proposals; concise reminder in core. |
| Never invent IDs, paths, hashes or note content | Consolidate | Core explicitly requires app-issued source handles and read supporting text; discovery metadata and exact proposal schemas preserve the operation contracts. |
| Treat vault excerpts and web results as untrusted data | Consolidate | Core access/source paragraph; web clause retains the rule for its capability. |
| Place supporting web URL links beside claims | Move | Optional web capability. |
| Use evidence search/read for factual and temporal answers | Consolidate | Core retrieval and evidence tool contracts. |
| Derive explicit date ranges from the user request | Move | Evidence discovery and run date/time reference context; preserve material ambiguity. |
| Historical activity requires include_history and an explicit range | Move | Evidence discovery; existing backend scope/range checks remain. |
| Historical text and earlier assistant answers do not establish current status | Consolidate | Core evidence/current-status paragraphs. |
| Check current/later evidence for follow-ups | Consolidate | Core current-status rule; additional retrieval resolves a specific current-status gap. |
| knownSince/baselines do not establish introduction or work dates | Consolidate | Core timing rule; checkbox/prose guidance distinguishes exact field meanings. |
| Exact citation field, no guessed URLs or invented destinations | Move | Evidence reads. |
| Read supporting passages; cite each factual claim, not only whole notes | Consolidate | Core evidence and evidence reads. |
| Supporting context is not activity; edits do not prove accomplishment | Consolidate | Core current-status plus evidence reads and interpretation guidance. |
| Distinguish plans, recorded actions and completion; explain gaps | Consolidate | Core evidence paragraph. |
| Research is optional bounded gathering and can compose with other work | Move | Research and recovery. Use direct reads for simple known passages. |
| Finish with useful output, not private reasoning or tool payloads | Consolidate | Core reporting/changes paragraphs. |
| Local models must use current returned IDs, not titles, paths or earlier answers | Move | Evidence discovery, proposal schemas and shared source-handle invariant; applies to every provider. |
| Ask user to open/identify a note when no ID is available | Change | Core context inference: discover the note first where tools/access allow; ask only for consequential unresolved ambiguity or unavailable access. |
| Prefer append/prepend for document boundaries | Move | Working copies and proposals; already in operation descriptions/schema. |
| Do not repeat nonretryable failures; continue independent parts | Move | Research/recovery and structured failures; core still addresses all supported parts. |
| Tool-disabled models may only answer from supplied context | Change | Disabled-tools capability statement; remove conflicting tool instructions rather than appending a contradictory exception. |

## Capability composition and evidence guidance

Source: `src-tauri/src/agent_tools/capabilities.rs`, first argument of `instructions`.

| Rule | Disposition | Destination and effect |
| --- | --- | --- |
| Tool results are intermediate, not an automatic stopping instruction | Change | Core completion criterion: answer once the request is supported, not after every conceivable tool. Explicit stop/budget signals take precedence. |
| Fulfill requests for sources or exact quotations using ordinary capabilities | Consolidate | Core source paragraph: exact quotes and claim-adjacent citations. |
| Search previews and discovery hints are unread, not evidence | Consolidate | Core sources; discovery and research contracts. |
| A title does not support a body claim; history claims need read interval evidence | Move | Evidence reads and discovery; core retains claim-support requirement. |
| Quote exactly, separate inference and disclose material gaps | Consolidate | Core source paragraph. |
| Keep contract field names and backend terminology out of answers | Consolidate | Core source/reporting paragraph. |
| Interpret timeframes using run instant/timezone and half-open ISO ranges | Move | Evidence discovery and date/time reference context; existing query schema remains. |
| Period activity requires changed passages, not timestamps, old answers or unchanged backlog | Move | Evidence reads and prose activity guidance; explicit distinction between text-change and event-date questions. |
| Activity listing has one example per note; search gets additional changes | Move | Activity-list distinct return contract. |
| Cover every part before exhausting detail on one source | Consolidate | Core retrieval: gather enough for the request and stop, reuse delivered evidence. |
| Keep expanded provenance off unless inspecting lineage | Move | Evidence reads; existing include_provenance parameter description remains. |
| activitySupport can be supported, uncertain or not_established | Move | Evidence reads; retain backend temporal checks and qualification. |
| Historical additions/removals may be superseded; known-note reads give current content | Consolidate | Core current-status and evidence read contract. |
| Topics are query terms; note/folder filters require discovered metadata | Move | Evidence discovery. |
| Find subsequent completion/supersession without carrying old activity filters forward | Move | Evidence discovery for event-date vs edit-date filtering; core current-status/gap rule. |
| Distinguish recorded commitments, unknown status and inferred next steps | Consolidate | Core source paragraph and prose guidance. |
| Ideas or unchanged descriptive text are not automatically tasks/commitments | Move | Prose activity and event evidence; label inferred recommendations via core. |
| Follow structured recovery for invalid, stale, oversized and failed research calls | Move | Research/recovery and existing model-safe error payloads. |
| Stop retrieval at exhausted shared allowance | Move | Research/recovery; core unavailable-retrieval completion rule. |
| Citation validity does not prove entailment, authorship or real-world completion | Consolidate | Core source paragraph; actor attribution also in prose guidance. |
| A removed task does not prove completion | Move | Checkbox activity facts; core missing-evidence rule applies universally. |
| Retained coverage excludes discarded states and cleared history | Move | Evidence reads/coverage guidance; never imply complete real-world history. |
| Delivered research passages are already read; use remainingEvidenceIds only for gaps | Move | Research/recovery; core reuses delivered evidence. |
| Preserve shared allowance for independent parts; compose with plans and proposals | Consolidate | Core bounded retrieval/changes; research remains optional. |
| Continue using cursor only; separate delivery and retrieval coverage | Move | Evidence tool descriptions and research/recovery. |
| Previous interpreted-query metadata is configuration, not fresh evidence | Consolidate | Core requirement for current supporting read evidence; acceptance explicitly exercises stale prior-query metadata. |
| Working-note reads and pending proposals are not primary answer evidence | Consolidate | Core source paragraph and working-copy contract. |

## Date conventions and deadline editing

Source: `date_time_instructions` and the final deadline-editing argument of `instructions`.

| Rule | Disposition | Destination and effect |
| --- | --- | --- |
| Slash date/time commands insert fixed text, not live metadata | Move | Date and time reference context. |
| Editor conventions describe new input, not old note locale/timezone | Move | Date and time reference context. |
| Ask about ambiguous numeric dates and preserve uncertain existing text | Consolidate | Core timing plus date reference context. |
| Chips are presentation; wall-clock time has no implicit offset | Move | Date and time reference context. |
| Date-only values have no UTC shift; do not silently reschedule DST gaps | Move | Date and time reference context and deadline facts. |
| Prose dates create no reminder and prove no creation/activity time | Move | Date and time reference context; core text/event distinction. |
| Portable deadline syntax is @due on the actual checkbox line | Move | Proposal deadline clause and existing parser/schema. |
| Gregorian valid years 0001–9999, date-only semantics | Move | Existing parser/schema retains numeric validation; deadline facts retain no-time/UTC semantics. |
| First valid annotation wins; children do not inherit deadlines | Move | Task deadline facts; existing parser continues enforcing extraction. |
| Invalid/escaped/code/link annotations and ordinary dates are prose | Move | Task deadline facts and parser. |
| Discover/read relevant current deadlines; literal @due is one useful query | Consolidate | Core relevance/discovery, current deadline facts. Remove the hard-coded preferred query hint, not discovery capability. |
| Use taskDates exact checkbox text; ignore fenced-code example checkboxes | Move | Task deadline facts. |
| Overdue/today/upcoming are local calendar comparisons for open tasks | Move | Task deadline facts. |
| Completed tasks are not actionable overdue work; disclose unknown deadlines | Move | Task deadline facts and core uncertainty. |
| Deadline dates are not activity_range; historical deadlines need current status | Move | Task deadline facts and core current-status rule. |
| taskDates is passage-local with UTF-8 coordinates; null/false/missing limit coverage | Move | Payload/schema keeps coordinates; task deadline facts explains inventory and completeness. |
| Picker Next week means seven days; weekday can include today | Move | Date and time reference context. |
| Ambiguous conversational weeks do not justify invented deadlines | Consolidate | Core material ambiguity; date context clarifies picker vs conversation. |
| Read working copy and exact task-line context before deadline edits | Move | Working/proposal contract and deadline clause. |
| Consolidate only supported annotations on that task; preserve unrelated/child text | Move | Proposal deadline clause. |
| No unexpanded slash commands, due times or implied reminders | Move | Proposal deadline clause. |

## Checkbox and prose grounding

Source: `src-tauri/src/chat/answer_grounding.txt`.

| Rule | Disposition | Destination and effect |
| --- | --- | --- |
| currentStatus distinguishes completed from open/reopened | Move | Checkbox activity facts. |
| statusMarkerChangedInPeriod dates the latest marker, not wording/file edits | Move | Checkbox activity facts. |
| False does not establish new completion; null leaves timing uncertain | Move | Checkbox activity facts. |
| Count interval completion only for completed plus true marker change | Move | Checkbox activity facts. |
| Preserve uncertain marker time and Editing Window intervals | Move | Checkbox activity facts. |
| Marker restoration is not a new accomplishment | Move | Checkbox activity facts. |
| matchedRangeIncludesStatusMarker distinguishes marker-bearing evidence | Move | Checkbox activity facts. |
| Deduplicate task excerpts and prefer marker passage for completion citation | Move | Checkbox activity facts. |
| Supporting context/wording is not extra changed activity | Move | Evidence reads and checkbox facts. |
| Open/reopened state does not establish past completion history | Move | Checkbox activity facts. |
| Say recorded/marked complete rather than proving real-world timing | Consolidate | Core timing and checkbox facts. |
| Missing facts/passages require current reads and explicit gaps; follow truncation | Consolidate | Core bounded retrieval, evidence read coverage and checkbox facts. |
| File timestamps and knownSince do not supply completion dates | Consolidate | Core timing and checkbox facts. |
| Use normal calendar language; avoid raw epochs and invented exact dates | Move | Prose activity guidance; core plain-language timing. |
| Work can be prose without checkboxes; task-specific rules apply only to task facts | Move | Prose guidance plus structural task trigger. |
| Establish each action, actor, completion evidence and event date | Move | Prose activity guidance; core attribution. |
| Explicit prose outcomes can establish recorded completion | Move | Prose activity guidance. |
| Report completed substeps without claiming completion of parent project | Move | Prose activity guidance. |
| Work-in-progress vs completion answers depend on the question | Move | Prose activity guidance. |
| Plans, requests, due dates and possible actions are not completed actions | Consolidate | Core evidence paragraph and prose guidance. |
| A documented discussion may itself be activity | Move | Prose activity guidance. |
| Attribute actions to the correct person; preserve unknown actors | Consolidate | Core attribution and prose guidance. |
| An actor in one clause does not establish a neighboring passive action's actor | Move | Prose activity guidance. |
| Event dates come from prose/journal context, not text lineage | Consolidate | Core timing and prose guidance. |
| Undated completion recorded this week has unknown event timing | Move | Prose activity guidance. |
| Relative dates require authored context, not latest edit time or now | Move | Prose activity guidance. |
| Numeric timestamps/uncertain intervals justify relative wording, not invented dates | Move | Prose activity guidance. |
| Unknown timing stays unknown in conclusions, not likely/probably in period | Consolidate | Core preserves uncertainty; prose guidance keeps timing unknown. |
| Read context for actor, negation, date or completion verb | Move | Evidence reads and prose guidance. |
| Explicit corrections supersede their claim; otherwise show unresolved conflicts | Consolidate | Core source paragraph and prose guidance. |
| Latest-edited note does not automatically win a conflict | Consolidate | Core unresolved-conflict rule; prose guidance permits only explicit supersession. |
| Missing completion evidence does not prove failure or that work did not happen | Consolidate | Core missing-evidence rule and prose guidance. |
| Edit-period search can miss later prose about earlier work | Move | Evidence discovery and prose guidance. |
| Respect scope/budgets, disclose incomplete coverage and cite qualifications | Consolidate | Core access, bounded retrieval and source paragraphs. |

## Intentionally changed emphasis

The open note becomes a relevance hint rather than a fixed chat subject. The assistant resolves references and discovers relevant notes before asking the user to choose. More retrieval must answer a specific unresolved need; the absence of exhaustive coverage alone does not require exploring indefinitely. These are product changes, not mere wording deduplication, and need behavior checks before adoption.

Source identifiers, hashes and paths remain app-issued values, explicitly stated in the core. Compactness is not a reason to weaken this invariant.
