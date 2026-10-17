# Verify that cited passages support the associated claim

Status: wontfix
Type: task
Resolution: superseded old-runtime investigation; semantic entailment deferred

## Evidence

`../artifacts/native-citation-mismatch.json` contains a complete temporal answer that cites a
canonical note title for the claim that “Experimental pilot idea.” was inserted
within the requested interval. The cited title is valid and resolvable, but its
text does not establish that claim. The other body sources support current
completion, supersession and cancellation status. Citation validity alone is
not a semantic quality gate.

## Next step

The [offline evaluation](../citation-entailment/README.md) now supplies fixed
claim-to-passage cases, a review rubric and trace-bound historical baseline.
The [current-model pass](../citation-entailment/current-validation.md) completed
all 13 cases with two citation failures. The subsequent
[reference experiment](../citation-entailment/production-reference-validation.md)
confirmed raw omissions with faithful rendering; a short reminder did not improve
reliably and was not promoted. The subsequent
[native reproduction](../citation-entailment/native-validation.md) captures a
malformed marker and an excerpt-only scope failure with valid full-body citation.
Use the [corrected selected-range reads](../../archive/excerpt-only-answer-scope.md)
for excerpt-scope cases; general claim support still needs evaluation. Retain
raw/reference/rendered output; avoid hard-coded workflow responses. The subsequent
[structured-answer prototype](../structured-answer-prototype/README.md) established
explicit citation associations. The [completed streaming comparison](../structured-answer-streaming/completion/README.md)
rejects compact formatting after four pairs, and readable structured streaming is
now [integrated on Rig 0.44](../structured-streaming-integration.md). Next, compare
fresh cases through the live provider/native tool/UI path and grade claim support
and selected-range scope; format and source-ID validation alone do not establish
semantic entailment.
The UI test now selects a cited current body passage for exact highlighting,
while title/property citations retain their legitimate navigation behavior.

## Further evidence and bounded correction

The complete native journey in `../artifacts/native-discovery-only-research.json` passed the
original execution checks, but its research answer quoted retained-change search
previews without reading any historical passages. Its cross-note follow-up also
added an unsupported “pilot was running” narrative despite correctly reporting
current commitments. Shared capability instructions now distinguish discovery
from read evidence, require claim-supporting passages, and prohibit inventing
folder filters from topic names. The research E2E assertion now requires a read,
cited historical passage. General semantic entailment still needs evaluation.

## Comments

2026-09-30: The intermediate structured-worker run
(`../artifacts/worker-structured-final.json`) rendered September 30 as September 9 and
attributed a related vendor preview after the shared allowance prevented its
body read. Earlier failed output also exposed internal failure fields. The
final worker run reads and cites both current bodies and renders the interval
correctly, but this fixture does not resolve general semantic entailment.
See [worker validation](../worker-validation.md); this issue remains open.

2026-09-30: Chat date integration live runs also demonstrated a resolvable body
citation paired with an inconsistent classification of a fenced-code example
as open/undated work. Shared instructions alone did not resolve it in the first
repeat. Exact checkbox text was added to canonical parsed deadline metadata;
the final parent and research samples classified the fixture correctly. See
[date validation](../../archive/completed-work.md#chat-date-context) for failed/intermediate
and final artifacts. General semantic evaluation remains open.

2026-10-10: Established 13 fixed-evidence scenarios and 28 authored positive/negative
controls, plus 11 focused historical reviews covering 12 selected claims. Five
selected claims had admitted citations that did not support them; two lacked
usable citations. Full snapshots, origin hashes and JSON pointers are retained.
Independent review removed an overinterpreted qualified preview claim and
corrected support/coverage labels. No new model calls or production changes.
This is a selected historical baseline, not a current-model success rate;
general entailment remains open pending the controlled experiment above.

2026-10-10: The subsequent paid fixed-evidence baseline used saved gpt-6-luna,
medium reasoning and Flex tier through AgentRuntime. Eleven of 13 answers pass;
one list leaves four factual bullets uncited, and one partial-read answer uses
literal 【Source】 instead of a usable reference. Required facts/qualifications
are correct in all 13. The initial run stopped on Flex unavailability; after
the stated retry window, only the three unfinished cases were retried on the
same tier. Thirteen complete answers report 15,388 total tokens; failed-attempt
usage is unavailable. Synthetic Markdown references differ from production
[S#] references, so current native behavior and a causal improvement remain
unproven. See the [full report](../citation-entailment/current-validation.md).

2026-10-10: Real reference preparation/rendering on synthetic delivered sources
faithfully preserved supplied references and raw omissions. Repeated existing
core and short candidate each pass 1/4 strict full answers and 2/4 citation-only
answers; candidate not promoted. Completed-task omissions are strict-rubric
coverage failures subject to ambiguous original request wording. A final
calibration includes the existing read-tool citation sentence omitted by the
synthesis harness: 1/2 original targets and 2/2 fresh cases pass. This is neither
a paired improvement nor a native reliability rate. Twelve complete calls report
15,456 total tokens. Independent review confirms grading; see the
[report](../citation-entailment/production-reference-validation.md). Shared core
remains 3,161 bytes. Next: actual native read/tool context reproduction; issue open.

2026-10-10: Authorized native reproduction completed three answers using actual
production tools/context. The deadline facts are correct but raw 【S2】 remains
unlinked. An excerpt-only request reads the full note, then falsely attributes
Jordan to the selected excerpt despite a valid full-body citation. The unrestricted
companion correctly reads/cites Jordan. One fourth request returns Flex
unavailability with unknown usage and was not retried. Reported complete-answer
usage is 20,397 tokens. The native harness missed terminal status error and
masked the provider failure with cancellation; repaired offline (support33 and
E2E types pass). Native gate remains failed; app instructions/rendering unchanged.
See [report](../citation-entailment/native-validation.md) and
[selection scope issue](../../chat-context-selection/issues/09-selection-only-answer-scope.md).

2026-10-10: Completed the authorized disposable [structured-answer comparison](../structured-answer-prototype/README.md).
Six paired fixed-evidence cases through actual AgentRuntime: manual citation
coverage 5/6 Markdown versus 6/6 structured; factual/request-scope review 6/6 in
both arms. Every answer used one model call. Total reported usage 18,970 tokens;
structured arm used 15.3% more tokens and emitted no answer-text deltas through
the existing Tool formatter. Native scope enforcement is not evaluated or fixed.
Production core, renderer and runtime are unchanged. Capture branch
`prototype/structured-answer-2026-10-10`, commit
`f1138a30c9ce8abdc7d4b38ee619a334aa907e98` retains the prototype as a primary source.
Keep this issue open; prototype streaming/overhead before native adoption.

2026-10-11: The disposable [streaming/compact prototype](../structured-answer-streaming/README.md)
shows that Rig 0.41 already emits formatter argument deltas; our runtime ignores
them for answer text. One completed verbose answer yielded decoded provisional
text at 5,245 ms, 2,981 ms before final validation, with no early links and a draft
matching final text. Manual facts/scope/citation coverage passed for that answer.
Compact preamble/schema save 304 bytes; token/quality comparison is unmeasured:
the second request returned Flex unavailable and the pilot stopped without retry
or tier fallback. Completed-answer usage is 1,515 tokens; failed usage unknown.
Rust character-boundary/validation and portable-demo cancellation/retry/source-
withdrawal walkthroughs pass offline, but native lifecycle/UI behavior is untested.
Production hosts restored byte for byte; core/dependencies unchanged. Capture
branch `codex/prototype-structured-answer-streaming-2026-10-11` retains source, fixture,
raw events and results. Keep issue open; seven unfinished answers, a separate Rig
0.44 migration and native comparison remain before adoption.
Capture commit: `d626f2b31faff93d93eb604ea7c21a9b6f6e1844`. The branch contains the
standalone replay and prototype sources; rebuilding the runner requires the
measured working-tree host sources named by its provenance.


2026-10-11: Finished the seven unfinished answers on Rig 0.41 before migration.
The [completed comparison](../structured-answer-streaming/completion/README.md)
contains four pairs and 11,823 reported tokens. Compact saves 6.46% input tokens
but only 2/4 answers pass source-ID validation versus verbose 4/4. Both formats
pass facts/scope 3/4; excerpt-only attribution fails in both. All eight stream
provisional decoded text without early links; six valid finals match drafts,
and two invalid finals clear them. Do not promote compact. Native integration
and excerpt-only enforcement remain open, independent of the Rig upgrade.
Comparison capture: branch `codex/prototype-structured-answer-streaming-complete-2026-10-11`,
commit `95aaa36e2cf3b984bc88845f9432077fd590a0aa` (parent is the interrupted pilot).
This captures prototype artifacts only; production migration is separate.


## Structured streaming integration — 2026-10-11

[The readable format is integrated on Rig 0.44](../structured-streaming-integration.md).
Drafts remain literal and transient; the app validates the final closed shape and
exact issued/currently valid source selections before constructing and saving
Markdown. Automated runtime/tool/store/frontend checks cover cancellation,
malformed-result retries, late events, stale/excluded sources and final rendering.
This closes the integration slice, not semantic entailment. Next compare fresh
live/native answers against the existing claim-to-source rubric; retain issue 07
open until answer support and attribution improve on that evidence.


## Rebuild disposition — 2026-10-16

Superseded as an executable old-runtime ticket by [the Pi rebuild](../../archive/pi-chat-rebuild-scope.md). Retain the original evidence without interpreting its runtime-specific next steps as current work. Semantic claim support remains deferred; Pi source identity admission does not establish entailment. A future quality investigation needs current Pi traces and its own scope.
