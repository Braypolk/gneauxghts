# Pi evaluation ownership and replacement cost ledger

Source inspection: 2026-10-15. Baseline:
`4b5ff2de500db089787b3d7adefb40d99f13a574`, read from the pinned source at
`/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de`. Current source is
the integrated evaluation worktree, still subject to the native owner's final
freeze. This ledger is a source inventory and responsibility comparison for
[ticket 13](issues/13-replacement-proof-and-evaluation-verdict.md), **not ticket
acceptance, physical-removal execution, measured savings or production adoption**.
The native owner must bind final compiler/build/native/resource receipts to the
same frozen source. The [spec](spec.md), [proof plan](replacement-proof-plan.md)
and [removal reproduction contract](removal-experiment-preparation.md) define
the remaining gates.

## Authority being replaced

The production baseline implements ADR 0001: `ChatService` owns durable
conversation/run/proposal lifecycle and invokes the Rust agent runtime. The
evaluation deliberately tests the contrary owner in isolation. ADR 0001 and the
ordinary default runtime remain in place; this inventory does not revise that
decision. ADRs 0002, 0009 and 0011 still govern NoteTimeline publication,
evidence access and ordinary source links in saved notes.

| Concern | Baseline owner | Integrated Pi owner and maintained obligation |
| --- | --- | --- |
| Input admission, accepted work, committed model/tool history, cancellation | `chat/admission.rs`, `chat/store.rs`, `ChatService`, `AgentRunCoordinator` | Pi Harness submissions/tasks/entries; `chatApi.ts::submit` admits the request snapshot and evidence bindings with the input. The adapter must project Pi identities into ChatApi and reject a second active admission. |
| Model/tool loop and child research | `AgentRuntime::run`, `run_model_with_measurement`, `agent_tools/research.rs::run_research` | Pi `GenerationTask` and task-owned child conversations in `research.ts::executeResearch`; native transport makes one inference dispatch per fetch. Research still needs an isolated tool set, parent authorization, scope/temporal inheritance, handoff validation, usage attribution and cleanup. |
| Terminal answers and partial streams | `chat/runtime.rs::finalize_agent_response`, terminal transactions and `StreamingCheckpoint` in `chat/store.rs`, `chat/answer_stream.rs` | Pi provider entries and `AdmittedAnswer`; `nativeProvider.ts`, `notesExtension.ts` and `streamProjection.ts` keep validated final output separate from provisional structured text and acknowledge ordinary partial checkpoints. Pi storage does not validate note evidence automatically. |
| Retry/restart | `ChatService` run registry, `chat/store.rs::recover_interrupted_requests`, original run/context rows | Pi task restart/abort semantics plus the adapter's durable `gneauxghts.request` snapshot; explicit Retry rereads the original input/configuration. `chatApi.ts` restores visible history/reviews without implicitly replaying interrupted network work. Native quiesce must join frontend/storage/transport queues before NoteTimeline closes. |
| Pending Note Proposals and decisions | `chat_agent_proposals`, working-draft/origin/receipt tables, `chat/note_proposals.rs` | `Reviews`, keyed `Review` and `ReviewTask` in `reviews.ts`; exact version/payload acceptance in `reviewState.ts`. The document runtime still owns the live editable body/title/hunks and the global review workflow still owns UI admission/committed adoption. |
| Canonical effect | Legacy proposal IPC coordinates `ChatService` status with NoteTimeline | `pi_prototype_publication.rs::publish` validates accepted payload/access/identity/target, prepares an intent, calls NoteTimeline, then records a receipt. Neither Pi transactions nor a review decision can atomically commit Markdown. |
| Settings, grants/exclusions, composer drafts and model capability policy | Mixed into `ChatService` and legacy chat commands | Extracted `ChatDomain` and `commands/pi_chat_commands.rs`; four configuration/policy tables remain in vault `ai.sqlite3`. These are retained app policy, not a second Pi lifecycle store. |
| Evidence and source navigation | `services/evidence.rs`, NoteTimeline, chat citation/admission wrappers | The same domain services, reached through `pi_prototype_notes.rs`; app-issued evidence sessions, per-request records, current access/freshness checks and exact source proofs remain mandatory at operation/provider boundaries. Hook exceptions alone cannot authorize or block delivery. |
| Save whole answer/selection/addition | `chat/note_proposals.rs` durable workflow and embedded deterministic policy | Pi review/origin documents plus `save.ts`, `pi_prototype_save.rs`, extracted `proposal_policy.rs` and `note_promotion.rs`; deterministic selection/association/ordinary-link policy remains app code. Direct Save must issue no model request. |
| Managed Markdown, conflicts and relocation | `chat/projection.rs`, `chat/relocation.rs`, transcript import in `chat/recovery.rs` | Derived Pi snapshot publication in `transcript.ts`/`pi_prototype_transcript.rs`, receipt/hash conflict handling and identity-bound root mapping in `pi_prototype_relocation.rs`. Transcript import is omitted by explicit scope; derived Markdown cannot recreate lifecycle authority. |
| Compaction | Persisted `ChatService` history preparation and ephemeral `agent_runtime/compaction.rs` | Pi compaction task plus app-defined safe summary task/state/baselines/usage. The adapter retains original request context, validates reduction/schema, attributes usage and rechecks evidence before continuation. A summary is not evidence or permission. |

## Legacy code conditionally excluded

`src-tauri/src/lib.rs` uses `cfg(not(feature = "pi-prototype"))` on the
guardrails, permissions, coordinator, runtime, tools and legacy chat roots. With
the feature enabled, `chat` resolves to `pi_chat.rs`; `commands.rs` resolves chat
commands to `commands/pi_chat_commands.rs` and excludes
`commands/proposal_commands.rs`. Startup constructs `ChatDomain` rather than
`ChatService::new_managed`. Frontend `features/chat/api.ts` names every Pi method
and selects it using `VITE_PI_PROTOTYPE`; retained native settings/policy methods
are explicit delegations, not missing-method lifecycle fallback.

The following are **excluded in that feature graph, retained in the deliverable
for the default runtime, and physical-removal candidates**. Function examples
name baseline functions, not all declarations or a compiler-resolved count.

| Candidate paths under `src-tauri/src/` | Representative superseded functions/responsibilities |
| --- | --- |
| `agent_run_coordinator.rs` | `AgentRunCoordinator::execute` hands the old run to the Rust runtime. |
| `agent_runtime.rs`, `agent_runtime/*.rs` | `AgentRuntime::run`, `run_model`, `run_model_with_measurement`; compatible/Responses Rig construction, result streaming, local reasoning, context measurement/capacity, usage guard and `RollingContext::compact`. |
| `agent_tools.rs`, `agent_tools/**` | Tool registration/context, capability/permission wrappers, evidence model-reference wrappers, note-save tools, feedback normalization and research (`run_research`, `configure_worker_request`, `isolate_request`, `validate_selection`). Retained underlying domain services are listed below. |
| `agent_guardrails.rs`, `agent_permissions.rs` | Old shared run-limit/cancellation guard and permission request/decision coordination; the evaluation still maintains equivalent authorization/cancellation obligations at its own boundaries. |
| `chat.rs` | `ChatService::new_managed`, `create_conversation_with_config`, `cancel_request`, `decide_agent_permission`, `normalized_rig_history`; legacy active-run registry, durable conversation/configuration projection and history assembly. Extracted settings/source/domain types are retained separately. |
| `chat/admission.rs`, `chat/store.rs`, `chat/runtime.rs`, `chat/answer_stream.rs` | `admit_request`, `streaming_checkpoint`, `store_terminal_message`, `persist_terminal_outcome`, `persist_terminal_with_associations`, `recover_interrupted_requests`, `run_request`, `run_agent_response`, `finalize_agent_response`, `generate_model_conversation_title`; old request/terminal/partial coordination. |
| `chat/note_proposals.rs` | `prepare_note_save_selection`, `prepare_note_save_target`, `checkpoint_proposal_draft`, `refine_proposal_draft`, `save_proposal_receipt`, `recovered_proposal_receipt`, `refresh_saved_addition`; old durable draft/origin/status/receipt workflow. Deterministic content/link/placement policy was extracted, not eliminated. |
| `chat/projection.rs`, `chat/recovery.rs`, `chat/relocation.rs` | `write_projection_locked`, `mark_projection_detached_if_needed_locked`, `recover_transcript_conversations`, `import_conversation`, `relocate_persisted_paths`; old lifecycle-derived projection/recovery/root rebinding. |
| `commands/chat_commands.rs`, `commands/proposal_commands.rs` | Native conversation/run/permission/review IPC dispatch and old canonical-effect/status coordination. Pi domain commands and effect adapters remain. |
| Remaining `chat/**` except `citations.rs`, `date_time.rs`, `structured_answer.rs` | Legacy tests, instruction/evaluation text and fixtures. Their removal is an inventory change, not removed runtime behavior. |

Read-only `removal-experiment.py::plan` found **130 conservatively reachable Rust
module files** and **52 disjoint candidate files**, totaling **1,168,539 bytes**
and **791 per-file distinct lexical `fn` names** at inspection. The corresponding
52 baseline files total **1,206,491 bytes / 814 lexical names**; 49 files are
byte-identical. These totals include tests, inactive cfg, fixtures and prose;
names reused in different files count again. They are not production-function
counts, savings or compiler proof. The changed/extracted policy explains why
deleting a whole legacy file must not be counted as deleting all its obligations.

| Current candidate family | Files | Bytes | Lexical names |
| --- | ---: | ---: | ---: |
| Guardrails / permissions / coordinator | 3 | 37,413 | 39 |
| Rust runtime root and directory | 10 | 174,297 | 132 |
| Rust tools root and directory | 19 | 406,863 | 254 |
| Legacy chat root and candidate descendants | 18 | 477,443 | 293 |
| Legacy chat/proposal command implementations | 2 | 72,523 | 73 |

**Actual removals claimed by this ledger: zero.** The read-only plan neither
creates a comparison tree nor builds/launches one. The native owner must preserve
the final deletion patch/archive/manifest, compiler logs and bound native
receipts before any file/function becomes an *actual comparison-tree removal*.
The ordinary deliverable intentionally retains the excluded source and its
maintenance cost until a later adoption decision.

## Retained policy, editor and effect services

- `chat_domain.rs` retains `ChatSettings`, `VaultAccess`, `ChatSource`, grants,
  exclusions, composer drafts, capability selections, migrations and SQLite
  configuration. `get_settings`, `set_defaults`, `note_is_allowed`, `grant_note`,
  `revoke_note` and related operations exist independently of `ChatService`.
- `provider_config.rs` retains endpoint/platform validation;
  `commands/pi_chat_commands.rs` retains native keyring access and model metadata/
  capability policy. Secrets never become Pi documents or fixture evidence.
- `pi_chat.rs` retains `chat/citations.rs`, `chat/date_time.rs`,
  `chat/structured_answer.rs` and aliases `proposal_policy.rs`. These are citation,
  calendar and deterministic answer/selection/placement/decision policy leaves,
  not the old store/runtime/recovery modules. `note_promotion.rs` retains source
  link conversion and identity-bound fragment policy.
- `proposals.rs` retains proposal preview, diff/hunk coordinates, target/path
  checks, `plan_agent_update_commit`, `plan_agent_creation_commit` and canonical
  editor-visible normalization. The Pi adapter calls these services; Pi does not
  acquire direct note-writing authority.
- `services/evidence.rs` and its query/read/inventory modules retain retrieval,
  scoped cursors, current/historical reads, permissions, budgets, exact proofs and
  freshness validation. `services/note_timeline.rs` and its private modules retain
  Note Identity/Revision, Editing Windows, canonical mutation preparation,
  publication, history and recovery. Catalog/task/lexical/semantic reconciliation
  remains behind that canonical seam.
- `src/lib/features/proposals/reviewSession.svelte.ts` and `reviewCheckpoints.ts`,
  document machines/runtime,
  `src/lib/features/notepad/document/documentEditingService.ts`, workspace/navigation/save barriers
  and shared chat controller/components remain. Their one editable review,
  checkpoint-before-switch, dirty-edit protection and committed-adoption duties
  are not replaced or removed by the engine substitution.

`chat_domain.rs`, `provider_config.rs`, `proposal_policy.rs` and
`note_promotion.rs` did not exist as separate files in the baseline. Their
current combined **65,019 bytes** include extracted existing policy and tests;
they are not 65 KB of purely new behavior or pure savings.

## Added Pi state, stores and recovery cost

The normal static local import closure from `chatApi.ts` contains **17 TypeScript
files / 167,407 bytes / 1,944 physical lines** at inspection. Five of those paths
already existed in the baseline prototype. This closure excludes dynamic
fixture/probe imports, tests, shared UI/controller files and dependencies. The
12 top-level `pi_*.rs` files excluding separate test files total **195,427 bytes /
4,100 lines**, including inline tests, diagnostics and fixture faults; retained
domain files and composition changes are additional. These inventories describe
maintained surfaces, not comparable executable sizes or net cost.

The product path defines **ten custom Pi document kinds** (six singleton kinds,
four keyed families), plus **two custom task definitions**. Upstream Pi documents
and tasks are additional; probe-only kinds are excluded from this count.

| Definition / file | Scope and purpose | Recovery/retention obligation |
| --- | --- | --- |
| `Meta` / `chatApi.ts` | Conversation `gneauxghts.pi.chat-presentation` | Title/archive/reasoning presentation; archive hides without physical collection. |
| `Evidence` / `notesExtension.ts` | Conversation `gneauxghts.pi.evidence` | Current request access, context, issued sources/read activity/permission identities. Must not grant current authority from stale persisted state. |
| `EvidenceRun` / `notesExtension.ts` | Session keyed `gneauxghts.pi.evidence-run` | Per-request source/grant/navigation records survive later sends and interruption. Lifecycle retirement/collection remains a separate gate. |
| `AdmittedAnswer` / `notesExtension.ts` | Session keyed `gneauxghts.pi.admitted-answer` | Validated text, selected sources/grants and segment associations for durable projection/Save. Provisional text cannot substitute for admission. |
| `Reviews`, `Review` / `reviews.ts` | Session catalog and keyed `gneauxghts.pi.review` | Origin deduplication, proposal/draft version, pending decision, exact accepted payload, publication receipt/version and refinement replay record. Catalog/family growth remains maintained storage. |
| `ResearchWorker` / `research.ts` | Conversation `gneauxghts.pi.research-worker` | Parent/session/call binding; isolated child tasks must abort/release native evidence and provider policy on every exit. Child conversation storage is real retained cost. |
| `ContextBaselineDoc` / `compaction.ts` | Conversation `gneauxghts.pi.context-baseline` | Observed capacity/usage projection invalidates on context/configuration changes. No guessed token capacity can become authority. |
| `CompactionState` / `compactionState.ts` | Conversation `gneauxghts.pi.compaction-state` | Durable ready/pending/failure state prevents unsafe continuation after failed/interrupted summaries. |
| `SummaryUsageRun` / `compactionState.ts` | Session keyed `gneauxghts.pi.summary-usage` | Per-session summary spend and worker attribution; must avoid double counting. |
| `ReviewTask` / `reviews.ts` | `gneauxghts.pi.review` | Wait for decision; Keep invokes native effect then converges receipt/status. Uncertain publication preserves accepted payload and requires reconciliation; Discard cannot cancel an accepted unknown effect. |
| `summaryTask` / `compaction.ts` | `gneauxghts.pi.safe-summary` | Closed summary schema, bounded/reducing output, usage accounting, cancellation, post-inference freshness and restart abandonment. |

`gneauxghts.request` is an admitted **entry kind**, not an eleventh document:
it carries original user input, attachments, selected context, provider/model/
capability settings, safe history, temporal anchor and retry lineage. Retry must
use it rather than inferring context from transcript proximity. `LiveDoc`,
`ProviderDoc`, `UsageDoc`, `GenerationTask` and `CompactionTask` are upstream
engine state/tasks, not custom definitions counted above.

| Durable boundary | Physical owner | What remains app-maintained |
| --- | --- | --- |
| Pi schema | App-data `PROTOTYPE-wipe-me/pi.sqlite`, upstream `SqliteStorage` through `nativeSqlite.ts`/`pi_prototype.rs` | IPC serialization, integer/blob encoding, transaction queue/handles, leases/revocation, rollback, restart acknowledgement/close ordering. Pi owns schema/lifecycle; the bridge still owns native transaction correctness. |
| Retained configuration/policy | Vault-data `ai.sqlite3`, `ChatDomain` | Four initialized settings/policy/draft/capability tables; legacy grant migration/revocation. No new generic conversation/run/message/proposal tables belong here. |
| Canonical publication adapter | App-data `PROTOTYPE-wipe-me/publication-receipts.sqlite`, `effects` table | Accepted-payload hash, Note Identity/target/intended hash, temporary proof and receipt. Recover exact prior publication after acknowledgement loss without overwriting a later ordinary edit; retire temporary proof after receipt. |
| Managed transcript adapter | Vault-data `pi-transcripts.sqlite`, `projections` table | Derived publication intent/Markdown/hash receipt, detached/conflict state, recovery and explicit restore/convert choices. This is an effect ledger, not imported conversation history. |
| Vault binding/relocation adapter | App-data `PROTOTYPE-wipe-me/locations.sqlite`, `vault_locations` and `pi_vault_owner` | Root history and one stable vault owner; only proved root relocation may alter displayed paths, never accepted hashes/authored strings or authority. |
| Canonical note/history | Existing Markdown and vault NoteTimeline store | Existing identity, mutation preparation, history/reconciliation and portability obligations remain in full. |

`nativeProvider.ts` and `pi_prototype_transport.rs` add/reuse a native fetch
adapter with frozen admission/configuration, current policy validation, stream
abort/join, credential and attachment admission, request-purpose isolation and
supported web-search configuration. `pi_prototype_notes.rs` adds evidence-session
binding and admission/navigation commands; `pi_prototype_research.rs` coordinates
native scope/handoff checks rather than running a model. `pi_prototype_context.rs`
observes loaded capacity; it is not a hidden model loop.

`chatApi.ts` maintains active/admitting/permitted/request-policy maps, event and
evidence watches, sequence correlation, review announcements, source/status
projection and transcript scheduling. `close` joins watchers/transcript work,
closes Harness and releases provider/evidence sessions. These ephemeral maps and
queues are adapter coordination, not free engine savings. The review state
machine, effect reconciliation, startup shutdown handshake and policy validity
machine remain app responsibilities even when durable tasks run in Pi.

Pi Durable, Pi AI and Chord remain pinned at **1.3.0** in `package.json` and the
lockfile. Evaluation preserves ordinary Rust runtime dependencies/default wiring;
conditional source exclusion is not a dependency-size or supply-chain reduction.
Both TypeScript/provider protocol adapters and native Tauri/Rust bridges remain
maintained compatibility seams.

## Evidence, omissions and unresolved cost

Executed by this ledger worker: read-only baseline/current source inspection,
the existing read-only removal planner, and
`python3 -B scripts/pi-prototype/removal-experiment.test.py`: **7 pure tests pass**.
The planner proves disjointness only in its conservative external-module graph.
Inline modules/macros, target cfg, type checking, application linking and
runtime behavior require the real compiler/native gates. The existing
`src-tauri/tests/pi_lifecycle_exclusion.rs` documents those static checks; this
worker did not run Cargo, a build, app, provider, port or simulator.

The ledger intentionally makes no new native/compiler-pass claim. Check the
native owner's final receipts and acceptance matrix for actual executions;
earlier binaries or source-test passes cannot be relabeled final-source proof.
Unexecuted final/removal/default/iOS/live gates remain unpassed, even if empty
generic native lifecycle tables are observed. Static exclusion is supporting
evidence, never an assertion of product parity.

Branching, standalone excerpt workflows, old-conversation/transcript import,
physical iPhone acceptance and production adoption are scoped omissions, not
replacements or complexity savings. Selection Save and its Open in chat origin
remain required despite standalone excerpt omission. The Pi API explicitly
rejects deferred workflows rather than routing to legacy lifecycle methods.

`scanAll` follows real upstream cursors in 128-row pages and rejects an unchanged
cursor; list/history do not intentionally stop at 1,000. Their public returns
still materialize arrays and summaries, and startup transcript scheduling scans
all conversations. Rebuilding growing history, per-origin review reads and
derived transcripts can cause substantial repeated work. Archive is visibility,
not physical collection. No app collection API, bounded private watcher count,
or acceptable long-history resource growth is established by this source scan.
The [product scale plan](product-scale-proof-plan.md) distinguishes its native
1,005-conversation/1,005-input gate from in-memory engine fixtures.

Cold/warm startup, first visible output, completion overhead, cancellation, IPC,
app/renderer/helper memory, listener lifetime and retained storage must be paired
against the pinned old artifact at equivalent roots/cache/lifecycle boundaries.
Provider inference time, bridge/engine time, synthetic fixtures and live-provider
journeys remain separate measurements. This ledger records no timing/memory/IPC/
storage improvement and no material-regression threshold invented by the agent.
User feedback must be dated and separate from synthetic/agent observations;
its absence must be disclosed, but receiving it is not an extra spec acceptance
gate. Final recommendation and tracker/archive closure belong to the native
owner after the required evidence is reconciled.
