# 02 — Consolidate provider-option mapping without weakening native admission

Status: ready-for-agent
Execution: implemented
Type: task
Blocked by: 01

## Problem and scope

Pi serializes requests, while Rust `configure_body` rewrites reasoning and service
tier fields. Capability and compatibility decisions are spread across the provider
wrapper and native transport. Use Pi's supported options where they express the
existing behavior, retaining native validation and necessary server-specific mapping.
Read the [spec](../spec.md) and ticket [01](01-standard-provider-construction.md).

Primary code: `src/lib/features/chat/pi/nativeProvider.ts`,
`src-tauri/src/pi_chat/transport.rs`, `src-tauri/src/provider_config/`,
`src/lib/features/chat/chatConfiguration.test.ts`.

## Work

- Trace existing local and hosted reasoning, service-tier, tools and model-limit
  settings through native configuration, Pi options and actual outgoing JSON.
- Map supported behavior using public model compatibility, thinking-level and API
  options. Define one translation path for each option; remove duplicate mutation
  only after equivalent behavior and native ownership are demonstrated.
- Keep Rust authoritative for current endpoint, credential, selected model,
  capabilities and settings that it currently enforces. Caller-provided wire JSON
  cannot override native policy. If this requires native final normalization, retain
  the smallest justified mapping and explain why a Pi option cannot replace it.
- Maintain advertised local reasoning selection/defaults, omit unsupported or
  unknown overrides, and preserve the distinction between advertised maximum
  capacity and actual loaded capacity. Do not infer support from model names.
- Preserve function-only application tool restrictions and native rejection of
  tools on a model configured without tool support.

## Acceptance and validation

- Table-driven outgoing-request tests cover local reasoning off/default/supported/
  unavailable metadata and hosted reasoning plus standard/flex service tier.
- Tampered model, stream flag, reasoning/tool configuration, endpoint or headers
  cannot bypass the native command contract or expose credentials to JavaScript.
- Generation, continuation, recovery and compaction use the same resulting option
  path; no one-shot generation hook is added.
- Existing provider configuration, chat configuration, transport and compaction
  tests pass. Report which mappings moved to Pi and which remain native with reasons.
- No new backend or execution-state owner is created; protocol behavior is preserved
  even if a particular rewrite must remain for the current native security boundary.

## Comments

### 2026-10-16 — Implemented and focused validation passed

- Native selected-model metadata now publishes `reasoningWireEffort`, derived by
  the same advertised-choice translation used immediately before dispatch. Pi's
  public `thinkingLevelMap`, local `supportsReasoningEffort` compatibility option
  and full/simple reasoning options serialize this choice. A neutral Pi medium
  slot represents the selected wire value, including advertised custom values
  such as brief/deep; it is not an invented local capability or user setting.
  Explicit caller reasoning options cannot replace the native selected setting.
- Local advertised off becomes wire `none`; advertised on omits the override and
  leaves the server's enabled default in effect. Unsupported saved choices use
  the advertised default/first choice. Unavailable or invalid metadata omits every
  override, including an unadvertised `none`. Removed the obsolete internal
  forced-none exception for custom bounded summaries. A server whose advertised
  default is off still cannot offer an unrepresentable on choice. No model-name
  inference or change to loaded-versus-advertised context capacity was introduced.
- Hosted enabled effort uses Pi's Responses reasoning option/map. Hosted off/none
  omits reasoning. Service tier stays native: Pi 1.3.0 Responses `streamSimple`
  drops `serviceTier`; Rust maps standard to `default` and flex to `flex` uniformly.
  Native final reasoning normalization also remains necessary because JSON and
  model snapshots are untrusted/stale and current native settings are authoritative.
  This is enforcement using the same native choice, not a second settings owner.
- Rust still resolves endpoint and credential privately, requires the body model
  to equal the selected native command model and requires streaming. It removes
  caller transport fields and conflicting reasoning encodings for both protocols.
  Function-only tools and disabled-model tool rejection now also reject malformed
  tools, legacy functions/function_call and built-in tool-choice attempts. URLs
  and headers supplied to Pi's fetch replacement never enter native command args.
- Table-driven Pi outgoing requests cover local off/on/custom/unavailable and
  hosted off/enabled for both stream APIs. Native outgoing tables cover advertised
  defaults, unavailable/invalid metadata and hosted reasoning × standard/flex.
  A real Harness overflow fixture proves generation, recovery compaction and its
  continuation all serialize the same advertised reasoning choice. Existing
  terminal citation/authority checks and capacity discovery tests remain passing.
- Validation: focused Vitest on nativeProvider, citationProvider, citations,
  compaction, compactionAuthority, runtimeStartup and chatConfiguration:
  **81 tests passed**. Focused TypeScript compilation passed with the repository
  configuration and Vite client ambient declarations. `cargo test --lib
  pi_chat::transport::tests`: **6 passed**; `cargo test --lib provider_config::`:
  **3 passed**. Existing unrelated dead-code warnings remain. No native app,
  desktop/simulator or live hosted inference was run for this ticket; integrated
  acceptance belongs to ticket 06. Pi stays pinned at 1.3.0 with public exports.

### 2026-10-16 — Integrated acceptance

Accepted by ticket 06; see [the verified outcome](../outcome.md). This historical
record is outside the executable backlog. Native guarantees and stated platform
limits remain as recorded there.
