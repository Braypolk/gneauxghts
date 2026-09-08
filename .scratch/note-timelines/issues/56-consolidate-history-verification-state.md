# Consolidate history verification state

Status: ready-for-agent

## Outcome

Implement the runtime part of [the consolidation plan](../architecture-consolidation-plan.md). Replace the verification model rather than layer another coordinator over it. Keep recovery, operation barrier, current-content freshness and Editing Window owners separate.

Use one explicit background-worker lifecycle and scoped per-note checks/replacements. Remove obsolete Verified/Unverified integrity distinctions and the close-as-running sentinel. Scope-check successes and failures before accepting them; centralize completion/restart decisions. Make passive readiness counts constant-time. Preserve current public contracts and paused issue-55 E2E hook.

## Acceptance

All existing behavioral readiness, corruption, replacement, recovery, close and Editing Window guarantees remain. No I/O under the readiness mutex, unrelated-note serialization or rescan per save. Retryable failure does not spin. Replacement finishing while a worker completes must wake coverage. Failed close permits retry; successful close cannot restart work. Retain focused outcome tests and remove obsolete implementation helpers only where no longer needed. Ordinary compilation, focused timeline and architecture checks must pass. Review state/lock/caller simplification and measured net production reduction against before56; do not change unrelated code or historical reports.

## Comments

Root selects the narrower existing-runtime design after independent alternatives. The suggested close/initializer lock inversion was investigated and withdrawn: initialization already drops its candidate lease before awaiting the file owner. No speculative lock-order rewrite is requested.

## Resolution

Implemented 2026-09-06; both independent reviews cleared the final patch.

The private verification coordinator now owns the corruption latch, scoped result
acceptance, cached readiness counts, and one explicit coverage lifecycle. Removed
`IntegrityAttestation`, its separate mutex/nested locking, the started/complete/
unavailable flag combination, and the close-as-running sentinel. Per-note tickets,
store generations, and replacement epochs remain distinct. Replacement guards and
worker completion converge on the same scheduling decision; retryable failure waits
for another caller. Close settlement has its own phase and a fresh private token,
while old workers stay cancelled. Successful close stops that token; failed close
restores admission without clearing discovered corruption.

SQL and worklist union construction remain outside the readiness lock. Individual
target claims own proof-map insertion; background enumeration does not bulk-grow
that map. Verified counts are maintained on transitions; total counts retain the
latest enumeration and subsequently known entries without a passive scan.

Delayed failures from History Mode, Current-Content, missing-note reads, publication,
and startup recovery now capture their originating store scope through one runtime
operation wrapper before work starts. The same scope-first acceptance used by
verification discards obsolete failures after reset. Successful results retain their
existing freshness/committed-result contract. Unscoped result tracking is private to
observation replay, whose mutex excludes reset through completion, including reset's
own generation-changing failure path. Removed redundant window-tick tracking inside
that existing owner; recovery, operation draining, freshness, and timers keep their
original ownership and lock ordering.

Validation: ordinary `cargo check` passed; focused `services::note_timeline` tests
passed **221**, with **9** existing ignored cases; architecture fitness passed **17**.
All original **17** readiness/race tests remain, plus two tests covering cached counts,
retryable failure without spinning, successful-close restart rejection, and a delayed
read corruption result arriving after reset through both outer read access paths.
Logs: `/tmp/issue56-check.log`, `/tmp/issue56-timeline.log`,
`/tmp/issue56-readiness.log`, `/tmp/issue56-architecture.log`.

Compared with exact `before56.tgz`: **62 fewer production Rust lines**, **102 added
test Rust lines**, **0 tooling changes** (line counts include comments/blanks and
separate inline `cfg(test)` items). This is below the 150–250-line planning estimate:
explicit lifecycle/count maintenance and closing the delayed-error scope gap offset
part of the obsolete machinery removed. No formatting compression or coverage
removal was used to pursue the estimate. Current architecture ownership text changed;
ADRs and historical validation reports did not. Paused issue-55 files match the
baseline, apart from verification implementation changes that preserve its existing
`background-note-verification` E2E hook. No full suite, native launch, scale run,
scale fixture generation, user database operation, or commit was performed.
