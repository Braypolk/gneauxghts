# EmbeddingGemma 2: text and image search

Status: ready-for-human
Updated: 2026-10-06

## Outcome and scope

Replace the current Jina text encoder with EmbeddingGemma 2 and add both directions of image search, as requested:

- A text query finds relevant note passages and images embedded in notes.
- A user can paste, drop, or choose an image as a temporary search query and find related images and note passages.
- Image results show a thumbnail, the containing note, and a route to the exact current image occurrence in the existing viewer/editor.

Index current, local image embeds in ordinary notes in the Running Vault. Preserve existing remembered-chat text recall. Remote image URLs, unreferenced asset files, chat attachments, historical image bytes, audio, and video ingestion are outside this first release. Existing textual search scopes and document eligibility still apply; an image query has no lexical matches and must explain when semantic search is unavailable.

The selected implementation target is the 440M text-and-vision-only LiteRT package. Earlier approval to download a combined projector applied to the GGUF evaluation; it does not require shipping unused audio weights. This round includes no audio input, decoding, indexing, queries, playback, or UI.

Keep Related Notes and Atlas based on text note aggregates in this release, regenerated with Gemma. Image search does not automatically add image vectors to those aggregates. Evaluate that separately rather than allowing image count to alter note geometry accidentally. Agent evidence remains canonical text passages: an image similarity result must not become a fabricated quotation or a claim that an agent inspected pixels.

## Runtime decision

Target the [LiteRT text/vision 440M package](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm), following the user's measured-resource choice. The runtime bridge remains app-owned and must integrate with the existing semantic provider/lifecycle seam. Preserve the trained projection/pooling and native 768-dimensional normalized output. Google's text query/document prefixes replace Jina's prefixes; image-only inputs have no task prefix. See [verified runtime details](runtime-research.md) and the [local LiteRT measurements](litert-evaluation.md).

**Backend policy:** prefer GPU execution for text and vision on platforms where initialization succeeds and support is validated. Fall back to CPU after GPU initialization failure, release the failed attempt's resources, and report the actual active backend. Do not run resident CPU/GPU copies simultaneously. Do not treat invalid inputs, missing/corrupt artifacts, or cancellation as reasons to retry on another backend. CPU/GPU vectors are close but not identical in the current fixture: validate cross-backend retrieval/index compatibility before sharing a representation identity, or migrate under a distinct identity. Startup fallback must preserve that compatibility contract.

Pin the package/runtime revisions and checksums in [the manifest](runtime-manifest.json); the evaluated native Python wheel is a spike dependency, not the product's packaging design. The LiteRT integration requires a packaged runtime bridge, supported-platform checks, and deterministic tests for GPU initialization success/failure, cleanup, CPU fallback, and incompatible-index handling. Ordinary search never installs executable code; setup remains explicit in Settings. The earlier llama.cpp artifacts remain comparison controls.

**Validation:** local CPU/GPU vector/resource, migration/recovery, visual-fixture and ordinary contract checks passed on M4/macOS. The user authorized Gemma implementation with the measured quality limits. Preserve Jina files for recovery; broader corpus, reference and platform validation remains incomplete. The 70-token vision setting is the default; 140 is optional.

Index pure image vectors and separate text passage vectors. The user subsequently requested combined image+text query refinement; this query-only extension is implemented and locally evaluated. Contextual text+image vectors for indexed content remain deferred until a judged evaluation shows a benefit. No captions, OCR service, or generative vision model is required for this feature; embedding quality on screenshots, diagrams, and small text must be tested rather than assumed.

## Architecture and ownership

The semantic backend owns inventory, embedding jobs, durable vectors, compatibility, and search. Extend the current provider seam to accept typed text and image inputs with a query/document purpose where appropriate. The provider hides prompts, data-URI encoding, preprocessing, runtime transport, projection, normalization, resource limits, and lifecycle. Expose a small capability/status surface rather than runtime details to callers. Do not add speculative audio/video APIs or a general plugin system.

The existing semantic worker owns media work and coalescing. Start with serialized image work and bounded text batches, prioritizing interactive queries between jobs. Image inputs must fit a tested LiteRT signature; reject oversized images before expensive work. Text uses native chunk-and-average overflow so long remembered passages preserve their anchors and all input tokens without truncation. For GGUF comparison controls, a noncausal input must fit one microbatch. Replace assumptions derived from Jina's last-token pooling with explicit text/image token budgets. Retain bounded retries and shutdown cleanup through the actual owned runtime seam in this checkout.

NoteTimeline remains the owner of authored note publication. Deriving image references does not mutate Markdown or history. Asset resolution must remain inside the Running Vault's canonical assets directory and reject traversal and symlink escapes. Extract the existing backend resolver into a shared internal location if needed; do not duplicate a weaker resolver for indexing.

### Representation identity and migration

Introduce a representation identity that covers encoder and projector artifact revisions, quantization, output dimensions, pooling/projection policy, text prompt revision, and image preprocessing/token-budget revision. Text and image cache keys distinguish their inputs while declaring compatibility with the same embedding space. A vision-preprocessing-only change should rebuild image vectors, not unchanged text vectors. A backbone/prompt change must invalidate affected text and image vectors even when dimensions remain 768.

Current `prepare_note_content` and `prepare_chat_recall_content` reuse embeddings by text hash alone; the existing Rebuild action is insufficient for changing models. Compatibility must participate in every reuse decision, durable row lookup, ANN manifest, aggregate, edge, and naming cache.

Build the replacement text corpus in a staging generation, including remembered-chat excerpts from ChatService. Regenerate chunk ANN, text note aggregates/note ANN, Related Notes edges, Atlas geometry, and descriptor/name caches with their appropriate compatibility versions. Do not mix Jina document vectors with Gemma queries.

Use one runtime during migration to avoid assuming enough memory for two resident models. While the candidate runtime builds its staging corpus, keep keyword search available and mark retained results stale/rebuilding; new semantic requests report migration coverage instead of querying Jina vectors with Gemma. Preserve the previous durable generation and model files for rollback. A failed migration leaves those files intact and can restart the previous provider. Resume interrupted staging work only when its representation and source identities still match.

Activate a coherent provider/index/database generation through the semantic backend's synchronization boundary; readers capture one immutable compatible bundle. Reconcile edits, forget/recovery, renames, and deletions arriving during migration before exposing a generation as current. Atlas publishes through its existing immutable publication owner and can report rebuilding independently while derived geometry catches up. Old generations are collected only after activation and reader release. Retaining an old display never permits activation against stale source identity.

### Image inventory and indexing

Derive a complete-document image inventory in the backend for open and closed notes. Match the current editor's wiki embeds and inline/reference Markdown embeds, including escaping, code/comment exclusions, URL decoding, and dimensions. Share fixture cases across the frontend/backend parsers rather than using a broad regex. Persist occurrences against stable Note Identity, current note content hash, relative asset name, and source range/anchor.

Maintain reverse asset-to-note references. Note edits update occurrences; byte changes, replacements, rename/removal, and recovery of an asset invalidate its vectors and referring results even when the note Markdown is unchanged. Extend watcher handling and periodic reconciliation beyond Markdown files. Metadata size/mtime is a change hint; a byte content hash is the cache identity. Capture source bytes and verify identity before publishing derived output. Duplicate bytes share one image embedding, while each eligible occurrence remains independently navigable.

Start with PNG, JPEG, and static WebP. Normalize EXIF orientation and use a fixed, versioned alpha/background policy; preserve geometry and let the verified model preprocessor perform its expected resize/patchification. Bound encoded bytes, decoded pixels, queued bytes, and token budget. Treat animated GIF, SVG, AVIF, BMP, missing, corrupt, or oversized images as explicit unsupported/failed coverage in v1; the viewer can continue supporting them. Do not turn one bad image into failure of a note's text indexing.

Store image records and their ANN separately from textual chunk records, using the same compatible embedding space. Each record has modality, source identity, representation identity, and typed locator. Image locators identify an asset version and note occurrence; they are not passage quotations or artificial line excerpts. Removing the final embed makes the asset ineligible for search but does not delete asset bytes.

### Search and presentation

Text queries search lexical passages, Gemma text vectors, and Gemma image vectors. Image queries use the same preprocessing as indexed images, then search both vector indexes. Apply eligibility, vault/note/folder/document scope, and source revalidation before delivery. The image corpus contains ordinary-note occurrences only; queries scoped solely to remembered chats still search their text vectors.

Rank each retrieval channel independently and fuse ranks using the existing hybrid approach extended for the image channel. Limit repeated occurrences from one note/asset and calibrate modality-specific admission thresholds. Do not add uncalibrated raw image cosine scores to existing Jina weights or inherit Jina's `0.18` floor. Group repeated hits meaningfully while retaining the matching image occurrence. Literal/regex/current-note find stays textual.

Add a typed query command and result union without changing the meaning of text passage fields. Results carry either passage coordinates or image occurrence metadata. Preserve text-only evidence APIs; introducing images into agent evidence requires a separate pixel-delivery/citation contract.

Use the shared SearchBar/SearchDock and notepad search store. Add an image-query button plus paste/drop support, a query thumbnail and clear action, accessible keyboard behavior, cancellation, and existing focus-return behavior. A pasted/chosen query is temporary, bounded input; it does not import an asset or create a note. Do not persist query bytes in search history/logs, and release previews/temp resources on replacement, cancellation, vault lifetime change, and shutdown. Handle image clipboard/drop in the search target without stealing the editor's paste/import gestures.

Use the existing bounded image asset loader for result thumbnails. Opening an image result rechecks the note content and asset version, then navigates to its occurrence and uses the current document's viewer inventory. Changed/deleted occurrences refresh or fail gracefully instead of opening an unrelated image at an old range.

Settings distinguishes text readiness, image capability, indexed/unsupported/failed image coverage, migration progress, and retry. A vision failure leaves compatible Gemma text search usable. Platform builds without validated vision support expose text-only capability explicitly rather than returning misleading image results. Bundled audio weights do not expose an audio feature.

## Delivery order

| Ticket | Deliverable | Dependencies |
| --- | --- | --- |
| [01](issues/01-verify-runtime.md) | LiteRT GPU/CPU parity, quality, platform, and resource verification | None |
| [02](issues/02-provider-and-setup.md) | Text/image provider, pinned setup, budgets, lifecycle | 01 |
| [03](issues/03-compatible-index-migration.md) | Resumable representation-aware Jina→Gemma migration | 02 |
| [04](issues/04-image-inventory.md) | Backend image inventory, secure resolution, asset reconciliation | None; can proceed alongside 01–03 |
| [05](issues/05-image-index.md) | Deduplicated image vectors, ANN, coverage, incremental updates | 02, 03, 04 |
| [06](issues/06-multimodal-retrieval.md) | Text/image queries, scoped typed results, ranking | 05 |
| [07](issues/07-search-ui.md) | Image query controls, thumbnails, navigation, status | 06; fixtures can start earlier |
| [08](issues/08-evaluation-and-rollout.md) | Regression/evaluation gates and staged release documentation | 03, 05, 06, 07 |

2026-10-06 implementation decision: the user explicitly selected Gemma LiteRT,
GPU preference, default 70 image tokens, and optional 140 in Settings after the
memory/quality comparison. This choice supersedes the earlier instruction to
retain Jina solely because the tiny text fixture failed its rollout threshold;
it does not establish a passed quality gate. The runtime, staged migration/recovery, image ANN, rank fusion, coverage, and
image-search UI are implemented. See [implementation and validation](implementation.md)
for implementation details, exact test evidence, and unresolved release-validation
limits.

## Validation and release gates

- Fixed reference fixtures prove text/image vectors are 768-dimensional, finite and normalized, prompts/pooling match the reference, different images affect output, and encoding/order remains correct. Quantized versus reference retrieval passes a documented tolerance/ranking check.
- Compare Jina and Gemma on the same judged text queries, remembered-chat recall, Related Notes and Atlas cases. Define baseline-relative acceptance thresholds before examining candidate results. Judge image→image, text→image, and image→text positives plus hard negatives, diagrams/screenshots and images with text. No leaderboard score substitutes for these app measurements.
- Measure warm/cold text and image p50/p95 latency, ingestion throughput, installed/download size, peak RAM/VRAM, idle footprint, and editing responsiveness under indexing on target hardware. Set budgets in ticket 01 from the measured baseline and intended device envelope; do not claim a speed advantage from parameter counts. Benchmark the actual bundled projector shipped.
- Automated contracts cover model changes with identical dimensions/hashes, interrupted/restarted migration, concurrent edits, rollback, stale source rejection, parser parity, duplicate images, unsafe paths, byte replacement without Markdown changes, corrupt/oversized media, deletion/forget/recovery, and cross-vault isolation.
- Browser/native checks cover typed results, query cancellation/replacement, paste/drop focus, navigation, viewer revalidation, Settings retry/coverage, and lexical fallback. Run appropriate Rust tests, `pnpm check`, focused Vitest/browser/native suites, and the real-runtime smoke/evaluation separately; ordinary tests use a deterministic provider and do not download models.
- Audio/video functionality remains disabled; ship the selected text/vision-only package. The original baseline-relative release rule required retaining Jina on any failed quality gate. The user subsequently authorized Gemma implementation despite the small text-fixture regression; preserve the previous Jina generation for next-launch recovery and retain the failed-gate evidence. Broader quality and platform validation is not declared passed.

## Path to audio and video

The shared space and typed media records reduce later retrieval plumbing. Preserve modality and a versioned source-locator boundary so future frame/time segments can be introduced without masquerading as text passages. Do not implement empty audio/video variants now.

Video could reuse a compatible vision encoder but still needs decoding, frame sampling, temporal segments, token budgets, deduplication, and time-aware navigation. Audio would require adding its encoder and decoding/resampling, segmentation, timestamped results, playback, and measured workload budgets. Add those capabilities in a future round; reuse text/image vectors only if artifact and preprocessing compatibility is proven.

[Audio runtime research](audio-runtime-research.md) is retained as a future reference only, not a dependency or acceptance gate for this round.

## Implementation and evaluation result (2026-10-06)

The earlier GGUF spike failed the predeclared tiny text recall gate (10/12 first
results versus Jina's 12/12); that historical evaluation did not switch production.
The user subsequently selected the substantially smaller text/vision-only LiteRT
runtime, GPU preference, default 70 tokens and optional 140, and explicitly
requested implementation. The selected plan is implemented with retained Jina
recovery. This decision supersedes the original mandatory Jina-retention gate as
an implementation constraint; it does not erase the measured text regressions or
claim broad quality/platform release validation. See [implementation](implementation.md)
and the raw linked results for current evidence and limits.

## Repository and source grounding

- Runtime: `src-tauri/src/semantic/embed.rs`, `owned_process.rs`, `runtime_install.rs`.
- Index/publication: `semantic/indexer.rs`, `db.rs`, `mod.rs`, `ann.rs`, `note_ann.rs`, `similarity.rs`, `related.rs`, `atlas/publication.rs`, `atlas_labels/topic_names.rs`.
- Assets/current sources: `commands/asset_commands.rs`, `vault_watcher.rs`, `services/note_timeline/`, `src/lib/features/notepad/images/imageEmbedParser.ts` and current loader/viewer modules.
- Search/UI: `commands/search_commands.rs`, `services/evidence.rs`, `src/lib/types/semantic.ts`, `features/notepad/search/`, `ui/search/`, `features/settings/SemanticSettingsPanel.svelte`.
- Follow [ARCHITECTURE](../../ARCHITECTURE.md), [behavior invariants](../../docs/architecture/behavior-invariants.md), and the applicable ADRs before implementing persistence/publication changes. Existing workspace changes must be preserved.
- Primary runtime/API/artifact evidence for this round is in [runtime-research](runtime-research.md). Text model comparison and migration inspection are in [earlier evaluation](../embeddinggemma-2-evaluation/research.md); resource comparisons are in [alternatives research](../embedding-model-alternatives/research.md).
