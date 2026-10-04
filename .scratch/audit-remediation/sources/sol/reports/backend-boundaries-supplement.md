# Backend command, index, event and lifecycle boundaries: supplementary audit

Date: 2026-10-03 (America/Denver). Supplement to the original module audits, prompted by coverage reconciliation. The initial reports did not explicitly inventory these six Rust files. This document corrects that omission; it does not retrospectively claim they were fully inspected during the initial pass. No application/test changes or executable test runs were performed for this supplement. The previously approved small cleanup is already in the shared working tree. Line references describe the inspected working-tree version.

## Inspection depth and inventory

All 52 inline test bodies in these six files were read, including setup, assertions, waits and teardown. Complete production bodies were read in `commands.rs`, `commands/search_commands.rs`, `test_support.rs`, `app/events.rs` and `app/lifecycle.rs`. In `index.rs`, production inspection was selective: AppState construction/ownership, draft-cache resolution, foreground guard, dirty/cold refresh admission and projection application (1–550), indexed/current-override construction (1363–1504), and the targeted interfaces identified by the test inventory. Stable identity transfer, full refresh reconciliation remainder, parser internals and task-toggle internals were inventoried/referenced, not independently verified line by line in this supplement. Related catalog, timeline, watcher and state behavior is in `backend-timeline.md`; semantic services are in `agent-app.md`.

| File | Lines | Inline tests | Depth |
| --- | ---: | ---: | --- |
| `src-tauri/src/index.rs` | 2157 | 14 | All test bodies; selected consequential production paths as above |
| `src-tauri/src/commands.rs` | 1916 | 26 | Full command surface and all test bodies; delegates reconciled with other reports |
| `src-tauri/src/commands/search_commands.rs` | 1929 | 6 | Full command/cache/ranking implementation and all test bodies |
| `src-tauri/src/test_support.rs` | 100 | 1 | Complete helper and contract case |
| `src-tauri/src/app/events.rs` | 337 | 1 | Complete bus/codec and fixture case |
| `src-tauri/src/app/lifecycle.rs` | 380 | 4 | Complete admission/join/terminal-release flow and test cases |

Additional narrow traces: `services/current_document.rs` (complete, 49 lines), `services/note_timeline/administration.rs:177–182` (cache invalidation at mutation admission), `semantic/mod.rs:993–1010,1246–1346` (semantic candidate kinds/filtering), and `src/lib/features/notepad/search/draftRef.ts` (complete Markdown-only hash protocol). These are supporting traces, not additional full-module audits. No claim of formal verification or measured flake/performance rates is made.

## Scenario ownership and preserved boundaries

- Index tests own real note parsing/projection fixture shape, frontmatter exclusion, managed timestamp fallback, task markers/duplicate-line/CRLF coordinates, unchanged file-signature avoidance, foreground scheduling, cold versus warm discovery, and hidden-directory exclusion. Keep pure parsing cases independent of AppState service construction. `IndexTestFixture` already joins projection work and resets the notes-root override on unwind (`index.rs:1804–1838`); it is a useful existing pattern, not a newly proposed fix.
- Command tests own staged-versus-running vault selection and restart resolution, stale navigation cleanup, stable identity after rename, row-scoped state preservation, read-versus-open navigation semantics, recent-note exclusion, hybrid labels/weights/activity, chat kind/anchor preservation, wikilink coordinates/path aliases, asset containment/collision/encoding, and response wire shapes. The six note-session scenarios overlap the backend timeline supplement intentionally; they should be counted once when producing a total.
- Search tests own keyword availability while lexical projection is pending (64 imported files), late cache-write rejection, a CurrentContent concurrent-delivery invariant, degraded semantic result conversion, candidate-only access lookup, and tag matching/filtering before limits. Most service cases disable semantic execution. The fake CurrentContent case and pure hybrid ranking case do not jointly prove the real command's asynchronous composition.
- Event test owns channel/payload serialization for five non-streaming event variants. Lifecycle tests own missing managed services, joining a concurrent preparation, and retry after terminal close failure. Native `app-lifecycle` acceptance remains owner of actual application restart/process durability; mock-runtime cases should remain much cheaper and focused on backend receipts/admission.

## Prioritized review items

### BB-01 — P2: Search and related response-cache keys omit a behavior input

Evidence: `search_commands.rs:620–632,1045–1064` keys search by query/tags/path/body hash/limit/explicit weights, but not `current_title`; cache hits return before `collect_lexical_candidates` builds the title-sensitive current override (`:1100–1128`, `index.rs:1434–1503`). `search_commands.rs:838–848,1074–1090` likewise omits title from related caching, although `:853–866` passes it to `semantic.related_notes`. The parsed-override cache *does* include title (`:174–186`), so the higher result-cache hit bypasses the correctly distinguished parse. Frontend `computeDraftHash` hashes body only (`draftRef.ts:14–22`), and `resolve_current_document` preserves that supplied hash without mixing title. Thus two requests with the same body/path/query but different unsaved titles can collide for the 750ms result TTL. Canonical save/mutation invalidation may shorten the visible interval; no interactive reproduction was run.

Change: first add a focused unchanged-body/title-only command scenario, then include the title (or one explicit request identity containing all ranking inputs) in search/related result keys. Also clarify policy for the optional no-hash command input before caching bodies under an empty hash; tests currently mostly pass no hash and do not repeat distinct bodies under identical keys. Do not replace the caller's acknowledged-body protocol or current-access freshness gate. Confidence: high key omission and title sensitivity; medium user-visible incidence until command reproduction. Verification: title-only changes within TTL, normal hit/miss, acknowledged-body retry, current tags/selection changes, and unchanged current-access admission.

### BB-02 — P2: Kind filtering occurs after the hybrid result limit

Evidence: real search wraps `merge_hybrid_candidates(... effective_limit ...)` in `filter_note_results` (`search_commands.rs:742–757`); merger truncates first (`:1454`), filter then removes every non-Note (`:1066–1072`). Untagged semantic requests have no kind restriction (`:687–714`); semantic matching preserves `chunk.document_kind` and filters existence/current path, not kind (`semantic/mod.rs:1300–1322`). The lower-layer case `commands.rs:1443–1477` positively demonstrates a chat candidate can reach the merger. A higher-ranked ChatIndex candidate can therefore occupy a slot that is discarded, excluding a lower-ranked eligible ordinary note. This is statically evidenced composition; no live embedding run was performed.

Change: decide allowed kinds at the search command boundary before ranking/truncation, preserving the reusable merger's chat kind/anchor behavior. Add a small deterministic composed scenario containing a higher-scored chat projection and two eligible notes with limit 2; require both notes and no chat. Retain the pure chat kind/anchor case and evidence/chat retrieval's separate allowed-kind policy. Reconcile with AA-10 hybrid-composition coverage; do not add an online model dependency. Confidence: high control-flow risk; production fixture reproduction remains required before editing.

### BB-03 — P2: The advertised concurrent-search test proves a lower boundary using fabricated results

`search_commands.rs:1663–1732` constructs a real AppState and performs a real concurrent save, but its reader calls `current_content(...).read` with a closure that manually constructs an old `NoteSearchResult` (`:1689–1711`). It never calls `search_notes_hybrid`, its cache, its async semantic worker, `get_related_notes`, or `retrieve_note_context`. It is valuable CurrentContent delivery coverage, but its name/file location imply broader command evidence than it supplies. `pending_keyword_tests` and `tag_search_tests` call the private unchecked function; only selected calls wrap real current-access admission.

Change: keep or move/rename this case under CurrentContent ownership and add one command-composition regression with deterministic deferred query work and a concurrent mutation, including cache hit and related/context shape where not already covered. Inject a narrow query seam rather than replacing NoteTimeline with a permissive fake. Preserve lower-layer admission and real save evidence; replacement must demonstrate failure when the outer command read gate is removed. Confidence: high tested-boundary mismatch; complete missing-suite coverage requires reconciliation with other module reports.

### BB-04 — P2: A failed synchronization assertion can strand the scoped restart test

`app/lifecycle.rs:323–327` installs a global test hook blocked on `release_rx.recv`; its sender is owned outside `std::thread::scope`. Inside scope, the controller can panic at the one-second entry timeout or `wait_for_joiner` assertion (`:337–349`, helper `:171–179`) before sending release (`:350`). Scoped thread unwinding joins outstanding children before the outer sender is dropped, so an entered child waiting for release can prevent failure from terminating. The production Condvar waiter has no independent terminal outcome if `run_prepare` unwinds (`:154–165`); this is relevant to hook/failure diagnostics, not evidence that an ordinary runtime path currently panics.

Change: make test-latch release unconditional via a scope-owned drop guard and bound hook waits, clearing/restoring the hook on all exits. Preserve the actual concurrent-join invariant and reuse-ready result check. Separately review whether lifecycle preparation should use an attempt-completion guard for unexpected panics, while keeping terminal failures closed. Verification should deliberately fail the controller before release and show bounded failure/teardown in an isolated helper process; avoid causing an ordinary suite hang. Confidence: high lifetime/unwind reasoning; hang was not intentionally executed.

### BB-05 — P2: Contract fixtures and disabled events leave important dispatch paths unexercised

`test_support.rs:67–98` actually deserializes/serializes only SemanticSettings and serializes the ready restart receipt; the nine-command loop verifies fixture *presence*. It does not validate save/task-save/chat/proposal/semantic-status argument dispatch or production result construction. `commands.rs:1813–1914` independently tests four response structs, with only one optional-field shape. Event fixture test `app/events.rs:234–336` checks `channel` and `legacy_payload` but never calls `EventBus.emit`; most service tests use `EventBus::disabled` (`:137–142`). Task mutation event routing (`commands.rs:658–714`), vault staging (`:508–520`), semantic status wrappers (`:721–806`) and bundled bootstrap/settings (`:832–870`) are not proved by the fixture test. This extends CC-04 contract exhaustiveness and EH-05 eventless browser-double concerns; it is not a claim every native event path is globally untested.

Change: distinguish pure codec tests from invoked command/consumer tests in naming and inventory. Reconcile one shared fixture schema, add optional/null/warning/error response cases where the frontend contract differs, and add a small native command/event round trip for consequential routing (task save source, canonical saved identity, staged vault payload) before expanding fakes. Preserve intentional best-effort event delivery (`events.rs:144–153`), rather than making failed notification roll back a committed save. Do not duplicate every large SemanticStatus constructor. Confidence: high local boundary limitations; native acceptance coverage reconciliation required.

### BB-06 — P3: Consolidate fixture lifetime and test ownership instead of deleting related invariants

Command fixtures at `commands.rs:1108–1329` repeat global app-data/root initialization and often leave overrides pointing to deleted TestDir paths even on successful exit. Search fixtures at `search_commands.rs:1535–1625,1663–1732,1847–1928` restore manually or omit restoration. Lifecycle fixture `:254–284` returns loose app/data/notes tuples; reset occurs after assertions (`:315,358,378`). The common mutex recovers poison (`test_support.rs:14–17`) but does not restore configuration after a failed assertion. This is the existing BT-03/AA-07 isolation workstream, now with explicitly listed command/lifecycle consumers. IndexTestFixture already provides cleanup and worker joining; do not regress it.

`commands.rs` contains 1044 lines of test module importing asset, wikilink and hybrid helpers (`:872–898`). Move pure helper scenarios to their owning modules and use narrow fixture builders for repeated NoteSearchResult inputs (`:1363–1637`); keep command tests about the command boundary. A codec-prefix-only assertion (`:1793–1803`) can pass with incorrectly encoded bytes: require the exact small fixture data URL rather than deleting the test. No measured speedup is claimed. Preserve separate activity-decay, containment, symlink, navigation-row and stable-identity scenarios. Verification: default-parallel fixture suites, forced assertion cleanup, worker termination before directory removal, preserved named scenario inventory. Confidence: high repeated setup/ownership coupling; performance benefit unmeasured.

### BB-07 — P3: Legacy refresh argument and time-window tests retain obsolete work

`commands.rs:74–83` explains that the 750ms refresh age is intentionally ignored; `index.rs:387–391` accepts `_max_age`. The test at `index.rs:2076–2125` sleeps 50ms solely to cross this old age. Remove this internal compatibility argument/constant in a separate bounded cleanup and express the warm-index no-full-scan invariant using observable refresh counts and dirty/reconcile admission. The background guard test (`index.rs:2014–2054`) additionally waits 100ms for a negative observation then polls drain; replace the initial sleep with a worker progress/barrier seam so the test proves the worker reached the foreground gate. The 64-file pending-keyword scenario has a bounded 30-second polling deadline; reduce its file count only if the new fixture still guarantees unprojected and already-projected coexistence. Keep cold-start discovery, dirty signature skipping, pending lexical fallback and foreground queue tests because they protect different boundaries. Confidence: high obsolete argument/sleep; default runtime savings small and unmeasured.

## Migration and verification boundaries

Prioritize deterministic command regressions for BB-01/02 and honest ownership for BB-03, then bounded latch/fixture teardown (BB-04/06), then targeted wire/dispatch evidence (BB-05), then remove obsolete argument/test waiting (BB-07). Do not rewrite NoteTimeline, RunningVault, catalog identity or the event/runtime seam merely to shorten these tests. Before any deletion, map the named scenarios below to their replacement owners and keep pure/service/command/native acceptance distinctions explicit. Root has already run baseline Rust/frontend suites; this supplement adds static inspection only and does not infer performance or flakiness from a passing baseline.

## Exhaustive inline test scenario inventory

The following names/locations were read; counts are declarations, including the Unix-only symlink case, not executable results or newly added tests.

### `src-tauri/src/index.rs`

- `every_projected_marker_can_be_toggled_without_rewriting_its_prefix` — line 1788.
- `build_indexed_note_matches_project_atlas_fixture` — line 1842.
- `indexed_note_excludes_arbitrary_frontmatter_from_search_paragraphs` — line 1867.
- `indexed_note_uses_managed_frontmatter_timestamps_with_filesystem_fallback` — line 1883.
- `toggle_task_in_markdown_uses_exact_line_then_nearest_match` — line 1901.
- `build_tasks_maps_editor_lines_without_matching_duplicate_text` — line 1924.
- `build_tasks_maps_crlf_editor_lines` — line 1948.
- `dirty_update_skips_unchanged_file_signatures` — line 1961.
- `full_refresh_collects_no_updates_for_unchanged_signatures` — line 1976.
- `prewarm_notes_index_populates_in_memory_map_and_warms_state` — line 1994.
- `background_queue_yields_to_foreground_then_drains` — line 2014.
- `foreground_guard_marks_state_busy_until_dropped` — line 2058.
- `ensure_interactive_index_skips_full_scan_after_cold_start` — line 2076.
- `refresh_discovers_nested_notes_and_skips_hidden_directories` — line 2129.

### `src-tauri/src/commands.rs`

- `applying_vault_selection_keeps_the_running_vault_usable` — line 900.
- `vault_selection_can_be_replaced_cleared_by_alias_and_fail_without_closing` — line 1018.
- `load_note_session_from_notes_dir_clears_stale_last_opened_path` — line 1108.
- `open_note_from_notes_dir_updates_last_opened_and_recents` — line 1139.
- `open_note_from_notes_dir_resolves_safe_vault_relative_paths` — line 1167.
- `open_note_follows_note_id_when_supplied_path_was_externally_renamed` — line 1193.
- `open_note_row_scoped_write_preserves_unrelated_state_fields` — line 1229.
- `read_note_session_from_path_does_not_update_last_opened_or_recents` — line 1287.
- `collect_recent_note_results_skips_current_note` — line 1331.
- `merge_hybrid_candidates_applies_labels_scores_and_limit` — line 1363.
- `semantic_only_chat_match_keeps_kind_and_anchor` — line 1443.
- `merge_hybrid_candidates_boosts_frequently_opened_notes` — line 1480.
- `merge_hybrid_candidates_idle_decay_removes_access_boost` — line 1560.
- `parse_wikilink_target_supports_aliases_and_same_note_sections` — line 1641.
- `resolve_note_link_target_prefers_paragraph_numbers_and_falls_back_to_title` — line 1659.
- `resolve_note_link_target_supports_stable_block_ids` — line 1683.
- `path_qualified_note_references_match_relative_vault_paths` — line 1699.
- `sanitize_asset_file_stem_normalizes_invalid_characters` — line 1725.
- `asset_extension_from_mime_type_covers_common_images` — line 1733.
- `resolve_pasted_image_path_avoids_collisions` — line 1740.
- `resolve_asset_image_path_rejects_nested_paths` — line 1760.
- `resolve_asset_image_path_accepts_contained_subfolders` — line 1771.
- `resolve_asset_image_path_rejects_symlink_escape` — line 1783.
- `read_image_asset_data_url_from_assets_dir_encodes_image_bytes` — line 1793.
- `mime_type_from_asset_name_defaults_for_known_extensions` — line 1806.
- `command_payload_json_contracts_remain_stable` — line 1813.

### `src-tauri/src/commands/search_commands.rs`

- `bulk_notes_are_keyword_searchable_before_background_indexing_finishes` — line 1535.
- `invalidation_rejects_late_search_and_related_cache_writes` — line 1634.
- `search_does_not_deliver_results_from_before_a_concurrent_note_mutation` — line 1663.
- `semantic_query_failure_becomes_an_empty_semantic_side_not_a_search_error` — line 1739.
- `note_access_lookup_from_index_only_includes_candidates` — line 1779.
- `tag_search_aliases_filter_before_limits_and_support_body_terms` — line 1847.

### `src-tauri/src/test_support.rs`

- `representative_command_payloads_use_production_serde_contracts` — line 67.

### `src-tauri/src/app/events.rs`

- `typed_non_streaming_events_match_contract_fixture` — line 234.

### `src-tauri/src/app/lifecycle.rs`

- `missing_app_state_cannot_claim_the_running_workspace_is_resumable` — line 288.
- `missing_chat_service_cannot_claim_the_running_workspace_is_resumable` — line 305.
- `concurrent_restart_preparations_join_one_ready_transition` — line 319.
- `terminal_close_failure_stays_closed_and_retry_reaches_ready` — line 362.
