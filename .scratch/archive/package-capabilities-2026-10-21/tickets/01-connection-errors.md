# Curated provider connection errors

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: task
Dependencies: none

## Outcome

An explicit model-list check in Settings or an inference request explains whether a hostname could not be resolved, the request timed out, or the connection could not be established. Messages contain a useful next action without returning an endpoint, credential, prompt, raw native error, or provider response body. Existing credential/HTTP handling, Pi recovery, cancellation and shutdown continue through their current owners.

This is a bounded transport/presentation change. It does not introduce retries, change deadlines, add network activity on Settings mount, change metadata availability policy, or introduce a second provider/task owner.

## Current implementation and evidence

- [`pi_chat/transport.rs`](../../../../src-tauri/src/pi_chat/transport.rs), `dispatch`: `.send().await` discards every reqwest error and returns the same `DomainError { code: "connection", message: "Native provider connection failed" }`. Successful streaming and HTTP rejection are separate paths. `provider_http_failure` already curates auth, capacity, quota and transient failures without forwarding server text.
- The same file's `fetch` admits the native authority lease, registers a cancellation token, races dispatch against cancellation, and removes the request before notifying the settled-request drain. `NativeTransport::quiesce_for_restart` closes admission, cancels work and waits for settlement. Those are lifetime owners; a classifier must not replace them.
- [`nativeProvider.ts`](../../../../src/lib/features/chat/pi/nativeProvider.ts), `nativeFailures`/`safeFailure`/`nativeFetch`: allowlists native error codes before exposing error text to Pi. Changing Rust alone would hit the unknown-code fallback. The safe string also participates in Pi's retry classification. `createNativeModels` uses this transport for ordinary generation and compaction.
- [`diagnostics.ts`](../../../../src/lib/features/chat/pi/diagnostics.ts), `nativeCodes`/`catalog`: only the existing connection code maps to the bounded ephemeral provider notice; new codes need matching allowlisted categories. This sink reports problems and must not settle tasks or own recovery.
- [`pi_chat_commands.rs`](../../../../src-tauri/src/commands/pi_chat_commands.rs), `chat_list_local_models` and `chat_list_openai_models`: explicit Settings discovery uses separate reqwest clients, with five- and ten-second total timeouts. They currently interpolate reqwest `Display` errors in client-build, send and JSON-read failure strings. These can expose configured URLs. Command return types are `Result<Vec<LocalModel>, String>`.
- [`LocalModelSettings.svelte`](../../../../src/lib/features/settings/LocalModelSettings.svelte), `refreshModels`: shows rejected string/Error messages and retains manual/saved model use. [`ChatGptSettings.svelte`](../../../../src/lib/features/settings/ChatGptSettings.svelte), `discover`/`run`: explicitly checks models and refreshes native auth state afterward. Opening these views is deliberately passive.
- Installed published `reqwest-0.13.5/src/error.rs` verifies that `is_timeout()` traverses timeout sources, `is_connect()` recognizes broad connection errors, and new `is_dns()` recognizes its wrapped DNS error source. DNS can also satisfy the broad connect predicate. Use these predicates, not substring matching or raw `Display` text. Source: [reqwest 0.13.5 Error API](https://docs.rs/reqwest/0.13.5/reqwest/struct.Error.html), and the installed Cargo registry source for the locked version.

## Minimal design

Add one small private module under `provider_config`, for example `connection_failure.rs`. Its closed native enum and `from_reqwest(&reqwest::Error)` classify request-send failures and provide curated fixed messages. It must not accept arbitrary messages, expose a URL/source chain, serialize reqwest errors, or contain Tauri/application state. Share this classifier between inference and explicit model discovery; keep each caller's existing public error type and HTTP policy.

Apply predicates in this order:

| Order | Condition | Native inference code | Meaning and fixed message |
| --- | --- | --- | --- |
| Before classification | Existing cancellation/closing/authority rejection | Existing codes | Preserve existing control flow and messages. Cancellation is not inferred from reqwest. |
| 1 | `error.is_timeout()` | `connection_timeout` | “The model request timed out. Check the server and try again.” A timed-out DNS/connect attempt is still a timeout. |
| 2 | `error.is_dns()` | `connection_dns` | “The model server hostname could not be resolved. Check the server address and network connection.” Do not claim the device is offline. |
| 3 | `error.is_connect()` | Existing `connection` | “The model server could not be reached. Check its address and connection.” This may include TLS/proxy/connect failures; do not claim it proves a refused port or stopped server. |
| 4 | Other request-send error | Existing `connection` | “The model connection failed. Check the server connection and try again.” Preserve a safe fallback rather than inventing a cause. |

Inference retains its existing 15-second connect deadline, no new total generation deadline, nonredirecting policy and current `stream` failure behavior. Classify only the send failure in this ticket; do not turn a mid-stream disconnect into a pre-request failure or promise to resume partially received output. Settings retains its existing total deadlines, routes, catalog filtering, credential handling and HTTP-status behavior. Curate client-build/JSON-read errors to fixed messages too; expose at most a numeric HTTP status where current discovery requires it, never the server's reason phrase or body. Existing ChatGPT 401 recovery still confirms terminal revocation natively; DNS/timeout must never disconnect saved credentials.

Keep the Settings commands' `String` error contracts and `LocalModel[]` success shape. They can return the classifier's safe message directly. There is no need to migrate every Settings/native command to `DomainError` or teach generic `invoke` a new error protocol. Native inference continues using the established `{ code, message }` domain error.

In `nativeProvider.ts`, add an allowlisted message for each new native code with the existing `network error:` prefix, followed by the fixed actionable wording. Preserve the current `connection`/`stream` safe mappings. Assert against Pi's public `isRetryableAssistantError` that the new connection categories have the same retry eligibility as the old generic connection failure; do not alter Pi's retry budget/backoff or add a retry loop. In `diagnostics.ts`, give DNS and timeout their own fixed provider warning categories/messages, preserving coalescing, the 12-notice bound, descriptor-only error-code reads and disposal behavior. Do not use arbitrary error text for diagnostics.

If a local discovery request finishes after the editable endpoint changed, suppress its success/error/status adoption. Capture the requested endpoint and a request generation, and retire it on component disposal. Apply the existing endpoint-change check consistently to discovery, not only `loadCapabilities`. This guards against reporting a previous endpoint's failure beside new input; it is not a new persisted settings owner. Do not automatically request the newly typed endpoint.

## Optional metadata contract: deliberately unchanged

[`provider_config/model_metadata.rs`](../../../../src-tauri/src/provider_config/model_metadata.rs), `ModelMetadataClient::fetch`, returns `Option<Value>` for a bounded, nonredirecting `/api/v1/models` request. Invalid input, client construction, HTTP failure, oversized/invalid JSON and network failure all become `None`. Its two current consumers are optional reasoning discovery and post-inference capacity observation; the latter preserves last-observed loaded capacity per server/model when metadata disappears. Some compatible servers support `/v1/models` but do not expose the LM Studio metadata route.

The minimal useful Settings explanation comes from existing explicit model-list commands, not from changing `fetch` to fail every consumer. Keep `Option`, the two-second/256,000-byte bound, reasoning fallback and last-known capacity behavior. Do not make successful inference or a manually configured model fail merely because optional metadata is missing. A future dedicated metadata diagnostic requires a separate result-returning method and explicit caller; this ticket does not add that unused seam or change every caller.

## Implementation steps

1. Add the private classifier and focused native tests using actual reqwest errors from controlled fixtures. Add the module declaration in `provider_config.rs`.
2. Use it at the inference send boundary and Settings model-list send boundaries. Replace raw client/decode-error interpolation only at those two explicit discovery commands; retain their public return types and native credential/HTTP recovery paths.
3. Add frontend allowlisted inference strings and bounded DNS/timeout diagnostic categories. Verify Pi's public recovery classifiers continue recognizing network failures.
4. Add endpoint/request-lifetime guarding in local discovery and focused component coverage. Do not change saved-model/manual-entry behavior or unlock credentials on inspection.
5. Extend existing browser Settings regression coverage and add a native local-fixture connection smoke case. Follow [`ui-verification.md`](../../../../docs/agents/ui-verification.md) for session evidence, replay and cleanup. Verify ordinary generation plus compaction/native cancellation contracts remain intact; no live account or paid inference is required.

## Acceptance and verification

- Native classifier tests exercise actual reqwest errors: a custom `reqwest::dns::Resolve` that deterministically fails for a test-only hostname (disable proxies on that test client), a temporarily bound-and-closed loopback listener, and a loopback listener that accepts a request but delays headers beyond a short **test-only** client deadline. Do not depend on public DNS, external network access, unused fixed ports or production timeout reductions. Assert exact codes and safe messages; include a DNS/connect overlap and timeout/connect overlap precedence assertion.
- Local HTTP fixtures cover 401, quota/rate limit, 5xx, malformed JSON and a successful empty catalog. They verify that numeric status/auth behavior stays distinct from transport failure, saved credentials are retained on transient failure, and response-body/URL/credential canaries never appear in errors or logs. Do not broaden this ticket into a new HTTP model-discovery policy.
- Frontend unit tests reject native fetch with both new codes before headers and verify the final Pi message is useful, allowlisted and classified as retryable exactly as the existing connection message. Unknown code/message and secret-bearing `message`, `stack`, `cause`, endpoint and payload properties remain redacted. Existing abort tests still produce `stopReason: 'aborted'` without successful terminal admission; ordinary and compaction paths retain their shared provider wrapper.
- Diagnostic tests assert the new codes map to their fixed warnings, hostile getters are not evaluated, repeated failures coalesce and the sink neither changes runtime state nor persists notices. Existing authority/citation/capacity/credential behavior remains unchanged.
- Local Settings component/browser tests show curated DNS/timeout/connect messages after **Refresh**, then allow manual selection and a later successful refresh. Changing endpoint or unmounting before a delayed old result settles cannot show old models/errors/status; reopening Settings makes no credential-backed model request. ChatGPT Check connection still refreshes safe auth state and does not offer reconnection for transient network failure.
- Native desktop acceptance with a disposable vault and loopback fixture verifies a refused connection and delayed model-list timeout through real IPC/Settings presentation, plus cancellation of an in-flight generation and subsequent successful fixture request. Use a real native failure for this acceptance; browser mocks alone do not establish reqwest/IPC behavior. Deterministic DNS is proven in Rust via the injected resolver rather than depending on the OS resolver in UI tests. Existing restart settlement coverage must continue passing; do not foreground the native app unless required by the established test policy.
- Run focused Rust classifier/discovery/transport tests; focused Vitest native-provider/diagnostic/Settings tests; `pnpm check`; affected Settings browser replay; applicable native fixture acceptance. Run the existing architecture contract check for the provider seam if implementation touches that contract. Record actual evidence and any unavailable native coverage; do not call a mocked browser failure a native transport check.

## Ownership and parallel work

Own `src-tauri/src/provider_config/connection_failure.rs` (new), its module declaration, send-error call sites in `src-tauri/src/pi_chat/transport.rs` and `src-tauri/src/commands/pi_chat_commands.rs`; `src/lib/features/chat/pi/{nativeProvider,diagnostics}.{ts,test.ts}`; local-discovery lifetime/message tests and `LocalModelSettings.svelte`; affected cases in `e2e/specs/browser/settings.spec.ts`; a narrowly scoped native connection acceptance fixture/spec if needed. Do not modify optional metadata/result shapes, database/schema, Pi runtime lifecycle or shared test-launch configuration without coordinating.

This can run alongside [02 benchmarks](02-benchmark-comparisons.md), [03 inspector](03-component-inspector.md), [04 render errors](04-render-error-recovery.md), [05 images](../../../package-capabilities/issues/05-native-image-delivery.md) and [06 search](06-query-centered-excerpts.md): production files do not overlap. Coordinate additions to shared `package.json`, WDIO/native fixture infrastructure, browser backend and the final integrated test run. Issue 04 must keep route-render diagnostics separate from the Pi provider catalog; issue 05 must not reuse this classifier for filesystem/image errors. Any cross-cutting additions beyond this ownership list should be agreed before edits.

## References and constraints

- [Capability investigation](../../../../docs/research/upgraded-package-capabilities-2026-10-21.md#1-better-connection-errors-high-value-small-to-medium-effort).
- [Architecture: agent runtime](../../../../ARCHITECTURE.md#agent-runtime) and [behavior invariants](../../../../docs/architecture/behavior-invariants.md), particularly retained local capacity, restart settlement and passive Settings inspection.
- [ADR 0012](../../../../docs/adr/0012-found-ordinary-chat-on-pi.md): Pi owns task/recovery progression; native owns routing, credentials, authority and external-effect proof. No replacement retry scheduler, task abort guard or parallel provider owner belongs in this change.

## Comments

Planning only. No application implementation or acceptance run was performed while writing this ticket.

### Implementation — 2026-10-21

Added the closed `ConnectionFailure` classifier under `provider_config`, shared by inference send failures and the two explicit model-list commands. Timeout precedes DNS, DNS precedes broad connect failures, and every branch has fixed copy. Model discovery now curates client/decode failures and returns numeric HTTP statuses. The optional metadata client, production deadlines, HTTP/auth recovery, cancellation and restart ownership are unchanged.

The frontend recognizes DNS/timeout native codes with Pi's existing network-error retry classification and separate bounded diagnostic notices. Native provider redaction now reads own string descriptors instead of arbitrary getters/coercion and rejects prototype-property names as unknown codes. Local discovery captures endpoint/request generations, retires them on endpoint changes/disposal, and drops stale models, errors and completion status. Endpoint edits remain passive.

Validation completed so far:

- Focused native-provider and diagnostic Vitest suites: **36 passed**, including new pre-header failures, Pi retry eligibility, redaction, hostile properties and coalescing.
- `pnpm check:e2e`: passed for the added browser/native specs.
- Settings browser spec on isolated loopback port 1449: **17 passed**, including curated DNS/timeout/connect presentation, manual setup/recovery, stale success/error after endpoint changes, disposal and passive reopening. The owned fixture/browser cleaned up normally.
- Five Rust classifier tests compile and exercise real reqwest errors. Initial restricted run passed DNS/connect overlap, connect-timeout precedence and fallback; loopback refusal/delayed-header cases were blocked by sandbox socket permissions. The approved unrestricted rerun then **passed all five tests** after the shared Cargo artifact lock cleared.

Added `e2e/specs/native/piConnectionErrors.spec.ts` for the coordinated final native run. It uses its own disposable loopback fixture to exercise real IPC/Settings refused/timeout/recovery, numeric 401/429/503, malformed/empty catalogs, passive Settings, and actual in-flight generation cancellation followed by success. Native runtime acceptance and final integrated checks remain the root agent's scheduled work; no browser mock is recorded as native transport evidence. No live account credential or paid model request is used.

### Native acceptance follow-up

The first coordinated native run passed the real Settings refusal/timeout/recovery and generation cancellation/success cases. The catalog-status assertion failed because the shared `invokeNative` helper returned `{ error: ... }`, which the embedded driver interpreted as a WebDriver error envelope. The spec now catches rejected IPC inside `browser.execute` and returns a separate tagged `{ outcome, reason }` result, preserving exact safe-backend-message assertions without protocol error wrapping or retries. This is a test-only correction; the fresh rerun passed all three real-native cases. The spec was added to background smoke; full combined smoke results are tracked in the outcome record.

### Cohesion audit correction

The audit found that `loadCapabilities` could reject an obsolete successful
request after disposal, and `openEditor` still forwarded that error to the
retained Settings parent. The editor's success/error continuations now require
the same mounted lifetime and captured endpoint generation. Two maintained
browser regressions switch from local to OpenAI through the keyboard while
capability IPC is held, then settle success or failure and assert no stale alert.
Both regressions fail without the correction; the corrected full Settings spec
passes all 19 cases. The combined outcome records the follow-up checks.
