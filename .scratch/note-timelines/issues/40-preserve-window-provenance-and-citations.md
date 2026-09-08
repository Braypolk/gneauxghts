# 40: Preserve truthful window provenance and stable citations

**What to build:** Chat and provenance expose immutable retained evidence and accurate window-level time precision without leaking discarded intermediate prose or creating unbounded history as a side effect of reads.

**Blocked by:** 39: Coordinate window deadlines and lifecycle barriers.

**Status:** ready-for-agent

**Resolution:** Completed; integrated and validated by issue 42, including production activation, full regressions, storage measurements, native gates, and independent reviews.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Extend Rust/TypeScript evidence and shared fixtures with window intervals; preserve baseline unknown times and exact standalone action/restore evidence.
- [x] Compute provenance over net finalized transitions. Do not claim exact within-window retyping or introduction times that no longer exist; preserve conservative cross-revision lineage and restore origins.
- [x] Finalize only eligible target windows required by an explicit provenance/citation request under the timeline owner. Pending window identifiers never become public revision evidence.
- [x] For activity queries, select bounded candidate notes, finalize required windows, then revalidate ordering/cursors, interval overlap, canonical bytes, eligibility, and generations. Avoid whole-vault sealing on every request.
- [x] Keep health polls, chat mounting, background context assembly, and ordinary non-temporal chat from creating window boundaries.
- [x] Preserve existing and new citation identities/content across later saves, branches, restart, and migration. Keep exclusions, Missing/forgotten/purged states, current-only excerpts, and temporal-answer replay protections.
- [x] Test citations during a window, subsequent edits, no-op windows, period boundaries, stale reads, query retries, legacy evidence, exact restore references, and removed intermediate text through the real current-content capability.

## Primary implementation surfaces

- [provenance.rs](../../../src-tauri/src/services/note_timeline/provenance.rs)
- [activity.rs](../../../src-tauri/src/services/note_timeline/activity.rs)
- [note_timeline.rs](../../../src-tauri/src/services/note_timeline.rs)
- [timelineContractFixtures.test.ts](../../../src/lib/contracts/timelineContractFixtures.test.ts)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.


2026-09-05 implementation handoff:

- Retained headers load and validate `revision_window_evidence` as tagged `RevisionTimeEvidence::EditingWindow` version 1. Rust/TypeScript contracts preserve legacy `knownSince`, `committed`, and `observed` evidence while adding raw first/last, min/max, and clock-discontinuity fields. History rows expose `timeKind: editingWindow` and `timeEvidence`; issue 41 owns their presentation and grouping. Shared command vocabulary and `timeline-time-evidence.json` pin serialized shapes and half-open overlap, including reversed raw wall times.
- Explicit provenance seals its eligible, canonical-matching target under the note-file mutation owner, then projects only retained net transitions. Unchanged ranges preserve lineage; net no-ops preserve the anchor and citations; restores keep their selected interval origins and exact point return evidence. Concurrent publication waits at the explicit boundary rather than reporting an older anchor as current.
- Activity scans sorted eligible identities from a raw note-position cursor, selects at most the requested limit (maximum 20) of overlapping, canonical-matching candidates, and seals only those notes. The selection/seal phase holds the mutation owner. Delivery rechecks ordering, intervals, generations, selected canonical snapshots, and eligibility; changed selected bytes return `Stale` with no advanced cursor. A finalized no-op may yield an empty page with `nextOffset`; consumers must follow the returned cursor. Scanning metadata can still span many notes when matches are sparse; no whole-vault sealing occurs.
- Citation delivery/branch hydration validates current captured canonical bytes independently of provenance and never seals a live window. Optional deserialized evidence preserves old stored citations; new interval objects must exactly match immutable retained evidence. Existing excerpts/identities survive later pending saves and restart, and removed prose stays withheld. A chat regression carries interval evidence through durable branch copying and verifies temporal-answer omission from later context and compaction.
- Backend issue-39 audit corrections are included: explicit Retry completes failed startup window sealing before marking recovery successful, and clear/purge defer target observations until their atomic deletion instead of sealing pending content merely to discard it. Deletion failure retains both observation and pending evidence for retry. See issue 39's audit follow-up for the **unresolved concurrent-departure frontend fix assigned to issue 41**; that remains a release prerequisite.

Validation (focused, not the full issue-42 release matrix): `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib editing_window` — 62 passed; `... --lib provenance` — 16 passed (overlapping selection); temporal answer/branch/compaction regression — 1 passed; Rust command fixture — 1 passed; TypeScript shared fixture — 3 passed; `pnpm check` — 0 errors and 0 warnings; `cargo check --manifest-path src-tauri/Cargo.toml --features editing-window-internal` passed; `git diff --check` passed. Existing migration/receipt/legacy tests are included in the 62-test window run. Native performance, full regression suites, and production activation remain issue 42.
