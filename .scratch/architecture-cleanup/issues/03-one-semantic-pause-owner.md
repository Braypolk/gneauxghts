# 03 — Give semantic pause one authority

Status: resolved
Depends on: 14
Scope: active Round 1, execution position 4 of 6.
Round 1 order: 01 → 02 → 14 → 03 → 09 → 10; stop and audit after 10.

Read [the spec](../spec.md) and its execution/measurement rules first. Source lines refer to the 2026-09-07 working tree; use named symbols after preceding tickets move them.

## Problem and evidence

The same manual pause decision is stored in `ActivityState.manually_paused` (`src-tauri/src/semantic/activity.rs:3`), `RuntimeState.indexing_paused` (`semantic/mod.rs:179`), and worker-local `paused` (`semantic/indexer.rs:252`). Pause/resume write the gate, runtime status, and a queue message; the worker writes status again. Status and checkpoints consult different copies (`mod.rs:851`, `:865`, `:1153`; `indexer.rs:427`, `:491`).

## Implementation instructions

1. Make the existing `BackgroundWorkGate` the sole manual-pause authority. Pause/resume mutate it, then wake the existing worker as necessary. No new coordinator or queue protocol.
2. Worker admission, long-work checkpoints, and public status read that authority. Compute a paused presentation without erasing underlying fresh/stale/degraded health.
3. Delete `RuntimeState.indexing_paused`, local `paused`, `WorkerSignal::SetPaused`, and `WorkQueue.set_paused`; remove repeated status writes.
4. Preserve queue coalescing: consuming a Wake must release its wake flag even while paused; resume must arrange a fresh Wake for pending work. Keep retry exhaustion independent of manual pause.
5. Propagate a gate mutation failure before reporting the changed pause state to the UI.

## Acceptance and validation

- One stored manual-pause decision replaces three; worker resources and underlying health remain separate.
- Exercise pause during long work, enqueue while paused, resume once, rapid toggles, and retry exhaustion. Assert work admission/completion and visible status through the existing seam.
- Run existing semantic queue/indexer/status tests. Do not add tests solely counting fields or signal variants.
- Report deleted state and coordination writes plus actual line delta; no requirement to compress independently meaningful health or queue state.

## Comments

- Planning baseline: 2026-09-07. Append implementation evidence and resolution here; preserve the measured before/after and review follow-ups.

- Scope revision: active in narrowed Round 1. Earlier full-plan numeric execution order is superseded by 01 → 02 → 14 → 03 → 09 → 10.

- Ticket 14 pointer audit: this ticket names no implementation that moved out of `services/note_timeline.rs`; its semantic source pointers remain current.

- Resolved 2026-09-07 against the exact supplied post-Ticket-14 baseline
  `/private/tmp/gneaux-round1-ticket03-baseline.tar` (extracted to
  `/private/tmp/gneaux-ticket03-baseline.irH5Ir`). The three changed semantic
  source files matched that archive before implementation; unrelated shared-tree
  differences were preserved and are not attributed here.

- Production change: `semantic/activity.rs` +15/-5 (+10),
  `semantic/indexer.rs` +19/-34 (-15), and `semantic/mod.rs` +8/-28 (-20):
  **+42/-67, net -25 production lines**. Embedded Rust tests:
  `activity.rs` +32/-9 (+23), `indexer.rs` +79/-6 (+73), and `mod.rs`
  +122/-0 (+122): **+233/-15, net +218 test lines**. Tooling: **+0/-0,
  net 0**. Ticket comments are planning evidence and excluded from these counts.

- `BackgroundWorkGate.manually_paused` is now the sole stored manual-pause
  decision. Deleted `RuntimeState.indexing_paused`, the worker-local `paused`
  flag, `WorkerSignal::SetPaused`, `SemanticWorkQueue::set_paused`, the worker's
  mirrored runtime write, and pause/resume runtime health writes. The pause path
  is one fallible gate mutation. Resume performs that mutation and requests the
  existing coalesced `Wake`; no coordinator, queue protocol, DTO, callback, or
  compatibility path was added.

- Worker admission reads the gate before work, and the batch loop rechecks it
  before admitting the next batch. Long ANN and edge checkpoints continue to
  wait on the same gate. A consumed `Wake` now clears `wake_pending` before the
  pause check, so work queued during pause remains pending and the final resume
  can enqueue a fresh wake. Rapid resume/pause/resume retains exactly that
  behavior, and duplicate resume wakes still coalesce.

- Public status reads the gate and derives `indexingPaused`, paused health, and
  legacy `recoveryState` at snapshot time. The stored runtime health is no
  longer overwritten by pause/resume: fresh/stale/working/degraded health,
  retry attempt/exhaustion, current execution/progress/error, ANN freshness,
  pending work, and the wake-coalescing flag remain independent surviving
  state. `SemanticHealth::Paused` survives only as the derived public
  presentation. A poisoned gate rejects mutation and status reads; worker
  admission fails closed.

- Behavior coverage added/adjusted: pause during an already-running long-work
  checkpoint; enqueue while paused; release a consumed paused wake; one final
  resume drains all pending derived stages; rapid toggles preserve the next
  wake; duplicate wake coalescing; gate mutation failure; and public paused
  status preserving retry exhaustion/degraded health after resume. The existing
  bounded-retry outcome test continues to prove repair stays pending after
  exhaustion.

- Validation: `cargo test --manifest-path src-tauri/Cargo.toml semantic:: --lib`
  (113 passed); `cargo check --manifest-path src-tauri/Cargo.toml` (passed);
  `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness`
  (17 passed); `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  (580 passed, 9 ignored). No frontend/IPC contract changed.

- Audit: physical manual-pause storage locations fell from three to one while
  the semantic dimensions remain correctly separate. Pause coordination fell
  from gate + runtime + worker-message writes to one gate mutation; resume keeps
  only the necessary gate mutation + ordinary wake. The worker no longer has a
  pause-control branch or status write. Review specifically checked paused-wake
  release ordering, resume-after-rapid-toggle, underlying degraded/retry state,
  and failure propagation. No unresolved Ticket 03 concern remains.

- Orchestrator baseline-relative Standards/Spec audit: **no findings**. The
  audit independently confirmed that the gate field is the only stored pause
  decision; `RuntimeState` and worker mirrors plus `SetPaused`/`set_paused` are
  absent; wake handling clears coalescing before pause admission; resume requests
  a new wake; processing rechecks the gate between batches; gate-lock failures
  propagate through pause, resume, and status; and paused status overlays without
  erasing retry-exhausted health.
