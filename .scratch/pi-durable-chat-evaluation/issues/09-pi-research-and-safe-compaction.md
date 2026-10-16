# Move research workers and long-context continuation onto Pi

Status: ready-for-agent
Type: task
Milestone: phase-complete
Blocked by: 08

Follow [the spec](../spec.md) and research/context invariants. Existing
`agent_tools/research.rs` calls AgentRuntime::run; restoring it under Pi would
invalidate replacement proof.

## Work

- Implement research_notes with Pi-owned isolated execution and evidence-only
  capabilities. Reuse native reads/proofs, not the old loop.
- Preserve separate worker prompt/history, parent provider/model routing,
  cancellation/deadlines, one-worker admission and shared evidence allowance.
  Transfer selected issued/read IDs and gap codes; resolve passages natively.
  Worker prose/transcript cannot become parent evidence.
- Restore safe parent/worker working-context and between-turn history compaction
  under existing policy. Retain original request/system contract and necessary
  tool-result groups; summaries confer neither evidence nor permissions.
- Recheck freshness after summary inference, account for usage and make malformed/
  non-reducing summaries explicit. Preserve adaptive capacity policy without
  inventing cumulative research quotas.

## Acceptance

- Extended work forces worker/parent compaction and completes with validated
  citations and fresh-evidence follow-up under both protocols.
- Unknown/unread IDs, wider scope, malformed handoffs and stale sources fail safely.
  Failure/cancellation releases worker admission without leaking history, grants or
  budget to another session.
- Invalid summary, access changes and process termination leave explicit
  recoverable state; no automatic unsafe network replay occurs.
- The build still excludes AgentRuntime/AgentRunCoordinator; no new native agent
  loop exists. Long-run resource/retention observations feed 13.

## Starting points

Research capability/schema policy, `src-tauri/src/agent_tools/research.rs`, legacy
compaction/usage-context policy and Pi notes/provider task APIs. Legacy modules
are behavior references, not reusable lifecycle owners.

## Comments

### 2026-10-15 — integrated implementation and bounded evidence reconciliation

The isolated Pi research worker and safe summaries are integrated, including the owner-scoped query correction. Matrix **D** records worker summaries and 23 passed follow-on UI checks; focused actual-Harness checks are preparation evidence.

The whole **D** run failed strict parent-summary proof: adjacent selected context kept the parent below its threshold. Source-free fixture setup is corrected/prepared and requires a native rerun. **S** scale v4 remains running/pending, with no completed history/compaction accounting result. See the [current validation matrix](../validation-matrix.md); worker summaries cannot substitute for parent proof.
