# 36: Define the Editing Window capture contract

**What to build:** The one-second canonical autosave is explicitly separated from permanently retained Note Revisions, with deterministic boundaries and honest evidence semantics.

**Blocked by:** None.

**Status:** ready-for-agent

**Resolution:** Completed; integrated and validated by issue 42, including production activation, full regressions, storage measurements, native gates, and independent reviews.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Adopt the proposed ADR 0007 after checking its detailed defaults against the implementation plan; update the main spec, CONTEXT, architecture map, behavior invariants, and affected ADR wording without altering the deferred issue 22 scope.
- [x] Define an Editing Window as at most five minutes from its first distinct published editor save. The deadline never slides with subsequent saves; exact-boundary, suspension, clock-change, and restart behavior are explicit.
- [x] Specify earlier boundaries for last editor departure, History Mode entry, naming current content, on-demand citation production, important action/source changes, lifecycle transitions, and clean close. App blur, health polling, and ordinary chat initialization are not boundaries.
- [x] Keep pending window identities private and finalized Revision Identities immutable; define no-op A → B → A behavior and separate pending canonical head from finalized revision head.
- [x] Define versioned interval time evidence and the loss of within-window introduction/retyping precision, including activity-query overlap semantics and meaning of revision counts.
- [x] Specify bounded publication receipt retirement and stale-token outcomes before any terminal metadata is deleted. Preserve exact preparation/recovery and referenced receipts.
- [x] Add deterministic policy tests through a fake clock; record the cross-module contract fixtures that must change in later tickets.

## Primary implementation surfaces

- [CONTEXT.md](../../../CONTEXT.md)
- [ARCHITECTURE.md](../../../ARCHITECTURE.md)
- [note_timeline.rs](../../../src-tauri/src/services/note_timeline.rs)
- [behavior-invariants.md](../../../docs/architecture/behavior-invariants.md)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.

2026-09-05: Adopted ADR 0007 and aligned the spec, glossary, architecture map, behavior invariants, and ADRs 0002/0004/0006. The detailed [capture contract](../../../docs/architecture/editing-window-contract.md) defines admission-time boundary persistence, fixed continuous-clock deadlines, inspected-note History Mode scope, bounded temporal evidence requests, canonical versus finalized heads, interval/clock-discontinuity semantics, and 64 unreferenced terminal retry receipts with scoped retirement watermarks. Issue 22 remains deferred and was not edited by this implementation.

2026-09-05: Added a reusable pure `editing_window_policy` module behind `cfg(test)` in `NoteTimeline`: 12 fake-clock/policy tests pass, including 300 saves within a fixed window and twelve successive window decisions, exact-boundary and delayed-publication ordering, suspension/clock jumps/restart, earlier boundaries, no-op endpoints, interval overlap, and receipt outcomes. These prove policy decisions only, not persisted row counts, exactly-once transactions, storage savings, or native timing. The contract lists integration fixtures for issues 37–42; production routing, wire types, and storage are unchanged.

2026-09-05: Validation: Rust policy suite 12/12, Rust serialized timeline contract 1/1, TypeScript timeline contracts 2/2, backend architecture fitness 16/16, and `git diff --check` passed. The new policy file passes targeted `rustfmt --check`; repository-wide `cargo fmt --check` reports existing formatting differences in unrelated/current source, so it was not applied globally.
