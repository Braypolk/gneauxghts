# 42: Validate windowed capture storage and release behavior

**What to build:** The completed change demonstrably reduces permanent editor-history growth while preserving current-save durability, responsive native interactions, and legacy history compatibility.

**Blocked by:** 41: Show one combined diff per finalized Editing Window.

**Status:** ready-for-agent

**Resolution:** Completed. The integrated production policy is active; correctness, storage-growth, and available native gates pass. Independent Standards and Spec reviews have no actionable findings. Hardware and actual-device-I/O limitations are explicit in the release report.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Activate the complete capture/read/lifecycle/citation contract coherently; do not ship an incomplete window writer to old readers or maintain permanent per-save dual writes.
- [x] Add a separately identified production-write windowed fixture with deterministic clock control. Preserve and reuse issue 35 sealed legacy fixtures via disposable clones; never relabel old save counts as window counts.
- [x] Prove that 300 saves within one uninterrupted window yield one new finalized editor revision and bounded pending/terminal rows, and that twelve consecutive windows yield twelve revisions absent explicit extra boundaries.
- [x] Compare matched 1 MiB repetitive/random workloads across old/new policies: revision and intent counts, payload/index sizes, main/WAL/SHM allocation, reclaimable bytes, actual write costs, deadline sealing, cold recovery, and native paging/diff through paint.
- [x] Measure sustained editing during autosave and deadline sealing, including large notes and slower-machine validation when available. Report missing hardware coverage explicitly; do not infer write-I/O savings from reduced retained row counts.
- [x] Keep approximately 250 ms warm native paging/diff and sub-second deep reconstruction/restore gates; report save/seal/cold observations separately and retain all failed runs.
- [x] Run focused failure/property/migration tests plus the complete frontend, Rust, architecture, browser, contract, and native suites sequentially. Obtain independent Standards and Spec reviews and fix confirmed findings.
- [x] Publish a new methods/results/limitations report for the windowed policy, link ADR 0007 and issue status, and preserve prior release evidence unchanged. Mark complete only when storage-growth and correctness claims are supported.

## Primary implementation surfaces

- [release_validation.rs](../../../src-tauri/src/services/note_timeline/release_validation.rs)
- [timeline_fixture.py](../../../scripts/timeline_fixture.py)
- [timeline-native-scale.spec.ts](../../../e2e/specs/scale/timeline-native-scale.spec.ts)
- [note-timeline-phase-1-3.spec.ts](../../../e2e/specs/native/note-timeline-phase-1-3.spec.ts)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.


2026-09-05 release progress: [Methods/results/limitations](../../../docs/architecture/editing-window-release-validation.md) and [machine-readable evidence with retained run logs](../../../docs/architecture/editing-window-release-measurements.json) record the integrated default and remaining acceptance gates. The previous release report, measurements, and sealed legacy master remain unchanged. Actual production commands prove 300→1 and 3,600→12 windows with bounded receipts; all eight matched 1 MiB workloads and both fixture backends are measured. Actual elapsed save/seal costs are reported separately from allocated bytes; cumulative device I/O remains unmeasured.

Final headless checks: 800 frontend tests, 534 Rust unit tests plus 16 architecture tests (six ignored release diagnostics), shared contracts (3 TypeScript +1 Rust), six Python fixture checks under optimization, zero Svelte errors/warnings, and eleven browser journeys pass. The isolated browser 1 MiB render observation is 68.6 ms and excludes Rust/IPC. Native lifecycle (3), explicit historical timeline (4), and the complete new window editing/restore journey (1) pass. The sustained sampler refuses measurement when the native document is hidden; macOS reports `CGSSessionScreenIsLocked=Yes`. No native responsiveness or optimized fixture paint acceptance is inferred. Unlocking the console is required before the remaining three native runs documented in the report. Independent final Standards and Spec reviews have no actionable findings. Only the three visible native acceptance runs remain.


Release completion after unlock: the final production-default native window run passed both journeys, including twelve real 1 MiB autosaves and deadline sealing sampled continuously across 725 frames/15.051 seconds. Both optimized native fixtures passed all 250 ms gates: legacy 64 KiB entry/page/diff p95 105/61/33 ms; legacy 1 MiB 212/84/95 ms; window repetitive 1 MiB 193/109/61 ms; window random 1 MiB 187/106/64 ms. Deep reconstruction/restore remain below one second. No implementation changes were needed after unlocking. All runs were sequential, no repository writes occurred during native execution, and sealed masters passed checks after clone disposal. The earlier blocked progress entry is historical; there are no remaining acceptance gates for the declared measured scope.
