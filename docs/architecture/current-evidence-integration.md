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
context. Permission changes, edits and cleared provenance invalidate evidence. Repeated
reads accumulate proofs in the persisted source, including after a later plain
read. Valid properties/title citations open their current note without inventing
a body highlight; mapped body passages select the precise current occurrence.

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

Main's existing window-reveal and Forget-confirmation changes were preserved in
commit `0f91430`, then reconciled with the current-evidence implementation. The
only merge conflict was additive README instructions; both were retained.
The older reconciliation branch was superseded by subsequent main work.

The combined integration passed:

- 655 Rust library tests; 15 explicit live/scale opt-ins remain ignored.
- 19 architecture fitness checks and seven focused tool checks after the final
  shared direct/research admission correction.
- 893 frontend tests, all 18 document/pane browser integration cases, type checks
  with zero Svelte errors/warnings, and three native-artifact isolation tests.
- Native typing with a 2,000 ms suggestion delay: 15–36 ms input-to-paint samples,
  at most one search running, and the final draft searched.
- Native weekly inventory: four allowed notes this week, all four links resolved,
  one rendered link opened at the exact editor range; last week returned zero
  matches with September 14–21, America/Denver bounds.
- Native ordinary autonomous search: the Supplier Elm fixture answered $24 per
  seat and its link resolved to the correct source paragraph.
- Native bounded research: one worker delivered four selected passages; all
  four links resolved. The result explicitly retained partial coverage.
- Independent Standards/correctness and Spec reviews, including re-review of
  both citation corrections, report no remaining actionable findings.

The browser history assertion initially failed on both the integration and main.
Main's `b372c89` intentionally changed the default to parent comparison; the E2E
expectations were updated to match while retaining explicit current/previous
comparison checks. No history UI behavior changed for that test correction.
The weekly harness now computes prior-week expectations from its request date
instead of assuming the original September 14 benchmark date.

Native checks use disposable vaults, lexical retrieval and the authorized local
`qwen/qwen3.8-27b` at `http://100.117.20.29:1234/v1`, with isolated ports 1431/4446.
They establish integration behavior, not general answer-quality guarantees.
Raw validation artifacts are retained locally under `.scratch/merge-current-evidence/`.

The additional first-visible window probe initially failed: its smaller saved
window appeared maximized. A fresh main baseline and a repeat with the same
integration binary then passed all three saved-size/first-launch cases. No window
implementation changed between those runs. The cause remains unresolved and is
tracked separately as an intermittent window-smoke issue; the passing rerun is
not evidence that the original failure was fixed.
