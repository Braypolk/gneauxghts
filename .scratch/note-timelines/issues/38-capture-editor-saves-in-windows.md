# 38: Capture editor saves through Editing Windows

**What to build:** Normal editor saves durably advance a pending window while all existing publication, action attribution, and external observation contracts remain truthful.

**Blocked by:** 37: Persist one pending Editing Window per note.

**Status:** ready-for-agent

**Resolution:** Completed; integrated and validated by issue 42, including production activation, full regressions, storage measurements, native gates, and independent reviews.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Route ordinary Editor authored changes through the new pending-state finalization path, leaving the one-second frontend autosave unchanged.
- [x] Keep initial note creation and baseline initialization as stable initial anchors; unchanged authored content and managed metadata-only changes do not create extra windows/revisions.
- [x] Retain distinct task action, accepted proposal, Version Restore, and external-observation revisions. Settle earlier editor work before those source boundaries; preserve dirty-editor combined-commit attribution.
- [x] Audit every retained-head/current-content-hash caller. No-op checks and current-content freshness must use the latest durably captured state, while final delta encoding uses the finalized anchor.
- [x] Adapt prepared-base reuse without creating a delta dependent on a replaced pending payload; preserve exact managed Note Identity, authored hash, and app-issued publication time verification.
- [x] Durably bind deadline/source boundary selection to the publication intent before Markdown publication. Cover a preparation that starts before the deadline but reaches publication at or after it.
- [x] Test pre-publication failure, committed warning after publication, recovery without in-memory state, exact external observation replay, concurrent current-content reads, and mixed editor/action commits through NoteTimeline/production commands.

## Primary implementation surfaces

- [note_timeline.rs](../../../src-tauri/src/services/note_timeline.rs)
- [history_store.rs](../../../src-tauri/src/services/note_timeline/history_store.rs)
- [post_publication.rs](../../../src-tauri/src/services/note_timeline/post_publication.rs)
- [note_persistence.rs](../../../src-tauri/src/commands/note_persistence.rs)
- [vault_watcher.rs](../../../src-tauri/src/vault_watcher.rs)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.

2026-09-05: Added private `editing_window_capture` routing at the existing canonical preparation seam. All ordinary editor commands use the same route; dirty task saves retain `TaskAction`, proposal and restore retain their distinct sources, and creation/baseline remain stable anchors. Source boundaries and changed external observations seal the prior window before preparing/applying their own state. Matching external self-observations compare the pending canonical hash and do not seal a live window. Rename-through-save also settles prior editor work before its distinct publication. No frontend autosave changes were needed.

Admission is sampled after canonical and baseline-input preparation, with a fresh sample after an expired predecessor is sealed. The durable intent stores the chosen window/anchor and admission wall time before the writer receives canonical bytes. Tests cover preparation beginning at 299,999 ms and reaching admission at 300,000 ms, sealing latency before the next admission, and a predeadline admitted write completing after the deadline. The injected provider is private to the timeline runtime; its default returns no window policy. **Issue 39 must supply continuous-clock ownership, suspension/deadline scheduling, recovery finalization, and lifecycle boundaries; issue 42 removes the gate after all integration/release checks.**

Hash audit: `current_content_hash` prefers the captured pending endpoint. Restore preview/confirmation and provenance freshness consume that hash; observation no-op detection now does too. Storage distinct-revision and external append checks use finalized heads only after their no-pending-window precondition. Eventual window delta encoding reconstructs the immutable anchor. A prepared baseline candidate is reused for a distinct revision only when its hash matches that anchor; pending capture never encodes a delta against an intermediate endpoint. A baseline can be established atomically in the first window's durable preparation transaction. Until issue 40 adds eligible-boundary finalization and interval projection, provenance explicitly refuses pending content instead of returning older anchor prose as current.

Consumed and explicitly abandoned operations release their live receipt. Unresolved capture records remain durable; a runtime recovery flag retries released uncertain publications under the existing recovery mutex before later preparation/read/observation, without rescanning receipts on successful reads or touching live writers. Restart recovery remains based solely on persisted intent/assignment, and retained/referenced receipts continue to protect restore lineage and reserved distinct revision identities.

Validation: 13 production-route tests in `editing_window_capture/tests.rs` pass, covering bounded receipts after 80 changed command saves, no-op/metadata/self-observation preservation, baseline-first-save, exact identity/hash verification, deadline ordering, task/proposal/restore source ordering and pending-hash restore freshness, prepublication/sealing failures, committed warnings, restart recovery, concurrent current-content reads, and exact external ledger replay. The focused capture tests use real SQLite and production command/NoteTimeline paths with an injected clock; they do not claim native performance or full policy activation.

Final regression commands: `cargo test --lib note_timeline -- --test-threads=1` — 167 passed, 4 existing performance tests ignored; `cargo test --test architecture_fitness -- --test-threads=1` — 16 passed. Full application/native release validation remains issue 42.
