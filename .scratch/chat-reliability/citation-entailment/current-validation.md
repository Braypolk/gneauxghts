# Current-model fixed-evidence baseline

2026-10-10 local date. All 13 cases completed through the real streaming
`AgentRuntime` with the saved Gneauxghts configuration: **gpt-6-luna**, medium
reasoning, Flex tier. This phase adds a test-only harness and evaluation records;
it makes no production prompt, retrieval or citation-rendering changes.

## Result

**11 of 13 answers pass this single fixed-evidence pass.** Review found no
unsupported factual assertion, but two answers fail claim-level citation checks:

| Case | Observed failure | Required details |
| --- | --- | --- |
| `deadline_inventory` | The only citation is attached to the final fenced-example bullet. The preceding Parent, Child, Completed and Invalid bullets have no citations or introduction explicitly applying a source to the whole list. | All classifications are correct. Four claims lack usable citation associations. |
| `partial_read_absence` | The quoted passage/no-approver statement uses literal `【Source】`, with no passage link. | Correctly limits absence to the selected passage and leaves the rest unknown. One claim lacks a usable citation. |

The other cases preserve event/edit dates, historical/current state, restoration
and reopening, bounded Editing Window uncertainty, idea/execution distinctions,
explicit supersession, unresolved conflicts and related-note attribution.
The preview-only answer explicitly identifies its quote as non-authoritative and
leaves execution unestablished. This describes an evidence boundary; it is not
graded as an unqualified assertion that the pilot ran.

The [manual review](current-review.json) inventories 34 claims: 30 note-based
claims and four procedural evidence-boundary descriptions. Twenty-five note
claims have supporting, in-set read citations. Five lack usable citations;
their factual details match supplied evidence, but cited support is unassessable.
All 13 answers satisfy their required content/uncertainty/attribution coverage.
The generated [grade](current-grade.json) accounts for these judgments; it does
not infer semantic correctness automatically. Independent review checked all
answers and corrected one restoration rationale without changing its verdict.

## Attempts, usage and latency

The [initial run](current-runtime.json) completed ten answers, then stopped on
`flex_unavailable` for related-note attribution. After the provider's 300-second
retry window, the [resume run](current-runtime-resume.json) completed only the
three unfinished cases using unchanged model, reasoning and pricing settings.
No completed case was regenerated. There were **14 attempts: 13 complete and
one provider availability failure**. The failed attempt has no reported usage;
do not assume its provider cost is zero.

| Reported quantity for the 13 complete answers | Value |
| --- | ---: |
| Input tokens | 13,416 |
| Output tokens | 1,972 |
| Total tokens | 15,388 |
| Reasoning tokens (included in output usage) | 1,192 |
| Cached input tokens | 0 |
| Input tokens per answer | 915–1,301 |
| Runtime latency minimum / median / maximum | 4.1 / 10.7 / 16.1 seconds |

Each complete answer used one runtime model call. Latency measures the whole
streaming runtime request, including provider queue/network/generation; it does
not separate these components. It excludes retrieval, UI polling, compilation,
the failed attempt and the retry wait. This does not diagnose the earlier
five-minute native request or establish production starting-context costs.

## Provenance and verification

- Exact preamble, per-case question/context/evidence/guidance, settings, answers
  and usage are retained in both runtime traces. Controls, requirements and
  rubric are withheld from the model input, although the full corpus is retained
  separately in the trace for reproducibility.
- [Launch input hashes](current-input-provenance.json) bind the original source
  version and corpus. [Resume provenance](current-resume-provenance.json) records
  the test-only case-selection addition. Preamble/input construction are unchanged.
- [current-answers.json](current-answers.json) contains the 13 exact captured
  answers. Each review row binds its prepared answer hash, corpus hash, original
  trace filename and result index. The grade is bound to the complete review hash.
- The offline Python integrity/accounting suite passes all 11 tests. The new Rust
  harness test passes, checking withheld controls, copied evidence text, preview
  references and structural guidance; see [runtime checks](runtime-checks.log).
  All original historical trace checks still pass. No native/UI pass was run.
- The launcher reads the saved Keychain credential into memory; no credential
  value or personal note content is captured in the artifacts or sent as evidence.

## Limits and next experiment

This isolates synthesis from retrieval using normalized synthetic evidence.
Authority, current scope and completeness are supplied fixture facts, not
independently validated app reads. The model receives full synthetic Markdown
passage links; production gives run-issued `[S#]` references and renders them
through the app citation layer. This pass does not validate that conversion,
freshness, native retrieval, navigation or the exact production read envelope.
It is one selected answer per case, not a general model reliability rate.
The historical and current samples differ; their counts are not a paired
before/after improvement measurement.

The next narrow check should repeat the two failing cases using production
reference preparation/rendering. In particular, confirm the malformed-marker
failure on that representation before treating it as a production defect.
Then compare a short per-list-item/per-table-row citation reminder on unchanged
evidence and settings, with repeated baseline/candidate answers and held-out
lists. Preserve factual coverage and uncertainty. There is no evidence here
for a larger starting prompt or an additional verifier-model call per answer.

[Issue 07](../issues/07-citation-entailment.md) and the related
[inline omission issue](../../chat-context-selection/issues/08-inline-citation-omission.md)
remain open. The latency investigation and reviewed chat-to-note flow remain
subsequent work.

The subsequent [production-reference experiment](production-reference-validation.md)
completed the proposed bounded comparison. Rendering preserved references, raw
omissions recurred, and the candidate did not improve reliably. Production
instructions remain unchanged; the next check needs actual native read/tool
context. The original results above remain intact.
