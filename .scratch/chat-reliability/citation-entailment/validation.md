# Citation evaluation baseline

2026-10-10. Offline only. No new API calls, credential access, production prompt
changes or runtime changes in this phase. [Issue 07](../issues/07-citation-entailment.md)
remains open. See the [rubric and commands](README.md), [primary-source
research](research.md), and generated [accounting report](baseline-summary.json).

## What is ready

The fixed corpus covers 13 scenarios across dates, recorded task status,
historical changes, citation scope, related-note attribution and read authority.
All 28 authored controls produce their intended accounting result: 13 pass and
15 fail. These are deliberately authored examples, not model outputs.

The historical baseline selects 11 focused reviews from 10 distinct answer
turns across retained regression runs. One answer supplies separate title-failure
and historical-text-support selections. Full answers and admitted source snapshots
are retained alongside original hashes and JSON selectors. This is purposive
sampling across different model/prompt versions, not a current-model success rate.

| Selected claim dimension | Count |
| --- | ---: |
| Annotated note-based claims | 12 |
| Claims with inline citations, all in captured admitted sources | 10 |
| Supported by their associated evidence | 5 |
| Cited but unsupported | 3 |
| Cited but contradicted | 2 |
| Missing usable citations; unassessable as cited claims | 2 |

Four of the 11 focused reviews pass for their selected claims only; none is
reported as a whole-answer pass. The two missing-citation selections concern
historical discovery content and a correct conversational fact. The five cited
failures cover a title used for a historical body insertion, an invented running
pilot, a September 30 window rendered as September 9, a fenced example classified
as an open task, and a production-note claim citing a draft-note token.

Independent review checked full answer context and exact source excerpts. It
removed one initially proposed negative: the worker explicitly qualified its
unread vendor-preview quotation, so treating that sentence as an unqualified
completion claim would overstate the failure. Its separate date error remains.
Control review also distinguishes unsupported from contradicted and makes
coverage mean correct satisfaction of the requirement, not merely mentioning it.

## Verification

The Python tests cover review accounting, missing/preview/unknown citations,
required coverage, pending reviews, annotation/source integrity, historical
snapshot binding and the prepare → manual review → grade CLI workflow. The CLI
test also verifies no-overwrite preparation and rejection of changed answers or
corpus hashes. [checks.log](checks.log) records the result.

`check --verify-traces` verifies every selected original trace's SHA-256, exact
question, answer and normalized source snapshot. Retained snapshot hashes are
also checked. Disposable-vault references are not revalidated as current live
citations. No app tests were run for this phase because it changes only offline
evaluation artifacts and tracking documents.

## What this suggests testing next

Existing shared instructions and evidence guidance already describe the main
distinctions. These historical failures do not establish whether the current
smaller prompt has the same weaknesses, or whether failures arose in retrieval,
tool delivery, interpretation or final writing. The fixed-evidence corpus
isolates interpretation and citation attribution from retrieval for a controlled
next experiment; native journeys remain necessary for delivery behavior.

1. Capture a small current-model baseline using unchanged questions/evidence,
   the actual current shared instructions and applicable evidence guidance.
   Record exact inputs, model/settings, output, latency and usage. Start with one
   answer per case; repeat ambiguous or failing cases before concluding.
2. Review against the fixed rubric, with every claim inventoried. Report failures
   and coverage separately by category, alongside input/output token costs.
3. Only then compare one narrow candidate on identical evidence and settings.
   A candidate is a short finalization reminder to check each claim's entity,
   state, date and scope against its cited passage. This is a hypothesis, not
   an implemented improvement; current instructions already require support.
   Prefer measuring it within the existing completion before introducing another
   model call for verification.
4. Freeze the candidate and evaluate fresh held-out examples plus a small native
   pass, particularly related-note attribution and history/current comparisons.
   Require retained coverage and no new invented uncertainty or attribution
   regressions before expanding the prompt or declaring improvement.

Latency diagnosis and the reviewed chat-to-note flow follow this work. This
offline baseline establishes a way to measure claim support; it does not resolve
the semantic quality issue or demonstrate a model improvement.
