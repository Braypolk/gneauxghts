# Pi ChatGPT subscription sign-in — 2026-10-18

Desktop Settings now offers Continue with ChatGPT, cancel, explicit selection
between subscription and API key, and disconnect. Existing API keys stay in their
separate OS-keyring account. Subscription failures never select API-key billing.
The regular app and disposable E2E app use separate keyring services; acceptance
sign-in does not connect the regular app automatically.

Pi 1.3.0's public built-in OpenAI OAuth implementation owns browser login and
refresh. A bundled Node helper runs outside the WebView, with private stdio and
native cancellation/deadlines. Native `chatgpt_auth.rs` owns keyring credentials,
serialized refresh/token rotation and device-local method/identity preferences.
Only connection status, the selected method and model metadata cross frontend
IPC. Installed desktop users do not need a separate JavaScript runtime. Mobile
retains its API-key route; subscription sign-in is desktop-only.

Inference uses the public Responses endpoint and the account-specific visible
model catalog. Pi continues to own schemas, serialization, event parsing and
completion validation; native transport enforces endpoint/credential ownership,
authority and the supported subscription request envelope. Note permissions,
review, publication and fresh canonical citations use the existing native owners.

## Integration corrections

- Subscription function tools must use a supported namespace. `notes` is
  reserved by the endpoint; the four application tools use `gneauxghts_notes`.
  Continued function calls retain that namespace in subscription mode, and the
  native boundary removes it when explicitly switching to ordinary API-key mode.
- Actual subscription responses returned HTTP 200 and SSE beginning with `event:`,
  but omitted Content-Type. The former native MIME gate rejected them before Pi
  could parse the events. The transport now forwards the stream and actual header
  metadata to Pi, whose parser still requires valid protocol completion. No
  application response parser or fabricated completion was added.
- The opt-in human test starts OAuth once rather than replaying an IPC call after
  a short WebDriver timeout. It keeps the app alive during later macOS Keychain
  approval; actual HTTP/inference and tool-flow deadlines remain bounded.

A deterministic HTTP fixture reproduces the missing-header failure through real
native transport. It fails on the previous executable (`error` rather than
`stop`) and passes after removing the MIME gate. The actual Pi Responses parser
also passes both present/absent Content-Type variants. Temporary native diagnostics
and diagnostic-only specs were removed.

## Verification

All live journeys use the shared `e2e/support/piToolAcceptance.ts` prompts and
assertions in generated disposable vaults, with real Pi tasks, native authority,
review, canonical publication and citation navigation. The subscription run
asserts that its selected auth method stays `chatgpt` after every flow.

| Actual model and billing method | Reviewed walk edit | Four-page pagination/read | Reviewed root creation | Tool errors |
| --- | --- | --- | --- | --- |
| GPT-6 Luna, ChatGPT subscription | Pass | Pass | Pass | 0 |
| GPT-6 Luna, OpenAI API key | Pass | Pass | Pass | 0 |
| Qwen `qwen3.8-27b-gsq-rco`, local | Pass | Pass | Pass | 0 |

All nine journeys passed on the same pinned native executable and current
frontend with zero tool errors. The API-key regression used the existing saved
key through a private pipe/process environment, without changing its keyring
record or copying it into fixture storage.

The edit leaves 30 minutes on disk until review approval, then publishes 45 while
preserving the unrelated water reminder; the returned citation opens that note.
Pagination explicitly starts with the empty cursor, follows three exact native
continuation tokens, terminates at null, and reads/reports all four beacon codes.
Creation publishes exactly once after full-content review and returns a canonical
read matching saved bytes with a fresh citation. The subscription transcript has
three search/read/edit calls, four paginated searches plus four reads, and one
successful creation. Its elapsed test time includes a human Keychain wait and is
not a performance measurement.

The source test suite passes 34 support tests and 1,310 frontend tests across 152
files. Native checks pass 643 library tests (19 opt-in tests ignored), seven
focused transport tests and all 19 architecture checks. Type checking and the
production frontend build pass. Repository-wide `cargo fmt --check` still flags
pre-existing formatting in the unmodified `src-tauri/tests/architecture_fitness.rs`.
Eleven Settings browser journeys passed,
including connection, explicit auth switching, disconnect and retaining API-key
controls. The production Pi refresh helper is tested against controlled token
responses for issued client ID, rotation, subscription permission and redaction.

This is bounded macOS desktop acceptance. Windows/Linux packaging, release
notarization, physical iOS and a real account's future token expiration are not
established by these checks; the real refresh implementation has controlled HTTP
coverage. OAuth credentials are isolated from the normal app's account, vault
and Pi history. Sanitized fixture reports and run logs are retained locally in
`/private/tmp/pi-subscription-acceptance/`.

Reproduce after `node e2e/support/buildNative.mjs` with
`GNEAUX_PI_SUBSCRIPTION_ACCEPTANCE=1 node e2e/support/nativeSuite.mjs subscription`.
Finish browser consent on first use and allow the isolated app's macOS Keychain
access if prompted. Set `GNEAUX_PI_ACCEPTANCE_OUTPUT` to an existing directory
for sanitized journey reports. See [E2E instructions](../../e2e/README.md).

Official contract: [Sign in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
and [error recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
