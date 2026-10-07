# Text/image provider and setup

Status: ready-for-human
Updated: 2026-10-06
Blocked by: 01

## Scope

Add typed text/image input behind the existing provider seam; checksum-pinned explicit Settings setup; mean pooling and trained 768-dimensional projection; verified task prompts and image preprocessing; bounded text/image tokens, batches, bytes/pixels and lifecycle. Reconcile the actual Child owner in this checkout with the planned OwnedProcess seam. Never install executables during search.

Target the text/vision-only LiteRT package. Prefer validated GPU execution for
text and vision, with CPU fallback after GPU initialization failure and cleanup
of the failed attempt. Report the actual active backend. Keep input/artifact
errors and cancellation separate from backend availability. Verify CPU/GPU
representation compatibility before reusing an active index across fallback.
The Python evaluation wheel is not the product's runtime packaging design.

## Implementation state

Implemented typed native LiteRT provider, bounded checksum-pinned explicit setup, GPU/CPU/text-only fallback, lifecycle cleanup, and persisted 70/140 budget. Native parity/resource and deterministic fallback tests pass.

See [implementation and validation](../implementation.md) for exact evidence,
resource comparisons, reproduction commands, and remaining release limits.

## Comments

2026-10-06: The user selected LiteRT/GPU/70 with optional 140 and authorized
implementation despite the tiny baseline-relative text regression. Earlier
spike results remain in [evaluation](../evaluation.md); they are not a current
claim that production work is absent.
