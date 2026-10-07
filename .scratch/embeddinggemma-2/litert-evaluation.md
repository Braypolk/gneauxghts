# Text-and-vision-only LiteRT memory evaluation

Updated: 2026-10-06. Downloaded and executed locally on the 24 GB M4 Pro.
At the time of these measurements the app used Jina. They are isolated Python
probe results, preserved as the before/after comparison. The subsequent native
Rust integration is recorded in [implementation.md](implementation.md).

## Download and runtime

The pinned 440M text/vision package downloaded successfully: 387,710,976 bytes
(388 MB decimal; 369.75 MiB). Its SHA-256 matched the published digest. The
macOS ARM64 `litert-lm-api` 0.18.0 wheel also matched its published SHA-256 and
was installed without dependencies in `/private/tmp/gneauxghts-gemma-spike/litert-venv`.
Pins are in [runtime-manifest.json](runtime-manifest.json).

The package uses int4 QAT text weights and int8 QAT vision weights; it is a
different precision/pipeline from the earlier Q8 GGUF backbone. Its supported
vision budgets are 70 and 140 soft tokens, versus 280 in the GGUF tests. This
comparison measures complete deployment configurations, not just audio removal.
See [the package card](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm).

## Measurements

All models ran sequentially in separate processes with the same short synthetic
fixture, 40 singleton text requests and 40 singleton image requests where
supported. LiteRT used 128–1,024 text signatures, normalized 768-dimensional
outputs, overflow errors, 12 CPU threads when using CPU, and the same backend
for text/vision. Each backend/budget used an initially empty explicit cache.
GGUF controls were rerun using their prior four-slot/8,192-context settings.

| Configuration | Peak RSS | Peak macOS physical footprint | Text p95 | Image p95 |
| --- | ---: | ---: | ---: | ---: |
| Jina Q6_K | 0.352 GiB | 0.191 GiB | 5.05 ms | unavailable |
| Gemma Q8 + F16 combined projector, 280 image tokens | 1.739 GiB | 1.591 GiB | 13.95 ms | 345.74 ms |
| Gemma Q8 + Q8 projector, audio disabled, 280 tokens | 1.120 GiB | 0.810 GiB | 13.96 ms | 353.79 ms |
| LiteRT CPU, 70 image tokens | 0.985 GiB | 0.384 GiB | 71.48 ms | 231.05 ms |
| LiteRT GPU, 70 image tokens | 0.734 GiB | 0.632 GiB | 15.13 ms | 72.77 ms |
| LiteRT CPU, 140 image tokens | 1.233 GiB | 0.632 GiB | 69.13 ms | 419.25 ms |
| LiteRT GPU, 140 image tokens | 0.772 GiB | 0.734 GiB | 15.89 ms | 150.35 ms |

The 70-token GPU deployment reduced peak RSS by 57.8% from the original GGUF
configuration. The 70-token CPU deployment had the smallest measured physical
footprint, with much slower text execution. CPU/GPU tradeoffs depend on both
memory accounting and workload; the user subsequently chose GPU/70 with a Settings option for 140.

Both metrics are bytes converted to GiB (2^30). RSS and physical footprint are
different accounting methods and must not be mixed in ratios. The previous chat
figures were RSS. A small C helper built against the host SDK reads native
`TASK_VM_INFO` resident/physical lifetime peaks for the LiteRT process and
`proc_pid_rusage` lifetime physical peaks for owned GGUF children. GGUF peak RSS
continues to use 100 ms `ps` sampling. The Mach/proc physical readings agreed
within 1 MiB in a same-process sanity check. LiteRT includes its Python/probe
overhead (~20 MiB initial physical footprint); GGUF metrics cover the server and
exclude the Python HTTP driver. These are isolated runtime measurements, not
total app memory or minimum-device certification.

## Text then vision

| LiteRT configuration | Physical footprint after text | After text + vision work | After 2 seconds idle |
| --- | ---: | ---: | ---: |
| CPU, 70 | 252.64 MiB | 391.91 MiB | 391.95 MiB |
| GPU, 70 | 586.83 MiB | 641.35 MiB | 568.25 MiB |
| CPU, 140 | 255.66 MiB | 646.11 MiB | 646.14 MiB |
| GPU, 140 | 613.25 MiB | 739.20 MiB | 665.27 MiB |

Peak values include engine initialization, work, and close, rather than just the
final steady point. On close, physical footprint fell to about 86–98 MiB. Model
startup observations were CPU 70/140: 0.42/0.93 s; GPU 70/140: 1.27/4.43 s.
Startup and first-image work include cache creation; these single observations
are not cold/warm p50/p95 distributions. The publisher's M5 measurements used
128-token text and 70-token vision signatures on a cached second load, so their
310/403 MB CPU/GPU figures are not directly comparable with this test.

## Correctness and limits

All four LiteRT configurations retained 10/12 text top-one, MRR 0.917, and 4/4
in each text→image/image→text direction. They produced finite unit-normalized
768-dimensional outputs, consistent batch/singleton text, stable repeated image
encoding, and distinguishable image vectors. Jina remained 12/12. CPU/GPU
vectors were close but not identical: minimum same-input cosine 0.9948869.
This test does not resolve the original recall gate or establish BF16/FP32
reference parity. Smaller vision budgets need realistic screenshot, small-text,
photo, and hard-negative tests before choosing a product configuration.

The package's `ModelInfo` unexpectedly advertises `audio=true`, despite the
text/vision package name. Native loader logs show the actual audio encoder and
audio frontend model sections are absent and skipped. The runtime emits some
shared audio-preprocessing initialization warnings; no audio input was sent and
the 300M audio encoder weights were not loaded. Do not use this metadata boolean
alone as proof of installed modalities.

## Reproduce

Source: [embedding_litert_eval.py](../../scripts/embedding_litert_eval.py) and
[macos_process_memory.c](../../scripts/macos_process_memory.c). Full logs/vectors
remain in `/private/tmp/gneauxghts-gemma-spike`; compact results, controls,
settings, and rankings are saved in [litert-results.json](litert-results.json).
After explicit, hash-verified artifact setup:

```sh
clang -dynamiclib -O2 scripts/macos_process_memory.c \
  -o /private/tmp/gneauxghts-gemma-spike/process-memory.dylib

/private/tmp/gneauxghts-gemma-spike/litert-venv/bin/python -B \
  scripts/embedding_litert_eval.py \
  --model /private/tmp/gneauxghts-gemma-spike/embeddinggemma-2-text-vision-440m.litertlm \
  --memory-library /private/tmp/gneauxghts-gemma-spike/process-memory.dylib \
  --cache /private/tmp/gneauxghts-gemma-spike/litert-cache-gpu70-reproduction \
  --backend gpu --vision-tokens 70 --samples 40 \
  --output /private/tmp/gneauxghts-gemma-spike/litert-evaluation/gpu70-reproduction.json

python3 -B .scratch/embeddinggemma-2/measure-gguf-footprint.py
```

Run CPU with `--backend cpu` and a separate cache/output; use `--vision-tokens
140` for the larger vision signature. All 16 existing Python script tests passed
after the isolated helper changes. All benchmark processes exited successfully.
