# Live context selection evaluation

## Results

The new metadata did **not** establish a cost or reliability improvement in this small experiment. Both variants produced 11 correct, supported final answers out of 12 after manual review. Each failed one uncertain-actor run at the six-provider-call cap, after relevant evidence had already been read. None of the completed answers misattributed the actor, date, project completion or unspecified approver.

| Metric, 12 runs per variant | Signals removed | Current |
| --- | ---: | ---: |
| Manually accepted final answers | 11/12 | 11/12 |
| Automated smoke passes | 10/12 | 11/12 |
| Admitted provider dispatches | 39 | 37 |
| Tool calls | 28 | 27 |
| Provider input tokens | 140,964 | 137,603 |
| Cached input tokens, included above | 106,911 | 102,253 |
| Output tokens, including reasoning | 1,872 | 1,842 |
| Estimated reported-token cost | $0.00541041 | $0.00547853 |

All 24 runs together cost approximately **$0.01089** at the documented reported-token rates, excluding any unexposed cache-write charges. Current input decreased 2.4%, but estimated cost increased 1.3% because cache reuse differed. Neither small difference supports a reliable savings claim.

Named lookup, selected text and long-link answers passed 3/3 per variant. Named lookup used two or three tools; selected text always used one canonical read; long-link recovery always used two canonical read pages. Actor cases used 2–7 tools with current signals versus 3–6 with signals removed. Per-run reported-token cost ranged from $0.00018239 to $0.00101713 for current and $0.00017550 to $0.00091045 for signals removed. Three repetitions per case are too few for statistical or causal claims, and provider caching/order effects remain.

The automated actor rubric rejected one correct baseline answer solely because “doesn’t say who approved it” was absent from its keyword list. The original checks remain in the trace; [manual review](live-selection-manual-review.json) records the correction and is bound to the exact trace hash. Manual review was performed by the coding agent, not an independent human evaluator. Every successful cited fact was also checked against its delivered exact excerpt.

The traces identify concrete remaining waste:

- Both capped actor runs kept looking for an unspecified approver after receiving the relevant retrospective body. The current capped run additionally read other launch and logistics notes. The requested source's missing fact did not reliably end gathering.
- One baseline read mistyped the last character of a 64-character passage ID; the evidence owner correctly rejected it. Recovery and further searches consumed the remaining calls.
- Two named-lookup runs, one per variant, tried a literal query containing escaped quote characters, then needed another search.
- No identical tool call was repeated. However, long-link recovery reread the entire already-delivered 2,400-byte body prefix in each of the six runs before continuing to the tail. `alreadyRead=full` disclosed that overlap without suppressing it. This does not establish a general test of reuse savings.

Recommendation: address [named-source gathering](issues/05-named-source-gathering.md) next, then separately assess compact passage selectors and clipped-link recovery. Keep the truthful coverage/reuse metadata, but do not add more instructions or call the token work finished on this evidence.

## Method

The opt-in synthetic harness uses the real AgentRuntime streaming runner, registered vault tools, source admission/revalidation and OpenAI Responses adapter. Every note is disposable synthetic content; the application vault is never loaded. The saved macOS Keychain credential stays in memory. Reports exclude credentials, provider error text and reasoning blocks. The exact tool arguments/results are retained, including terminal guard paths, with per-record and per-run bounds.

Three paired repetitions cover named-note lookup, validated editor selected text, a linked note whose body exceeds the automatic prefix, and actor/date/project/approver uncertainty. Each pair shares canonical identities and corpus but uses independent run/evidence state. Variant order alternates. `current` exposes coverage/reuse metadata; `signals_removed` strips the new metadata and its description additions at the model boundary. Retrieval, evidence budgets, validation, citations and interpretation guidance remain current in both variants. This is a controlled signal-ablation comparison, not a full historical implementation comparison.

`promptComponentBytes` describes helper-assembled question/hint/link components before ablation; actual outgoing component totals come from `requests`. `requests` records size-only measurement plus model-visible tool exchanges after ablation. `toolLifecycle` records original executed presentations before ablation, including exchanges followed by a cap/failure rather than another provider request. Lifecycle retention is bounded to 32 records and 64,000 bytes per record; oversized records are explicitly marked. `perCallUsage` comes from completed StepUpdated usage, while UsageUpdated events retain cumulative usage separately. Reports do not capture raw assistant reasoning or full request histories.

Model: `gpt-6-luna`, provider-default reasoning. Each run allows at most six provider calls, 1,024 output tokens per call, 64,000 serialized bytes per call, eight tool calls, 40,000 aggregate tokens and 60 seconds. No web or configured research worker. The harness does not exercise native UI or terminal durable chat completion. Ordinary admission/permission and source checks still run.

Estimated cost uses verified [OpenAI Standard short-context pricing](https://developers.openai.com/api/docs/pricing) on 2026-10-09: $0.10 per million input tokens, $0.01 cached input, $0.125 cache write and $0.50 output. Cached input is subtracted from ordinary input; reasoning is already included in output. Rig exposes OpenAI cache-write usage as zero, so any unexposed write charges are excluded; these estimates are not invoices. All-zero/unreported usage is unknown. UTF-8 size measurements describe assembled requests before provider formatting and are not billed tokens.

## Artifacts

- [Raw synthetic trace](live-selection-trace.json)
- [Summary and per-call costs](live-selection-summary.json)
- [Manual answer review](live-selection-manual-review.json)
- [First repetition raw trace](live-selection-trace-part1.json) and [remaining repetitions raw trace](live-selection-trace-part2.json)
- [Offline summary script](summarize-live.py)
- [Isolated implementation patch](live-phase.patch), relative to [pre-phase copies](live-baseline/)

## Validation

- 24 paid synthetic runs completed. The live test assertions correctly remained red for the two capped outcomes and one smoke false negative; manual assessment is 22/24 successful final answers. The first process stopped after the full first repetition on its capped case. A test-only start-repeat selector ran repetitions two and three once; no completed case was rerun. The harness now continues bounded failures as measured outcomes, while unexpected runtime/provider failures still stop the matrix. Both immutable part traces are retained.
- 21 architecture-fitness checks passed. Rust formatting, diff, local report-link, privacy-canary and trace-cap checks passed; the 24 unique runs produced 76 admitted provider dispatches.

- 74 affected agent-tool/runtime tests passed, with five opt-in tests ignored. The first sandboxed run had 72 passes and one localhost socket permission failure; the same suite passed with the required network permission.
- Independent Standards and Spec reviews caught terminal-exchange retention and cumulative-usage labeling issues; both were corrected and reviewed again with no remaining findings.
- Regression checks retain exact tool arguments/results, preserve canonical excerpts/citations under ablation, exclude reasoning, distinguish 100/200-token individual calls from cumulative usage, classify all seven existing bounded guard categories without retaining error text, and retain the terminal tool result when a seventh provider dispatch is rejected.

## Reproduction

```sh
GNEAUX_OPENAI_SELECTION_EVAL=1 \
GNEAUX_OPENAI_SELECTION_REPEATS=3 \
GNEAUX_OPENAI_SELECTION_OUTPUT="$PWD/.scratch/chat-context-selection/live-selection-trace.json" \
cargo test --manifest-path src-tauri/Cargo.toml --lib openai_context_selection_comparison -- --ignored --nocapture

python3 .scratch/chat-context-selection/summarize-live.py \
  .scratch/chat-context-selection/live-selection-trace.json \
  .scratch/chat-context-selection/live-selection-summary.json \
  .scratch/chat-context-selection/live-selection-manual-review.json
```

The optional summary-script manual-review argument requires a matching trace hash; a fresh paid run needs a fresh semantic review. To run only a remaining whole repetition, set `GNEAUX_OPENAI_SELECTION_START_REPEAT` (1–3, no larger than the total repetitions) and use a separate output path.

This command is paid and explicitly opted in. Local test commands without `--ignored` do not run it. The older `openai_synthetic_chat_behavior` opt-in report now includes the same request and terminal lifecycle traces, without additional default paid cases.
