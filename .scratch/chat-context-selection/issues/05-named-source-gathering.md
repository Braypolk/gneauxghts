# Guide relevant gathering and source attribution

Status: wontfix
Type: task
Resolution: implemented

The live selection comparison completed three paired repetitions of four cases. Both variants failed one uncertain-actor case after relevant retrospective evidence had already been delivered: the model searched for an unspecified deployment approver across other notes until the six-call experiment cap stopped the run. In the current variant's third repetition, it also read unrelated launch and logistics notes. Metadata alone did not reliably produce a bounded answer.

Improve model-facing source-scope and sufficiency guidance for questions explicitly asking what a named note records. The agent should obtain adequate canonical coverage of the requested source, distinguish a recorded substep from entire-project completion, and report that a requested fact is unspecified when that source does not record it. Preserve broader research when the user asks for cross-note investigation, comparisons or exhaustive vault coverage. Do not implement a question parser, note-scope lock or fixed successful-tool cutoff.

Start with offline production-boundary checks and a small measured instruction/interface change. Add a bounded named-source versus explicit broader-investigation comparison only after reviewing the concrete change. Retain the existing live matrix and its failures; do not treat the previous 11/12 results as a passing regression gate or attribute them causally to metadata.

Evidence: [report](../live-selection.md), [raw trace](../live-selection-trace.json), [manual review](../live-selection-manual-review.json). Key outcomes: uncertain_actor/signals_removed/repeat1 and uncertain_actor/current/repeat3.

Secondary findings to evaluate separately: one mistyped 64-character evidence ID caused a rejected read; literal search strings included escaped quotation characters; long-link recovery repeated an already-delivered 2,400-byte prefix in both variants. These are recorded observations, not requirements to add more tools or instructions in this task.

## Comments

2026-10-09 — The user clarified the intended behavior for “In [note], who approved deployment?”: “use the related note but let the user know that the answer is from that note.” The original multipart fixture therefore permits relevant cross-note evidence. Its earlier strict in-note scores are retained as historical policy scores, not factual failures.

Acceptance now distinguishes intent:

- A factual question may follow useful related-note evidence; name the supplying note beside the answer and cite its supporting passage.
- A question explicitly asking what a named note records should establish what that record says. Check complete canonical coverage before saying a detail is unrecorded there; a clearly attributed supplementary related-note finding is allowed.
- Gather to resolve concrete remaining gaps, then finish with supported answers and stated unknowns. Preserve cross-note investigation and existing coverage/reuse mechanisms.

The final bounded comparison includes all three intents: explicit source record, the original multipart factual question, and explicit broader investigation. It compares the preserved original core without the new evidence hint against the current shared attribution wording plus once-per-session sufficiency hint. It measures the combined change, not either component alone.

2026-10-09 — Current implementation and evaluation: [report](../named-source.md), [scoped patch](../named-source-phase.patch). The core now requests explicit related-note attribution and the evidence layer supplies a once-per-session sufficiency hint. Offline96 and architecture21 tests pass. The final18-run comparison shows better explicit prose attribution but no reliable overall answer-quality or gathering improvement: strict manual5/9 current versus6/9 baseline, including canonical absence coverage; answer-intent6/9 each. One current runtime failure, one missed related approver, and one absence claim without complete canonical coverage remain visible. **This issue remains open; no implemented resolution is claimed.** Investigate narrowed discovery and invalid evidence-ID recovery before further broad prompt expansion. Existing UI citation labels already identify the supplying note.

2026-10-10 — The user requested a plan for reliable context selection, including possible causes and improvements. See [reliability plan](../reliability-plan.md). Begin with offline reproductions of coverage and reference recovery; evaluate scope wording independently. Preserve related-note answers with attribution, and judge complete answers before token savings. No production changes or paid calls were made for this planning step.


2026-10-10 — Implemented the [reliability plan](../reliability-plan.md); see [report](../reliability.md) and [scoped patch](../reliability-phase.patch). Reads now distinguish whole-note coverage from complete selected delivery and provide safe recovery selectors. Context-local compact evidence selectors preserve canonical IDs, citations, access checks, shared budgets and independent worker authority. The tested source rule treats a named note as a factual starting point while retaining complete canonical checks for named-record omissions.

Offline75 and architecture21 checks pass; independent Standards/Spec reviews found no remaining actionable defects. Thirty bounded synthetic runs retain all failures and smoke/manual discrepancies, with approximately $0.01859235 of reported provider usage. Scope manual results are 6/6 revised versus5/6 original across initial and held-out questions; removing the rule fails canonical absence coverage in1/3. The original absent-actor holdout hits its tool cap; revised returns supported findings with an unresolved approver. Three additional production named-note/selection/long-link checks pass. This resolves the requested implementation and measured comparison, without claiming universal reliability or a general savings rate. Repeated title lookup and long-link prefix recovery remain recorded opportunities; the exact historical narrowed-title/no-related-lead branch remains unproven under controlled discovery.


## Rebuild disposition — 2026-10-16

Superseded as an executable old-runtime ticket by [the Pi rebuild](../../archive/pi-chat-rebuild-scope.md). Retain the original evidence without interpreting its runtime-specific next steps as current work. Current chat behavior and diagnostics are covered by rebuild tickets 02–08/10; intentionally dropped implicit context, exact Retry, formatter/projection or research requirements are not restored.
