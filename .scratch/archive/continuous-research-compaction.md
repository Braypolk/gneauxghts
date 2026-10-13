# Continuous research with run-local context compaction

October 13, 2026. Supersedes the conservative cumulative allowance in
[adaptive evidence allowance](adaptive-evidence-allowance.md).

The previous 62,080-byte grant for a 129,280-token loaded window still treated
context capacity as a lifetime retrieval quota. Durable chat compaction ran only
between user messages. A running agent therefore also stopped at fixed model,
tool, aggregate-token and elapsed-time ceilings; research workers additionally
had twelve-call and 90-second limits.

Production now compacts provider-facing context within the running tool loop and
has no default cumulative research/evidence, tool-call, model-call, token or time
quota. Explicit caller limits, cancellation and consecutive identical-call stall
detection remain. Read pages and individual tool envelopes remain bounded.
Search cursors occupy a bounded cache rather than imposing a lifetime query
quota; evicted scopes keep their freshness bindings.

The runtime preserves original system instructions, the original user prompt and
latest assistant/tool-result group verbatim. A matching prefix checkpoint projects
a continuation summary plus subsequent work. Summaries install atomically only
after closed-schema, size and reduction checks, with up to two invalid-output
retries. Every summary attempt contributes to usage. Source freshness is checked
again after compaction inference before continuation dispatch. Summary text is
fallible memory, never evidence, authorization or a durable resume checkpoint.
Original engine history remains in memory; persisted conversation history stays
with ChatService. Physical resources and provider availability still constrain
runs. Unknown capacity uses a conservative byte working-context threshold.

Live diagnosis found Qwen could consume the entire summary output allowance with
reasoning and return empty text. Per-request `reasoning_effort: "none"` worked on
the user's LM Studio server. Local compaction uses it without changing reasoning
preferences for ordinary answer or research calls. An earlier bounded live test
also interrupted compaction at its explicit deadline and recorded an unreported
attempt rather than installing partial state. The synthetic pagination fixture
was corrected to omit a next page when traversal is complete.

Validation:

- Reproduced the old cumulative stop; the corrected production streaming runner
  completes 110 productive tool calls / 111 main completions and exceeds 400,000
  aggregate tokens. A second runner test performs repeated compactions while
  preserving the original request, actual tool-call/result pairs and usage.
- Reproduced stale continuation dispatch after a source changed during compaction;
  the corrected real tool-context/runtime path stops before main inference.
- Reproduced malformed-summary failure; bounded retry now recovers, counts both
  attempts and preserves original context. Exhausted invalid-summary retries
  retain original data and count all three responses.
- Focused backend suite: 135 passing, 10 opt-in tests ignored. Strengthened
  compaction tests: 3 passing. Durable chat/context/cancellation checks: 4 passing.
- UI reducer: 17 passing, including live/replay compaction state without losing
  selected-note metadata. Type checks report zero errors or warnings.
- Architecture fitness: 21 passing. Formatting, whitespace checks and normal
  debug native build pass.
- Actual LM Studio `qwen3.8-27b-gsq-rco`: synthetic production streaming runner
  traversed pages 1–10 exactly once, compacted three times and returned Tuesday
  with the exact `[Launch record](note://synthetic-launch)` citation. Histories
  shrank 28,668→8,147, 28,892→8,213 and 29,024→8,282 serialized bytes. Summary
  calls used 160/160/161 output tokens and zero reasoning tokens. Run: 46.8 seconds.
  The test simulated a 19,000-token working window without reloading or changing
  the server's 129,280-token loaded window. No private vault content was sent.

Current ownership and invariants are recorded in `ARCHITECTURE.md` and
`docs/architecture/behavior-invariants.md`; these measurements are historical
acceptance evidence, not guarantees of lossless model summarization.

## Actual `research_notes` live acceptance

Follow-up on October 13, 2026 exercises the real tool, rather than the earlier
synthetic pagination tool. The production `AgentRuntime` invokes `research_notes`,
its separate worker runs actual canonical `read_notes` calls, validates its
structured selection, and delivers evidence back to the parent. The parent
finishes retrieval and uses the production structured-answer schema and citation
renderer. A disposable TestVault supplies six synthetic notes, each containing
28,800 bytes of archive text followed by a unique final review code. Expected
codes are absent from the model request. No private notes are sent.

A loopback proxy forwards completion bodies unchanged to the loaded
`qwen3.8-27b-gsq-rco` on LM Studio. Only capacity-discovery metadata is overridden
to 32,000 tokens to force repeated compaction. The server stays loaded at 129,280
tokens. This validates repeated context pressure and continuation, not a benchmark
that fills the entire actual window. Ordinary inference has reasoning disabled
per request for this test. Its explicit 600-second, 180-tool-call and two-million
token guard is test-only; production defaults remain without cumulative quotas.

| Measurement | First live run | Corrected-test repeat |
| --- | ---: | ---: |
| Worker read calls | 73 | 73 |
| Fully read canonical notes | 6 | 6 |
| Worker compactions completed | 4 | 4 |
| Summary requests, including retries | 5 | 4 |
| Worker read output bytes | 284,160 | 284,160 |
| Largest read page, bytes | 4,383 | 4,383 |
| Final facts with validated citations | 6 | 6 |
| Worker tool errors | 0 | 0 |
| Elapsed seconds | 325.2 | 325.6 |

The first note completed before the first compaction; its fact and exact source
survived all four. Wire verification checks tool-call/result pairing in every
request, all six canonical `wholeNoteComplete` results, the absence of a lifetime
evidence allowance, and successful parent tool events. The bounded initial
handoff delivered four passages and two `remainingEvidenceIds`. The parent read
exactly those two IDs in one successful call, then rendered all six citations.

The initial test incorrectly required all six passages in that first envelope;
its final fact/citation assertions already passed, but that envelope assertion
failed. The retained regression accepts the valid paged handoff and requires
the final complete cited answer. The corrected live test passes. Independent
wire/final-answer verification passes for both captures. One first-run summary
failed validation (2,055 response-text bytes; 2,000-byte summary limit), retried
successfully, and continued without a worker tool error.

Repeat histories shrank 82,430→11,037, 80,682→11,258, 80,915→11,394 and
77,006→11,943 serialized bytes. Every successful summary reports zero reasoning
tokens. Additional checks: 15 research orchestration regressions, the repeated
streaming-compaction regression and all 21 architecture fitness tests pass;
Rust formatting, fixture Python parsing and whitespace checks pass. No production
runtime change was needed for this follow-up.

Retained fixtures:

- `src-tauri/src/agent_tools/tests/research_compaction_live.rs`: opt-in live
  parent/worker regression with real evidence and final citation assertions.
- `src-tauri/test-fixtures/research_compaction_proxy.py`: loopback-only metadata
  proxy; captures synthetic requests without headers or credentials. Each run
  requires a new capture path.
- `src-tauri/test-fixtures/verify_research_compaction.py`: independent capture and
  report checks, including full reads, pairing, handoff recovery and UI success
  events.

From the repository root, start the proxy in one terminal (use a fresh capture
filename on later runs):

```sh
python3 src-tauri/test-fixtures/research_compaction_proxy.py \
  --upstream http://100.117.20.29:1234/v1 \
  --model qwen3.8-27b-gsq-rco --capacity 32000 \
  --capture /private/tmp/research-compaction-wire.jsonl
```

In another terminal:

```sh
GNEAUX_LIVE_ENDPOINT=http://127.0.0.1:18841/v1 \
GNEAUX_LIVE_MODEL=qwen3.8-27b-gsq-rco \
GNEAUX_LIVE_OUTPUT=/private/tmp/research-compaction-report.json \
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  live_research_notes_survives_multiple_worker_compactions -- --ignored --nocapture

python3 src-tauri/test-fixtures/verify_research_compaction.py \
  /private/tmp/research-compaction-report.json \
  /private/tmp/research-compaction-wire.jsonl
```

Stop the proxy with Ctrl-C after the run. Current local evidence is under
`/private/tmp/gneauxghts-real-research-{report,requests,verification}` with
`.json`/`.jsonl` extensions; repeat files add `-2` before the extension.
The corrected test log is `/private/tmp/gneauxghts-real-research-test-2.log`.
This acceptance reaches the backend tool, provider, worker, handoff, emitted tool
status and final citation renderer; it does not automate the native UI or prove
durable chat reload behavior.

## Native development conversation acceptance — 2026-10-13

Follow-up acceptance exercised the freshly built native development app through
Computer Use, with the real LM Studio `qwen3.8-27b-gsq-rco` IQ3_S model and two
synthetic notes. The server reported a loaded 129,280-token context. This run did
not force compaction; the preceding backend acceptance covers repeated worker
compaction independently.

The normal development launch and stale installed/debug app copies encountered
repeated macOS Documents access prompts. Stopped the test-owned instances and
built a distinct `Gneauxghts Dev Test.app` bundle using the existing `e2e-wdio`
feature solely for temporary startup paths. No WDIO drove this test. App data,
documents and vault were under `/private/tmp/gneauxghts-conversation-ui`, avoiding
real-vault reads and further Documents prompts. This isolates the test; it does
not establish a fix to macOS permission persistence for normal app launches.

Six user turns completed in one conversation:

1. `research_notes` compared both release packages, with correct dates, review
   codes, owners, statuses and two citations. Remembered `amber-otter`.
2. Two fresh `read_notes` calls verified the waiting package, owner and three-day
   date difference, preserving the conversation code. Clicking a citation opened
   the correct note.
3. `read_notes` plus `propose_note_change` staged exactly one status edit. Reviewed
   the highlighted change in the editor and clicked Keep. The proposal persisted
   as committed and only the intended status line changed.
4. Fresh reads correctly reported both packages approved, with both review codes,
   citations and the original conversation code.
5. Quit and relaunched the same isolated app, reopened the persisted conversation,
   and requested research again. Two attempts completed research but took over
   three minutes without a final answer; Stop cancelled them and Retry remained
   usable. A second retry completed in 57.5 seconds with both correct citations,
   current facts and remembered code. Its worker received a model-mistyped note ID,
   returned validated partial evidence after two recoverable tool errors, and the
   parent recovered the missing note through a successful direct read. Clicking
   the new Birch citation opened its correct current content.
6. Restored the direct server endpoint and Medium reasoning. A final fresh
   `read_notes` follow-up completed in 9.8 seconds with the updated Aster status,
   correct review code, citation and remembered conversation code.

The first four runs used the default Medium reasoning and completed in 46.7,
18.8, 13.4 and 45.4 seconds. The two stopped attempts used Medium and Light and
were cancelled after 215.7 and 187.0 seconds respectively. Their latency cause is
unresolved; do not interpret the successful retry as proof that Light fixes it,
or claim every request completes promptly. The app's reasoning picker exposes
Light, Medium and Extra High for this model, without an Off option.

For the successful retry only, a loopback diagnostic proxy forwarded requests
unchanged and captured synthetic request/response bodies without credentials.
All ten completion requests returned HTTP 200, terminated their SSE streams with
`[DONE]`, placed the sole system message first, included object `properties` in
every tool's parameter schema, and preserved tool-call/result pairing. Restored
the direct endpoint and stopped this proxy before the final follow-up.

Read-only SQLite verification confirms six completed runs and two explicit
`userCancelled` runs, one committed proposal, correct final answers and persisted
source identities. Every top-level tool ended successfully; the partial worker's
two argument/scope errors were recovered rather than hidden in the counts. Older
Aster citations became unavailable after its canonical content changed, matching
the current-passage freshness invariant; new citations remained navigable after
reload. No provider 400/500 error recurred. No production code change was needed
for this native acceptance.

Local evidence: `/private/tmp/gneauxghts-conversation-ui/validation-report.json`,
`wire-verification.json`, `wire/`, `app.log` and `restart.log`. The final app is
left open on the successful direct-server answer with Medium reasoning restored.
