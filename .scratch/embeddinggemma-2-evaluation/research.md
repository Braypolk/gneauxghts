# EmbeddingGemma 2 replacement evaluation

> Historical model comparison. Its description of the then-current Jina provider
> predates the approved LiteRT implementation. See the
> [selected plan](../embeddinggemma-2/spec.md) for the later decision and limits.

Evaluated: 2026-10-06. Research only; no implementation or installed model changes.

## Recommendation

EmbeddingGemma 2 is a technically plausible local replacement for Jina v5 text nano retrieval. Its clearest advantages are Apache 2.0 licensing and optional multimodal retrieval. Published general text results do not establish a quality upgrade over our Jina model. Evaluate the actual quantized text-only model on representative note retrieval, related-note suggestions, chat recall, and Atlas relationships before selecting it.

## Model comparison

| Property | Current Jina v5 text nano retrieval | EmbeddingGemma 2 |
| --- | --- | --- |
| Text parameters | 239M | 270M |
| Full model parameters | Text only | 740M; vision and audio optional |
| Context | 8,192 tokens | 8,192 tokens |
| Output | 768 dimensions | 768 dimensions |
| Supported truncation | 32, 64, 128, 256, 512, 768 | 128, 256, 512, 768 |
| Pooling | Last token | Mean plus 512→768 projection |
| Query prefix | `Query: ` | `task: search result \| query: ` |
| Document format | `Document: {content}` | `title: {title} \| text: {content}`; `none` for absent title |
| Weight license | CC BY-NC 4.0 | Apache 2.0 |

Sources: [Jina retrieval model card](https://huggingface.co/jinaai/jina-embeddings-v5-text-nano-retrieval), [Google model card](https://huggingface.co/google/embeddinggemma-2). Google warns against float16 inference; use bfloat16 or float32, and validate quantized outputs. Shortened vectors require normalization. Google's text-only loading omits vision/audio encoders. [Google developer guide](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)

## What the benchmark claims establish

| Published benchmark | Jina v5 text nano | EmbeddingGemma 2 |
| --- | --- | --- |
| MTEB multilingual v2, mean(task) | 65.5 | 61.36 |
| MTEB English v2, mean(task) | 71.0 | 68.46 |
| MTEB code v1 | Not found in reviewed first-party Jina sources | 78.68 |

Jina figures: [Jina nano model card](https://huggingface.co/jinaai/jina-embeddings-v5-text-nano), [Jina technical report](https://arxiv.org/html/2602.15547v1). Google figures: [Google model card](https://huggingface.co/google/embeddinggemma-2).

Google's approximately 14% code improvement is relative to EmbeddingGemma 1 (68.76), and multilingual text changes from 61.15 to 61.36. Those comparisons do not establish improvement over Jina. General Jina averages combine task-specific adapters; our retrieval-only merged checkpoint uses one adapter for all application operations. Vendor-reported full-precision averages are also not measurements of our Q6_K deployment or a candidate GGUF. These figures are useful screening evidence, not a controlled application head-to-head. [Jina report](https://arxiv.org/html/2602.15547v1), [Google guide](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)

## llama.cpp and artifacts

Upstream support for text, vision, and audio merged on October 6 in [llama.cpp PR 30054](https://github.com/ggml-org/llama.cpp/pull/30054), merge commit `4fbc76d` (PR head `1e91a0b`). The runtime maintainers publish [embeddinggemma-2-GGUF](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF), identifying architecture `gemma-embedding2`, Q8_0 at approximately 310 MB and BF16 at approximately 558 MB. These are weight download sizes, not measured peak process RAM or retrieval latency.

Our pinned `b11312` [release](https://github.com/ggml-org/llama.cpp/releases/tag/b11312) is dated October 1, commit `0c1e570`, and predates the support merge. A runtime containing the new architecture support is required; merely replacing the GGUF will not suffice. Exact replacement release and per-platform checksums were not selected in this research.

For Gneauxghts, text-only loading is the appropriate initial experiment. Similar parameter count does not prove similar latency: tokenizer, backbone, pooling, quantization, batching, and hardware differ. No controlled Jina-versus-EmbeddingGemma-2 desktop memory/throughput measurement was found. The optional multimodal modules introduce ingestion work beyond switching the existing text provider.

## Repository integration findings

These findings were inspected by the parent research task against the current workspace.

- [embed.rs](../../src-tauri/src/semantic/embed.rs) pins the Jina Q6_K checkpoint, `Query: `/`Document: ` formatting, and `--pooling last`. A replacement must change prompts, pooling, metadata, model artifact pin, and runtime pin together.
- [similarity.rs](../../src-tauri/src/semantic/similarity.rs) explicitly calibrates the similarity floor of `0.18` for Jina. Retune against meaningful positives and negatives; retaining dimensions does not retain score distribution.
- [indexer.rs](../../src-tauri/src/semantic/indexer.rs) reuses note chunks and chat recall chunks by text hash without checking embedding-model identity. The current Rebuild path force-scans but still reuses unchanged vectors. A safe migration must invalidate and re-embed both corpora, then regenerate note aggregates, ANN indexes, edges, Atlas, and relevant labels/caches.
- Model fingerprints currently cover model filename/ID/dimensions for some label caching, but omit prompt/pooling revision. Establish one representation identity that includes those choices before allowing model swaps.
- The provider contract has Document/Query modes, and Atlas topic descriptors use Document mode. Validate symmetric note relationships and topic matching separately from asymmetric query retrieval.

Equal vector dimensions do not make the embedding spaces interchangeable. Never compare an EmbeddingGemma query with stored Jina vectors.

## Suggested evaluation gate

Use a separate disposable index with unchanged chunking and retrieval composition. Compare current Jina Q6_K with a pinned EmbeddingGemma 2 Q8_0 (and optionally BF16 reference) on the same judged queries. Measure top-5/top-10 recall and ranking, hard negatives, multilingual/code notes where relevant, related-note relationships, chat recall, Atlas grouping, initial indexing throughput, query latency, and resident/peak memory. Check all returned vectors for expected dimensions and finite values. Only migrate after deciding acceptable quality/performance tradeoffs and proving no old vectors survive model identity changes or interrupted rebuilds.

EmbeddingGemma 2 is the open on-device model reviewed here. Gemini Embedding 2 is a distinct hosted Google embedding product; its benchmarks and deployment assumptions must not be substituted for these findings.
