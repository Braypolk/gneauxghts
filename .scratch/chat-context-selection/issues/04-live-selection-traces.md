# Capture synthetic evaluation context choices

Status: wontfix
Type: task
Resolution: implemented

The existing paid synthetic evaluation saves query titles and tool summaries but not full tool arguments or model-visible result envelopes. Consequently a later audit cannot establish which mode/scope was used or whether the model read evidence IDs versus a whole note. The offline scripted trace must explicitly assume those inputs.

Extend only the opt-in synthetic evaluation to retain exact tool choices, relevant result scope/coverage/delivery, and per-call request component sizes. Reuse the actual streaming/provider boundary and enforce existing caps. Keep credentials and private reasoning out of artifacts. Do not enable raw prompt/result logging for the user's real vault.

After issues 01 and 02, use bounded repeated cases for named-note lookup, actor uncertainty, selected text and long linked context. Compare answer/citation correctness, tool calls, provider input/cached/output tokens and estimated cost. Report variation; a single lower-byte request does not establish lower total cost or causality.

Evidence: [audit](../audit.md), prior [live report](../../chat-tool-interface/live-behavior.json).

## Implementation plan (2026-10-09)

Use the existing opt-in macOS synthetic harness and its real AgentRuntime/provider adapter. Add bounded model-boundary tool-exchange capture and reuse the existing size-only request measurement. Never serialize reasoning blocks or credential/provider error text. The old synthetic smoke report gains the same request trace.

Run three paired repetitions of named-note, selected-text, long-link and uncertain-actor cases with `gpt-6-luna`. Compare current signals with test-only ablation of coverage scope/completeness, overlap reuse and their description additions. This is a signal-ablation experiment on current retrieval/validation, not a full historical implementation comparison. Alternate variant order and reuse canonical identities within each pair, with fresh evidence contexts.

Retain six provider calls, 1,024 output tokens per call, 64,000 serialized bytes per call, eight tool calls, 40,000 aggregate tokens and 60 seconds per run. Collect per-call provider usage, exact model-visible exchanges and manually inspect answer entailment as well as automatic citation/fixture checks. Price against verified Standard short-context rates; report variation and unknown usage rather than equating bytes with billed tokens.

## Result (2026-10-09)

Implemented synthetic-only exact request/lifecycle traces, actual per-call usage and bounded paired ablation. Completed 24 runs with `gpt-6-luna`, three repetitions per case/variant, approximately $0.01089 reported-token cost. Manual review accepted 11/12 per variant; each hit one actor-case call cap. Metadata did not establish reliable cost or exploration savings. Original failures and the automated rubric false negative remain recorded.

74 affected tests and 21 architecture checks passed. Standards/Spec follow-up reviews found no remaining implementation issues. See [completed report](../live-selection.md), [summary](../live-selection-summary.json) and [next gathering issue](05-named-source-gathering.md).


## Rebuild disposition — 2026-10-16

Superseded as an executable old-runtime ticket by [the Pi rebuild](../../archive/pi-chat-rebuild-scope.md). Retain the original evidence without interpreting its runtime-specific next steps as current work. Current chat behavior and diagnostics are covered by rebuild tickets 02–08/10; intentionally dropped implicit context, exact Retry, formatter/projection or research requirements are not restored.
