# 24: real command composition

Status: ready-for-agent
Progress: implemented; focused verification passed; see ../documents.md
Owner: audit_documents
Findings: FC-08, FD-05

## Plan and acceptance

Build typed local harness around actual WorkspaceStore, NotepadState, editing, persistence and createNotepadCommands; fake only IPC/editor presentation/focus/motion. Cover shared-document close, Forget/recovery, failed nested restore/retry, save rename MRU and retained review. Replace partial-graph casts where coverage overlaps; no new state owner.

Before implementation inspect current worktree changes and preserve the prior bounded cleanup. Verify any hypothesis before changing behavior. Keep stable document handles, WorkspaceStore pane ownership, operation-specific adoption and canonical publication boundaries. Record focused validation and evidence-backed dispositions; split further if unrelated behavior appears.
