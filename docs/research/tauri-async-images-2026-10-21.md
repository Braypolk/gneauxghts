# Tauri asynchronous image delivery — 2026-10-21

Native editor images now use Tauri’s asynchronous asset protocol. The editor receives a short versioned URL instead of base64 image bytes in a JSON IPC response. Paste storage, Markdown, resize undo, viewer behavior and the immutable Running Vault are unchanged.

## Implementation and compatibility

- Enable Tauri 2.12.5’s `protocol-asset` feature and asset protocol with an empty initial scope. Existing image CSP already admits platform asset origins; no CSP expansion was needed.
- `resolve_image_asset_url` resolves canonical contained assets and metadata through the existing blocking-worker seam. It grants one file, converts it with the requesting WebView’s platform-aware `convert_file_src`, and appends size/mtime versioning. Fingerprint reads also use the worker.
- Document resources and the fallback image extension use the new resolver. Their cache still coalesces requests and checks metadata. URL strings are bounded; WebView image buffers and decoded pixels are outside that cache budget. DOM and gestures remain pane-local.
- Keep `read_image_asset_data_url` for explicit existing consumers. Browser fixtures return fixture data URLs for the new command; real protocol behavior is verified natively.
- Individual file grants last for the app’s scope lifetime. They do not recursively expose the vault or another directory. Existing containment checks reject absolute paths, traversal and symlink escapes.

Tauri requires protocol scope admission and an allowed image origin for converted asset URLs ([official API documentation](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc)). Inspection of the installed `tauri-2.12.5/src/protocol/asset.rs` confirms the handler spawns an async response and uses Tokio file I/O. Ordinary full-file responses still buffer the file; this migration removes base64/JSON delivery overhead, while WebKit retains responsibility for image decoding and memory.

## Native comparison

The [raw samples and artifact hashes](tauri-async-images-2026-10-21-measurements.json) retain every accepted sample. Measurements use a disposable vault and the real production editor in macOS 26.6.2 WebKit 605.1.15, with signed debug E2E binaries and the Vite native frontend. These are local observations, not release-build latency guarantees.

| Workload | Median load before → after | Maximum load before → after | Median largest timer gap before → after |
| --- | ---: | ---: | ---: |
| One 4096×2048 PNG, 25,171,775 bytes | 976 → 17 ms | 994 → 33 ms | 89 → 38 ms |
| Sixteen distinct 512×512 PNGs, 787,127 bytes each | 452 → 32 ms | 458 → 43 ms | 22 → 24 ms |
| 1,000,059-character Markdown note plus the large PNG | 1,042 → 96 ms | 1,053 → 120 ms | 89 → 83 ms |

The large-note Markdown construction plus synchronous editor dispatch remains about 83 → 82 ms. Asset delivery improves completion substantially; large-document parsing and decoding remain separate work. The many-image timer observation did not improve, so these results do not establish a universal input-responsiveness improvement.

The large asset’s image source shrank from 33,562,390 characters to 202 (207 in the long-note case); the sixteen sources shrank from 16,792,416 characters to 3,190. These are actual image source string lengths, not a measured total IPC byte counter. On the fresh loads, the old command returns the data URL and the new command returns only the URL; fingerprints and IPC framing add small separate payloads.

### Method and limitations

Five sequential samples per workload, before then after. Each asset has deterministic distinct pixel contents, with matching seeds in both versions, so baseline data URLs cannot reuse decoded entries from prior assets. Names are unique per trial; OS file caches remain warm. PNG creation and filesystem writes are untimed. All images appear near the top of the note, exercising concurrent demand rather than offscreen lazy loading.

Timing starts before Markdown construction and editor dispatch, and ends when every mounted image reports `complete` and nonzero `naturalWidth`. It does not await `img.decode()`, physical paint or input acknowledgement. A 16 ms interval records the largest observed timer gap through completion and a short settling period; this is a timer observation, not a browser trace or direct input-latency measurement. The app must have focus before and after each sample. Other owned builds/tests/benchmarks were held during the accepted comparison.

The comparison uses the same working dependency graph and frontend, including the preceding uncommitted CodeMirror/Lezer upgrade and the other thread’s completed capability edits. Baseline restores only the two old image IPC call sites and the previously pinned baseline native binary. Candidate restores both resolver call sites and its pinned native binary. The comparison script restores candidate files and binary in `finally`; hashes and dependency manifest digests are in the JSON. The baseline binary predates this image migration; the candidate adds asset delivery. Parallel backend capability edits are outside both pinned binaries.

Excluded preliminary attempts: background WebKit timer calibration, an early fixture that reused identical pixels across filenames, and a run that lost OS focus. Only the corrected, fully focused unique-pixel comparison appears in the table and JSON.

To repeat the candidate run, follow [E2E image measurement instructions](../../e2e/README.md#image-delivery-measurements). To compare a baseline, explicitly restore its two image IPC call sites and corresponding admitted binary/manifest, use `IMAGE_LOADING_BASELINE=1`, and restore the candidate afterward. Keep the same dependency graph, workload seeds and desktop conditions.

## Verification

- Independent Standards review: no actionable findings. Spec review found the preliminary pixel-cache bias; corrected fixtures and paired-run restoration were reviewed again with no remaining findings.
- Native smoke: all 11 specs passed, 47 tests passed and 4 existing process-restart opt-in cases skipped. Covers image clipboard import, viewer, resize/undo/cut and persistence across reconnect, scope admission, special characters, unsafe paths, same-size replacement refresh through the document cache, and all three raster workloads.
- A fresh combined native binary (`1a77d5c31112b40792162a6852d477c73c497a6e82f298a00101e8dc533f13cf`) also passed the complete working-tree smoke lane: 12 specs, 50 passed, 4 unchanged `GNEAUX_PI_PROCESS_RESTART` opt-in skips, zero failures. This includes the parallel thread’s connection-error tests and repeats all image cases on the combined backend.
- Corrected foreground comparison: 15 accepted samples per version; all three tests passed for each version.
- Rust working-tree suite: 658 unit tests passed, 19 intentionally ignored; 19 architecture tests, 4 lifecycle-exclusion tests and 1 runtime-lifetime integration test passed; there were no documentation tests. Includes the parallel thread’s completed Rust additions.
- Frontend: 1,416 tests passed, 1 intentionally skipped in the parallel thread’s combined Vitest doctor baseline. All 130 image-stage support tests passed; the combined support gate subsequently passed 139 tests. Python fixture checks: 16 passed. Type checks passed with zero warnings.
- Combined production frontend build passed, with the inspector opt-in deliberately present to verify production exclusion. Native production-preview editing and inspector absence also passed. Final combined `pnpm check` passed with zero errors or warnings. Full browser gate passed: all 65 specs, 384 tests passed, 40 skipped, zero failures (14m 04s).

Validation uses the shared working tree. The image commit is scoped to this migration and evidence; preceding editor upgrades and parallel capability work remain separately owned.
