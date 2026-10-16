# Pi evaluation ownership and replacement cost ledger

Source inspection: 2026-10-15. Baseline:
`4b5ff2de500db089787b3d7adefb40d99f13a574`, read from the pinned source at
`/private/tmp/pi-evaluation-pre-replacement-source-4b5ff2de`. Current source is
the integrated evaluation worktree, still subject to the native owner's final
freeze. This ledger is a source inventory and responsibility comparison for
[ticket 13](issues/13-replacement-proof-and-evaluation-verdict.md), **not full ticket
acceptance, measured savings or production adoption**. It now records
actual comparison-tree removal/compiler/native receipts produced by the native
owner, separately from this worker's read-only source inspection.
The v17 removal/compiler/native slices below are bound to their frozen v17
source. Final compiler/build/native/resource proof must still converge on the
same final source after all implementation owners stop changing it; this ledger
does not declare that final freeze. The [spec](spec.md),
[proof plan](replacement-proof-plan.md)
and [removal reproduction contract](removal-experiment-preparation.md) define
the remaining gates.

## Latest source checkpoint — 2026-10-16

Frozen diagnostic capture **v31**, HEAD `31ef99f`, is at
`/private/tmp/pi-removal-final-20261015-v31`, canonical manifest
`d2aad8a3cadb3ec7bc90ca832efe9b1a19b893c99bbd95a5c778e753f32c1260`.
[v30→v31 diff](/private/tmp/pi-removal-final-20261015-v31/v30-v31-source-diff.json)
contains exactly `probeCitation.ts`/test and `interactiveFailures.ts`/test.
No product/native change: native bytes remain identical to v30/v29, including
the v27 fixture wrapper, not the earlier `b52b1a6` baseline. All three iOS copies
verified 1505 retained files/52 legacy absences. Product lifecycle ownership is
unchanged; projection includes `00e472f`, with no measured speed improvement.

Actual v30 expanded **71i6Ij whole FAILED**, 32 requests, first14/relaunch6 plus
one failure-checkpoint check passed (versions before2/failed2/recovered3), under
SHA `dc4cdcec417c4e8839e3b34811e7db6036f7a589c0e91323a840072b82021c83`.
[Receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-71i6Ij/ios-interactive-gate.json)
retains the later `normal stale-source error` selector deadline. The actual normal
alert was `Unable to open the referenced note.`; the resolver refused before
opening. This does not relabel the failed gate. Closed 52-entry backup:
`/private/tmp/pi-owned-simulator-after-v30-expanded-failure-20261015`.

Reviewed v31 fixture proof binds the exact visible issued source/current message
pane. Its scoped own-composer refusal permits the exact generic fallback only
with mandatory API withholding and unchanged exact EditorView membership/body/
title/selection/review. Ownership checks remain strict. The 125 focused checks in
eight files, Svelte zero errors/warnings and root `check:e2e` passed; this is
prepared diagnostic proof, not native acceptance. Earlier 573 affected frontend
checks predate these changes; 38 escalated support checks passed with the original
sandbox `EPERM` failure retained. Do not add overlapping suite counts.

**v30 transcript 0cCfVn whole PASS** (six synthetic requests), executable
`53712878aa60d22561ecae1ec1422c0ed342eb1b15edf6a33b8c37952021e63c`,
[receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-transcript-0cCfVn/ios-transcript-gate.json).
**v30 local-live B6Dw3j whole PASS**, executable
`dca8b4de82f2afb32e8432df9be968fbe07e2bf96541eaec113d3919782e4697`,
[receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-live-B6Dw3j/ios-live-gate.json):
two normal Sends/three completed real POST200, 15 total requests including metadata;
normal source/citation, Save/edit acknowledgement/background, pending restart,
Keep/duplicate and final committed restart passed without inference replay.
Both retain v30 canonical
`edec64b2a5c5a800853ccd41b109f61c1e75c009f6d4fc95fa818ba7fadda162`;
no cross-artifact whole final pass follows. Transcript closed 46-entry backup:
`/private/tmp/pi-owned-simulator-after-v30-transcript-20261015`.

All three v30 iOS variants compiled; desktop was not built. All three v31 iOS
builds started (29693), log `/private/tmp/pi-removal-v31-ios-builds-20261015.log`;
expanded compilation completed SHA
`1b98f56f15756214f4c356086d6faef953f9c2cf453b6bcb1996bec70836678f`
([compiled-only receipt](/private/tmp/pi-removal-final-20261015-v31/artifacts/ios-expanded-build.json)).
Actual full-follow-on expanded run92673 started, log
`/private/tmp/pi-removal-v31-ios-expanded-actual-20261015.log`, with no result yet.
Remaining builds are pending; **no v31 native pass yet**. Separate-target persistent app build39179
started, log `/private/tmp/pi-v31-persistent-app-build-20261015.log`, with no build
pass yet; the manual app remains closed.

Historical v29 **dt88yt whole failed** later compact title-input acquisition after
first14/relaunch6, exact publication/editor and observed origin scroll passed.
Its keyboardPlatform was iPhone/appleMobile true/Meta true/Ctrl false; closed
51-entry backup and [receipt](/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-ios-interactive-dt88yt/ios-interactive-gate.json)
remain retained. v28 djWH4K/v27 lvqjxb and earlier failures keep their own scope.
Artificial STOP/CONT false fresh-UI/durable-following-relaunch flags remain false.
Hosted live is user-deferred; physical touch/device/OS pressure and standalone
normal Settings vault relocation remain unverified.

Scale **v5** remains untouched/running on frozen v22: **701/1005** at
05:08:28 UTC is historical memory progress only, not final durable seed/history/
identity/provider accounting. New v31 queue76661 waits for full v5 closure and
desktop build. v30 queue97996 was superseded before **any** gate, exit143
([receipt](/private/tmp/pi-final-desktop-queue-v30-superseded-20261015.json)); v5
was not interrupted. Final expanded/fault/crash/transcript/churn, three paired
Pi/old/Pi resources and fresh default smoke have no new queued result. Explicit
iOS closure remains required before resources; coverage/cache/observer/IPC/storage
unknowns and regressions stay visible. Earlier manual desktop live/original-seal
proof and platform passes retain their own pins. Full acceptance, cost/verdict
and the goal remain open; no closure/archive/adoption claim.

## Current source inventory at v23 capture

The following inventory is frozen at v23, before later live-probe
corrections; it is not a recomputed v31 diagnostic/native total. The new fixture-close
wrapper/registration and shared proof adapter remain added maintained obligations. It is
an inventory of maintained source, not measured savings or executable-function
counts. The 52 comparison-tree deletions remain absent in v23; the default
deliverable still deletes zero legacy files. The v23 desktop compiler/exclusion checks and three iOS builds passed;
native journey results remain separate.

| Bounded inventory | Baseline `4b5ff2de` | Current v23 |
| --- | ---: | ---: |
| Pi normal static TS closure from `chatApi.ts` | 5 files / 42,679 bytes / 494 lines | 17 files / 173,405 bytes / 2,020 lines |
| All non-test Pi TS, including diagnostics | 8 files / 69,293 bytes / 799 lines | 44 files / 368,243 bytes / 4,321 lines |
| Separate Pi TS tests | 0 files | 36 files / 248,772 bytes / 2,875 lines |
| Top-level native `pi_*.rs`, excluding separate test files | 4 files / 32,508 bytes / 570 lines | 12 files / 195,427 bytes / 4,100 lines |
| Seven explicitly extracted domain/command paths | Embedded in other modules | 92,288 bytes / 2,365 lines |

The normal static closure follows top-level relative import/export declarations
within the Pi directory, using the installed TypeScript parser. It excludes
dynamic imports, shared UI/domain modules and third-party dependencies. Lines
are physical LF lines; bytes are UTF-8. The closure's sorted
`path + NUL + fileSHA256 + LF` inventory hash is
`2ca43b081d5905fc23fbf6b3fde155400a2683efcf3f4ddd0466f4e10174c59f`.
Its 481 syntax function bodies include 403 arrows; 73 per-file distinct named
function declarations/expressions have bodies. Baseline equivalents are 151
bodies / 137 arrows / 11 names. These are syntax counts, not a comparison with
the Rust lexical counts below or a count of lifecycle responsibilities.

The native Pi files contain 151 per-file distinct lexical `fn` names, including
inline tests/inactive cfg, versus 23 at baseline. Seven extracted paths are
`chat_domain.rs`, `provider_config.rs`, its `local_reasoning.rs` and
`model_metadata.rs`, `proposal_policy.rs`, `note_promotion.rs`, and
`commands/pi_chat_commands.rs`; their policy was already maintained inside other
owners. Extraction is not wholly new policy or eliminated maintenance.

Ten custom Pi document definitions (six singletons/four families), two custom
tasks and the separate request-entry contract remain app-maintained. Pi AI,
Pi Durable and Chord remain pinned at 1.3.0. The responsibility table below,
actual bridge/storage observations and recovery obligations are the substantive
replacement comparison; source size alone cannot establish a simpler system.

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

The historical read-only `removal-experiment.py::plan` inspection found **130 conservatively reachable Rust
module files** and **52 disjoint candidate files**, totaling **1,168,539 bytes**
and **791 per-file distinct lexical `fn` names** at inspection. The corresponding
52 baseline files total **1,206,491 bytes / 814 lexical names**; 49 files are
byte-identical. These totals include tests, inactive cfg, fixtures and prose;
names reused in different files count again. They are not production-function
counts, savings or compiler proof. The changed/extracted policy explains why
deleting a whole legacy file must not be counted as deleting all its obligations.

| Candidate family at historical inspection | Files | Bytes | Lexical names |
| --- | ---: | ---: | ---: |
| Guardrails / permissions / coordinator | 3 | 37,413 | 39 |
| Rust runtime root and directory | 10 | 174,297 | 132 |
| Rust tools root and directory | 19 | 406,863 | 254 |
| Legacy chat root and candidate descendants | 18 | 477,443 | 293 |
| Legacy chat/proposal command implementations | 2 | 72,523 | 73 |

**Actual comparison-tree removals: 52 files; default-deliverable removals: zero.**
The native owner prepared and compiled the isolated v17 comparison tree at
`/private/tmp/pi-removal-final-20261015-v17/source`. Read-only verification against
its `removal-ledger.json` found all 52 manifest-listed paths absent there, all 52
retained in its `removed-source` archive, and all 52 still present in the default
worktree. Thus the feature graph is no longer the only exclusion evidence, while
the default runtime's source and maintenance cost remain retained pending a
separate adoption decision.

| v17 removal proof | Bound evidence / limit |
| --- | --- |
| Canonical source manifest | `468be149b7a263236c258b6b1f9ef053a7e546ab0b48ac37ab8dea6e314404e6` |
| Removal manifest/archive | `/private/tmp/pi-removal-final-20261015-v17/removal-ledger.json`; 52 paths/hashes/bytes/lexical names; archived bytes under `removed-source` |
| Compiled desktop artifact | SHA-256 `024dad84fbdc2b35c6358fd662c7d7bbdc5c82990f74b1dd7ddae379810e13a5`; `artifacts/desktop-build.json` records `removedFiles: 52` and matching canonical source digest |
| Compiler log | `/private/tmp/pi-removal-v17-desktop-build.log` |
| Publication fault `K7YRrL` | Passed after-intent/after-publication/after-receipt/during-model cases; eight synthetic provider requests; same binary |
| Fault receipt | `/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-faults-K7YRrL/fault-gate.json` |
| Native crash `RJ9Vy0` | Passed prepared-review and transport-completed boundaries for local/OpenAI synthetic protocols; each prepared-review has one canonical file/effect row/publication receipt; transport-completed has zero canonical effects |
| Crash receipt | `/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-native-crashes-RJ9Vy0/native-crash-gate.json`; transport withholds terminal before Pi terminal commit, not proof of a failed Pi COMMIT |
| Desktop transcript `HVmzV1` | Passed four checks: watcher edit/delete/Convert/Restore with preserved ordinary copy; full generated-root relocation/session/source/origin/conflict/pending review; UI Retry Keep plus duplicate API Keep one effect/no inference; known-old-root-only mapping/copied legacy inert |
| Transcript receipt | `/private/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-pi-transcript-HVmzV1/native-transcript-gate.json` |
| Expanded desktop | Partial first/relaunch passes; v17 `r3L0r7` closed failed at visible failed-checkpoint deadline; no complete expanded native pass |
| Remaining limits | No full iOS, scale, final removal/evaluation acceptance or production adoption; standalone Settings-selected vault move remains unproven |

These are actual removal-tree/compiler and bounded synthetic native observations,
not removed production functions or measured savings. They do not make the
remaining expanded/iOS/scale gates pass or reconcile later source snapshots
implicitly. Later snapshots and partial gates are tracked in
[progress](progress.md) and [desktop acceptance](desktop-acceptance.md).

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
historically inspected combined **65,019 bytes** include extracted existing policy and tests;
they are not 65 KB of purely new behavior or pure savings.

## Added Pi state, stores and recovery cost

The historical normal static local import closure from `chatApi.ts` contained
**17 TypeScript files / 167,407 bytes / 1,944 physical lines** at that earlier
inspection. This is not a current or final-source count: later product changes,
including `c74a53e`, were not included, and no reliable existing closure inventory
has been rerun here. Five of those paths
already existed in the baseline prototype. This closure excludes dynamic
fixture/probe imports, tests, shared UI/controller files and dependencies. The
historical 12 top-level `pi_*.rs` files excluding separate test files totaled
**195,427 bytes / 4,100 lines**, including inline tests, diagnostics and fixture faults; retained
domain files and composition changes are additional. These inventories describe
maintained surfaces, not comparable executable sizes or net cost.

The product path at that source inspection defined **ten custom Pi document kinds** (six singleton kinds,
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

Later product work adds maintained coordination cost beyond that historical
inventory. `chatApi.ts` now preserves tool-rich read activity across generic
`message_end` projection, correlates admitted read events with native policy and
conversation access revisions, and rechecks admission after awaited validation.
Its terminal-origin/read-evidence/pending-commit paths must reject revoked or
cross-conversation evidence rather than reviving stale parts. The request and
provider policies in `notesExtension.ts`/`nativeProvider.ts` still validate current
evidence before dispatch and answer admission. Research activity must match the
shared UI schema, and review recovery must restore persisted uncertainty through
identity-checked UI admission. These are real adapter/state-coordination and
regression-test obligations; they are not functionality Pi removes. No new byte,
line, document-kind or net-savings total is inferred from this qualitative update.

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

This worker ran no native/compiler operation. The actual v17 passes above are
read from the native owner's bound receipts; the final acceptance matrix still
must reconcile the complete required gates on an eventual common final frozen
source.
Earlier binaries or source-test passes cannot be relabeled final-source proof.
Remaining final/default/iOS/scale requirements remain unproven; completed slices
do not establish the complete matrix, even if empty generic native lifecycle
tables are observed. Static exclusion is supporting
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

Bounded resource captures now exist; their exact measured scope and limitations
are recorded in the [proof plan](replacement-proof-plan.md). A complete cost
comparison of cold/warm startup, first visible output, completion overhead,
cancellation, IPC, app/renderer/helper memory, listener lifetime and retained
storage must still be paired against the pinned old artifact at equivalent roots/cache/lifecycle boundaries.
Provider inference time, bridge/engine time, synthetic fixtures and live-provider
journeys remain separate measurements. This ledger records no timing/memory/IPC/
storage improvement and no material-regression threshold invented by the agent.
User feedback must be dated and separate from synthetic/agent observations;
its absence must be disclosed, but receiving it is not an extra spec acceptance
gate. Final recommendation and tracker/archive closure belong to the native
owner after the required evidence is reconciled.

### 2026-10-16 — product scale cost source audit

[Read-only audit](scale-cost-audit.md) distinguishes event-driven product scale from earlier resource-driver polling and identifies full-history reconstruction, empty native source validations, missing summary lookups and retained frozen-history bytes. These mechanisms are not measured attribution, an implemented optimization or a scale pass. v5 remains running; immutable-boundary IPC counters remain unknown.
