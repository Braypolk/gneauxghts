# Verify the runtime before adoption

Status: needs-info
Updated: 2026-10-06

## Scope

Run the real Jina baseline and Gemma candidate serially in an isolated temporary
directory, including the published combined vision/audio projector. Never change
the user's vault, installed model, or live index during the spike.

The fixed synthetic judgments and provisional device budgets are in
`scripts/fixtures/embedding-evaluation.json`. Record them before seeing candidate
results. This Mac has an M4 Pro and 24 GiB memory; reserve a maximum 4 GiB RSS for
the embedding process, a threefold baseline-relative text p95 limit, and a 3 s
image p95 limit. These are spike budgets, not a validated minimum-device claim.

Run `scripts/embedding_eval.py` with explicit local artifacts. Use Q8_0 for the
candidate and F16 for the quantization comparator, both with the F16 combined
projector. A same-runtime F16 comparator is not official-framework parity.

Require finite normalized 768-dimensional outputs, correct input order,
batch/single stability, differing image vectors, measured latency/resources,
judged text recall and both cross-modal directions. Record failures candidly.
Broader screenshot/small-text/EXIF/alpha and official-framework parity checks
remain required before release. The four synthetic images only test basic
cross-modal wiring; self-image retrieval does not establish generalization.

Dependent tickets may proceed only after the runtime choice and unresolved
gates are recorded. Production adoption requires all release gates in the spec.

## Result

The runtime spike was implemented and run. `b11454` contains the required merge;
its native binary and the Q8/F16 backbones with the combined F16 projector work.
The fixed 280-soft-token configuration meets provisional vector/resource gates.
Both Gemma backbones fail the baseline-relative text recall gates: 10/12 first
results versus Jina's 12/12, with MRR 0.917 versus 1.000. Repeated runs and a Jina
control on the new runtime confirmed those results.

Status is `needs-info` because adopting a production runtime still requires
official BF16/FP32 parity and a larger app-representative evaluation. The small
test does not establish that Gemma itself is unsuitable. See [evaluation](../evaluation.md),
[runtime facts](../runtime-research.md), and [manifest](../runtime-manifest.json).

## Comments

2026-10-06: The 440M LiteRT text/vision package was downloaded, checksum-verified,
and executed on CPU/GPU with 70/140 vision signatures. User chose GPU whenever
available for the implementation target, with CPU fallback. Local retrieval
scores remain 10/12 for text and 4/4 in each cross-modal direction. Further
app-representative quality and platform checks remain unresolved. CPU/GPU vectors
are close but not identical; establish cross-backend index compatibility before
fallback can reuse the same generation. See [LiteRT results](../litert-evaluation.md).


2026-10-06: The user selected LiteRT/GPU/70 with optional140 and requested
implementation. The native provider, Settings preference and working image-search
slice are now present; current implementation, tests and remaining full-plan
items are recorded in [implementation.md](../implementation.md). Earlier comments
about the app still using Jina describe the evaluation stage. Original rollout
requirements are not all complete or newly declared passing.

2026-10-06 continuation: native 0.18 production-provider parity, memory, visual
fixtures and ANN measurements are now recorded in [implementation](../implementation.md).
The user authorized the selected LiteRT implementation with the measured quality
limits. Broader platform/corpus/reference checks remain validation work.
