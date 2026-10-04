# 26: async completion and history leases

Status: ready-for-agent
Progress: implemented; focused verification passed; see ../documents.md
Owner: audit_documents
Findings: FD-08, FD-10

## Plan and acceptance

Use controlled overlap to prove suppression lifetime issue then preserve workspace-wide policy with counted leases if confirmed. Return/join legitimate proposal completion promises to replace predictable waitFor polling. Replace session mount fixed microtask loops with dependency completion observation; keep deliberate race barriers.

Before implementation inspect current worktree changes and preserve the prior bounded cleanup. Verify any hypothesis before changing behavior. Keep stable document handles, WorkspaceStore pane ownership, operation-specific adoption and canonical publication boundaries. Record focused validation and evidence-backed dispositions; split further if unrelated behavior appears.
