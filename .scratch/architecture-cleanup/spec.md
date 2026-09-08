# Architecture cleanup implementation plan

Planning date: 2026-09-07. Status: implementation plan; this effort edits planning documents only.

## Round 1 scope — authoritative execution boundary

Implement only **01 → 02 → 14 → 03 → 09 → 10**, then stop for a workflow audit. Ticket numbers are preserved so source investigations and prior review references remain usable. New ticket 14 executes third, immediately after 02. **04–08 and 11–13 are deferred, not prerequisites or permission to expand this round.** Their retained designs require fresh triage after Round 1; they are not an automatically scheduled second round.

The goal is to remove definite duplication, centralize committed-document adoption, and eliminate resource migration on first save/rename. A developer should need fewer ordering rules to maintain save, restore adoption, or rename. Moving the same rules into another class while retaining old callbacks and state copies does not satisfy this round.

Round 1 includes inert activity/persistence interfaces (01), duplicate projection/warning representations (02), behavior-preserving NoteTimeline file organization (14), one semantic pause authority (03), document-owned adoption for all existing consumers (09), and stable open-document handles (10). Ticket 09 uses existing backend mutation contracts; neither the deferred publication-admission refactor (07) nor proposal-domain relocation (08) is necessary to own frontend adoption.

Ticket 14 is explicitly a navigation/readability improvement: it preserves owners, state, behavior and external imports, and moved lines are not deletions. It does not authorize the deferred backend admission refactor.

Round 1 excludes vault selection/restart/bootstrap changes, backend publication admission, proposal command relocation, chat request lifecycle redesign, mounted/suspended review restructuring, and provider/runtime containment. Preserve their existing behavior when touching shared call sites. The broader findings below remain evidence and potential follow-up work, not active requirements.

This plan is based on the current working tree, including history consolidation 56–58, not just HEAD. The tree already contains unrelated/uncommitted work. Source references below and in tickets identify current lines plus symbols; later tickets must locate the symbols after earlier edits. No implementation, test runs, native checks, user database access, or commits were performed for this planning task. Concurrent work changed some history presentation/E2E files while drafting; those changes were left untouched and are not attributed to this plan. Core workflow files used for the ownership findings remained stable during the final drafting audit.

Fresh-context execution prompt: [Round 1 start prompt](round-1-start-prompt.md).

## Evidence and scope

Four investigations provide the call traces, owner/state ledgers, failure branches, alternatives and source anchors:

- [Save and Version Restore](investigations/save-and-restore.md)
- [Vault selection, restart and bootstrap](investigations/vault-switch.md)
- [Agent execution and proposal acceptance](investigations/agent-action.md)
- [Semantic, projection, warning and test duplication](investigations/cross-cutting.md)
- [Independent planning review and corrections](review.md)

This is a detailed assessment of these four workflows and their shared infrastructure, not an exhaustive declaration that every other module in the approximately 100,000-line production application is simple. Uninvestigated features are not deletion targets.

History issues 22 and 24–26 remain deferred; issue 55's historical native/100,000-revision acceptance remains paused. This effort does not add agent history restore, live multi-vault switching, a new storage schema, legacy support, a new agent framework, or a generic application state machine. Existing reports retain their historical measurements unchanged.

## How complexity is counted

An **owner family** holds truth that another participant must respect. A reducer plus its effect controller counts once. The private timeline runtime counts once, while its distinct coordination dimensions are still enumerated. Canonical Markdown, durable history and catalog identity continuity are distinct authorities. Resource handles, derived caches and forwarding functions do not become owners merely because they have a field or mutex.

A **state dimension** is one named domain or coordination value, with its alternatives listed in the investigation. For example, working content and saved baseline are distinct; an operation phase has several alternatives but counts as one dimension. Related receipt fields form one publication-lifecycle value. These are grouped inspection counts, not counts of all individual booleans and not the product of every possible enum combination. That grouping is explicit so the numbers can be audited.

A **coordination step** is a handoff, admission, side effect, or result adoption that must occur in order. Each called function and SQL statement is not another step. Save-within-restore/switch/action is recorded once as a nested subworkflow; the owner/state union includes the participating save state. Thus step counts compare caller burden at the stated scope, not total execution depth or latency.

| Complete representative workflow | Owner families | Grouped state dimensions | Top-level coordination steps | Scope and qualifications |
|---|---:|---:|---:|---|
| Save a note | 7 | 26 | 16 | Includes first-save/rename resource migration; existing same-path save uses 15. Eight resource/cache categories inventoried separately. |
| Enter history, restore a version, exit | 8 | 36 | 21 | Save's seven owners plus HistoryModeSession and ten history dimensions. Entry's workspace save is nested once. Eleven resource/cache categories. |
| Navigate to Settings, Apply another vault, Restart, reach editable workspace | 15 | 39 | 21 | Save union plus eight switch owner families and thirteen switch-relevant dimensions. One extra failure-only bootstrap fallback step. Chat/index producers currently remain outside the close barrier. |
| Send agent request, execute tools, accept proposed note change | 17 | 41 | 17 | Save union plus ten action-specific authorities and fifteen dimensions. Existing context save is nested; run completion and later proposal acceptance are independent branches. |

The complete numbered ledgers are in the investigations. Vault's original 17-owner/54-field checklist and agent's 13-owner/20-dimension subsystem checklist are retained there as explicitly different scopes; **do not mix those figures into the comparable table**. Counts are per family, not per pane/note/run. They cannot establish that vault switching is intrinsically more complex than restore: switch spans a process boundary, and an agent request has legitimate permission/durable-run concerns.

The shared save authorities are NoteDraftState, WorkspaceStore, EditorDocumentRuntime, NoteTimeline runtime, canonical file, private history store, and catalog continuity. Restore adds HistoryModeSession. Switching adds HistoryModeSession, Settings interaction, selection preference, navigation, AppStore bootstrap, initial mounted-session adoption, app-local trust, and vault UI/forgotten persistence. Agent action adds Composer, controller request machine, API inferred activity, ChatService durable records, live cancellation registry, tool context evidence, guard budget, permission broker, review session and review hunk StateFields. Hunk decisions are distinct from the editor text/undo root; they are not double-counted live text.

## Findings — active and deferred directions

Only the rows for committed document adoption, open-document identity, semantic pause, inert interfaces, projection/warnings, and NoteTimeline file organization are active in Round 1. All other rows are deferred designs.

| Area | Demonstrated overlap or caller burden | Chosen replacement | Concrete removal / expected benefit |
|---|---|---|---|
| Committed document adoption | Save supplies rekey/apply callbacks; restore and proposal repeat model/editor synchronization. Some restore adoption assumes an open editor. | Existing document editing boundary owns operation-specific adoption and runtime lookup. | Delete composition-root mutation protocols and boolean policy combinations; unopened and chat-only targets have explicit outcomes. |
| Open-document identity | Path-based key changes on save/rename, requiring resource and pane-reference transfer. | Immutable ephemeral open handle; durable identity/path remain document attributes. | Delete rekey/transfer/adoptFrom protocol and conditional save resource-migration step. |
| History-backed publication | Save verifies before file ownership; restore/proposal/task can verify while holding it. | One private timeline admission implementation, exposed only through complete typed operations. | Delete split writer protocols and duplicated admission; prevent a cold target from monopolizing the file owner. |
| Proposal acceptance | Command knows policy, proposal intent, file/history publication and status recovery. | Existing proposal domain owns the complete commit; timeline owns canonical publication. | Delete command saga and synchronization wrappers without merging distinct durable receipts. |
| Running vault | Config selects B while some resources remain bound to A and others reread B. Apply closes A before fallible config work. | Immutable running context; Apply atomically stages next launch. Explicit restart preparation closes current resources. | Delete selected-path connection swapping, watcher root rereads and compensating comparisons. Remove closed-runtime/config-failure trap. |
| Startup / Settings | Duplicate backend snapshots and fallback RPC protocols; swallowed listener errors conflict with bootstrap admission. | One AppStore snapshot admission and retryable bundled bootstrap. | Delete first-load active-root memory, redundant fallback loads and equivalent snapshot refresh chains. |
| Chat request activity | Machine, mutable conversation field, and API map all say whether a request is active. Late receipts can arrive after terminal events. | One interactive request authority with correlated backend live snapshot on load and one admitted interactive run per conversation. | Remove two inferred representations; no completed message resurrection by a late receipt. |
| Proposal review | Nullable binding and always-available live/suspended fallback fields permit invalid combinations. | Mounted validated binding or suspended text/hunk payload behind current review seam. | Delete duplicate fallback/capture paths; retain mapped hunk state and necessary suspension evidence. |
| Semantic pause | Gate, runtime and worker each store manual pause. | Existing gate owns pause; worker/status derive it. | Three stored decisions become one; delete two copies and SetPaused message protocol. |
| Inert interfaces | Semantic activity methods do nothing; alternate persistence exports have no callers. | Delete them. | Remove no-op command/wrapper/resource chain and unused persistence surfaces. |
| Projection/warnings | Constant/unused projection fields; duplicate internal stage/issue/warning types. | Use real execution policy and existing timeline result vocabulary directly. | Delete policy construction and one-to-one conversion types/matches. |
| NoteTimeline file organization | The parent contains about 5,200 production and 6,800 test/support lines spanning many responsibilities. | Cohesive private files behind the unchanged owner and import surface. | Better navigation; no owner/state reduction or deletion claim. |
| Agent runtime | Adapter request/response expose Rig types; thin coordinator does not hide them. | Sole AgentRuntime entry with narrow app-owned inputs and private provider conversion. | Remove coordinator and leaked conversions from chat; containment improves even if total LOC does not fall. |

Source-confirmed hazards above are not claims of reproduced production incidents. In particular, verification-under-lock, mixed vault context and late receipt ordering require deterministic regression tests when implemented. The installed restart dependency's inability to veto plugin restart was checked in local source; the replacement must still receive an isolated native lifecycle check.

## Target operation boundaries

Round 1 implements only the first block below (document adoption and stable handles), plus tickets 01–03 and the behavior-preserving file organization in 14. The publication, proposal-domain and restart blocks describe deferred work. Existing backend publication ordering and receipts remain intact during this round:

```text
save / restore / proposal result
    → document editing owner adopts committed content
        → document baseline + shared editor runtime
        → stable open handle remains unchanged

save / restore / task / accepted proposal publication
    → concrete NoteTimeline operation
        → private admission → durable preparation → publication → finalization
        → required projections + committed warning

proposal Keep
    → proposal domain commit
        → current policy + proposal intent
        → complete timeline publication
        → proposal status convergence

Apply vault folder → atomically save next-launch selection
Restart → workspace save/restore barrier → producer quiescence + durable settlement + clean close
        → ready receipt → process relaunch
```

These boundaries hide coordination; they do not erase distinct facts. Keep unsaved text versus saved baseline, editor undo versus disk, pending Editing Window endpoint versus finalized revision, app-local trust versus vault store, interactive request versus durable run/cancellation, and proposal status evidence versus timeline publication receipt. Permission and review decisions remain separate. Advisory readiness must never become save permission.

## Round 1 implementation sequence

Use one fresh implementation agent per ticket, working sequentially, followed by orchestrator review and follow-ups before the next ticket. The orchestrator owns the audit, not production implementation. Do not assign several agents simultaneous ownership of the same files. Start each agent with the spec, its ticket, applicable investigation and current source context rather than inherited implementation history.

| Round order | Ticket | Required result |
|---|---|---|
| 1 | [01 — Remove inert activity and unused persistence interfaces](issues/01-remove-inert-interfaces.md) | Delete confirmed no-op/unused interfaces while retaining real foreground yielding and save barriers. |
| 2 | [02 — Collapse projection and warning representations](issues/02-collapse-publication-representations.md) | Remove redundant types/conversions without changing required projections or committed-warning semantics. |
| 3 | [14 — Organize NoteTimeline private files](issues/14-organize-note-timeline-module.md) | Separate cohesive implementations and tests while preserving the owner, imports, privacy and behavior. Report moves separately from deletions. |
| 4 | [03 — One semantic pause authority](issues/03-one-semantic-pause-owner.md) | Replace three stored pause decisions with one; preserve wake/retry behavior. |
| 5 | [09 — Document-owned committed adoption](issues/09-document-owned-adoption.md) | Migrate save/restore/proposal/external-refresh/forgotten-recovery adoption behind the existing document boundary; remove caller-supplied synchronization policy. |
| 6 | [10 — Stable open-document handles](issues/10-stable-document-handles.md) | Delete path-based resource migration while retaining identity, editor, queue and draft continuity. |

The active dependency/checkpoint chain is **01 → 02 → 14 → 03 → 09 → 10**. Only 09→10 is a structural prerequisite within the document rework; the earlier ordering provides audited deletion and organization checkpoints. Ticket 14 follows 02 to avoid moving representations that 02 deletes; it does not deepen the publication boundary. Ticket 09 no longer depends on 08. Work within the existing backend and review contracts; do not add adapters anticipating deferred refactors.

After Ticket 14, NoteTimeline source wayfinding is responsibility-based: closed vocabulary is in `services/note_timeline/domain.rs`; History Mode and restore are in `history_mode.rs`; current delivery is in `current_content.rs`; recovery/health/deletion/close are in `administration.rs`; save/publication is in `publication.rs`; observation replay is in `observation.rs`; lifecycle and missing-note recovery are in `lifecycle.rs`; and the former inline suite is in `tests.rs`. The parent retains the owner, binding, role-access construction, and caller import surface. Earlier investigation line numbers identify the pre-organization baseline; later tickets should use these files and named symbols.

After 10, perform the Round 1 completion audit below and stop. Newly uncovered problems should be recorded with source evidence; address regressions caused by this round within scope. If a genuine prerequisite would require deferred architecture work, explain the smallest blocking dependency and seek direction rather than silently implementing another ticket. Known pre-existing hazards in deferred areas do not become Round 1 fixes merely because broader tests expose them.

## Deferred backlog — requires a new decision

| Tickets | Deferred work | Reason to separate it |
|---|---|---|
| [04](issues/04-bind-running-vault.md), [05](issues/05-explicit-restart-lifecycle.md), [06](issues/06-one-bootstrap-and-vault-snapshot.md) | Running vault, restart settlement, bootstrap/snapshots | Correctness/lifecycle work with product behavior changes and potentially additional code; evaluate separately from deletion work. |
| [07](issues/07-private-publication-admission.md) | Common private publication admission | Addresses a source-confirmed ordering hazard; not required for frontend adoption or stable handles. |
| [08](issues/08-complete-proposal-commit.md) | Complete proposal-domain commit | Moving command code alone offers limited value; reassess after complete publication work is justified. |
| [11](issues/11-one-chat-request-authority.md) | Interactive request ownership and live snapshot | Requires backend registry/correlation and concurrent-send policy changes; not a small duplicate-field deletion. |
| [12](issues/12-explicit-review-attachment.md) | Mounted/suspended review representation | Reassess what duplication survives document rework before replacing its representation. |
| [13](issues/13-contain-agent-runtime-types.md) | Provider/runtime type containment | A separate boundary-quality investment, not a guaranteed simplification or deletion win. |

Deferred tickets use `Status: needs-triage` and an explicit deferred scope. Their technical dependencies remain useful design notes, not an execution queue. The original designs for staged vault Apply, one active chat run per conversation, a new restart lifecycle owner and sole AgentRuntime entry are not approved implementation behavior for Round 1.

## Implementation and audit contract

Before editing, read AGENTS.md, ARCHITECTURE.md, the applicable behavior invariants and ADR links. Use the codebase-design skill. Capture the current ticket baseline including uncommitted work; do not use HEAD as the ticket's starting diff or reset unrelated changes. Record source/test/tooling counts consistently, including embedded Rust tests. Plans, reports, generated output, vendored dependencies and fixtures must not inflate production counts.

For each ticket:

1. Trace the existing callers and identify the exact state/interface being replaced. Start from the required behavior and smallest public operation. Do not begin by adding a generic abstraction.
2. Implement inside existing owners where possible. Every added owner, port, callback, stored flag or DTO must identify the existing caller burden/invariant it removes or a concrete external dependency it contains.
3. Migrate all actual callers; remove the old protocol, obsolete tests and exclusively used helpers in the same ticket. Temporary adapters cannot become the final result by passing tests.
4. Preserve tests of behavior and failure recovery; replace tests of removed wiring with boundary outcomes. Do not add parallel mock suites at each internal layer or a source-parser framework. Existing source-level fitness tests should enforce dependency direction, private capability construction and canonical write routing, not exact structs/field lists/call spelling.
5. Run focused tests, then the relevant broader checks below. Review source routing, asynchronous interleavings, error/committed-result semantics and the deletion ledger. Passing tests alone is not the architecture acceptance criterion.
6. Recount affected workflow owners/dimensions/steps using the same ledger. Explain additions and removals; do not silently regroup to manufacture improvement. Report production added/deleted/net, test added/deleted/net, tooling separately, deleted public interfaces, and surviving coordination obligations.
7. Orchestrator audits the complete changed workflow and resolves follow-ups before moving on. Append evidence/resolution to the ticket and update this plan's progress only after the result meets its acceptance criteria.

Ticket 14 is the explicit exception to deletion-based acceptance: its deliverable is cohesive file organization with unchanged behavior and ownership. Count moved lines separately, retain existing tests, and do not classify parent-file shrinkage as code removal.

There is no speculative “delete 3,000 lines” quota. Tickets 01–03 have definite deletions; 09–10 should remove substantial coordination rather than relocate it. If a proposed simplification increases production code, the review must explain the removed relationship and reject avoidable scaffolding. A net LOC reduction with more caller responsibilities also fails the objective.

## Validation strategy

Run only checks appropriate to active tickets; the broader validation inventory below also documents deferred work and does not authorize implementing those behaviors. Use existing tests closest to the changed boundary. For affected frontend work run selected Vitest files and `pnpm check`; for affected Rust run focused tests and `cargo check --manifest-path src-tauri/Cargo.toml`. When crossing IPC, run the appropriate existing contract fixtures, including `pnpm test:timeline:contracts` for timeline changes. After coherent cross-layer milestones and at the end, run `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, and `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_fitness`. Test counts may fall when obsolete representation tests are removed; record why.

| Workflow / boundary | Outcomes that must survive |
|---|---|
| Save | Later edits survive an earlier save receipt; first-save/rename identity is correct; one shared undo root; empty draft stays unsaved; committed warnings never trigger duplicate publication. |
| Restore | Preview hash conflict publishes nothing; exact selected authored bytes/metadata preserved; restore origin and exact result revision survive recovery; unopened/chat-only targets succeed without forced pane navigation; undo resets across siblings. |
| Publication admission | Cold A does not hold file owner against ready B; scope/replacement/replay changes retry safely; no deadlock with close; durable intent precedes canonical bytes; finalization uses actual bytes. |
| Vault | Apply changes only next-launch preference; all running resources retain A; failure leaves coherent A; explicit restart joins saves/restore/producers and clean close before relaunch; closed/relaunch-failed state remains explicit; detached title jobs are settled; backend exit fallback is not claimed to save unsent drafts. |
| Bootstrap | Failed load/listener can retry; partial listeners cleaned; late snapshot cannot overwrite newer events; no false empty editable vault; assets use running root. |
| Agent action | Events before receipts do not resurrect activity; reopened conversation gets truthful live state; permissions/cancellation correlated; policy rechecked before Keep; status failure does not replay a committed proposal. |
| Semantic/review/runtime | Pause cannot lose a wake; suspended review cannot read a rebound note; unapproved content is not autosaved; provider conversion retains attachments, permissions, cancellation, usage and safe event semantics. |

Round 1 native validation is limited to focused shared-editor/restore-adoption/rename/proposal-adoption interactions for 09–10 where existing browser tests cannot prove native behavior. Restart checks for 04–06 and review-representation checks for 12 are deferred with those tickets. Use existing harnesses; never reset the user's databases or restart their active session just to test. These checks do not resume issue 55 or rewrite its historical scale reports. No new scale-fixture/benchmark framework is needed for this plan.

## Deferred candidates and limits

- `paneNavigationTransitionPipeline` has a callback-heavy interface, but its shared departure serialization and stale-operation checks are real. Reassess surviving callbacks after document adoption; do not build a replacement navigation engine preemptively.
- Background queue position/payload duplication may be reducible, but retry evidence has a different lifetime. Leave it unless measurements or caller analysis demonstrate an actual problem.
- Keep independent save baseline, pending history endpoint, global history session, durable chat state, cancellation, trust and review evidence. Flattening them into one store or one state machine would hide rather than remove complexity.
- Do not globally replace SessionSnapshot or delete all internal unit tests based on appearances. Narrow successful committed-result transport where the facts are equal; preserve other meaningful snapshot uses and pure transition tests.

## Round 1 completion audit and stopping point

After tickets 01, 02, 14, 03, 09 and 10 are audited, report:

- Production and test lines added/deleted/net per ticket and in total; tooling separately. For 14, report moved lines separately and measure net size across the whole module. Do not count planning documents or generated artifacts as production savings.
- The actual fields, types, public callbacks, fallback paths and resource-transfer operations removed. No old/new compatibility layer should remain without an explicit unresolved reason.
- Before/after save, restore-adoption and rename traces using the original census definitions. In particular, show whether conditional save step 14 (resource migration) disappeared and which synchronization rules callers no longer need to know. Account for affected proposal adoption without refactoring run lifecycle.
- Relevant behavior/contract checks and any native evidence or unmet validation limits. Preserve newer edits, committed-result semantics, shared undo, collision handling and real pause/wake behavior.
- A candid decision: did this round reduce relationships and caller obligations, or merely relocate them? Explain any production growth and any surviving duplicate state. Reassess the deferred backlog against the new code without implementing it.

Stop after this report. A smaller file, another wrapper, or more green tests without removed coordination is not completion; nor is continued implementation of the deferred tickets.
