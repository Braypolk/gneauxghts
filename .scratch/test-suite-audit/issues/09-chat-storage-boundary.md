# Chat admission, finalization and SQLite connection policy

Status: needs-triage

## Audit sources

reports/backend-agent-and-evidence.md CHAT-01/02/03/04/05

## Problem and intended result

Request admission writes messages before durable run/context admission; terminal persistence failures can be discarded. Most tests seed SQL. Connection pragmas vary, and each text delta rewrites accumulated output.

## Acceptance and replacement coverage

Extract private production admission/terminal operations with real SQLite and controllable projection sink. Inject failures for attachment/run/context/source writes, prove retry disposition and startup convergence. Centralize connection policy with legacy compatibility coverage. Measure streaming bytes/writes before bounded coalescing; explicitly define partial-output durability.

## Constraints and handoff

Retain four-state startup reconciliation and distinct retry/permission/proposal contracts. Do not claim archived deletion leaks: its helper enables foreign keys.

Read the linked module report and architecture invariants before implementation. Audit baseline is `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`; verify current callers and line locations again. See `../review.md` for initial implementation scope; avoid repeating completed work.
