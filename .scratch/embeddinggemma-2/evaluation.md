# EmbeddingGemma 2 runtime gate and before/after comparison

Updated: 2026-10-06
Decision: retain Jina; full feature implementation and production adoption deferred.

The runtime spike is implemented in [embedding_eval.py](../../scripts/embedding_eval.py).
The replacement feature (provider, migration, image inventory/index, retrieval,
and UI) has **not** been implemented. The requested plan explicitly says to retain
Jina if a release gate fails. This spike found a reproducible text-recall failure
before changing the production runtime or database.

## Fixed evaluation and thresholds

[The fixture](../../scripts/fixtures/embedding-evaluation.json) defines 16 synthetic
passages, 12 judged queries, four image fixtures, and acceptance thresholds. Its
judgments and thresholds were saved before examining Gemma results. The passages
include two remembered-chat examples and hard negatives for note/migration/image
topics. The images are rising/falling line charts and a red circle/blue square.
The images are image-only inputs with no captions or task prefix.

Text acceptance permits at most 0.05 MRR regression and 0.10 top-one regression
against Jina. Resource spike budgets are a threefold baseline text p95 ceiling,
3 s image p95, and 4 GiB sampled peak RSS on this 24 GiB M4 Pro. These are
provisional spike limits, not a minimum-device specification or release approval.

## Final measured comparison

The final comparison ran the models serially with 40 individual text requests
and 40 individual image requests per eligible model. Inputs were short synthetic
passages, not the user's vault. Batch/document timing includes the initial
embedding call; this is not a full-vault ingestion benchmark.

| Measurement | Existing Jina Q6_K | Gemma Q8_0 + F16 combined projector | Gemma F16 + same projector |
| --- | ---: | ---: | ---: |
| Judged text top-one | 12/12 (100%) | 10/12 (83.3%) | 10/12 (83.3%) |
| Text MRR | 1.000 | 0.917 | 0.917 |
| Warm text p50 | 5.64 ms | 12.91 ms | 11.38 ms |
| Warm text p95 | 6.33 ms | 15.83 ms | 14.80 ms |
| Warm image p50 | unavailable | 352.58 ms | 342.86 ms |
| Warm image p95 | unavailable | 416.67 ms | 373.08 ms |
| Sampled peak RSS | 0.355 GiB | 1.706 GiB | 2.012 GiB |
| End-of-work resident RSS | 0.355 GiB | 1.417 GiB | 1.731 GiB |
| Loaded model file | 181,601,344 bytes | 309,855,520 bytes | 557,950,240 bytes |
| Loaded projector file | none | 980,895,232 bytes | 980,895,232 bytes |
| Basic text→image top-one | unavailable | 4/4 | 4/4 |
| Basic image→text top-one | unavailable | 4/4 | 4/4 |

Gemma Q8 text p95 was 2.50 times baseline. Its sampled peak RSS was 4.80 times
baseline, with the combined projector actually loaded. Those measurements pass
the provisional resource ceilings; they are not a speed or memory improvement.
RSS is sampled every 100 ms with `ps`, not a complete GPU/unified-memory peak
measurement. End-of-work RSS is not a long-running idle measurement.

Follow-up [memory experiments](memory-evaluation.md) reduced Gemma sampled peak
RSS to 1.132 GiB using the Q8 projector and disabling unused audio loading in an
experimental copy. The comparison retains the same backbone and image budget;
the app and release decision remain unchanged.

First startup varied with OS caching and executable first launch: the initial
Q8 load was 9.33 s, while the final Q8 load was 1.38 s. The final Jina/F16 loads
were 0.44/1.86 s. These isolated startup observations do not establish cold/warm
p50/p95 startup latency.

The Q8 deployment downloads 1,302,756,776 bytes (runtime archive + backbone +
combined projector). The extracted native runtime contains 31,843,062 regular
file bytes, yielding 1,322,593,814 installed file bytes including the two GGUFs.
The F16 comparison model is an evaluation artifact, not part of the proposed Q8
deployment. All test artifacts remain in `/private/tmp/gneauxghts-gemma-spike`.

## Repeatable text misses and control

Both Gemma variants consistently ranked these correct passages second:

| Query | Expected first result | Gemma's first result |
| --- | --- | --- |
| How can we recover if changing embedding models fails? | Preserve the old generation/files so the previous provider can restart | Keyword search remains available during setup/rebuilding |
| How are see-through pixels handled for visual search? | Composite alpha transparency onto a fixed background | Remembered decision to use a blue search button |

Jina produced 12/12 first results both on the currently installed `b11146`
runtime and a separate `b11454` control. Gemma's misses also repeated with default
vision settings and the explicit 280-soft-token policy. The minimum Q8/F16
same-input cosine was 0.9998566, and their text top-one agreement was 100%.
This makes a Q8-only explanation less likely, but does not rule out errors
shared by both GGUF variants: conversion, tokenization, pooling, or numerical
behavior in the new runtime path. Both models retrieved the correct passage in
their top two for all 12 queries. On the alpha-transparency query, Q8's first and
second scores were 0.71528 and 0.71521, an almost exact tie. This tiny synthetic
test does not establish model superiority or suitability on larger corpora,
multilingual queries, or the app's final lexical/semantic fusion.

Google explicitly recommends BF16/FP32 inference and warns that FP16 may silently
degrade embeddings. An F16 GGUF identifies stored weight precision; it does not
by itself establish the runtime's activation/accumulation precision. Neither
that precision nor parity against Google's official implementation was verified.
The earlier attribution to model behavior was therefore too strong.

MRR regression is 0.0833 (maximum allowed 0.05); top-one regression is 0.1667
(maximum allowed 0.10). Both gates fail. Thresholds were not loosened after
seeing those failures. Machine-readable measurements and gates are in
[evaluation-results.json](evaluation-results.json).

## Runtime contracts exercised

- Exact release ancestry, native executable version, and SHA-256 verification
  of the downloaded native archive, Q8/F16 models, and combined F16 projector.
- Finite, normalized 768-dimensional vectors; input-index ordering; matching
  single/batch text encoding; stable repeated image encoding; different images
  produce different vectors.
- Serialized image work with fixed min/max 280 soft tokens, mean pooling,
  2,048-token batch/microbatch, 8,192 total context and four slots. Runtime logs
  showed 298-token image sequences including wrappers, fitting one microbatch.
- Text→image and image→text retrieval using independently encoded pure inputs.
  Image→image self-matching passed, which proves wiring only, not generalization.
- Corrupt bytes were rejected with HTTP 500; subsequent text vectors still
  matched. A production provider must validate decoding/limits before transport
  and translate this rejection into failed-media coverage.
- Servers were terminated and reaped between variants and after failures.
- Startup logs confirmed `init_audio` with the combined projector. Its footprint
  is included above. No audio request, decoding, indexing, playback, or UI ran.

## Validation performed

- Eight deterministic Python evaluator contract tests passed; no downloads or
  real model are required for these tests.
- Two existing Rust provider tests and six runtime installer tests passed.
  The existing opt-in official `b11312` archive smoke test remained ignored;
  native `b11454` launch was exercised separately by the real evaluation.
- 17 focused frontend image-parser/search tests passed.
- `pnpm check` passed with zero Svelte errors/warnings and successful e2e typing.

## Remaining release work

The four image fixtures are insufficient for screenshots, small text, photos,
EXIF orientation, alpha policy, hard-negative calibration, or general image
similarity. The F16 GGUF comparator is **not** official-framework parity. Other
desktop platform binaries have published hashes but have not been run here.
No Related Notes/Atlas migration, concurrent edit/recovery, media parser parity,
asset replacement, native image-search navigation, responsiveness-under-indexing,
or full-corpus hybrid-search evaluation has occurred.

Next verify official BF16/FP32 implementation parity, then use a larger prejudged
evaluation with actual app chunking, document titles, and hybrid retrieval.
The smoke-test failure alone does not justify rejecting Gemma or assuming that
the model/quality strategy needs redesign. Possible bounded investigations are document-title context,
hybrid ranking, or retaining a Jina text channel alongside an explicitly chosen
image-search strategy. These require a new measured design decision; none has
been silently added to the product or substituted for the accepted plan.

## Reproduce

Use the exact hashes/revisions in [runtime-manifest.json](runtime-manifest.json)
and the transport/prompt details in [runtime-research.md](runtime-research.md).
Artifact setup is explicit; the evaluator never downloads files or accesses a
vault database. After obtaining the files into an isolated directory:

```sh
python3 -B scripts/embedding_eval.py \
  --baseline-bin /opt/homebrew/bin/llama-server \
  --candidate-bin /private/tmp/gneauxghts-gemma-spike/runtime/llama-b11454/llama-server \
  --jina '/Users/bray.polkinghorne/Library/Application Support/com.braypolkinghorne.gneauxghts/semantic/models/jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf' \
  --gemma /private/tmp/gneauxghts-gemma-spike/embeddinggemma-2-Q8_0.gguf \
  --reference /private/tmp/gneauxghts-gemma-spike/embeddinggemma-2-F16.gguf \
  --projector /private/tmp/gneauxghts-gemma-spike/mmproj-F16.gguf \
  --output /private/tmp/gneauxghts-gemma-spike/reproduction \
  --samples 40 --log-verbosity 3
```

Exit status 1 is the expected failed acceptance gate, not a harness crash. Model
paths are explicit inputs; substitute isolated copies as appropriate. Run one
evaluation at a time for resource measurements.
