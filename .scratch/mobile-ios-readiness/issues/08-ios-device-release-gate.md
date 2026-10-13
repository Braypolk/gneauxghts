# iOS device release gate

Status: ready-for-agent
Priority: P1 release

## Scope

Establish an iOS simulator/device smoke workflow, then validate recent physical iPhones: keyboard/rotation/safe areas, selection/IME, VoiceOver/text scaling, attachments, vault switching, credentials, background/lock/kill/resume, and representative vault performance.

The native mobile suspension branch now compiles, and a [simulator smoke test](../simulator-validation.md) verified note/chat persistence across backgrounding and process relaunch. It used temporary icon/launch-screen substitutions because Xcode's matching simulator runtime was missing. Normal packaging now passes with the matching runtime; validate device/distribution signing and the [implemented background save handling](../../archive/mobile-background-saving.md) on real devices; abrupt termination and actual lock/suspension remain open.

## Acceptance

Validate [safe next-launch vault switching](../../archive/mobile-ios-vault-switching.md): Apply leaves the current vault editable, Home/resume retains it, replacing/cancelling a pending selection works, and fully closing/reopening binds the selected vault. Validate [drag cancellation](../../archive/mobile-cancelled-block-drags.md) with real touch capture, system interruptions and scrolling, alongside successful drops and Undo.

Repeat the [implemented landscape safe-area and keyboard viewport checks](../../archive/mobile-landscape-viewport.md) using normal packaging and a recent physical iPhone: both cutout edges, editor/composer focus, long-note typing, route return, rotation, dismissal and retained drafts. The temporary smoke package passes the recorded native geometry journeys, but does not establish release acceptance.

Browser fixture tests do not establish WKWebView, native SQLite recovery, process memory or actual iOS suspension guarantees. Record device/OS, build and observed results before calling the app iOS-ready.

Repeat the [implemented secondary touch and image checks](../../archive/mobile-secondary-touch.md) on a recent physical iPhone: portrait/landscape date controls, message and attachment actions, keyboard-open attachment scrolling, tiny/large inline images, pinch/finger lift/pan/swipe boundaries, cancellation during rotation or backgrounding, backdrop/Close dismissal, and note scrolling/resizing. Browser touch regressions pass; WKWebView and physical gesture acceptance remain open.

Repeat the [implemented touch editing checks](../../archive/mobile-touch-editing.md) on a physical iPhone: tap versus scroll/cancel on links, Open and return from Safari/Mail, Edit without navigation, selection/IME, multiline software Return, attached hardware keyboard Return and explicit Send. Browser touch and keyboard regressions establish the app policy; actual iOS IME and external app transitions remain device acceptance.

## Semantic runtime

The [isolated semantic simulator probe](../semantic-runtime-validation.md) passes text, long-passage, image and combined embeddings through the official LiteRT-LM 0.18.0 framework on CPU and Metal at 70/140 image tokens. Both target slices compile; the device build was not executed. The [normal packaged app](../app-semantic-validation.md) now loads the framework and passes the recorded simulator workflows. Physical-device acceptance remains open.

With [product simulator integration](06-on-device-semantic-runtime.md) implemented, test recent physical iPhones with representative vaults. Record build/device/OS, pinned runtime/model and backend, per-phase process footprint and peak, current `os_proc_available_memory` headroom, cold/cached load, first/warm queries, sustained indexing, long passages, high-resolution image preparation at 70/140 tokens and combined retrieval. Include ANN/Atlas and WebKit memory, editing/scrolling while indexing, cancellation, background/resume, memory pressure, thermal behavior, resource cleanup/retry and explicit CPU initialization fallback. Verify retained Atlas places/names and generation admission. Choose memory limits and concurrency policy from device evidence. Sync and older-phone compatibility remain deferred.

2026-10-11: Normal product packaging now succeeds with the matching iOS 26.4.1 simulator runtime and original icons/launch screen. The embedded semantic runtime and product workflows are recorded in [packaged app validation](../app-semantic-validation.md). This resolves the earlier simulator SDK/resource packaging blocker; device provisioning, distribution signing and physical acceptance remain open.

## Remote chat

Mobile chat uses the same remote providers as desktop; on-device chat inference and chat/embedding model coexistence are not release requirements. Following the [remote chat implementation](../../archive/mobile-remote-chat.md) and bounded [simulator results](../remote-chat-validation.md), repeat actual app streaming, note retrieval, proposal review, cancellation and recovery with both OpenAI and a reachable compatible server on a physical iPhone. Verify credential persistence, Wi-Fi/cellular transitions, offline/timeout errors, background/lock/kill/resume and retained drafts/transcripts without duplicate tools or unapproved writes. Keep provider selection explicit. Semantic indexing still needs its own device memory and responsiveness acceptance above.

2026-10-11: Both providers pass local-fixture simulator streaming, retrieval/citations, proposal Keep/Reject, cancellation/retry, 401/disconnect and kill/relaunch recovery. OpenAI was intentionally not called live. The no-sign/ad-hoc package could not save through Keychain; a development signature lacked a matching provisioning profile. Verify token save/read/delete and relaunch in a properly provisioned build before mobile release. At that checkpoint visual proposal review, real timeouts/network transitions and interruption around actual tools were not established.

2026-10-11 follow-up: The [simulator Keychain blocker is resolved](../keychain-validation.md). Normal Xcode simulator signing embeds the application identity omitted by `--no-sign`; no device profile was required. Both provider keys pass save, exact-value authenticated read after relaunch, replacement, deletion and provider isolation. A full simulator restart retained the replacement OpenAI key and the server-key deletion. Ordinary feature-off builds also pass save/relaunch/delete. Physical/distribution signing and locked-device Keychain acceptance remain open.

2026-10-11 network/review follow-up: [Native simulator checks](../chat-network-review-validation.md) exercised both unmodified 15-minute agent deadlines, midstream TCP reset/incomplete EOF, unavailable endpoints and explicit network recovery. Both providers pass create Keep/Undo; the shared update editor passes styled Review/Keep/Undo with preserved unrelated text. Related-overlay, missing stylesheet and touch-target defects were corrected. This establishes bounded simulator behavior, not physical radio/suspension or live-provider acceptance. Signed app replacement exposed the [container relocation failure](../../archive/mobile-ios-container-relocation.md): old transcript retry and retained create Keep failed after the data root moved. The subsequent correction and simulator verification resolve that implementation blocker.

2026-10-11 relocation follow-up: [Legacy and recorded-root migration](../../archive/mobile-ios-container-relocation.md) now passes three actual signed simulator container changes, retained retries and explicit proposal review with both providers, while genuine transcript edits/deletions remain blocked. Repeat a real signed app update on a physical iPhone with retained chats/proposals and existing keys before release. Host regressions verify interrupted commit proof without replay; process interruption during an actual device commit remains open.
