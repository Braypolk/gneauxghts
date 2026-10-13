# Compatible chat system-message regression

October 13, 2026. Follow-up to the [tool-schema correction](lm-studio-tool-schema-regression/validation.md).

The schema correction exposed a second request-compatibility failure. The app
assembles active-note context, compaction summaries, and freshly resolved note
references as separate system messages. Rig adds the agent preamble and result
formatter instructions ahead of that history. Qwen's template rejects every
system message except the first, including an additional adjacent system turn.

The production runtime dispatch now combines system contents, in their original
order and without clipping, into one opening system message for the Local
(OpenAI-compatible chat) provider. Dialogue and tool-result order remain intact.
This runs after formatter augmentation and before usage-context admission and
measurement on every completion attempt. Persisted history is unchanged.

The regression fixture uses a temporary real vault and the real chat context
assembler, with an active note, compacted dialogue and a stored editing answer
that supplies fresh note references. The production streaming runtime executes
`read_notes`, retries an unstructured answer, and finishes through `final_result`.
Captured requests are replayed through the Chat Completions serializer. Assertions
cover a single opening system message, all original context, formatter
instructions, ordered dialogue content, and tool-call/result pairing.

Before correction, the regression failed because app context was outside the
opening system message. The full live runtime fixture reproduced the user's
exact HTTP 500 `System message must be at the beginning` exception on GSQ-RCO.
After correction the focused regression and the live GSQ-RCO run pass. The live
check requires an executed synthetic read and a subsequent structured response;
it sends only fixture content and never alters real notes.

Reproduce the explicit live check with a loaded model:

```sh
GNEAUX_LIVE_ENDPOINT=http://YOUR_SERVER:1234/v1 \
GNEAUX_LIVE_MODEL=YOUR_MODEL_ID \
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  live_compatible_chat_runs_structured_followup_with_app_context -- --ignored --nocapture
```

Verification:

- The focused context/serialization regression passes, including the real read
  tool continuation and formatter retry.
- The full live fixture passes on `qwen3.8-27b-gsq-rco` IQ3_S and
  `qwen/qwen3.8-27b` Q4_K_M. Each run executes exactly one synthetic read, makes
  at least two model calls and returns the expected structured result.
- Regular Qwen's initial 8,192-token diagnostic load reached the existing
  context guard after its read; the full flow passes with 32,768 loaded tokens.
  GSQ was restored after both attempts, with all reported configuration fields
  matching the immediately preceding snapshot.
- All 21 architecture fitness checks pass. Targeted Rust formatting and
  `git diff --check` pass.
- The normal debug native binary rebuilt successfully with
  `cargo build --manifest-path src-tauri/Cargo.toml --bin gneauxghts`.
- Full serialized Rust library run: 872 passed, 1 failed, 29 ignored.
  `semantic::indexer::tests::paused_wakes_release_coalescing_and_one_resume_drains_pending_work`
  failed its job-count equality (5 versus 4); its isolated rerun passed. No
  indexing code was changed for this correction. This was not a clean full-suite
  run, despite all affected runtime/chat/tool checks passing.

The tests exercise real context assembly, provider construction, streaming,
tool execution and structured completion. They do not operate the user's native
chat UI or modify the installed application bundle.
