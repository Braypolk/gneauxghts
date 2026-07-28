# Graph Report - .  (2026-07-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 4728 nodes · 14557 edges · 159 communities (144 shown, 15 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 603 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4e80efc2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- db.rs
- index.rs
- persistence.rs
- SemanticState
- search_commands.rs
- task_mutation.rs
- proposals.rs
- LexicalIndex
- ensure_schema
- atlas_labels.rs
- AgentToolContext
- config.rs
- NoteAnnIndexState
- embed.rs
- corenn-kernels/src/lib.rs
- vault_watcher.rs
- chat.rs
- AppState
- String
- ChatService
- task_projection.rs
- agent_runtime.rs
- note.rs
- chat/types.ts
- .connection
- indexer.rs
- prepare_notes_dir
- csp
- build.rs
- .run_agent_response
- String
- .build_and_publish
- CloudSpec
- proposals/index.ts
- Notepad.svelte
- documentState.ts
- SemanticDebugState
- atlas.rs
- structuralIndentation.ts
- appStore.svelte.ts
- AtlasStore
- slashMenu.ts
- editor.ts
- editor/inlineFormatting.ts
- wikilinks.test.ts
- map/+page.svelte
- NoteKey
- editorExtensions.ts
- semantic.ts
- state.ts
- search/store.svelte.ts
- HashMap
- paneCommandPicker.ts
- callWithDraft
- chatPaneBindings.ts
- semanticStatus.ts
- noteStore.ts
- inlineFormatSpec.ts
- obsidianMarkdownExtensions.ts
- noteNavigation.ts
- chat/api.ts
- markdownExtensions.ts
- NoteDraftState
- notepadChatPaneAdapter.ts
- taskListStore.svelte.ts
- chatPanelHelpers.ts
- blockTypes.ts
- SettingsStore
- selectionSurround.ts
- NotepadPaneId
- links.ts
- TauriChatApi
- keyboardShortcuts.svelte.ts
- selectionMenu.ts
- ChatControllerStore
- notepadSessionLifecycle.ts
- PaneCommandPicker.svelte
- read_state
- notepadChatCoordinator.svelte.ts
- TaskCheckboxWidget
- paneTransientUiController.svelte.ts
- listSelection.ts
- passiveTableExtension.ts
- searchMatch.ts
- architectureFitness.test.ts
- imageEmbedWidgets.ts
- editorTextSize.svelte.ts
- .related_notes
- AtlasCloud
- ipcFixtures.test.ts
- AtlasNode
- attachments.ts
- openFlow.ts
- lock_test_env
- controller.svelte.ts
- settings/store.svelte.ts
- layout.ts
- paneCommandGroup.ts
- currentNoteSearch.ts
- Window
- NotepadCommandBarController
- settings/store.test.ts
- node-shims.d.ts
- api.test.ts
- search.test.ts
- state.test.ts
- paneCapabilityWiring.test.ts
- current_time_millis
- EventBus
- atlasStore.svelte.ts
- ChatController
- ann_core.rs
- .get_conversation
- NotepadChatCoordinator
- NotepadCommandBar.svelte
- TaskListStore
- editorCapabilities.ts
- theme.svelte.ts
- asset_commands.rs
- load_note_session_from_notes_dir_with_state
- locationMru.ts
- chunking.rs
- settings/+page.svelte
- apply_umap_layout
- open_database
- appSettings.svelte.ts
- cursorState.ts
- NavBar.svelte
- RelatedNotesStore
- BackgroundWorkGate
- permissions
- KeyboardShortcutsPanel.svelte
- read_indexed_note_from_path
- secrets.rs
- titleInteractionController.ts
- shortcuts.ts
- ScoredNeighbor
- ChatExcerpt
- persist_note_session_with_outcome
- VaultAtlasResponse
- get_vault_atlas
- collect_markdown_files_recursively
- retrieve_vault_notes
- architecture_fitness.rs
- .search_vault_atlas
- formatShortcutBinding
- navigationCoordinator.ts
- createMarkdownExtensions
- ann_label_for

## God Nodes (most connected - your core abstractions)
1. `AppState` - 110 edges
2. `ChatService` - 107 edges
3. `NoteDraftState` - 70 edges
4. `IndexedNote` - 48 edges
5. `NoteKey` - 47 edges
6. `WorkingNode` - 47 edges
7. `NoteAnnIndexState` - 45 edges
8. `ChatApi` - 42 edges
9. `SemanticState` - 42 edges
10. `ensure_schema()` - 41 edges

## Surprising Connections (you probably didn't know these)
- `renderChatMarkdown()` --references--> `markdown-it`  [EXTRACTED]
  lib/features/chat/ui/chatPanelHelpers.ts → types/markdown-it.d.ts
- `typed_non_streaming_events_match_contract_fixture()` --calls--> `load_json_fixture()`  [INFERRED]
  src/app/events.rs → src/test_support.rs
- `derive_file_stem()` --calls--> `derive_file_stem_sanitizes_invalid_characters_and_truncates()`  [INFERRED]
  src/note.rs → src/state.rs
- `derive_file_stem_from_title_and_markdown()` --calls--> `derive_file_stem_prefers_explicit_title()`  [INFERRED]
  src/note.rs → src/state.rs
- `content_hash()` --calls--> `indexed_note_matches_disk_compares_full_file_hash()`  [INFERRED]
  src/semantic/db.rs → src/semantic/related.rs

## Import Cycles
- 2-file cycle: `src/services/background_index_queue.rs -> src/services/note_catalog.rs -> src/services/background_index_queue.rs`
- 2-file cycle: `src/commands.rs -> src/commands/note_session.rs -> src/commands.rs`

## Communities (159 total, 15 thin omitted)

### Community 0 - "db.rs"
Cohesion: 0.10
Nodes (88): DocumentKind, allocate_stable_ann_label(), AtlasLabelChunk, ChunkEmbeddingRow, clear_atlas_cache(), count_indexed_items(), delete_note(), deserialize_embedding() (+80 more)

### Community 1 - "index.rs"
Cohesion: 0.06
Nodes (88): NoteLinkSuggestion, resolve_note_link_target_prefers_paragraph_numbers_and_falls_back_to_title(), resolve_note_link_target_supports_stable_block_ids(), autocomplete_note_links(), build_note_suggestions(), build_section_suggestions(), display_text_for_section(), normalize_note_reference() (+80 more)

### Community 2 - "persistence.rs"
Cohesion: 0.11
Nodes (71): OnceCell, atomic_write_note(), collect_note_id_to_path_map(), database_has_persisted_state(), db_clear_last_opened_note(), db_force_note_activity_for_tests(), db_load_note_activity(), db_mark_note_opened() (+63 more)

### Community 3 - "SemanticState"
Cohesion: 0.07
Nodes (35): ActiveSemanticState, Sender, WorkerSignal, ActiveSemanticState, disabled_settings(), DisabledSemanticState, enqueue_initial_scan_after_warmup(), manual_retry_resets_the_bound_and_queues_the_needed_repair() (+27 more)

### Community 4 - "search_commands.rs"
Cohesion: 0.05
Nodes (104): Index, merge_hybrid_candidates_applies_labels_scores_and_limit(), merge_hybrid_candidates_boosts_frequently_opened_notes(), merge_hybrid_candidates_idle_decay_removes_access_boost(), access_score_for_note(), build_current_override_cached(), build_draft_ref(), build_related_fingerprint() (+96 more)

### Community 5 - "task_mutation.rs"
Cohesion: 0.06
Nodes (62): Cell, From, PostCommitCatalogOutcome, apply_committed_mutation(), AppStatePostCommitSink, canonical_read_failure_is_required_even_with_a_fallback_catalog_snapshot(), collect_catalog_issues(), CommittedMutationWarning (+54 more)

### Community 6 - "proposals.rs"
Cohesion: 0.10
Nodes (69): commit_agent_proposal(), commit_note_review(), converge_agent_proposal_status(), dismiss_agent_proposal(), preview_note_change_proposal(), preview_note_creation_proposal(), Option, Result (+61 more)

### Community 7 - "LexicalIndex"
Cohesion: 0.06
Nodes (59): Field, IndexReader, IndexWriter, JoinHandle, commit_locked(), delete_note_locked(), lexical_index_removes_deleted_notes(), lexical_index_returns_title_and_body_matches() (+51 more)

### Community 8 - "ensure_schema"
Cohesion: 0.11
Nodes (41): AnnIndexState, AnnManifest, AnnSnapshot, AnnStatusSnapshot, AnnStatusState, build_snapshot_streaming(), should_rebuild_for_tombstones(), defaults_to_warming_state_before_initialize_runs() (+33 more)

### Community 9 - "atlas_labels.rs"
Cohesion: 0.08
Nodes (68): add_source_candidates(), atlas_node(), AtlasLabelNote, candidate_budget_for_cloud(), candidate_rank_score(), CandidateEvidence, candidates_from_selected_chunks(), chooses_embedding_medoids_nearest_centroid() (+60 more)

### Community 10 - "AgentToolContext"
Cohesion: 0.07
Nodes (44): active_note_context_is_bounded_but_keeps_selection(), ActiveNoteSnapshot, ActivityEvent, AgentToolContext, AgentToolError, CreateArgs, EditArgs, EmptyArgs (+36 more)

### Community 11 - "config.rs"
Cohesion: 0.15
Nodes (49): app_data_dir(), can_pick_arbitrary_vault_path(), configured_app_data_dir(), configured_documents_dir(), create_vault_folder(), create_vault_folder_in(), CreateVaultFolderResult, current_vault_info() (+41 more)

### Community 12 - "NoteAnnIndexState"
Cohesion: 0.11
Nodes (43): NoteAnnSourceInventory, build_snapshot_streaming(), clone_graph_and_vectors(), database(), empty_semantic_identity_never_becomes_current(), empty_stable_label_never_becomes_current(), failed_rebuild_keeps_the_loaded_last_good_generation(), incomplete_unreferenced_generation_does_not_replace_manifest() (+35 more)

### Community 13 - "embed.rs"
Cohesion: 0.08
Nodes (44): BufWriter, Child, Client, ExitStatus, File, bundled_backend_plugin_path(), _debug_path(), find_model_file() (+36 more)

### Community 14 - "corenn-kernels/src/lib.rs"
Cohesion: 0.06
Nodes (59): Copy, bf16, cosine_distance(), cosine_distance_qi8(), dequant(), dot_and_norms_bf16(), dot_and_norms_bf16_avx512bf16(), dot_and_norms_bf16_scalar() (+51 more)

### Community 15 - "vault_watcher.rs"
Cohesion: 0.07
Nodes (54): Event, EventKind, RecommendedWatcher, bundled_llama_server_path(), AppHandle, Option, PathBuf, run() (+46 more)

### Community 16 - "chat.rs"
Cohesion: 0.10
Nodes (24): DocumentMediaType, agent_instructions_use_tools_and_reviewed_writes_without_fences(), agent_preamble(), attachment_validation_builds_typed_image_and_document_content(), ChatAttachment, ChatAttachmentInput, ChatTitleUpdatedEvent, civil_date_from_days() (+16 more)

### Community 17 - "AppState"
Cohesion: 0.13
Nodes (50): bootstrap_app(), BootstrapAppPayload, clear_semantic_debug_metrics(), create_vault_folder(), delete_task(), download_semantic_embedding_model(), emit_semantic_status_changed(), emit_task_note_changed() (+42 more)

### Community 18 - "String"
Cohesion: 0.10
Nodes (30): automatic_conversation_title(), ChatAgentProposal, ChatGrant, ChatMessage, ChatNotePolicy, ChatRequestAccepted, ChatSource, ChatStreamEvent (+22 more)

### Community 19 - "ChatService"
Cohesion: 0.16
Nodes (51): ChatService, accepted_mime_types(), capability_validation_rejects_images_for_text_only_models(), chat_archive_conversation(), chat_cancel_request(), chat_create_conversation(), chat_create_excerpt(), chat_find_conversation_by_projection_path() (+43 more)

### Community 20 - "task_projection.rs"
Cohesion: 0.14
Nodes (46): Params, ensure_state_schema_idempotent(), F, R, with_state_database_internal(), collapse_whitespace(), delete_tasks_for_note_path(), ensure_task_projection_schema() (+38 more)

### Community 21 - "agent_runtime.rs"
Cohesion: 0.09
Nodes (38): AgentRun, M, AgentProvider, AgentRuntime, AgentRuntimeObserver, AgentRuntimeRequest, AgentRuntimeResponse, EchoArgs (+30 more)

### Community 22 - "note.rs"
Cohesion: 0.11
Nodes (42): civil_from_days(), compose_frontmatter(), current_timestamp_rfc3339(), derive_file_stem(), derive_file_stem_from_title_and_markdown(), document_kind(), encode_base32(), extract_file_name_title_and_body() (+34 more)

### Community 23 - "chat/types.ts"
Cohesion: 0.11
Nodes (20): ChatActivityEvent, ChatAttachmentKind, ChatCancelledEvent, ChatCompletedEvent, ChatFailedEvent, ChatNoteCandidate, ChatProjectionConflictEvent, ChatRole (+12 more)

### Community 24 - ".connection"
Cohesion: 0.13
Nodes (28): attachments_persist_with_their_user_message(), conflict_conversion_preserves_edit_as_an_ordinary_note_then_restores_projection(), conversations_persist_and_project_as_read_only_parts(), exclusion_overrides_full_and_approved_access_by_stable_id(), explicit_recovery_converges_after_status_write_failure(), fixed_creation_target_collision_becomes_conflict_without_new_path(), generate_stable_projection_id(), interrupted_chat_startup_recovery_is_idempotent() (+20 more)

### Community 25 - "indexer.rs"
Cohesion: 0.08
Nodes (76): FnOnce, Receiver, atlas_structural_build_covers_epoch(), EmbeddingInputKind, EmbeddingProvider, atlas_building_flags_clear_after_panics(), atlas_failure_backoff(), chat_recall_content_hash() (+68 more)

### Community 26 - "prepare_notes_dir"
Cohesion: 0.19
Nodes (35): prepare_notes_dir(), PathBuf, set_note_collapsed(), set_note_hidden(), set_task_hidden(), build_task_group_patch(), delete_task_with_view(), get_task_group() (+27 more)

### Community 27 - "csp"
Cohesion: 0.05
Nodes (36): icons/128x128@2x.png, icons/128x128.png, icons/32x32.png, icons/icon.ico, app, security, windows, build (+28 more)

### Community 28 - "build.rs"
Cohesion: 0.20
Nodes (35): ad_hoc_codesign_bundled_llama_server(), ad_hoc_codesign_one(), assert_macos_bundle_load_paths_resolved(), backend_plugin_file_names(), backend_plugin_paths(), bundle_llama_server(), cargo_profile_dir(), cleanup_staged_runtime_artifacts() (+27 more)

### Community 29 - ".run_agent_response"
Cohesion: 0.08
Nodes (25): AgentProposalCommitIntent, ChatForgottenFolderSnapshot, ChatProjectionSink, ChatRecallDocument, ChatServiceInner, ChatServiceTier, ChatSettings, compact_text() (+17 more)

### Community 30 - "String"
Cohesion: 0.25
Nodes (34): EdgeAdjacency, adjacency_for_group(), assign_clouds(), build_edge_adjacency(), centroid(), centroid_for_ids(), choose_seed_ids(), connected_components() (+26 more)

### Community 31 - ".build_and_publish"
Cohesion: 0.11
Nodes (40): atlas_root(), atlas_row_visible(), atlas_visibilities_for_mutation_batch(), AtlasChatVisibilityKey, AtlasDependencies, AtlasGenerationKey, AtlasLabelRequest, AtlasReadyPointer (+32 more)

### Community 32 - "CloudSpec"
Cohesion: 0.21
Nodes (23): child_cloud_radius(), cloud_affinity(), cloud_center_overlaps(), cloud_index_pairs(), CloudSpec, compact_child_centers(), compact_cloud_members(), distance() (+15 more)

### Community 33 - "proposals/index.ts"
Cohesion: 0.05
Nodes (70): EditorCapabilityAdapter, ChatPaneProposalBindings, commitNoteReview(), previewNoteChangeProposal(), proposalErrorMessage(), backtrackDiff(), buildCreateDiff(), buildDeleteDiff() (+62 more)

### Community 34 - "Notepad.svelte"
Cohesion: 0.06
Nodes (22): DocumentStatusViewModel, getDocumentNoteId(), getDocumentStatusViewModel(), PaneSelectionMenuModel, PaneSlashMenuModel, ChatPaneViewModel, EditorPaneViewModel, PaneViewModel (+14 more)

### Community 35 - "documentState.ts"
Cohesion: 0.06
Nodes (71): conflictedDocument(), advanceRevision(), applySessionSnapshotToDocument(), beginDocumentOperation(), captureExternalDeletionConflict(), captureExternalSnapshotConflict(), completeDocumentOperation(), contentEquals() (+63 more)

### Community 36 - "SemanticDebugState"
Cohesion: 0.16
Nodes (20): current_rss_bytes(), current_rss_bytes_reports_nonzero_on_linux(), DebugInner, now_millis(), push_event(), record_timing_folds_metrics_and_pushes_event(), F, Mutex (+12 more)

### Community 37 - "atlas.rs"
Cohesion: 0.09
Nodes (40): activity_does_not_change_structural_link_strength(), apply_centrality(), assert_specs_do_not_overlap(), atlas_visibility_filters_hidden_chat_rows_and_adds_navigation_only_chats(), AtlasHardLink, AtlasLabelReadyPointer, AtlasNoteMetadata, boost_links() (+32 more)

### Community 38 - "structuralIndentation.ts"
Cohesion: 0.11
Nodes (23): createMarkdownBaseExtensions(), createIndentExtensions(), INDENT_UNIT_STRING, applyEditorIndentation(), collectListItems(), groupSelectedRoots(), hasSelectedAncestor(), IndentationChange (+15 more)

### Community 39 - "appStore.svelte.ts"
Cohesion: 0.13
Nodes (16): AppStore, Listener, NoteSavedPayload, VaultNoteChangedPayload, NoteSession, BootstrapAppPayload, BootstrapAppResult, loadBootstrapPayload() (+8 more)

### Community 40 - "AtlasStore"
Cohesion: 0.20
Nodes (3): AtlasStore, isAtlasResponsePending(), AtlasChatVisibility

### Community 41 - "slashMenu.ts"
Cohesion: 0.08
Nodes (32): EditorMenuGroup, EditorMenuOption, slashMenuGroups, slashMenuOptionIds, clampMenuHoverIndex(), consumeMenuKeyEvent(), stepMenuHoverGroup(), stepMenuHoverIndex() (+24 more)

### Community 42 - "editor.ts"
Cohesion: 0.08
Nodes (42): CreateSharedEditorResourcesOptions, buildRootForwardSpec(), clampSelection(), collectHistoryAnnotations(), EditorDocumentRuntime, paneSyncAnnotation, readSelection(), RuntimeReplaceOptions (+34 more)

### Community 43 - "editor/inlineFormatting.ts"
Cohesion: 0.15
Nodes (22): dispatchEditorChange(), applyInlineFormat(), applyLink(), applySpec(), applyWikilink(), DetectedWrap, detectWrap(), EnclosingFormat (+14 more)

### Community 44 - "wikilinks.test.ts"
Cohesion: 0.18
Nodes (12): concealTargetAndSeparator, decorateWikilink(), selectionIntersectsWikilink(), parseWikilinkNode(), WikilinkElement, WikilinkInlineContext, wikilinkMarkdownExtension, ParsedWikilink (+4 more)

### Community 45 - "map/+page.svelte"
Cohesion: 0.12
Nodes (10): getNodeRadiusZoomMultiplier(), cloudLabel(), formatCloudLabelText(), getCloudLabelSize(), getNodeMinRadiusPixels(), getNodeRadiusPixels(), getNoteLabelOffsetWorldUnits(), labelClearanceWorldUnits() (+2 more)

### Community 46 - "NoteKey"
Cohesion: 0.11
Nodes (6): DocumentRegistry, DocumentRuntime, NoteKey, createSharedEditorResources(), StoredImageAsset, PaneNoteReferences

### Community 47 - "editorExtensions.ts"
Cohesion: 0.12
Nodes (26): createPaneExtensions(), createWikilinkExtensions(), PaneExtensionApis, unavailableImagesConfig, createFilteredDefaultKeymap(), createPlatformNavigationKeymap(), createLayoutTheme(), createOverlayScrollMargins() (+18 more)

### Community 48 - "semantic.ts"
Cohesion: 0.09
Nodes (32): message(), createNavigationSelectionController(), NavigationSelectionControllerDeps, setup(), RecentTaskItem, LocationHistoryEntry, NavigationContext, RecentFocusBundle (+24 more)

### Community 49 - "state.ts"
Cohesion: 0.09
Nodes (31): createWikilinkInteractionController(), setup(), TransientUiPort, WikilinkControllerPort, WikilinkInteractionControllerDeps, NoteLinkSuggestion, ResolvedNoteLink, WikilinkController (+23 more)

### Community 50 - "search/store.svelte.ts"
Cohesion: 0.11
Nodes (12): getIndexedRecentItem(), loadLatestCollection(), openRecentNoteItem(), runRecentSelection(), listRecentFocus(), listRecentNotes(), listRecentTasks(), createNotepadSearchStore() (+4 more)

### Community 51 - "HashMap"
Cohesion: 0.19
Nodes (15): add_delta(), apply_disc_repulsion(), AtlasLabelGenerationArtifact, AtlasPublishedLabel, blob_hull(), build_cloud(), cloud_color(), cloud_density() (+7 more)

### Community 52 - "paneCommandPicker.ts"
Cohesion: 0.10
Nodes (20): editor(), EditorActionParams, createWorkspaceChoiceController(), setup(), WorkspaceChoiceControllerDeps, PaneWorkspaceActions, getChoiceIndexForShortcut(), getNextPaneCommandIndex() (+12 more)

### Community 53 - "callWithDraft"
Cohesion: 0.28
Nodes (14): acknowledgedDrafts, callWithDraft(), computeDraftHash(), fingerprintKey(), forgetDraft(), isDraftAcknowledged(), isDraftCacheMiss(), rememberDraft() (+6 more)

### Community 55 - "chatPaneBindings.ts"
Cohesion: 0.19
Nodes (11): CHAT_COMMANDS, ChatDraftSeed, formatDiscussionDraft(), mergeDiscussionDraft(), ChatActiveNoteSnapshot, ChatCitation, ChatContextNote, ChatSelectionActions (+3 more)

### Community 57 - "noteStore.ts"
Cohesion: 0.05
Nodes (62): createDocumentEditingService(), DocumentEditingServiceDeps, createHarness(), createDocumentPaneCoordinator(), note(), snapshot(), createLocationHistoryController(), createNoteCommandController() (+54 more)

### Community 58 - "inlineFormatSpec.ts"
Cohesion: 0.10
Nodes (23): codeBlockLine, codeBlockLineEnd, codeBlockLineStart, codeFenceMark, codeSpec, conceal, decorateCodeBlocks(), decorateFenced() (+15 more)

### Community 59 - "obsidianMarkdownExtensions.ts"
Cohesion: 0.16
Nodes (6): commentDelimiter, CommentInlineContext, commentMarkdownExtension, highlightDelimiter, HighlightInlineContext, highlightMarkdownExtension

### Community 60 - "noteNavigation.ts"
Cohesion: 0.60
Nodes (3): consumePendingNoteTarget(), PendingNoteTarget, storePendingNoteTarget()

### Community 61 - "chat/api.ts"
Cohesion: 0.06
Nodes (25): ChatApi, normalizeSettings(), RawChatSettings, RawConversation, RawExcerpt, RawMessage, RawProjectionConflictEvent, RawReceipt (+17 more)

### Community 62 - "markdownExtensions.ts"
Cohesion: 0.08
Nodes (34): selectionOverlaps(), selectionTouchesLine(), concealMark, concealQuoteMarks(), decorateBlockquote(), quoteContent, quoteLine, decorateHeading() (+26 more)

### Community 63 - "NoteDraftState"
Cohesion: 0.14
Nodes (34): createDocumentConflictController(), DocumentConflictController, DocumentConflictControllerDeps, setup(), DocumentEditingService, DocumentPaneCoordinator, DocumentPaneCoordinatorDeps, NoteDraftState (+26 more)

### Community 64 - "notepadChatPaneAdapter.ts"
Cohesion: 0.11
Nodes (28): getDocumentPath(), getDocumentTitle(), noteTitle(), ProposalOrchestration, createNotepadProposalAdapter(), createPaneSessionController(), findPaneCommandPreviousItem(), paneCommandNoteLabel() (+20 more)

### Community 65 - "taskListStore.svelte.ts"
Cohesion: 0.19
Nodes (8): CommittedMutationWarning, TaskFilter, TaskGroup, TaskItem, TaskListGroupPatch, mocks, task, storePendingTaskTarget()

### Community 66 - "chatPanelHelpers.ts"
Cohesion: 0.13
Nodes (13): proposalIdFromReviewSource(), reviewBelongsToConversation(), proposal, review, ChatAgentProposal, chatConversationContextKey(), markdown, proposalInitialMarkdown() (+5 more)

### Community 67 - "blockTypes.ts"
Cohesion: 0.07
Nodes (51): createBlockHandleExtension(), DropSlot, HandleLaneMetrics, VisualLineAnchor, BlockHandleRefs, mountBlockHandle(), moveViaMinimalChange(), applyBlockTypeSelection() (+43 more)

### Community 68 - "SettingsStore"
Cohesion: 0.10
Nodes (6): retrySemanticIndex(), loadSettingsViewSlice(), createVaultFolderSlice(), listVaultFoldersSlice(), loadVaultInfoSlice(), SettingsStore

### Community 69 - "selectionSurround.ts"
Cohesion: 0.16
Nodes (14): markdownEnter(), runEnter(), createSelectionSurroundExtension(), isOffsetInsideCodeFence(), selectionAfterWrap(), SURROUND_BY_CHAR, surroundRange(), surroundSelection() (+6 more)

### Community 70 - "NotepadPaneId"
Cohesion: 0.13
Nodes (17): createNotepadWorkspaceCommands(), NotepadPaneId, assertWorkspaceInvariants(), commands, first, noteA, noteB, noteC (+9 more)

### Community 71 - "links.ts"
Cohesion: 0.18
Nodes (8): decorateLink(), decorateRawLink(), linkMarker, linkText, LinkTextWidget, linkUrl, ParsedLink, parseLinkMarkdown()

### Community 72 - "TauriChatApi"
Cohesion: 0.08
Nodes (6): normalizeExcerpt(), normalizeMessage(), normalizeSource(), normalizeSummary(), projectionLink(), TauriChatApi

### Community 73 - "keyboardShortcuts.svelte.ts"
Cohesion: 0.09
Nodes (30): buildModifierTokens(), defaultKeyboardShortcutBindings, formatShortcutKey(), getEventKeyToken(), getShortcutBindingParts(), isBrowser(), KeyboardShortcutBindings, KeyboardShortcutDefinition (+22 more)

### Community 74 - "selectionMenu.ts"
Cohesion: 0.14
Nodes (14): blockTypeMenuGroups, InlineFormatId, getSelectionRange(), selectionControllers, selectionMenuActivateGroupFromUi(), selectionMenuApplyInlineFromUi(), SelectionMenuController, selectionMenuHandleKeydownFromUi() (+6 more)

### Community 75 - "ChatControllerStore"
Cohesion: 0.14
Nodes (3): ChatControllerStore, errorText(), mergeSummary()

### Community 76 - "notepadSessionLifecycle.ts"
Cohesion: 0.17
Nodes (9): createNotepadSessionLifecycle(), NotepadSessionLifecycleDeps, createPaneEditorLifecycle(), PaneEditorSession, loadCurrentVaultInfo(), resolveAssetRootPath(), storePastedImageAsset(), consumePendingTaskTarget() (+1 more)

### Community 77 - "PaneCommandPicker.svelte"
Cohesion: 0.17
Nodes (11): currentOptionAriaLabel, currentOptionTitle, currentShortcutLabel, optionKeyClass, previousOptionAriaLabel, previousOptionTitle, previousShortcutLabel, rootClass (+3 more)

### Community 78 - "read_state"
Cohesion: 0.17
Nodes (30): build_forgotten_note_summary(), chat_folder_uses_the_forgotten_item_recovery_lifecycle(), cleanup_expired_forgotten_notes(), delete_forgotten_notes(), expired_chat_folder_deletes_the_archive_and_conversation_history(), forget_note(), forgotten_item_kind_name(), list_forgotten_notes() (+22 more)

### Community 80 - "notepadChatCoordinator.svelte.ts"
Cohesion: 0.16
Nodes (15): ForgottenNoteRetentionPreference, documentToSessionSnapshot(), EditorMarkdownInsertOptions, EditorMarkdownInsertResult, createNotepadFeatureHost(), NotepadDocumentSnapshot, NotepadEditorSelectionSnapshot, NotepadFeatureHost (+7 more)

### Community 82 - "paneTransientUiController.svelte.ts"
Cohesion: 0.14
Nodes (13): createEditorMenuBridge(), EditorMenuBridge, SlashMenuSnapshot, bridge, PaneTransientUiController, PaneTransientUiDeps, PaneId, PANE_TRANSIENT_UI_KINDS (+5 more)

### Community 83 - "listSelection.ts"
Cohesion: 0.31
Nodes (7): getNextListSelectionIndex(), getSelectableListIndexes(), ListSelectionDirection, ListSelectionOptions, ListSelectionState, moveListSelection(), pointListSelection()

### Community 84 - "passiveTableExtension.ts"
Cohesion: 0.33
Nodes (9): buildPassiveTableDecorations(), collectPassiveTableRanges(), ensureTableCaretVisible(), findTableLineElement(), isMarkdownTableDelimiterLine(), isMarkdownTableLine(), PassiveTableRange, syncTableRowScroll() (+1 more)

### Community 85 - "searchMatch.ts"
Cohesion: 0.60
Nodes (3): isWholeWordSearchMatch(), textMatchesSearch(), TextSearchOptions

### Community 86 - "architectureFitness.test.ts"
Cohesion: 0.42
Nodes (8): classProperties(), interfaceProperties(), isNoteDraftState(), propertyName(), repositoryRoot, sourceFile(), stateObjectProperties(), visit()

### Community 87 - "imageEmbedWidgets.ts"
Cohesion: 0.10
Nodes (25): forEachImageEmbed(), formatImageEmbedTarget(), ImageEmbedMatch, isOffsetInsideCodeFence(), isPositionInsideCodeFence(), lineStarts(), ParsedImageEmbedTarget, parseImageEmbedTarget() (+17 more)

### Community 88 - "editorTextSize.svelte.ts"
Cohesion: 0.13
Nodes (24): applyEditorTextSizes(), clamp(), customFromResolved(), DEFAULT_CUSTOM_EDITOR_TEXT_SIZE, editorTextSize, EditorTextSizeCustom, EditorTextSizePreference, EditorTextSizes (+16 more)

### Community 89 - ".related_notes"
Cohesion: 0.18
Nodes (21): RelatedNoteMatch, RelatedNotesResponse, ActiveSemanticState, build_excerpt(), build_note_query_text(), build_note_query_text_includes_title_and_truncates(), build_related_cache_key(), build_selection_query_text() (+13 more)

### Community 91 - "ipcFixtures.test.ts"
Cohesion: 0.29
Nodes (5): AppEventContractFixture, CommandContractFixture, CommandFixture, eventFixture, invokeMock

### Community 93 - "attachments.ts"
Cohesion: 0.11
Nodes (23): attachmentAccept(), attachmentBlob(), attachmentPreviewKind(), attachmentTextPreview(), base64ToBytes(), bytesToBase64(), ChatAttachmentPreviewKind, ChatAttachmentTextPreview (+15 more)

### Community 94 - "openFlow.ts"
Cohesion: 0.16
Nodes (26): findCmContentElement(), getEditorContentSurface(), QueryRoot, attachPaneSelectionTracking(), cmContentInteractionEvents, PaneSelectionTrackingDeps, findBestEditorTarget(), findLastSelectionPoint() (+18 more)

### Community 95 - "lock_test_env"
Cohesion: 0.13
Nodes (26): MutexGuard, collect_recent_note_results_skips_current_note(), load_note_session_from_notes_dir_clears_stale_last_opened_path(), open_note_follows_note_id_when_supplied_path_was_externally_renamed(), open_note_from_notes_dir_updates_last_opened_and_recents(), open_note_row_scoped_write_preserves_unrelated_state_fields(), path_qualified_note_references_match_relative_vault_paths(), read_note_session_from_path_does_not_update_last_opened_or_recents() (+18 more)

### Community 96 - "controller.svelte.ts"
Cohesion: 0.09
Nodes (13): textPreview, ChatControllerOptions, initialState, upsertMessage(), upsertTerminalMessage(), conversation(), fakeApi(), forgottenChat (+5 more)

### Community 97 - "settings/store.svelte.ts"
Cohesion: 0.21
Nodes (10): loadForgottenNotesSlice(), loadSemanticSlice(), loadSemanticStatusSlice(), refreshSettingsAfterVaultChange(), refreshSettingsForVisibility(), SettingsRefreshLoaders, ForgottenAction, GeneralSection (+2 more)

### Community 98 - "layout.ts"
Cohesion: 0.13
Nodes (23): buildRelatedRequestKey(), computeRelatedDrawerLayout(), findHorizontalClipBoundary(), getCollapsedRelatedDrawerWidth(), getEditorDomSelection(), getEditorSelectionText(), getExpandedRelatedDrawerWidth(), getLayoutRelatedDrawerWidth() (+15 more)

### Community 99 - "paneCommandGroup.ts"
Cohesion: 0.40
Nodes (4): focusInputAtEnd(), createPaneCommandGroup(), PaneCommandGroup, PaneCommandGroupDeps

### Community 100 - "currentNoteSearch.ts"
Cohesion: 0.53
Nodes (4): buildCurrentNoteSearchResults(), cropLineAroundMatch(), CurrentNoteSearchOptions, searchCurrent()

### Community 103 - "settings/store.test.ts"
Cohesion: 0.50
Nodes (3): invokeMock, loadForgottenNotesSliceMock, loadSettingsViewSliceMock

### Community 104 - "node-shims.d.ts"
Cohesion: 0.50
Nodes (3): node:fs, node:path, node:url

### Community 115 - "current_time_millis"
Cohesion: 0.15
Nodes (21): FnMut, clear_atlas_cache_removes_positions_and_legacy_settings(), deletes_and_moves_enqueue_paths_and_former_neighbors(), EdgeRebuildStats, incremental_edge_repair_preserves_unrelated_and_repairs_reverse_neighbors(), moving_a_note_preserves_stable_and_chunk_ann_labels(), note_ann_generation_mismatch_forces_full_edge_rebuild(), rebuild_edges_bounds_neighbors_per_note_and_reports_stats() (+13 more)

### Community 116 - "EventBus"
Cohesion: 0.16
Nodes (11): Serialize, AppEvent, EventBus, EventChannel, AppHandle, Option, Path, Self (+3 more)

### Community 117 - "atlasStore.svelte.ts"
Cohesion: 0.13
Nodes (20): AtlasChatVisibilityLoader, AtlasChatVisibilitySaver, atlasLabelRenderKey(), AtlasLinkedNote, AtlasResponseLoader, AtlasZoomTier, getNodePosition(), getZoomTier() (+12 more)

### Community 119 - "ann_core.rs"
Cohesion: 0.18
Nodes (21): S, allocate_generation_artifacts(), desired_capacity(), file_timestamp_millis(), generation_path(), GenerationArtifactNames, load_graph_and_vectors(), new_hnsw_index() (+13 more)

### Community 120 - ".get_conversation"
Cohesion: 0.16
Nodes (10): adding_a_message_to_an_existing_part_does_not_rewrite_conversation_index(), archiving_moves_the_complete_projection_folder_and_restoring_reactivates_it(), ChatConversation, ChatConversationSummary, ChatProjectionRelocation, conversation_directory(), part_link(), HashSet (+2 more)

### Community 121 - "NotepadChatCoordinator"
Cohesion: 0.15
Nodes (5): createChatController(), ChatSelection, formatChatInsertion(), NotepadChatCoordinator, storedUpdatePreview()

### Community 122 - "NotepadCommandBar.svelte"
Cohesion: 0.10
Nodes (6): closeForgetConfirm(), dedupeCurrentSearchResults(), getCurrentSearchPreviewCrop(), getCurrentSearchPreviewText(), handleForgetConfirmKeydown(), normalizeSearchText()

### Community 124 - "editorCapabilities.ts"
Cohesion: 0.15
Nodes (17): createEditorCapabilityAdapter(), EditorMarkdownInsertTarget, EditorSelectionCapabilitySnapshot, insertEditorMarkdown(), ReadOnlyOverlayHandle, readEditorState(), setProposalReviewExtensions(), clampPos() (+9 more)

### Community 125 - "theme.svelte.ts"
Cohesion: 0.23
Nodes (12): isTauriRuntime(), initializeTheme(), isBrowser(), persistThemePreference(), readBrowserSystemTheme(), readNativeTheme(), readStoredThemePreference(), ResolvedTheme (+4 more)

### Community 126 - "asset_commands.rs"
Cohesion: 0.19
Nodes (19): asset_extension_from_mime_type(), asset_extension_from_name(), mime_type_from_asset_name(), read_image_asset_data_url(), read_image_asset_data_url_from_assets_dir(), resolve_asset_image_path(), resolve_pasted_image_path(), Option (+11 more)

### Community 127 - "load_note_session_from_notes_dir_with_state"
Cohesion: 0.37
Nodes (19): clear_stale_last_opened_note(), load_note_session_from_notes_dir(), load_note_session_from_notes_dir_with_state(), lookup_path_in_index(), mark_note_opened(), open_note_from_notes_dir(), open_note_from_notes_dir_with_state(), open_ui_state_already_primary() (+11 more)

### Community 128 - "locationMru.ts"
Cohesion: 0.14
Nodes (17): ChatNavLocation, clearLegacyLocalStorageChat(), createLocationMruStore(), editorLocationFromRecent(), loadLegacyLocalStorageChat(), loadPersistedChatLocation(), locationDisplayLabel(), LocationMruStore (+9 more)

### Community 129 - "chunking.rs"
Cohesion: 0.33
Nodes (18): chunk_markdown(), chunk_markdown_matches_project_atlas_fixture(), chunk_markdown_produces_stable_content_hash_for_same_markdown(), ChunkedNote, collapse_whitespace(), flush_paragraph(), hash_string(), Paragraph (+10 more)

### Community 131 - "apply_umap_layout"
Cohesion: 0.20
Nodes (14): Array2, apply_normalized_embedding(), apply_umap_layout(), build_hnsw_knn_rows(), complete_knn_rows_for_umap(), complete_knn_rows_for_umap_keeps_full_rows_without_exact_fill(), cosine_distance_for_umap(), cosine_similarity() (+6 more)

### Community 132 - "open_database"
Cohesion: 0.31
Nodes (13): open_database(), Path, chat_recall_indexes_only_immutable_excerpt_chunks(), full_scan_applies_external_deletes_incrementally(), full_scan_indexes_nested_notes(), indexing_failures_stop_at_the_retry_bound_and_keep_repair_pending(), note_batch_embeds_across_notes_in_large_provider_requests(), remembering_one_excerpt_does_not_rebuild_or_walk_a_twenty_thousand_chunk_corpus() (+5 more)

### Community 133 - "appSettings.svelte.ts"
Cohesion: 0.19
Nodes (9): appSettings, AppSettingsStore, FORGET_BUTTON_DURATION_MS, ForgetButtonDurationPreference, isBrowser(), persistForgetButtonDurationPreference(), persistForgottenNoteRetentionPreference(), readStoredForgetButtonDurationPreference() (+1 more)

### Community 134 - "cursorState.ts"
Cohesion: 0.28
Nodes (13): canUseStorage(), CursorPosition, findBestCursorEntry(), getCursorStorageKey(), getCursorStorageKeyForNoteId(), isStoredCursorEntry(), loadCursorPosition(), readStoredCursorMap() (+5 more)

### Community 135 - "NavBar.svelte"
Cohesion: 0.17
Nodes (4): awaitPendingNoteSave(), PendingNoteSaveHandler, bumpAppShellViewGeneration(), viewGeneration

### Community 137 - "BackgroundWorkGate"
Cohesion: 0.21
Nodes (7): ActivityState, BackgroundWorkGate, checkpoint_returns_immediately_when_not_paused(), checkpoint_waits_only_while_manually_paused(), Condvar, Mutex, Self

### Community 138 - "permissions"
Cohesion: 0.15
Nodes (12): description, identifier, permissions, $schema, windows, core:app:allow-set-app-theme, core:default, core:window:allow-start-dragging (+4 more)

### Community 139 - "KeyboardShortcutsPanel.svelte"
Cohesion: 0.19
Nodes (10): clearShortcut(), describeConflicts(), filteredGroups, handleRecordKeydown(), handleWindowKeydownCapture(), normalizedSearchQuery, stopRecording(), visibleShortcutCount (+2 more)

### Community 140 - "read_indexed_note_from_path"
Cohesion: 0.38
Nodes (10): read_indexed_note_from_path(), read_modified_millis(), remove_notes_index_entry(), Option, Path, PathBuf, Result, State (+2 more)

### Community 141 - "secrets.rs"
Cohesion: 0.44
Nodes (9): development_api_key_override(), has_openai_api_key(), has_openai_api_key_macos(), read_openai_api_key(), AppHandle, Option, Result, String (+1 more)

### Community 142 - "titleInteractionController.ts"
Cohesion: 0.25
Nodes (7): createTitleInteractionController(), setup(), TitleInteractionControllerDeps, formatNoteTitle(), ParsedNoteDocument, parseStoredMarkdown(), stripFrontmatter()

### Community 143 - "shortcuts.ts"
Cohesion: 0.27
Nodes (7): CloseActivePaneDeps, closeActivePaneIfSplit(), createWorkspaceShortcutHandler(), registerWorkspaceWindowCloseHandler(), PaneId, WorkspaceShortcutDeps, keyboardShortcutMatchesEvent()

### Community 144 - "ScoredNeighbor"
Cohesion: 0.29
Nodes (7): Eq, Ord, Ordering, PartialEq, PartialOrd, Self, ScoredNeighbor

### Community 145 - "ChatExcerpt"
Cohesion: 0.29
Nodes (5): ChatExcerpt, excerpt_accepts_text_selected_from_rendered_markdown(), excerpt_match_tokens(), excerpt_requires_valid_utf8_boundaries_and_remember_is_explicit(), tokens_are_ordered_subsequence()

### Community 146 - "persist_note_session_with_outcome"
Cohesion: 0.42
Nodes (9): build_saved_note_session(), committed_projection_failure_still_returns_authoritative_new_note_path(), file_stem_title(), NotePersistenceMode, persist_note_session_with_outcome(), PersistNoteOutcome, Option, Result (+1 more)

### Community 147 - "VaultAtlasResponse"
Cohesion: 0.27
Nodes (10): AtlasCloud, AtlasGenerationArtifact, AtlasLink, AtlasNode, AtlasSearchMatch, AtlasSearchResponse, days_from_civil(), parse_rfc3339_millis() (+2 more)

### Community 148 - "get_vault_atlas"
Cohesion: 0.47
Nodes (8): AtlasChatVisibility, clear_atlas_cache(), get_vault_atlas(), Option, Result, State, String, search_vault_atlas()

### Community 149 - "collect_markdown_files_recursively"
Cohesion: 0.28
Nodes (8): OsStr, collect_markdown_files_recursively(), Path, PathBuf, Result, String, Vec, unique_path_in_dir()

### Community 150 - "retrieve_vault_notes"
Cohesion: 0.31
Nodes (8): retrieve_vault_notes(), HashSet, Option, PathBuf, Result, String, Vec, VaultRetrievalItem

### Community 151 - "architecture_fitness.rs"
Cohesion: 0.50
Nodes (7): assert_contains_all(), assert_contains_none(), clean_task_commands_delegate_canonical_mutation_to_the_task_service(), dirty_document_task_prepare_contract_is_registered_and_fixture_backed(), note_save_and_proposal_commit_use_the_shared_post_commit_boundary(), repository_file(), String

### Community 152 - ".search_vault_atlas"
Cohesion: 0.29
Nodes (6): ActiveSemanticState, frequency_score(), lexical_note_score(), reason_labels(), recency_score(), title_tag_path_score()

### Community 153 - "formatShortcutBinding"
Cohesion: 0.40
Nodes (5): getInlineFormatShortcutLabel(), matchesSearch(), formatShortcutBinding(), getDefaultKeyboardShortcutBinding(), getKeyboardShortcutBinding()

### Community 155 - "createMarkdownExtensions"
Cohesion: 0.40
Nodes (4): createMarkdownExtensions(), codeHighlightStyle, createMarkdownHighlight(), markdownResetStyle

### Community 156 - "ann_label_for"
Cohesion: 0.50
Nodes (4): ann_label_for(), ann_labels_are_stable_for_same_chunk_identity(), ann_labels_change_when_note_identity_or_ordinal_changes(), ann_labels_fit_in_sqlite_integer_range()

## Knowledge Gaps
- **350 isolated node(s):** `Listener`, `VaultNoteChangedPayload`, `NoteSavedPayload`, `ForgetButtonDurationPreference`, `FORGET_BUTTON_DURATION_MS` (+345 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppState` connect `AppState` to `index.rs`, `SemanticState`, `search_commands.rs`, `task_mutation.rs`, `proposals.rs`, `LexicalIndex`, `read_indexed_note_from_path`, `read_state`, `vault_watcher.rs`, `persist_note_session_with_outcome`, `ChatService`, `get_vault_atlas`, `EventBus`, `retrieve_vault_notes`, `prepare_notes_dir`, `load_note_session_from_notes_dir_with_state`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `DocumentKind` connect `db.rs` to `.related_notes`, `index.rs`, `search_commands.rs`, `atlas.rs`, `LexicalIndex`, `VaultAtlasResponse`, `EventBus`, `note.rs`, `indexer.rs`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `content_hash()` connect `proposals.rs` to `db.rs`, `.related_notes`, `AgentToolContext`, `vault_watcher.rs`, `String`, `.connection`, `indexer.rs`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `Listener`, `VaultNoteChangedPayload`, `NoteSavedPayload` to the rest of the system?**
  _350 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `db.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.09637952559300873 - nodes in this community are weakly interconnected._
- **Should `index.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.05866413765072483 - nodes in this community are weakly interconnected._
- **Should `persistence.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.10882882882882883 - nodes in this community are weakly interconnected._