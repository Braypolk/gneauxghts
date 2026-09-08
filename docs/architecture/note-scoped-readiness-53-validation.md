# Note-scoped readiness: issue 53 validation

2026-09-06. Implementation evidence against the exact post-issue-52 workspace
snapshot at `/tmp/gneauxghts-history-hardening-baseline/after52.tgz`.
This report covers backend readiness and verification coordination. Issue 54 owns
workspace/bootstrap presentation; issue 55 owns authentic large-history and native
acceptance. No native application was launched and no user database was reset,
converted, or used for these checks.

## Implemented boundary

NoteTimeline retains one private runtime and concrete selected-vault store.
Essential store admission and actual interrupted-work recovery precede ordinary
history use. A per-note verifier checks complete payload/base/result hashes,
record lineage and head, lifecycle vocabulary and receipt scope, and retained or
pending Editing Window evidence inside one SQLite read transaction. Scoped
queries use direct note predicates; whole-store structural checks run separately.

Foreground work claims its own unstarted target or joins that target's current
verification. Trusted publication and baseline insertion extend the proof without
replaying the retained note on every save. Current-content delivery generation
remains independent. Private per-note replacement guards cover the entire
clear/purge transaction; reset marks store replacement unavailable to public
admission. Entry identity, runtime generation, and replacement revision discard
obsolete successes and failures, including diagnostic results.

One background worker checks other notes and structure. Operation leases are
bounded to units of work, with cancellation checkpoints inside note loops and
SQLite progress callbacks. Baseline initialization verifies before acquiring the
canonical file owner, then rechecks captured Markdown before insertion. Close
stops background work before draining leases and permits only its own settlement
to complete pending work. No whole-vault payload attestation is required by clean
close. Confirmed discard operations need not reconstruct prose being removed;
clear/purge retain current-store/recovery admission and the discovered-corruption
gate. Explicit reset may replace an unavailable or corrupt store to resolve that
gate. All replacement operations invalidate old proof, and later canonical
publication still verifies its target. Explicit health SQL runs outside runtime locks and cannot clear a concurrent
corruption latch.

The backend exposes `history_readiness(Option<&NoteIdentity>)` and blocking
`await_history_readiness(&NoteIdentity)`. Snapshots carry a runtime scope,
replacement revision, optional Note Identity, one of recovery pending / target
verification pending / ready / unavailable / corrupt, verified and known-note
counts, background completion, and retryable background failure. Reading a
snapshot performs no storage scan. It is an observation, never a write permit.

The deliberate later-discovery policy is recorded in
[ADR 0008](../adr/0008-verify-target-note-history-before-background-coverage.md).
Every app-owned publication still requires durable preparation. A committed
publication retains its authoritative result and warning if later capture fails.

## Completed checks

| Check | Result | Log |
| --- | --- | --- |
| Final focused NoteTimeline suite, including replacement completion wake regression | 219 passed, 0 failed, 9 ignored; 24.70 s | `/tmp/issue53-focused-wake-final.log` |
| Dedicated runtime readiness race tests after audit follow-up | 16 passed, 0 failed; 1.27 s | `/tmp/issue53-readiness-audit-2.log` |
| Full Rust library suite, before final bounded wake fix and its regression | 560 passed, 0 failed, 9 ignored; 76.16 s | `/tmp/issue53-backend-final.log` |
| Backend architecture fitness after final wake fix | 16 passed | `/tmp/issue53-architecture-wake-final.log` |

Dedicated tests cover a held unrelated target with ready-note save/read and direct
claim of a new target, simultaneous same-target requests, retryable unavailability,
later corruption blocking new global admissions, no Markdown/preparation on a
corrupt target, obsolete success/error after replacement, actual background
coverage and recheck after clear, baseline initialization without the file owner
while verification waits, reset/clear/purge races, a verifier starting during a
clear transaction, stale diagnostics and an uncleared corruption latch, diagnostics started during replacement, corruption during
background note enumeration, automatic coverage wake after public clear/reset/purge,
excluded corrupt provenance targets, the activity candidate limit, and close
cancellation while a successful pending endpoint still settles. Storage tests
retain one read snapshot while another connection performs a production save and
seal, and stop verification within a note's payload loop.

The existing suite continues exercising pending publication/window/observation/
deletion recovery, live-intent exclusion, failure retry, action/task/proposal and
lifecycle routes, activity/provenance grants, canonical eligibility, citations,
clear/purge/reset, and clean-close portability. All fixtures use temporary roots.

The first full run (`/tmp/issue53-backend-all.log`) passed 554 tests and failed one
old-policy assertion expecting an exhaustive scan on fresh runtime recovery. That
assertion now expects no exhaustive scan and separately proves a subsequent
history read reuses the target proof. Earlier successful focused and race logs
remain `/tmp/issue53-focused-serial-3.log` and `/tmp/issue53-readiness-4.log`.

Intermediate compile/test logs remain under `/tmp/issue53-*`. Interrupted focused
runs were stopped before the next run; a serial run isolated and corrected an
explicit-recovery retry that recursively acquired the file owner during baseline
initialization. No timing from these debug correctness checks is claimed as
optimized startup or native acceptance evidence.

## Review and remaining validation

Independent Standards and Spec follow-up reviews passed with no remaining
findings. The final Standards follow-up identified a replacement-completion wake
race: a diagnostic rejected during clear could finish after the replacement's
wake request and strand background coverage. Completion now compares the
replacement revision under the same lock that releases worker ownership, then
restarts outside that lock. Unchanged retryable I/O failure still exits without a
hot retry loop.

The deterministic regression holds worker completion until public clear has
finished. Removing the restart condition makes that regression fail in 5.12 s
(`/tmp/issue53-wake-race-red.log`); restoring it passes in 0.12 s
(`/tmp/issue53-wake-race.log`). The final focused suite includes this new test.
The earlier full-library result predates only this bounded wake fix and test;
focused and architecture checks were rerun afterward. Earlier focused audit
results remain in `/tmp/issue53-focused-audit.log`.

Final large-history/compaction measurements and native workspace/save acceptance
remain issue 55 work after issue 54. No debug test duration here establishes
startup latency acceptance.
