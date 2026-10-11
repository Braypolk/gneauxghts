# Starting chat context reduction

Implemented October 9, 2026. Model: `gpt-6-luna`, Responses API, provider-default reasoning, Standard processing, web off. The saved Gneauxghts Keychain credential stayed in process memory. Disposable synthetic vaults only.

The greeting's provider-reported initial input fell **3,027 → 2,491 tokens (17.7%)**. The other five repeated cases started around 2,500 tokens, compared with about 3,030 before. All eight recorded answers/proposals passed manual inspection. The original six passed their live assertions; two new cases required corrections to the evaluation rubric, described below. No additional API calls were used to correct those checks.

## Change and offline evidence

Shortened tool descriptions and field guidance, removing repeated mechanics while retaining the core prompt, all ten tools, schema constraints, specialized evidence guidance and backend enforcement. The adjacent-note description now points directly to the supplied hint's ID when available, with canonical reads for answers and working-copy reads for edits.

- Full assembled input: **17,398 → 14,272 UTF-8 bytes (18.0%)**.
- Tool definitions: **13,217 → 10,091 bytes (23.7%)**.
- System instructions and conversation component sizes stayed unchanged.
- Recursive comparison excluding only `description` fields confirmed every other tool/schema value was identical.

[Offline comparison](offline-comparison.json), [exact description diff](descriptions.patch), [contract preservation](preservation.md), [before schemas](tools-before.json), [after schemas](tools-after.json).

## Live comparison

| Case | First-call input tokens | Aggregate input tokens | Model calls | Tool calls |
| --- | ---: | ---: | ---: | ---: |
| greeting | 3,027 → 2,491 | 3,027 → 2,491 | 1 → 1 | 0 → 0 |
| selection | 3,033 → 2,497 | 10,320 → 5,796 | 3 → 2 | 2 → 1 |
| different_note | 3,030 → 2,493 | 10,786 → 9,357 | 3 → 3 | 2 → 2 |
| followup | 3,041 → 2,501 | 12,099 → 9,143 | 3 → 3 | 3 → 2 |
| deadlines | 3,038 → 2,501 | 11,116 → 9,466 | 3 → 3 | 2 → 2 |
| reviewed_edit | 3,045 → 2,511 | 9,608 → 8,085 | 3 → 3 | 2 → 2 |

Across the original six, aggregate input fell **56,956 → 44,338 tokens (22.2%)**, model calls 16 → 15, and tool calls 11 → 9. Selection used one canonical read instead of an extra active-note fetch. The follow-up used one search and one read instead of two searches and one read. It still volunteered the launch code alongside the requested owner, a minor verbosity issue.

These compare an earlier successful run with the current run, not repeated randomized trials. Provider tokenization, response/tool choices and cache state can vary. The initial-input reduction is measured; universal cost, latency or reliability improvements are not established.

[Raw current run](live-behavior.json), [previous six-case run](../chat-instruction-audit/live-behavior.json), [comparison data](live-comparison.json).

## Output inspection and rubric corrections

The original six retained the intended behavior: ordinary greeting with no retrieval; selected basil with a valid passage citation; SABLE-472 from the named note while another note was open; fresh Priya evidence on follow-up; only the unchecked task due on the local day; exact owner change staged for review. No excluded-note canary leaked. All canonical fixture bytes stayed unchanged.

The prose case correctly attributed checksum verification to Priya on September 18, 2026, kept the entire launch's completion unestablished and left the passive deployment approver unknown. Its live assertion rejected the valid phrase “doesn’t identify.” The smoke grader now normalizes that apostrophe and accepts the phrase; separate claim checks and negative examples prevent the earlier global-keyword false positives. Manual semantic review remains required.

The whole-note cleanup produced exactly three bullets, preserving every word, value and ordering in a pending proposal. The model used individual edits for the three-line note. The original assertion unnecessarily demanded `read_working_note` and `propose_note_rewrite`; that route requirement was removed. This case establishes output preservation and reviewed changes, **not execution of the full rewrite tool or paginated rewrite coverage**.

The raw live report and failing original flags remain unchanged. [Offline regrading](offline-regrade.json) records the corrected checks separately. No production instructions changed after the live run.

## Spending and validation

The eight cases made **21 provider calls / 13 tool calls**, with 61,706 input tokens (50,273 cached subset) and 1,058 output tokens including reasoning. Estimated Standard API cost: **$0.00217503**. This uses the same-day [published model prices](https://developers.openai.com/api/docs/models/gpt-6-luna): $0.10/M uncached input, $0.01/M cached input, $0.50/M output; reported cache writes were zero. It is a usage-based estimate, not a billing receipt. The original-six subset estimates $0.00158838 vs the previous $0.00192808; cache and model choices limit that comparison.

Validation: 11 targeted real tool/streaming/evidence/proposal/rubric tests passed (including replay of all eight recorded cases); 21 backend architecture fitness checks passed; formatting and whitespace checks passed. Independent Standards and Spec reviews found no production contract loss; their grading findings were addressed.

Boundaries: a small smoke matrix, one current run per case, no native UI/durable chat admission, configured research worker, web, retained-history interval evaluation, large paginated rewrite or general reliability claim. Existing specialized guidance and backend protections were preserved, but these live tests do not prove every one of those behaviors.
