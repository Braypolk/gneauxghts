# Local embedding alternatives for Gneauxghts

Researched 2026-10-06. Research only; no implementation, installed model, or index changes.

## Recommendation

There are credible alternatives, but our Jina v5 nano retrieval checkpoint is already competitive for its footprint. Test **Jina v5 small retrieval** as the conservative quality upgrade, **Qwen3 Embedding 4B** as the higher-quality ceiling, and **Qwen3 Embedding 0.6B** as the practical Apache-licensed option. **IBM Granite 311M multilingual R2** deserves an additional efficiency experiment: small, permissively licensed, long context, and retrieval-focused, with more deployment verification needed.

This is a proposed evaluation order, not an observed ranking on our notes. Retrieval, Related notes, chat recall, and Atlas relationships need separate judgments.

## Published retrieval evidence

The following uses Jina's report Table 4 so the benchmark names and selection are aligned. It combines published leaderboard numbers with some author evaluations; it is not one independent controlled experiment. Higher is better, nDCG percentages. RTEB here includes public tasks only.

| Model | MTEB English v2 retrieval | MTEB multilingual v2 retrieval | Public RTEB | BEIR | LongEmbed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current Jina v5 nano | 58.80 | 63.26 | 64.08 | 56.06 | 63.65 |
| Jina v5 small | 60.07 | 64.88 | 66.84 | 56.67 | 66.39 |
| Qwen3 Embedding 0.6B | 61.83 | 64.65 | 64.21 | 55.52 | 72.20 |
| Qwen3 Embedding 4B | 68.46 | 69.60 | 70.77 | 61.58 | 78.82 |
| KaLM mini instruct v2.5 | 58.45 | 57.90 | 56.51 | 55.00 | 43.35 |
| EmbeddingGemma 300M | 55.69 | 62.49 | 63.75 | 53.69 | 55.29 |

Source: [Jina technical report](https://arxiv.org/html/2602.15547v1), Tables 2–4. General MTEB means use Jina's different task adapters; our merged retrieval checkpoint uses one. Qwen results with dataset-specific instructions can overstate what one generic app instruction achieves. Full-precision benchmark scores do not measure candidate GGUF quality or latency.

Qwen's own card reports English v2 overall/retrieval 70.70/61.83 for 0.6B and 74.60/68.46 for 4B; multilingual overall/retrieval 64.33/64.64 and 69.45/69.60. Overall averages are useful for broader functionality but should not replace retrieval-specific comparisons. [Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B)

## Practical shortlist

| Candidate | Parameters | Context / full dimensions | Weight license | GGUF download examples | Assessment |
| --- | --- | --- | --- | --- | --- |
| Jina v5 small retrieval | 677M family, ~596M merged backbone | 32K / 1024; MRL includes 768 | CC BY-NC 4.0 | Q6_K 495 MB; Q8_0 639 MB | Modest measured benchmark gains over nano across these retrieval suites; familiar prompts and pooling |
| Qwen3 Embedding 4B | 4B | 32K / 2560; supports shortening | Apache 2.0 | Q4_K_M 2.50 GB; Q6_K 3.31 GB; Q8_0 4.28 GB | Clearest quality gain, substantially heavier local default |
| Qwen3 Embedding 0.6B | 596M / marketed 0.6B | 32K / 1024; supports 32–1024 | Apache 2.0 | Q8_0 639 MB | Strong English/long retrieval; less convincing universal upgrade over nano |
| Granite 311M multilingual R2 | 311M | 32K / 768; MRL to 128 | Apache 2.0 | No first-party GGUF artifact verified | Attractive small candidate; verify conversion and reference parity |

Jina retains `Query: ` / `Document: ` prefixes and last-token pooling. [Jina small card](https://huggingface.co/jinaai/jina-embeddings-v5-text-small), [retrieval checkpoint](https://huggingface.co/jinaai/jina-embeddings-v5-text-small-retrieval), [official GGUF](https://huggingface.co/jinaai/jina-embeddings-v5-text-small-retrieval-GGUF). The 677M family parameter count includes four adapters; the merged retrieval artifact does not retain four independently selectable adapters. The download size reflects that distinction.

Qwen publishes official GGUFs and embedding commands using `--pooling last`; retrieval queries use an instruction and documents do not. Compare a sensible fixed notes instruction, not benchmark-specific instructions. [Official 0.6B GGUF](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF), [official 4B GGUF](https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF)

IBM's April 29, 2026 release uses ModernBERT, CLS pooling, and no query/document prefix in its examples. It reports **65.2 on Multilingual MTEB Retrieval, 18 tasks**, and 56.3 averaged across its retrieval suites. These subsets differ from the Jina table, so the numbers cannot establish a head-to-head win. IBM supplies ONNX/OpenVINO weights and explicit llama.cpp conversion instructions. Upstream llama.cpp contains a ModernBERT model class. No conversion or runtime test was performed here. [IBM card](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2), [llama.cpp source](https://github.com/ggml-org/llama.cpp/blob/master/src/llama-model.cpp)

All file sizes above are weight download sizes, **not peak runtime RAM**. Context, batching, activations, process overhead, CPU/GPU placement, and simultaneous agent models also matter. No controlled desktop memory or latency measurements were found for our exact candidates. A 4B Q4 quality score cannot be inferred from its full-precision benchmark.

## Why the other familiar choices are lower priority

- **EmbeddingGemma 300M:** original model remains useful as a mature on-device comparator, but its published retrieval scores do not beat nano. Google reports quantized evaluation results, which help screen quantization effects. Its 2K context is shorter than our current model. [Google card](https://huggingface.co/google/embeddinggemma-300m)
- **EmbeddingGemma 2:** promising licensing and code/multimodal features, but no established general text retrieval gain over Jina. See the [earlier evaluation](../embeddinggemma-2-evaluation/research.md).
- **KaLM mini v2.5:** 494M, Apache 2.0, Qwen2 backbone. Its English clustering results make it potentially interesting for Atlas; retrieval results above do not justify prioritizing it for search. First-party GGUF conversion/parity not verified. [KaLM card](https://huggingface.co/KaLM-Embedding/KaLM-embedding-multilingual-mini-instruct-v2.5)
- **BGE-M3:** 1024d, 8K, MIT, with dense, sparse, and multi-vector capabilities. Its special value requires more than swapping our dense provider. It is not the leading dense-only replacement candidate from the evidence reviewed. [BAAI card](https://huggingface.co/BAAI/bge-m3)
- **Nomic Embed v2 MoE:** official GGUF available, 475M total/305M active, 768d to 256d, but only 512-token context. Q6_K is 397 MB, Q8_0 512 MB. Sparse activation does not make total weights disappear from memory. Lower priority when our ingestion can use longer inputs. [Nomic card](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe), [official GGUF](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF)
- **Snowflake Arctic L v2:** a credible retrieval baseline, but the aligned Jina report has English retrieval 58.56 and multilingual 58.36, below nano on both. Older BEIR/MIRACL marketing numbers use different selections and cannot establish a modern improvement. [Snowflake card](https://huggingface.co/Snowflake/snowflake-arctic-embed-l-v2.0)

## Repository evaluation gate

Our provider pins `jinaai/jina-embeddings-v5-text-nano-retrieval`, Q6_K, and 768 dimensions in [embed.rs](../../src-tauri/src/semantic/embed.rs). All candidates require fresh embeddings; equal dimensions do not make representations compatible. The earlier evaluation documents rebuild reuse and similarity-threshold risks.

Benchmark current nano Q6_K against small Q6_K, Qwen 0.6B Q8_0, Qwen 4B Q6_K (Q4 only as a measured additional condition), and converted Granite at high precision before quantizing. Keep note chunking and search composition constant. Judge top-5/top-10 results, hard negatives, Related notes, chat recall, and Atlas separately. Record query latency, initial indexing throughput, and peak memory while the normal agent model is resident. Decide acceptable quality/footprint tradeoffs before implementing migration.

## Speed/resource comparison: Qwen 0.6B versus EmbeddingGemma 2

Follow-up researched 2026-10-06. No controlled same-hardware, same-runtime text latency comparison between these two models was found in the primary sources reviewed. For Gneauxghts' short note chunks, **EmbeddingGemma 2 text-only is the expected lighter and faster option**, but this is an architecture/weight-footprint inference, not an observed speed ratio or peak-RAM measurement. Qwen has 28 layers and approximately 600M total parameters; Gemma 2 text-only has 270M, comprising 130M transformer and 140M token-embedding parameters. Parameters in an embedding table have a different per-token computation cost from transformer parameters, so total parameter ratios alone do not predict latency. [Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [Qwen configuration](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/blob/main/config.json), [Google LiteRT card](https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm)

Google publishes actual **EmbeddingGemma 2** text measurements using LiteRT, its INT4 QAT text weights, and the 128-token text signature. On a MacBook Pro M5 it reports 31.3 ms CPU / 165 MB and 9.5 ms GPU / 233 MB. Latency averages five iterations. Mac memory uses physical footprint, includes CPU/GPU memory, and is measured on the second cached load. These values do **not** forecast our Q8 GGUF llama.cpp allocations, 8,192-token configured context, or indexing throughput. Other platforms use different memory metrics, often excluding accelerator memory. [Google LiteRT card](https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm)

The Google Edge blog's 37.3 ms Mac GPU result is **vision**, not text; older EmbeddingGemma 300M results and cloud Gemini Embedding results also do not measure Gemma 2 text. Load only the text encoder for a text-only comparison; optional vision/audio encoders add resources. [Google Edge launch](https://developers.googleblog.com/en/google-ai-edge-with-embeddinggemma-2/), [Google developer guide](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)

For the same number of float32 vectors, Qwen's native 1,024 dimensions occupy 4,096 bytes each versus Gemma's 768 dimensions at 3,072 bytes: 33% more raw vector storage. Both support shortening vectors, so at 768 dimensions their raw-vector storage is equal. Shortening the output does not proportionally shrink the transformer computation or model weights. [Qwen card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [Google developer guide](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)
