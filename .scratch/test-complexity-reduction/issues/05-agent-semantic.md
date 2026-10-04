# 05 — Reduce Rust agent, evidence, proposal and semantic test machinery

Status: ready-for-agent
Progress: Complete; implemented, reviewed, and accepted after combined validation. See ../validation.md.
Owner: audit_agent
Baseline: current-tree snapshot recorded in ../baseline.json, not Git HEAD.

## Proposed implementation

| Change | Exact existing surface | Retained behavior owner and transfer | Maintenance reduction / expected net LOC |
| --- | --- | --- | --- |
| Delete synthetic multi-tool transcript | `agent_runtime.rs::tests::composed_tools_return_to_the_model_until_it_finishes_the_objective` (1066–1182) | `agent_tools/tests.rs::production_streaming_runner_dispatches_actual_working_read_and_proposal_tools` already exercises the production driver, real read and rewrite tools, three provider turns, output and durable proposal. Add the final-request history assertion there for actual note/proposal identities. Other runtime tests retain permission, guard, formatter and measurement contracts. | Removes five DynamicTool closures, canned fake outputs, separate recorded-call mutex, six-turn synthetic scenario and direct RuntimeHarness construction. About 105–110 test LOC net. |
| Delete helper-only blocking smoke | `agent_tools/tests.rs::blocking_tool_work_does_not_run_on_async_worker` (3–16) | `working_read_yields_the_current_thread_executor_while_its_index_is_locked` proves actual read dispatch releases the single async executor while a real mutex is held. | Removes direct helper test and unrelated reqwest client lifecycle as dispatch oracle: 15 LOC. |
| Fold attachment roundtrip assertions into existing admission contract | `chat/tests.rs::attachments_persist_with_their_user_message` (1421–1455) | `chat/tests/lifecycle.rs::acceptance_rolls_back_every_record_when_attachment_or_context_storage_fails` already verifies successful readback after both rollback cases. Assert attachment name and exact base64 there. Retry, branch, atomic finalization, FK and projection-failure tests unchanged. | Removes separate SQLite/ChatService fixture, duplicated ChatRequest/attachment setup: approximately 32 LOC net. |
| Remove obsolete comparison benchmark and test-only old writer | `chat/tests/lifecycle.rs::measure_streaming_write_amplification` (ignored, 219–262); `chat.rs::update_streaming_content` (cfg(test), 1522–1532), its only caller | Real `terminal_source_failure_rolls_back_run_and_message_and_remains_recoverable` uses current checkpoint and verifies exact durable partial content across failure/reopen; lifecycle retry tests retain final writes. Historical performance measurements remain in audit-remediation measurements, with reproduction context. This is removal of an obsolete alternate implementation, not moving a required test elsewhere. | Removes old writer method and the maintained dual-path timing experiment: approximately 60 test/support LOC. Normal executed-case count unaffected by benchmark deletion. |
| Fold exact prepared-byte assertion into real prepare→commit contract | `proposals.rs::prepared_review_publishes_exact_canonical_bytes` (1100–1115) | `commit_review_preserves_existing_path_and_frontmatter` obtains real prepared publication then commits it; add `saved == prepared.canonical_markdown()` alongside path/frontmatter assertions. Conflict/no-overwrite, occurrence ambiguity/Unicode and hunk fallback remain separate. | Removes another app-data setup and fabricated prepared-publication fixture: approximately 15 LOC net. |
| Fold manifest file assertions into actual restart query contract | `semantic/ann.rs::snapshot_persists_as_manifest_referenced_generation` (892–913) | `initialize_loads_matching_persisted_ann_snapshot` already builds/persists/reopens/queries. Retain schema version and all three referenced-file existence assertions before reopening. Keep failed rebuild, partial generation and SQLite delta tests separate. | Removes repeated semantic SQLite/chunk/debug/index/rebuild fixture: approximately 13 LOC net. Does not merge chunk ANN with note ANN. |
| Use existing lifetime-safe vault setup for three evidence fixtures | `services/evidence/tests.rs` setups at 6–17, 328–339, 391–402 | Same tests and assertions remain; replace manual env lock, two roots, global override and AppState construction with existing `TestVault`, keeping an explicit borrowed state and existing notes access. No new helper or shared fixture change. | Removes three copies of teardown/setup knowledge; approximately 30 LOC net. |

Expected approved core reduction: approximately 270 test/support LOC, five ordinary test cases and one ignored benchmark; no new test cases, fixture abstractions, or file moves. Exact measurements will be against the saved baseline after verification, and test/support LOC will be separated from production.

## Narrow production interface proposal requiring cross-owner agreement

`services/retrieval.rs::VaultRetrievalItem` carries five optional fields (`lexical_score`, `semantic_score`, `start_line`, `end_line`, `block_anchor`) whose sole production constructor always supplies None. Only test fixtures manufacture Some values. Remove these five fields and their constructor boilerplate; keep serialized command response shapes unchanged by explicitly supplying None in `commands/chat_commands.rs` and the query branch of `commands/search_commands.rs` (roughly lines 965–979). The latter's source-selection condition is currently invariant: both scores None always select `lexical`; preserve that literal current behavior, do not relabel results. This removes an impossible-state input burden and dead branch; does not change evidence ranking or IPC schema. Estimated production/support net reduction ~20 LOC. Root owns search_commands, so it must approve/coordinate this region. If approved, verify command context weighting and actual picker tests in addition to compiler checks.

## Candidate rejected pending evidence

`services/retrieval.rs::retrieval_scope_and_clear_invalidation_are_applied_at_delivery` directly invokes generic current_content.read, not the retrieval adapter, using 75+ lines of manual fixture/thread setup. It overlaps timeline invalidation contracts and actual picker exclusion coverage, but clear-during-read is a distinct destructive operation from forget/purge. Requested timeline owner confirmation of a retained clear-during-read oracle. Timeline owner confirmed no exact retained generic clear-during-read owner. Retain the race and simplify its fixture only with existing TestVault (approximately 12 LOC saved), keeping the thread handshake and exclusion assertions.

## Intentionally retained boundaries

- Chat raw SQL seeds represent invalid/recovery legacy states that real admission cannot create; replacing them with a generic configurable fixture would enlarge the interface. No seed-helper parameter matrix proposed.
- New real repeated-retry and branch lineage, missing context failure-closed, transactional rollback, restart recovery, permission refresh and actual provider fault/timeout tests remain.
- Evidence capacity/cursor continuation, inventory reuse, current-file revalidation, dense response-byte budgeting, independent clocks and allowed-scope hybrid widening tests remain. Budget sweeps test non-monotonic serialized overhead boundaries; reducing points just to change runtime would weaken them.
- Chunk ANN and note ANN persistence policies and adapters are distinct; matching scenario names do not establish redundant coverage. Atlas geometry, publication/query contracts, retrieval-versus-Atlas norm floors and nonfinite numerical cases remain.
- Research lease contention test remains separate from sequential worker fault cleanup; real orchestration tests do not prove concurrent admission.
- Date filter helper test checks independent created/updated timestamps; real picker dates currently only check extreme include/exclude bounds, so helper is not redundant.

## Verification and measurement

Coordinator review before edits. After approval: focused Rust lib filters `agent_runtime::`, `agent_tools::`, `chat::`, `proposals::`, `services::evidence::`, `services::retrieval::`, `semantic::ann::`, plus affected command tests if the interface proposal is approved. Coordinate compilation with owner04. Record exact baseline file delta, removed ordinary/ignored cases, and preserved assertions. No full suite campaign or new broad abstraction. Independent deletion review must check the transferred history, attachment, prepared-byte and manifest assertions.

## Implementation and verification

Approved by coordinator before edits; completed all seven core changes, the retrieval internal-field narrowing, and retained clear-during-read fixture simplification. No new helper, interface, test case or file split was introduced. Removed five ordinary tests and the ignored obsolete benchmark. The old cfg(test) streaming writer is gone; its recorded historical experiment remains documentation only.

Exact snapshot comparison: **284 net lines removed across 11 existing files: 267 test/support, 17 production**. The final two history assertions were line-wrapped after verification, with no semantic change. Per-file counts are in `../05-measurements.json`; exact review patch is `../05-baseline.diff`. Standalone test-file count is unchanged; inline test/support reductions are included rather than omitted from accounting.

`cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` passed without warnings (19.80 seconds). Focused existing-binary filters for runtime/tools/chat/proposals/evidence/retrieval/chunk ANN and the two command adapters: **182 passed, 3 ignored** in 6.66 seconds; one unchanged local HTTP capacity-probe test hit sandbox bind EPERM. The exact capacity-probe test then passed with approved local socket access (0.03 seconds). Logs: `../rust-05-compile.log`, `../rust-05-focused.log`, `../rust-05-socket.log`. No runtime speedup claim: there is no controlled pre-change execution timing for these combined filters.

Preservation checks passed: actual model history contains actual note/proposal identity, admitted attachment filename/base64 match input, real prepared publication bytes exactly match committed file, all manifest-referenced artifacts exist before actual restart/query. Numerical policy and geometry tests were not changed. Real retry/branch/rollback/permission/provider-fault tests all remain. Coordinator owns final combined checks and independent deletion review.

Progress: Implemented and focused verification passed; awaiting coordinator's final independent review/combined gates.
