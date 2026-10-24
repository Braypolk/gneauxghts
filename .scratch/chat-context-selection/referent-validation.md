# Conversational note references and updated-note follow-ups

The revised context layout passed two consecutive five-turn native replays with
`gpt-6-luna`: both recovered the production note while its similar rehearsal
draft was open, reread its changed token, switched topics, and followed the new
topic. Each delivered claim had a valid inline passage citation. This is a
bounded synthetic result, not a general reliability guarantee.

[Issue 07](issues/07-followup-note-referents.md) is implemented. An intermittent
inline-citation omission found in earlier variants remains separately recorded
in [issue 08](issues/08-inline-citation-omission.md).

## Changes

Old note-based assistant answers remain omitted from later model context. A
fresh app context now preserves current, permitted note IDs and canonical
titles, associated with the preceding user request and answer ordinal. The
latest completed answer is marked. Historical user wording preserves intent;
old assistant facts, excerpts, passage hashes and citation authority stay out.
Compacted references are rebuilt from durable source identities on every request.

All reference groups together are limited to eight references and 2,400 UTF-8
bytes, including framing; historical request text and titles are individually
bounded. Only references admitted into model context remain bound to validation.
Access, managed identity, canonical location and current title are checked again
before model inference and delivery. A body change alone leaves the navigation
identity valid, while any answer about that body still requires fresh reads.

The automatic editor hint is now a leading app System message, separate from
authored dialogue. Fresh conversational reference groups follow the old dialogue.
Other turn-local context precedes the explicitly labeled current user request.
The editor hint continues to carry permitted identity/title and a validated
selection, without automatically including its body.

Pre-inference context validation is independent of executable tool exposure, so
local models without tools cannot bypass access checks. Each validation pass
reuses its current permission snapshot. Research workers keep their own context;
the stored worker configuration drops the parent's validation context to avoid
retaining the parent through an Arc cycle.

The shared assistant instructions remain **3,161 bytes**, and the five-tool
interface is unchanged. No question parser, source lock or new tool was added.
The current-user request delimiter adds 16 raw bytes; fresh history references
add bounded context as the conversation develops. This phase does not establish
retrieval or token savings.

## Native evidence

The real native WebKit app used the saved Keychain credential and installed
Gemma/LiteRT assets in disposable synthetic vaults. The first question used the
composer. Citation navigation selected the exact canonical passage; the similar
draft was then actually opened. Later turns used production IPC in the same
conversation with the inspected editor snapshot. These are not five repeated
composer interactions. User notes and settings were not changed.

| Replay | Change | Fully successful answers | Result |
| --- | --- | --- | --- |
| [1](referent-native-1.json) | Identities inside older assistant messages | 3/5 | Wrong draft on both production follow-ups. |
| [2](referent-native-2.json) | Separate fresh app context | 3/4 | Production follow-ups correct; stopped on missing Cedar citation. |
| [3](referent-native-3.json) | Unchanged confirmation of 2 | 1/2 | Correct production fact; stopped on missing citation. |
| [4](referent-native-4.json) | Explicit citation guidance and raw delta capture | 4/5 | Updated-note turn still chose draft. |
| [5](referent-native-5.json) | Put current request last | 5/5 | Passed once. |
| [6](referent-native-6.json) | Unchanged confirmation of 5 | 3/5 | Both production follow-ups chose draft; request order alone insufficient. |
| [7](referent-native-7.json) | Separate editor role and user-request/reference associations | 5/5 | All gates and durable reload passed. |
| [8](referent-native-8.json) | Same layout plus review validation corrections | 5/5 | All gates and durable reload passed. |

Final replays answered Mateo for production, Iris for rehearsal, QUARTZ-908 for
the production follow-up, TOPAZ-642 after the actual production edit, beside the
lake at 13:30 after the topic change, and nectarines for its follow-up. Both
verified real semantic participation before editor navigation: the lexical-only
probe returned no hits; enabled retrieval returned positive semantic matches;
chat increased successful embedding requests and ANN query/rerank activity.
Exposed search scores are ranking scores, not confidence probabilities.

Exact citation navigation, current passage resolution, durable reload and
excluded-source checks passed. Production citations were checked before the
production edit; old passages are not claimed fresh after the edit. Disposable
vaults were removed by harness cleanup.

All failed attempts remain retained. [Manual claim review](referent-manual-review.json)
binds each judgment to its final trace SHA-256 and distinguishes source selection,
citation presence and structural completion. Raw model deltas were captured from
replay 4 onward; those references converted faithfully into delivered links.
The omissions in replays 2 and 3 predate raw capture, so their precise origin is
not established. Replays 4–8 did not repeat the omission.

Replay 7 used binary SHA-256
`e692949a42e6a55a1f6b73d61af20afe8ea2d94b1d23de50127f5d0401534d9f`.
Replay 8 used
`4c4c620d61294f01e22c9c148e1a93e88fb5477e1c94032b6c59cc2cef23fa88`.
The final worker-configuration lifecycle correction was made while replay 8's
pinned binary ran; its deallocation behavior is verified offline, rather than
claimed to have been included in that binary. It does not change context text.

## Verification and usage

**120 targeted offline checks passed:** chat 58, context regressions 15, runtime
12, research 14 and architecture 21. The context checks cover body updates,
rename/move/forgetting, current grants and exclusions, compaction, role separation,
rejected-reference validation, and rejection before inference with no tools.
The research regression directly verifies that the parent context deallocates.
Native harness TypeScript checking, Rust formatting and diff checks passed.
Independent Standards and Spec review found and verified the validation fixes;
no actionable findings remain in this phase's reviewed scope.

[Recorded usage](referent-usage-summary.json) includes **all eight paid attempts**:
36 delivered answers, 94 recorded chat model calls, 291,911 input tokens (including
221,332 cached input tokens), and 5,724 output tokens. These are cumulative
per-answer aggregates counted once, not sums of cumulative usage events. These figures cover only instrumented chat calls and therefore are not total
provider spend. No general savings or
provider-cost estimate is inferred from this small changing sample.

The [phase patch](referent-phase.patch) is relative to exact pre-phase snapshots
in `referent-baseline`, including the later observer-field corrections. Other
dirty workspace changes belong to prior work and are outside this review.
