# Bounded second pass: Rust architecture and helper tests

Status: ready-for-agent
Progress: audit complete; no further deletion recommended

## Decision

**No additional whole test layer or meaningful maintenance reduction is justified by this pass.** Recommended deletions: **0 cases / 0 files / 0 lines**. No source edits, Cargo commands, tests, or mutation experiments were performed.

I read the prior `03-timeline-audit.md` and `04-backend-audit.md` first and treated their explicit retention decisions as constraints. This pass concerns the current remaining source after that reduction, not the original Git HEAD. It does not reopen the retained fault, privacy, persistence, identity, prompt-policy, numerical-policy or adapter-specific ANN matrices to reach a quota.

## Remaining architecture layer

Read all of `src-tauri/tests/architecture_fitness.rs` and the scanner support implementation/tests. The previous pass already removed approximately a layer's worth of positive implementation pinning. The remaining tests principally forbid bypasses or require admission at each relevant entrypoint:

- `current_content_consumers_cross_one_timeline_owned_read_interface` checks each retrieval/search/task/Atlas command's gate participation. One successful retrieval or one clear-during-read test cannot establish this for every other command.
- `ordinary_note_writers_use_typed_note_timeline_mutations`, `note_identity_continuity_stays_inside_the_timeline_and_catalog_boundary`, and `app_state_holds_one_encapsulated_note_timeline_runtime` forbid distinct caller-owned write/protocol/state paths. Their overlapping vocabulary does not make their checked scopes or forbidden operations equivalent.
- `ordinary_chat_history_is_on_demand_and_cannot_mint_history_mode_access` enforces role and eager-history exclusions. Current evidence behavior cannot prove the absence of another prohibited caller.
- `interactive_history_waits_run_offthread_and_readiness_stays_observational` and `explicit_restart_has_one_joining_frontend_action_and_one_backend_owner` retain entrypoint participation and shutdown order that are not exhaustively covered by one runtime fixture.
- `coordinator_is_the_only_production_chat_handoff_to_the_runtime` guards a whole production module tree against direct runtime invocation. Coordinator success tests alone are not a substitute.
- Registration/error-contract/storage-format/privacy checks and all three parser-support tests were deliberately retained in the first audit. Their small size is not new evidence that the layer is unnecessary.

There are a few repeated banned tokens, such as legacy mutation names checked both locally and repository-wide. Removing individual duplicate string entries might save a handful of lines, but would not remove a test, source scanner, helper, setup path or conceptual layer. I do not recommend a separate cleanup tranche for that negligible gain.

## Concrete overlap probes and decisions

All paths below begin `src-tauri/src/`. These are **retained decisions**, not deletion proposals.

| Candidate examined | Potential surviving owner compared | Why not delete |
|---|---|---|
| `semantic/related.rs::truncate_related_query_caps_long_text` | `build_note_query_text_includes_title_and_truncates` | Both check the bound, but only the direct helper case asserts the truncation ellipsis. The composed case additionally pins title inclusion. Removing the helper case would intentionally lose a distinct result requirement for a six-line saving. |
| `semantic/related.rs::truncate_related_query_keeps_short_text` | The same query-builder case | The builder fixture is long input only; it does not assert whitespace trimming or unchanged short text. No exact surviving behavior owner found. |
| `semantic/ann.rs::defaults_to_warming_state_before_initialize_runs` | `initialize_loads_matching_persisted_ann_snapshot` and note ANN load cases | The initial test actually searches before initialization and requires a safe empty result plus warming/rebuild state. Loaded-state tests do not exercise that startup interval. It is not just a constructor getter echo. |
| `semantic/atlas/publication_tests.rs::label_artifact_complete_defaults_true_for_legacy_payloads` | Current publication/load and label pointer compatibility cases | It distinguishes absent legacy `complete` from explicit current `false`; successful current-artifact publication does not verify legacy serde defaulting. Explicit first-pass retention remains justified. |
| `chat/tests.rs::streaming_events_match_contract_fixture` | TypeScript API/controller stream tests | This executes Rust serialization for six event shapes. Frontend tests consume their shapes; they cannot detect a Rust serde rename/omission on their own. It remains one side of the cross-language contract rather than a duplicate copy of controller behavior. |
| `commands.rs::command_payload_json_contracts_remain_stable` | Frontend IPC fixtures and task/open-note behavioral tests | Rust serialization pins note/task/recent-task/link field names and optional-field absence, including fields not asserted by behavioral outcomes. The prior audit explicitly retains this boundary. |
| `chat/tests.rs::terminal_reasons_are_stable_product_values` | Runtime terminal/failure integration | It tests the conversion from error causes to three stable product values. Merely proving a request terminates or reports an error does not assert those mappings. No exact replacement found. |
| `chat/tests.rs::reasoning_effort_rejects_values_outside_the_supported_contract` | Configured conversation and model capability persistence cases | Valid-value persistence does not assert invalid-input rejection or trimming. Small test, distinct admission requirement. |
| `chat/tests.rs::model_title_refinement_is_hosted_only` | Automatic-title normalization and startup title backfill | The local-provider exclusion is a separate policy; lexical normalization and stored-title migration cannot replace it. No substantial fixture/setup cost to remove. |
| `commands/chat_commands.rs::openai_attachment_support_is_conservative_for_unknown_models` | `capability_validation_rejects_images_for_text_only_models` | The latter supplies capabilities directly; it does not execute model-name lookup or the unknown-model conservative default. |
| `commands/chat_commands.rs::committed_conversion_survives_projection_follow_up_failure` | Ordinary projection conversion success | This explicitly preserves the already committed destination after follow-up projection failure. It is a post-commit honesty contract, not arbitrary tuple serialization. |
| `commands/search_commands/helper_tests.rs::merge_hybrid_candidates_applies_labels_scores_and_limit` | Real search command delivery and kind-admission regressions | It independently asserts normalized lexical/semantic scores and user reason labels. Gate/candidate-admission tests address different errors; the broad fixture is not interchangeable. |
| `commands/wikilink_commands/helper_tests.rs` parser, target and path cases | Frontend wikilink/navigation tests | Backend alias/same-note parsing, paragraph-vs-heading fallback, stable block ID, and slash/backslash relative path matching are separate from frontend rendering/opening. No duplicate backend owner found. |

Other small probes retained: related full-file-vs-editor-body hash (actual disk comparison), semantic configuration parser bounds/defaults, HTTP client release from async context, diagnostic metric accumulation/disabled sampling and platform RSS probe, and Atlas pointer compatibility dimensions. The HTTP drop test's no-panic assertion is meaningful for a previously unsafe destructor boundary; it is not equivalent to an empty smoke test.

## Scope and confidence

Fully read remaining architecture file and scanner support; related-query helpers/tests and call chain; command search/wikilink helper tests; chat command helper tests; Rust event/payload serialization cases; sampled small chat configuration/title/attachment/terminal cases with their nearby implementations and sibling tests; ANN startup case, configuration parser and Atlas publication/compatibility/legacy defaults. Inventoried test identities across the semantic directory and main chat tests to select those probes.

Did **not** reread every durable chat, Atlas geometry, semantic scheduler, ANN adapter or command fixture end to end. Those larger areas have explicit previous retention findings; a bounded second pass supplies no new basis to overturn them. No run-time saving is claimed without measurements, and no deliberately discarded trivia is proposed in this pass. The useful next step is to keep the completed first-pass reduction, rather than manufacture another layer deletion or add replacement machinery to enable tiny cuts.
