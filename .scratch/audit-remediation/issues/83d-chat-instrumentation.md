# Scoped chat animation instrumentation

Status: ready-for-agent
Progress: complete; outcome reviewed and applicable integrated checks passed
Owner: audit_documents
Findings: EH10

## Plan and acceptance

Root handed off chat-pane-animation after adding bounded interruption sampling. Preserve that timeout. Restore temporary chat invoke hook after every case; replace timer-only prototype/observer cleanup with exactly-once bounded completion, disposal on success/error/timeout and stable terminal observations. Use existing independent browser reset. Do not launch browser; typecheck and root serial browser verification. Report in harness-documents.md.

## Coordinator acceptance

Implementation or evidence-backed retention is complete. Required integrated checks passed; see [validation](../validation.md) for exact runs and opt-in limits. Earlier pending notes above are chronological investigation history, superseded by this acceptance.
