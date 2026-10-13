# Research allowance and hidden tool details

October 13, 2026. Investigated the user's completed GSQ-RCO conversation after
the compatible-provider corrections. Read-only inspection of its persisted
events established an `evidence_budget` failure during `selected_evidence_read`:
the worker read three passages and selected one, but could not deliver it within
the remaining shared evidence allowance. The main assistant had already made
four read calls, and the overall chat completed. The configured allowance is
24,000 serialized evidence bytes across parent reads, worker reads and parent
handoff, independent of the model's loaded token context. Handoff text is a new
delivery into a separate runtime context and is intentionally accounted for.
No provider rejection occurred, and this correction does not raise the limit.
The subsequent [adaptive allowance change](adaptive-evidence-allowance.md) replaces
that fixed limit when loaded model capacity is known and reserves handoff room.

The screenshot exposed a separate UI defect. `AgentEvent` renamed enum variants
but not their fields: Rust emitted `call_id` and `output_summary`, while the
frontend consumed `callId` and `outputSummary`. All calls therefore shared
`tool:undefined`, and each replaced the preceding row. The final research error
replaced the successful reads, with no summary to make the row expandable.

The event type now serializes variant fields in camelCase and accepts old
snake_case field aliases. This covers tool identity/details/timing and the same
mismatch in proposal, context, usage and permission fields. Existing stored
events are converted on normal read/serialization; no database migration or
rewrite of the user's chat is needed.

A shared Rust/TypeScript fixture pins both old storage fields and current wire
fields. The Rust regression failed on `call_id` versus `callId` before correction
and passes afterward. It also inserts literal legacy records into a temporary
database, reopens ChatService and verifies full tool details on serialized
messages. Frontend live reduction and replay retain two distinct calls and the
research failure summary. All 186 frontend chat tests pass.

Affected Rust checks pass: the chat filter has 96 passing tests (2 ignored),
and the agent filter has 112 passing tests (8 ignored; these groups overlap).
All 21 architecture fitness checks pass. `pnpm check` passes with zero Svelte
errors/warnings and a clean e2e TypeScript check. Whitespace checks pass, and the
normal debug native app rebuilt successfully. Native UI operation was not
performed; reopening the saved chat after restart exercises the corrected
legacy serialization path without rerunning inference.
