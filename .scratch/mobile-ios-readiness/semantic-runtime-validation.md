# iOS semantic runtime: simulator feasibility

2026-10-11. **The existing pinned model runs through the official iOS runtime on the arm64 simulator, using CPU and Metal.** This supports proceeding with product integration. It does not establish a recent iPhone memory budget or certify the app's semantic workflows.

The user chose simulator testing instead of connecting the unavailable paired phone. At this isolated-probe checkpoint, production support guards, provider behavior and vault data were not changed. See [source research](runtime-research.md). The subsequent [packaged app validation](app-semantic-validation.md) supersedes this experiment for product integration; physical acceptance remains in [issue 08](issues/08-ios-device-release-gate.md#semantic-runtime).

## Verified path

- LiteRT-LM 0.18.0 official XCFramework, SHA-256 `d765b99592d4ec3d0c9e2bd69469454af06c834861340672da1891c0c121c347`.
- Existing EmbeddingGemma 2 text/vision 440M model, 387,710,976 bytes, SHA-256 `92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0`.
- Separate `ios-arm64` and `ios-arm64-simulator` dynamic framework slices. All 22 symbols used by `litert_ffi.rs` are present in both. Both isolated apps compile/link. Simulator framework/app signatures verify; the device build is unsigned and was not executed.
- Actual simulator inference on CPU and Metal: text-only, vision at 70/140 tokens, image-only input, combined image/plain-text input and long text with native chunk-and-average overflow. Every computed vector passed finite-value, 768-dimension and unit-norm checks.
- Existing text prompts, four CPU threads, 128–1,024 signatures, special tokens, normalization and overflow settings were preserved. Audio was disabled. Native logs register the `GPU Metal` accelerator; the probe performs no automatic CPU retry.

The probe is a separate native app (`com.braypolkinghorne.gneauxghts.semanticprobe`) with synthetic data and a blank window. It uses direct C calls corresponding to the current Rust seam. It does not load through Rust `libloading`, Tauri or WKWebView. Keeping that seam is the preferred integration proposal, not something this probe has already validated in the product.

Environment: Apple silicon arm64 host; Xcode 26.4.1 (17E202), iOS SDK 26.4; booted iPhone 17 Pro simulator on iOS 26.1 (23B86), UDID `EE2E286A-3FD2-4E4C-B57B-7C4CDF30F9FE`. The standalone package avoids icon/storyboard compilation, so it does not resolve the normal product packaging issue recorded in issue 08.

## Measurements

One journey per configuration, with 16 short documents, 12 distinct queries, then images where enabled, followed by a synthetic passage of approximately 80 KB. These are observations, not statistically established performance bounds. Query timing is the median of those 12 queries. First-image time includes image creation and native lazy initialization. Peak memory covers the entire journey, including the long passage and engine close.

| Configuration | Engine load ms | Query median ms | First image ms | Long passage ms | Peak footprint MiB | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CPU text, fresh cache | 1,083 | 45.6 | — | 4,102 | 612.3 | 1,115.8 |
| Metal text, fresh cache | 8,630 | 45.3 | — | 2,427 | 420.0 | 783.9 |
| Metal text, cached relaunch | 1,804 | 40.6 | — | 2,155 | 387.0 | 705.0 |
| CPU vision 70, fresh cache | 958 | 48.9 | 288.8 | 3,892 | 737.9 | 1,403.4 |
| Metal vision 70, fresh cache | 2,949 | 39.4 | 158.1 | 2,150 | 422.5 | 988.6 |
| CPU vision 140, fresh cache | 944 | 47.0 | 468.8 | 3,891 | 965.1 | 1,658.5 |
| Metal vision 140, fresh cache | 4,178 | 40.4 | 255.9 | 2,168 | 444.3 | 963.1 |

“Fresh cache” means the configuration's probe cache directory was empty. Shared OS shader/filesystem caches were not cleared. Each configuration used a separate process and one engine; these labels do not establish pristine-device cold-start times. The cached measurement reuses the first Metal text run's cache in a new process.

Footprint and RSS use Mach task accounting and measure the **whole isolated simulator process**, rather than an increment attributable only to the model. Baseline footprint was approximately 197–199 MiB. Physical footprint and RSS are distinct metrics; neither is a phone RAM allowance. The simulator runs on the Mac's CPU/Metal and memory system. Device-only available-process-memory samples are deliberately omitted here. Thermal state stayed nominal, which says nothing about sustained phone temperature.

Metal is the strongest first integration candidate from these observations. CPU remains a viable initialization fallback to test on hardware, but its long-passage and vision peaks deserve particular attention. Do not select a universal memory limit, enable parallel engines or reduce model size based solely on this table.

## Desktop comparison

Fresh CPU and GPU text references were generated through the installed desktop 0.18.0 C runtime with the exact same model, options and fixture. The summary records the library/model/fixture hashes. Across 28 text vectors and 12 query rankings:

- Simulator CPU versus desktop CPU: cosine 1.0 throughout and zero query/document cosine-score delta in this fixture.
- Simulator Metal versus desktop Metal: minimum corresponding-vector cosine 0.999965; maximum query/document score delta 0.001354.
- Simulator Metal versus desktop CPU: minimum corresponding-vector cosine 0.995205; maximum score delta 0.019597.
- All configurations agreed with both desktop references on the top-ranked document for all 12 queries. Top-1 relevance accuracy was 10/12 for CPU and Metal, matching the desktop top-1 results. Simulator MRR was 0.9167 on CPU and 0.9028 on Metal, showing lower-rank differences despite top-1 agreement.

This small corpus supports feasibility, not general representation equivalence. Threshold-boundary queries, production retrieval distributions, Atlas clustering and physical-device numerics were not evaluated. Keep an explicit iOS representation namespace. Never use simulator cache results to admit device compatibility. Image vectors were validated for execution/shape/norm only; no desktop image comparison or image retrieval quality claim is made.

## Subsequent integration and retention

Normal runtime bundling/signing/loading, model-data setup, text/vision workflows and retained Atlas continuity were subsequently implemented and simulator-checked in the [packaged app validation](app-semantic-validation.md). [Issue 06](issues/06-on-device-semantic-runtime.md) tracks the integration status; [issue 08](issues/08-ios-device-release-gate.md#semantic-runtime) owns physical full-app memory/headroom, sustained indexing, responsiveness, lifecycle, thermal behavior and CPU fallback acceptance. Measure those through the real app rather than reviving the isolated probe. Mobile chat uses remote desktop-equivalent providers.

2026-10-12 cleanup: removed the superseded probe app source, build/reference/summarizing scripts, redundant JSON summary, full vectors, caches and temporary build/report outputs. This record preserves the artifact pins, measured table, desktop comparison and limitations. The verified official framework ZIP remains at `/private/tmp/gneauxghts-ios-semantic/CLiteRTLM.xcframework.zip` for normal app builds; it is a temporary build cache, not repository content. Product build inputs and regression tests remain in their normal owners.
