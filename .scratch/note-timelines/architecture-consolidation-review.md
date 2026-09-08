# Architecture consolidation acceptance — issues 56–58

Completed 2026-09-07. Each dependent implementation used a fresh subagent, sequentially. Root audited the actual owner/caller paths and coordinated independent Standards/design and Spec/correctness reviews before acceptance. Both final reviews are clear. This report covers the consolidation; native and large-scale acceptance remain paused in issue 55.

## What became simpler

- **56:** One verification coordinator now owns scoped proof, worker phase, counters and current corruption. Removed the overlapping whole-vault integrity state and redundant scheduling flags. Recovery, operation draining, current-content freshness and editing-window deadlines remain separate existing owners because they have different lifetimes.
- **57:** One private blocking-command helper replaces repeated dispatch/state-lookup/join plumbing. Removed 27 trivial synchronous command mirrors. The document reducer receives a narrow save-wait reason; backend readiness diagnostics stay in the observer.
- **58:** Commands request complete saves and forgotten-note operations. Removed the three-callback save protocol, optional prepared context, duplicated source/session assembly, single-field session result wrapper and generic lifecycle entry. Preparation, file publication, rollback/recovery, finalization and trailing metadata updates stay within the appropriate existing transaction owner. Proposal/task prepared-publication APIs and create-only Missing Note recovery retain their distinct responsibilities.

Moving helpers into the private forgotten-note file is not counted as a simplification on its own. The change removes consistency obligations from callers. No actor queue, scheduler framework, command macro language, store trait, schema or compatibility path was added.

## Exact size accounting

Compared with the saved workspace archives, including existing issue-55 instrumentation, rather than the repository HEAD. Production counts exclude `#[cfg(test)]` items and test/validation modules; tests include replacement regressions and caller adaptations. Counts include normal formatting and comments.

| Issue | Production Rust net | Test Rust net | All Rust net |
| --- | ---: | ---: | ---: |
| 56 | -62 | +102 | +40 |
| 57 | -361 | +143 | -218 |
| 58 | +6 | -22 | -16 |
| Total | **-417** | **+223** | **-194** |

TypeScript/Svelte: production -4, tests +30. Tooling: no changes during consolidation.

The planned 500–800 production-Rust reduction was not reached. Issue 58 is approximately flat in production size: deleting caller protocols was offset by complete admission/recheck ownership and repairs to metadata, close and failed-rename races. Independent design review found no further large deletion justified within this scope. Readability and behavioral checks were retained rather than compressed to meet the estimate.

Baselines: `/tmp/gneauxghts-history-hardening-baseline/before56.tgz`, `after56.tgz`, and `after57.tgz`. Final saved workspace: `after58.tgz` in the same directory. Detailed temporary count audits: `/tmp/issue58-audit.json` and `/tmp/consolidation-audit.json`.

## Audit corrections and preserved guarantees

Final save enrichment uses the original authored input and rereads current disk properties under file ownership. Only fallback identity crosses admission retries, preventing a waiting body-only save from overwriting newer properties. Preflight work drops its lease before waiting for the file owner; publication acquires a new lease and rechecks readiness and pending durable work under the existing replay owner. Ready notes can progress while another target waits for verification.

A failed rename/write restores the original path when possible and returns an error. If rollback also fails, the dirty save still fails and its durable intent is released through existing capture recovery so later saves can retry without restarting. Typed corruption from preflight or receipt release remains scoped and latched appropriately. Committed publication warnings retain their existing authoritative-result semantics.

Forgotten lifecycle metadata completion now remains under file ownership and its operation lease. Selected-vault binding, exact selected-row comparison, source-byte checks, destination collision checks, conditional rollback and indeterminate metadata retention remain intact. Stale cross-vault path rejection retains its typed error. ChatService remains the owner of chat content.

## Final validation

- `cargo test --manifest-path src-tauri/Cargo.toml`: 578 library tests passed, 9 existing opt-in tests ignored; 17 architecture tests passed. Rust contract fixture test included. No failures. Library execution: 102.00 seconds.
- `pnpm test`: 835 tests across 124 files passed, including frontend architecture and contract fixtures.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed without warnings.
- `pnpm check`: zero Svelte errors or warnings.
- Independent Standards/design and Spec/correctness reviews: no remaining blockers. Root verified changed Rust source hashes remained unchanged during final checks.

Execution logs: `/tmp/consolidation-rust.log`, `/tmp/consolidation-frontend.log`, `/tmp/consolidation-check.log`, `/tmp/consolidation-svelte.log`. These checks are automated backend/frontend acceptance, not native paint or scale measurements.

All 19 historical validation/measurement reports were verified byte-for-byte unchanged. Twelve paused issue-55 paths are unchanged from the consolidation baseline; the verification file changed for consolidation while preserving its native fault hook. No user database operations, native launches, fixture generation, commits or database resets were performed during issues 56–58. Issues 22 and 24–26 remain deferred; issue 55 must supply native and large-scale acceptance for the stabilized implementation.
