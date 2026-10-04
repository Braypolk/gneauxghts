# Accumulated backend review

Progress: Complete — no actionable finding in the reviewed backend scope. Execution and integration acceptance remain with the coordinator.

## Baseline and authority

Reviewed the current working tree against `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`, using `git diff cb4d4c02 -- src-tauri/...`, current callers, and the separately enumerated untracked Rust sources. This is not a review only of the last performance changes or a reliance on previous phase acceptance. The Open File Location commit on local main (`04f13b35a253974c01070a7502c940e20332b165`) is outside this working-tree comparison; the coordinator owns its disposable-checkout integration.

Applied the repository AGENTS instructions, `.agents/skills/code-review/SKILL.md`, `ARCHITECTURE.md`, the relevant behavior invariants, ADR 0001 (app-owned runtime), ADR 0006 (mandatory history preparation), and the audit-remediation, architecture-simplification, and pre-merge-validation specs. All twelve Standards smell prompts were used as judgments, not quotas. No source edits, builds, tests, or mutations were performed for this review.

## Findings

- **Correctness/Spec:** No confirmed actionable finding.
- **Standards:** No concrete documented-standard violation or newly introduced maintenance-cost smell requiring correction found in the reviewed scope. In particular, the private storage/publication/query boundaries retain their existing owners; the selected semantic job removes deferred replay rather than adding a general scheduling framework; and the test host/provider seams still exercise production dispatch and policy.

The absence of findings is not a claim that the full suite, live providers, other platforms, or the clean checkout passed. Those results must come from the coordinator's current validation.

## Reviewed paths and integrated contracts

| Area | Inspection and retained contract |
| --- | --- |
| Chat service, new `chat/admission.rs`, `chat/store.rs`, `chat/runtime.rs`, `chat/projection.rs`, recovery | Traced request admission through the immediate SQLite transaction, attachment/context insertion, best-effort projection after commit, partial streaming writes, transactional terminal message/source/run updates, failure recovery, and terminal event ordering. Durable acceptance does not become send rejection because projection failed. `store` enables foreign keys on each connection. |
| Retry and checkpoint branches | Traced command selection into `retry_user_message_id`, durable original-user/context resolution, admission pair validation, and branch old-to-new user/assistant/retry mapping. Repeated retry after a newer turn cannot select the nearest unrelated user. Missing durable retry lineage fails explicitly. Selected-context and attachment associations remain tied to the accepted user/run. |
| Settings and chat commands | Verified separate defaults and Atlas-visibility persistence, their command registration, shared model-catalog consumption, and provider/reasoning validation. The catalog JSON is a required newly added build input. Conversation-specific overrides remain separate from defaults. |
| Agent runtime, permissions, tools and research | Reviewed the app-owned runtime/measurement seam, real `ToolHost` dispatch, blocking tool execution, research-worker context construction, shared versus isolated policy/evidence state, cancellation and final currentness checks. Permission ownership and runtime budgets remain outside the deterministic provider test seam. |
| Semantic queue and query integration | Reviewed selected-category claims and priority, direct job outcomes, snapshot/edge follow-up, failure requeue, newer mutation/request precedence, per-key Atlas retry behavior, building-marker cleanup, interruptible deadlines, and restart admission. Query kind/scope filtering occurs before bounded result selection, avoiding filtered results consuming all slots. |
| Atlas extracted production files | Included untracked `semantic/atlas/{geometry,publication,query}.rs`. Compared all 99 moved function definitions against baseline, normalizing whitespace and the intentional cosine name. Investigated the remaining differences: formatting, equivalent schema qualification, and the shared cosine call. No removed algorithm branch or publication-pointer ordering change found. Current public owner/state remains `ActiveSemanticState`/`AtlasWorkerContext`; disk publication and query responsibilities are private. Geometry was reviewed by extraction comparison and selected call paths, not a fresh mathematical rederivation of Leiden/UMAP. |
| Numeric policy, embedding and runtime installer | Checked shared finite-f64 cosine arithmetic with separate retrieval and Atlas small-norm policies, pure environment-value parsing seams, pinned runtime validation, and bounded executable probing with child cleanup. Ordinary embedding still does not install a runtime. ANN, chunking, semantic DB, labels and note-ANN production bodies were compared and found unchanged; their accumulated changes are test-focused. |
| Search, retrieval, lexical and Unicode helpers | Traced cache-hit delivery through the existing current-content boundary, title/body-aware cache fingerprints, ordinary-note admission before top-k, semantic scope filtering, inventory continuation and result mapping, explicit serialized optional fields, original-string highlight offsets after lowercase expansion, and strict UTC timestamp parsing. Evidence/NoteTimeline internals are owned by the other reviewer. |
| State and persistence | Reviewed per-connection schema initialization, task-projection bootstrap placement, the indexed matching priority against the retained linear behavior, typed exclusive-create errors and existing temporary-file/hard-link publication path, and running-vault ownership at consumers. No schema-version bypass or new direct ordinary-note writer found in this scope. |
| Proposal commands and helpers | Traced durable proposal intent, complete timeline edit/create calls, current-base comparison under timeline ownership, occupied-create conflict mapping, committed warning propagation and status recovery. Private timeline publication internals are excluded here. |
| Assets, path utilities and other commands | Checked `create_new` retry and failed-write cleanup, MIME/path mappings, and removal of the ignored interactive-index age argument at callers. Explicitly checked the apparent dangling-symlink collision concern: `unique_path_in_dir` uses `symlink_metadata`, so an occupied dangling leaf advances the suffix instead of repeating it. |
| App lifecycle, background queue, watcher | Reviewed restart-attempt completion/drop notification, reversible versus terminal shutdown order, and watcher installation gate. Background queue additions are bounded test observation state; watcher production behavior is unchanged. |
| Untracked tests and support | Included the new chat lifecycle tests, real agent-tool tests, command helper-test modules, Atlas private test modules and semantic test support. Inspected transaction-failure, real dispatch, repeated retry/branch, queue newer-wins/panic and shared-fixture lifetime cases. `TestVault` joins projection work before temporary paths/guard cleanup; process-global configuration and fault hooks restore during unwind. |

## Retained evidence owners checked in current source

- `chat/tests/lifecycle.rs`: admission rollback on attachment/context failure, terminal-source rollback and recoverability, accepted admission despite projection failure, repeated retry/branch lineage, missing-run refusal.
- `agent_tools/tests.rs`: current complete-read and permission checks, actual streaming tool dispatch, blocking read yields the runtime executor.
- `semantic/indexer.rs` private tests: scan retains newer recall, failed labels retain newer requests, move/delete retry ordering, newer rebuild supersession, Atlas marker cleanup after panic, queue deadline shutdown and new-work wakeups.
- `chat/tests.rs`: restart quiescence, durable partial/retry context recovery, citation/attachment/branch persistence and independent defaults/visibility writes.

These are source-inspected coverage owners, not test executions by this reviewer. Not every unchanged numerical fixture or removed redundant test assertion was independently re-executed or line-by-line re-audited; the dedicated harness review and coordinator's complete ordinary suite provide that complementary check.

## Limits and independence

NoteTimeline/evidence storage, history fixture archives/generators and their internal portability/reconstruction contracts are assigned to the timeline/harness reviewers; this review follows their public seams only. Frontend ownership and E2E harness behavior are outside this report. No remote CI, live provider, Windows/Linux, or native execution claim is made.

This reviewer authored portions of earlier chat/runtime and semantic scheduler work. This pass reread the current integrated code against the original baseline, but those portions are not independent of their author. The coordinator should retain its independent scheduler inspection and other reviewers' chat transaction/lineage assessment alongside this report rather than represent this document as the sole independent acceptance of those changes.
