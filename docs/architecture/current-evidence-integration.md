# Current evidence integration

September 21, 2026. This release combines scoped current-content search/read,
line-level provenance and task evidence, stable passage citations, deterministic
note-activity inventories, bounded optional research and explicit source-first
preview. Related-note suggestions run asynchronously so typing stays responsive.
App-data initialization is transactionally serialized. Provider usage informs
per-runtime context admission; successful loaded-capacity observations remain
fresh and unavailable metadata uses a short retry delay.

The cleanup preserves complete recent user/source-free messages, removes the
experimental general query router and unused provenance adapters, and reuses
validation work only within one operation. Repeated payloads still consume
context. Permission changes, edits and cleared provenance invalidate evidence.

## Retained and open work

- Ordinary autonomous search/read and date-based note inventories are active.
- Research and source-first preview remain explicit optional capabilities.
- Claim extraction, semantic verifiers and shortened-prompt candidates were
  rejected; they are not active production paths.
- Inferring that an event did not happen merely because its outcome is not
  recorded remains an open semantic grounding issue. This integration does not
  claim that issue is fixed. Model comparisons and further grounding tuning are
  deferred; the established provider/model configuration remains.
- Detailed experiment archives remain in the development worktree's local
  `.scratch/` directories. They are not required to run the application or tests.
  Native harness fixtures ship under `e2e/fixtures/` and the evidence service.

## Integration validation

The cleanup baseline passed 654 Rust tests (15 explicit opt-in tests ignored),
19 architecture checks, type checks and independent Standards/Spec reviews.
Final combined integration results are recorded below after reconciliation.
