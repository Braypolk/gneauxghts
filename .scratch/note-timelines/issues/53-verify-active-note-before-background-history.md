# Verify the active note before background history

Status: ready-for-agent
Depends on: 52

## Acceptance

Implement the user's selected policy: after essential current-store admission and interrupted-work recovery, reads/writes requiring a Note Timeline verify that note before use, while unrelated retained histories are checked by background work. Once any corruption is discovered, retain the existing global publication block and recovery guidance. No save bypasses durable history preparation. Store-wide structural failures remain failures even when discovered through a scoped query.

Keep readiness, in-flight verification, generation invalidation and worker lifetime private to the existing NoteTimeline runtime. Foreground requests must not wait on an unrelated whole-vault verification lock; background work yields between bounded units and can be stopped for close/switch. Avoid a second job framework or owner. Publish a small storage-neutral readiness contract for issue 54. Explicit full health diagnostics remain honest about verification progress and detected failures.

Record the deliberate change from whole-vault-before-first-save verification in an ADR and behavior invariants. Scope changes do not weaken token, rollback, capture, citation eligibility or committed-warning rules.

## Design guidance

Keep essential store admission/recovery, scoped note verification and background coverage distinct. Use a small private per-note verification entry with in-flight/result state and replacement identity, scoped by the runtime store generation. Foreground callers can claim their own unstarted note or join only that note's verifier. Do not perform SQLite work while holding the readiness/integrity mutex, and do not require the global note-file mutation mutex to complete verification: a writer may already hold it while awaiting readiness.

Verify in a consistent SQLite read snapshot. Compare entry identity and store generation before applying either success or corruption; clear/purge/reset must discard obsolete failures as well as successes. Trusted app mutations can extend verified history after target admission without re-verifying the full note on every save. Existing global current-content generation tracks provenance delivery, not this per-note proof; unrelated writes and the caller's own mutation guard make it unsuitable here.

Use direct indexed note predicates rather than optional-filter SQL that can still scan the full table. Preserve typed unavailable/retryable errors instead of reusing boolean health helpers that collapse all failures into corruption. Full SQLite structural checks are whole-store work: schedule/report them honestly without holding a foreground readiness lock. Explicit health operations must also release runtime mutexes before their SQL work.

Background work needs cancellation within long verification loops and bounded operation leases. Stop scheduling before close waits for operations. Review baseline initialization, maintenance, observations, multi-note activity/provenance and close, not just editor admission. Portability still requires settled durable work and clean checkpoint/watermark ordering; it need not imply every old payload was exhaustively scanned on each close.

## Checks

Hold unrelated verification pending and prove an admitted verified note can be read/saved without waiting for it. Unverified target work must verify or fail; simultaneous callers share safe verification rather than redundant scans. Exercise corruption in the target and later in another note, pending recovery, failed retry, baseline initialization, watcher/action/lifecycle routes, and current-content grants over multiple notes. Concurrent edits, clear/purge/reset and close/switch must invalidate or cancel old work; stale results must never mark changed or replacement history verified. Preserve progress/error visibility and avoid deadlocks or publication races.

## Comments

- 2026-09-06: User explicitly chose edited-note verification with background checks of other history and later discovery of unrelated corruption.

- 2026-09-06 review clarification: explicitly confirmed clear/purge/reset are replacement or discard operations. They need not reconstruct prose being discarded; they still require essential store admission/recovery, respect the existing discovered-corruption gate (with reset's explicit recovery authority), invalidate old proof across the entire replacement interval, and establish the canonical baseline where applicable. Any later canonical publication verifies its target and requires durable preparation. This does not authorize saving without verified history.


## Resolution

Implemented target-note verification after essential current-store admission and
actual interrupted-work recovery, with one cancellable private background worker
for unrelated notes and whole-store structure. Foreground callers claim their
own unstarted target or join only the same target. Complete note verification
uses one SQLite read transaction and indexed note predicates. Trusted mutations
extend an established proof; no canonical publication skips durable history
preparation. Later discovered corruption blocks new global admissions.

Replacement identity and runtime generation protect both successful and failed
results across clear/purge/reset, including overlapping health diagnostics.
Replacement completion wakes background coverage without retrying unchanged I/O
failures indefinitely. Baseline, observation, deadline, lifecycle, activity,
provenance, history access, maintenance and close routes follow the new boundary.
Current-content eligibility and committed-result warnings remain authoritative.

The backend readiness snapshot and target-await contract are available for issue
54. ADR 0008, architecture and behavior invariants record the deliberate later
corruption discovery policy and the narrow confirmed-discard exception; explicit
reset retains its authority to resolve a corrupt store. Issue 54 owns UI/bootstrap
integration; issue 55 owns large fixtures and native acceptance.

Independent Standards and Spec reviews passed with no remaining findings. Final
focused regression: 219 passed, 0 failed, 9 ignored; final architecture fitness:
16 passed. The full library suite passed 560 tests before the final bounded wake
fix and its added deterministic regression; the final focused and architecture
checks cover that follow-up. Its counterexample fails with the fix removed and
passes when restored. Exact source stages, logs and limitations are in the
[validation report](../../../docs/architecture/note-scoped-readiness-53-validation.md).
No user database or native application was used. Source is frozen for the
orchestrator's final snapshot. Issue 53 is complete for its scope; canonical
`ready-for-agent` triage status is unchanged.

- 2026-09-06 orchestrator audit: Standards and Spec findings and the replacement wake follow-up are resolved. Verified final 219 focused tests and 16 architecture checks; the preceding full-library 560-test pass and final follow-up scope are distinguished in the report. All 17 historical validation/measurement files match the post-52 snapshot byte-for-byte. Approved sequential handoff to issue 54.
