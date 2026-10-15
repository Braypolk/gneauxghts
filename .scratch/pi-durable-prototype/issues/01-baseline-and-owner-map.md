# Establish the prototype baseline and ownership map

Status: resolved
Type: prototype

Read [the spec](../spec.md) and its architecture/research references. Record `baseline.md` before changing ownership: generic session/task persistence, admission/finalization, compaction, review checkpoints/decision continuation, native publication receipts, evidence and transcript projection. Start from `chat/{admission,runtime,store,note_proposals,projection,recovery,relocation}.rs`, `agent_runtime.rs`, `agent_run_coordinator.rs`, and `src/lib/features/proposals/`.

Identify what can move to Pi, what must remain app policy and what is merely a projection. Record a small verification set from existing desktop/iOS harnesses, provider fixtures and relevant contract checks. Establish disposable app/vault paths and how the prototype is selected. Inspect the pinned Pi facade/provider APIs; choose the smallest native bridge without another agent loop.

Acceptance: reproducible baseline, actual call paths and deletion hypotheses, disposable run setup, chosen bridge and validation commands. Append result/limits below; advance to issue 02 without waiting for approval.

## Comments

## Answer

Baseline and deletion hypotheses recorded in [baseline.md](../baseline.md). Native storage facade selected from pinned 1.3.0 types. `pnpm pi:prototype desktop|ios` selects paired frontend/Rust gates, a distinct app identity, Keychain namespace and forced disposable vault. Initial Rust check passes. Worktree branch: `codex/pi-durable-native-prototype`; copied research preserved at `c9d949f`. Native platform gates are in progress under issue 02.
