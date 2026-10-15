# Rig 0.44 migration

2026-10-11. The completed [Rig 0.41 comparison](../chat-reliability/structured-answer-streaming/completion/README.md)
preceded all dependency changes. Compact formatting remains experimental: its
6.46% input-token saving does not outweigh two invalid source arrays and the
excerpt-scope failure shared by both formats.

## Implementation

Pin `rig-core` and `rig-agent` to 0.44.0, update their lockfile dependency graph,
and pin Rust 1.95.0 locally and in CI. Rig's declared MSRV is 1.95.0. The machine's
default toolchain is unchanged. The official [0.44 release](https://github.com/0xPlaygrounds/rig/releases/tag/v0.44.0)
and [tagged migration guide](https://github.com/0xPlaygrounds/rig/blob/v0.44.0/MIGRATING.md)
were checked against the installed crate source; code is authoritative where
examples in the migration guide differ.

The app runtime now consumes `DynModel<Completion>`, unified stream events and
the dispatch/outcome hooks. Context admission and optional counter diagnostics
run against the assembled completion request in the dispatch hook. App guardrails
and permission requests still precede tool execution. Tool outcomes retain the
existing app event lifecycle, and raw reasoning/provider events remain hidden.
The existing structured-result formatter remains available when gathering stops.

Rig now explicitly serializes Responses function tools with `strict: false`.
The custom serialization wrapper is removed; an actual HTTP wire regression
checks optional/oneOf schemas, hosted web tools, reasoning settings, and repeated
requests without tool accumulation. Explicit false preserves the optional-field
contract described in [OpenAI's migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses#5-update-function-definitions-and-outputs).

Usage counters are optional in Rig 0.44. Missing input cannot establish a context
baseline; diagnostics distinguish absent, partial and reported-zero usage. The
existing numeric app event/storage shape remains compatible through the app-owned
`AgentUsage` boundary. Media and history construction use the new message API.
Live evaluation wrappers use Wire/Transport rather than the removed model trait.
Generic mock history now replays tool exchanges as text; the context-limit test
checks successful and skipped exchanges in that representation.

## Validation

See [raw upgrade evidence](../rig-upgrade/README.md) and
[validation provenance](../rig-upgrade/validation-provenance.json).

- Production library `cargo check --locked --offline`: passed.
- Architecture fitness: 21 passed.
- Frontend/E2E TypeScript checks: zero errors or warnings.
- Live smoke: two cases passed using `gpt-6-luna`, medium reasoning, Flex, with no
  retry or tier fallback. Plain text uses one model call and 31 reported tokens;
  structured tools use five calls and 11,654 reported tokens (11,516 input,
  138 output including 13 reasoning, 8,438 cached input). Combined: 11,685 tokens.
  The structured case performs two `find_notes` calls and one `read_notes` call;
  this is a compatibility check, not an efficiency improvement claim.
- Three existing evidence-service failures reproduce identically on the isolated
  Rig 0.41 baseline; tracked in [issue 10](chat-reliability-resolved-issues.md#10-investigate-three-existing-evidence-regression-failures).
  Provenance absence, early evidence-budget exhaustion and a missing weekly-task
  item were undiagnosed at this checkpoint. Subsequent investigation resolved
  fixture assumptions about continuations and budgets, with no production limit
  changes; the [final suite passes 861/861](completed-work.md#evidence-regression-fixtures).
  The historical migration counts below are unchanged.
- Final full library suite: 845 passed, 3 failed, 27 ignored. All migration-focused
  checks pass, including streaming text, real tool dispatch, structured formatter,
  permissions/denial/cancellation, context finalization, and usage diagnostics.
  The only failures are the three reproduced baseline failures above.
- Changed Rust files pass rustfmt; Git whitespace checks pass.

## Limits

This migration does not adopt compact prompts or add native structured-answer
streaming. The two live smoke cases exercise the real runtime with synthetic
notes; they do not establish retrieval efficiency, native UI reliability or
citation entailment. Existing local-provider live tests compile but were not
run against LM Studio. The fixed-evidence 0.41 runner remains historical and is
not source-compatible with 0.44. Its analysis uses recorded provenance and
pre-migration host-restoration evidence rather than current dependency hashes.
