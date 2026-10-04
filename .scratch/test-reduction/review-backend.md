# Independent backend reduction review

Status: review complete; compile-caught helper cleanup correction verified; no open actionable findings.
Reviewer: audit_ui_semantic (not author of backend03/04).

## Scope and evidence

Reviewed the current backend changes against the actual saved snapshot from `baseline.json`: `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-test-reduction-meo8wffi`. HEAD was not used as the reduction baseline. Complete reviewed diff saved as `review-backend.patch` (20 Rust files). Compared every hunk to `spec.md`, `03-timeline-audit.md`, `04-backend-audit.md` and the approved checkpoint in `plan.md`.

Read repository code-review skill including its full smell baseline, repository issue/domain instructions and relevant architecture ownership guidance. This is a bounded independent review of deletion safety, not another design rewrite or a claim to reread all untouched backend tests.

## Standards conclusion

One bounded helper cleanup error was caught by the coordinator compile after the initial static review: `ObservationReceipt::path` and `previous_path` were still used by the retained reattachment assertions at `tests/observation_lifecycle.rs:694–695`. Restore these two `cfg(test)` getters unchanged; preserve the assertions. No other actionable standards finding. The diff removes the approved 21 library tests and two architecture tests; it adds no test/ignore markers, replacement scenarios, helper frameworks, loops or production behavior. Receipt methods slated for deletion in `domain.rs` and `observation.rs` are individually `#[cfg(test)]` accessors; production fields and production warning/result methods remain. The remaining `ObservationReceipt::kind` test accessor stays used. Other production modules change only inside test modules. The now-empty editing-window policy test module and dead ANN imports were removed.

The resulting code reduces duplicated tests and implementation-name coupling. No new abstraction, configuration or parallel state owner was introduced. Existing broad fixture imports do not justify an unrelated cleanup campaign; no demonstrated newly dead helper remains in the reviewed diff. There is no count gaming through skipped, merged, renamed or parameterized cases.

## Spec conclusion

No actionable spec findings. Whole-test deletions match the approved maps, including deliberate loss of implementation trivia (exact spare ANN capacity, hash length/self-equality, receipt getter echoes). Those are not mislabeled as fully equivalent integration coverage.

Independently inspected survivor bodies, not only names, for the consequential replacements:

- Stored editing-window tests still assert exact receipt boundaries at63/64/65/66, stale receipt retirement, retained baseline and reconstructed final endpoint; no-op A→B→A keeps lifecycle evidence. Live protected receipts, abandoned publication and clear-induced stale/unknown scope outcomes remain. Codec generation runs serialized encode/decode/apply over fixed UTF-8/CRLF/empty edits; exact managed-frontmatter parsing is separate and retained.
- Canonical-read failure survivor actually removes the authoritative file and checks warning/no invented revision; required-warning classification still distinguishes CanonicalRead from semantic diagnostics. External observations still assert persisted source/time/content and duplicate suppression; rename checks preserve paths and lifecycle-only semantics. Damaged-metadata forget/recover executes real commands and checks managed identity, authored body, cleared trash metadata and both lifecycle events.
- Task preparation survivor really changes canonical line3 to working line1 and proves no disk/projection write; clean commit verifies canonical identity/path and immediate task projection. Generic retrieval survivor actually clears history while a current-content read is suspended and asserts withheld delivery. The deleted task-shaped mirror did not invoke a task command.
- Real history command failures assert InvalidRequest, Missing, Stale, Unavailable and Ineligible; real corrupted payload/window/lineage/database paths assert Corrupt. Closed serialization and diagnostic-redaction owners remain. Row-scoped note opening still checks recents/selection plus untouched unrelated state; the separate read-session test retains returned content identity.
- Label survivor rejects case-insensitive duplicate winners and selects a nonempty runner-up. Pause survivor proves an unpaused checkpoint completes before verifying pause/resume. Asset survivors perform concurrent exclusive writes and dangling-symlink reservation, and retain contained-path, traversal and canonical symlink-escape coverage. ANN identity/move/range and adapter recovery tests remain.

Architecture trimming preserves the substantive assertions: function-scoped `.current_content`/read participation for retrieval/search/tasks/Atlas; AllowedScope policy versus vault selection; no caller-owned eligibility/admission; storage/role/identity construction privacy; complete-publication writer bans; bounded History Mode access; worker dispatch and observational readiness; coordinator-only runtime handoff. The restart ordering chain remains intact through chat→semantic quiescence→watcher join→durable writes→projection stop→timeline close→semantic finish, along with exit veto and backend dispatch. Removed `self.settled.wait(state)` spelling has a real concurrent-join behavioral owner in `app/lifecycle.rs::concurrent_restart_preparations_join_one_ready_transition` (inspected), so removing that literal does not silently abandon join behavior.

## Validation boundary

Read-only review; no source edits or Cargo run. Compilation, warning checks and full Rust/architecture execution remain coordinator acceptance responsibilities. The two getter restorations are verified against the baseline; no open review finding blocks rerunning those checks. The reviewed snapshot diff is retained so subsequent edits can be checked separately.

Final checkpoint: timeline owner confirmed source frozen after an EOF blank-line trim; review diff refreshed to include that formatting-only deletion. Initial cleanup removed seven `cfg(test)` accessors. Two need restoration, leaving five removed with `kind`, `path` and `previous_path` retained.

Correction verified: `ObservationReceipt::path` and `previous_path` now exactly match their saved baseline method bodies and `cfg(test)` attributes. Retained reattachment assertions are unchanged. The original author/reference scan and initial independent static pass missed these calls on the `reattached` variable; the coordinator compile caught the error. The failed log remains evidence. Final timeline scope is13 tests plus5 unused accessors removed (425 lines). No test assertion was weakened to repair compilation. Combined Cargo rerun remains coordinator-owned.
