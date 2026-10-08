# Add the Gemma provider and explicit local setup

Status: needs-triage
Type: task
Depends on: 01
Triage reason: finalize runtime deployment from ticket 01 before implementation.

## Deliverable

Implement the small typed text/image provider seam and Settings-driven artifact setup described in [the spec](../spec.md). Retain the existing app-owned process lifecycle and supported-platform policy.

## Work

Extend `semantic/embed.rs` with typed inputs, purpose, capabilities, representation metadata, and normalized vector validation. Keep prompt formatting, structured data-URI transport, model preprocessing, trained projection and request budgets behind the provider. Verify output dimensions, finite values, nonzero norm, count and order. Do not hand-insert image markers in structured parts.

Update `runtime_install.rs` with verified pins/checksums and atomic setup of the runtime plus matching model/projector. Preserve explicit setup, retry after interruption, bounded logs, and `OwnedProcess` cleanup. Ordinary queries cannot install executables. Start serialized media work and bound batching/concurrency using ticket 01 results; interactive requests get scheduling priority between jobs.

Expose text/vision readiness independently in ModelInfo/Settings status. A vision failure need not disable compatible text embeddings. Unvalidated platforms advertise their actual capabilities. Pin the accepted combined vision/audio projector; no vision-only artifact is required. Audio input and product capability remain outside this round.

## Acceptance

Provider-contract tests cover text/image formatting, invalid/partial output, timeout, cancellation, oversized inputs, startup failure and shutdown. Installer tests cover checksum failure, partial setup and retry. A real-runtime smoke test exercises text/image output separately from deterministic ordinary tests.
