# 22: sequence reference oracle

Status: ready-for-agent
Progress: implemented; focused verification passed; see ../documents.md
Owner: audit_documents
Findings: FC-01, FD-03

## Plan and acceptance

Retain cheap exhaustive triples but declare expected outcomes with independent reference preconditions; compare results/state and reject unexpected exceptions. Include legal-command forced-throw oracle test and directed longer lifecycle paths. Keep pure reducer and stale-token contract tests.

Before implementation inspect current worktree changes and preserve the prior bounded cleanup. Verify any hypothesis before changing behavior. Keep stable document handles, WorkspaceStore pane ownership, operation-specific adoption and canonical publication boundaries. Record focused validation and evidence-backed dispositions; split further if unrelated behavior appears.
