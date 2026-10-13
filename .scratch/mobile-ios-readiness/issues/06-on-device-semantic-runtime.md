# On device semantic runtime

Status: ready-for-agent
Priority: P1 parity

## Scope

Establish a supported iOS embedding runtime/model path to enable semantic search, Map, Related notes and image search on recent iPhones. Prefer on-device operation and measure peak memory before committing to an implementation.

The [isolated simulator probe](../semantic-runtime-validation.md) establishes a viable CPU/Metal path through the official LiteRT-LM 0.18.0 XCFramework and the existing pinned 440M model. The runtime is now embedded in the normal product package and simulator admission is implemented; physical-device admission remains open. See the [packaged app validation](../app-semantic-validation.md). The user chose simulator work for now.

## Implemented and simulator-verified

1. Normal Tauri packaging embeds the checksum-pinned official framework with nested signing. Rust loads its fixed app-bundle path; the signed product launches and performs inference.
2. iOS runtime availability is separate from verified model-data setup. Missing bundle, missing model and initialization errors have distinct Settings actions; iOS never downloads executable runtime code.
3. Simulator text and vision use the existing serialized provider/workqueue, generation admission, model/prompts/normalization/dimensions and overflow contract. Simulator representations have a separate namespace. CPU fallback remains initialization-only and uses four threads on iOS.
4. Product testing covers long-passage indexing, text search, Related, Map, pause/resume, software-keyboard editing during startup, image and combined queries at 70/140 tokens, image-result opening, malformed-image isolation and model setup recovery. Profile changes preserved text-vector bytes. Relaunch preserved all vectors and the settled Map's exact positions, cloud data and name revision. See [packaged app validation](../app-semantic-validation.md).

## Remaining acceptance, in priority order

1. Complete the [physical-device release gate](08-ios-device-release-gate.md#semantic-runtime) before enabling physical-device admission. Measure full-app memory/headroom, responsiveness, thermal behavior, sustained indexing and lifecycle behavior with representative vaults; choose memory/concurrency policy from that evidence.
2. Exercise full-app CPU initialization fallback and cleanup/retry, high-resolution image preparation and device/distribution signing. Simulator inference does not establish phone RAM allowance or physical-device acceptance.

## Acceptance

Measure model load, indexing and ordinary UI use on physical recent iPhones with representative vaults. Preserve compatible retained Atlas geography or define an explicit migration. Removing the current iOS disable guard alone is insufficient.

The normal product simulator package now loads the bundled runtime and completes the recorded text/image workflows above. Artifact identity and representation compatibility must remain explicit. Physical acceptance is deferred to issue 08, not waived; retain this issue until integration and the linked release gate are satisfied.

## Comments

2026-10-11: The user requested the simulator instead of connecting the unavailable paired phone. Both framework slices compile with all 22 required C symbols. Text, long-passage, image and combined embeddings execute in the isolated simulator probe. See the validation record for measured results, desktop comparison and limitations. No product iOS support guard was removed and no semantic vault data was modified.

2026-10-11: Embedded the pinned official framework with nested signing, fixed app-bundle loading and simulator-only admission. Model setup is data-only on iOS. The normal package indexed long passages and images; text search, Related, named Map regions, pause/resume and image queries were exercised. Simulator testing also found and repaired missing-model setup precedence, phone query overflow, missing touch image-query entry and empty-ID image admission. See [product validation](../app-semantic-validation.md). Physical release admission remains gated in issue 08.

2026-10-11: Final product validation covers both image settings and viewer opening, ordinary note creation/indexing, and relaunch retention of vectors and settled Atlas geometry/names. Integration is complete for the simulator; retain this issue for physical release acceptance.
