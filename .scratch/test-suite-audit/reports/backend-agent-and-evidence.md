# Backend chat, agent, proposal, and evidence audit

Status: needs-triage
Baseline: `cb4d4c02f0e2c1220d37b281ee300eff1aabf20b`
Audit scope: current implementation and tests, not a changeset review.
Audit date: 2026-10-02 (America/Denver).
Implementation status: audit only; no production or test files changed by this auditor.

## Assessment

This area needs consolidation around production boundaries more than indiscriminate test deletion. The most valuable existing tests exercise real SQLite/filesystem recovery, production streaming with a fake completion model, exact source validation, and context limits. Keep those. The largest gaps are actual chat request admission/finalization and actual tool orchestration: their helpers are tested heavily while the coordinating paths remain coupled to `AppHandle` and static runtime construction.

There are concrete deletion opportunities: three unused unprepared proposal writers, two redundant startup-recovery tests, and a live evaluation harness that implements a second, already-diverged agent loop. Larger changes should deepen the existing ChatService and evidence owners rather than invent parallel ownership. The search continuation cap has a concrete control-flow defect requiring a regression test.

Sources read: `CONTEXT.md`; `ARCHITECTURE.md` (especially Agent runtime and Proposals); `docs/architecture/behavior-invariants.md` Chat/Proposals; ADRs 0001, 0003, 0009; repository issue/triage/domain instructions; `.agents/skills/code-review/SKILL.md` and `codebase-design/SKILL.md`. Findings below distinguish reproducible control-flow facts from design judgments. No provider calls or test suites were run; root owns runtime validation.

## Inventory and coverage ledger

Counts are literal `#[test]` / `#[tokio::test]` declarations, not runtime-expanded cases. Scope totals **20,202 lines, 158 tests, 6 explicitly ignored provider evaluations**.

| Module | Rust lines | Tests | Ignored | Inspection |
| --- | ---: | ---: | ---: | --- |
| `src-tauri/src/chat.rs` | 7,538 | 56 | 0 | All test bodies; production request/run admission and completion, source persistence, recovery, proposals, context assembly/compaction and projection call paths inspected. Settings/migration boilerplate, branch copying, attachment conversion and row loaders sampled. |
| `chat/citations.rs` | 336 | 9 | 0 | Full production/tests |
| `chat/date_time.rs` | 105 | 3 | 0 | Full production/tests |
| `chat/recovery.rs` | 660 | 7 | 0 | Full production/tests |
| `chat/grounding_evaluation.rs` | 122 | 1 | 1 | Full harness; fixture prose not exhaustively graded |
| `agent_runtime.rs` | 1,808 | 13 | 0 | Full production/tests |
| `agent_runtime/context_measurement.rs` | 661 | 7 | 1 | Full production/tests |
| `agent_runtime/usage_context.rs` | 477 | 7 | 0 | Full production/tests |
| `agent_runtime/usage_context_live.rs` | 118 | 1 | 1 | Full harness |
| `agent_guardrails.rs` | 262 | 5 | 0 | Full production/tests |
| `agent_tools.rs` | 1,371 | 3 | 0 | All behavior bodies/tests; edit JSON-schema field boilerplate sampled |
| `agent_tools/capabilities.rs` | 83 | 1 | 0 | Full production/tests |
| `agent_tools/current_history.rs` | 91 | 0 | 0 | Full production; exercised elsewhere |
| `agent_tools/evidence.rs` | 559 | 3 | 0 | Full production/tests |
| `agent_tools/feedback.rs` | 131 | 1 | 0 | Full production/tests |
| `agent_tools/research.rs` | 899 | 10 | 0 | Full production/tests |
| `proposals.rs` | 1,214 | 12 | 0 | Full production/tests; production command callers traced |
| `services/evidence.rs` | 1,440 | 0 | 0 | Full production; child tests counted separately |
| `services/evidence/tests.rs` | 582 | 9 | 0 | Full tests/evaluation helper |
| `services/evidence/reads.rs` | 438 | 0 | 0 | Full production; external tests sampled |
| `services/evidence/inventory.rs` | 371 | 1 | 0 | Full production/tests |
| `services/evidence/query.rs` | 237 | 4 | 0 | Full production/tests |
| `services/evidence/live_evaluation.rs` | 427 | 3 | 3 | Full harness |
| `services/retrieval.rs` | 272 | 2 | 0 | Full production/tests; command consumers located |

Outside assigned totals: inspected selected tests in `services/note_timeline/editing_window_capture/tests/query_inventory.rs` and `evidence_contracts.rs` to avoid falsely claiming absent coverage for read continuations/activity pages. Located `services/note_timeline/tests/publication.rs:302` retrieval integration and `commands/proposal_commands.rs:30` production proposal commit routing. These files have another audit owner; recommendations below must be reconciled with that report. Native UI/provider behavior and semantic model ranking quality were not measured.

## Chat persistence and transcript lifecycle

### CHAT-01 — Introduce a testable request admission/finalization boundary before shrinking chat tests

Priority: high. Type: confirmed failure-path exposure; proposed seam is design judgment.

`chat.rs:1903` `begin_request` validates a request, then performs separate autocommit inserts for the user and each attachment (`:2028` onward), title update, assistant insertion, conversation update, transcript publication (`:2114`), and only afterward creates the run/context (`:2123`). `create_agent_run_with_context` has its own transaction (`:3129`), so it does not include message admission. Any later database/projection failure can return an error after earlier messages have become durable. Repeating a send can therefore repeat the user message; a failed pre-run projection can leave a streaming assistant with no running task until startup recovery. This is visible in the call ordering; failure injection through this actual entry point is still required before implementing its recovery contract.

Existing `chat.rs:5150` and `:5215` seed helpers insert rows directly. `attachments_persist_with_their_user_message` (`:6598`) directly inserts both message and attachment and only tests loading. `retry_agent_run_keeps_interrupted_message_lineage_across_restart` (`:5703`) creates the retry run directly; it does not test the validation in `begin_request`. This is useful storage coverage but insufficient admission coverage.

Likewise `run_request` (`:2167`) repeats terminal persistence/event orchestration across three branches and discards errors from `finish_message`, `finish_agent_run`, metrics, compaction and projection. A successful UI completion does not prove the final content/sources were stored. The tests prove startup can reconcile seeded states; they do not prove the live writer leaves recoverable states under these failures.

Plan: keep the current SQLite recovery tests; extract private admission and terminal-outcome operations behind ChatService using concrete dependencies, with the Tauri shell supplying events and dispatch. One admission transaction should own user/attachments/assistant/run/context; explicitly define projection failure after durable admission. Replace direct-SQL happy-path fixtures for sends/retries with the production admission operation. Keep deliberate SQL corruption only in migration/recovery tests. Add focused trigger/sink-injected failure cases for attachment insert, run-context insert, projection publication and terminal source persistence; assert returned disposition, durable state, and restart convergence. Preserve ADR 0001 and ChatService ownership. Risk: high if combined with runtime replacement; stage separately.

### CHAT-02 — Consolidate duplicated startup recovery tests; retain distinct failure modes

Priority: medium. Type: demonstrated duplication.

`startup_preserves_partial_chat_output_and_interrupts_its_run` (`chat.rs:5319`) and `interrupted_chat_startup_recovery_is_idempotent` (`:5540`) are subsumed by `startup_reconciles_every_running_run_from_its_durable_assistant_status` (`:5604`): that matrix includes streaming content preservation, message/run cancellation, second restart and stable timestamps, plus complete/error/cancelled terminal messages. The first two create three extra ChatService initializations between them beyond their initial fixture setup, each doing migrations and transcript scans.

Plan: retain the four-status matrix and its exact content/idempotence assertions; remove the first two once each assertion has been checked against the retained matrix. Keep retry lineage/context, missing-data transcript recovery, and proposal status recovery separately: they cover different durable contracts. Do not collapse all recovery into one huge scenario.

### CHAT-03 — Remove avoidable disk/bootstrap work and unreliable timing from narrow tests

Priority: medium. Type: test design judgment with concrete examples.

`normalized_history_excludes_latest_user_and_provider_payloads` (`chat.rs:6142`) creates a real ChatService only to obtain a summary ID; the tested function takes a message slice. `composer_draft_slots_must_be_named` (`:7510`) bootstraps the whole chat database to exercise pure slot validation. `excerpt_requires_valid_utf8_boundaries_and_remember_is_explicit` (`:7289`) tests only ASCII `hello world`, never invalid UTF-8 boundaries despite its name.

`adding_a_message_to_an_existing_part_does_not_rewrite_conversation_index` (`:7223`) sleeps 25 ms and compares modification timestamps. This has an unconditional time floor and can falsely pass on coarse timestamp filesystems. The file already has `ChatProjectionSink` (`:642`) and an injected sink example (`:7152`); record publish attempts/results at that seam instead of sleeping. Retain one real-filesystem no-change publication test if needed for the sink itself.

Plan: use small message constructors for pure history tests; directly table-test slot normalization and retain one persistence round trip; add multibyte negative excerpt offsets/out-of-range/reversed cases at the existing service test. Replace the mtime/sleep oracle with a recording sink. Low risk, no production abstraction needed for the timing fix.

### CHAT-04 — Centralize SQLite connection policy and separate storage/projection internals

Priority: medium. Type: confirmed policy inconsistency; structural recommendation is judgment.

`ChatService::connection` (`chat.rs:719`) opens a new connection without pragmas. `initialize` enables foreign keys only on its own connection (`:727`), while archived deletion (`:4035`) and transcript import (`chat/recovery.rs:311`) explicitly enable them separately. `recovery.rs:547` even documents/compensates for the ordinary connection's missing cascades. Thus declarations such as `chat_messages.conversation_id ... ON DELETE CASCADE` are not enforced on most write connections. **Ordinary archived deletion does enable cascades; this audit does not claim it leaks rows.**

Plan: put connection configuration in one private factory, cover foreign-key enforcement and archival cascades with one real SQLite contract, and review legacy fixture insertion ordering before enabling enforcement everywhere. Split private migration/store/projection implementations out of the 7,538-line file while retaining the ChatService public seam. Moving files alone offers navigation benefit but not a testing speedup. Do not create a new external repository interface merely to mock SQL. Risk: existing invalid fixtures/legacy orphan rows may be exposed; include upgrade checks.

### CHAT-05 — Streaming rewrites the entire accumulated answer on each delta

Priority: medium. Type: static cost model; latency unmeasured.

`run_agent_response` event sink (`chat.rs:2480`) appends every delta, clones the entire accumulated string, and calls `update_streaming_content` (`:2675`), which opens a SQLite connection and writes the entire answer synchronously. For N similarly sized deltas this copies/writes approximately quadratic total bytes. These operations run from the runtime's synchronous event callback; none of the scope's tests exercises sustained streaming persistence.

Plan: first measure a deterministic long streaming response through a fake completion model and counting persistence sink, keeping partial-output durability explicit. Consider a bounded coalescing flush policy with a mandatory terminal flush, not a write per token. Cancellation/restart tests must specify maximum lost partial output before changing this invariant. This is a candidate rewrite of the private streaming journal, not a reason to remove durable chat tests.

## Evidence discovery, reads, and interactive retrieval

### EVIDENCE-01 — Existing cursors are rejected when search-session capacity is reached

Priority: high. Type: confirmed control-flow defect, not runtime reproduced in this audit.

`services/evidence.rs:349` rejects `self.searches.len() >= 32` before the cursor branch (`:376`). The 32nd new search is admitted while length is 31, inserts its result set, and can return `nextCursor`; the next call with that issued cursor fails with `work_budget` even though continuation allocates no new search. The byte allowance does not make this unreachable: perform 31 empty-result searches (page loops reserve no item bytes), then a two-result search with limit 1. Repetition limits can be avoided with distinct queries. No test in the inspected scope exercises capacity immediately below/at/above 32.

Plan: enforce new-search capacity only on fresh searches. Retain per-request scope/query and freshness validation for continuation. Add a compact boundary regression: seed 31 distinct empty searches, discover two matching passages on search 32, resume successfully, reject fresh search 33. Avoid creating 32 full vault fixtures. Apply the same distinction to `reads.rs:52` where the 128-handle check precedes read cursor resolution, while noting the default 96-tool-call guard makes that read limit less reachable in ordinary chat.

### EVIDENCE-02 — Inventory pagination repeats full reconstruction and retains unused intermediates

Priority: medium/high. Type: confirmed redundant work; runtime impact unmeasured.

`inventory.rs:125` removes its inventory cursor then calls `search_inner(..., true)` on **every page**, groups/clones all candidates again and rebuilds the whole signature. `search_inner` allocates a new `searches` entry (`evidence.rs:979`) each time. The model-facing `activity_page` immediately discards two members of inventory's triple return (`inventory.rs:76`), though `inventory` still builds full excerpt payloads and source vectors (`:283`). The old inventory contract also exposes `complete/gaps/budgets` independently of the newer model payload, which adds maintenance work when delivery semantics change.

Related test mismatch: `note_timeline/editing_window_capture/tests/query_inventory.rs:137` constructs a **fresh EvidenceSession inside every continuation-loop iteration**. It verifies the stateless signature but hides accumulated session work/memory and is not how the tools call it. `evidence_contracts.rs:494` does use one session for three pages, which should be retained.

Plan: make one private inventory continuation own the ordered note witnesses/signature, validate freshness on each resume, and page from that retained result. Remove the obsolete triple return only after moving its consumers/tests to the intended model-facing interface. Preserve the conservative inventory storage-proof bound and permission/revision revalidation. Compare same-session page count/work counters before/after; timing-only assertions are unnecessary. Risk: range/scope/provenance invalidation must remain authoritative.

### EVIDENCE-03 — Move evidence contract tests to the evidence owner and extract pure sizing/ranking work

Priority: medium. Type: test organization/performance judgment.

Evidence behavior tests are spread across `services/evidence/tests.rs`, `services/note_timeline/editing_window_capture/tests/evidence_contracts.rs`, and `query_inventory.rs`. This makes an evidence change look like a history-store change and encourages testing private timeline fixtures instead of a stable evidence seam. The main fixture (`evidence/tests.rs:5`) combines every query, pagination, regex/literal, repeated reads, history clearing and canonical edits in a ~170-line stateful scenario. A failure early prevents later independent guarantees from being checked.

The two read-budget tests (`:397`, `:460`) enumerate 49 and 116 allowance combinations respectively. Each iteration uses real `AppState`/timeline reads and citation validation while the assertion often concerns serialized envelope sizing. These are useful regression sweeps, **not evidence that they are currently slow**; no timings were collected.

Plan: retain a few end-to-end real-note fixtures for freshness/provenance/permission and move the evidence-owned contracts under evidence. Factor preparation from atomic budget/admission so the exhaustive size matrix uses prepared passage envelopes, then keep selected real-I/O boundary cases. Split the giant fixture by behavior using a shared fixture builder, but do not multiply expensive vault setup blindly. Keep the fixture evaluator out of ordinary test side effects: today `GNEAUX_EVAL_OUTPUT` causes the first normal test to execute/report an extra benchmark (`:39`, `:273`).

### EVIDENCE-04 — Reuse canonical note snapshots within an operation, with explicit freshness fences

Priority: medium. Type: demonstrated repeated work; proposed optimization requires measurements.

Lexical candidates load/parse the current note in `evidence.rs:773`, then `make_candidate_at` rereads/parses/hashes it per slice (`:1290`). Search completion validates every candidate again (`:945`); `validate_citation` reads at entry and once more at exit (`:1361` onward). Direct `read_request` reads the entire note once and then invokes `make_candidate_at` for every 2,400-byte body/property slice (`reads.rs:103`). A long note can therefore be reread and rehashed dozens/hundreds of times within one operation.

Plan: use a private operation-scoped canonical snapshot carrying parsed text/hash/identity, derive many candidate slices from it, and perform authoritative before-delivery validation. Preserve the architecture's prohibition on caching across freshness boundaries; do not collapse independent request/final-delivery checks. A counting reader or focused benchmark should establish fewer reads without losing a concurrent-edit rejection. Consider this after EVIDENCE-01/02; avoid a wholesale evidence-owner replacement.

### RETRIEVAL-01 — Adapter tests do not exercise the actual interactive adapter

Priority: medium. Type: confirmed coverage mismatch.

`services/retrieval.rs:199` constructs `VaultRetrievalItem` itself and directly invokes `NoteTimeline.current_content(...).read`; it never calls `retrieve_vault_notes`. It protects the timeline delivery gate, not the compatibility adapter's date filtering, 20-result clamp, evidence JSON mapping, duplicate-note handling or exclusion forwarding (`:89-163`). Production consumers exist at `commands/chat_commands.rs:716,955` and `commands/search_commands.rs:939`; another integration uses it at `note_timeline/tests/publication.rs:302`.

Plan: retain the race test under the timeline owner if not already duplicated there. Add a small adapter contract covering metadata date filters independently from activity ranges and stable note IDs/exclusions. Inventory whether callers actually consume `lexical_score`, `semantic_score`, line offsets and anchors: this adapter always fills those fields with `None`. Delete unused fields after checking all callers; do not silently delete fields carried by IPC. Risk: interactive ranking/result count expectations differ from evidence passages.

## Agent runtime, tools, and research orchestration

### AGENT-01 — Test real tool orchestration through an app-owned context seam

Priority: high. Type: coverage/design judgment backed by inspected call paths.

`AgentToolContext` (`agent_tools.rs:119`) combines AppHandle lookup, chat storage, proposal state, evidence sessions, permissions, event delivery, worker scope, cancellation and ~20 Arc/Mutex/atomic members. `research.rs:267` clones that context and manually replaces/reset selected fields (`:322-347`) to isolate a worker. New fields can accidentally inherit inappropriate state. Its ten tests exercise helpers (selection, scope, prompt, usage and lease), not `run_research`.

`agent_runtime.rs:985` uses DynamicTool fixtures named after application capabilities. This is a valuable engine sequencing test but not a test of the actual search/read/proposal bodies, which are replaced by predetermined JSON. The three `agent_tools.rs` tests check a blocking helper, read-coverage helper and truncation helper. No actual rewrite tool test proves a partial read denies a rewrite, pending proposal hash changes are handled, or current permissions are rechecked before staging.

Plan: keep production streaming engine tests. Introduce a small private operation context with concrete `AppState`/ChatService references and an event callback, supplied by the Tauri wrapper; use a test-injectable runtime at the already app-owned AgentRuntime seam to drive **real** tools. Give research worker creation one constructor that explicitly owns inherited immutable grants/budgets and fresh evidence/context state. Add end-to-end worker cases for timeout/cancellation, empty scope (no model call), unread selection, permissions revoked during work, and second invocation after a failed lease. Add rewrite admission/working-copy cases through actual tool dispatch. Reuse existing helper tests for edge tables; replace overlapping newly redundant checks rather than adding a second full suite. Risk: preserve ADR 0001, worker authority intersection, shared spending and independent context occupancy.

### AGENT-02 — Apply existing blocking dispatch consistently and test event-loop responsiveness

Priority: medium. Type: confirmed synchronous I/O placement; impact unmeasured.

Evidence tools correctly use `run_blocking_tool` (`agent_tools/evidence.rs:298,435`), but `GetActiveNoteTool`, `ReadNoteTool`, and proposal tools perform filesystem reads, SQLite work and proposal diff computation directly in async `call` bodies (`agent_tools.rs:715,775,909,1031,1142`). `research.rs:273-330` also resolves AppState/scope directly before inference. The blocking-helper test (`agent_tools.rs:1327`) proves only that the helper can construct/drop a blocking HTTP client; it does not assert that these tool implementations use it.

Plan: move actual filesystem/database/diff work for working-note/proposal tools through the same bounded blocking seam, keeping permissions/cancellation rechecked at the operation boundary. Add one deterministic current-thread executor test with a paused I/O fake/barrier and a second runnable task; avoid wall-clock performance assertions. This is a localized cleanup after AGENT-01; keep proposal serialization and emit events after committed staging.

### AGENT-03 — Retire the duplicate live protocol implementation

Priority: medium. Type: confirmed divergence.

`services/evidence/live_evaluation.rs:11` duplicates tool definitions and `:80` implements its own completion/tool/research loop, raw HTTP payloads, prompts, guard interaction, parsing and synthesis. It bypasses ModelTool feedback, the actual research worker, citation references, context measurement and structured output formatter. Its payload still nests reasoning effort under `chat_template_kwargs` (`:42`), while production `agent_runtime.rs:848` deliberately uses root `reasoning_effort` and documents why the nested field is ignored. Its read schema lacks note IDs/cursors/activity range. This harness's success cannot establish correctness of production research.

Plan: either archive the historical comparator as an explicitly versioned benchmark or rewrite it to call the production runtime/tools through AGENT-01's seam. Keep fixtures and result schemas for historical comparisons. Retain `chat/grounding_evaluation.rs` as a separately labeled fixed-evidence/manual-rubric evaluation; it intentionally tests synthesis quality, not retrieval. Keep live evaluations ignored and opt-in. None explains ordinary CI runtime because all six live tests are ignored by default.

### AGENT-04 — Consolidate test setup, not behavior coverage, for runtime finishing/permissions

Priority: low/medium. Type: maintenance judgment.

`agent_runtime.rs:1288,1360,1488,1610,1705` repeatedly assembles configured_builder, event sink, guard, cancellation, RuntimeEventHook and drive_agent. The tests cover genuinely different contracts (structured output retry, formatter collision, finish without actions, permission allow, permission deny) and should remain separate. A private RuntimeHarness can reduce boilerplate while invoking the same configured builder and streaming runner. Do not replace these with assertions on generated config alone.

The context-measurement opt-in test mutates `GNEAUXGHTS_CONTEXT_DIAGNOSTICS` (`:1102`) and removes it unconditionally, losing any prior user value and leaving it set if the run panics. Prefer explicit construction of configured diagnostics in the harness, or an RAII environment restoration guard. Retain one small configuration switch check if necessary. The live capacity probe test already uses injected `Instant` values (`context_measurement.rs:488`) rather than sleeping; preserve that pattern.

## Proposal preview and canonical commits

### PROPOSAL-01 — Delete unused unprepared commit APIs and their alternate writer tests

Priority: high cleanup. Type: confirmed unused production surface.

`proposals.rs:386` `commit_note_review`, `:510` `commit_note_creation`, and `:548` `commit_note_creation_at_path` are marked `#[cfg_attr(not(test), allow(dead_code))]`. Repository `rg` found **only test callers**. Production `commands/proposal_commands.rs:105` uses `commit_prepared_note_review` / `commit_prepared_note_creation_at_path` after NoteTimeline preparation. The unused wrappers prepare Markdown independently and preserve a second write route contrary to the intended single prepared-publication seam, though no live caller was found.

Tests still call them at `proposals.rs:1136,1164,1179` and `chat.rs:6767,6810,6853,6957`. `creation_commit_recalculates_a_unique_path_and_never_overwrites` tests a different policy (silently move to `Checklist 3.md`) from the durable proposal's fixed-target policy (collision becomes conflict, `chat.rs:6931`). Both can be internally correct, but only the latter is the current production proposal route.

Plan: remove all three unused functions. Keep canonical prepared update/create writer tests (exact bytes, conflict/no overwrite, path/frontmatter via real NoteTimeline preparation). For chat recovery tests, publish already-prepared canonical bytes or use the real proposal command fixture, according to whether the test is about status reconciliation or integrated publication. Delete the obsolete unique-path commit test; retain preview path suggestion behavior as a small separate test. Check architecture fitness and command-level warning tests before removal. Risk: low after whole-repo caller search and targeted proposal/recovery validation; no persisted format change.

### PROPOSAL-02 — Give preview validation and diff limits compact pure behavior coverage

Priority: medium. Type: missing branches/design judgment.

Preview tests repeatedly acquire the global environment lock and initialize app data (`proposals.rs:895-1126`) even though preview functions take an explicit notes directory and target path. Inspecting their direct dependencies shows path validation, read-only Markdown parsing, edit resolution and diff construction, not app-global data lookup. These tests unnecessarily serialize a whole class of read-only preview cases.

The complex branches are weakly represented: `resolve_text_edits` (`:702`) has ambiguity/not-found, overlap, same-position insert, context-before/after and repeated append/prepend checks, while current tests focus on positive examples and one duplicate insert. `diff_preview_hunks` (`:243`) has a 2,000,000-cell fallback but no direct reconstruction/boundary test. Existing hunk tests assert a particular small diff decomposition; this can make safe diff algorithm replacement harder.

Plan: remove unnecessary environment setup from verified read-only preview tests. Table-test invalid edit combinations with a pure edit-resolution interface or through an in-memory preview builder; assert reapplying hunks produces exactly the proposed UTF-16 editor content, including emoji and empty boundaries. Keep one disk preview test proving no writes and one prepared commit test. Exercise the matrix fallback with a bounded fixture, not a large benchmark in every test. A future diff rewrite should preserve reconstructability and independent hunk review, not incidental LCS tie-breaks.

## Keep/delete/replace summary and implementation order

| Item | Keep | Delete/replace | Risk |
| --- | --- | --- | --- |
| Runtime streaming, permission allow/deny, output formatting | All distinct contracts | Repeated builder/hook setup only | Low |
| Citations, date range/DST, feedback redaction | Small pure contract tests | No broad deletion | Low |
| Chat interruption | Four-status restart/idempotence matrix | Two subsumed tests | Low |
| Chat request/terminal lifecycle | Storage/recovery cases | SQL happy-path seeding gradually replaced by production admission | High |
| Proposal commits | Prepared writer and command integration | Three unprepared wrappers + obsolete unique-path policy test | Low/medium |
| Proposal preview | One filesystem/no-write integration | Global env setup, add pure invalid/diff reconstruction matrix | Low |
| Evidence read budgeting | Real freshness and a few boundary integrations | Move repeated sizing work to pure prepared envelopes | Medium |
| Evidence inventory | Same-session pagination/freshness | Recompute-every-page + unused triple return | Medium/high |
| Research | Runtime mock and worker helper edge contracts | Duplicate live agent loop; add real orchestrator tests | High |
| Interactive retrieval | Timeline race behavior | Mislocated manual-item test replaced by actual adapter coverage | Medium |

Recommended first implementation wave after root reviews all reports: CHAT-02/03, PROPOSAL-01/02's verified setup cleanup, and EVIDENCE-01. These are concrete, bounded reductions/fixes. Then design AGENT-01 plus CHAT-01 as separate changes; use those improved seams to replace the divergent live harness and move deterministic tests out of global app fixtures. Do not combine a storage transaction rewrite, worker authority rewrite and retrieval algorithm rewrite in one change.

Performance claims remain hypotheses until root's timing inventory is available. The audit identifies unconditional sleeps, real repeated I/O, expensive fixture paths and redundant setups; it does not attribute measured wall-clock percentages to them.
