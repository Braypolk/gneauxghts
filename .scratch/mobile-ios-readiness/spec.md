# iOS readiness implementation plan

Target recent iPhones with desktop feature parity. Keep semantic embeddings on-device, subject to measured memory and responsiveness. Mobile chat uses the same remote providers as desktop (OpenAI or an OpenAI-compatible server); chat inference does not run on the phone. Desktop/phone sync, sharing and older-device compatibility are deferred. Preserve the current mobile visual work.

## Priority order

| Order | Work | State |
| --- | --- | --- |
| 1 | [P1: Background save safety](../archive/mobile-background-saving.md) | Implemented; device validation pending in 08 |
| 2 | [P1: iOS vault switching](../archive/mobile-ios-vault-switching.md) | Implemented; device validation pending in 08 |
| 3 | [P1: Cancelled block drags](../archive/mobile-cancelled-block-drags.md) | Implemented; device validation pending in 08 |
| 4 | [P2: Landscape safe areas](../archive/mobile-landscape-viewport.md#safe-areas) | Implemented; device validation pending in 08 |
| 5 | [P2: Landscape keyboard viewport](../archive/mobile-landscape-viewport.md#keyboard-viewport) | Implemented; device validation pending in 08 |
| 6 | [P2: Touch editing actions](../archive/mobile-touch-editing.md) | Implemented; device validation pending in 08 |
| 7 | [P2: Secondary touch controls and image gestures](../archive/mobile-secondary-touch.md) | Implemented; device validation pending in 08 |
| 8 | [P1 parity: On device semantic runtime](issues/06-on-device-semantic-runtime.md) | Runtime bundled; product simulator workflows verified; physical admission gated in 08 |
| 9 | [P2 parity: Mobile remote chat](../archive/mobile-remote-chat.md) | Implemented; both protocols, Keychain, deadlines/network failures and shared visual review simulator-checked; container relocation corrected and simulator-verified |
| 10 | [P1 release: Durable paths after iOS container relocation](../archive/mobile-ios-container-relocation.md) | Implemented; legacy and repeated signed simulator replacement verified; physical update acceptance in 08 |
| 11 | [P1 release: iOS device release gate](issues/08-ios-device-release-gate.md) | Planned |

Safety work comes first: background saves, vault switching and cancelled gestures. Touch workflows follow. Semantic runtime memory requires device measurements. Chat retains desktop provider behavior and requires mobile network and lifecycle validation; the device release gate applies throughout.

## First implementation

Use the existing workspace and composer persistence owners. Native suspension and browser background signals request saves before debounce timers fire, without introducing a second canonical write path or closing the Running Vault. Ordinary documents save independently; unresolved conflicts and protected proposal reviews are never overwritten. Keep failed text dirty/retryable and join in-flight writes.

This improves background admission; it cannot guarantee completion if iOS suspends or kills the process before IPC and durable writes finish. Physical-device background, lock and termination checks remain explicit release work.

Implementation is complete with 66 focused unit tests and 11 mounted browser tests passing. Svelte/E2E type checks and the host Rust check pass. A subsequent [iPhone simulator smoke test](simulator-validation.md) compiled the mobile Rust branch and verified note/chat persistence across backgrounding and process relaunch with a temporary smoke package. At that smoke-test stage standard packaging was unverified; normal packaging now passes in the packaged semantic validation below. Physical-device lifecycle behavior remains unverified. See the [implementation record](../archive/mobile-background-saving.md). Safe next-launch iOS vault switching is also implemented; see its implementation record above. Drag cancellation is also implemented; see its record above. Landscape safe areas and keyboard viewport handling are implemented and simulator-checked; see their implementation record above. Touch editing actions are implemented with seven new and eight existing mounted checks passing. Secondary touch controls and image gestures are implemented with 41 affected mounted checks and six image unit checks passing. The [on-device semantic probe](semantic-runtime-validation.md) verifies CPU/Metal text and vision feasibility in the simulator. The [normal app semantic runtime](app-semantic-validation.md) is now bundled and simulator workflows are validated; physical memory and responsiveness acceptance remains in issue 08.

## Evidence

The audit passed 32 existing responsive/navigation/sizing checks. Three temporary browser probes reproduced cancelled-drag mutation, plain link taps revealing source and chat Return interception. No physical iPhone validation was performed during the audit. This plan separates reproduced defects from platform risks and feasibility work.

The simulator smoke test identified the now-implemented [landscape safe-area and keyboard viewport fixes](../archive/mobile-landscape-viewport.md). Four new mobile regressions and 46 existing responsive/navigation/editor/image checks pass. Normal packaging now passes with the matching runtime; physical-device acceptance remains in issue 08.

## Mobile chat decision

2026-10-11: On-device chat is out of scope. Use the same remote provider choices as desktop and retain the current chat permissions, evidence and persistence contracts. The isolated native experiment is [archived](../archive/mobile-on-device-chat/README.md); it changed no production chat provider. [Remote chat implementation](../archive/mobile-remote-chat.md) enables both desktop providers on iOS. Both protocols pass bounded [simulator checks](remote-chat-validation.md), with user-selected synthetic OpenAI responses. [Keychain persistence](keychain-validation.md) also passes in Xcode-signed simulator builds. Physical/distribution credentials and physical/live acceptance remain in issue 08.

2026-10-11 follow-up: [Timeout, network failure and visual proposal checks](chat-network-review-validation.md) completed with synthetic native HTTP fixtures. Both production 15-minute deadlines fired; reset/EOF and unavailable-endpoint recovery passed. Proposal overlap, missing review styling and touch sizing were corrected. Signed app replacement exposed [container relocation](../archive/mobile-ios-container-relocation.md). It is now corrected: legacy recovery, retained review/retry, genuine conflicts and repeated signed replacement pass in the simulator; physical release acceptance remains in issue 08.
