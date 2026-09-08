# 37: Persist one pending Editing Window per note

**What to build:** The private history store can durably replace pending authored state and atomically finalize one immutable net-change revision, with bounded bookkeeping and a non-destructive schema upgrade.

**Blocked by:** 36: Define the Editing Window capture contract.

**Status:** ready-for-agent

**Resolution:** Completed; integrated and validated by issue 42, including production activation, full regressions, storage measurements, native gates, and independent reviews.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Add one pending window per Note Identity, holding its generation, finalized anchor, first/last publication evidence, fixed deadline, latest compressed authored payload/hash, and bounded receipt state.
- [x] Keep exact prepared intent bytes durable before publication; updating a pending endpoint must not overwrite the previously successful endpoint before publication succeeds.
- [x] Seal against the preceding finalized revision, never an overwritten pending state. Append the net revision and retire its window atomically; suppress empty net changes and preserve independent Lifecycle Events.
- [x] Implement the agreed monotonic publication receipt/watermark contract. New unreferenced terminal editor receipts are bounded; pending/live/referenced intents and restore origin links remain protected.
- [x] Migrate behind the existing opening barrier, preserving every legacy revision identity/hash/name/citation/restore origin and vault instance/generation/portability observation. Reject unsupported schema access by old binaries.
- [x] Extend integrity and health validation to pending payloads, anchor ownership, hashes, timing metadata, receipt references, and impossible multi-window states.
- [x] Use real SQLite/temporary-vault tests for repeated replacement, exactly-once sealing, no-op cancellation, late duplicate/stale tokens, corrupted pending anchors/payloads, rollback, and interrupted schema upgrade.

## Primary implementation surfaces

- [history_store.rs](../../../src-tauri/src/services/note_timeline/history_store.rs)
- [note_timeline.rs](../../../src-tauri/src/services/note_timeline.rs)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.


2026-09-05: Implemented schema 12 in `history_store.rs` and its private `history_store/editing_windows.rs` child. The opening barrier transactionally adds pending endpoints, exact prepared dispositions, versioned interval evidence, scoped monotonic publication receipts, and durable per-note deletion epochs/retirement watermarks. Legacy immutable rows, labels, citations, restore-origin tables, store identity/generation, and clean-close observations are unchanged. Old schema guards reject version 12 before accessing it.

Capture preserves the prior successful compressed endpoint until exact prepared bytes and Note Identity are verified. Atomic sealing reconstructs and verifies the finalized anchor, retains the net delta plus interval metadata, and removes the pending endpoint; injected failure after append rolls everything back. No-op sealing retains the baseline and separate Lifecycle Events. Pending preparations use a private reservation rather than minting a public Revision Identity. Captured canonical hashes prefer the pending endpoint; finalized revision reads retain their original head.

New tokens encode private store/generation/deletion-epoch/monotonic-sequence scope. Retained terminal retries return the original outcome before inspecting newer caller bytes. Receipt release retires all but the newest 64 unreferenced terminal records, protecting live operations, unresolved payloads, pending endpoints, revision/lifecycle references, and restore origins. Successful startup recovery releases old process leases. Legacy receipts remain explicit retained exceptions. Clear/purge remove pending state and receipts in the retained-history transaction and advance the deletion epoch.

Validation: 11 temporary-vault/real-SQLite window tests cover 300 replacements (one eventual revision; 66 receipts including baseline and pending endpoint), twelve windows, exact recovery assignment, immutable capture outcomes, fixed deadline admission, unchanged/failed publications, backward wall evidence, no-op cancellation, stale/unknown/deleted-scope tokens, live receipts below the watermark, bounded abandoned receipts, atomic seal rollback, corrupted payload/hash/anchor/timing after prior attestation, unresolved-disposition/missing-receipt corruption, and interrupted migration preserving retained references/portability metadata. Full Rust library suite: 490 passed, 4 existing release-measurement tests ignored. Backend architecture fitness: 16 passed. An initial codec-only fixture failure was fixed by keeping revision-codec verification independent and running window attestation at actual integrity/health gates.

Integration handoff: issue 38 must select `prepare_window_publication`, consume the captured-canonical/finalized-head distinction, and call `release_publication_receipt` after the live publication no longer needs its exact outcome. Issue 39 must own process-local continuous-clock admission, settle publications before `seal_pending_window`, validate restart canonical continuity/eligibility, and seal at explicit boundaries. Storage rejects distinct/external/lifecycle writes or portable close while a window remains pending. `WindowAdmission.elapsed_millis` is a persisted relative duration for evidence/validation, never a cross-process deadline. Issue 40 must project `revision_window_evidence` into the public interval variant; until then the unused production window writer remains disabled and legacy DTOs stay unchanged. Issue 42 owns actual production-workload bytes/WAL/I/O/latency measurements; no release-performance claim is made here.
