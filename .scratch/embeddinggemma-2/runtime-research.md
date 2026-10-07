# Verified runtime facts

Updated: 2026-10-06
Production decision: no adoption; see [the failed evaluation](evaluation.md).

[llama.cpp merge 4fbc76d](https://github.com/ggml-org/llama.cpp/commit/4fbc76dec51d0add466f0210855c0596589b60d4)
adds EmbeddingGemma 2 support. The GitHub compare API established that
[`b11454`](https://github.com/ggml-org/llama.cpp/releases/tag/b11454), revision
`4625240437c6821ee5c2da99e12d4817c6a8f07f`, contains that merge. The initially
examined `b11433` and latest stable `v0.6.0` did not. The native artifact reports
`0.6.0-dev`, build 11454, commit `462524043`. Release ancestry must be verified;
the latest stable label alone is insufficient.

[Pinned server documentation](https://github.com/ggml-org/llama.cpp/blob/4625240437c6821ee5c2da99e12d4817c6a8f07f/tools/server/README.md)
supports structured image-only content in `/v1/embeddings` with a loaded matching
`--mmproj` and a non-`none` pooling policy. The actual native test used:

```json
{
  "input": [
    {"content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}]}
  ],
  "encoding_format": "float"
}
```

[Google's model instructions](https://huggingface.co/google/embeddinggemma-2)
specify task prefixes for text and none for pure images. The test used search
query and untitled-document formatting, mean pooling, trained GGUF projection,
and the native 768-dimensional output without truncation. Q8 and F16 outputs
were checked for unit length and finite values.

The [published Unsloth GGUF artifacts](https://huggingface.co/unsloth/embeddinggemma-2-GGUF/tree/ba3888272494be64ed88c9eb536ddc61a1be73d5)
were pinned to `ba3888272494be64ed88c9eb536ddc61a1be73d5`; exact file hashes and
six platform runtime archive hashes are in [the manifest](runtime-manifest.json).
All three downloaded GGUF hashes and the native archive digest were verified
before native launch. Hash availability for the other platforms is not native
validation on those platforms.

The published F16 projector is 980,895,232 bytes and includes vision/audio
weights. Startup initialized an audio context despite only exercising text and
vision. Its resident footprint was measured with the projector loaded. A
vision-only converter or selective-loading requirement was not introduced.

Runtime defaults initially advertised a maximum 1,120 image tokens and clamped
it under a 2,048 microbatch. The final explicit min/max 280-soft-token setup
generated 298-token image sequences including wrappers. Default and fixed-budget
results must not be conflated: default image p95 was about 100 ms; the fixed
budget run was about 417 ms. This finding requires official-preprocessor parity
and realistic screenshots before production configuration is selected.

This checkout differs from the plan's earlier source grounding: it has no
`owned_process.rs`, and the provider currently owns a `Child` directly. The
referenced earlier research/tickets are also absent. A production provider
implementation must reconcile its process-ownership design with the actual
current code rather than import a nonexistent seam or change the app's agent
runtime ownership.

LiteRT fallback was not evaluated during the original GGUF spike. The llama candidate met these provisional
resource/vector contracts; the spike observed a text-ranking gate failure on
12 synthetic judgments. Its cause is unresolved without official BF16/FP32
parity and a larger app-representative evaluation. Changing the runtime bridge
alone is not demonstrated to fix that, nor has a shared GGUF/runtime issue been
ruled out.

## Text-and-vision-only loading and downloads

Follow-up verification confirms a ready-made text-and-vision-only package exists.
The missing skip-audio CLI option in the tested GGUF runtime is a limitation of
that integration, not of EmbeddingGemma 2's architecture or available packages.

[Google's developer guide](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)
documents `SentenceTransformer(MODEL_ID, config_kwargs={"audio_config": None})`
for text and vision: 440M active parameters, with the unused audio encoder not
loaded into memory. This selective loading does not establish selective download
of the original checkpoint: the verified Google repo contains one combined
1,488,915,288-byte `model.safetensors` file.

The [LiteRT text/vision package](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm)
at revision `e301f74d5551b0c2641bd5cb4652a76239d5c5f8` contains a generic
CPU/GPU `embeddinggemma-2-text-vision-440m.litertlm` file of 387,710,976 bytes,
SHA-256 `92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0`.
Its model card specifies int4 per-channel QAT text transformer/embedding weights
and int8 per-channel QAT vision weights; audio is omitted. Google's
[Universal Embedder guide](https://developers.google.com/edge/mediapipe/solutions/retrieval/universal_embedder/web_js)
directly uses this package. It supports 70/140 image soft-token configurations,
so comparison with the current GGUF 280-token tests needs explicit policy/quality
evaluation. It is not a drop-in model file for llama-server.

The package card reports M5 MacBook Pro text/vision memory of 310 MB on CPU and
403 MB on GPU, measured using `task_vm_info::phys_footprint` on a cached second
load. Those are publisher measurements on another device, with another precision
and image-budget configuration and a different memory metric; they are not our
M4 Pro results or a guarantee for the app. Subsequent
[local LiteRT execution](litert-evaluation.md) measured CPU/GPU settings on this
M4 Pro, including native physical footprint and repeated text/image requests.
Desktop integration remains unimplemented.

The upstream ggml-org GGUF repository was also verified at
`bfcd298762cc34d0357ece5ebdd31791a3a374d8`: it publishes Q8/BF16 backbones and
combined ~555/982 MB projectors, not a separately named text/vision projector in
that snapshot. This does not rule out a vision-only GGUF conversion or other
publishers. The previous full-GGUF RSS measurements should not be presented as
the inherent memory requirement of text-and-vision EmbeddingGemma 2.
