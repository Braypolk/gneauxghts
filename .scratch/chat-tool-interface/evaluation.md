# Five-tool chat interface

Implemented October 9, 2026. Model: `gpt-6-luna`, Responses API, provider-default reasoning, Standard processing, web off. Saved app Keychain credential remained in process memory. All notes/proposals were disposable synthetic fixtures.

The model now sees **five tools rather than ten**: find_notes, read_notes, propose_note_change, research_notes, update_plan. The explicit active-note tool is removed. Chat supplies adjacent identity and validated selection as a hint; ordinary reads retrieve relevant content. The backend still owns evidence validation and reviewed writes.

## Preservation

read_notes requires purpose=answer for canonical citable evidence, or purpose=edit for current working content including pending changes. propose_note_change requires operation=edit, replace or create. The existing read/proposal operation schemas are tagged without losing their original constraints, and original handlers keep permissions, exclusions, hashes, full current read coverage before replacements, pending combined proposals and Keep before disk writes. Stored proposal kinds/payloads retain their existing formats.

Research remains separately bounded and uses only find_notes plus the answer branch of read_notes. Its schema omits editing, and handlers reject forged edit/proposal branches. Search continuations retain whether their first page was grouped by note or passage; callers continue with cursor only. Read continuations retain purpose plus cursor. Worker instructions, safe recovery feedback, model history markers, progress summaries and architecture docs reflect the interface.

[Preservation details](preservation.md), [schema comparison](offline-comparison.json), [before tool definitions](tools-before.json), [after tool definitions](tools-after.json).

## Starting context

- Complete assembled input: **14,272 → 12,581 UTF-8 bytes (11.8% smaller)**.
- Tool definitions: **10,091 → 8,400 bytes (16.8% smaller)**.
- Core/system and conversation component sizes are unchanged.
- Provider-reported greeting input: **2,491 → 2,180 tokens (12.5% smaller)**.
- Compared with the earlier 3,027-token baseline before both trimming phases, greeting starting input is now **28.0% lower**.

Bytes are not tokens. Provider measurements include formatting overhead absent from the offline assembly.

## Live outputs and usage

All eight live assertions passed, and manual inspection confirmed intended source/citation selection and exact proposed content. No excluded canary appeared; every canonical fixture stayed unchanged.

Greeting used no tools. Selected text resolved to basil with one answer read. Named-note lookup and follow-up found SABLE-472/Priya while a different note was open; the follow-up now answered ownership directly. Deadline output included only the unchecked task due on the local day. The owner proposal changed only Priya to Anika. Prose preserved Priya's completed substep/date, unknown project completion and unknown passive approver. Whole-note cleanup preserved wording, values and order as three reviewed bullets.

The formatting case used operation=edit, so it **does not establish live execution of the replace branch or large-note paging**. Real offline interface tests do establish pending-content/hash and full-read rejection/admission for replacement.

| Case | First-call input tokens | Aggregate input tokens | Model calls | Tool calls |
| --- | ---: | ---: | ---: | ---: |
| greeting | 2,491 → 2,180 | 2,491 → 2,180 | 1 → 1 | 0 → 0 |
| selection | 2,497 → 2,186 | 5,796 → 5,172 | 2 → 2 | 1 → 1 |
| different_note | 2,493 → 2,183 | 9,357 → 8,179 | 3 → 3 | 2 → 2 |
| followup | 2,501 → 2,194 | 9,143 → 8,230 | 3 → 3 | 2 → 2 |
| deadlines | 2,501 → 2,191 | 9,466 → 8,535 | 3 → 3 | 2 → 2 |
| reviewed_edit | 2,511 → 2,197 | 8,085 → 7,111 | 3 → 3 | 2 → 2 |
| semantic_status | 2,531 → 2,218 | 9,256 → 12,865 | 3 → 4 | 2 → 4 |
| reviewed_rewrite | 2,510 → 2,199 | 8,112 → 7,227 | 3 → 3 | 2 → 2 |

The original six cases used 39,407 aggregate input tokens vs 44,338 before (11.1% less), with the same 15 model calls and nine tool calls. Across all eight, input was 59,499 vs 61,706 (3.6% less), but model calls rose 21 → 22 and tool calls 13 → 15.

The actor/status case searched twice more for a deployment approver after reading the retrospective. Its answer remained correct; this is a concrete remaining retrieval-efficiency issue. A smaller initial interface does not guarantee fewer calls or lower total spend. These are single runs with different responses/cache states, not repeated randomized trials or proof that the consolidation caused the extra searches.

[Raw current live report](live-behavior.json), [previous eight-case report](../chat-context-reduction/live-behavior.json), [previous corrected rubric replay](../chat-context-reduction/offline-regrade.json), [comparison data](live-comparison.json).

## Spending

Current eight cases: **22 provider calls, 15 tool calls**, 59,499 input tokens (47,716 cached subset), 1,302 output tokens including reasoning. Estimated Standard API cost: **$0.00230646**, compared with $0.00217503 for the prior eight-case run. The original-six subset estimates $0.00150629 vs $0.00158838. The extra actor searches and output/caching differences account for the mixed result; no universal cost saving is claimed.

Estimates use the same-day [published model prices](https://developers.openai.com/api/docs/models/gpt-6-luna): $0.10/M uncached input, $0.01/M cached input, $0.50/M output. Cache writes reported zero. This is usage-based estimation, not a billing receipt. No additional API probes or rubric-only reruns were made in this phase.

## Validation

The initial new-name streaming test failed with UnknownToolCall and the five-tool audit failed against the ten-tool registry before implementation. Both passed after registration changed.

- Affected agent tests: 69 passed, three ignored, one socket fixture skipped; the same localhost capacity fixture passed separately with socket permission, covering all 70 nonignored affected tests.
- Focused new interface/tool tests: 14 passed, one paid case ignored by default.
- Chat tests: 57 passed.
- Architecture fitness: 21 passed. The static registration assertion was updated to the combined names, and its history-administration prohibition now also inspects the new interface file.
- Eight capped live cases passed; manual semantic/proposal inspection passed.
- Formatting and whitespace checks passed.
- Independent Standards/Spec reviews found no remaining implementation findings. A stale architecture statement advertising the removed active-note tool was corrected.

Live scope remains narrow: no native UI/durable chat admission, configured research-worker inference, web, retained-history interval task, actual interturn canonical mutation or large paginated replacement. The synthetic matrix demonstrates these cases, not general model reliability or a universal cost improvement.
