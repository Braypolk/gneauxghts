# Combined audit review and implementation decision

Initial review: 2026-10-02; reconciliation and verification: 2026-10-03, America/Denver. Baseline: `cb4d4c0`.

All six module reports were saved and read before application/test edits. Five subagents covered distinct module groups; the primary reviewer traced cross-cutting contracts, reproduced execution limits, cross-checked candidate changes and reconciled overlaps. The initial reports contained 70 named review items, including related findings that deliberately share a larger workstream. This is a broad test/target-code audit, not formal verification of all production branches. The app/semantic report explicitly identifies inventory/interface-only areas.

## Priorities by related module

| Module | Correctness / weak evidence to address first | Cleanup and larger replacement |
| --- | --- | --- |
| Document/workspace/navigation | FD-01 exception strands conflict; FD-02 pre-open task identity; FD-03 generator accepts unexpected exceptions; FD-04 hardcoded proposal fake | FD-05 faithful typed command-composition harness, FD-06 private normalized adoption helper, FD-07 duplicate/disconnected assertions |
| Editor/search/tasks | FE-01/02 stale search/related response; FE-04/05 disposed subscriptions/stale group patches; FE-07 parser/fence disagreement | FE-08/09 actual runtime undo tests + shared headless adapters; FE-10 incremental decoration inventory; FE-12 small invariant vs scale measurement |
| Chat/Atlas/app | AA-01 send receipt overwrites observed events; AA-02 partial/duplicate listeners; AA-03/04 visibility/lifetime admission | AA-08 real shared AppStore harness; AA-12 private chat/Atlas module split; AA-13 mounted action coverage |
| Note Timeline/persistence | BT-01 global fault consumers unguarded; BT-04 test masks task projection; BT-10 typed errors become Unavailable | BT-02 remove legacy test-only save replica after porting cases; BT-03 RAII fixtures; BT-05 bootstrap schemas once; BT-09 threshold-sized default tests; BT-11 private store split |
| Evidence/retrieval/semantic | AA-05 note picker multiplicity; AA-07 env restoration hazards; AA-10 hybrid composition gap | AA-06 replace fixed 2-second lock wait; AA-09 request-local read/hash reuse with fresh admission; AA-11 retire shadow evaluation protocol; AA-14 explicit catalog/numerical policy |
| E2E/fitness/contracts | EH-01 omitted cheap support tests; EH-04 unrelated Vite readiness; EH-05/06 permissive/eventless/mistargeted browser double; CC-03 inherited error state | EH-02/03 explicit native/CI lanes; EH-08/09/12 scenario split + bounded process/frame helpers; CC-01/02 and FD-09/BT-12 remove spelling/duplicate-compiler checks; CC-04 exhaustiveness; CC-05 timestamp boundaries |

## Cross-checks and corrections

- Canonical document handles, operation-specific adoption, departure queues, History Mode overlays and role-limited Note Timeline seams already hide real consistency policy. Preserve them. Proposed internal extractions must not create competing owners or generic public mutation policies.
- Pure reducer, real service, command serialization, browser geometry and native durability tests can describe the same feature while protecting different boundaries. Require a behavior-to-test replacement map before deletion.
- CC-01, FD-09 and BT-12 are one fitness workstream. CC-02's type-program test is a separate bounded removal: `pnpm check` already rejects removed properties on typed NoteDraftState receivers, structural ownership tests still enforce shape, and `any` receivers evade the current predicate anyway. An intentionally widened intersection is its only hypothetical unique guard; no current requirement uses it. Both primary and document reviewers accept removal after the passing compiler baseline.
- BT-01 and AA-07 are related isolation work, but adding the same mutex only to env writers does not isolate unguarded readers. RAII restoration and explicit fixture/configuration boundaries are the long-term solution. The immediate canonical-writer test lock corrects a precisely identified fault consumer.
- EH-13's native empty-stream expectation contradicts current streaming. The linked integration report is already headed "Historical integration report". Preserve its historical measurements and release description; clarify that its "Retained and open work" list also describes that past integration instead of rewriting history as though source-first preview never existed.
- CC-05 proves invalid calendar-day acceptance, not a need to accept every RFC3339 variant. Retain the exact managed UTC grammar when replacing custom date arithmetic.
- The failed Rust capacity test is environment-only: sandbox forbids `TcpListener::bind`, and the focused unrestricted retry passes. It is not evidence for an app defect. Default-parallel Rust suite passed other tests; inferred isolation risk remains a finding rather than a measured flake rate.
- Frontend timing is one concurrent-host observation. The 2.34-second compiler assertion is measurable overhead; do not promise that deleting it reduces whole-suite wall time by exactly that amount. Imports/transforms dominate several other slow cases.

## First implementation tranche accepted

These changes are authorized by the user's instruction to implement after the audits/review. The audit files above precede the first source modification.

1. FE-01/02: retire obsolete requests on replacement scheduling/reset and add deterministic deferred regression cases; preserve debounce and cheap collapsed-panel behavior.
2. FD-01: correlate exception recovery across initial/rollback editor effects; preserve newer conflict and original diagnostics. FD-07: remove literal duplicates/disconnected spy, assert real notOpen ownership.
3. CC-03: own-property history error membership with malformed object-state regression. CC-02: delete the duplicate whole-project type-program assertion while retaining structural ownership and required compiler checks.
4. EH-01/13/15: run eight existing cheap support tests from the ordinary test command; remove only the obsolete streaming assertion; clarify historical documentation; close Python SQLite connections using existing contextlib conventions.
5. BT-01/04/07: serialize identified canonical-writer fault consumers, remove manual second task projection, delete the no-fault duplicate test. Preserve actual semantic-failure and required-warning cases.

No comprehensive rewrite is included in this tranche. The larger designs have enough evidence to merit separate tasks; they require faithful replacement tests, browser/native or profile evidence, and sometimes an explicit semantic decision. Individual follow-up tickets retain those boundaries and acceptance criteria.

## Completion policy

Run focused regression suites first, then one full frontend/check/harness gate and affected Rust tests. Compare resulting changes to accepted scope, preserve original audit evidence, and record actual tests/counts/limits in validation. Native and live-model/scale runs remain unexecuted unless the changed behavior requires them; stale assertion removal is type-checked, not claimed live-evaluation success.

## Final inventory reconciliation and review

Dated supplements correct initial detailed-inspection omissions. They add two editor items (FE-13/14), two timeline items (BT-13/14), two residual proposal items (CC-06/07), and seven backend-boundary items (BB-01–07): **83 named review items total**, with overlaps retained and linked across **18 handoff tickets**. The [coverage ledger](coverage-ledger.md) reconciles all 262 baseline inventory paths with literal report references. It is a navigation tool, not a claim of line-by-line coverage; module reports retain actual depth/limits.

Prioritize the following supplemental work after the bounded cleanup:

- Proposal resolver: overlapping oldText occurrences can be falsely treated as unique, or context-selected occurrences missed. Independently confirmed; ticket 17 adds pure ambiguity/Unicode cases and migrates unused commit wrappers while preserving exact prepared publication. The legacy automatic create-path retry is obsolete wrapper behavior, not a new production requirement.
- Backend search/cache: title is omitted from result-cache identity; kind filtering follows truncation; fabricated concurrent results prove the lower CurrentContent boundary rather than real command composition. Ticket 18 requires deterministic reproduction before changes. Preserve broader merger/evidence allowed-kind policies.
- Forgotten metadata: a named damaged-input/catalog test starts with repaired input; replace its oracle through the real continuity path. Keep lifecycle/race cases, reduce mock-app setup only after measurements.
- Settings/metadata: add focused retention queue/rejection, typography persistence/CSS, and task-date passage clipping/serialization boundaries. No new defects or large rewrite are established by those local gaps.
- Command/lifecycle teardown and wire evidence extend existing RAII and contract tickets. Preserve restart join/admission and committed-save best-effort notification semantics.

No supplemental target code was edited. This preserves the distinction between reviewed/implemented initial findings and newly documented follow-up work. Independent cleanup review found no actionable issue; [validation](validation.md) records passes, the sandbox-only localhost failure, untouched baseline Rust formatting failures, and unexecuted native/model/scale lanes. Larger rewrites remain reviewable proposals rather than a blanket migration.
