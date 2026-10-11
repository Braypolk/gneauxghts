# Reliable chat context selection plan

Improve chat's ability to gather enough relevant evidence, answer each part of a request, and stop when further retrieval has no useful purpose. The agent should select notes from context without asking the user to choose a note. Relevant answers may come from related notes, with clear attribution. Automatic inclusion of an adjacent note's body stays out of the starting context.

The next work should reduce the coordination required to use the existing tools. The previous instruction experiment improved explicit prose attribution but did not establish better overall answer quality or token savings. More instructions are a candidate only when a focused experiment identifies a missing decision rule.

## Observations and possible causes

The [retained comparison](named-source.md) and [actual tool traces](named-source-trace.json) distinguish three observed failures. Their causes remain hypotheses.

| Observation | Possible cause | Probe and potential improvement |
| --- | --- | --- |
| A factual approval question searched only the retrospective title, read that note completely, and stopped with an unknown approver. The related approval was never discovered. | The agent may interpret the named note as a source restriction. The current source-scope reminder may reinforce that interpretation. A title query also cannot discover facts absent from that title. | Hold search results and question intent constant while changing only the scope reminder. Compare a named factual question with an explicit question about that note's record. Separate resolving the note from searching for the unanswered fact. |
| An answer said the retrospective did not name an approver after receiving only selected passages. | `complete=true` may dominate the more qualified `scope=selected_passages`. The caller must combine several fields and construct its own canonical-read arguments. | Replay selected-passage and whole-note reads. Try explicit per-note whole-content coverage and a compact, app-issued read selector when coverage is incomplete. Derive completeness only from validated canonical content actually delivered. |
| A run submitted `?`, mistyped a long evidence ID, reread the same passage twice, and spent calls recovering. | Copying opaque 64-character IDs creates avoidable model work. Error recovery may not expose a sufficiently direct valid next action. | Reproduce invalid and duplicate selectors offline. Try short references issued for the run, resolved to the existing durable identities behind the tool interface. Provide precise recovery for unknown references without guessing their intended target. |
| Search results included titles and body passages from several related and irrelevant notes. Semantic search was disabled in the synthetic fixture. | Candidate ordering, title/body duplication, or lexical query behavior may influence selection. The fixture does not establish how enabled semantic retrieval behaves. | Compare actual candidate order and query semantics first. Use fixtures with distracting titles, related answers, and no answer. Test ranking or compact grouping only if useful candidates are missing or obscured; preserve explicit access scope. |
| Some extra reads repeated much of an already-delivered body. | A read may be repairing coverage or fetching missing properties, rather than repeating work without purpose. The model may also be overlooking reuse metadata. | Classify each extra read by what it adds: new facts, whole-note coverage, provenance, recovery, or nothing. Optimize only the last category, retaining citation and freshness checks. |

The isolated runtime failure before a tool call remains a separate unknown. It should count in reliability results, but it is not evidence of a context-selection cause.

## Work sequence

1. **Establish focused reproductions and stable grading.** Reuse the existing failing traces and synthetic vault. Add variants for an answer in the named note, an answer only in a related note, a detail genuinely absent from a complete note, a detail outside the first page, and a relevant-looking distractor. Include explicit linked and selected context so shortcuts cannot bypass coverage. Record what was discoverable, what was delivered, what remained incomplete, and which requested facts the final answer addressed. Keep valid title-bearing citation attribution separate from explicit prose names. Scripted replays verify the application contract; live runs are needed to verify model decisions.

2. **Make read coverage actionable through the existing interface.** Prototype a compact per-note distinction between delivered selected passages and verified complete current content. When a whole-note check is needed, return an exact safe selector for `read_notes`, similar to the existing recovery selector for clipped linked context. Keep continuations and prior failures truthful. A selected passage cannot become whole-note coverage merely because its delivery is complete. If cumulative delivered content can prove complete canonical coverage, calculate that inside the evidence owner; otherwise report it as incomplete. Measure envelope size before choosing the representation.

3. **Reduce reference-copying and recovery work.** Prototype short references for discovered evidence, retaining stable canonical IDs internally for citations and validation. Prefer the existing reference machinery where it fits. Test exact resolution, duplicate arguments, unknown references, stale content, changed access, independent research workers, and use in a later run. Never resolve a mistyped ID by similarity or note title. Compare the reference change independently from coverage and prompt changes.

4. **Correct premature narrowing with a focused experiment.** Compare the current source-scope reminder against a version that clearly treats a named note as the starting point for factual questions, and against removing that reminder. Keep the shared core, tools, search corpus and grading unchanged for this comparison. Test the distinction between “who approved?” and “what does this note record?” across several phrasings. A remaining factual gap can justify discovery beyond the named note even when no related candidate has yet been returned. Prefer one concise rule if needed; the agent still decides intent and retrieval. Do not add a backend question classifier or a forced search after every read.

5. **Verify quality before optimizing cost.** Run affected offline regressions and required architecture checks after each concrete change. Start each live candidate with one paired repetition of the three intent cases under the existing bounded synthetic harness. Repeat promising candidates and add held-out phrasings after reviewing the first screen; stop revising candidates that expose no new signal. Compare one variable at a time. Retain failures, invalid calls, missing usage and raw scores. Review every answer and its supporting passages before interpreting token or cost differences.

## Architecture and scope

Use the existing `find_notes` and `read_notes` surface. The evidence service owns canonical coverage, delivery accounting, continuations and validation. The app-owned tool boundary owns any translation of compact model references to canonical selectors. Research workers retain their own delivered-context state and inherited access restrictions. New representations must preserve exclusions, content-hash validation, exact citations and existing read/run budgets.

The initial implementation should remain localized to evidence presentation, reference handling and focused tests. Revisit a wider interface change only if these probes demonstrate a caller burden that cannot be resolved there. No new user-facing note picker, automatic adjacent-note body injection, successful-call cutoff, or forced note scope is part of this plan.

Relevant ownership and contracts: [architecture](../../ARCHITECTURE.md#agent-runtime), [behavior invariants](../../docs/architecture/behavior-invariants.md#chat-activity-and-citations-preserve-explicit-evidence-boundaries), [runtime ADR](../../docs/adr/0001-keep-agent-runtime-app-owned.md), [read presentation](../../src-tauri/src/services/evidence/reads.rs), [tool interface](../../src-tauri/src/agent_tools/interface.rs), and [coverage regressions](../../src-tauri/src/agent_tools/tests/coverage_regressions.rs).

## Success criteria

- A factual question can reach a useful answer in a related note and identify that source beside the supported claim.
- A question about a named note's record distinguishes that record's omissions from supplementary related findings. Absence claims have complete relevant canonical coverage; clipped or unavailable content stays explicitly uncertain.
- Whole-note reads, selected passages, editor selections and linked context preserve the same evidence boundaries, without implying complete retained history or a complete real-world record.
- Reference handling does not introduce cross-run authority, weaken access checks, or create incorrect citations. Recovery does not require repeatedly copying long identifiers.
- Reduced calls or tokens accompany comparable or better complete answers. Early failure, premature stopping and skipped evidence never count as savings.
- Results hold beyond the original wording. Small synthetic comparisons remain directional evidence rather than a general reliability guarantee.

Begin with the offline coverage and recovery reproductions. They can establish exactly what the application presents before another paid model experiment. This planning step changes no production behavior and makes no provider calls.


## Execution outcome — 2026-10-10

Implemented and evaluated; see [results and limitations](reliability.md). Coverage and compact reference changes were tested independently before the three-arm scope screen. A promising revised scope rule received three additional paired held-out phrasings, including a genuinely absent approver; it is now adopted. Three final production checks cover named notes, selected text and long-link recovery. Offline75 and architecture21 checks pass. Thirty bounded runs cost an estimated $0.01859235 of reported usage, retaining failures and manual/smoke discrepancies.

The implementation and bounded evaluation are complete. Broader reliability, enabled semantic ranking, and the exact historical no-related-lead narrowing branch remain unproven. The screen did not justify ranking/grouping changes or a wider retrieval redesign. Extra title lookup and repeated clipped prefixes remain recorded opportunities rather than assumed savings.
