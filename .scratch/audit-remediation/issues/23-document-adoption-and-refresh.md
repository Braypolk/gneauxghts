# 23: document adoption and refresh

Status: ready-for-agent
Progress: implemented; focused verification passed; see ../documents.md
Owner: audit_documents
Findings: FC-02, FC-05, FD-06

## Plan and acceptance

Extract private normalized adoption implementation retaining two public DTO boundaries and operation-specific policies. Add table contracts for tags/errors/identity/warnings/preservation. Reproduce delayed old refresh versus newer same-path adoption using deferred promises before selecting minimal version correlation fix.

Before implementation inspect current worktree changes and preserve the prior bounded cleanup. Verify any hypothesis before changing behavior. Keep stable document handles, WorkspaceStore pane ownership, operation-specific adoption and canonical publication boundaries. Record focused validation and evidence-backed dispositions; split further if unrelated behavior appears.
