# 04 — Reduce Rust timeline and task test machinery

Status: ready-for-agent
Progress: Complete; implemented, reviewed, and accepted after combined validation. See ../validation.md.

## Baseline and boundaries

Compare against the current-tree snapshot recorded in `../baseline.json`, not HEAD. Owned baseline files: `src-tauri/src/services/note_timeline/tests/publication.rs` (1766 lines), `tests/history_mode.rs` (913), `domain.rs`, `src-tauri/src/state/task_projection.rs` (1149), `src-tauri/tests/architecture_fitness.rs` (1187). No semantic/chat/evidence edits and no shared `test_support.rs` changes. Reuse its existing `TestVault` directly.

## Proposed deletions and retained behavior owners

1. Delete publication tests `editor_mutation_assigns_its_closed_source` (lines 1–13), `typed_entrypoints_cover_the_closed_mutation_source_vocabulary` (15–91), and `domain_records_carry_versioned_payloads_and_explicit_predecessors` (1522–1561). These create records through test-only constructors and immediately read their assigned fields. Delete their now-unused test-only `NoteRevisionHeader::issue`, `LifecycleEventHeader::issue`, `NoteMutation::baseline_initialization`, `NoteMutation::recovery_reconciliation`, and unreferenced mutation/observation getters, after compiler/reference confirmation. Retain `PreparedHistoryIntent::for_test`: another test fixture uses it. Retain `NoteMutation::editor` and `note_creation`: real persistence/failure tests use them.
   - Source retention owner: `every_app_owned_mutation_source_is_retained_by_the_same_contract` (publication.rs:927) actually prepares, publishes, finalizes, and reads durable history for six sources. Route its Editor/TaskAction/AcceptedChatProposal/VersionRestore/NoteCreation cases through the existing typed constructors so removal does not lose their mapping contract; recovery remains internal `with_source`. Actual initialization is covered by `existing_managed_note_gets_one_truthful_baseline_without_a_markdown_write` and `first_mutation_synchronously_baselines_the_existing_canonical_state` in administration.rs.
   - Record owner: `meaningful_commits_reconstruct_exact_authored_states_after_restart` (publication.rs:162) retains predecessor/reconstruction assertions; `unknown_persisted_history_vocabulary_fails_closed` (987) retains persisted version/lineage corruption rejection. Real rename/move/missing and external-observation tests in `observation_lifecycle.rs` own lifecycle creation and vocabulary. Synthetic ULID length checks against synthetic headers are obsolete; actual durable identity continuity remains.
   - Expected reduction: about 130 test lines plus 85–105 test-only helper/getter lines, less roughly 10–20 lines to route the retained real source test through typed entrypoints. No production behavior/interface change.
2. Delete `reconcile_assigns_stable_task_ids_across_reorder` (task_projection.rs:1025–1066). Retained `deadline_edits_reorder_external_refresh_and_moves_preserve_task_identity` (1068) already performs the same real database reorder plus nested task, due-date edit, and path move. Capture/assert Beta identity there alongside existing Alpha/Child identities (two lines). This preserves both identities from the removed scenario, rather than merely reducing reported case count.
   - Expected reduction: about 40 lines and one serialized SQLite fixture/reconciliation scenario. Keep completion timestamps, deletion, recent-open metadata, independent linear matcher oracle, adversarial duplicate/tie cases, and opt-in performance measurement unchanged.
3. Reuse the existing panic-safe `TestVault` in exactly these routine, single-runtime timeline scenarios, replacing their repeated environment lock/data directory/notes override/scaffold/disabled AppState blocks and explicit end-of-test override reset. Keep assertions and fault injection intact:
   - publication.rs: `history_preparation_failure_publishes_nothing`; `publication_preparation_verifies_targets_without_whole_vault_attestation`; `a_second_preparation_cannot_abandon_an_in_flight_intent`; `finalization_uses_the_exact_prepared_intent_identity`; `finalization_rejects_matching_authored_content_under_another_note_identity`; `finalization_abandons_publication_without_a_managed_note_identity`; `unreadable_authoritative_markdown_never_finalizes_from_fallback_memory`; `every_app_owned_mutation_source_is_retained_by_the_same_contract`.
   - history_mode.rs: `history_mode_pages_records_with_a_stable_cursor_and_reconstructs_the_selected_revision`; `revision_context_corruption_after_attestation_latches_publication_gate`; `revision_context_seeks_and_pages_explicit_lineage_with_scoped_stale_cursors`; `version_restore_can_replace_current_authored_content_with_empty_content`; `version_restore_preserves_exact_historical_frontmatter_and_line_endings`.
   - Expected reduction: approximately 130 setup/cleanup lines across 13 callers; same number of databases and behavioral scenarios. Removes repeated process-global cleanup conventions and makes worker shutdown uniformly owned by the existing fixture. Do not convert restart, raw pre-start damaged-file, copied-root, or multiple-runtime tests: their explicit ordering is behavior under test. This is reuse with fewer caller instructions, not a new abstraction/file move.
4. Narrow two Rust fitness tests that duplicate executable TypeScript behavior while retaining architectural ownership prohibitions:
   - `dirty_document_task_prepare_contract_is_registered_and_fixture_backed`: keep backend command registration and the prohibition on generic `saveSource`; remove JSON key-set rechecks and exact frontend attribution/private-expression substrings. The executable owners are `src/lib/contracts/ipcFixtures.test.ts` (“pins dirty-document task prepare argument and result names”), `openDocumentTaskMutation.test.ts` (“prepares, applies, and saves a dirty document without writing behind it”), and `persistenceController.test.ts` (“keeps task attribution on the exact revision when an editor save is already queued”). Coordinate these retained owners with agents 01/02 before editing.
   - `explicit_restart_has_one_joining_frontend_action_and_one_backend_owner`: remove exact frontend method-body strings and textual save/prepare/relaunch ordering; executable owner is `src/lib/app/restartLifecycle.test.ts`. Keep settings prohibition on direct relaunch, backend lifecycle owner/join ordering, off-thread command admission, and app exit ownership.
   - Expected reduction: about 55–65 lines; no loss of negative architecture boundaries. Keep parsed Rust module-tree/cfg(test) scanner, command off-thread coverage, canonical writer ownership, and chat runtime seam rules.

## Explicitly retained / rejected reductions

- Do not collapse distinct rollback/restart/provenance contracts into giant scenarios. No deletion from provenance, current-content delivery, editing-window token validation, administration rollback, or cross-kind catalog tests. Catalog's five tests own distinct routing, duplicate ownership, concurrency, retry, and watermark behavior.
- Keep the real task mutation sink tests and literal transform oracle. Their side-effect ordering, warning semantics, and nonwriting preparation are not superseded by task projection matching.
- Keep long-chain reconstruction (140 revisions crosses the production 128 replay threshold), bounded terminal receipt test (80 writes crosses 64), and retained-publication byte regression (large body plus settled intents demonstrates no retained authored copies). Small arbitrary fixture shrinking would have little maintenance benefit and risks weakening threshold/space protection.
- No shared helper changes. No new helper types, production configuration options, or exported interfaces.

## Verification and review gate

Coordinator must approve this proposal before source edits. Then compile once, run targeted publication/history-mode/task-projection filters and Rust architecture fitness, verify no dead helper warnings, and compare owned file lines and case count with the saved snapshot. Expected total reduction is approximately 400–450 maintained lines and four redundant tests; runtime improvement is principally one SQLite scenario removed, not a promised speed multiplier. Record actual counts rather than using estimate as quota. Check source mapping, both task identities, rollback/restart/provenance retention explicitly in final review.

## Implementation and validation

Implemented the approved four deletions, existing-fixture reuse, and narrowed structural guards. Removed seven test-only methods: two synthetic header constructors, two synthetic mutation constructors, two mutation getters, and the now-unused lifecycle payload-version getter. Retained `VaultObservation::source`: compilation identified its real watcher reconciliation test caller. No shared support or runtime code changed. The retained durable source test now exercises the typed mutation constructors. Reorder/move coverage now asserts all three task identities.

Actual current-snapshot deltas:

| File | Before LOC | After LOC | Net LOC | Test delta |
| --- | ---: | ---: | ---: | ---: |
| `src-tauri/src/services/note_timeline/domain.rs` | 1890 | 1803 | -87 | 0 |
| `src-tauri/src/services/note_timeline/tests/publication.rs` | 1766 | 1577 | -189 | -3 |
| `src-tauri/src/services/note_timeline/tests/history_mode.rs` | 913 | 863 | -50 | 0 |
| `src-tauri/src/state/task_projection.rs` | 1149 | 1108 | -41 | -1 |
| `src-tauri/tests/architecture_fitness.rs` | 1187 | 1119 | -68 | 0 |

Total: **-435 lines, -4 tests**. Test-bearing files account for -348 lines; domain test-only helpers account for -87. Thirteen duplicated fixture sequences are gone, seven synthetic helper methods are gone, and no new helper/concept replaces them. Setup resource count stays unchanged except one removed SQL reorder scenario. No runtime-speed improvement claim.

Checks: combined offline lib/architecture compilation passed. Focused lib filter covering every converted caller, real source persistence, restart reconstruction, persisted-vocabulary corruption, and all task projection tests: **20 passed, 1 existing opt-in measurement ignored**, 2.96 seconds. Rust architecture fitness: **23 passed**, 3.55 seconds. Final compile emits no newly introduced warnings; removed unused JSON import after narrowing the fixture-source assertion. Threshold, provenance, administration rollback/restart, task mutation literal oracle, and all five catalog tests remain unchanged. No full suite or native run started by this owner.

Independent review by owner 05 confirmed typed source routing, both reordered task identities, and cfg(test)-only helper deletion. Its inventory check caught two caller conversions accidentally restored during formatting cleanup; both were reapplied and recompiled without warnings, with the two focused tests passing (0.24 seconds). Final actual conversion inventory is eight publication callers plus five history-mode callers. Incidental Rust support-module formatting was reverted to the snapshot; support remains unchanged. Final owned source is stable.
