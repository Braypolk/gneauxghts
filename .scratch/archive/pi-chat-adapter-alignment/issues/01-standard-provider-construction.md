# 01 — Use standard Pi provider construction and model registration

Status: ready-for-agent
Execution: implemented
Type: task
Blocked by: none

## Problem and scope

`nativeProvider.ts` manually assembles `Provider` objects, catalogs and refresh
coordination. `runtime.ts` reloads identical model configuration for each historical
conversation. Refactor through Pi's public `createProvider` and wrapped API streams,
retaining the native transport and terminal admission seam. Read the [spec](../spec.md).

Primary code: `src/lib/features/chat/pi/nativeProvider.ts`, `runtime.ts`,
`compaction.ts`; installed Pi AI `models.d.ts` and its custom-provider documentation.

## Work

- Use `createProvider` with the appropriate upstream completions/responses API
  implementation wrapped for native fetch and terminal admission. Keep protocol
  parsing and normalized streaming upstream-owned; support the declared public
  `stream` and `streamSimple` behavior rather than silently treating them as identical.
- Use `fetchModels`/supported refresh publication where appropriate for the existing
  selected-model catalog. Remove superseded generic registration plumbing; do not
  add whole-server discovery or a second persisted model catalog just to use a helper.
- Deduplicate successful `(provider, modelId)` registration within startup. Validate
  every native conversation binding before scheduling; do not lazy-restore authority.
- Preserve first-inference observed-capacity refresh and honest unknown limits.
  Prove how already-resolved model handles see the updated capacity. If a narrow
  compatibility adapter remains necessary on 1.3.0, isolate it, explain the contract
  and test it instead of assuming the factory supplies in-place updates.
- Keep explicit refresh/invalidation for changed native settings or endpoints;
  startup deduplication must not become an indefinitely stale configuration cache.

## Acceptance and validation

- Local and hosted protocol fixtures preserve text/reasoning/tool deltas, usage,
  signatures, stop reasons, error categories and cancellation behavior.
- Terminal checks still apply to all text blocks and empty/tool-only completions;
  citation/authority rejection cannot produce a successful terminal Pi message.
- Existing provider, citation-provider, compaction and compaction-authority tests
  pass. Add regressions for repeated-model startup discovery and post-first-inference
  capacity reaching the next compaction decision, including discovery failure.
- A mixed-model startup fixture validates every binding while fetching repeated
  model configuration once per distinct pair; failure does not enable scheduling.
- Only package-exported APIs are used, no Pi patch or upgrade is introduced, and
  the outcome names the generic plumbing deleted and any justified residual adapter.

## Comments

### 2026-10-16 — Implemented and focused validation passed

- Replaced hand-assembled `Provider` objects with public `createProvider` and
  wrapped completions/responses APIs. Standard `stream` delegates to upstream
  `stream`; `streamSimple` retains upstream simple-option translation. Native
  transport, failure categories and mandatory terminal admission remain shared.
- Removed the separate mutable catalog map. Selected models live in the factory
  catalog, which is read after native discovery before adding a model. Concurrent
  distinct registrations merge without a provider-wide refresh queue.
- Deliberately retained direct selected-model native discovery instead of forcing
  `fetchModels`: Pi 1.3.0's dynamic overlay replaces model records and would require
  an extra identity/publication adapter and provider-wide serialization. Its static
  factory keeps model references. `loadModel` is the narrow compatibility seam:
  only successful discovery updates an existing resolved record, before terminal
  admission and the next Pi compaction decision. No persisted model catalog added.
- Startup deduplicates successful model pairs within that pass while validating
  every valid native binding. The mixed fixture observes five valid bindings,
  three discovery calls, and all five bindings before either denied-conversation
  abort or resume. Reopening performs three fresh discoveries again. Discovery
  failure reaches neither abort nor resume.
- Regressions cover real local/hosted parser text, reasoning, tool deltas,
  signatures, usage, stop reasons and cancellation; low-level versus simple
  options; concurrent registration; explicit native-settings refresh; first local
  inference reaching standard threshold compaction; discovery failure preserving
  unknown capacity; and renewed observation after explicit invalidation.
- Validation: `pnpm vitest run` on `nativeProvider.test.ts`,
  `citationProvider.test.ts`, `citations.test.ts`, `compaction.test.ts`,
  `compactionAuthority.test.ts`, and `runtimeStartup.test.ts`: **64 tests passed**.
  Focused TypeScript compilation of the changed provider and test entrypoints
  (using the repository tsconfig) passed. Pi remains pinned at 1.3.0; only public
  package exports are used. No native app/vault, broad build/test or architecture
  operations were performed for this ticket.

### 2026-10-16 — Integrated acceptance

Accepted by ticket 06; see [the verified outcome](../outcome.md). This historical
record is outside the executable backlog. Native guarantees and stated platform
limits remain as recorded there.
