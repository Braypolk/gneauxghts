# 39: Coordinate window deadlines and lifecycle barriers

**What to build:** Window sealing happens predictably through backend-owned deadlines and existing lifecycle owners, including after interruption and during destructive operations.

**Blocked by:** 38: Capture editor saves through Editing Windows.

**Status:** ready-for-agent

**Resolution:** Completed; integrated and validated by issue 42, including production activation, full regressions, storage measurements, native gates, and independent reviews.

**Plan:** [Editing Window implementation](../editing-window-plan.md). Follow its behavior matrix, evidence contract, and deliberate scope limits.

- [x] Own deadline scheduling inside NoteTimeline runtime with an injected clock. Serialize callbacks with canonical publication and observation replay; stale window/store generations are inert.
- [x] Implement exact five-minute expiry without another edit, continuous-typing boundaries, forward/backward wall-clock movement, suspend/resume, and overdue settlement before later writes.
- [x] Integrate last-editor document departure and History Mode entry with canonical save flushing followed by target-window finalization. Avoid splitting shared-document windows merely because one pane departs.
- [x] On restart, reconcile exact prepared publications and external observations in order, validate and finalize surviving windows once, then permit new windows. Failure remains typed/retryable.
- [x] Finalize recoverable pending authored state before rename/forget/Missing events and before clean-close portability. Do not infer missing-note content from a replacement file at the old path.
- [x] Clear/reset/purge removes pending windows and relevant receipts through existing logical-deletion barriers. Cancel or invalidate deadline work so it cannot recreate deleted history.
- [x] Test deadline/save races, failed sealing, close during active save, repeated recovery, two notes/two panes, vault switch, all deletion paths, and scheduler shutdown without real five-minute sleeps.

## Primary implementation surfaces

- [runtime.rs](../../../src-tauri/src/services/note_timeline/runtime.rs)
- [note_timeline.rs](../../../src-tauri/src/services/note_timeline.rs)
- [documentDepartureController.ts](../../../src/lib/features/notepad/orchestration/documentDepartureController.ts)
- [workspacePersistenceService.ts](../../../src/lib/features/notepad/workspace/workspacePersistenceService.ts)
- [historyModeSession.svelte.ts](../../../src/lib/features/history/historyModeSession.svelte.ts)

## Comments

2026-09-05: Planned from the agreed five-minute window model. Ordinary canonical autosave remains one second; no production code is changed by this ticket definition.


2026-09-05 implementation: `runtime/windows.rs` owns an injectable clock and process-local origins. The native clocks explicitly include suspension: `mach_continuous_time` on macOS/iOS, `CLOCK_BOOTTIME` on Linux, and `GetTickCount64` on Windows. Wall timestamps remain evidence only. Admission uses the original fixed continuous deadline; a wall/continuous offset change marks uncertain evidence, including changes noticed at expiry. A native feature gate enables this coordinator while default production still captures distinct saves until issue42 acceptance.

The worker owns only runtime coordination primitives, never `AppState` or an application handle. It rearms against the nearest deadline with a bounded resume/retry wake, performs no SQLite scans when no runtime origin is due, and enters the existing note-file lock before acquiring an operation lease and observation-replay owner. Idle polls do not advance current-content generations. Due windows are sealed independently, so one failed note does not starve another. Successful close and runtime drop stop the worker; queued work checks shutdown after acquiring the file barrier. Store/window identity validation, deletion transactions, and origin removal prevent callbacks from recreating cleared history.

Startup recovers exact prepared publications and validates/seals surviving durable endpoints once before new admission. It never reads replacement prose from a missing note’s former path to infer its endpoint. Changed observations retain their existing ledger ordering. Missing, rename/move, forget/recovery, and clean close settle the editor endpoint before their dependent event/publication. Clean close waits for an active save and seals its completed endpoint before the portability checkpoint; failure leaves close retryable. Scoped startup deletion still attests integrity and recovers exact publications, finalizes unrelated surviving windows, and lets the deletion transaction dispose of affected pending endpoints without first appending them. A failed startup deletion reopens startup recovery rather than leaving an originless pending window marked recovered.

Frontend boundaries now call the typed `finalize_note_editing_window` command. History entry flushes workspace saves and finalizes only its inspected target, including citation entry targeting a different note from the invoking pane. Departure flushes the shared document and seals only when no other editor pane references its NoteKey; chat panes do not count. Save or seal failure refuses departure/entry. The workspace barrier also awaits active save queues even when a buffer already appears clean.

Dependency correction from the independent issue37 audit: a prepared intent with a reserved private `pending:` revision identity now requires its durable `window_publications` disposition. Both integrity verification and capture reject a deleted disposition instead of falling through to a public point revision. The corruption regression removes the actual disposition row, verifies failed integrity/capture/recovery, and checks that canonical bytes and the unresolved intent survive with no invented revision.

Validation: `cargo test --manifest-path src-tauri/Cargo.toml --lib editing_window --quiet` — 51 passed. This includes continuous typing, exact admission/expiry, forward/backward wall jumps, simulated suspension, late predeadline publication versus timer, failed-seal retry and two-note fairness, no-op read-generation stability, recovery/external ordering, Missing with old-path reuse, rename/forget, target-only sealing, close during active save, failed close, vault switch, note/vault clear, reset/purge, and scoped first-startup clear. The actual worker test advances the injected clock, observes sealing without a save/manual tick, then drops its owner and verifies the worker releases the runtime; it is separate from deterministic callback tests and does not sleep five minutes.

Focused frontend/architecture validation: 49 tests passed across HistoryModeSession, document departure, workspace persistence, and frontend architecture fitness; `pnpm check` reports zero errors/warnings. Backend architecture fitness: 16 passed. `cargo check --manifest-path src-tauri/Cargo.toml --features editing-window-internal --quiet` passes on macOS. Native Windows/Linux execution, interval evidence/provenance consumers, UI retention presentation, full regressions, and performance/release activation remain the assigned work of issues40–42.


2026-09-05 audit follow-up during issue 40: **Concurrent final-editor departure remains open and is assigned to issue 41 before release.** Two editor panes can concurrently pass `hasOtherEditingPane` before either awaits cursor persistence/close animation and mutates workspace membership, so both skip the window boundary. The existing pane-navigation pipeline should serialize leaf requests that supply `departDocument` from guard/departure through workspace mutation, releasing on stale/failure/success before later editor/focus effects. Composite restore-location stays outside the queue so its nested open-note can acquire normally. Preliminary restorable-location capture must save/cursor-only; `persist:false` must not skip actual finalization. Route editor-to-chat restoration through the existing pane-kind leaf transition. Add concurrent departures, failure-release, and nested restore-location regressions. This finding is not resolved by issue 40 and blocks activation.

2026-09-05 backend audit fixes implemented with issue 40: explicit recovery Retry now finalizes surviving windows when startup recovery remains incomplete, while leaving ordinary live windows open after successful startup. Deletion replay defers observations belonging to discarded timelines; the same path/ordered-move scope is removed in the deletion transaction so a failed clear retains both pending window and observations. Targeted regressions cover startup seal failure→Retry→new save and queued target observation→startup clear with a sealing fault armed, including deletion rollback.


2026-09-05 frontend audit finding resolved with issue 41: the shared pane-navigation pipeline serializes departing leaves from before guard through membership/reference mutation, releasing before later effects and every terminal path. Composite restore-location remains outside the queue, preliminary location capture is save-only, and already-saved actual departures still finalize. Chat restoration crosses the pane-kind controller before changing conversation state. Regressions now run two distinct shared-note pane departures while the first cursor persistence is paused and verify exactly one finalization after actual reference removal. A failed first departure retains that editor, lets the second leave without sealing, and seals once only when the retained editor retries. Queue failure/stale/blocked release, nested restore-location→open-note retry after missing load, and editor→chat seal-failure conversation rollback also pass. This resolves the concurrent-departure release prerequisite; native/full release validation remains issue 42.
