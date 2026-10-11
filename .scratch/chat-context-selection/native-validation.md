# Native multi-turn and semantic pass

Historical pre-fix report. The subsequent [referent correction and validation](referent-validation.md) records the current implementation and two final passing native replays. The original failures below remain retained.

The five planned turns completed through the real native app. **Four answers
were correct; the updated-production-note follow-up failed source selection.**
It reproduced a failure from an earlier three-turn attempt. The native gate
remains failing deliberately; this is not a passing reliability result.

The pass also exposed an ordinary search cache bug, which is fixed and verified.
[Issue 07](issues/07-followup-note-referents.md) records the remaining chat issue.

## What ran

The native WebKit app used `gpt-6-luna`, the saved OpenAI Keychain credential,
the installed Gemma/LiteRT embedding provider, and an owned disposable vault.
Only installed model/runtime assets were copied from the user's application
data. The credential stayed in process memory through the existing debug
credential override; no credential value was sent through WebDriver or saved
in artifacts. User notes and settings were not used or modified.

The first request used the visible composer. Its rendered citation opened and
highlighted the exact canonical passage. The editor then opened the similar
rehearsal draft through the normal frontend citation-navigation callback.
Later turns used production IPC in the same durable conversation, supplying
the inspected actual draft editor snapshot. These later turns test the real
chat lifecycle and context assembly, rather than repeated composer interaction.

| Turn | Question being tested | Observed result |
| --- | --- | --- |
| 1 | Paraphrased approval question, production versus rehearsal | Correctly attributed Mateo to production and Iris to rehearsal, citing each note. |
| 2 | Refer back to the production note while its draft is open | Correctly answered QUARTZ-908 from operations; explicitly distinguished AMBER-119 from the draft. |
| 3 | Read the production note after changing its token to TOPAZ-642 | Read only the open draft, gave AMBER-119 with a rehearsal caveat, and did not find the requested updated token. |
| 4 | Explicitly change topic to Cedar afternoon | Correctly answered beside the lake at 13:30. |
| 5 | “What should I bring?” on the new topic | Correctly answered nectarines from Cedar. |

Every answer reached durable `complete` status. Its passage links resolved at
delivery time. The final answer persisted across webview reload and its passage
resolved again. The private synthetic canary was not mentioned, and no excluded
source appears in the recorded answers. Earlier operations citations were
checked before editing that note; this does not claim those old passages remain
current after the edit. The disposable fixture was removed by harness cleanup.

The [raw trace](native-multiturn-semantic.json) and
[manual claim review](native-manual-review.json) preserve the difference between
structural completion, valid citations, and answering the requested question.
The review is bound to the final trace SHA-256. The test's last assertion fails
on `updatedTokenSupported`, after all planned turns and reload checks finish.

## Semantic retrieval was actually used

At setup, text search was ready, all four authored notes were indexed, and ANN
was loaded without an error. For the same query, **“green light for launch”**,
the lexical-only probe returned no hits. Re-enabling semantic search retrieved
both operations notes with positive semantic scores and zero lexical scores.
These exposed scores are ranking scores, not calibrated probabilities.

Before any citation/editor navigation, the first chat turn executed passage
discovery and increased successful embedding requests from 3 to 4, ANN queries
from 1 to 2, and ANN candidate count from 8 to 16. This establishes actual local
semantic participation in that chat turn. It does not establish that its final
answer would fail under a separate lexical-only model run.

Across the conversation, ANN queries increased from 1 to 5. The failed third
turn performed one `read_notes` call and no discovery query. Its citation points
to the draft accurately; the failure concerns the requested source, not citation
resolution or an invented token.

## Cache correction

The first native toggle probe returned the cached empty lexical response after
semantic search was enabled. `search_notes_hybrid_unchecked` previously read
the result cache before obtaining semantic settings. Its key omitted enablement
and effective default ranking weights. The 750 ms cache could therefore reuse
results from a different retrieval configuration.

The command now obtains settings before cache lookup and includes semantic
enablement and effective weights in cache identity. The regression exercises
the production command and real stored settings, including a default-weight
change and reuse when effective settings stay unchanged. No embedding download
is needed for the offline regression. The unchanged native probe now retrieves
the paraphrase target. Chat evidence discovery has its own service path; this
ordinary-search cache correction does not resolve the third-turn chat failure.

## Remaining context issue

The earlier [three-turn reproduction](native-updated-referent-failure.json)
explicitly misattributed AMBER-119 to production. The full replay was more
cautious about the draft's scope, but still failed to retrieve updated operations.
Both runs chose the wrong note on the updated follow-up.

The leading explanation is that `model_history_content` removes the earlier
note-based answers, including their note names and identifiers, while the next
prompt supplies the adjacent draft's identity. This code path is confirmed;
the causal effect of retaining small, policy-validated source-identity hints
has not been tested. Issue 07 proposes that next investigation without restoring
old facts, injecting adjacent bodies, or adding a note picker. The shared
assistant core remains **3,161 bytes**.

## Verification and retained attempts

- Search commands: **15 passed**; [log](native-validation/search-green.log).
- Architecture checks: **21 passed**; [log](native-validation/architecture.log).
- E2E TypeScript check passed; [log](native-validation/e2e-types.log).
- Native build completed and the pinned artifact was used;
  [build log](native-validation/native-build.log).
- Final native run: **failed**, solely on the updated-token smoke gate after
  all five answers; [log](native-validation/native-final.log).
- Scoped Rust formatting and whitespace checks passed.

Setup and oracle corrections are retained rather than counted as product
failures: [cache reproduction](native-semantic-cache-failure.json),
[navigation-path harness failure](native-navigation-harness-failure.json),
[composer harness failure](native-composer-harness-failure.json), and
[overstrict token oracle](native-token-oracle-failure.json). The latter rejected
a correct, attributed draft comparison; the final oracle requires the requested
token and its supporting source instead of banning any mention of another token.
Warmup received a longer script timeout after one attempt exceeded 30 seconds
while local compilation was active.

The complete sequence used 15 model calls, **45,877 input tokens** including
36,345 cached tokens, and **871 output tokens**. All retained partial and full
attempts together contain 12 conversational turns, 38 model calls, 118,523 input
tokens including 91,578 cached tokens, and 2,564 output tokens. These are reported
usage totals, not a billed-cost estimate. [Usage summary](native-usage-summary.json)
includes every retained paid attempt and its trace hash. The setup-only cache
reproduction and interrupted initial setup sent no paid chat request.

This was a small regression pass on one model and a tiny synthetic corpus.
Four of five describes this sequence, not a general success rate. The remaining
failure was observed twice; no broader model matrix was run.

To reproduce after building the native E2E binary:

```sh
GNEAUX_CONTEXT_SELECTION_NATIVE=1 \
GNEAUX_LIVE_OUTPUT=.scratch/chat-context-selection/native-replay.json \
node e2e/support/contextSelectionNative.mjs
```

The launcher is explicitly paid and opted in, uses disposable application
storage, and polls per-turn spending/time bounds. Stop conditions are observed
between polls, so these are evaluation bounds rather than provider-side hard
spending limits. No further paid runs are needed to preserve this finding.
