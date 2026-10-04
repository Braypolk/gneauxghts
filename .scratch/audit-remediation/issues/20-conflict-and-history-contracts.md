# 20: conflict and history contracts

Status: ready-for-agent
Progress: implemented; focused verification passed; see ../documents.md
Owner: audit_documents
Findings: FD-01, CC-03, CC-04

## Plan and acceptance

Inspect Sol conflict and historyCommand diffs. Reconcile only bounded changes with original error and superseding-conflict regressions. Make each timeline vocabulary exhaustiveness compile checked. Run conflict, historyCommand and timeline fixture suites.

Before implementation inspect current worktree changes and preserve the prior bounded cleanup. Verify any hypothesis before changing behavior. Keep stable document handles, WorkspaceStore pane ownership, operation-specific adoption and canonical publication boundaries. Record focused validation and evidence-backed dispositions; split further if unrelated behavior appears.
