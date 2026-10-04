# Strict browser fixtures, owned server lifecycle and gate tiers

Status: needs-triage

## Audit sources

reports/harness-and-suite.md H2/H4/H5/H6/H7/H8

## Problem and intended result

Unknown browser IPC silently succeeds; Vite readiness can accept an unrelated server. E2E files share helpers and storage assumptions; native smoke/live/scale tiers are scattered.

## Acceptance and replacement coverage

Unknown IPC command fails visibly; explicit handlers use representative contracts. Startup races child exit against readiness, verifies fixture mode, and cleans only its owned process. Test occupied-port/failure cleanup with disposable children. Reset app storage per independent browser case and retain explicit restoration cases. Document runner tiers; native specs needing fresh fixtures run separately.

## Constraints and handoff

Keep real animation sampling and browser/native engine differences. Replace exact source-string fitness only when executable behavior or syntax-level boundary rules cover the invariant. CI additions depend on available native runners.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
