# Establish the prototype baseline and ownership map

Status: historical; superseded
Type: prototype

Preserved original experiment ticket, not executable work. See the
[completed prototype](../../archive/pi-durable-native-prototype.md) and the
[accepted ordinary-chat rebuild](../../archive/pi-chat-rebuild.md) for outcomes
and validation limits. The original instructions follow.

Read [the spec](../spec.md) and its architecture/research references. Record `baseline.md` before changing ownership: generic session/task persistence, admission/finalization, compaction, review checkpoints/decision continuation, native publication receipts, evidence and transcript projection. Start from `chat/{admission,runtime,store,note_proposals,projection,recovery,relocation}.rs`, `agent_runtime.rs`, `agent_run_coordinator.rs`, and `src/lib/features/proposals/`.

Identify what can move to Pi, what must remain app policy and what is merely a projection. Record a small verification set from existing desktop/iOS harnesses, provider fixtures and relevant contract checks. Establish disposable app/vault paths and how the prototype is selected. Inspect the pinned Pi facade/provider APIs; choose the smallest native bridge without another agent loop.

Acceptance: reproducible baseline, actual call paths and deletion hypotheses, disposable run setup, chosen bridge and validation commands. Append result/limits below; advance to issue 02 without waiting for approval.

## Comments
