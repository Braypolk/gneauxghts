# Complete remediation of the combined test/code audits

Requested 2026-10-03. Baseline: cb4d4c02f0e2c1220d37b281ee300eff1aabf20b plus the recorded initial uncommitted cleanup.

The user authorizes a top-level agent to delegate all findings from both audits, split oversized issues, verify uncertain claims before implementing, report verification to the coordinator, adjust the plan, and continue through implementation and review. Preserve existing user work. No deployment or feature deletion is implied by removing obsolete implementation/test paths.

Sources: ../test-suite-audit/ (70 named findings), sources/sol/ (snapshot of the other audit, 83 named findings). findings.json is the exhaustive input ledger, not 153 distinct bugs. Related findings are deliberately assigned together.

Completion requires every finding to have a disposition and evidence: implemented with validation; already addressed with a concrete pointer; or not warranted after verification, with the experiment/call-path explanation. Size alone is not a reason to defer. An external constraint must be recorded explicitly with the remaining validation, not presented as successful completion.

Do not rewrite merely to satisfy a suggestion. Confirmed behavior defects require regression evidence. Performance hypotheses require measured work or a demonstrated algorithmic defect. Tests removed or migrated must preserve distinct contracts. Keep NoteTimeline, DocumentEditingService, workspace/document ownership, runtime permissions/budgets, canonical identity and transactional consistency authoritative.
