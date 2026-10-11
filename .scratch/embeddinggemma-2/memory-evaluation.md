# EmbeddingGemma 2 memory reduction experiment

> Historical pre-implementation experiment. The approved LiteRT implementation
> supersedes the deployment/adoption statements below. Measurements apply to
> the runtime and fixtures tested at that checkpoint. See the
> [implementation](implementation.md) and [selected plan](spec.md) for subsequent
> implementation and release-validation limits.

Updated: 2026-10-06. Experimental only; the app still uses Jina.

The Q8 projector plus disabling unused audio loading reduced sampled peak RSS
from 1.729 GiB to 1.132 GiB (34.5%) on this M4 Pro. All variants used the same
Q8 text backbone and pinned b11454 runtime. No vault or production provider was
modified. The original feature implementation remains unfinished.

## Measurements

Models ran sequentially, with 40 singleton text and 40 singleton image requests
per configuration, the same 16 documents/12 judged queries/four generated images
as the prior evaluation, and sampling via `ps` every 100 ms.

| Configuration | Sampled peak RSS | Reduction from F16 projector | Text p95 | Image p95 |
| --- | ---: | ---: | ---: | ---: |
| Q8 backbone + F16 combined projector | 1.729 GiB | — | 13.24 ms | 380.23 ms |
| Q8 backbone + Q8 combined projector | 1.452 GiB | 16.0% | 15.41 ms | 386.97 ms |
| Q8 projector; 1,024 batch/microbatch | 1.432 GiB | 17.2% | 14.45 ms | 390.32 ms |
| Q8 projector; audio loading disabled | 1.132 GiB | 34.5% | 13.01 ms | 376.75 ms |

These retain four slots, 8,192 total context, and the 280-soft-token image budget.
The first, second, and fourth rows retain 2,048 batch/microbatch limits. The
runtime logged 298-token image prompts and no image-budget cap for these rows.
The prior Jina run peaked at 0.355 GiB; optimized Gemma remains about 3.2 times
that footprint. Jina was not rerun during this optimization experiment.

End-of-work RSS was 1.722, 1.452, 1.429, and 1.132 GiB respectively. It is
allocator/workload dependent: the earlier F16-projector comparison ended at
1.417 GiB despite a similar 1.706 GiB peak. These are sampled process resident
measurements, not total GPU/unified-memory accounting or long-idle measurements.
Latency differences here are small and do not establish a speed improvement.

All configurations retained 10/12 text top-one, text MRR 0.917, and 4/4 top-one
in each text→image/image→text direction. Q8 projector versus F16 projector had
minimum image-vector cosine 0.9999862. Disabling audio produced **exactly equal**
document, query, and image vectors to the normal Q8 projector on this fixture.
Finite/unit/768-dimensional outputs, repeated-image stability, batch/single text
agreement, corrupt-image rejection, and subsequent text health passed. These
small tests do not establish production retrieval quality or official BF16/FP32
framework parity.

## What changed

Unsloth's pinned Q8 projector is 554,821,120 bytes versus 980,895,232 for F16.
Both include audio. Google's model has independent encoders: 270M text, 170M
vision, and 300M audio parameters. Its official text/image configuration omits
audio, yielding 440M active parameters rather than the full 740M.
See [Google's model card](https://huggingface.co/google/embeddinggemma-2#2-selective-encoder-loading)
and [Unsloth's artifacts](https://huggingface.co/unsloth/embeddinggemma-2-GGUF/tree/ba3888272494be64ed88c9eb536ddc61a1be73d5).

The pinned llama.cpp help exposes no skip-audio switch. Its
[clip_init implementation](https://github.com/ggml-org/llama.cpp/blob/4625240437c6821ee5c2da99e12d4817c6a8f07f/tools/mtmd/clip.cpp#L4006)
conditionally initializes audio using the GGUF `clip.has_audio_encoder` flag.
The experimental copy changes that boolean from true to false, at the one
verified byte offset in the pinned artifact. Every tensor byte remains unchanged.
The startup log no longer contains `init_audio`; vision remains initialized.
Audio weights remain in the file, so this additional change reduces loaded
memory but does not reduce its download size. This is a bounded artifact probe,
not a general metadata patcher or production installer. Shipping the optimization
requires an explicit artifact/runtime policy and installation integrity checks.

Reducing batch/microbatch to 512 saved little and triggered llama.cpp's cap from
280 to 256 image tokens; image prompts changed to 284 tokens and minimum image
cosine dropped to 0.9959684. Those results are not a like-for-like 280-token
comparison. One slot with these smaller buffers peaked at 1.408 GiB and reduced
document throughput from 152 to 86 documents/s. Neither is recommended here.
The 1,024-buffer test preserved the image vectors but saved only ~20 MiB over
the normal Q8 projector. It needs maximum-length chunk tests before adoption.

Further model quantization or unloading the owned server after inactivity are
possible follow-ups. They have not been measured here; unloading adds reload
latency to the next query. Shorter output vectors shrink the index, not encoder
weights, so they are a separate optimization.

A ready-made 440M text/vision-only LiteRT package is also available, with a
387,710,976-byte generic CPU/GPU download and no audio encoder. The subsequent
[LiteRT benchmark](litert-evaluation.md) downloaded and executed it on CPU/GPU;
the app integration remains unimplemented.
See the [verified package details](runtime-research.md#text-and-vision-only-loading-and-downloads).
The lack of a skip-audio CLI switch in our tested GGUF runtime must not be
generalized into a claim that selective loading/downloads are unavailable.

## Reproduce

Hashes/revisions are recorded in [runtime-manifest.json](runtime-manifest.json).
Compact measurements, runtime arguments, rankings, and copy provenance are in
[memory-results.json](memory-results.json). Full vectors/logs remain under
`/private/tmp/gneauxghts-gemma-spike/memory-evaluation` and
`memory-evaluation-followup`. The reproduction copy tool requires Python 3.11+
and the exact pinned source hash, and refuses to overwrite an existing output.

```sh
python3 -B .scratch/embeddinggemma-2/disable-audio-projector.py \
  /private/tmp/gneauxghts-gemma-spike/mmproj-Q8_0.gguf \
  /private/tmp/gneauxghts-gemma-spike/mmproj-Q8_0-no-audio-new-copy.gguf

python3 -B scripts/embedding_memory_eval.py \
  --binary /private/tmp/gneauxghts-gemma-spike/runtime/llama-b11454/llama-server \
  --model /private/tmp/gneauxghts-gemma-spike/embeddinggemma-2-Q8_0.gguf \
  --projector-f16 /private/tmp/gneauxghts-gemma-spike/mmproj-F16.gguf \
  --projector-q8 /private/tmp/gneauxghts-gemma-spike/mmproj-Q8_0.gguf \
  --projector-no-audio /private/tmp/gneauxghts-gemma-spike/mmproj-Q8_0-no-audio-new-copy.gguf \
  --only f16_projector q8_projector q8_batch1024 q8_no_audio \
  --output /private/tmp/gneauxghts-gemma-spike/memory-reproduction --samples 40
```

The copy reproduced its expected SHA-256. All 16 existing Python script tests
passed after extending the isolated server helper with configurable buffer/slot
sizes. No production code was changed.
