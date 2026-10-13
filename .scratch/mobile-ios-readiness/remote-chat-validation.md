# iOS remote chat simulator validation

2026-10-11. Compatible-server chat is enabled on iOS using the same app-owned AgentRuntime and ChatService as desktop. OpenAI continues to use the Responses API. Chat inference and weights are not installed on the phone; semantic embeddings remain on-device.

## Build and test boundary

- Xcode 26.4.1 (17E202), iPhone 17 Pro simulator, iOS 26.4.1 (23E254a). Disposable simulator: `Gneauxghts Semantic Test`, UDID `3E6C179B-10D5-4FA2-8773-207EB27951BF`.
- Normal icons, launch screen and bundled semantic framework; Rust debug build with opt-in `e2e-chat-fixture`. The fixture URL override exists only when both this feature and debug assertions are enabled. Ordinary and release builds use `https://api.openai.com/v1`.
- User explicitly chose a local OpenAI protocol fixture. Both providers used the loopback Python server below: compatible model `ios-fixture`, OpenAI model `gpt-5.4`. These are synthetic protocol responses, not model inference or live OpenAI acceptance.
- Synthetic notes and fake tokens only. The fixture logs request bodies but only a boolean for Authorization; the fake token does not appear in the request log. No desktop vault or real credentials were used.

## Observed results

Checks ran through the actual simulator WKWebView → Tauri IPC → native Rust runtime → HTTP fixture. Native commands were invoked in Safari Web Inspector. The composer/model-picker checks additionally exercised the mounted product controls through DOM events and inspected simulator screenshots; these do not establish physical touch/IME behavior.

| Check | Compatible server | OpenAI fixture |
| --- | --- | --- |
| Model discovery | Pass | Pass |
| Fragmented SSE function arguments → formatted answer | Pass | Pass |
| Visible composer Send and model selection → readable answer | Pass | Pass |
| Follow-up request retains earlier user history | Pass, verified request body | Pass, verified request body |
| `find_notes` → `read_notes` → issued evidence citation | Pass, one source | Pass, one source |
| Stage create proposal → explicit Keep | Committed | Committed |
| Stage create proposal → explicit Reject | Dismissed | Dismissed |
| Cancel open stream → retry original assistant message | Cancelled → complete | Cancelled → complete |
| HTTP 401 → explicit retry | Error → complete | Error → complete |
| Connection closed before headers | Explicit error | Explicit error |
| Kill process with stream open → relaunch → retry | Cancelled → complete | Cancelled → complete |

Proposal review/apply/reject was tested through native commands, not a complete visual review journey. Each proposal scenario made two HTTP calls (proposal tool, then structured answer); no duplicate proposal call occurred. Each interrupted scenario made one initial call and one explicit retry. Neither interruption scenario requested a mutation tool, so this is not proof of exactly-once recovery during an in-flight write.

The `new` composer slot retained `Synthetic retained mobile draft` across process termination/relaunch. Previously completed transcripts also survived relaunch. Native discovery rejected credentials in URLs and query strings before contacting the server. No fallback provider was used on errors. The visible error displayed Retry. The fixture emitted structured answer tool arguments in 12-character chunks; captured draft events and screenshots contained rendered prose rather than raw formatter JSON. Captured content lengths included 0, 12, 24, 28 and 33 characters, confirming incremental delivery.

Early console harness attempts accidentally evaluated IIFE prefixes during Safari autocomplete and repeated synthetic setup/read calls. Subsequent mutation, failure and lifecycle phases used separately defined async functions followed by a separate `void functionName()` command. Request counts above refer to those controlled phases; early duplicate reads are harness artifacts.

## Initial credential/signing limitation (resolved for simulator)

The [follow-up Keychain validation](keychain-validation.md) resolves this simulator blocker using Xcode’s normal signing path; both providers now pass save/read/replace/delete and relaunch checks without credential overrides. The following paragraph records the earlier failure.

The no-sign package, manually ad-hoc signed for simulator launch, cannot save a token through the existing Keychain store: `A required entitlement isn’t present`. Adding application/keychain entitlements to an ad-hoc signature caused AMFI to reject launch (`restricted entitlements`); an available Apple Development identity was also rejected because no matching provisioning profile was present. The runnable package was restored with its original empty entitlements. Production credential storage was not weakened or replaced.

Runtime checks used the existing debug-only `OPENAI_API_KEY` and `GNEAUXGHTS_LOCAL_API_KEY` overrides with a fake token. This validates authenticated protocol requests, not Keychain persistence. Repeat save/read/delete and relaunch in a correctly provisioned development/distribution build. Apple documents the entitlement error and automatic application identity requirements in [errSecMissingEntitlement](https://developer.apple.com/documentation/security/errsecmissingentitlement) and [Keychain access groups](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps).

## Reproduction

Start the retained fixture with a fresh log; restarting resets the first-attempt failure/hold counters:

```sh
python3 -B .scratch/mobile-ios-readiness/remote-chat-fixture.py --log /private/tmp/ios-chat-requests.jsonl
```

Build with the existing bundled semantic framework setup, adding `--features e2e-chat-fixture` to `pnpm tauri ios build --debug --target aarch64-sim --ci`. Retain Xcode’s simulator signature; do not use `--no-sign` for Keychain checks. Launch the disposable simulator app with these synthetic debug overrides:

```sh
SIMCTL_CHILD_GNEAUXGHTS_OPENAI_FIXTURE_URL=http://127.0.0.1:18440/v1 \
SIMCTL_CHILD_OPENAI_API_KEY=synthetic-fixture-token \
SIMCTL_CHILD_GNEAUXGHTS_LOCAL_API_KEY=synthetic-fixture-token \
xcrun simctl launch --terminate-running-process 3E6C179B-10D5-4FA2-8773-207EB27951BF com.braypolkinghorne.gneauxghts
```

Set the compatible endpoint to `http://127.0.0.1:18440/v1`. Use only synthetic data. Send `IOS_STREAM`, then `IOS_FOLLOWUP`; create a synthetic note containing MARIGOLD and send `IOS_READ`. Separate conversations can exercise `IOS_PROPOSE_KEEP`, `IOS_PROPOSE_REJECT`, `IOS_CANCEL`, `IOS_RETRY`, `IOS_DISCONNECT`, and `IOS_INTERRUPT`. Cancel/interrupt holds last 20 seconds on the first request per protocol; retry explicitly after cancelling/relaunching. The proposal fixture stages creates for product review and never applies them itself. There is no model reasoning or quality measurement.

## Remaining release gates

[Issue 08](issues/08-ios-device-release-gate.md) owns physical-device/distribution Keychain acceptance, physical iPhone local-network permission, HTTPS/authentication against intended servers, live OpenAI, physical network loss/timeout behavior, Wi-Fi/cellular transitions, background/lock/suspension, interruption around tool execution, physical visual proposal review and responsiveness. Loopback simulator success cannot establish these.

The app now supplies `NSLocalNetworkUsageDescription` in both generated configuration sources. The settings explain that localhost on a physical iPhone is the phone, and the picker calls the compatible provider “Server”. A real phone must reach a LAN/public endpoint. Apple's [local-network privacy technote](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy) covers native socket access; simulator tests do not establish physical privacy-prompt behavior. No blanket ATS exception was added.

## Automated checks

- 14 AgentRuntime tests pass both normally and with `e2e-chat-fixture`, including rejection of non-loopback fixture URLs.
- 9 mounted browser settings checks pass.
- 2 existing model-selector rendering checks pass with updated provider wording.
- Svelte and E2E type checks pass with zero errors/warnings.
- Normal fixture-feature-off packaging succeeds, and the ordinary app was reinstalled/launched without synthetic credential overrides. Existing linker warnings concern the blake3 object deployment version and large debug unwind section; these are not chat-provider failures.

Raw synthetic requests, signing diagnostics and build/test logs are local under `/private/tmp/gneauxghts-ios-remote-chat/`; the fixture and this bounded record are retained in the repository.

## Native timeout and visual-review follow-up

[Network/review validation](chat-network-review-validation.md) records both real 15-minute deadlines, native reset/EOF/refused-connection failures and explicit network recovery. Both providers pass mounted create Keep/Undo; the shared update editor passes styled Keep/Undo. Related overlap, an unimported review stylesheet and touch sizing are corrected. At that checkpoint compatible timeout retry remained unproven: a fixture-counter mistake interrupted its retry, then app replacement exposed stale persisted paths. The subsequent [container relocation correction](../archive/mobile-ios-container-relocation.md) resolves the stale-path failure: old timeout retries, retained proposals and repeated signed replacement now pass, preserving genuine conflicts. Both fake keys were cleared and the ordinary signed build restored.
