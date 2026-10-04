# Shared native evaluation mechanics and honest result contracts

Status: ready-for-agent
Progress: implemented; E2E typecheck and three offline helper tests pass; live-provider verification intentionally not run.
Owner: audit_ui_semantic
Findings: EH-14, BB-05 (live-evaluation portion; deterministic dispatch owned by root)

## Verified scope and plan before source edits

Read Sol e2e-harness EH-14 and backend-boundaries BB-05. Six native live suites repeat raw IPC, provider/capability configuration, disposable note save/finalize/flush, terminal polling and JSON persistence. Preserve all unique semantic scenarios, opt-in flags, endpoint/model/output requirements, local provider with no fallback, approved/full access policy differences and lexical settings where currently explicit. Root already fixed query mode mutual exclusion and stale empty-stream assertion; preserve those.

1. Extract one native live client for real IPC/config/save/poll mechanics and a structured artifact writer with explicit structural execution results versus semantic grade (`not_run`). Persist case failures/timeouts as well as success, keeping scenario-owned rubrics/assertions in their specs.
2. Replace the six duplicated clients/configuration and common save/poll paths. Require nonempty evidence in comparison known-match cases before successful resolution checks. Record actual evaluation instant/timezone; do not invent a frozen native clock or change user runtime timezone semantics.
3. Record codec-versus-native-dispatch distinctions and required native round trips. Do not claim offline mocks prove Tauri registration/events. No live model endpoint assumed and no live provider runs.
4. Verify E2E typechecking and focused offline artifact/config/terminal-selector tests. Preserve scenario count and unique assertions via diff review. Report in `harness-evaluations.md`.
