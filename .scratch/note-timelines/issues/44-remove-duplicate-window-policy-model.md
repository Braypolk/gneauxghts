# Remove the duplicate Editing Window policy model

Status: ready-for-agent

## Acceptance

Remove the unused private Clock/WindowTiming, boundary-enum, and receipt-retirement model and its self-tests. Keep production-used constants, finalization, receipt state, and token outcome helpers. Remove the blanket dead-code allowance. Preserve meaningful scenarios through production paths; avoid duplicating existing tests.

## Checks

Run the focused capture/storage/policy tests and backend architecture checks. Compile the normal production configuration so dead code cannot hide behind tests. Record the production coverage mapping and any missing scenario added.

## Production coverage map

The removed executable model only tested itself. Runtime timing stays in `runtime/windows.rs`, admission/boundaries in `NoteTimeline`, retained evidence in `RevisionTimeEvidence`/`activity.rs`, and transactional retirement in `history_store/editing_windows.rs`. The shared finalization/token-outcome functions and their existing tests remain because production storage calls them.

Existing tests in `src-tauri/src/services/note_timeline/editing_window_capture/tests.rs` cover:

| Removed model scenario | Production test(s) |
| --- | --- |
| Fixed deadline; exact 299999/300000 boundary; new-window origin | `continuous_typing_has_fixed_deadlines_and_new_admission_starts_at_boundary`, `publication_admission_after_preparation_crosses_deadline_before_markdown_write` |
| Pre-deadline admission with late I/O | `predeadline_admission_keeps_its_window_and_time_when_markdown_completion_is_late`, `deadline_waits_for_predeadline_publication_and_seals_its_late_success` |
| Suspension and forward/backward wall jumps | `continuous_deadline_ignores_wall_jumps_and_includes_suspension_without_another_save` |
| New runtime cannot reuse a deadline | `restart_finalizes_successful_endpoint_once_before_newer_external_observation` |
| Explicit target-only boundaries and close | `target_boundary_seals_only_inspected_note_and_failed_close_never_claims_portability`, `clean_close_waits_for_active_save_then_finalizes_and_old_runtime_is_inert_after_vault_switch` |
| Distinct actions and lifecycle | `task_save_of_dirty_editor_content_retains_combined_action_source`, `proposal_and_restore_keep_distinct_sources_and_restore_checks_the_pending_hash`, `rename_and_forget_seal_editor_endpoint_before_the_lifecycle_event` |
| Delete pending state rather than retain it | `note_clear_vault_clear_purge_and_reset_leave_no_deadline_work_to_resurrect` |
| A → B → A net no-op | `editing_window_noop_does_not_invent_retyping_or_replace_citations` |
| Half-open overlap and uncertain time | `editing_window_time_contract_preserves_action_points_and_half_open_overlap`, `editing_window_activity_only_seals_bounded_overlapping_candidates_and_retries_noops`, `editing_window_uncertain_clock_activity_is_conservative_and_explicit` |
| Naming an existing revision does not finalize | `editing_window_history_pages_one_endpoint_and_net_diff_without_resealing_labels` |
| Ineligible evidence does not finalize | `editing_window_excluded_and_uncaptured_targets_never_seal_on_evidence_reads` |

Storage tests `repeated_sqlite_replacement_retains_one_net_revision_and_bounded_receipts`, `twelve_sqlite_windows_and_abandoned_retry_receipts_stay_bounded`, and `live_and_referenced_receipts_survive_watermark_and_clear_invalidates_old_scope` cover the model's 300-save/twelve-window and retirement scenarios using actual SQLite transactions. Frontend `documentDepartureController.test.ts` covers the last editing pane boundary. Existing production release fixtures preserve larger 300/3600-save workloads; these are not rerun for this deletion-only production change.

Added production regression: `regressed_continuous_clock_blocks_publication_without_replacing_successful_endpoint` drives the real persistence command with a clock before its window origin. It checks rejection before Markdown changes, unchanged successful endpoint/evidence, and subsequent successful retry.

## Resolution

Implemented 2026-09-06. Removed the duplicate private model and blanket dead-code suppression while preserving all production-used helpers. Added the command-level regressed-clock regression and retained existing production scenario coverage above. No policy, persistence, or UI behavior changed.

Validation passed:

- `cargo test --manifest-path src-tauri/Cargo.toml editing_window -- --test-threads=1`: 59 passed, including the new regression.
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`: production build passed with no warnings.
- `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness`: 16 passed.
- `git diff --check` and focused `rustfmt --check --edition 2021 src-tauri/src/services/note_timeline/editing_window_policy.rs`: passed.

The full suites and native gates were intentionally not repeated for this scoped removal. The orchestrator audits before issue 45 begins.

## Comments

- 2026-09-06: Ordered history-hardening follow-up; run one fresh implementation agent per issue, with orchestrator audit before the next issue.
