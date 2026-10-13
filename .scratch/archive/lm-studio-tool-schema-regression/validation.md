# LM Studio tool-schema A/B test

Tested against the app's configured LM Studio server on October 12, 2026.
Only synthetic content was sent. No tools were executed, vault content sent,
or application source modified.

## Result

| Model | Root `properties` absent | Root `properties` present |
| --- | --- | --- |
| `qwen3.8-27b-gsq-rco` (GGUF IQ3_S) | HTTP 400: required `function.parameters.properties` | HTTP 200 |
| `qwen/qwen3.8-27b` (GGUF Q4_K_M) | HTTP 400: same validation error | HTTP 200 |

The request bodies were identical except for the model ID and the addition of
root-level argument properties. Both retained the same two `oneOf` branches.
Each used `reasoning_effort: medium`, `max_tokens: 16`, `stream: false`, and
one synthetic tool named `schema_probe`. The prompt was "Reply OK. Do not call
any tools." HTTP 200 establishes request acceptance and generation; it does
not establish successful tool execution or full production agent behavior.

## Interpretation

The missing root-level properties reproduce the reported failure on both models
in the current server environment. Adding the argument properties at the root
removes that rejection on both, without removing the branch schemas.
The test does not reproduce a model-specific difference, nor explain the
previous successful regular-Qwen app run. Comparing actual app wire requests
and server state would be needed to explain that history.

The current production definitions in
`src-tauri/src/agent_tools/interface.rs` for `read_notes` and
`propose_note_change` put their properties inside `oneOf` and omit root
`properties`. No correction has been applied in this diagnostic task.

## Server lifecycle

The initial attempt to test regular Qwen failed to load the model and was
excluded from the comparison above. After the models were unloaded, regular
Qwen was explicitly loaded with a 2,048-token context and tested successfully.
GSQ was tested with its original 129,280-token loaded context. Context length
was not held constant between models; the within-model schema comparison
held all load configuration constant.

Afterward regular Qwen was unloaded and GSQ reloaded. All 14 configuration
fields reported for the original GSQ instance matched the final reported
configuration, including context length, batch settings, Flash Attention,
KV cache offload, and MTP settings. Other models remained unloaded.

The `evidence/` directory contains all four synthetic request/response pairs
and a compact `results.json` file.

## Correction and regression coverage

The old-version explanation was confirmed by the user: regular Qwen also
failed in the current app. The app-owned combined tool schemas now publish
root-level argument properties and the required discriminator, while retaining
the same closed `oneOf` branches. Shared arguments use the union of their branch
schemas, so create still permits empty Markdown and replace still requires
a nonempty body. Read schemas derive both root arguments and allowed purposes
from granted capabilities; evidence-only workers expose no editing arguments.
No tool handlers, proposal approval rules, provider settings, or durable
protocols changed.

The new serialized-request regression failed before the fix on `read_notes`'
missing root properties and passed afterward. It exercises the real runtime
registry, Chat Completions and Responses serialization, and parent, evidence-only
and working-note-only capability sets. Existing read/proposal behavior tests pass.
An explicitly invoked live test sends the entire production tool registry
through the Rust streaming client, without executing tools or sending real
vault content. It passed on both GSQ-RCO IQ3_S and regular Qwen Q4_K_M.
The regular-model test initially exceeded the diagnostic 2,048-token context
(the full registry request was 2,256 tokens); it passed after loading a
4,096-token test context. GSQ was restored and every reported configuration
field matched the pre-test snapshot.

An independent JSON Schema validator checked 20 valid and invalid argument
examples against both the corrected schemas and their original branch-only
forms (40 validations), all passing. The examples cover all read selectors,
read-purpose isolation, bounds, all three proposal operations, empty creation
versus nonempty replacement, hashes and cross-operation argument rejection.

The fixture-only live check is reproducible with:

```sh
GNEAUX_LIVE_ENDPOINT=http://YOUR_SERVER:1234/v1 \
GNEAUX_LIVE_MODEL=YOUR_MODEL_ID \
cargo test --manifest-path src-tauri/Cargo.toml \
  live_compatible_chat_accepts_registered_tool_schemas --lib -- --ignored --nocapture
```

The target model must already have enough loaded context for the full registry.
`GNEAUX_SCHEMA_OUTPUT` optionally exports registered definitions for inspection.
Live success here establishes schema acceptance and streaming decoding, not
a semantic evaluation of model answers or actual note-changing tool execution.

Formatting and whitespace checks passed. All 21 architecture fitness tests passed.
The final full Rust library suite passed with local-listener access and serialized
execution: **872 passed, 0 failed, 28 ignored** (101.84 seconds). The initial
parallel sandbox run had a denied local listener and one cancellation assertion;
both passed individually, followed by the clean full serialized run. No unrelated
code was changed to suppress those failures.

`cargo build --manifest-path src-tauri/Cargo.toml --bin gneauxghts` also passed,
producing the corrected native debug executable. The running app was not
restarted or an installed app bundle replaced.
