# Compact format and provisional streaming prototype

Historical experiment. Readable structured streaming was subsequently
[integrated on Rig 0.44](../structured-streaming-integration.md). The prototype's
native-integration limits below describe its original checkpoint.

Disposable follow-up for [citation issue 07](../issues/07-citation-entailment.md),
2026-10-11. Open [demo.html](demo.html) locally; it makes no requests.

## Completed continuation

The [completed Rig 0.41 comparison](completion/README.md) supersedes the partial
pilot outcome below. All four pairs finished: compact reduces input tokens by
6.46%, but two compact answers fail source-ID validation and both formats fail
the excerpt-only scope case. Keep compact out of production. The original
interrupted pilot and its artifacts below remain historical evidence.

## Decision

The existing Rig 0.41 formatter already streams its arguments. Our runtime ignores
those argument deltas when forwarding text events. A temporary observation adapter
can decode only answer text progressively and defer source-link construction until
the final result passes the existing prototype's shape and issued-source checks.
This establishes a feasible streaming seam, **not native chat UI integration**.

The shorter formatting instruction and static schema save 304 bytes in the
attempted three-source pair: preamble 3,729 → 3,495 bytes; schema 361 → 291 bytes.
That is 7.4% of preamble-plus-schema bytes, excluding evidence and engine formatter
boilerplate. These are bytes, **not measured token or billed-cost savings**.
The shared production core stays 3,161 bytes, unchanged. Keep readable
`segments` / `text` / `sources` keys and final app-side source-ID validation.
Do not promote the shorter instruction based on this incomplete pilot.

## Live result and interruption

The bounded pilot planned four fresh cases × verbose/compact formats, alternating
arm order. The first verbose answer completed correctly. The second, compact
request failed with `flex_unavailable` and a 300-second retry hint. The experiment
stopped at its first provider failure; no retry, tier fallback or remaining
requests were made. There are **no completed pairs**.

| Measurement | Sole completed verbose answer |
| --- | ---: |
| Model calls | 1 |
| Input tokens | 1,281 |
| Output tokens, including reasoning | 234 |
| Reasoning tokens, already included in output | 90 |
| Total reported tokens | 1,515 |
| First decoded provisional text | 5,245 ms |
| Final validation | 8,226 ms |
| Preview lead before final validation | 2,981 ms |
| Formatter argument deltas | 129 |
| Decoded draft updates | 98 |
| Ordinary answer-text events from existing runtime | 0 |
| Source links released during draft | 0 |
| Decoded draft equals final answer text | Yes |

The completed mixed-prose answer gives Willow, Quartz and Meadow the correct
action, owner and deadline, with individual source associations. Its prioritization
advice is explicitly an assistant suggestion in a separate unsourced segment.
Manual review passes facts, request scope and citation coverage for this one
answer. [review.json](review.json) binds those observations to exact output hashes.
One sample establishes neither a reliability rate nor a latency distribution.
Failed-attempt usage is unavailable; 1,515 is only reported complete-answer usage.

The captured raw argument stream and returned JSON have different key ordering:
Rig serializes the result value again. They parse to the same value. Both are
retained, and the accounting checks semantic JSON equality rather than byte
identity. Exact argument fragments and timings remain in [runtime.json](runtime.json).

## Offline walkthroughs

The disposable Rust prefix decoder was exercised at every character boundary for
three authored outputs: quotes/newlines/backslashes, Unicode including split
UTF-16 surrogate pairs, multiple segments, and sources before or after text.
It exposes only `segments[*].text`, never schema keys or source arrays. Literal
markers/code remain inert draft text. The existing final renderer rejects
unissued IDs, extra result fields and a source no longer delivered. Trailing
garbage is rejected by the prefix decoder. All passed without inference.

The single-file demo replays the real recorded Rust decoder events. Its portable
reducer adds authored cancellation, retry, stale-attempt, failure and source-
withdrawal actions. A cancelled/failed answer clears the draft; late completion
is ignored. New attempts start empty and reject events tagged with an old attempt.
Final source membership/closed-shape validation releases source buttons only
after acceptance; invalid/withdrawn sources clear the draft. Withdrawal after
validation also clears the answer and all its links. JavaScript syntax
and these transitions passed the [offline walkthrough](offline-walkthrough.json).
These lifecycle transitions are demo logic, **not exercised native runtime
cancellation/retry behavior**. The HTML uses literal text even after validation;
it does not implement chat's Markdown rendering or navigation.

Browser preview remains blocked by the browser tool's local-file policy from the
prior prototype. No alternate browser surface or server workaround was attempted.
Source syntax and pure transitions were checked offline; visual layout and
browser interactions are unverified.

## Method and limits

- Uses actual AgentRuntime, its existing Tool formatter, and real PassageReferences
  preparation/rendering over synthetic delivered sources. No vault, retrieval,
  executable tools, canonical grants or native context assembly. Provider settings
  remain saved `gpt-6-luna`, medium, Flex.
- Four fresh fixtures were frozen before generation: mixed sourced/ordinary prose,
  a task table, excerpt-only scope, and a superseding hold with multiple sources.
  Only the mixed-prose verbose answer completed. The compact case failed; table,
  excerpt and hold cases were never requested. Requirements are not sent to the model.
- Compact schema keeps closed object types, required keys and string/array types.
  It removes the dynamic source-ID enum and count/uniqueness annotations; the final
  app-side validator still enforces admitted IDs, uniqueness and 1–24 segments.
  This is best-effort Tool formatting, not provider-native strict decoding.
- The adapter identifies the actual formatter by the existing exact-schema seam,
  including renamed formatter names, and accumulates arguments by internal call ID.
  That branch is not live-tested with collisions or parallel calls. Preview resets
  at each observed model request. A complete production integration still needs
  answer/attempt identity, cancellation/retry ownership, final replacement, durable
  publication and citation-navigation checks. The prototype's global state and
  prefix reparsing are intentionally disposable.
- A valid source ID does not establish that its passage supports the claim. Empty
  source arrays still allow omitted citations; a segment may associate a whole
  table or paragraph with several sources. Selected-range enforcement remains a
  [separate open issue](../../chat-context-selection/issues/09-selection-only-answer-scope.md).
  The final renderer is reused without changing its Markdown/reference behavior.
- The launcher temporarily includes code in three test hosts, compiles, then restores
  their exact original bytes before any walkthrough or credential access. No
  production runtime, prompt, settings, durable contracts or dependencies changed.
  [Run provenance](run-provenance.json) binds fixtures, settings, sources and executable.
  The key stays in process memory; no secrets, user notes or private reasoning are saved.

## Reproduce

`python3 .scratch/chat-reliability/structured-answer-streaming/analyze.py` verifies
output/review bindings, paired inputs, argument reconstruction, source membership,
frozen source hashes and recorded pre-upgrade host restoration, then recomputes [summary.json](summary.json)
and generates the self-contained demo. No inference.
Production host bytes intentionally changed in the later Rig migration; they are
not compared with the historical hashes by this replay.

`python3 .scratch/chat-reliability/structured-answer-streaming/run.py --offline`
builds/runs the credential-free Rust walkthrough. `--build-only` just compiles.
The launcher depends on the earlier [prototype helper](../structured-answer-prototype/runtime.rs).
Rebuilding requires the measured working-tree host sources recorded in provenance;
the capture branch does not snapshot the repository's other uncommitted changes.
The embedded HTML replay works independently of that build context.

`--run --output <fresh-path>` explicitly starts a **new** paid pilot using the
saved Keychain credential in memory. It does not resume this partial run, and
would repeat the completed case. It plans at most eight answers, stops on first
provider/runtime failure, permits at most two formatter attempts per answer with
best-effort cancellation on a third, and uses 90-second/8,000-observed-token answer
limits and a 25,000-observed-token pilot cap. In-flight usage may exceed an observed
cap. No automatic retries or tier changes. A continuation should explicitly skip
the completed verbose case and retain this failed attempt rather than overwrite it.

## Next slice and Rig

Complete the seven unfinished answers on the same settings before interpreting
compact quality, token savings or table/excerpt behavior. Then, before production
adoption, migrate the runtime in a separate change and run a small native comparison
covering streaming, final publication, citations and cancellation/retry.

Rig's [0.44.0 release](https://github.com/0xPlaygrounds/rig/releases/tag/v0.44.0)
(October 7) is worth a focused migration from our pinned 0.41.0. It includes streamed
tool-argument recovery, OpenAI citation/reasoning decoding and explicit `strict: false`
serialization; the latter overlaps our local compatibility wrapper. It also changes
usage/runtime types. Do not assume the upgrade fixes semantic claim support or remove
the wrapper without checking the actual wire request. The installed version already
supplies the argument deltas used here, so this pilot intentionally kept it fixed.
The upstream [function-calling streaming documentation](https://developers.openai.com/api/docs/guides/function-calling#streaming)
describes the provider's per-call argument-delta accumulation model.

Captured on local branch `codex/prototype-structured-answer-streaming-2026-10-11` as a
primary source for issue 07. No production decision is promoted from this partial pilot.
