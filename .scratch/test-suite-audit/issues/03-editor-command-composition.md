# Editor command composition and guarded asynchronous edits

Status: ready-for-agent

## Audit sources

reports/editor-and-discovery.md ED-06/07/08/09

## Problem and intended result

Custom cut-line awaits clipboard then deletes the currently selected block. Duplicate fence scans and permissive editor fakes leave composition behavior unprotected.

## Acceptance and replacement coverage

Delayed clipboard completion after caret move, text change, read-only takeover or destruction retains text. Exercise actual auto-close/surround/table extensions with mixed/long fences and code examples. Share a state-backed command harness; retain browser geometry and focus checks.

## Constraints and handoff

Preserve shared document undo and pane-owned selection/viewport. Batch transaction defect is handled in the initial implementation only if recorded in review.md.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
