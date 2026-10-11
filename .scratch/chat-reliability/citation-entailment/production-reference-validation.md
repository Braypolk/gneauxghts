# Production-reference check — 2026-10-10

Reference conversion works on these synthetic sources, but raw model citation
omissions recur. A short coverage/citation reminder did not improve answer-level
results, so it was not promoted. The app's 3,161-byte shared instructions remain
unchanged. This completes a bounded diagnostic experiment; issues 07 and 08
remain open.

## Method and limits

Used the saved OpenAI `gpt-6-luna`, medium reasoning, Flex tier through the real
streaming AgentRuntime. No private notes, retrieval or tools were invoked.
Each complete response used one model call. Controls, requirements and review
rubrics were withheld. The real `PassageReferences.prepare` issued `[S#]`
references for exact synthetic excerpts; `render` converted those references
using the same delivered synthetic ChatSources. Original evidence, metadata,
context and interpretation guidance were preserved. Raw and rendered answers
are retained separately.

Synthetic sources are not canonical grants. This does not exercise native
retrieval, read-envelope serialization, freshness checks or citation navigation.
The harness initially also omitted the read tool's existing instruction:
“Cite exact returned [S#] references; the app builds links.” A final calibration
included that exact sentence in the test preamble, with the production core
unchanged. Its higher-authority placement approximates, rather than reproduces,
the actual tool definition and full production context. These confounds prevent
attributing the earlier native omissions to the core prompt.

Manual reviews inspect exact claim spans, source scope, support and required
coverage. CLI checks bind reviews to answers and corpus hashes; they do not
judge natural-language entailment. No passing current answer contained a
reviewed unsupported factual claim; failures here concern missing citation
scope and, under the original strict rubric, missing content.

## Repeated baseline and candidate

Repeated the two originally failing cases twice each with production references.
The candidate replaced one core sentence with a request to check every requested
item and cite factual list items/table rows before finishing, adding 101 bytes.
The full candidate preamble is test-only. Evidence and model settings stayed
fixed. No candidate held-out calls were made after the repeated failures.

| Variant / case | Repeat 1 | Repeat 2 |
| --- | --- | --- |
| Existing core / deadlines | Parent and child bullets uncited | Completed task omitted under strict rubric; stated claims cited |
| Existing core / partial read | Pass | Bounded excerpt fact uncited |
| Candidate / deadlines | Completed task omitted under strict rubric; stated claims cited | Pass |
| Candidate / partial read | Bounded excerpt fact uncited | Bounded excerpt fact uncited |

Both variants pass **1/4 full answers** and **2/4 citation-only answers**.
The baseline has 8/11 note claims cited, and candidate 9/11; different claim
inventories and four answers per variant do not establish improvement. Neither
variant invented facts or overstated whole-note absence. The original literal
`【Source】` failure did not recur, but missing references did. Rendering faithfully
preserved what the model supplied; it did not delete valid references or add
references to unsupported/uncited text.

The original question asks for “parent, child, and examples”; it does not
unambiguously request the completed task. Preserve the original rubric and
failures, but treat the completed omissions as **strict-rubric coverage failures
subject to request ambiguity**. Citation-only scoring separately exposes the
unambiguous citation defects. This is not a production success-rate estimate.

## Calibration with existing tool guidance and fresh cases

The final run used the existing core plus the existing read-tool reference
sentence in the test preamble. Two fresh cases were frozen before candidate
generation; the table explicitly asks for every task, including completed tasks.
They were first generated in this calibration, not as a candidate comparison.

| Case | Result |
| --- | --- |
| Original deadline inventory | All requested classifications present; four preceding bullets uncited and only final completed bullet cited |
| Original partial read | Pass; bounded excerpt assertion cited, whole-note uncertainty preserved |
| Fresh project bullets | Pass; each planned action, actor and deadline has its own correct source |
| Fresh full task table | Pass; all three rows, including completed and undated tasks, correctly classified; sole source directly after the table scopes that table |

This is **3/4 full and citation-only answers**, with 8/12 note claims cited.
The original target subset passes 1/2 and the held-out subset 2/2. Sample sizes,
different cases and different prompt composition preclude causal comparison
with the repeated candidate/baseline. Existing reference-format guidance does
not ensure per-bullet citation placement.

## Usage and timing

| Run | Input tokens | Output tokens | Total tokens | Cached input | Reasoning tokens | Runtime latency range |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Repeated existing core | 4,458 | 649 | 5,107 | 1,294 | 330 | 2.3–5.8 s |
| Repeated candidate | 4,530 | 615 | 5,145 | 1,312 | 278 | 2.5–4.2 s |
| Existing-guidance calibration | 4,568 | 636 | 5,204 | 0 | 253 | 3.4–7.9 s |
| This phase total, 12 complete calls | 13,556 | 1,900 | **15,456** | 2,606 | 861 | 2.3–7.9 s |

Reasoning tokens are included in output, cached tokens in input; do not add them
again. No provider failures occurred in this phase. These timings measure the
synthesis runtime, not retrieval or UI polling, and do not diagnose issue 06.
The earlier 13-case run is separate and is not included in these totals.

## Retained evidence and verification

- Baseline: [runtime](production-reference-runtime.json), [answers](production-reference-answers.json), [review](production-reference-review.json), [grade](production-reference-grade.json), [provenance](reference-input-provenance.json).
- Candidate: [preamble](citation-preamble-candidate.txt), [runtime](candidate-reference-runtime.json), [answers](candidate-reference-answers.json), [review](candidate-reference-review.json), [grade](candidate-reference-grade.json), [provenance](candidate-input-provenance.json).
- Calibration: [preamble](production-guidance-preamble.txt), [corpus](production-guidance-fixtures.json), [runtime](production-guidance-runtime.json), [answers](production-guidance-answers.json), [review](production-guidance-review.json), [grade](production-guidance-grade.json), [provenance](production-guidance-provenance.json).
- Fresh cases: [frozen corpus](heldout-fixtures.json). Original corpus and prior results were not changed.
- [Reference unit checks](reference-checks.log) cover exact evidence preservation, preview exclusion, valid conversion, omitted/malformed references and unavailable/undelivered sources. Four matching Rust tests pass; two live tests remain ignored by default.
- [Final offline checks](production-reference-checks.log) cover 12 Python integrity tests, historical trace bindings, current review/trace/corpus bindings and raw-reference correspondence. Source snapshots retain their original hashes even where harness support was later extended.

Independent evidence review checked the reference transformation and all three
sets of manual outcomes. No production prompt or renderer behavior changed.

## Next step

Use the actual production read/tool context for a small native reproduction of
the deadline and partial-read cases, retaining raw answers, delivered references
and rendered answers. Match clear question coverage and inspect citation scope
before proposing another prompt change. Preserve a complete failure trace if it
recurs; correct the demonstrated layer. There is no evidence here for a larger
starting prompt, automatic source appending or a verifier-model call per answer.

The subsequent [native reproduction](native-validation.md) completed this
follow-up. It records a malformed native reference, an excerpt-only attribution
failure, a correct unrestricted full-note answer and one Flex failure. It also
repairs a native harness status bug offline; production behavior is unchanged.
