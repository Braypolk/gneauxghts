# iOS semantic runtime feasibility research

**Historical research:** the experiment design below preceded the now-completed [product simulator integration](app-semantic-validation.md). The isolated probe tooling was removed on 2026-10-12; [issue 08](issues/08-ios-device-release-gate.md#semantic-runtime) owns the remaining physical full-app acceptance.

Research date: 2026-10-11. Scope: recent iPhones, on-device semantic search, Related notes, Atlas and eventual image-search parity. This records source evidence and the experiment design. The subsequent [simulator validation](semantic-runtime-validation.md) records actual results; neither record certifies device performance or enables the runtime.

## Finding

There is a supported upstream packaging route worth testing: **LiteRT-LM 0.18.0's official iOS XCFramework, embedded in the app, using the existing pinned EmbeddingGemma 2 model and C embedding interface.** A new model conversion or a web runtime is unnecessary for the first experiment. The current desktop wheel installer and downloaded executable-library approach are not the iOS integration path. The user has limited the current experiment to the simulator; physical-device acceptance remains a later gate.

Google documents Swift embedding support, CPU execution and Metal GPU integration. The Swift API remains labeled early preview in the project's README. Use the pinned binary and headers, not floating package dependencies or a mix of independently assembled accelerator libraries. [Embedding guide](https://developers.google.com/edge/litert-lm/embedding_models), [Swift guide](https://developers.google.com/edge/litert-lm/swift), [tagged README](https://github.com/google-ai-edge/LiteRT-LM/tree/v0.18.0).

## Current repository contract

The active provider is `src-tauri/src/semantic/litert.rs`, with a serialized in-process engine. `litert_install.rs` selects pinned macOS, Linux and Windows wheel artifacts; there is no iOS entry. Its availability guard therefore correctly keeps iOS disabled today. The pinned model is already multimodal, although image capability is deliberately admitted only on macOS arm64.

The text contract currently includes normalized 768-element output, special tokens, native chunk-and-average overflow, input signatures constrained to 128–1,024 tokens, and these existing prompts: query `task: search result | query: `; document `title: none | text: `. Preserve these in the first probe. Google's current task-prefix examples differ; copying them into iOS would change representation semantics. A later prompt correction needs its own namespace, retrieval evidence and migration review. [Current upstream task-prefix examples](https://developers.google.com/edge/litert-lm/embedding_models).

The representation includes model identity, output shape, OS and architecture. iOS must keep its own namespace until numerical and retrieval equivalence is proven. Simulator and physical device backends also require explicit recorded identity in experiment results, even if both Rust targets report iOS/aarch64.

`legacy_jina.rs` is a retained Jina v5 text-nano retrieval provider using a llama-server subprocess. The active Gemma provider owns text and image embeddings. The subprocess recovery provider is not the proposed iOS route.

## Pinned artifacts

| Item | Pin | Verification |
| --- | --- | --- |
| iOS runtime | [CLiteRTLM.xcframework.zip, v0.18.0](https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.18.0/CLiteRTLM.xcframework.zip) | 124,129,650 compressed bytes; SHA-256 `d765b99592d4ec3d0c9e2bd69469454af06c834861340672da1891c0c121c347` |
| Existing parity-first model | [embeddinggemma-2-text-vision-440m.litertlm](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm/resolve/e301f74d5551b0c2641bd5cb4652a76239d5c5f8/embeddinggemma-2-text-vision-440m.litertlm) | Revision `e301f74d5551b0c2641bd5cb4652a76239d5c5f8`; 387,710,976 bytes; SHA-256 `92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0` from repository manifest |
| Optional smaller text-only comparison | [embeddinggemma-2-text-270m.litertlm](https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm) | Revision `9be6e8b90982095dc05c2bd162e4b954ee4dbac7`; 164,626,432 bytes; LFS SHA-256 `2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb` |

Runtime URL and checksum are declared by Google's [tagged Package.swift](https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/v0.18.0/Package.swift); byte size and digest were independently read from the [official release metadata](https://api.github.com/repos/google-ai-edge/LiteRT-LM/releases/tags/v0.18.0). The smaller candidate's revision, bytes and checksum were read without downloading weights from the [publisher's model API](https://huggingface.co/api/models/litert-community/embeddinggemma-2-text-270m-litert-lm?blobs=true). This is the general CPU/GPU artifact, not one of the platform-specific NPU variants.

The 440M model combines a text backbone and vision encoder into a 768-dimensional space, permits on-demand modality loading, and offers 70/140 image-token signatures. Start with vision disabled while retaining this same model file, then add vision as a separate resource measurement. The 270M file reduces download size but requires separate compatibility validation and cannot deliver image parity. [Publisher's 440M card](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm), [270M card](https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm).

## Native integration seam

Prefer the existing narrow C seam for iOS while preserving the Rust provider's ownership, serialization, prompts and vector validation. The tagged [embedding_engine.h](https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/v0.18.0/c/embedding_engine.h) declares the settings/create/compute/delete functions already used in `litert_ffi.rs`, including explicit minimum/maximum input lengths, normalization, output size and chunk-and-average overflow. Response values are owned by their response handle, so continue copying before deletion.

The parent feasibility probe verified the ZIP checksum and inspected its `Info.plist`: device `ios-arm64/CLiteRTLM.framework`, simulator `ios-arm64-simulator/CLiteRTLM.framework`, both arm64 only. The simulator framework executable is a Mach-O dynamic shared library. Therefore retaining `libloading` with a fixed app-bundle path to the embedded framework may be sufficient; a static-binding rewrite is not established as necessary. Verify signing/embedding and required symbols for each target before adopting this route. Metal being statically included inside the official framework does not make the whole framework a static archive. These are local artifact inspection results reported by the parent, rather than inference from the package manifest.

The alternative is a Swift bridge using Google's `EmbeddingEngine` actor. It calls the same C interface and has explicit initialize/close operations. However its public config/options omit the explicit minimum input signature and overflow strategy that this repository sets. A direct C seam avoids introducing a second engine owner or silently depending on different defaults. [Tagged EmbeddingEngine.swift](https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/v0.18.0/swift/EmbeddingEngine.swift), [tagged config/options](https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/v0.18.0/swift/EmbeddingEngineConfig.swift).

The Swift manifest requires Swift tools 5.9 and declares iOS 15 as upstream's package minimum; that is not this project's chosen compatibility matrix. The source tree distinguishes `prebuilt/ios_arm64` and `prebuilt/ios_sim_arm64`. Keep device and simulator framework slices distinct and do not use macOS arm64 binaries for either iOS target. [Package manifest](https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/v0.18.0/Package.swift), [tagged source tree](https://github.com/google-ai-edge/LiteRT-LM/tree/v0.18.0/prebuilt).

## Accelerator and simulator evidence

Do not conclude that iOS Metal is unavailable from older issue reports. Issue #2689 was closed in July: the maintainer confirmed the official device binary, and the original reporter confirmed GPU operation through the v0.13.1 XCFramework with Metal statically linked. The problematic `litert_prebuilts.zip` distribution was a separate channel. This supports testing the official 0.18.0 XCFramework, while proving neither its EmbeddingGemma behavior nor this app's resource use. [Resolved upstream report and correction](https://github.com/google-ai-edge/LiteRT-LM/issues/2689).

There is an open arm64 simulator report against v0.13.1 where CPU initialization succeeded but generation failed, while physical CPU and macOS GPU worked. It concerns Gemma chat models, not this embedding model; use it as a reason to separate build/ABI checks, actual simulator embedding results, and physical-device acceptance. A simulator failure does not establish device infeasibility. [Upstream simulator report](https://github.com/google-ai-edge/LiteRT-LM/issues/2504).

Apple Neural Engine execution is not established for this pinned route by the evidence reviewed. Start with CPU and Metal. Google's generic NPU support statement is insufficient to promise an Apple Neural Engine backend.

## Feasibility experiment

1. Download and hash-verify the official XCFramework; inspect actual device/simulator slices and required C symbols. Build a disposable native app or isolated probe against both iOS targets. Keep production iOS disable guards intact.
2. Use the existing 440M model, exact current prompts/options, one serialized engine and a disposable corpus. Measure CPU first, then Metal in separate fresh launches; release one engine fully before testing the next. Begin text-only (`vision_backend = NULL`, audio disabled).
3. Emit machine-readable runtime/model hashes, target/platform, backend, signature limits, input lengths, initialization/first-query/warm-query timing, vector length/norm/non-finite checks, and memory samples before load, after load, first inference, repeated batches and after close. Include a passage exceeding 1,024 tokens to exercise chunk-and-average, rather than testing only short examples.
4. Compare a fixed query/document set against the pinned desktop implementation: ranking stability, score deltas and threshold-boundary cases. Same weights do not justify mixing vectors across an unvalidated backend. Retain the platform namespace unless compatibility is explicitly admitted.
5. Later, after the authorized simulator experiment, repeat on an available physical recent iPhone: cold and cached launches, progressively larger representative vault indexing, keyword/semantic/Related/Atlas use while editing and scrolling, cancellation, background/resume, thermal pressure and memory pressure. Observe app plus WebKit memory, not just the embedding engine. Record peaks, headroom and recovery behavior; choose operational limits from these measurements.
6. Only after text succeeds, enable the same model's vision encoder and existing image preparation policy. Test 70 then 140 tokens separately with high-resolution inputs, memory spikes and image retrieval quality. Keep image failure isolated from working text search.
7. If the parity-first model fails measured resource/usability gates, run the pinned 270M file as an explicitly separate experiment. Evaluate retrieval and Atlas migration before selecting it; do not substitute it automatically.

This is the test design. The subsequent [validation record](semantic-runtime-validation.md) distinguishes the performed build/simulator/reference checks from the outstanding product and device checks.

## Resource and continuity gates

No fixed iPhone RAM allowance is assumed. Apple says per-app memory limits can change during the app lifetime and are not simply physical RAM. `os_proc_available_memory` is advisory and should not be cached. Measure footprint and headroom rather than treating model download size or phone marketing RAM as a safe resident budget. [Apple memory API](https://developer.apple.com/documentation/os/os_proc_available_memory).

The publisher's performance figures are useful context but use short signatures and cached loads; they are not peak memory or indexing results for this app. Cold compilation, longer signatures, the note database, ANN, Atlas and the WebView all remain unmeasured. [Model-card benchmark methodology](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm).

Preserve `atlas-map` as the durable continuity owner. A rebuild may replace derived vectors and indexes, but must not delete learned places or user cloud names. Incompatible model/runtime representations require a fresh semantic generation; keep the last admitted map visible as stale while rebuilding, reset incompatible candidate evidence and publish only through existing admission checks. Follow [ADR 0010](../../docs/adr/0010-retain-atlas-geography-outside-derived-caches.md) and [semantic behavior invariants](../../docs/architecture/behavior-invariants.md). There is no authorization here to merge concurrent cross-device maps.

The isolated probe resolved both slice/symbol/build checks, simulator text/vision execution, one-journey simulator memory/timing and small-fixture desktop text comparison. Remaining unknowns: normal product embedding/signing/loading; CPU/Metal physical-device success with this exact model; full-app cold and sustained peak footprint; indexing/Atlas UI contention; background and thermal recovery; image preparation/retrieval quality; threshold-boundary and physical-device representation compatibility. These keep product integration and physical-device acceptance open.
