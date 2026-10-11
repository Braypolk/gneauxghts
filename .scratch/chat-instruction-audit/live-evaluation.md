# OpenAI chat behavior evaluation

October 9, 2026. Model: `gpt-6-luna`, Responses API, provider-default reasoning,
Standard processing, web off. The saved Gneauxghts Keychain credential was read
into process memory; no credential values entered logs or reports. All notes,
search indexes and pending proposals belonged to disposable test vaults.

All six final smoke cases passed. Manual inspection confirmed that note answers
used the intended source, deadline output included only the unchecked task due
on the reference's local day, and the owner proposal changed only Priya to Anika.
Every fixture's canonical note bytes stayed unchanged. The excluded-note canary
was absent from delivered sources and answers. This is a narrow smoke result,
not a general model reliability score or a full UI acceptance test.

## Results

| Case | Result | Model calls | Tool calls | Input tokens | Cached input subset | Output tokens | Runtime |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| greeting | Pass | 1 | 0 | 3,027 | 0 | 44 | 1.46s |
| selection | Pass | 3 | 2 | 10,320 | 8,931 | 173 | 4.10s |
| different_note | Pass | 3 | 2 | 10,786 | 9,294 | 126 | 3.82s |
| followup | Pass | 3 | 3 | 12,099 | 9,957 | 190 | 6.00s |
| deadlines | Pass | 3 | 2 | 11,116 | 9,289 | 144 | 4.52s |
| reviewed_edit | Pass | 3 | 2 | 9,608 | 8,957 | 145 | 3.84s |

Input/output counts aggregate all calls in that case. Cached tokens are a subset
of input, not additional tokens. Output includes reported reasoning tokens.
Runtime excludes fixture setup and Keychain access.

Raw final answers, usage, tool activity, sources, pending proposal and assertions:
[live-behavior.json](live-behavior.json).

The greeting made no tools calls. Selection resolved to basil without a note-choice
question. Named-note lookup found SABLE-472 in Meridian launch while Garden plan
was open, using one search and one read. The follow-up resolved the retained user
request and retrieved current Priya evidence. The deadline answer excluded both
the completed task and tomorrow's task. The reviewed edit changed only the owner
in the staged preview and required Keep before publication.

## Search retry bug found and fixed

The initial different-note test failed: three searches received “Continue with
cursor only” feedback and the next repeated call hit the guard. Its last reported
aggregate was 12,915 input and 388 output tokens; failure does not mean zero usage.
The fixed-code rerun succeeded with one search and one read. These are individual
runs with different cache state, so they do not establish a universal cost delta.

The smallest controlled API comparison isolated the schema problem. With the
function's strict flag omitted, the provider returned `cursor: ""` for a new
search; with explicit `strict: false`, cursor was absent. See the synthetic
[two-request probe](live-strict-probe.json). The API documents that an omitted
strict flag can activate schema normalization: [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
Rig 0.41 stores false but omits it during serialization, so a Rust boolean check
alone missed the wire behavior.

The private `agent_runtime/openai_model.rs` adapter now sends explicit false for
registered function tools using Rig's public flattened configuration. Each call
clones the provider model before attaching the current tools; schemas, hosted web
tools, parameters and backend cursor/scope validation retain their existing
contracts. Parent and research execution both use this production provider path.
No dependency fork, prompt expansion or relaxed cursor validation was needed.

The real serializer/recording-transport regression failed with the missing flag,
then passed with the correction. It also verifies schema preservation, hosted web
retention and no accumulation over consecutive requests. Independent Standards
and Spec reviews found no adapter, credential-handling or spending-bound defect.
Their harness findings were fixed: reject unknown case filters and empty answers,
and reject completed/tomorrow distractors in the deadline result.

## Cost and remaining efficiency work

Estimated Standard API cost of the final six cases is **$0.00192808**. Including
the original greeting/selection, failed search and both small schema probes,
all live requests in this work total approximately **$0.00287422** (25 requests).
This uses provider-reported input, cached-input and output counts, with zero
reported cache writes, and the current [published model prices](https://developers.openai.com/api/docs/models/gpt-6-luna):
$0.10/M uncached input, $0.01/M cached input and $0.50/M output. This is an
estimate from usage, not a billing-dashboard receipt.

Even a greeting starts at 3,027 input tokens with the full tool catalog and run
reference. The previous offline complete-request measurement established a 36.9%
byte reduction, not a measured pre/post billed-token reduction. Further reduction
should focus on tool-definition overhead and demonstrated redundant retrieval.
The final selection run fetched `get_active_note` before `read_evidence`, although
the supplied hint already identified the note and selection. The follow-up issued
both a launch-code and owner search in its first step; only ownership was asked.
Both answered correctly, but they leave concrete efficiency opportunities. No
extra prompt tuning or further paid rounds were performed.

## Verification and boundaries

- Affected `agent_` tests: 65 passed, three ignored, one existing localhost fixture
  denied socket access by the sandbox. That fixture passed on an isolated rerun
  with socket permission, establishing all 66 nonignored affected cases.
- Backend architecture checks: 21 passed.
- Rust formatting and diff whitespace checks passed.
- Six final live smoke cases passed. The paid harness is ignored by default and
  additionally requires an explicit opt-in environment variable and report path.

The harness uses the real production streaming runner, current assistant preamble,
registered vault tools, evidence/citation validation and pending proposal store.
Its provider model uses the same new compatibility adapter as production. It
limits each case to six provider calls, 1,024 output tokens per call, a 64,000-byte
serialized-request bound, eight tool calls and a 60-second runtime. The aggregate
40,000-token guard uses reported usage and may overshoot by one request. These
are execution limits, not a billing-service dollar cap.

Native UI, durable ChatService request admission, actual inter-turn note mutation,
configured research workers, web behavior, the rest of the eleven-case rubric and
a paired old-prompt live baseline remain outside this evaluation. The follow-up
case tests retained user context plus fresh retrieval; it does not prove recovery
after a real intervening note edit. No general latency/cost/quality improvement
claim follows from these six samples.

## Reproduce

Only run this when paid OpenAI testing is authorized and the Gneauxghts credential
is saved in macOS Keychain. No key is passed on the command line.

```sh
GNEAUX_OPENAI_BEHAVIOR_EVAL=1 \
GNEAUX_OPENAI_BEHAVIOR_OUTPUT=/absolute/path/to/report.json \
cargo test --manifest-path src-tauri/Cargo.toml --lib openai_synthetic_chat_behavior -- --ignored --nocapture
```

Optional `GNEAUX_OPENAI_BEHAVIOR_CASE` selects one of the six case names in the
table. A network/Keychain-capable execution environment is required. This uses
`gpt-6-luna` explicitly and does not change the user's app settings.
