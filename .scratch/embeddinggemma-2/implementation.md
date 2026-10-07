# Gemma LiteRT implementation and validation

Updated: 2026-10-06

The user selected **LiteRT, GPU preference, default 70 image tokens, optional
140 in Settings** after reviewing the measured resource and quality tradeoffs.
The runtime, indexing, migration/recovery, retrieval, UI, and Settings changes are
implemented. Quality and platform validation limits are recorded below.

## Runtime and Settings

- Production uses the pinned 440M **text/vision-only** `.litertlm`, 768 dimensions,
  trained LiteRT embedding projection/normalization, and official query/document
  prompts. Gemma loads no audio model, Python interpreter, or llama-server. Retained Jina
  recovery uses its existing owned llama-server process after a restart.
- Explicit Settings setup downloads a checksum-pinned official 0.18 native
  library distribution (extracted from its platform wheel) and model. It bounds
  downloads/extraction, rejects incomplete files, verifies cached files on setup,
  and can repair damaged artifacts. First runtime admission verifies artifacts
  before attempting GPU; inference/input errors do not cause a backend switch.
- One mutex owns the native engine and serializes calls. GPU initialization is
  preferred for both text and vision, with one CPU fallback after failure. Status
  reports the effective backend and never blocks behind native work. Shutdown
  drops native handles before unloading their library.
- 70 is the legacy/default setting; 140 persists through the existing settings
  seam. Only image work is queued on a budget change. Text/Atlas revisions and
  representations stay unchanged. The previous engine is released before the
  new budget is allocated.
- Text uses native **chunk-and-average** overflow, tested on long remembered
  passages. This preserves existing excerpt/anchor semantics without truncation.
- Jina's database/model/cache files are retained. Gemma text databases and
  chunk/note ANN/Atlas caches use a separate representation/platform namespace
  derived from model SHA, policy, dimensions and runtime version. Settings can stage a return to retained Jina for the next launch. Composition
  selects one runtime; staging never replaces the running vault/provider.

## Generation publication and recovery

`SemanticGeneration` owns query admission for one immutable vault-lifetime
provider/database/ANN bundle. Each launch resumes compatible durable staging
rows, reconciles ordinary notes and startup remembered-chat work, and drains
snapshot publication before activation. NoteTimeline validates a prepared source
version at the short publication boundary, rejecting proofs superseded by a
mutation. Busy proofs retry outside the producer lock with a bounded,
shutdown-aware delay; exhaustion is visible and supports manual retry.

Semantic queries retain a read lease through inference and delivery. Rebuild
withdraws new admission immediately; its worker waits for existing readers before
changing the corpus. Keyword search stays available while staging. Old Jina
files remain intact during Gemma indexing; next-launch recovery composes the
retained provider and reconciles its corpus before admitting queries.

## Image indexing and search

Current ordinary-note image occurrences are derived from Markdown, including
wiki/reference syntax and UTF-16 viewer offsets. Shared Rust/frontend fixtures
cover escaping, whitespace, references, one-pass URL decoding and literal/code/
comment exclusions. Assets use the canonical contained resolver. PNG, JPEG and
static WebP are bounded to 20 MiB encoded, 8 MP decoded; EXIF orientation and a
versioned white alpha background are shared between query/index paths.

The semantic worker deduplicates byte-identical embeddings, keys them by model,
preprocessing and budget, records per-occurrence failures, and revalidates note
and asset bytes before publication/delivery. Asset watcher events and periodic
reconciliation work independently of Markdown changes. Removing/deleting an
occurrence removes eligibility without deleting the original asset file.

A separate image HNSW index uses deterministic byte-hash labels, immutable
reader snapshots, representation/source manifests, incremental updates, and
SQLite candidate reranking. Scope enters before candidate limits; current source
checks precede final delivery. Checkpoints retain only current/previous complete
generations; interrupted/corrupt snapshots rebuild from authoritative SQLite.

Text queries show images alongside existing passage results. Independent channel
ranks are fused without comparing raw cross-modal cosine scales. The evaluated
admission floors are text→text/text→image 0.70, image→text 0.75, image→image 0.80,
and note edges 0.75. Text Related Notes/Atlas use text aggregates only. Remembered
chat passages retain their existing text/evidence access boundary; ordinary
notepad search retains its ordinary-note scope. No image is a fabricated quote.

Settings distinguishes active/staging/failed migration, text readiness, available/
failed/unsupported vision, and indexed/failed/unsupported image occurrences.
Combined vision initialization failure retries a text-only engine after releasing
the failed attempts. Other packaged architectures use text-only admission until
vision is validated; unavailable packages can recover retained Jina.

Paste/drop/choose image queries are temporary, coalesced and superseded by the latest
request; switching to current-note find retires image work. Query payloads use
bounded Base64, not a large JS number array. Thumbnail reads/decodes are serialized,
and only 160×128 thumbnails reach result components. Viewer opening rechecks the
note, asset version, editor body, pane and exact current occurrence.

## Validation

- Native Rust/pinned-library smoke: CPU and GPU sequentially, 70 / 140, finite/unit
  normalized 768-dimensional vectors; long remembered input; production provider
  lifecycle, budget switching and shutdown.
- Both cross-index directions for text→text, text→image, image→text and image→image:
  **48/48 top-one agreement at each budget**, minimum same-input cosine
  **0.9948868**. Predeclared criteria were 0.98 and 0.95. This is M4/macOS fixture
  evidence, not validation of every platform/corpus.
- Deterministic tests: duplicate bytes, profile switch, byte replacement without
  Markdown changes, stale/deleted occurrences, scope admission, corrupt image
  isolation, download corruption/limits, parser parity, default/persisted settings,
  unsupported budget rejection and image-only queueing.
- Focused frontend/contracts integration: **168 tests passed across 24 files**;
  `pnpm check` passed with zero errors/warnings.
- Chrome Settings: 70 → 140 → refresh retained 140, sent no text/Atlas rebuild,
  and staged the next-launch Jina recovery preference.
- Chrome image search: temporary paste query, bounded thumbnail, keyboard result
  navigation, exact current image viewer opening, no asset import or note edit.
  Browser commands use fixtures; native source validation is tested separately.
- Full Rust library suite: **743 passed, 21 ignored, 0 failed**. The ignored
  Gemma native parity/resource/visual/migration and ANN probes were executed
  separately; unrelated opt-in live-provider and history scale probes remain
  ignored. `cargo check`, formatting and diff whitespace checks passed.
- Native Gemma migration → Jina recovery smoke passed: staging rejects reads,
  reconciled text/image results activate, retained legacy database bytes remain
  unchanged during Gemma indexing, and next-launch Jina text search recovers.
  Deterministic tests also cover source-proof rejection, read-lease/rebuild
  synchronization, and source settlement without a new embedding wake. After
  the final scoped-query correction, semantic tests passed separately: **134
  passed, 7 ignored, 0 failed**.
- Native visual fixture: eight screenshots, diagrams, trend charts, and receipts
  with 10–12 px text; independent style variants for image queries. Both budgets
  achieved **8/8 top-one** in text→image, image→text, and image→image directions.
  At the current floors, 70 admitted 6/56 hard negatives in each direction; 140
  admitted 5/56, 5/56, and 8/56 respectively. This small constructed corpus does
  not establish broad visual-search quality. [Raw results](visual-results.json).
- Separate image ANN benchmark: 3,000 synthetic 768-dimensional unit vectors,
  20 queries, 128 candidates, **99.5% recall@10** versus exact retrieval. Debug
  p50/p95: **16.81/17.32 ms ANN + SQLite reranking**, **112.25/113.54 ms full
  scan**. Initial graph build 38.60 s; embedding/preprocessing excluded.
  [Raw results](image-ann-results.json).

## Image search refined with text

An image stays attached when typing refinement text in the search bar. Gemma
receives the image and plain text in one native input sequence and returns one
normalized 768-dimensional query. Deleting the text returns to image-only
search; Clear/Escape clear both. The temporary image encoding is reused and
pending edits coalesce while inference runs. Queries remain temporary and
bounded; no new model download, indexed representation or rebuild is needed.

The native GPU probe passed at both 70 and 140 image tokens. In a two-screenshot
example, a Privacy image initially ranks itself first. Adding Network Connection
context ranks the Network screenshot first at both budgets. This verifies that
the production joint-query path responds to the text; it does not establish
broad quality improvement. [Raw results](combined-query-results.json).

35 focused store/controller tests pass, including stale joint responses,
refinement coalescing, image-only restoration and option changes during empty
text debounce. Chrome verified joint command inputs, retained preview,
Clear/Escape and keyboard image-result navigation. Semantic Rust tests passed
134 with 8 opt-in probes ignored; this native probe ran separately. Type and
Rust checks passed.

## Native resource check

Fresh isolated debug test processes used the actual Rust production provider,
not the earlier Python wrapper. Each ran 40 short text queries and 40 synthetic
image requests with a fresh cache. Raw data: [native-results.json](native-results.json).

| GPU budget | Peak RSS | Peak physical footprint | Text p95 | Image p95 |
|---|---:|---:|---:|---:|
|70|0.707 GiB|0.611 GiB|15.17 ms|164.36 ms|
|140|0.746 GiB|0.716 GiB|15.93 ms|195.22 ms|

140 added about 39.5 MiB peak RSS and 107.7 MiB peak physical footprint in these runs.
Debug preprocessing and fresh-cache startup (including SHA verification) make
these latency results different from the earlier isolated Python benchmark.
They are not release-build latency claims or total-app memory measurements.
The earlier Jina/GGUF/LiteRT before/after controls remain in
[litert-evaluation.md](litert-evaluation.md): Jina 0.352 GiB RSS; original Gemma
GGUF 1.739 GiB; Python LiteRT GPU 70 / 140: 0.734 / 0.772 GiB. Accounting/build/process
boundaries must be kept explicit when comparing them.

## Validation limits

The implementation follows the user's explicit Gemma choice. The original tiny
text fixture still reports Jina 12/12 versus Gemma 10/12 first hits, so no text
quality improvement is claimed. The new image cases extend the basic fixture,
but broader judged text/chat/Related Notes/Atlas corpora, editing responsiveness
under large live indexing, official BF16/FP32 reference parity, and execution on
other desktop architectures remain release-validation work. 140 is optional;
these results do not demonstrate that it improves all search cases.

Pinned native artifacts cover macOS ARM64, Linux ARM64/x64 and Windows x64;
actual GPU/vision execution and cross-backend compatibility were verified here
on M4/macOS only. Linux/Windows expose explicit text-only capability until vision
validation. Intel macOS/Windows ARM64 have no selected 0.18 package; retained Jina
can recover when available, otherwise keyword search remains available.

## Reproduction

Ordinary tests never download a model. For native smoke/resource probes supply
`GNEAUXGHTS_LITERT_FIXTURE` containing the pinned macOS wheel/model, the four
synthetic images from `scripts.embedding_eval.png_fixture`, and the compiled
`scripts/macos_process_memory.c` helper for resource probes.

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm check
pnpm exec vitest run src/lib/features/notepad/search src/lib/features/notepad/images src/lib/features/notepad/ui src/lib/ui/search src/lib/features/settings
GNEAUXGHTS_LITERT_FIXTURE=/path/to/fixtures cargo test --manifest-path src-tauri/Cargo.toml --lib native_provider_and_cross_backend_retrieval -- --ignored --nocapture
GNEAUXGHTS_LITERT_FIXTURE=/path/to/fixtures GNEAUXGHTS_IMAGE_TOKENS=70 cargo test --manifest-path src-tauri/Cargo.toml --lib native_resource_probe -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib image_ann_scale_probe -- --ignored --nocapture
swift -module-cache-path /tmp/gemma-swift-cache scripts/embedding_visual_fixtures.swift /path/to/fixtures/visual-fixtures
GNEAUXGHTS_LITERT_FIXTURE=/path/to/fixtures cargo test --manifest-path src-tauri/Cargo.toml --lib native_visual_quality_probe -- --ignored --nocapture
GNEAUXGHTS_LITERT_FIXTURE=/path/to/fixtures cargo test --manifest-path src-tauri/Cargo.toml --lib native_combined_image_query_probe -- --ignored --nocapture
GNEAUXGHTS_LITERT_FIXTURE=/path/to/fixtures GNEAUXGHTS_JINA_MODEL=/path/to/jina.gguf cargo test --manifest-path src-tauri/Cargo.toml --lib native_generation_migration_and_jina_recovery -- --ignored --nocapture
pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/settings.spec.ts --mochaOpts.grep 'higher image budget'
```
