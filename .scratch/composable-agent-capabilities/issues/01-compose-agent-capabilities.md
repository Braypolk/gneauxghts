# Compose agent capabilities without workflow routing
Status: resolved

Implement the [spec](../spec.md). User authorization includes generalizing tools
and agent execution, not expanding access to removed historical prose.

## Comments

Implementation started: explicit range contracts, intermediate activity data,
capability-based tool assembly, shared research limits and general instructions.


Implementation complete. Explicit date contracts replace named presets and prose
routing; activity results no longer terminate runs; capability sets compose tool
exposure; repeated research uses shared limits. Architecture and native harness
contracts updated. See [validation](../validation.md) for 667 passing Rust library
tests, 19 architecture checks, 18 frontend contracts and live-model limitations.
