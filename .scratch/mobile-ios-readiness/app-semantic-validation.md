# Packaged iOS semantic validation

Date: 2026-10-11. User chose simulator testing; physical-device acceptance remains open.

## Build and admission

The normal Tauri package builds with Xcode 26.4.1 (17E202), SDK 26.4 and the matching iOS 26.4.1 (23E254a) simulator runtime. Test target: disposable iPhone 17 Pro simulator `Gneauxghts Semantic Test`, UDID `3E6C179B-10D5-4FA2-8773-207EB27951BF`. Bundle ID: `com.braypolkinghorne.gneauxghts`. The package includes the normal icons and launch screen; no temporary resource substitutions are needed. This supersedes the matching-runtime packaging blocker in the earlier smoke record.

`pnpm tauri ios build --debug --target aarch64-sim --no-sign --ci` builds the product. For offline reuse, set `GNEAUXGHTS_IOS_LITERT_ARCHIVE` to the official ZIP. The wrapper stages LiteRT before `ios init/build/dev`; Xcode embeds the matching framework slice with CodeSignOnCopy. For this unsigned simulator run, the nested framework and app were ad-hoc signed and `codesign --verify --deep --strict` passed before installation. Device provisioning/distribution signing was not exercised.

- Runtime: official [LiteRT-LM 0.18.0 XCFramework](https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.18.0/CLiteRTLM.xcframework.zip), SHA-256 `d765b99592d4ec3d0c9e2bd69469454af06c834861340672da1891c0c121c347`.
- Model: pinned `embeddinggemma-2-text-vision-440m.litertlm`, revision `e301f74d5551b0c2641bd5cb4652a76239d5c5f8`, 387710976 bytes, SHA-256 `92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0`.
- iOS minimum raised to 15.0 to match the framework's Mach-O minimum; older-device compatibility is not validated.
- Runtime loads only from `Frameworks/CLiteRTLM.framework/CLiteRTLM` beside the executable. iOS setup checks its C symbols and installs verified model data; it never downloads executable code.
- Existing serialized provider, generation admission and work queue remain the owners. Simulator representation ends in `-ios-aarch64-simulator`; physical iPhone admission remains disabled pending issue 08. CPU fallback uses four threads. Simulator results do not establish phone memory headroom.

## Fixtures and observed workflows

Used only synthetic notes in the fresh simulator's default Documents/Notes vault. No desktop vault, credentials or personal notes were copied. Fixtures: 16 short documents from `scripts/fixtures/embedding-evaluation.json`, a companion recipe note, an approximately 80 KiB repeated garden passage, and one broken-image note. Red-circle and blue-square PNGs are 256×256; the third image is deliberately invalid. The model file was copied from an already checksum-verified local installation to avoid repeating its download.

| Check | Observed result |
| --- | --- |
| Normal package startup and indexing | 19 notes, 332 text chunks and 19 note vectors; compatible generation became active. |
| Long passage | Garden passage contributed hundreds of chunks; indexing completed through the product worker. |
| Text search | “Red circle on white” returned Red circle semantic rows. “Tomato” returned the expected keyword rows. The broad query “Food” returned no matches; this does not establish retrieval quality for broad queries. |
| Related | Recipe companion returned Tomato recipe with its matching paragraph; panel opened and closed normally. |
| Map | Built and rendered five named regions: meetings, photography, cooking, workflows and art. |
| Image indexing | Two valid images indexed, one failed with “Image is not a valid PNG, JPEG or static WebP.” Text stayed ready. |
| 70 → 140 tokens | Image vectors changed to the 140 representation. All 332 text-vector bytes stayed identical: aggregate SHA-256 `a0ac2f2ab50b248cb7a07e47a431839f0d0573f2b5da2bc43065439907e3445b`. |
| Pause/resume | Paused during the image-profile rebuild; Settings showed updates paused. Resume finished with two indexed images and text ready. |
| Missing model | With the test model temporarily staged outside the sandbox, Settings offered Set up local search and explained the bundled runtime. Restoring the verified file and pressing setup reused it, initialized the model, and scheduled indexing. No runtime download occurred. |
| Image query and refinement | Native Choose File selected a red-circle PNG at both 70 and 140 tokens; image queries and “Red”/“red” refinements returned semantic passages and the red-circle thumbnail. Tapping the image result opened `assets/red-circle.png` in the correct viewer at both settings. |
| Editing during startup | Typed a new note with the simulator software keyboard during semantic startup. Its canonical save assigned a stable ID and automatic indexing completed: 20 notes, 334 text chunks and 20 note vectors. |
| Relaunch | All 20 notes, 334 chunks, 20 note vectors and two image vectors survived process termination/relaunch; vector bytes matched exactly and the semantic generation remained active. The new note retained its stable ID. |
| Retained Map | After the new-note update settled, a second relaunch rendered the same Map. Durable node positions, cloud data and name revision matched exactly. The derived generation identifier changed without moving nodes or renaming regions. |

## Defects found and repaired

1. Missing model plus automatic warmup error incorrectly selected Prepare local model. Settings now distinguishes absent bundled framework (reinstall app), absent model (setup), and installed-model initialization errors (prepare/retry).
2. Expanded phone search controls squeezed the query field to zero width. Narrow docks now put controls on a horizontally scrollable row below the query. Navigation arrows appear only for current-note search; redundant projected search icons are hidden in the expanded narrow layout.
3. A touch image-query picker was added and tested during this pass, then removed at the user's request. Search no longer displays an image-upload control; existing paste/drop image-query handling remains.
4. Imported notes without managed IDs had image matches removed by current-content admission because the derived row asserted an empty ID. Image results now use NoteTimeline's existing path resolution until an ID is stable; opening uses a nullable ID. Nonempty IDs still undergo the existing identity/path check.
5. Explicit vision retry now reinitializes the engine on supported iOS simulators as well as macOS.

## Automated checks

- Semantic Rust suite: 183 passed, eight opt-in native/fixture tests ignored.
- Media-command tests: two passed, including imported-image current-content identity admission.
- Settings and IPC frontend tests: 26 passed, including bundled-runtime missing-model/missing-framework cases.
- Mounted search-controls suite: nine passed during this pass, including a 393×852 query-width/picker-submit regression and all existing animations. The phone regression now checks query width and absence of the removed upload control.
- Svelte and E2E TypeScript checks: zero errors and warnings.

## Limits and retained evidence

Physical iPhone memory, thermal behavior, background/lock/suspension, real touch/IME, representative vault scale, CPU initialization fallback in the full app, and App Store/device signing remain issue 08. The isolated probe remains the CPU/Metal comparison evidence; product execution here does not establish a phone RAM allowance. No cloud sync or on-device chat work was included.

The keyboard-open search result panel can extend behind the app header/cutout; retain this as mobile visual follow-up. Query controls and native picking are usable, but this run does not establish completion of the broader mobile visual audit.

Selected observations are recorded here. Superseded build logs, synthetic SQLite snapshots and old packages under `/private/tmp/gneauxghts-ios-semantic/` were pruned on 2026-10-12; the staged official ZIP remains as a normal iOS build input. Tauri's repeated build output rename fails if `build/arm64-sim/Gneauxghts.app` already exists; moving the prior generated package aside allowed normal builds. Existing linker warnings concern a blake3 C object built with the current simulator SDK minimum and a large debug unwind section; recent-simulator execution passed, older deployment compatibility remains deferred.
