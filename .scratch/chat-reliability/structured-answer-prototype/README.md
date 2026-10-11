# Structured answer prototype

Historical experiment. The subsequent [streaming comparison](../structured-answer-streaming/completion/README.md)
is complete, and readable structured streaming is now [integrated on Rig 0.44](../structured-streaming-integration.md).
The measurements and adoption limits below describe the original prototype.

Disposable comparison for [citation issue 07](../issues/07-citation-entailment.md),
2026-10-10. Open [the self-contained demo](demo.html) locally; it makes no requests.
The demo shows actual paired outputs, exact source associations, and authored
walkthroughs for invalid sources, missing references, excerpt scope and incomplete
output. The data format under consideration is:

```json
{"segments":[{"text":"Jordan approved deployment.","sources":["S2"]}]}
```

## Decision

The format is a promising candidate for explicit citation associations, but is
**not ready to promote to chat**. It removed citation-placement ambiguity in this
small pilot, needed no additional model call, and preserved the evaluated facts
and request scope. It also increased reported tokens by 15.3% and the current
formatter emitted no answer-text deltas. Native scope enforcement and actual
claim support remain separate problems.

Keep the app-owned passage registry, canonical validation, permissions and durable
link construction. Do not enlarge the shared core or replace the renderer based
on six samples. Before production adoption, establish a streaming path and reduce
format overhead, then compare through actual tool-driven chat with fresh cases.

## Comparison

| Measurement | Current Markdown | Structured segments |
| --- | ---: | ---: |
| Completed answers | 6 | 6 |
| Model calls | 6 | 6 |
| Manual citation-coverage passes | 5/6 | 6/6 |
| Manual factual/request-scope passes | 6/6 | 6/6 |
| Input tokens | 7,363 | 8,641 |
| Output tokens, including reasoning | 1,447 | 1,519 |
| Total reported tokens | 8,810 | 10,160 |
| Cached input, already included above | 2,303 | 0 |
| Median runtime latency | 4.444 s | 4.044 s |
| Answers with text deltas | 6/6 | 0/6 |

Total reported usage: **18,970 tokens**. No provider failures, formatting retries
or extra verifier calls occurred. Latencies are mixed in both directions; one
sample per arm/case does not establish a speed advantage. Different caching
behavior means total token increase is not a billed-cost percentage. Cached
input and reasoning are subsets of the reported input/output, not extra tokens.

| Case | Finding |
| --- | --- |
| Deadline inventory | Both classify all items correctly. Markdown cites its opening explanation and final fenced-example paragraph but leaves the intervening table without an explicit source association. Structured cites each classified-item segment. |
| Excerpt-only question | Both preserve the selected excerpt's boundary despite a full-body source naming Jordan. Structured explicitly says whole-note presence cannot be determined from the excerpt. Both still link to the broader body, not a precise selected range. |
| Unrestricted question | Both identify Jordan from the full body and attribute the note correctly. |
| Three project bullets | Both associate each project's action, owner and deadline with the correct source. |
| Task table | Both associate the whole table with its source. Markdown uses a qualified “No” for the undated task; its explanation limits the conclusion to inability to identify overdue work. Structured uses “Cannot determine” directly. |
| Superseding hold | Both distinguish the latest hold from an older approval and a planned drill from recorded completion. Structured cites all three sources on one paragraph, which is less granular than individual clause references. |

These are manual answer-level judgments, not automated entailment scores. The
excerpt-only Markdown answer's “No” is interpreted as answering “can you tell,”
not asserting that the whole note has no approver. Its quotation normalizes source
punctuation and is not byte-exact; quotation fidelity was not scored as a pass in
this comparison. The task table's qualified “No” is accepted only with its explicit
uncertainty explanation. These interpretations are retained in [review.json](review.json).

## Method and limits

- Six previously used synthetic cases, frozen before generation; none are held
  out for this experiment, including IDs inherited with a `heldout_` prefix.
- Same exact normalized evidence, metadata, context and issued references in each
  pair. Ground-truth requirements and review observations are not sent to the model.
  Arm order alternates by case. Settings: recorded `gpt-6-luna`, medium, Flex.
- The clarified deadline question comes from the native case, while the fixed
  source retains the earlier synthetic title `tasks`; this is synthesis from
  supplied evidence, not a note-identity or retrieval test.
- Uses actual AgentRuntime and real PassageReferences preparation/rendering over
  synthetic delivered ChatSources. No vault, retrieval, executable tools, canonical
  grants or live citation navigation. It does not reproduce native context assembly.
- Baseline is the existing core plus existing unavailable-tool and citation-format
  guidance from the earlier calibration. Structured replaces only the final
  citation-format sentence and adds a result schema. Preambles are 3,396 versus
  3,729 bytes; schema is 351–361 compact JSON bytes plus the engine's formatter
  definition. Shared production core stays **3,161 bytes**, unchanged.
- Structured uses the existing app-owned `output_schema` and Rig Tool formatter,
  not OpenAI's native strict `response_format`. Shape and issued IDs are explicitly
  validated after generation. Successful samples do not establish constrained
  decoding guarantees, local-model behavior or resilience to malformed output.
- Each segment can contain a paragraph, list item or whole Markdown table. Sources
  associate with the entire segment. Empty source arrays remain allowed for ordinary
  conversation, so the model can still omit citations. A valid ID can still point
  to an irrelevant title, and valid source data can still support an out-of-scope
  answer. Authored demo actions show these limitations without inference.
- The formatter returns final JSON but currently exposes no text deltas. The demo
  conservatively keeps incomplete output inert; it does not implement an incremental
  JSON parser or claim that streaming has been solved.
- Browser preview was blocked because the browser tool disallows local file URLs.
  No alternate browser route was attempted. Source syntax and the portable logic
  were checked offline; visual layout/browser interactions remain unverified.

## Reproduce and inspect

`python3 .scratch/chat-reliability/structured-answer-prototype/analyze.py` verifies
paired inputs, review/output hash bindings, source membership and restored host
bytes, recomputes accounting and regenerates the single-file demo. This makes no
requests and does not judge natural-language support automatically.

`python3 .scratch/chat-reliability/structured-answer-prototype/run.py --build-only`
compiles the disposable runner without credentials or inference. `--run --output
<fresh-path>` explicitly opts into six paired paid answers, using the saved app
Keychain credential in memory. Recorded settings are in [settings.json](settings.json).
No retry of provider failure or service-tier change is performed. There can be up
to two formatter/model attempts per answer; cancellation on a third start is best
effort, with 90-second and observed 8,000-token answer limits and a 40,000-observed-token
pilot allowance. In-flight calls can exceed observed limits before usage arrives.

The launcher temporarily includes [runtime.rs](runtime.rs) in the existing test-only
evaluation module, compiles it, and restores the exact original host bytes **before**
retrieving the credential or starting inference. Production runtime, core, settings
and durable chat models are unchanged. [Run provenance](run-provenance.json) binds
source/settings/fixtures/preamble/executable hashes. [runtime.json](runtime.json)
retains raw output, rendered output, associations, schema, usage and event timings;
no secrets, private vault content or private reasoning are recorded.

The throwaway source and results are captured on local branch
`prototype/structured-answer-2026-10-10`; no production implementation is promoted.

## Next slice

Prototype an adapter that emits answer text progressively while withholding source
links until validation, and compare a shorter formatting instruction/schema. Keep
that experiment bounded and use fresh cases for tables, mixed sourced/ordinary prose,
multiple sources, and excerpt-only scope. If overhead and streaming are acceptable,
run a small native comparison before deciding whether to adopt the format. The
separate [selected-range issue](../../chat-context-selection/issues/09-selection-only-answer-scope.md)
remains open; this fixed-evidence success does not repair native retrieval behavior.
