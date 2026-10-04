# Combined audit remediation

The two audits contain153 named findings, including overlapping reports of the
same issue and rewrite hypotheses. An additional unnumbered task-date supplement is tracked under issue99c. Every input is retained in [findings.json](findings.json).

- [Delegation and integration plan](plan.md), [acceptance specification](spec.md)
- [Documents and coordination](documents.md), [editor/tasks/discovery](editor.md)
- [Frontend UI lifetimes](ui.md), [timeline/persistence](timeline.md)
- [Agent/chat/evidence/proposals](agent.md), [semantic execution](semantic.md)
- [Backend boundaries and harness](root.md)
- [Browser isolation/fitness](harness-documents.md), [native evaluations](harness-evaluations.md)
- [Independent Standards review](standards-review.md), [independent Spec review](spec-review.md)
- [Root production review](root-code-review.md), [agent correctness review](agent-code-review.md), [harness review](harness-review.md)
- [Final finding-ledger review](ledger-review.md), [late correctness review](final-late-review.md)
- [Integrated validation](validation.md)

Child issues live in `issues/`; canonical triage Status stays separate from
implementation Progress. Verification logs are retained in `validation/` and
module-specific validation folders. Final integrated verification passed; module reports retain focused investigation
history, while validation.md records the final acceptance. All153 findings and
the additional task-date supplement have reviewed dispositions across86 issue files.
Concrete defects and justified refactors were implemented; proposals rejected on
measured cost or ownership evidence are explicitly explained, rather than deferred.
No commits, push, merge or deployment have been performed.

## Result

- Fixed document/save/navigation races, task and search admission, chat retry lineage,
  listener/settings lifetimes, canonical storage boundaries and finite numerical
  scoring. The new real offscreen browser case caught and fixed a late scroll reset.
- Extracted cohesive chat and Atlas internals, removed legacy proposal writers and
  the duplicate raw HTTP agent loop, replaced policy-copying fakes with real seams,
  and consolidated fixtures, model policy, process ownership and architecture checks.
- Reworked browser/native test isolation, readiness, cancellation, measurement
  cleanup, execution lanes and CI configuration. Added real native command/event
  acceptance and preserved distinct persistence, geometry and provenance assertions.
- Final gates:1,162frontend tests,32support checks,752Rust tests,23Rust architecture
  checks,8Python checks,26browser files with passing final executions,13native smoke
  cases across7files and an actual two-process restart. Types and production
  compilation pass. See validation for exact composed-run evidence and opt-in limits.
