# EmbeddingGemma 2 runtime feasibility

Verified 2026-10-06 against upstream source; planning research only. No models downloaded or runtime executed.

Scope clarification: the user accepts the bundled audio weights. This round implements text/image only, so selective vision-only loading is not required. Measure actual download/RAM cost; audio functionality is future work.

## Supported llama.cpp path

Support merged as `4fbc76d` in [PR 30054](https://github.com/ggml-org/llama.cpp/pull/30054). Pin a release containing this commit rather than the app's older runtime. The [server documentation at that commit](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/server/README.md#post-v1embeddings-openai-compatible-embeddings-api) explicitly supports multimodal `/v1/embeddings`: each input object produces one Euclidean-normalized pooled embedding. Use `--embedding --pooling mean`, a matching `--mmproj`, and check `/models` multimodal capability.

```json
{
  "input": [{
    "content": [{
      "type": "image_url",
      "image_url": {"url": "data:image/jpeg;base64,..."}
    }]
  }],
  "encoding_format": "float"
}
```

Text inputs remain strings, using `task: search result | query: ...` for search queries and `title: TITLE | text: ...` for documents (`none` when absent). Do not add a task prefix to image-only inputs. The low-level `/embedding` route also supports `prompt_string` plus ordered `multimodal_data` and MTMD media markers, but the structured route avoids managing placeholders ourselves. Legacy `image_data` examples are unsuitable. For app-owned local bytes, use data URIs rather than making the server fetch remote URLs or exposing unrestricted local file access.

The image-only request above serves both an indexed image and an image-as-query: Google specifies no task prefix for either. Cross-modal retrieval then compares that image vector against text document/image vectors in the same representation generation. Optional mixed text/image records use ordered parts, for example:

```json
{
  "input": [{"content": [
    {"type": "text", "text": "title: Trail gear | text: Waterproof running shoes. "},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
  ]}],
  "encoding_format": "float"
}
```

For a mixed query, replace the document text part with `task: search result | query: Find similar shoes. ` and retain the image part. Keep image-only asset vectors as the initial authoritative image representation; evaluate contextual mixed vectors separately before adopting them because captions can dominate matching. The server part converter must supply media markers; do not duplicate Google's `<|image|>` manually in these structured requests.

The [model graph](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/src/models/gemma-embedding2.cpp) includes the trained output projection; its comment explains that projecting per token is equivalent to projecting after mean pooling. Expect 768 finite normalized outputs. Verify this against Google's reference and ensure different images affect embeddings; API acceptance alone is insufficient.

## Artifact and memory caveat

The [official GGUF repository](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/tree/main) publishes text GGUF and paired `mmproj-embeddinggemma-2-{Q8_0,BF16}.gguf`. Its [conversion log](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/blob/main/convert.log) contains both audio `a.*` and vision `v.*` tensors in the projector, approximately 555 MB Q8 or 982 MB BF16. The [MTMD loader](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/mtmd/mtmd.cpp) receives both vision and audio contexts. No CLI switch to exclude audio from this combined artifact was identified. The user accepts this unused bundled audio footprint. Measure the full artifact and actual process memory rather than claiming a 440M vision-only deployment; selective loading or a separate vision-only conversion is unnecessary for this round.

## Scheduling constraints

EmbeddingGemma 2 uses noncausal attention. [Server source](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/server/server-context.cpp) prevents splitting such embedding requests across microbatches: the complete text plus encoded image must fit one `n_ubatch`. It caps image token budget to half the microbatch to reserve text space. This differs from our last-token Jina runtime. Start with bounded, single-image records, explicit batch/microbatch budgets, serialized media work, and priority for interactive text queries. Array input is documented; safe mixed batching/concurrency, quantization parity, actual latency and peak memory remain experimental gates.

## Runtime alternative and later media

[LiteRT text-vision 440M](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm) is a real maintained artifact. The [family specification](https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm) lists a 388 MB package, INT4 QAT text plus INT8 QAT vision, on-demand modality loading, and automatic image scaling/patchification. It offers the strongest documented image-only resource story. It would require a new embedding runtime bridge, platform packaging and vector-parity verification; it is a fallback to evaluate, not a drop-in replacement for our sidecar.

[Google's model card](https://huggingface.co/google/embeddinggemma-2) describes one shared 768-dimensional space; images default to 280 tokens, video to 140 per sampled frame at 1 FPS. Audio has its own 300M encoder. This makes later audio/video feasible, but still requires file decoding, segment/frame selection, timestamps, bounded token budgets and lifecycle handling. Plan extensible media records now without shipping audio/video ingestion. Task prompts and preprocessing revisions belong in representation identity because they can change vectors.
