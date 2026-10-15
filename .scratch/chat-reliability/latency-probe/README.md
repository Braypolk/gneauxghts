# Local request latency diagnosis, 2026-10-14

The current synthetic activity requests are dominated by local-provider work,
not evidence retrieval or conversation polling. Both finish inside the original
300-second harness deadline. No production optimization or timeout increase is
justified by these measurements. The historical five-minute timeout is **not
reproduced or conclusively attributed**.

Production chat and research workers have no cumulative elapsed-time, model-turn,
tool-call or token ceiling. The deadlines and counters below belong to this
opt-in diagnostic harness; reaching them cancels the test request, not ordinary
app requests. Production retains cancellation, context compaction and detection
of consecutive identical tool calls.

## Measurements

| Case | Send to terminal observation | Provider/transport | Completion calls | Tool durations, summed | Poll median / p95 / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short READY reply | 6.064 s | 5.266 s (86.84%) | 1 | 0 | 28 / 32 / 32 ms |
| Activity, first independent chat | 74.097 s | 72.547 s (97.91%) | 5 | 184 ms | 34 / 80 / 103 ms |
| Activity, second independent chat | 37.086 s | 35.828 s (96.61%) | 4 | 133 ms | 33 / 86 / 93 ms |

The model reported 2,813 output tokens (2,286 reasoning) for the first activity
request, and 1,558 (1,189 reasoning) for the second: about 80% reasoning overall.
Reported cumulative input was 32,728 and 20,247 tokens across the respective
completion calls; these totals include repeated context, not unique note content.
The largest individual completion took 34.962 seconds: its first delta arrived
at 9.236 seconds and its first answer/formatter argument at 32.213 seconds.
The proxy does not retain the intervening reasoning text.

Post-completion conversation reads took 12–47 ms; resolving all cited passages
took 163 ms and 40 ms for the activity answers. Provider HTTP headers usually
arrived in 18–27 ms (one 112 ms sample). A direct 57-input-token READY smoke
through the same proxy finished in 1.320 seconds and delivered its SSE terminal
frame; its request is separate from the native measurements above.

Each activity request searched once and performed three/two reads respectively.
The first includes selected historical passages, a continuation, and current
status. Different selected evidence and generated reasoning contributed to the
variation; it cannot be assigned solely to hardware or caching. The second
answer summarized only the onboarding fragment. This is a timing run, not an
answer-quality or complete-coverage pass.

## Method and limits

- Current app-owned runtime and actual native `chat_send_message`, tools,
  SQLite events, source admission, and final structured-answer validation.
  Three fresh conversations in an owned disposable vault; synthetic activity
  edits from the earlier reproduction. Lexical retrieval removes semantic-model
  setup as an unrelated variable. No concurrent Rust suite.
- Current configured model: `qwen3.8-27b-gsq-rco`, IQ3_S, loaded with 129,280
  context and one parallel slot on the network local server. The older timeout
  record used `qwen/qwen3.8-27b`; model variant and runtime have changed since then.
  No model was substituted, unloaded or reconfigured in this investigation.
- The server advertises reasoning `off`/`on`, default `on`. Native conversations
  retain the app's saved `medium` preference; the current adapter preserves the
  server default by omitting an unsupported override. All captured completion
  requests omitted `reasoning_effort`; reasoning remained enabled. No reasoning
  A/B or speed/quality recommendation is established.
- A loopback HTTP proxy records request/response sizes, wall timestamps, first
  streamed delta, first content/tool argument, usage counts, and outcome. It
  forwards streaming frames immediately and stores neither prompts nor raw
  reasoning. Provider intervals include inference, queueing and network; they
  are not a server-internal compute profile. Their union avoids double counting.
- Native polling is one-second `chat_get_conversation` IPC through WebDriver;
  durations include bridge transport and serialization. Polls overlap inference
  and are not added to the provider partition. Terminal observation includes up
  to one polling interval. This does not profile composer rendering/frame costs.
- Original 300-second test request deadline retained. External harness bounds are
  eight model calls, twelve executable tools and 50,000 reported tokens per answer;
  neither answer reached them. Cancellation preserves partial diagnostics.
- This small, warm-server sample does not measure long-note/history scaling,
  cold model loading, competing inference, semantic retrieval, or tail latency.
  The old repeated revision-header scan remains a profiling candidate, not a
  demonstrated cause. No real notes, saved app preferences or API credentials
  were changed. No paid provider was used.

## Reproduce

Start the same model server and select an unused loopback port. Build separately
before measuring, then start the metadata-only proxy:

```sh
node e2e/support/buildNative.mjs
python3 -B e2e/support/latency/proxy.py \
  --upstream http://100.117.20.29:1234 --port 1236 \
  --output .scratch/chat-reliability/artifacts/latency-2026-10-14/transport.jsonl
```

Use a **fresh artifact directory** for each new run; the proxy appends records.
In another terminal, run only the opt-in probe:

```sh
GNEAUX_LATENCY_NATIVE=1 \
GNEAUX_LIVE_ENDPOINT=http://127.0.0.1:1236/v1 \
GNEAUX_LIVE_MODEL=qwen3.8-27b-gsq-rco \
GNEAUX_LIVE_OUTPUT="$PWD/.scratch/chat-reliability/artifacts/latency-2026-10-14/native.json" \
pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/request-latency.spec.ts
```

Stop the proxy after the run. Replay analysis without inference:

```sh
python3 -B e2e/support/latency/analyze.py \
  --native .scratch/chat-reliability/artifacts/latency-2026-10-14/native.json \
  --transport .scratch/chat-reliability/artifacts/latency-2026-10-14/transport.jsonl \
  --output .scratch/chat-reliability/artifacts/latency-2026-10-14/summary.json
```

Raw synthetic results, server metadata, transport metadata and build/run logs
are retained locally in `../artifacts/latency-2026-10-14/`. The provenance record
pins source, native binary and model metadata hashes, including unrelated
in-progress Atlas changes in the build. Native probe: 1 passing spec, all three
requests complete. E2E TypeScript checks and `git diff --check` pass. The harness
printed an external-driver diagnostic despite using its working embedded driver,
and a mock-store cleanup warning after session termination; neither interrupted
the measured requests. The timing proxy was stopped after capture.
