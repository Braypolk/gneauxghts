# Scoped file and test declaration inventory

Companion to [agent-app.md](agent-app.md). Captured before production/test edits. Paths below are repository relative. Test declaration locations are textual anchors; table expansion, ignored tests and platform gates affect runtime counts.

Review depth: **D** = detailed selected behavior/tests and production path tracing; **S** = all test names and target interface surveyed, selected test bodies/callers read. D does not mean every line/branch exhaustively inspected. Large Rust files are marked S even when a finding deeply traces one path. Frontend proposalVisibility is included only for chat integration; proposal ownership belongs to its assigned worker. No suite execution by this worker.

## Rust inventory

| File / production target | Lines | Tests | Depth |
| --- | ---: | ---: | --- |
| `src-tauri/src/agent_permissions.rs` | 718 | 5 | D |
| `src-tauri/src/agent_run_coordinator.rs` | 44 | 1 | D |
| `src-tauri/src/agent_runtime.rs` | 1808 | 13 | S |
| `src-tauri/src/agent_tools.rs` | 1371 | 3 | S |
| `src-tauri/src/agent_guardrails.rs` | 262 | 5 | D |
| `src-tauri/src/chat.rs` | 7538 | 56 | S |
| `src-tauri/src/agent_runtime/context_measurement.rs` | 661 | 7 | D |
| `src-tauri/src/agent_runtime/usage_context.rs` | 477 | 7 | D |
| `src-tauri/src/agent_runtime/usage_context_live.rs` | 118 | 1 | D |
| `src-tauri/src/agent_tools/capabilities.rs` | 83 | 1 | D |
| `src-tauri/src/agent_tools/current_history.rs` | 91 | 0 | S |
| `src-tauri/src/agent_tools/evidence.rs` | 559 | 3 | D |
| `src-tauri/src/agent_tools/feedback.rs` | 131 | 1 | D |
| `src-tauri/src/agent_tools/research.rs` | 899 | 10 | D |
| `src-tauri/src/chat/citations.rs` | 336 | 9 | D |
| `src-tauri/src/chat/date_time.rs` | 105 | 3 | D |
| `src-tauri/src/chat/grounding_evaluation.rs` | 122 | 1 | D |
| `src-tauri/src/chat/recovery.rs` | 660 | 7 | D |
| `src-tauri/src/semantic/activity.rs` | 114 | 3 | D |
| `src-tauri/src/semantic/ann.rs` | 1026 | 7 | S |
| `src-tauri/src/semantic/ann_core.rs` | 235 | 2 | S |
| `src-tauri/src/semantic/atlas.rs` | 5531 | 27 | S |
| `src-tauri/src/semantic/atlas_labels.rs` | 1741 | 17 | S |
| `src-tauri/src/semantic/chunking.rs` | 313 | 2 | S |
| `src-tauri/src/semantic/db.rs` | 3001 | 12 | S |
| `src-tauri/src/semantic/debug.rs` | 358 | 3 | D |
| `src-tauri/src/semantic/embed.rs` | 1363 | 3 | D |
| `src-tauri/src/semantic/indexer.rs` | 3125 | 22 | S |
| `src-tauri/src/semantic/mod.rs` | 1677 | 5 | S |
| `src-tauri/src/semantic/note_ann.rs` | 999 | 7 | S |
| `src-tauri/src/semantic/related.rs` | 603 | 4 | S |
| `src-tauri/src/semantic/runtime_install.rs` | 354 | 4 | S |
| `src-tauri/src/semantic/similarity.rs` | 35 | 0 | D |
| `src-tauri/src/services/evidence.rs` | 1440 | 0 | D |
| `src-tauri/src/services/retrieval.rs` | 272 | 2 | D |
| `src-tauri/src/services/evidence/inventory.rs` | 371 | 1 | D |
| `src-tauri/src/services/evidence/live_evaluation.rs` | 427 | 3 | D |
| `src-tauri/src/services/evidence/query.rs` | 237 | 4 | D |
| `src-tauri/src/services/evidence/reads.rs` | 438 | 0 | D |
| `src-tauri/src/services/evidence/tests.rs` | 582 | 9 | D |
| `src-tauri/src/commands/chat_commands.rs` | 1645 | 6 | S |
| `src-tauri/src/commands/atlas_commands.rs` | 260 | 1 | S |


## Rust test declarations

### `src-tauri/src/agent_permissions.rs`

- `correlated_decision_resumes_exactly_once_and_rejects_late_or_wrong_identity` — line 426
- `production_boundary_leaves_existing_safe_tools_ungated` — line 472
- `allow_once_is_consumed_but_run_grant_is_narrow_and_ephemeral` — line 511
- `denial_and_cancellation_resolve_waiters_without_granting` — line 605
- `restart_cancellation_releases_every_permission_waiter` — line 677

### `src-tauri/src/agent_run_coordinator.rs`

- `coordinator_is_the_only_chat_handoff_to_the_runtime` — line 38

### `src-tauri/src/agent_runtime.rs`

- `composed_tools_return_to_the_model_until_it_finishes_the_objective` — line 985
- `context_measurement_covers_system_and_reports_usage_without_content` — line 1100
- `rig_hook_turns_share_the_streamed_completion_index` — line 1161
- `activity_titles_describe_search_create_and_plan_targets` — line 1168
- `activity_outcomes_summarize_known_tool_results` — line 1196
- `local_url_policy_allows_http_and_credential_free_https` — line 1246
- `forced_openai_web_selects_the_hosted_tool_and_flex_tier` — line 1256
- `qwen_local_reasoning_uses_openai_compatible_request_field` — line 1264
- `structured_results_compose_with_tools_and_reject_prose_as_the_final_result` — line 1287
- `context_finish_preserves_the_structured_formatter_without_more_actions` — line 1359
- `usage_guard_finishes_with_existing_citation_and_skips_pending_gathering` — line 1487
- `fake_completion_waits_at_permission_boundary_then_drives_tool_without_reasoning_output` — line 1609
- `denied_permission_skips_fake_tool_body_and_emits_denied_lifecycle` — line 1704

### `src-tauri/src/agent_tools.rs`

- `blocking_tool_work_does_not_run_on_async_worker` — line 1326
- `read_coverage_requires_contiguous_pages_from_the_current_content` — line 1341
- `active_note_context_is_bounded_without_appending_stale_selection` — line 1356

### `src-tauri/src/agent_guardrails.rs`

- `worker_and_parent_share_token_and_context_limits` — line 192
- `repeated_tool_guard_normalizes_json_key_order` — line 207
- `changed_pagination_arguments_do_not_trip_repeat_guard` — line 222
- `aggregate_token_budget_has_a_product_owned_terminal_reason` — line 236
- `exhausted_worker_tokens_block_parent_model_admission` — line 250

### `src-tauri/src/chat.rs`

- `restart_quiescence_cancels_and_joins_admitted_request_and_title_work` — line 5116
- `streaming_events_match_contract_fixture` — line 5254
- `startup_preserves_partial_chat_output_and_interrupts_its_run` — line 5318
- `structured_agent_events_are_durable_and_idempotent` — line 5356
- `retired_agent_event_variants_do_not_prevent_conversation_replay` — line 5435
- `checkpoint_branch_copies_history_and_records_lineage` — line 5467
- `interrupted_chat_startup_recovery_is_idempotent` — line 5539
- `startup_reconciles_every_running_run_from_its_durable_assistant_status` — line 5603
- `retry_agent_run_keeps_interrupted_message_lineage_across_restart` — line 5702
- `retry_run_context_survives_restart` — line 5751
- `flex_processing_setting_persists_per_vault` — line 5814
- `web_access_setting_defaults_to_auto_and_persists_per_vault` — line 5831
- `local_model_capabilities_are_persisted_per_model` — line 5848
- `new_vaults_default_to_full_but_legacy_limited_rows_migrate_to_approved` — line 5879
- `draft_chat_configuration_is_applied_when_the_conversation_is_created` — line 5923
- `reasoning_effort_rejects_values_outside_the_supported_contract` — line 5944
- `local_conversations_use_the_models_saved_reasoning_effort` — line 5950
- `conversation_model_changes_wait_for_the_active_run` — line 5976
- `automatic_titles_remove_request_scaffolding_and_support_attachments` — line 6003
- `model_title_refinement_is_hosted_only` — line 6031
- `startup_backfills_default_titles_without_replacing_named_conversations` — line 6037
- `exclusion_overrides_full_and_approved_access_by_stable_id` — line 6086
- `agent_instructions_use_tools_and_reviewed_writes_without_fences` — line 6105
- `local_agent_instructions_prefer_boundary_edits_and_authoritative_note_ids` — line 6120
- `web_sources_are_normalized_from_plain_and_markdown_urls` — line 6128
- `normalized_history_excludes_latest_user_and_provider_payloads` — line 6141
- `passage_citations_and_explicit_grants_survive_branching` — line 6185
- `repeated_passage_admission_preserves_durable_proofs_after_plain_reads` — line 6248
- `recent_history_preserves_requirements_until_explicit_context_admission` — line 6356
- `revision_answers_do_not_replay_removed_prose_through_history_or_compaction` — line 6405
- `durable_compaction_covers_the_entire_older_transcript_and_is_reused` — line 6497
- `terminal_reasons_are_stable_product_values` — line 6547
- `attachment_validation_builds_typed_image_and_document_content` — line 6565
- `attachments_persist_with_their_user_message` — line 6597
- `attachment_validation_rejects_spoofed_sizes_and_binary_text` — line 6628
- `durable_proposals_supersede_the_same_target_across_runs` — line 6649
- `proposal_commit_intent_converges_to_committed_after_success` — line 6741
- `startup_recovers_canonical_write_after_status_update_was_missed` — line 6782
- `explicit_recovery_converges_after_status_write_failure` — line 6826
- `mismatched_commit_target_recovers_as_conflict_without_reapplying` — line 6892
- `fixed_creation_target_collision_becomes_conflict_without_new_path` — line 6930
- `proposal_commit_recovery_is_idempotent` — line 6972
- `proposal_commit_intent_columns_migrate_existing_database` — line 7006
- `newly_excluded_notes_disappear_from_historical_citations` — line 7078
- `conversations_persist_and_project_as_read_only_parts` — line 7121
- `projection_observation_waits_for_own_publication_before_classifying_conflict` — line 7151
- `adding_a_message_to_an_existing_part_does_not_rewrite_conversation_index` — line 7222
- `projection_owner_lookup_returns_the_conversation_for_a_managed_path` — line 7260
- `excerpt_requires_valid_utf8_boundaries_and_remember_is_explicit` — line 7288
- `excerpt_accepts_text_selected_from_rendered_markdown` — line 7306
- `part_rollover_is_bounded` — line 7331
- `archiving_moves_the_complete_projection_folder_and_restoring_reactivates_it` — line 7345
- `conflict_conversion_prepares_an_ordinary_note_then_restores_projection` — line 7452
- `composer_drafts_round_trip_per_slot_and_clear_when_emptied` — line 7480
- `composer_draft_slots_must_be_named` — line 7509
- `deleting_an_archived_conversation_takes_its_draft_with_it` — line 7520

### `src-tauri/src/agent_runtime/context_measurement.rs`

- `full_request_measurement_includes_tools_and_does_not_mutate_forwarded_request` — line 368
- `loaded_capacity_does_not_substitute_advertised_or_ambiguous_maximum` — line 425
- `capacity_probe_backs_off_unknown_but_refreshes_success_and_model_changes` — line 442
- `media_is_not_presented_as_an_exact_text_token_count` — line 511
- `abandoned_and_superseded_attempts_close_once_without_error_content` — line 521
- `missing_usage_remains_unknown_and_is_consumed_once` — line 556
- `live_context_measurement_synthetic_matrix` — line 587

### `src-tauri/src/agent_runtime/usage_context.rs`

- `parent_and_worker_contexts_do_not_share_usage` — line 331
- `configuration_or_history_replacement_resets_reported_baseline` — line 347
- `missing_usage_or_capacity_falls_back_without_guessing` — line 383
- `new_unicode_content_can_exhaust_final_reserve_without_dropping_evidence` — line 398
- `finalization_is_bounded_and_keeps_stricter_output_limit` — line 413
- `final_instructions_respect_legacy_byte_ceiling` — line 436
- `finishing_instruction_is_in_the_opening_system_message` — line 453

### `src-tauri/src/agent_runtime/usage_context_live.rs`

- `live_usage_guard_finishes_from_synthetic_evidence` — line 32

### `src-tauri/src/agent_tools/capabilities.rs`

- `independent_capabilities_compose_and_nested_restrictions_never_restore_authority` — line 59

### `src-tauri/src/agent_tools/current_history.rs`

No inline test declaration; implementation/target interface inspected.

### `src-tauri/src/agent_tools/evidence.rs`

- `worker_reads_inherit_the_range_and_cannot_widen_it_or_reset_continuations` — line 466
- `research_can_narrow_but_never_widen_inherited_filters` — line 507
- `search_inputs_allow_independent_configuration_and_reject_workflow_shortcuts` — line 538

### `src-tauri/src/agent_tools/feedback.rs`

- `registered_tools_deliver_structured_recovery_without_internal_diagnostics` — line 78

### `src-tauri/src/agent_tools/research.rs`

- `an_empty_selection_does_not_claim_no_matching_evidence_without_that_gap` — line 638
- `worker_progress_records_calls_and_failures_without_private_event_fields` — line 652
- `worker_prompt_preserves_explicit_range_without_internal_query_defaults` — line 686
- `rejected_research_returns_explicit_direct_fallback_without_worker_output` — line 748
- `research_lease_limits_concurrency_and_releases_for_later_work` — line 761
- `repeated_worker_usage_accumulates_without_double_counting` — line 771
- `research_returns_only_selected_read_ids_and_closed_gap_codes` — line 790
- `standalone_json_fence_keeps_the_same_read_source_validation` — line 806
- `selection_failures_have_fixed_codes_without_model_text` — line 832
- `worker_keeps_provider_routing_but_never_parent_transcript_or_web` — line 868

### `src-tauri/src/chat/citations.rs`

- `read_references_require_exact_delivered_text_for_every_answer` — line 214
- `passage_references_construct_links_from_delivered_sources` — line 234
- `passage_references_reject_the_observed_shortened_identity` — line 244
- `passage_references_cannot_resolve_undelivered_or_other_run_sources` — line 256
- `passage_references_preserve_code_escapes_and_ordinary_links` — line 270
- `passage_references_do_not_allow_markdown_definitions_to_redirect_sources` — line 281
- `passage_references_remap_worker_results_without_exporting_worker_aliases` — line 291
- `passage_references_accept_named_markdown_references_without_title_matching` — line 313
- `passage_references_reject_malformed_markers_and_preserve_tables` — line 323

### `src-tauri/src/chat/date_time.rs`

- `legacy_chat_requests_can_omit_editor_conventions` — line 60
- `date_time_context_keeps_calendar_order_hour_cycle_and_zone_explicit` — line 75
- `date_time_context_rejects_invalid_zones_duplicate_parts_and_prompt_text` — line 87

### `src-tauri/src/chat/grounding_evaluation.rs`

- `live_answer_grounding_comparison` — line 17

### `src-tauri/src/chat/recovery.rs`

- `deleted_vault_data_recovers_chat_parts_without_rewriting_and_can_continue` — line 443
- `recovery_never_replaces_existing_database_chat` — line 503
- `incomplete_recovery_is_skipped_and_retried_when_part_returns` — line 519
- `conflicting_message_id_rolls_back_entire_import` — line 535
- `duplicate_and_malformed_transcripts_do_not_import_partial_chats` — line 591
- `recovery_does_not_follow_symlinked_chat_roots_or_parts` — line 621
- `attachment_inventory_remains_visible_without_fabricating_attachment_bytes` — line 637

### `src-tauri/src/semantic/activity.rs`

- `pause_during_long_work_holds_the_next_checkpoint` — line 69
- `checkpoint_returns_immediately_when_not_paused` — line 97
- `failed_pause_mutation_is_reported` — line 103

### `src-tauri/src/semantic/ann.rs`

- `defaults_to_warming_state_before_initialize_runs` — line 762
- `initialize_loads_matching_persisted_ann_snapshot` — line 790
- `initialize_recovers_small_sqlite_delta_without_full_rebuild` — line 816
- `incomplete_unreferenced_generation_cannot_replace_last_good_snapshot` — line 849
- `failed_rebuild_keeps_the_loaded_last_good_snapshot` — line 874
- `snapshot_persists_as_manifest_referenced_generation` — line 903
- `incremental_deletes_request_rebuild_once_tombstones_accumulate` — line 927

### `src-tauri/src/semantic/ann_core.rs`

- `capacity_is_next_power_of_two_above_baseline` — line 207
- `tombstone_threshold_ignores_empty_deleted_set` — line 214

### `src-tauri/src/semantic/atlas.rs`

- `atlas_search_does_not_match_the_shared_vault_root` — line 4529
- `atlas_search_ignores_legacy_frontmatter_derived_tags` — line 4558
- `atomic_publication_keeps_previous_generation_until_pointer_flip` — line 4570
- `warm_generation_is_served_stale_while_new_epoch_builds` — line 4612
- `label_pointer_requires_current_algorithm_and_model` — line 4639
- `label_artifact_complete_defaults_true_for_legacy_payloads` — line 4673
- `variant_targets_coalesce_to_newest_epoch` — line 4713
- `atlas_visibilities_for_mutation_batch_skips_hidden_for_chat_recall_only` — line 4736
- `atlas_structural_build_covers_epoch_skips_redundant_enqueue` — line 4779
- `persisted_visibility_variants_distinguish_remembered_chat_set` — line 4792
- `gc_preserves_every_referenced_variant_and_removes_orphans` — line 4830
- `complete_knn_rows_for_umap_keeps_full_rows_without_exact_fill` — line 4869
- `umap_iterations_scale_with_note_count` — line 4945
- `atlas_visibility_filters_hidden_chat_rows_and_adds_navigation_only_chats` — line 4953
- `activity_does_not_change_structural_link_strength` — line 5099
- `connected_components_respects_minimum_link_strength` — line 5119
- `many_topic_clusters_become_many_top_clouds` — line 5147
- `weak_bridges_do_not_collapse_distinct_topics` — line 5189
- `large_parent_forms_subclouds_when_topics_separate` — line 5234
- `mature_subclouds_promote_to_top_level_when_parent_is_large` — line 5272
- `coherent_group_without_separable_children_stays_one_top_cloud` — line 5303
- `umap_cloud_separation_repacks_interleaved_clusters` — line 5334
- `strongly_linked_clouds_are_closer_but_do_not_overlap` — line 5378
- `child_clouds_inside_parent_do_not_overlap` — line 5395
- `far_weak_outlier_does_not_expand_cloud_core` — line 5452
- `layout_graph_keeps_dense_edges_under_degree_cap` — line 5485
- `highest_centrality_cloud_starts_at_origin` — line 5515

### `src-tauri/src/semantic/atlas_labels.rs`

- `sanitizes_urls_markdown_code_images_and_wikilinks` — line 1259
- `chooses_embedding_medoids_nearest_centroid` — line 1272
- `duplicate_labels_choose_runner_up_deterministically` — line 1284
- `label_uniqueness_is_case_insensitive` — line 1306
- `uniqueness_prefers_runner_up_word_over_empty` — line 1325
- `membership_fingerprint_binds_structural_generation_and_members` — line 1345
- `chunk_keybert_ranks_content_phrases_near_cloud_centroid` — line 1354
- `phrase_cache_hit_skips_embedding_provider` — line 1431
- `provider_failure_returns_without_labels` — line 1484
- `empty_chunks_fall_back_to_medoid_title` — line 1511
- `function_words_never_become_standalone_or_function_only_phrases` — line 1530
- `function_words_are_stripped_before_unigrams` — line 1543
- `candidate_budget_scales_with_membership` — line 1563
- `embeds_all_cloud_candidates_without_global_cap` — line 1573
- `shared_phrases_are_embedded_once` — line 1611
- `title_only_chunks_still_produce_keybert_label` — line 1641
- `progressive_callback_fires_once_per_cloud_in_sorted_id_order` — line 1670

### `src-tauri/src/semantic/chunking.rs`

- `chunk_markdown_matches_project_atlas_fixture` — line 286
- `chunk_markdown_produces_stable_content_hash_for_same_markdown` — line 304

### `src-tauri/src/semantic/db.rs`

- `ann_labels_are_stable_for_same_chunk_identity` — line 2603
- `ann_labels_change_when_note_identity_or_ordinal_changes` — line 2610
- `ann_labels_fit_in_sqlite_integer_range` — line 2617
- `moving_a_note_preserves_stable_and_chunk_ann_labels` — line 2623
- `rebuild_edges_bounds_neighbors_per_note_and_reports_stats` — line 2654
- `rebuild_edges_respects_min_score_threshold` — line 2702
- `incremental_edge_repair_preserves_unrelated_and_repairs_reverse_neighbors` — line 2723
- `deletes_and_moves_enqueue_paths_and_former_neighbors` — line 2804
- `startup_marks_abandoned_running_jobs_interrupted` — line 2831
- `streaming_chunk_loader_visits_every_chunk_without_text` — line 2853
- `clear_atlas_cache_removes_positions_and_legacy_settings` — line 2874
- `note_ann_generation_mismatch_forces_full_edge_rebuild` — line 2912

### `src-tauri/src/semantic/debug.rs`

- `record_timing_folds_metrics_and_pushes_event` — line 272
- `rss_profiling_respects_environment_and_disabled_sampling_is_a_noop` — line 302
- `current_rss_bytes_reports_nonzero_on_linux` — line 352

### `src-tauri/src/semantic/embed.rs`

- `blocking_http_client_can_be_released_from_async_context` — line 1267
- `resolve_llama_ctx_size_honors_valid_override_and_floors_typos` — line 1281
- `resolve_llama_thread_and_parallel_defaults` — line 1335

### `src-tauri/src/semantic/indexer.rs`

- `semantic_metadata_tags_use_only_the_authored_frontmatter_field` — line 2025
- `changing_tags_does_not_change_embeddings_or_atlas_geometry_inputs` — line 2034
- `semantic_work_queue_coalesces_wakes_while_preserving_all_work` — line 2053
- `semantic_work_queue_defers_startup_work_until_ann_release` — line 2078
- `semantic_quiescence_joins_admitted_detached_work_and_rejects_late_work` — line 2103
- `paused_wakes_release_coalescing_and_one_resume_drains_pending_work` — line 2162
- `edge_dirty_threshold_forces_full_fallback` — line 2235
- `snapshot_publication_keeps_edge_generation_aligned_for_atlas` — line 2246
- `atlas_failure_backoff_is_bounded` — line 2308
- `semantic_failure_backoff_is_bounded` — line 2315
- `indexing_failures_stop_at_the_retry_bound_and_keep_repair_pending` — line 2323
- `failed_batch_merge_keeps_the_newest_update_for_a_path` — line 2395
- `failed_batch_merge_uses_newest_wins_for_update_and_delete` — line 2414
- `failed_batch_merge_folds_move_chains_and_preserves_later_destination_delete` — line 2444
- `failed_batch_merge_treats_a_newer_move_as_authoritative_for_both_endpoints` — line 2479
- `newer_rebuild_discards_failed_incremental_mutations` — line 2511
- `atlas_building_flags_clear_after_panics` — line 2534
- `full_scan_applies_external_deletes_incrementally` — line 2576
- `full_scan_indexes_nested_notes` — line 2643
- `chat_recall_indexes_only_immutable_excerpt_chunks` — line 2735
- `remembering_one_excerpt_does_not_rebuild_or_walk_a_twenty_thousand_chunk_corpus` — line 2855
- `note_batch_embeds_across_notes_in_large_provider_requests` — line 2943

### `src-tauri/src/semantic/mod.rs`

- `legacy_local_only_setting_is_ignored_when_loading_saved_settings` — line 1582
- `query_failure_degrades_without_consuming_the_worker_retry_budget` — line 1596
- `manual_retry_resets_the_bound_and_queues_the_needed_repair` — line 1614
- `paused_status_overlays_but_does_not_erase_retry_exhaustion` — line 1639
- `health_states_derive_compatible_legacy_recovery_values` — line 1666

### `src-tauri/src/semantic/note_ann.rs`

- `persisted_generation_loads_and_queries_with_exact_scores` — line 770
- `startup_recovers_small_sqlite_delta` — line 794
- `rename_updates_inventory_without_changing_generation_or_identity` — line 813
- `empty_semantic_identity_never_becomes_current` — line 852
- `empty_stable_label_never_becomes_current` — line 863
- `incomplete_unreferenced_generation_does_not_replace_manifest` — line 880
- `failed_rebuild_keeps_the_loaded_last_good_generation` — line 900

### `src-tauri/src/semantic/related.rs`

- `truncate_related_query_keeps_short_text` — line 560
- `truncate_related_query_caps_long_text` — line 565
- `build_note_query_text_includes_title_and_truncates` — line 573
- `indexed_note_matches_disk_compares_full_file_hash` — line 581

### `src-tauri/src/semantic/runtime_install.rs`

- `corrupted_download_never_becomes_an_installed_runtime` — line 250
- `incomplete_archive_never_becomes_discoverable` — line 264
- `pinned_artifacts_cover_desktop_architectures` — line 289
- `official_archive_installs_and_starts_without_system_runtime` — line 302

### `src-tauri/src/semantic/similarity.rs`

No inline test declaration; implementation/target interface inspected.

### `src-tauri/src/services/evidence.rs`

No inline test declaration; implementation/target interface inspected.

### `src-tauri/src/services/retrieval.rs`

- `date_filters_use_created_and_updated_frontmatter_independently` — line 176
- `retrieval_scope_and_clear_invalidation_are_applied_at_delivery` — line 199

### `src-tauri/src/services/evidence/inventory.rs`

- `clock_uncertainty_does_not_imply_boundary_crossing` — line 322

### `src-tauri/src/services/evidence/live_evaluation.rs`

- `live_local_provider_comparison` — line 170
- `live_harder_local_provider_comparison` — line 176
- `live_local_runtime_stream_smoke` — line 381

### `src-tauri/src/services/evidence/query.rs`

- `followups_preserve_explicit_bounds_without_old_workflows_or_result_facts` — line 160
- `arbitrary_dates_and_timestamp_offsets_are_half_open` — line 178
- `local_date_ranges_respect_dst_and_selected_timezone` — line 200
- `invalid_or_ambiguous_ranges_are_rejected_without_guessing` — line 214

### `src-tauri/src/services/evidence/reads.rs`

No inline test declaration; implementation/target interface inspected.

### `src-tauri/src/services/evidence/tests.rs`

- `evidence_fixture_scopes_pages_reads_and_invalidates_current_passages` — line 4
- `budgets_preserve_utf8_and_rank_fusion_rewards_agreement` — line 179
- `shared_worker_budget_does_not_copy_admitted_context_or_search_transcripts` — line 191
- `long_paragraph_slices_reach_tail_without_splitting_unicode` — line 209
- `lexical_normalization_is_resolved_back_to_exact_current_markdown` — line 219
- `period_worker_has_no_inherited_undated_ids` — line 228
- `navigation_maps_unicode_duplicate_ranges_after_hidden_title` — line 377
- `read_budget_never_charges_passages_discarded_by_response_overhead` — line 397
- `research_and_mixed_read_pages_preserve_deliverable_evidence_within_budget` — line 460

### `src-tauri/src/commands/chat_commands.rs`

- `committed_conversion_survives_projection_follow_up_failure` — line 1388
- `related_context_weights_draft_above_generated_content_above_active_note` — line 1419
- `openai_attachment_support_is_conservative_for_unknown_models` — line 1454
- `capability_validation_rejects_images_for_text_only_models` — line 1461
- `openai_availability_keeps_only_curated_chat_models_in_product_order` — line 1482
- `related_search_does_not_block_ipc_dispatch_while_index_is_busy` — line 1558

### `src-tauri/src/commands/atlas_commands.rs`

- `atlas_does_not_deliver_a_match_invalidated_by_a_missing_transition` — line 167

## Frontend test inventory

Every test declaration is listed, including table-driven declaration sites. Named interfaces were traced to production targets; D entries received the deeper failure-path review described in the report. Components without own test files (e.g. ChatComposer) were inspected as production callers, not represented as existing coverage.

### `src/lib/features/chat/ChatPanel.svelte.test.ts`

Target: `ChatPanel.svelte`. 105 lines. Review depth: **D**.

- Line 22: `it('uses the controller vault state without an approved-only emphasis frame', () => {`
- Line 64: `it('withholds configuration controls before initialization completes', () => {`

### `src/lib/features/chat/agentEvents.test.ts`

Target: `agentEvents.ts`. 309 lines. Review depth: **D**.

- Line 31: `it('retains context diagnostics without displaying them as answer content', () => {`
- Line 39: `it('keeps research outcome diagnostics out of answer content', () => {`
- Line 47: `it('upserts tool lifecycle and ignores duplicate sequence numbers', () => {`
- Line 76: `it('keeps model steps internal while projecting tool detail, context, proposals, and guards', () => {`
- Line 113: `it('settles a running tool when its message reaches a terminal state', () => {`
- Line 127: `it('rejects wrong-target, unsupported, duplicate, and stale-run events', () => {`
- Line 155: `it('requires a newer sequence-one event for a legitimate run handoff', () => {`
- Line 168: `it('replays a newer run whose first durable event follows an omitted text sequence', () => {`
- Line 199: `it('replays canonical text without duplicating stored deltas and matches live reduction', () => {`
- Line 222: `it('anchors replay to the durable message target before accepting the first event', () => {`
- Line 240: `it('materializes durable evidence and checkpoint affordance without duplicating them', () => {`
- Line 256: `it('projects a live permission pending to resolved and never replays it after reopen', () => {`
- Line 283: `it('rejects a permission request for another message target', () => {`

### `src/lib/features/chat/api.test.ts`

Target: `api.ts`. 620 lines. Review depth: **D**.

- Line 15: `it('supplies current editor date conventions on new messages and retries', async () => {`
- Line 33: `it('defaults automatic web access for settings from older vaults', async () => {`
- Line 45: `it('persists web access without a legacy mode setting', async () => {`
- Line 82: `it('adapts vault access changes to the Rust IPC contract', async () => {`
- Line 98: `it('resolves a projection owner with one direct IPC lookup', async () => {`
- Line 113: `it('passes the forgotten-note retention window when archiving a conversation', async () => {`
- Line 140: `it('wraps create and send payloads and returns optimistic messages', async () => {`
- Line 176: `it('sends attachment bytes and keeps them on the optimistic user message', async () => {`
- Line 214: `it('normalizes raw completion events for the shared controller', async () => {`
- Line 233: `it('normalizes background title updates for the shared controller', async () => {`
- Line 271: `it('stores and removes provider keys without requesting the key back', async () => {`
- Line 285: `it('checks key status for the requested provider', async () => {`
- Line 295: `it('creates excerpts from rendered Markdown selections', async () => {`
- Line 329: `it('reconstructs durable runtime, source, and checkpoint parts without replaying text deltas', async () => {`
- Line 371: `it('switches the next run to a local model through the conversation command', async () => {`
- Line 393: `it('uses the OpenAI-compatible local model discovery command', async () => {`
- Line 405: `it('persists capability selections for a specific local model', async () => {`
- Line 425: `it('checks account-visible OpenAI models without exposing the API key', async () => {`
- Line 435: `it('passes durable proposal resolution through typed commands', async () => {`
- Line 452: `it('passes the complete permission identity through the decision command', async () => {`
- Line 467: `it('sends the complete active-note snapshot to the backend', async () => {`
- Line 503: `it('requests local context suggestions and sends only explicit selections', async () => {`
- Line 538: `it('updates stable-ID note exclusions through the policy command', async () => {`
- Line 551: `it('loads exclusions and searches ordinary notes for the settings picker', async () => {`
- Line 587: `it('loads unresolved proposals for a reopened conversation', async () => {`
- Line 599: `it('forwards compact activity events without exposing provider payloads', async () => {`

### `src/lib/features/chat/attachments.test.ts`

Target: `attachments.ts`. 116 lines. Review depth: **S**.

- Line 24: `it('encodes supported image and text files for the IPC boundary', async () => {`
- Line 49: `it('rejects pasted images when the selected model only accepts text files', () => {`
- Line 59: `it('rejects unsupported types before reading file data', () => {`
- Line 66: `it('accepts configured audio and video inputs and classifies their previews', async () => {`
- Line 82: `it('prepares safe local previews for text, images, and PDFs', () => {`

### `src/lib/features/chat/chatConfiguration.test.ts`

Target: `chatConfiguration.ts`. 90 lines. Review depth: **D**.

- Line 24: `it('selects only the backend-resolved model for each provider', () => {`
- Line 29: `it('does not invent a model before settings load', () => {`
- Line 34: `it('combines current, default, recent, and discovered models without duplicates', () => {`
- Line 69: `it('filters the curated catalog by account availability without hiding the current model', () => {`
- Line 80: `it('keeps reasoning independent while constraining it to the selected model', () => {`

### `src/lib/features/chat/controller.test.ts`

Target: `controller.svelte.ts`. 1085 lines. Review depth: **D**.

- Line 171: `it('does not create a conversation before backend settings establish the draft model', async () => {`
- Line 185: `it('loads settings, conversations, and the requested conversation', async () => {`
- Line 198: `it('opens a durable checkpoint branch as the active conversation', async () => {`
- Line 211: `it('reconciles streaming deltas, citations, and completion', async () => {`
- Line 328: `it('accepts a correlated resumed run with a sequence gap and rejects the retired run', async () => {`
- Line 364: `it('decides only the active correlated permission and preserves its live resolution at terminal', async () => {`
- Line 413: `it('applies a background conversation title without changing response state', async () => {`
- Line 431: `it('starts repeated new-chat drafts without creating persisted conversations', async () => {`
- Line 463: `it('uses the local draft title when the first message creates the conversation', async () => {`
- Line 480: `it('keeps provider and vault choices on a draft and uses them at creation', async () => {`
- Line 507: `it('renames the current conversation and refreshes its summary', async () => {`
- Line 528: `it('forgets the current conversation and opens the next active conversation', async () => {`
- Line 549: `it('leaves a blank chat pane after forgetting the last conversation', async () => {`
- Line 561: `it('notifies onAssistantCompleted for finished assistant messages', async () => {`
- Line 582: `it('forwards a one-message forced web search', async () => {`
- Line 604: `it('ignores stream events belonging to a different conversation', async () => {`
- Line 618: `it('ignores a stale terminal event from an older request in the current conversation', async () => {`
- Line 656: `it('keeps the newest conversation when open results arrive out of order', async () => {`
- Line 683: `it('disposes all stream listeners', async () => {`
- Line 691: `it('cancels an active run when disposal would orphan a permission waiter', async () => {`
- Line 718: `it('does not invoke chat APIs after disposal', async () => {`
- Line 735: `it('persists and revokes approved note grants through controller state', async () => {`
- Line 750: `it('adds and removes stable-ID exclusions in controller policy state', async () => {`
- Line 772: `it('switches provider and model without replacing conversation history', async () => {`
- Line 795: `it('does not merge a delayed model update into a newly opened conversation', async () => {`
- Line 823: `it('discovers local models through the controller-owned settings boundary', async () => {`
- Line 839: `it('persists reasoning independently from the selected conversation model', async () => {`
- Line 852: `it('uses a local models saved reasoning effort when selecting it', async () => {`
- Line 877: `it('discovers account-visible OpenAI models through the backend boundary', async () => {`
- Line 891: `it('reloads unresolved proposals without opening their notes when a conversation opens', async () => {`
- Line 906: `it('tracks compact activity and clears it when cancelled', async () => {`
- Line 928: `it('queues proposal events for explicit review', async () => {`
- Line 942: `it('replaces a superseded target from an earlier run in the visible proposal queue', async () => {`
- Line 966: `it('commits edited proposal Markdown and removes the resolved item', async () => {`
- Line 983: `it('surfaces a committed proposal history warning without replaying the write', async () => {`
- Line 1010: `it('removes a resolved proposal mirrored from another chat pane', async () => {`
- Line 1022: `it('dismisses a proposal without writing it', async () => {`
- Line 1035: `it('keeps a conflicted proposal queued for review', async () => {`
- Line 1055: `it('forwards the flushed active-note snapshot with the next message', async () => {`

### `src/lib/features/chat/dateTimeContext.test.ts`

Target: `dateTimeContext.ts`. 16 lines. Review depth: **S**.

- Line 5: `it('distinguishes US, British and year-first calendar text', () => {`

### `src/lib/features/chat/machines/contentOperationMachines.test.ts`

Target: `controllerMachine.ts (same directory)`. 126 lines. Review depth: **D**.

- Line 8: `it('rejects stale initialization completion', () => {`
- Line 26: `it('returns selection to idle after a failed open', () => {`
- Line 54: `it('makes disposal terminal across every parallel region', () => {`
- Line 88: `it('correlates terminal events and ignores a late stream event', () => {`

### `src/lib/features/chat/proposalVisibility.test.ts`

Target: `proposalVisibility.ts`. 57 lines. Review depth: **S**.

- Line 37: `it('shows the review only in the conversation that owns the proposal', () => {`
- Line 46: `it('hides a different conversation review after its proposals are replaced', () => {`

### `src/lib/features/chat/ui/ChatMarkdown.svelte.test.ts`

Target: `ChatMarkdown.svelte`. 29 lines. Review depth: **S**.

- Line 6: `it('renders semantic prose and a dedicated code surface', () => {`
- Line 21: `it('marks streaming content as busy', () => {`

### `src/lib/features/chat/ui/ChatMessage.svelte.test.ts`

Target: `ChatMessage.svelte`. 191 lines. Review depth: **D**.

- Line 57: `it('renders assistant text as Markdown', () => {`
- Line 65: `it('keeps user text literal', () => {`
- Line 71: `it('renders observable runtime states with accessible labels and no private reasoning', () => {`
- Line 101: `it('derives durable sources and the branch checkpoint from message evidence and status', () => {`
- Line 118: `it('renders accessible permission controls and a clear run-scoped grant label', () => {`
- Line 140: `it('renders compacted context and a direct proposal review affordance', () => {`
- Line 161: `it('shows concrete actions in runtime order without exposing model turns', () => {`

### `src/lib/features/chat/ui/EvidenceSource.svelte.test.ts`

Target: `EvidenceSource.svelte`. 47 lines. Review depth: **S**.

- Line 17: `it('shows the admitted excerpt literally instead of interpreting source markup or fallback context', () => {`
- Line 27: `it('distinguishes historical removals and uncertain recording time from current status', () => {`
- Line 40: `it('does not label baseline knowledge as an introduction date', () => {`

### `src/lib/features/chat/ui/chatMarkdown.test.ts`

Target: `chatMarkdown.ts`. 218 lines. Review depth: **S**.

- Line 9: `it('keeps escaped quotations literal while rendering their app-built link', () => {`
- Line 24: `it('renders the safe note dialect', () => {`
- Line 51: `it('keeps checked, unchecked, and nested tasks in list structure', () => {`
- Line 63: `it('escapes raw HTML and does not load Markdown images', () => {`
- Line 73: `it('allows HTTP links while leaving unsafe and relative links literal', () => {`
- Line 85: `it('adds stable inline markers to links backed by persisted web citations', () => {`
- Line 107: `it('does not decorate links without matching citation evidence', () => {`
- Line 113: `it('normalizes model-emitted note references without exposing filesystem paths', () => {`
- Line 138: `it('adds the persisted note marker after a proper wikilink', () => {`
- Line 149: `it('splits top-level fences into stable CodeMirror blocks', () => {`
- Line 167: `it('normalizes common fenced-language info strings', () => {`
- Line 175: `it('binds revision links to exact evidence instead of the first citation for a note', () => {`
- Line 188: `it('keeps unvalidated model references inert even when a note shares the reference name', () => {`
- Line 197: `it('never falls back to a same-title note or external navigation for unknown passage references', () => {`
- Line 207: `it('binds app-constructed links to exact passage identities and leaves stale links unavailable', () => {`

### `src/lib/features/chat/ui/chatMessageScroll.test.ts`

Target: `chatMessageScroll.ts`. 135 lines. Review depth: **S**.

- Line 10: `it('places an ordinary conversation directly at the bottom', () => {`
- Line 18: `it('positions an anchored conversation immediately at its target', () => {`
- Line 33: `it('continues following while the viewport is near the latest content', () => {`
- Line 43: `it('disengages following after the user scrolls away from the latest content', () => {`
- Line 53: `it('re-enables following when the viewport returns to the bottom', () => {`
- Line 65: `it('positions streaming content without queuing a smooth animation', () => {`
- Line 93: `it('coalesces streaming updates into the latest scroll write', () => {`
- Line 105: `it('prioritizes the newest anchor over initial correction and streaming', () => {`
- Line 122: `it('cancels an obsolete conversation and permits new scroll work', () => {`

### `src/lib/features/chat/ui/chatPanelHelpers.test.ts`

Target: `chatPanelHelpers.ts`. 82 lines. Review depth: **S**.

- Line 53: `it('uses stable context keys for conversations and unsaved drafts', () => {`
- Line 58: `it('resolves direct message and remembered excerpt anchors', () => {`
- Line 65: `it('reads proposal markdown only when the preview contains a string', () => {`
- Line 73: `it('allows only absolute HTTP and HTTPS citation URLs', () => {`

### `src/lib/features/chat/ui/chatSelectionMarkdown.test.ts`

Target: `chatSelectionMarkdown.ts`. 52 lines. Review depth: **S**.

- Line 8: `it('restores headings and nested inline formatting', () => {`
- Line 15: `it('restores note dialect inline markers', () => {`
- Line 26: `it('uses safe inline-code fences when the selection contains backticks', () => {`
- Line 32: `it('restores tasks, quotes, links, and fenced code', () => {`
- Line 49: `it('normalizes only boundary newlines without stripping Markdown spacing', () => {`

### `src/lib/features/chat/ui/composerDraftPersistence.test.ts`

Target: `composerDraftPersistence.ts`. 222 lines. Review depth: **S**.

- Line 40: `it('restores the unsent text stored for a slot', async () => {`
- Line 48: `it('keeps each conversation its own unsent text across a switch', async () => {`
- Line 67: `it('flushes unsaved text before leaving a slot', async () => {`
- Line 77: `it('coalesces keystrokes into a single write', async () => {`
- Line 90: `it('drops the stored draft once the composer is emptied', async () => {`
- Line 100: `it('lets keystrokes win over a stored draft that arrives late', async () => {`
- Line 115: `it('ignores the empty wipe that races with an in-flight restore', async () => {`
- Line 131: `it('ignores a stored draft for a slot the composer already left', async () => {`
- Line 140: `it('clears both slots when a draft graduates into a conversation', async () => {`
- Line 155: `it('abandons a pending write when the user starts over', async () => {`
- Line 166: `it('saves the last keystrokes when the composer is torn down', async () => {`
- Line 177: `it('restores a draft after dispose even if the vault write is still pending', async () => {`
- Line 215: `it('does nothing before a slot is opened', () => {`

### `src/lib/features/settings/ForgottenNotesPanel.svelte.test.ts`

Target: `ForgottenNotesPanel.svelte`. 39 lines. Review depth: **S**.

- Line 6: `it('labels permanent deletion explicitly and explains the recovery window', () => {`

### `src/lib/features/settings/HistorySettingsPanel.svelte.test.ts`

Target: `HistorySettingsPanel.svelte`. 97 lines. Review depth: **S**.

- Line 39: `it('presents healthy storage, initialization, and reclaimable usage', () => {`
- Line 52: `it.each([`
- Line 75: `it('keeps the prose-free reset diagnostic visible after recovery', () => {`

### `src/lib/features/settings/MissingNotesPanel.svelte.test.ts`

Target: `MissingNotesPanel.svelte`. 71 lines. Review depth: **S**.

- Line 6: `it('exposes the retained timeline and safe recovery lifecycle', () => {`

### `src/lib/features/settings/SemanticSettingsPanel.svelte.test.ts`

Target: `SemanticSettingsPanel.svelte`. 127 lines. Review depth: **S**.

- Line 47: `it('renders Retry now only for degraded status', () => {`
- Line 58: `it('keeps model failures visible even when the index has no error', () => {`
- Line 63: `it('disables the preference and omits unavailable actions on unsupported platforms', () => {`
- Line 79: `it('makes completed setup explicit without prominent maintenance actions', () => {`
- Line 88: `it('distinguishes missing model files from runtime failures', () => {`
- Line 96: `it('offers in-app setup on a fresh install even after a failed startup', () => {`
- Line 104: `it('does not confuse queued work with active indexing', () => {`
- Line 111: `it('offers recovery or resume only when needed', () => {`
- Line 118: `it('handles disabled search, empty vaults, and model warmup explicitly', () => {`

### `src/lib/features/settings/excludedNotes.test.ts`

Target: `excludedNotes.ts`. 49 lines. Review depth: **S**.

- Line 32: `it('shows only exclusions and sorts them by title', () => {`
- Line 39: `it('removes already excluded notes from add-search results', () => {`

### `src/lib/features/settings/localModels.test.ts`

Target: `localModels.ts`. 37 lines. Review depth: **S**.

- Line 5: `it('keeps the configured model available while discovery is offline', () => {`
- Line 11: `it('deduplicates the configured model against discovered models', () => {`
- Line 26: `it('ignores blank model identifiers', () => {`

### `src/lib/features/settings/refreshCoordinator.test.ts`

Target: `refreshCoordinator.ts`. 40 lines. Review depth: **S**.

- Line 18: `it.each([`
- Line 32: `it("refreshes semantic status and forgotten notes after vault changes", async () => {`

### `src/lib/features/settings/semanticStatus.test.ts`

Target: `semanticStatus.ts; SemanticSettingsPanel.svelte`. 47 lines. Review depth: **S**.

- Line 20: `it('uses one label for each backend health state', () => {`
- Line 41: `it('offers Retry now only for degraded or exhausted status', () => {`

### `src/lib/features/settings/settingsCatalog.test.ts`

Target: `settingsCatalog.ts`. 33 lines. Review depth: **S**.

- Line 5: `it.each([` → `])('finds %s across category boundaries', (query, id) => {`
- Line 20: `it('puts precise setting names before broad descriptions', () => {`
- Line 25: `it('requires all words but ignores punctuation, accents, and whitespace', () => {`
- Line 30: `it.each(['', '  ', '!!!', 'unfindablesetting'])('returns no results for %j', (query) => {`

### `src/lib/features/settings/store.test.ts`

Target: `store.svelte.ts`. 605 lines. Review depth: **D**.

- Line 127: `it('keeps component-passed actions bound to the settings store', async () => {`
- Line 146: `it('finishes local search setup by starting the model and retrying indexing', async () => {`
- Line 170: `it('keeps failed setup retryable without starting a missing model', async () => {`
- Line 181: `it('surfaces committed recovery warnings in settings', async () => {`
- Line 205: `it('routes Missing Note recovery and purge through identity-scoped commands', async () => {`
- Line 227: `it('loads older Missing Note history without replacing its recovery metadata', async () => {`
- Line 295: `it('ignores an older Missing Note page when a later refresh replaces the timeline', async () => {`
- Line 356: `it('ignores an older Missing Note page error after a later refresh succeeds', async () => {`
- Line 386: `it('routes Retry now through the focused semantic command adapter', async () => {`
- Line 396: `it('keeps component-passed semantic setting updates bound to the store', async () => {`
- Line 422: `it('retries and explicitly confirms destructive history recovery', async () => {`
- Line 460: `it('explicitly confirms vault-wide history clear and refreshes storage reporting', async () => {`
- Line 494: `it('reports a committed vault clear honestly when storage reporting cannot refresh', async () => {`
- Line 512: `it('stages the selected path without replacing the backend running vault', async () => {`
- Line 543: `it('keeps a newer staged vault when an older Apply result arrives later', async () => {`
- Line 568: `it('does not let a delayed Settings view replace newer vault and semantic snapshots', async () => {`
- Line 595: `it('surfaces bundled Settings failure without invoking equivalent fallback RPCs', async () => {`

### `src/lib/features/atlas/atlasStore.test.ts`

Target: `atlasStore.svelte.ts`. 413 lines. Review depth: **D**.

- Line 104: `it('maps zoom values to semantic focus tiers', () => {`
- Line 111: `it('shrinks node radii with zoom while keeping the default size when zoomed in', () => {`
- Line 119: `it('does not treat weak recency-only atlas matches as colored search hits', () => {`
- Line 127: `it('uses stable atlas positions without mutating nodes', () => {`
- Line 134: `it('resolves link endpoints from visible nodes', () => {`
- Line 153: `it('caps displayed links per node while preferring wikilinks and strong semantic edges', () => {`
- Line 164: `it('keeps weak semantic links out of high-confidence link displays', () => {`
- Line 196: `it('retains the published response during revalidation', async () => {`
- Line 221: `it('accepts a stale published response and polls until it becomes current', async () => {`
- Line 247: `it('treats missing cloud labels as pending even without a stale flag', () => {`
- Line 275: `it('changes the renderer label key when generated cloud labels arrive', () => {`
- Line 309: `it('continues capped-delay polling beyond the former attempt ceiling', async () => {`
- Line 324: `it('keeps debounce refresh and background poll timers independent', async () => {`
- Line 350: `it('initializes visibility from persisted chat settings before loading the atlas', async () => {`
- Line 363: `it('preserves a local visibility selection while persisted settings are loading', async () => {`
- Line 383: `it('discards an obsolete visibility request and loads the selected variant', async () => {`

### `src/lib/app/appStore.svelte.test.ts`

Target: `appStore.svelte.ts`. 93 lines. Review depth: **D**.

- Line 19: `it('starts listeners and payload together and admits the editable session only after listeners', async () => {`
- Line 27: `it('does not overwrite a newer event with delayed bootstrap, independently by field', async () => {`
- Line 42: `it('disposal invalidates delayed payload and listeners across reentry', async () => {`
- Line 52: `it('cleans admitted listeners after a failed payload and retries the complete bootstrap', async () => {`
- Line 65: `it('partial listener failure rejects admission, cleans valid subscriptions, and retries all listeners', async () => {`
- Line 74: `it('admits only the newest overlapping command result', () => {`
- Line 84: `it('rejects the older operation even when it resolves before the newer operation', () => {`

### `src/lib/app/restartLifecycle.test.ts`

Target: `restartLifecycle.svelte.ts`. 153 lines. Review depth: **D**.

- Line 28: `it('joins duplicate restart requests behind the existing persistence barrier', async () => {`
- Line 51: `it('does not prepare or relaunch when restore/save departure fails', async () => {`
- Line 64: `it('restores mutation admission only when every backend owner remains usable', async () => {`
- Line 82: `it('restores mutation admission after an explicitly reversible backend failure', async () => {`
- Line 99: `it('keeps mutation admission closed when backend dispatch has no receipt', async () => {`
- Line 119: `it('keeps the closed state and retries only relaunch after relaunch rejection', async () => {`
- Line 135: `it('applies ordinary-exit backend status to the same mutation gate', async () => {`

### `src/lib/components/ai-elements/inline-citation/inline-citation.test.ts`

Target: `inline-citation.svelte`. 19 lines. Review depth: **S**.

- Line 5: `it('renders current excerpt and revision evidence as an inspectable citation', () => {`

### `src/lib/components/ai-elements/model-selector/model-selector.svelte.test.ts`

Target: `model-selector.svelte`. 79 lines. Review depth: **S**.

- Line 6: `it('separates the provider picker from its provider-scoped model picker', () => {`
- Line 51: `it('offers discovery only in the local model picker', () => {`

## Additional traced production/caller surfaces

- `src/lib/features/chat/controller.svelte.ts`, `machines/controllerMachine.ts`, `ui/ChatComposer.svelte`, `src/routes/map/+page.svelte`, `src/lib/features/atlas/atlasStore.svelte.ts`, `src/lib/features/settings/store.svelte.ts`, `src/lib/app/appStore.svelte.ts`, and component targets listed above.
- Rust inline-test files also serve as their production targets. External evidence tests trace the sibling query/inventory/reads modules and `services/evidence.rs`; command tests trace `ChatService`, `retrieve_vault_notes`, and current evidence admission.
- `tests/e2e`/native chat/date/settings tests searched for coverage overlap; complete harness inventory is owned by the root.
- Domain/architecture docs and linked ADR/invariant constraints recorded in the main report.

## Baseline environment observation

Root reported the default sandbox Rust run rejected `TcpListener::bind("127.0.0.1:0")` in `agent_runtime/context_measurement.rs:449` with EPERM. A localhost-enabled rerun of the test passed. This is an execution-environment prerequisite, not evidence of a product or assertion failure. The separate missing accept deadline discussed in AA-06 is a static harness robustness issue.
