# Validate recovery and measure actual custom machinery retired

Status: resolved
Type: prototype
Blocked by: 03

Run the [spec's validation matrix](../spec.md#validation-matrix-and-stopping-criteria) using disposable data on native desktop and iOS simulator. Inject interruption around intent/approval/native receipt/engine outcome, storage failure, provider failure and cancellation. Exercise two sessions, decision races, changed targets, retained editor edits, review switching and evidence/history filters. Preserve synthetic scripts/selected logs needed to reproduce material findings.

Remove demonstrated duplicate coordination within the prototype path. Report literal removals/replacements separately from bypassed-but-retained production fallback code. Compare native adapters and app-specific approval logic added against generic machinery retired; do not inflate savings by deleting needed domain checks or creating new generic abstractions. Check relevant existing contracts and default build behavior.

Acceptance: `validation.md` and `results.md` with tested commit/environment, pass/fail/untested platform matrix, concrete deletion ledger, bridge/dependency/migration costs and adopt/narrow/defer/reject verdict. Commit the prototype in its worktree, retain reproduction instructions and report the result. Do not merge or enable it by default; physical/live-provider limits must remain explicit.

## Comments

## Answer

Completed the bounded native experiment and documented **defer adoption**. Both
platforms pass the essential native bridge and real editor/relaunch flows. Four
desktop fault gates pass, including exactly one native publication receipt after
each publication-boundary crash and no implicit network retry after termination.
Affected checks pass; selected reports/screenshots and reproduction tooling are
retained. See [validation](../validation.md).

Literal production removals are zero. Pi bypasses the generic custom conversation,
execution and durable approval paths without shadow state, but native bridges,
evidence policy, editable-review ownership and a publication intent/receipt
protocol remain custom. [Results](../results.md) records the owner/deletion ledger,
added costs and parity/migration limits. Physical and live-provider behavior remain
unverified. No merge/default enablement or production architecture rewrite.
