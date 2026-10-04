# Rust serial test timing ranking

Elapsed time between serial libtest completion lines, including each test setup/body/teardown and tiny harness overhead. Not instrumented function timings. Same previously validated binary, compilation excluded. Full run: 100.64s, 724 passed, one local-socket sandbox refusal, 16 ignored. The blocked case passed isolated with local socket access (0.02s).

| Seconds | Test |
| ---: | --- |
| 12.942 | `services::note_timeline::editing_window_capture::tests::query_inventory::query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass` |
| 11.017 | `services::note_timeline::tests::adaptive_checkpoints_are_transparent_across_a_long_revision_chain` |
| 2.833 | `services::note_timeline::editing_window_capture::tests::concurrent_reads_and_next_save_serialize_released_capture_recovery` |
| 2.801 | `commands::search_commands::pending_keyword_tests::bulk_notes_are_keyword_searchable_before_background_indexing_finishes` |
| 2.201 | `services::note_timeline::tests::storage_usage_distinguishes_immediate_logical_deletion_from_bounded_reclamation` |
| 1.815 | `commands::history_commands::tests::missing_note_history_pages_are_bounded_restart_stable_and_recoverable` |
| 1.543 | `services::note_timeline::tests::settled_publications_do_not_retain_full_authored_copies` |
| 1.382 | `services::note_timeline::editing_window_capture::tests::query_inventory::query_inventory_nine_dense_notes_do_not_spend_model_evidence` |
| 1.344 | `services::note_timeline::history_store::verification::tests::long_note_verification_checks_cancellation_between_payloads` |
| 1.185 | `services::note_timeline::editing_window_capture::tests::scheduler_runs_without_saves_and_releases_its_runtime_after_owner_drop` |
| 1.110 | `services::note_timeline::editing_window_capture::tests::note_clear_vault_clear_purge_and_reset_leave_no_deadline_work_to_resurrect` |
| 1.076 | `services::note_timeline::tests::interrupted_large_initialization_resumes_idempotently_after_restart` |
| 0.997 | `commands::history_commands::tests::production_history_reads_preserve_and_latch_corruption_after_attestation` |
| 0.980 | `services::note_timeline::editing_window_capture::tests::weekly_tasks::weekly_task_evidence_tracks_checkbox_ranges_not_file_or_task_wording_edits` |
| 0.738 | `services::note_timeline::tests::identity_follows_moves_disappearance_and_safe_reattachment_in_any_refresh_order` |
| 0.708 | `commands::search_commands::tag_search_tests::tag_search_aliases_filter_before_limits_and_support_body_terms` |
| 0.665 | `services::note_timeline::tests::every_app_owned_mutation_source_is_retained_by_the_same_contract` |
| 0.665 | `services::note_timeline::editing_window_capture::tests::evidence_contracts::evidence_contracts_compact_reads_preserve_proofs_without_expanding_lineage` |
| 0.607 | `services::note_timeline::editing_window_capture::tests::startup_clear_disposes_only_its_scope_without_finalizing_pending_prose` |
| 0.606 | `services::note_timeline::editing_window_capture::tests::evidence_contracts::evidence_contracts_reconstruct_changed_lines_then_check_current_status` |
| 0.595 | `services::note_timeline::editing_window_capture::tests::prose_tasks::prose_activity_preserves_range_dates_and_late_reports_need_content_search` |
| 0.571 | `services::note_timeline::provenance::tests::selected_restore_lineage_survives_failed_finalization_restart_and_clear` |
| 0.569 | `services::note_timeline::tests::history_mode_pages_records_with_a_stable_cursor_and_reconstructs_the_selected_revision` |
| 0.531 | `services::note_timeline::tests::version_restore_is_complete_hash_bound_append_only_and_reversible_after_restart` |
| 0.528 | `services::note_timeline::history_store::editing_windows::tests::twelve_sqlite_windows_and_abandoned_retry_receipts_stay_bounded` |
| 0.523 | `services::note_timeline::tests::forgotten_note_history_requires_recovery_before_inspection_or_version_restore` |
| 0.522 | `services::note_timeline::editing_window_capture::tests::focused_evidence_returns_surviving_period_ranges_after_later_edits_and_clear_invalidates` |
| 0.522 | `services::note_timeline::editing_window_capture::tests::editing_window_history_pages_one_endpoint_and_net_diff_without_resealing_labels` |
| 0.519 | `semantic::atlas_labels::tests::embeds_all_cloud_candidates_without_global_cap` |
| 0.515 | `services::note_timeline::editing_window_capture::tests::weekly_tasks::restoring_a_checked_task_reports_restore_without_redating_its_marker` |
| 0.512 | `services::note_timeline::editing_window_capture::tests::weekly_tasks::task_checkbox_window_straddling_week_start_is_explicitly_uncertain` |
| 0.506 | `services::note_timeline::editing_window_capture::tests::editing_window_explicit_provenance_seals_only_target_and_keeps_net_lineage` |
| 0.486 | `commands::forgotten_note_commands::tests::restored_note_and_history_survive_a_purge_selected_before_recovery` |
| 0.468 | `services::note_timeline::editing_window_capture::tests::query_inventory::query_inventory_groups_surviving_activity_and_validates_freshness` |
| 0.459 | `services::note_timeline::editing_window_capture::tests::rename_and_forget_seal_editor_endpoint_before_the_lifecycle_event` |
| 0.455 | `services::note_timeline::editing_window_capture::tests::query_inventory::activity_discovery_composes_with_provenance_reads_and_older_open_tasks` |
| 0.455 | `services::note_timeline::editing_window_capture::tests::current_passage_provenance_continues_without_caching_partial_pages` |
| 0.448 | `services::note_timeline::editing_window_capture::tests::continuous_deadline_ignores_wall_jumps_and_includes_suspension_without_another_save` |
| 0.442 | `services::note_timeline::editing_window_capture::tests::selected_context::selected_context_recovers_staged_deletion_without_touching_other_vault` |
| 0.437 | `services::note_timeline::editing_window_capture::tests::frontmatter_tags_share_editor_save_capture_and_preserve_other_properties` |
