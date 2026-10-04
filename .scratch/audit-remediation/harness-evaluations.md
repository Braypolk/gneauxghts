# Native evaluation harness remediation

Progress: complete; final integrated acceptance recorded in validation.md

Findings: EH-14; BB-05 live-evaluation boundary disposition. Plan recorded in issues/83b-native-evaluation-harness.md before source edits. The deterministic native command/event round trip is now implemented in child issue 83c; root owns serial native execution and other BB-05 codec coverage.

## Implementation and retained ownership

Six live suites now use `e2e/support/liveNative.ts` for real native IPC, explicitly configured local provider/model/capabilities, disposable save/finalize/watcher-flush, terminal answer polling and shared passage resolution where the output shape is identical. Access remains full only for date-evidence and approved elsewhere. Lexical-only settings are changed only in the same three suites that changed them before. No hosted/provider fallback or merged opt-in flag was introduced. Missing IPC gives a clear command-labelled error.

`liveEvaluationArtifacts.mjs` owns structured persistence and is independent of WDIO. Artifacts preserve original scenario payloads and add actual start/record/case times and timezone, structural test results (including setup failures, failures and timeouts), last observed native answers and explicit `semanticGrading.status = not_run`. Polling records partial answers in memory and persists them at completion/failure rather than performing repeated disk writes inside latency measurement. Scenario rubrics and narrow semantic assertions remain in their original suites; a passed structural suite does not assert comprehensive answer correctness. Known-match research comparison now requires a nonempty citation set before checking successful resolutions, removing the vacuous `every([])` pass. Empty-evidence query scenarios retain their intentional behavior.

Date-evidence records the exact instant/timezone/rendered date used to create its dynamic completion fixture, alongside actual case instants. It continues to use the native system clock for “this week”; no invented test clock or timezone override changes production date semantics. The fixed historical prose and dynamic completion date are therefore explicit in the artifact. Root's query-inventory conflicting-mode rejection and removal of the obsolete empty-stream assertion are preserved.

Scenario parity reviewed against the diff:

- Activity follow-ups: current status across notes, retained change evidence, UI citation navigation, exclusions and follow-up freshness remain.
- Research worker: current/historical/discovery/fallback/composed cases, worker actually-read evidence and prohibition on parent substitution remain.
- Chat dates: current/research/proposal cases, supported calendar deadline handling, exact reviewed edit and no canonical write before approval remain.
- Research comparison: direct/research/autonomous selection, alternating/reversed ordering, usage/context measurements and separate rubric/coverage remain.
- Date evidence: composer path, later production IPC cases, source construction/persistence, exclusion and edited-citation rejection remain.
- Query inventory: all modes, bounded composition/usage, date range and citation navigation remain. No scenario removed.

## Contract boundary truth (BB-05)

Codec fixture round trips prove encoding only. Browser overrides prove consumers and mounted wiring only. These six suites invoke the real `__TAURI_INTERNALS__.invoke`, ChatService/AgentRuntime and dispatched tool commands when explicitly run; offline tests do not certify Tauri registration, native event serialization or native consumers. The new deterministic `command-events.spec.ts` verifies task-save source, canonical saved identity, taskMutation event routing and staged-vault event admission through real registered commands and the production AppStore consumer. The live suites are additional opt-in runtime evidence, not substitutes for that deterministic command/event round trip. Best-effort notification semantics were not changed.

## Verification

- `pnpm exec tsc --project e2e/tsconfig.json`: passed after final extraction.
- `node --test e2e/support/liveEvaluationArtifacts.test.mjs`: **3/3 passed**. Checks cover no implicit configuration fallback/scale isolation; exact receipt/new-message admission; persistent partial evidence, failed and passed cases, explicit ungraded semantics and evaluation clock.
- Focused diff review preserved unique assertions and flags; `git diff --check` on owned changes passed.
- Not executed: any live inference, native app launch, provider quality rubric grading. These require an explicit endpoint/model/output and the pre-existing per-suite opt-in.

## Integration follow-up discovered by root browser run

The strict fixture exposed two Settings spec overrides that called the original unknown command before handling model setup/pause. `settings.spec.ts` now installs explicit per-test command handlers through the public override map. The backend installer retains that mutable map (`??= {}`); invocation recording stays in the backend and unknown commands still reject. E2E typecheck passes. Root owns the browser rerun.

## BB-05 deterministic native acceptance (83c)

Added `e2e/specs/native/command-events.spec.ts` to the deterministic smoke lane. It calls registered Tauri commands without a disabled EventBus or command mock, then observes production AppStore fanout/admitted state through a scoped E2E-only `nativeContractProbe` on the existing Notepad bridge. The probe only subscribes, reads and clears its observation log; teardown releases all subscriptions and ordinary builds erase the branch.

Two acceptance cases cover: (1) save_note canonical identity/path/revision delivery, rename via save_task_note preserving note identity and retaining actual taskAction history/body, followed by toggle_task emitting the exact taskMutation/note/not-deleted/null-chat payload and updating canonical Markdown; (2) set_vault_directory's full emitted and admitted VaultInfo agrees with the command result, selectedPath changes while runningPath stays fixed, and a subsequent save remains in the running vault. Staged preference is restored in finally. All writes/staging assert an owned disposable native fixture.

`pnpm exec tsc --project e2e/tsconfig.json` passes; Svelte check reports **0 errors, 0 warnings**; owned diff check passes. No Rust or app rebuild is required solely for this frontend probe/spec. Root serial native runtime execution passed **2/2**, recorded in `validation/native-command-events-final.log`.

## Native acceptance execution and normalization correction

Root's first `command-events` run passed canonical save/task provenance/task event acceptance, and all main staged-vault assertions. Its restoration wait exposed a test expectation problem: a nonexistent initial selected default keeps its original `/var` spelling; staging creates it, and canonicalization resolves `/private/var`. The test now captures the restoration receipt, proves its path equals `realpathSync(initial.selectedPath)`, then requires both delivered full event and admitted snapshot equal the receipt. Production event admission was not changed. Root serial rerun passed **2/2** cases; evidence: `validation/native-command-events-final.log`.

## Remaining native measurement lifecycle cleanup (99f)

See `issues/99f-native-measurement-lifetimes.md` for implemented EH-09 cleanup across sustained Editing Windows, chat typing and timeline native metrics. Continuous sampling always stops in finally; bounded/exactly-once finish paths cancel outstanding nested frames, timers and late listeners. Existing timing workloads and budgets remain. Four focused offline lifetime tests and final E2E TypeScript pass; performance suites were not run.

## Final coordinator acceptance

All delegated work in this report is resolved. Earlier integration-pending notes
are chronological evidence; [validation](validation.md) records the completed
combined and targeted checks. Additional ledger discoveries and their closures
are documented in [ledger review](ledger-review.md). No external/live/scale
performance or model-quality result is inferred from deterministic acceptance.
