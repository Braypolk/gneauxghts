# Pre-commit cleanup

Reviewed 2026-09-30 against `HEAD ef6fed5` on `main`, including tracked changes
and untracked implementation, test and documentation files. Independent
Standards and Spec reviews used the repository code-review skill and the
composable-capability, evidence-contract, answer-evidence and reliability specs.
No commit or staging operation was performed.

## Changes

- Exclude generated JSON/PNG reports under `.scratch/chat-reliability/` from
  Git while preserving their local evidence and the Markdown specs/issues.
- Format the two new native chat specs without changing their TypeScript syntax
  trees, fixture prompts or assertions.
- Format the changed Rust files that failed the scoped formatter check.
- Reconcile the original capability spec with the approved retained-history
  policy and removal of the dedicated source-preview path.
- Correct an activity-page budget error: when the full serialized page cannot
  fit a nonzero remaining allowance, return `evidence_budget` and
  `finish_with_available_evidence`, rather than `invalid_request` and
  `correct_request`. The failed page still consumes no allowance.

## Validation and review

The real timeline regression with 23,900 bytes already consumed failed on the
old error code, then passed after the correction. All four tests in the
`query_inventory` module pass. `pnpm check` passes with zero Svelte errors or
warnings and passing E2E types. Scoped Rust formatting passes for all 30 changed
or new Rust files, and `git diff --check` passes.

The full repository formatter also reports existing differences in untouched
`search_commands.rs` and `tags.rs`; this cleanup leaves those outside its scope.
The prior worker validation established 681 passing Rust tests, 19 architecture
checks and five live native scenarios. Those suites were not repeated for
formatting, documentation and this focused budget-feedback correction.

The follow-up review clears the budget correction; the Spec review finds no
actionable implementation gaps in the approved milestones. Repeated full-note
revision scans are recorded in issue 06 for measured performance work. General
citation entailment remains open in issue 07. Neither is claimed solved by the
passing fixtures.

The interdependent capability, history, evidence, runtime, UI and regression
changes form one coherent chat feature commit. Include their ADRs and validation
Markdown; omit the ignored raw diagnostic reports. See
[worker validation](worker-validation.md) for the live milestone results.
