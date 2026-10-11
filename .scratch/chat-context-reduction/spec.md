# Reduce starting chat context

Implemented October 9, 2026. See [evaluation](evaluation.md) for outcomes and limits.

Reduce the complete initial request while preserving useful answers, contextual note selection, source accuracy, privacy and reviewed writes. Follow the prior instruction audit; its current implementation is the baseline, not repository HEAD.

Scope: shorten tool descriptions and schema-field prose. Preserve the assistant core, all ten tools, every structural schema constraint, backend enforcement, evidence supplements and provider behavior. Prefer existing note hints over redundant active-note calls when the hint already identifies the target. No new capability router or lazy tool-loading layer.

Acceptance: compare actual assembled requests before/after; independently verify all schema fields except descriptions are identical. Account for the removed wording's semantic contracts. Run the same six capped synthetic OpenAI cases with the saved credential and model (`gpt-6-luna`), and inspect answers, citations, retrieval calls, proposals and canonical bytes. Add focused prose actor/status and whole-note cleanup cases. Compare actual first-call input tokens and aggregate case usage; distinguish prior-run comparisons from controlled repeated trials. No private notes or credential values in artifacts.

Baseline: ../chat-instruction-audit/live-behavior.json (six successful cases); request-before.json and tools-before.json captured before this phase. The two added cases have no pre-trim live comparison.
