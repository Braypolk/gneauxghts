# Deterministic released-capture recovery contention

Status: ready-for-agent
Progress: Complete. Implemented, independently reviewed and validated.

## Plan

Replace the ten start-barrier repetitions with two isolated real fixtures, reader-first and writer-first. Each still publishes A, injects the real finalization failure on B, admits two real recovery readers and the real C save, and preserves every existing final assertion.

Add one runtime-local cfg(test) recovery-lock observer. It reports ownership only from ensure_history_recovered after the real history_recovered mutex is acquired and before replay. Contention is observed with try_lock returning WouldBlock inside lock_history_recovery, immediately followed by the existing blocking lock path; successful probes are dropped and never substitute a second lock implementation. The observer is absent on background worker clones and cleared before final assertions.

The first admitted caller pauses while holding the real recovery mutex. Start the two competitors only after that pause is acknowledged, and require two WouldBlock events before releasing. Reader-first forces another reader plus writer to contend; writer-first forces both readers to contend. Use existing ReleaseOnDrop inside the thread scope and five-second receive bounds; no sleeps or new generic scheduler. The existing scoped joins occur after unconditional gate release. Final prepared-count, canonical/pending hash and exact retained A/C history assertions stay byte-identical.

Read ARCHITECTURE.md, behavior-invariants recovery/publication requirements, Editing Window recovery contract, ADR0005 and prior rust-slow-tests/concurrency-search-audit.md. No canonical publication/recovery algorithm, source geometry or regular test inventory changes. Mutation verification should remove/bypass the shared recovery lock and show that the required blocked events cannot occur; root runs and restores the mutation.

## Coordinator validation

Focused case passes. Combined five-run median: 3.51s before to 0.28s after. Test inventory unchanged. Both mutation-sensitivity checks behaved as expected with source restored. Recovery passed 20 additional fresh-process repetitions (two schedules each). Full library 725/725 and architecture 21/21 pass. Full-suite runtime attribution remains in progress; first before/after totals 97.99s/100.98s do not show an overall speedup.

Final acceptance: all 725 library tests and 21 architecture checks pass; test inventory unchanged. Three changed cases total 7.06s→1.14s in matched full profiles. Full candidate runs remain approximately100s; no precise overall gain claimed. Source restored after mutation checks. See ../README.md and ../mutation-results.md.
