# Agent action architecture investigation

Ticket 14 source wayfinding: the historical `note_timeline.rs:<line>` anchors below predate physical organization. `NoteMutation`/`NoteMutationResult` now live in `note_timeline/domain.rs`, while preparation and `NoteTimeline::mutate` live in `note_timeline/publication.rs`; the parent owner and caller import surface are unchanged.

Read-only inspection of the current workspace on 2026-09-07, including the existing history consolidation. No implementation, tests, native application, database, or Git mutations were performed. Read `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, behavior invariants, ADR 0001, and the repository codebase-design skill and DEEPENING reference. References below are repository-relative current file:line anchors, not historical issue descriptions.

## Scope and counting convention

Representative action: an already configured chat sends a turn with a saved active ordinary note, the runtime proposes an update, the target is reviewed in an existing editor, the user keeps the hunks, and the committed content is adopted. Creation, cancellation, permission, stale delivery and restart routes are traced where they change coordination. The ordinary save used to prepare active-note context and the internal timeline recovery/projection machinery are dependency boundaries; their detailed counts belong to the other investigations.

The **subsystem census** enumerated below is **13 mutable owner families, 20 control/evidence dimensions, and 17 meaningful main-path coordination steps**. It folds the nested save/timeline machinery into a boundary and is not directly comparable to a fully expanded save census. The normalized full-workflow census below is **17 authority families and 41 grouped dimensions**, using the save investigation's exact granularity and replacing this subsystem census's overlapping document/timeline entries. Owner families count a coherent mutable authority once, including repeated pane/editor instances; a resource handle, function, event variant, or read projection is not another owner. The subsystem dimensions intentionally exclude scalar payload fields such as title/body/token totals and configuration choices unchanged by this action. They are not a Cartesian product or a claim about all application states.

## Actual path: 17 coordination steps

1. **Capture coherent send context.** `ChatComposer.submit` captures its draft and asks for the active-note snapshot (`src/lib/features/chat/ui/ChatComposer.svelte:295`). `notepadChatPaneAdapter.getActiveNoteSnapshot` resolves body/path/selection from the same context pane, flushes its save queue, then constructs the snapshot (`src/lib/features/notepad/orchestration/notepadChatPaneAdapter.ts:137`). Composer creates a conversation if necessary before sending, at `ChatComposer.svelte:309`.
2. **Admit a frontend request.** `ChatControllerStore.send` moves `machine.request` from idle to submitting with a monotonically issued operation identity (`src/lib/features/chat/controller.svelte.ts:1081`). Busy sends return false. The view derives busy status from the machine.
3. **Cross IPC and resolve context policy.** `TauriChatApi.sendMessage` invokes `chat_send_message` (`src/lib/features/chat/api.ts:450`). The Rust command validates model attachment capabilities and resolves selected context under current grants/exclusions before `ChatService.begin_request` (`src-tauri/src/commands/chat_commands.rs:955`, `:989`). This is more than a byte transport adapter.
4. **Establish durable run and live cancellation.** `ChatService.begin_request` validates conversation/request, inserts messages/attachments, writes transcript projection, registers a request cancellation token, creates the durable run plus stored context, then spawns `run_request` (`src-tauri/src/chat.rs:1777`, especially `:1952` onward). These writes currently span multiple statements/operations rather than one run-admission transaction. Retry loads previous stored context and creates a new assistant/run linked to the earlier assistant.
5. **Build a bounded runtime request.** `run_request` emits started, and `run_agent_response` constructs compacted history, allowed active/selected/linked note context, tool context, event sink, permission boundary, and provider request (`src-tauri/src/chat.rs:2029`, `:2232`). `AgentRunCoordinator.execute` constructs the guard and calls `AgentRuntime.run` (`src-tauri/src/agent_run_coordinator.rs:20`).
6. **Execute provider calls and pre-tool policy.** `AgentRuntime.run` adapts OpenAI/local providers (`src-tauri/src/agent_runtime.rs:502`); `drive_agent` bounds turns/retries/tool concurrency, watches cancellation/deadline, and translates streaming events (`:601`). `RuntimeEventHook.on_tool_call` applies guardrails before permission resolution and only then runs or skips/stops the tool (`:207`).
7. **Stage a proposal without publication.** `ProposeNoteEditsTool.call` verifies allowed/surfaced target and current hash, locks proposal construction for this run, combines an existing pending preview, then calls `ChatService.stage_agent_proposal` (`src-tauri/src/agent_tools.rs:944`). That transaction inserts the new proposal and supersedes the old unresolved proposal for the same target (`src-tauri/src/chat.rs:3100`). No note write occurs here. Rewrite additionally requires read coverage; creation has its distinct target planning.
8. **Deliver correlated activity and the durable proposal queue.** Tool context emits a proposal link and `chat://proposal` (`src-tauri/src/agent_tools.rs:554`); the chat event sink records durable structured events and emits the envelope (`src-tauri/src/chat.rs:2306`). Controller projects activity and replaces the visible same-target proposal (`src/lib/features/chat/controller.svelte.ts:619`, `:681`). `NotepadChatCoordinator` offers passive review only if target is already open (`src/lib/features/notepad/orchestration/notepadChatCoordinator.svelte.ts:177`). Arrival does not navigate.
9. **Enter the single editable review.** Coordinator rechecks durable pending status and supplies commit/dismiss callbacks (`notepadChatCoordinator.svelte.ts:226`). `loadDurableProposalIfOpenNow` only uses an existing clean ready editor; explicit `loadDurableProposalNow` may open/activate it (`src/lib/features/proposals/proposalOrchestration.ts:450`, `:505`). Serialized loads transition the global review machine using review/proposal/path identity (`:424`, `:532`).
10. **Resolve hunks and freeze the commit input.** Review extension maps hunk positions/status through editor transactions (`src/lib/features/proposals/reviewExtension.ts:231`). Keep All resolves each pending/modified hunk across editors; `finishIfResolved` starts committing only once, captures current review text, and invokes the durable callback (`src/lib/features/proposals/proposalOrchestration.ts:245`, `:559`). Undo-all/dismiss is a separate branch and does not publish.
11. **Authorize and prepare proposal status recovery.** `controller.keepProposal` invokes `commit_agent_proposal` (`src/lib/features/chat/controller.svelte.ts:1477`). `commit_agent_proposal_with_state` validates pending/conflict status and current conversation policy, parses the proposal, computes target/hash, then `begin_agent_proposal_commit` durably records committing/target/intended hash (`src-tauri/src/commands/proposal_commands.rs:30`, `:94`; `src-tauri/src/chat.rs:3245`).
12. **Acquire canonical ownership and prepare history.** The command takes `with_note_file_mutation`, asks `NoteTimeline.prepare_revision_publication` for identity-managed bytes and durable history intent (`proposal_commands.rs:103`). Preparation retains operation/current-content leases and recovery checks (`src-tauri/src/services/note_timeline.rs:4636`), then `prepare_history_capture` verifies target history (`src-tauri/src/services/note_timeline/editing_window_capture.rs:10`, `:23`). This verification can currently occur while the global file owner is held.
13. **Publish or abandon exactly.** `commit_prepared_note_review` checks the base hash under ownership and atomically writes the existing path with an expected-watcher-write token (`src-tauri/src/proposals.rs:412`, `:426`). Creation uses exclusive destination creation (`:564`, `:578`). Failure/conflict explicitly abandons the prepared history intent (`proposal_commands.rs:136`, `:144`).
14. **Finalize history and required projections.** `synchronize_applied_change` passes the exact intent plus committed path to `NoteTimeline.mutate(NoteMutation::accepted_chat_proposal(...))` and maps authoritative identity/warning (`proposal_commands.rs:186`; `src-tauri/src/services/note_timeline.rs:1338`, `:4742`). Canonical success remains success when finalization/projections degrade.
15. **Converge durable proposal status.** The command resolves committing to committed/conflict. On status-write failure it attempts scoped recovery against actual target content/hash (`proposal_commands.rs:216`; `src-tauri/src/chat.rs:3370`, `:3398`, `:3416`). If bytes were committed, failure to converge logs degradation and does not turn the write into retryable failure. The chat proposal intent and timeline publication intent have different responsibilities.
16. **Adopt the committed baseline without dropping later edits.** Controller removes the proposal and propagates warnings/resolution to other pane controllers (`controller.svelte.ts:1477`; `notepadChatCoordinator.svelte.ts:406`). Review orchestration calls `acknowledgeDocumentCommit` before closing the review (`proposalOrchestration.ts:280`). The document command rereads disk, verifies exact committed editor Markdown, invalidates stale save results, and applies the snapshot preserving a differing working draft; mismatch takes ordinary external synchronization (`src/lib/features/notepad/orchestration/noteCommandController.ts:220`).
17. **Settle run output independently of review completion.** `run_request` clears ephemeral permission waiters/grants, persists terminal message/run/metrics, emits terminal event, and removes its request token (`src-tauri/src/chat.rs:2044`, `:2050`, `:2152`, `:2227`). A proposal can remain unresolved after the run ends. This step may occur before steps 9–16; this partial ordering is essential, not a linear super-machine.

## Mutable owners: 13 families

| # | Owner | Authority and overlap judgment |
|---|---|---|
| 1 | WorkspaceStore, reached through pane context adapter | Selected/context document route. Required user interaction authority; note bytes live elsewhere. Context caller anchor: `notepadChatPaneAdapter.ts:137`. |
| 2 | ChatComposer local draft | Unsent text, attachment and selected-context choices (`ChatComposer.svelte:96`). Required until send is accepted; durable sent messages then belong to ChatService. |
| 3 | ChatControllerStore | Per-pane availability, selection and request machine; also stores mutable conversation/proposal projections (`controller.svelte.ts:254`). Its `conversation.activeRequestId` is redundant live authority within this owner because permission gating uses it in addition to the machine (`:1191`). |
| 4 | TauriChatApi active-request registry | `#activeRequests` at `api.ts:319` is used to synthesize loaded conversation activity (`:641`), not merely to optimize a read. It is an additional live request authority competing with the controller and backend. Message/excerpt lookup maps in the same adapter are ordinary caches. |
| 5 | ChatService durable database | Conversations, messages, runs, ordered events, context, proposal status/intended hash (`chat.rs:516`, `:691`, `:3100`). Multiple tables do not imply multiple module owners. |
| 6 | ChatService active_requests | Live request→CancellationToken registry (`chat.rs:519`, `:1984`, `:2581`). Cannot be replaced by durable run status: it owns executable cancellation resources. |
| 7 | AgentToolContext per-run evidence | Surfaced notes, read coverage, source collection, and invalid-proposal attempt state (`agent_tools.rs:111`). Surfacing/read coverage are decision evidence; sources are derived presentation data. The immutable run grant set carries input grants, not another mutable permission owner. |
| 8 | AgentRunGuard | Per-run call/repetition counters and elapsed execution budget (`agent_guardrails.rs:33`, `:48`). Necessary runtime control independent of durable terminal status. |
| 9 | AgentPermissionBroker | Pending waiters and run-scoped grants (`agent_permissions.rs:204`). Necessary transient authority; history must not replay it. |
| 10 | ProposalReviewSession.workflow and retained runtime | Sole global review phase/identity; suspended text and hunk recovery snapshot (`reviewSession.svelte.ts:16`, `types.ts:28`). Current runtime also stores editor-derived working Markdown; this is conditional authority, not simply a harmless cache. |
| 11 | Review editor StateField(s) | Live hunk status/ranges (`reviewExtension.ts:231`) and editor text while mounted; copied to review runtime and fanned out to sibling editors (`proposalOrchestration.ts:158`, `:302`). This owner family overlaps retained review text/hunks and document working text; CodeMirror range mapping still earns a real seam. |
| 12 | NoteDraftState | Shared working content, identity, baseline, operation, external conflict and publication warning (`document/documentState.ts:77`). Authoritative open-document state, distinct from durable bytes and transient proposal decisions. |
| 13 | NoteTimeline | Ordinary canonical publication/history coordination and bound runtime (`note_timeline.rs:4469`, `:4636`, `:4742`). Canonical Markdown is the durable content authority behind this boundary, history is durable evidence, and projections are derived. Counts do not explode its private runtime/recovery/window/verification owners already traced elsewhere. |

Resources/derived state excluded from the owner count: provider stream/final-response accumulator, request `sequence` issuer, handles/unlisteners/subscribers, promise load queue, review `runtimeRevision`, displayed busy/conflict flags, proposal list copies, chat parts/materialized text, catalog/task/search projections, and watchers' expected-outcome resources. Some are mutable and require correlation, but do not independently decide user intent or canonical content.

## Independent dimensions: 20, without a Cartesian product

1. Chat controller availability: uninitialized/initializing/ready/unavailable/disposed.
2. Conversation selection operation: idle/loading/creating/archiving.
3. Interactive request: idle/submitting/streaming/cancelling. Each uses operation/request identity; idle retains the last terminal request. These three declarations are `src/lib/features/chat/machines/controllerMachine.ts:1`.
4. Live request cancellation: token present/removed plus cancelled/not-cancelled (`chat.rs:519`, `:2581`); durable terminal status is not its substitute.
5. Durable assistant message completion: streaming/complete/error/cancelled (`chat.rs:1954`, `:2533`, `:953`).
6. Durable run completion: running/completed/error/cancelled, with stable terminal reason (`chat.rs:2942`, `:3050`, `:3074`). Restart reconciles unfinished run state against message state (`:953`).
7. Permission waiter: absent/pending; eventual resolution allowedOnce/allowedForSession/denied/cancelled (`agent_permissions.rs:46`, `:54`, `:204`).
8. Permission run grant: absent/present for exact run/tool/kind/scope tuple (`agent_permissions.rs:173`, `:292`). Independent of whether another waiter is pending.
9. Runtime budget evidence: elapsed time, tool-call/repetition counters and tool durations; guard derives permit/stop (`agent_guardrails.rs:33`, `:74`).
10. Per-run target surfacing: not surfaced/surfaced (`agent_tools.rs:411`).
11. Per-note read coverage: covered intervals against an exact content hash; complete/incomplete is derived (`agent_tools.rs:63`, `:424`). Surfacing alone does not authorize a rewrite.
12. Durable proposal: pending/conflict/committing/committed/dismissed/superseded (`chat.rs:3100`, `:3227`, `:3245`).
13. Review workflow: idle/opening/reviewing/conflicted/confirmingDiscard/committing/dismissing; recoverTo and reload reason retain applicable recovery phase (`proposalReviewMachine.ts:7`, `:28`).
14. Each hunk decision: pending/kept/undone/modified (`reviewExtension.ts:15`). Hunk count does not multiply workflow dimensions.
15. Review presentation attachment: live editor/null with suspendedMarkdown null/present (`types.ts:28`; `proposalOrchestration.ts:713`). Required today because pane editors can rebind.
16. Document operation: idle/saving/forgetting/failed, correlated token/revision, optional save wait reason recovery/verification/unavailable/corrupt (`documentOperationMachine.ts:1`, `:12`).
17. External document synchronization: noConflict/conflict; conflict phase awaitingChoice/applyingExternal and snapshot/deletion evidence (`documentExternalSyncMachine.ts:8`; `documentState.ts:65`).
18. Document committed warning: absent/present (`documentState.ts:49`). Neither dirty status nor failed operation is a replacement for it.
19. Timeline admission: recovery pending/target verification pending/ready/unavailable/corrupt, scoped by runtime/replacement/note (documented in `ARCHITECTURE.md`, entered from `note_timeline.rs:4636` and `editing_window_capture.rs:23`). Internal proof/recovery dimensions are not expanded here.
20. Timeline publication disposition: prepared then captured/abandoned, with unresolved post-publication finalization remaining recoverable (`proposal_commands.rs:136`, `:144`, `:186`). Its identity/proof is separate from durable proposal status.

Payloads such as working Markdown versus saved baseline are also independent data, with dirtiness derived from comparison; they are identified in the owner table rather than treated as extra phase enums. Likewise display run sequence and retired-run IDs are freshness metadata on a projection, not another user workflow state.

## Cancellation, permission and late-result routes

- Frontend cancel transitions streaming→cancelling and invokes the backend; a failed cancel returns to streaming (`controller.svelte.ts:1170`). Backend cancellation sets the registered token (`chat.rs:2581`); runtime `tokio::select!` stops on cancellation (`agent_runtime.rs:626`), and the final branch checks the token again even after a successful runtime response (`chat.rs:2050`). Partial content is persisted throughout and survives restart. Retry is a new traceable continuation (`chat.rs:1830`, `:3016`).
- Current production tool permission requirements are intentionally empty: reads enforce vault policy, and proposal tools do not write notes (`agent_permissions.rs:166`). The permission branch is a supported future side-effect route, not an extra Keep dialog in this action. Broker decisions require exact permission/request/conversation/message/run/tool identity, then clear waiters/run grants before terminal UI (`agent_permissions.rs:268`, `:338`; `chat.rs:2044`). Do not collapse permission grant into durable proposal approval.
- Request-machine events reject mismatched requests, `AgentEventState` rejects stale run/sequence envelopes, and review events reject obsolete review identity (`controllerMachine.ts:237`; `agentEvents.ts:9`; `proposalReviewMachine.ts:58`). A newer run may legitimately hand off within a message; preserve retired-run protection (`controller.svelte.ts:644`).
- Actual duplicate authority risk: a terminal event can arrive before the IPC send receipt. The machine may correctly remain terminal when `accepted` arrives, but `send` still writes `conversation.activeRequestId = receipt.requestId` and upserts receipt placeholder messages without checking dispatch acceptance (`controller.svelte.ts:1109`, `:1117`). The API likewise inserts its request map on the late receipt after the terminal listener deleted it (`api.ts:470`, `:609`). This is a code-path risk, not a reproduced runtime failure in this audit. It can make loaded activity/permission gating disagree with `isSending` and can regress terminal message display.
- A final proposal commit can outlive an editor mount; existing snapshot/identity checks deliberately preserve the committed text and later local changes (`proposalOrchestration.ts:272`; `noteCommandController.ts:220`). A refactor must not equate editor disposal with cancellation of already admitted irreversible work.

## Concrete implementation candidates and ordering

### A. Complete proposal publication behind the existing timeline boundary

**Priority: high; combine with shared cold-target admission work.** The command currently knows policy parsing, ChatService proposal intent, file ownership, history preparation, conflict abandonment, canonical publisher choice, finalization, projection warnings, and status recovery (`proposal_commands.rs:30–257`). This is demonstrated caller burden and a consistency risk, not a desire to rename files. Ordinary save already owns the complete operation at `NoteTimeline.save_note` (`note_timeline.rs:4469`).

Target interface: a proposal domain operation `commit(proposal_id, optional_markdown, &ChatService, &NoteTimeline)` owns current-policy validation and proposal status convergence; it calls a closed typed timeline operation such as `publish_accepted_proposal(ReviewedPublication)` returning conflict or committed identity/path/warning. Put it in the existing proposal domain rather than inventing a generic coordinator framework. The timeline operation owns prepare→write→abandon/finalize. Keep update and create variants explicit: update has expected base hash/retained identity and writes in place, create has collision-safe target/title. The proposal domain retains its durable intended-editor-hash status evidence.

Concrete type recommendation for issue instructions: retain `ProposalPreview`, `CreationProposalPreview`, `AgentProposalCommitPlan`, and IPC `CommitNoteReviewResult` (`proposals.rs:66`, `:78`, `:96`, `:87` respectively), plus `AgentProposalCommitIntent` (`chat.rs:475`). The plan's intended editor hash remains proposal recovery evidence. Add only a closed timeline request enum with `Update { note_id: NoteIdentity, path: PathBuf, expected_base_hash: String, markdown: String }` and `Create { path: PathBuf, title: String, markdown: String }`; use a closed result `Conflict` or `Committed(NoteMutationResult)`, reusing the existing authoritative mutation result (`note_timeline.rs:340`) and its path/note/warning accessors. Proposal domain maps that result into the existing IPC DTO and synchronizes status. No prepared-publication token, caller callback or generic write phase crosses this operation.

For tasks, retain `TaskMutationKind`, `PreparedTaskDocumentMutation`, `CommittedTaskMutation`, and pure `transform_task_document` (`services/task_mutation.rs:27`, `:35`, `:45`, `:72`). Keep task record resolution/ambiguity policy in the task domain. Replace its sink prepare/write/synchronize protocol (`:90`) with one concrete timeline task publication accepting the target evidence (note identity/path/line/text, using a narrowed crate-visible target value) plus `TaskMutationKind`, returning `NoteMutationResult`; the timeline reads current bytes under ownership and invokes the pure task transform before publication. `TaskMutationService.commit` maps the result to `CommittedTaskMutation`; dirty-open-note `prepare` stays unchanged. Delete `TaskMutationSink`, `AppStateTaskMutationSink`, `TaskSynchronization`, and split `commit_loaded_task` only after its behavior tests are replaced through the concrete operation. Do not expose a generic transform callback as a new public protocol.

**Delete/replace:** remove the body of `commit_agent_proposal_with_state`, `ProposalSynchronization`, `synchronize_applied_change`, and command-owned `converge_agent_proposal_status`; keep only command dispatch and result mapping. Replace crate-visible split publication functions with private implementation functions at the timeline publication boundary once all actual callers are migrated. Do not delete durable ChatService proposal recovery or combine its schema with timeline receipts. Existing pure preview/diff functions remain in proposals.

**Dependency/order:** first extract the proven save admission pattern into a private concrete timeline operation: verify target outside the file owner; drop preflight lease; acquire owner; recheck scope/identity/proof/pending replay under observation ordering; retry outside owner if changed. Then use it for restore/proposal/closed-note task publication. Proposal currently follows `with_note_file_mutation` (`proposal_commands.rs:103`)→`prepare_revision_publication`→`prepare_history_capture`→`ensure_note_ready` (`editing_window_capture.rs:23`), so cold history can monopolize the owner. Task has the same shape at `services/task_mutation.rs:192`→`:124`. Preserve base-hash/task-match checks under ownership. Then migrate command orchestration into proposal domain and narrow helper visibility. Existing save/history command consolidation stays intact.

**Tests/invariants:** target readiness does not block another ready-note save; changing target/scope between preflight and ownership retries; proposal-before-write; hash conflict publishes nothing and abandons intent; same-path update; create collision; committed history warning reaches UI; failed status persistence recovers by actual bytes, never replay; exclusion revocation before Keep fails. Existing anchors: `chat.rs:6245`, `:6396`, `:6476`; `proposal_commands.rs:265` warning test; `controller.test.ts:983`; document adoption tests at `noteCommandController.test.ts:555`. Replace command-internal orchestration tests with behavior through the complete operation, retain architecture fitness protecting the narrowed seam.

**Risk/simpler alternative:** do not move ChatService SQL into timeline or expose closures/opaque preflight leases for callers to sequence. A first small change can move command saga unchanged into proposals while retaining all behavior; this improves command locality but does not solve cold-target locking or the public split publication protocol. Neither step justifies estimated line savings without implementing and measuring.

### B. Establish one live request view across receipt and event delivery

**Priority: high, independently implementable.** Concrete callers are `send`, `retry`, `openConversation`, terminal event handlers and `decidePermission`. There are three mutable frontend activity representations: `machine.request`, `conversation.activeRequestId`, and `TauriChatApi.#activeRequests`; backend cancellation/durable state remains separate and required.

Target: controller request machine is the only interactive request authority. API returns authoritative backend receipt/conversation data and transports events; any cross-pane registry required for reopened conversations must be an explicit shared chat request owner fed by the same correlated transition logic, not an API-local inferred map. Expose a read-only active request snapshot on conversation load from backend live registry (or a shared frontend request owner if changing IPC is out of scope). Derive `activeRequestId` in UI snapshots from that state.

**Delete/replace:** `TauriChatApi.#activeRequests`, receipt/terminal mutations of that map, `#normalizeConversation`'s synthetic activity lookup; mutable `conversation.activeRequestId` writes across controller event handlers/send/retry. Replace permission gating's redundant activity condition with the authoritative correlated request and exact message/run/permission identities. Preserve all those identities; only duplicate activity storage is removed.

**Order:** add behavior tests for terminal-before-receipt and event-before-receipt, stale terminal during new send, reopened conversation in another pane, retry receipt, and dispose with pending permission; implement atomic controller receipt adoption guarded by correlation; then replace API's activity inference with a real read boundary and delete duplicates. Do not simply remove the map: it currently restores ongoing activity when selecting a conversation. Existing test anchors: `controller.test.ts:328`, `:364`, `:618`, `:691`.

**Risk/alternative:** a bounded first fix gates receipt message/active-state adoption on accepted current operation and protects terminal messages; it addresses the demonstrated race without immediately restructuring all multi-pane coordination. It leaves duplicate activity ownership and must be labeled that way. Backend run status, terminal message status and cancellation token still have distinct roles.

### C. Make ADR 0001's runtime boundary true at the type level

**Priority: medium; independently implementable.** `AgentRunCoordinator` is 34 lines of guard construction/error mapping and does not presently hide Rig: `AgentRuntimeRequest.prompt/history` are Rig `Message`, and response `usage` is Rig `Usage` (`agent_runtime.rs:41`, `:56`). `chat.rs` constructs them via `normalized_rig_history`, `rig_user_message`, `document_media_type` (`:4168`, `:4337`, `:4429`). Both ordinary responses (`:2362`) and background titles (`:2427`) cross this leaky boundary. Provider replacement would edit durable chat/context assembly despite the documented claim.

Target: existing runtime request uses app-owned input messages/attachments and existing `AgentUsage`; Rig conversion belongs inside the runtime adapter. Chat retains which content/compaction/citations are eligible, but does not choose Rig media variants. Keep the real external provider/runtime adapter seam; production adapter plus deterministic fake runtime tests are justified. Avoid adding a generic provider registry or a second event protocol.

**Delete/replace:** Rig `Message` and `Usage` fields on public(crate) runtime request/response; `normalized_rig_history`/`rig_user_message`/`document_media_type` from chat (move format conversion privately and replace context-selection portion with app-owned messages). Either let `AgentRuntime.run` own guard construction and return typed failure/stats, deleting the pass-through `AgentRunCoordinator` and its string-include test, or deepen that coordinator into the actual app-owned runtime entry. Choose one entry point, not both. `AgentToolContext.build_agent` also exposes Rig at `agent_tools.rs:164`; moving that small registration adapter into runtime completes containment while app-owned tool domain operations remain usable.

**Tests/invariants:** attachment media/content conversion, compaction exclusion of temporal answers, bounded retries and cancellation, tool pre-permission, provider-safe summaries, no raw reasoning/arguments, usage on failure, and same durable event fixtures. Preserve `architecture_fitness.rs:408`, `:435` with stronger boundary assertions and existing chat history tests (`chat.rs:5874`).

**Risk/alternative:** this is replacement-cost/locality work, not a diagnosed behavior bug. Minimal alternative keeps the coordinator but fixes its request/response types. Do not claim one short coordinator warrants a large generic abstraction.

### D. Narrow review runtime's replicated text/hunk authority

**Priority: medium/later; first characterize, do not delete snapshots blindly.** Live editor StateField, `hunkSnapshot`, `workingMarkdown`, `suspendedMarkdown`, and `NoteDraftState.working` are coordinated by `captureReview`, `syncReviewRuntime`, attach/suspend/restore, callback guards and sibling fan-out (`proposalOrchestration.ts:158`, `:165`, `:235`, `:713`). The suspended snapshot exists to stop a pane-scoped adapter rebound to another note from contaminating review text. That is a real dependency, not dead state.

Target: retain one explicit review attachment state (`mounted` with validated document/editor binding, or `suspended` with text/hunk snapshot), behind the existing proposal session/orchestration interface. Obtain live text from the valid document/editor once; a suspended payload is the sole fallback. CodeMirror continues to map hunk ranges and reports changes through the existing capability seam. First make invalid combinations unrepresentable rather than replace CodeMirror with a new state engine.

**Delete/replace:** `editor: ... | null` plus always-present workingMarkdown plus independent suspendedMarkdown fields become a discriminated attachment payload. Consolidate three snapshot paths into one capture/restore implementation and eliminate fallbacks that can consult an unbound pane adapter. Evaluate redundant sibling hunk authority only after tests establish how shared editor changes propagate; do not assume all StateFields can disappear. `runtimeRevision` may remain as reactive invalidation for raw resources.

**Order/tests:** after committed adoption and request fixes, characterize switching to another note, closing last review pane, remount during Keep All, sibling editors, replacing a proposal, late extension callback, local edits while committing, and external conflict. Existing `proposalOrchestration.test.ts:286`, `:342`, `:391`, `:438`, `:453`, `:477` already express key behavior; evolve those seam tests rather than add field-shape tests. Preserve reviewId and operation identity guards.

**Risk/alternative:** unifying all review text with ordinary autosaving documents can publish unapproved proposed content. Keep autosave suppression and durable unresolved proposals. Leaving current representation with tightened encapsulation is cheaper and defensible unless repeated review bugs justify a larger change.

## What should remain separate

The frontend request machine, durable run history, and live cancellation resources answer different questions; remove duplicate frontend activity authority, not those distinctions. Proposal decision/status recovery and timeline publication receipts remain separate because they recover different facts. Permission grants remain transient and precede future side effects; Keep controls reviewed note publication. The global review machine remains separate from note persistence/external sync and can outlive run completion. CodeMirror's mapped ranges are a justified external dependency, not an excuse to force the whole workspace through a review super-machine.

## Normalized full-workflow census, aligned with save and restore

This row is appropriate for the overall comparison table: **execute an agent action including possible active-note save: 17 authority families, 41 grouped dimensions, 17 top-level coordination boundaries (save nested in boundary 1).** It describes the full workflow's participating state, including optional save and supported permission/cancellation branches, not the number simultaneously changing in one successful run. The top-level boundary count does not add all nested save steps unconditionally.

### Full union of authority families: 17

The first seven entries are the exact save census from `save-and-restore.md`, whose evidence and definitions apply unchanged:

1. NoteDraftState / NotepadState.
2. WorkspaceStore.
3. EditorDocumentRuntime live Markdown and shared undo/redo root.
4. NoteTimeline runtime, including private admission/recovery/verification/window coordinators.
5. Canonical Markdown file.
6. Private durable history store.
7. Catalog continuity identity/path association. Ordinary catalog contents are a projection, but the retained identity association is consulted as continuity truth and cannot be dismissed as a freely replaceable cache.

Ten action-specific families are added, each already evidenced in the subsystem inventory:

8. ChatComposer unsent choices (subsystem owner 2).
9. ChatControllerStore machine and its mutable view projections (subsystem owner 3).
10. TauriChatApi live request map used as activity truth (subsystem owner 4).
11. ChatService durable conversations/runs/messages/context/proposal state (subsystem owner 5).
12. ChatService live cancellation registry (subsystem owner 6).
13. AgentToolContext mutable per-run access/read evidence (subsystem owner 7).
14. AgentRunGuard budget evidence (subsystem owner 8).
15. AgentPermissionBroker pending waiters/run grants (subsystem owner 9).
16. ProposalReviewSession workflow and retained review payload (subsystem owner 10).
17. Pane review StateFields' live hunk decisions/ranges (subsystem owner 11, narrowed here to review metadata rather than editor text).

**Why 17 is justified, rather than 16:** review StateFields do not live in the document root or simply derive every decision from its Markdown. `resolveReviewHunk` is a non-document `StateEffect` applied by the pane's review field (`reviewExtension.ts:243`). `EditorDocumentRuntime.dispatchFromPane` updates that pane and returns immediately when no document text changed (`editorDocumentRuntime.ts:133`–`:141`). Its `buildRootForwardSpec` forwards changes/selection/history annotations, not review effects (`:76`). Orchestration explicitly resolves the hunk in each editor (`proposalOrchestration.ts:302`). Therefore shared root Markdown/undo and pane review decisions/ranges are distinct mutable authority families; one hunk being kept does not require a text change. Counting the review fields is not counting CodeMirror twice for the same text. Per-pane instances remain one family.

The subsystem's Workspace and Draft rows are reused, not added; its one folded timeline row becomes runtime/file/history/catalog; the previously folded normal editor root is made explicit. This replaces 3 shared subsystem rows with the full 7 shared rows: `13 - 3 + 7 = 17`.

### Full union of grouped dimensions: 41

Entries 1–26 are the save investigation's exact grouped ledger; its source anchors and value sets apply:

1. Working title.
2. Working Markdown.
3. Current document identity.
4. Saved baseline.
5. Document operation phase.
6. Document operation correlation token.
7. Document edit revision.
8. Save wait presentation.
9. External synchronization/conflict evidence.
10. Publication warning.
11. Workspace document references/active pane.
12. Editor live root text and undo/redo.
13. Editor transaction revision.
14. Canonical file publication/rollback state.
15. Catalog continuity association/generation.
16. Bound runtime scope.
17. Operation admission.
18. Recovery condition.
19. Target verification proof.
20. Verification coverage.
21. Store replacement/corruption gate.
22. Current-content freshness.
23. Durable publication lifecycle/receipt.
24. Exact capture outcome.
25. Editing Window and retained head.
26. Timeline lifecycle eligibility.

The first 15 action-only dimensions from this report add:

27. Chat controller availability.
28. Conversation selection operation.
29. Interactive request state/correlation.
30. Live request cancellation.
31. Durable assistant message completion.
32. Durable run completion.
33. Permission waiter/resolution.
34. Permission run grant.
35. Runtime execution budget evidence.
36. Per-run target surfacing.
37. Per-note read coverage.
38. Durable proposal status.
39. Review workflow.
40. Hunk decisions/ranges.
41. Review attachment/suspension.

Subsystem dimensions 16–20 are **replaced**, not added: document operation maps to full entries 5–8; external sync to 9; warning to 10; coarse timeline admission to 16–22 and 26; publication disposition to 23–25. Thus `26 + 15 = 41`, not `26 + 20`. Review suspension is retained because it decides which document's review snapshot is safe to restore; ordinary per-pane editor binding remains a resource category. As in both source ledgers, this is a count of named grouped domain/coordination dimensions, not every field in composer/chat payloads or every resource lifetime.

### Selected sole runtime entry

Selecting **AgentRuntime as the only entry point** and deleting `AgentRunCoordinator` is coherent. Both current coordinator callers are in `chat.rs:2362` and `:2427`. Move guard construction and `AgentRunFailure { error, stats }` mapping into `AgentRuntime.run`; make the lower provider execution/stream driver private and pass the same guard through them so failure metrics are preserved. Do not leave ChatService constructing guards or call a lower unguarded provider function for title generation. Preserve observer cancellation/event/permission inputs and the pre-tool hook order. Replace the coordinator's include-string test with tests/assertions of the true runtime entry and app-owned types. Fixing the `Message`/`Usage` leak remains necessary; deleting the wrapper alone does not satisfy ADR 0001. No other problem with this entry choice was found during inspection.
