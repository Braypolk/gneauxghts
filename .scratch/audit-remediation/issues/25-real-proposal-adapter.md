# 25: real proposal adapter

Status: ready-for-agent
Progress: implemented; focused verification passed; see ../documents.md
Owner: audit_documents
Findings: FC-10, FC-11, FD-04

## Plan and acceptance

Replace hand-written hunk state with actual EditorState/Compartment/review extension. Verify second preview IDs, mapped local edits, multi-hunk keep/undo, remount and sibling state. Exercise real notepadProposalAdapter with composition harness for passive arrival/reuse/chat/editor target/conflict.

Before implementation inspect current worktree changes and preserve the prior bounded cleanup. Verify any hypothesis before changing behavior. Keep stable document handles, WorkspaceStore pane ownership, operation-specific adoption and canonical publication boundaries. Record focused validation and evidence-backed dispositions; split further if unrelated behavior appears.
