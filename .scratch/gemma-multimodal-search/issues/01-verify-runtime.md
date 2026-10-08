# Verify and choose the Gemma multimodal runtime

Status: ready-for-agent
Type: research
Depends on: none

## Deliverable

Run a disposable spike against the primary-source path in [runtime-research](../runtime-research.md). Record an immutable runtime/model/projector pin, platform availability, supported requests, tested limits, and measured footprint in a deployment decision attached to [the spec](../spec.md). Do not switch the production provider in this ticket.

## Work

- Verify mean-pooled, projected, normalized text and image output against Google's reference, including no-prefix image queries and text search/document prefixes. Test different images, structured input order, batch errors, and input-budget rejection.
- Verify the complete-input microbatch constraint and select explicit batch/microbatch, image token, encoded-byte, decoded-pixel and queued-byte limits.
- Establish Jina baseline and measure candidate cold/warm latency, throughput, peak RAM/VRAM, idle footprint, and artifact sizes on available target hardware. Record untested platforms explicitly. Set release quality/resource budgets before the candidate evaluation in ticket 08.
- Use the official combined vision/audio projector: the user accepts its included audio download, so selective vision-only loading/conversion is unnecessary. Measure actual artifact size and runtime memory, including audio contexts initialized internally. Audio implementation remains outside this round. Evaluate LiteRT text/vision 440M only if the preferred runtime fails the agreed envelope; record packaging/bridge consequences.

## Acceptance

A reproducible command/request/fixture report proves meaningful text/image output and locks the preferred runtime/artifacts with checksums. Record failures or unavailable platforms without inventing performance numbers. Update dependent tickets if fallback requires a new bridge. No permanent Python service or unpinned executable becomes part of setup. Bundled audio weights do not add an audio feature or audio acceptance gate.
