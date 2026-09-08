# Astra planning brief: ambient agent foundation

Status: discovery brief for grilling and ticket creation. This document does not authorize implementation.

Repository: `/Users/bray.polkinghorne/Documents/code/personal/Gneauxghts`

## Mission

Use the repository `grilling`, `domain-modeling`, and `codebase-design` skills to turn the product direction below into a shared, explicit design and then a sequenced implementation plan for the next foundation phase. The future Inbox should constrain that foundation where necessary, but building the Inbox is not part of this phase.

Work in two stages:

1. Grill the user in design-tree rounds until every consequential product and architecture decision has been settled. Ask only the current frontier, number every question, and include a recommended answer. Find repository facts yourself instead of asking the user.
2. Only after the user confirms shared understanding, write `.scratch/ambient-agent-foundation/spec.md` and write each implementation ticket as its own Markdown file under `.scratch/ambient-agent-foundation/issues/`, following `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

Do not implement production code during this task. Do not create tickets before the grill is complete: unresolved product decisions hidden inside tickets make them unsafe for autonomous implementation.

## User-set direction

Treat these as established intent. Clarify ambiguous consequences, but do not make the user restate the vision.

- Gneauxghts remains a local-first notes workspace. AI should be powerful but ambient, not the product's visual or conceptual foreground.
- Chat is currently an add-on with note integration. The goal is a deeper system in which interactive chat, durable work, and background assistance share foundations.
- An Inbox-like surface remains part of the longer-term vision: it may eventually collect meaningful chat updates, running or completed jobs, review requests, failures, and selectively surfaced background findings. Its product design and implementation are explicitly deferred as a large follow-on phase.
- Existing `work-1`, `work-2`, and `work-3` pages are exploratory mockups of what this future surface might entail. Treat them as reference material, not accepted behavior, canonical vocabulary, or scope for the next implementation plan.
- Chat should support both quick answers and deep research, with a refined path for turning useful generated material into durable note knowledge. Useful work should not disappear into an abandoned conversation.
- Future jobs may be scheduled or event-driven. Future background agents may surface items when appropriate, but user trust, low noise, and control matter.
- Future skills should be able to package reusable workflows. Structured note capabilities and a sandboxed execution environment are both candidate foundations.
- A sandboxed environment may eventually provide shell access to an ephemeral projection of approved notes or the ordinary-note vault, with changes returning through review rather than writing canonical Markdown directly.
- Breaking API, schema, module, and UI changes are acceptable because the application is still in development. Do not equate this with permission to lose or silently rewrite canonical Markdown. Explicitly settle which derived databases and development history may be reset instead of migrated.

## Repository facts to preserve or deliberately reopen

Read `AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md`, `docs/architecture/behavior-invariants.md`, the applicable ADRs, and current source before asking architecture-dependent questions.

At the time this brief was written, the relevant facts were:

- Markdown files are canonical current notes. A note and its retained history are bound by stable **Note Identity**.
- `NoteTimeline` is the canonical owner for ordinary-note mutation coordination, external observation, lifecycle, history access, Current-Content Provenance, recovery, and history health. App-owned publication must durably prepare history before canonical Markdown is written.
- Ordinary editor autosaves are retained through fixed, at-most-five-minute **Editing Windows**. Important actions and lifecycle changes remain distinct retained transitions. Do not describe this as retaining every keystroke or every autosave.
- Current-Content Provenance can explain when and through which **Mutation Source** content still present in a note was introduced, changed, or restored. Activity queries expose retained transitions and uncertainty-aware time evidence.
- ADR 0003 currently limits ordinary chat to current-content provenance and activity metadata. It cannot search, quote, or recall removed historical prose. Complete Version Restore is the only designed exception, requires explicit current-turn intent, and its agent capability remains deferred. The new product plan must explicitly preserve or reopen this decision.
- Chat currently owns durable conversations, messages, runs, events, context, sources, proposals, cancellation, and proposal state through `ChatService` and `chat_*` persistence tables.
- `AgentRunCoordinator` is currently a narrow handoff to the app-owned runtime; chat still owns durable lifecycle and context assembly.
- The current agent tool set is `get_active_note`, `search_notes`, `read_note`, `current_note_history`, `propose_note_edits`, `propose_note_rewrite`, `propose_create_note`, and `update_plan`.
- Existing note reads are constrained by conversation vault access, explicit turn grants, and exclusions. Exclusion wins. Existing note mutations are reviewed proposals; canonical publication happens only after Keep.
- The permission broker already models process execution, file mutation, network mutation, and destructive action, but no production tool currently declares a permission requirement.
- Existing run guardrails bound elapsed time, model/tool calls, aggregate tokens, and repeated identical calls. A sandbox would additionally need process, CPU, memory, disk, output, file-descriptor, environment, IPC, and network containment.
- The **Running Vault** is immutable for one process. Another vault selection is staged for the next launch; do not design background services that reread a mutable preference and drift to a different root.
- The working tree contains extensive in-progress history and architecture cleanup. Reinspect symbols and ownership before planning. Preserve unrelated work.
- At brief creation, `ARCHITECTURE.md` contains unresolved merge-conflict markers around newer ownership text. Verify whether they still exist. Until resolved by their owner, do not treat either side as the sole accepted architecture and do not resolve the conflict as incidental planning work.

Authoritative decisions to read:

- `docs/adr/0001-keep-agent-runtime-app-owned.md`
- `docs/adr/0002-own-note-timelines-at-the-canonical-mutation-seam.md`
- `docs/adr/0003-limit-chat-history-access-to-current-content.md`
- `docs/adr/0006-keep-history-preparation-mandatory-in-production.md`
- `docs/adr/0007-retain-editor-history-at-editing-window-boundaries.md`
- `docs/adr/0008-verify-target-note-history-before-background-coverage.md`
- `docs/architecture/editing-window-contract.md`

## Product outcome to design

The intended direction is not merely “add more tools to chat.” The design should test whether chat, jobs, watchers, and skills ought to become entry points into one durable app-owned work system.

Useful generated work should be able to move through a lifecycle resembling:

```text
user intent or trigger
    -> bounded context and authority
    -> durable run
    -> evidence-backed result
    -> immediate chat or review presentation
    -> reviewed promotion into a note or reviewed vault change
```

The user should be able to ignore these capabilities and continue using Gneauxghts as a normal notes app. When used, the system should feel like the workspace quietly becoming more useful, not like a separate AI control center taking over the application.

The durable records produced by this phase should be usable by a future Inbox projection without requiring that surface now. Do not invent Inbox-specific state or generalize the runtime solely for hypothetical UI needs; preserve a clean consumer seam and defer the product semantics.

## Deferred Inbox reference

The Inbox is a future integration constraint, not an implementation deliverable for the next phase. Astra should establish only the minimum compatibility boundary needed to avoid obvious rework, then record the rest as deferred work rather than turning it into ready-for-agent tickets.

The current exploratory Work-page mockups are:

- `src/routes/work-1/+page.svelte` — slide-over variant.
- `src/routes/work-2/+page.svelte` — working-dock variant.
- `src/routes/work-3/+page.svelte` — context-edge variant.
- `src/lib/features/workMock/FocusWorkspace.svelte` — shared mock implementation with focus items, tasks, jobs, reviews, source-note context, review/discuss actions, and resolution flows.

Inspect these only to understand possible future consumers of durable run, result, review, and status data. The layouts, labels, object kinds, prioritization, actions, and lifecycle shown there are not decisions. Do not productionize these routes, derive canonical domain terms from them, or create Inbox UI/state/backend tickets in the initial issue set. At most, the spec may identify a small independently valuable seam that lets a later Inbox observe durable work without coupling it to chat.

## Candidate architecture hypothesis to attack

Treat this as a hypothesis, not a decision:

```text
Conversation ----\
Scheduled Job ----\
Vault Trigger ------> app-owned Agent Work boundary
Manual Task -------/        |
Skill ------------/         +-- context/evidence acquisition
                              +-- structured note capabilities
                              +-- optional sandbox executor
                              +-- permission and resource policy
                              +-- durable event/run lifecycle
                                          |
                                 result / artifact / change set
                                          |
                              chat / review handoff now ------> reviewed NoteTimeline action
                                          |                                  |
                                          |                         canonical Markdown vault
                                          |
                         [deferred] future Inbox projection
```

Possible working terms include Conversation, Job Definition, Trigger, Run, Context Snapshot, Result, Artifact, Change Set, Skill, Capability Grant, and Sandbox Workspace. `Inbox Item` is deliberately excluded from the current vocabulary exercise unless a current-phase boundary truly requires it. None are canonical merely because this brief names them. Reconcile them with `CONTEXT.md`, remove redundant concepts, and add glossary entries only after the user resolves their meanings.

Apply the deletion test to every proposed module. A generic runtime seam earns its place only if deleting it would redistribute real lifecycle, policy, or recovery complexity across chat, jobs, watchers, or skills. Avoid renaming `ChatService` into a collection of shallow forwarding services.

## Design tree Astra must exhaust

Build the question tree from these roots and their dependencies. Do not ask dependent questions in the same round as their unresolved prerequisites.

### 1. Product posture and trust

- What does “ambient” permit the application to initiate without a direct request?
- Which outcomes are informational, which require review, and which may ever be automatic?
- Which current-phase outcomes may interrupt the user, and which remain available only where the work was initiated? Defer future Inbox volume and notification policy.
- How does the user understand why an item appeared, what it read, and what will happen next?
- Which controls exist globally and per job/watcher: pause, mute, snooze, rerun, inspect, archive, delete, and budget?

### 2. Durable work model

- Are interactive chat turns, manually started work, scheduled work, and vault-event work instances of one Run concept or genuinely different lifecycles?
- What survives restart: definitions, queued work, in-progress execution, events, context evidence, partial outputs, approvals, and sandbox state?
- What does retry mean, and how are duplicate external effects prevented?
- Which object owns cancellation, recovery, terminal status, and resource accounting?
- Which durable work facts must remain presentation-independent so future consumers do not become lifecycle owners?

### 3. Generated knowledge and chat-to-note promotion

- What is the durable object before generated content becomes a note: message, result, artifact, draft, proposal, or something else?
- Which user flows must exist: append to active note, insert under a heading, replace selection, create note, update several notes, or maintain a living research note?
- Does promotion preserve citations, run provenance, source excerpts, model identity, and context hashes? Which are user-visible?
- Can a conversation be attached to a durable note, and if so which owns evolving content?
- How are pending generated changes represented in later turns so the model does not reason from stale canonical content?

### 4. Note Timeline and historical evidence

- Does ADR 0003 remain: current-content provenance only, with removed historical prose unavailable to ordinary chat?
- If historical content becomes available, what explicit intent, scope, retention, citation, and privacy boundary makes that safe?
- When may a chat, job, or watcher finalize a pending Editing Window to obtain immutable evidence?
- Can ambient work trigger target verification or window finalization without surprising the editor?
- How are uncertain Editing Window timestamps described so the model cannot overclaim exact change time?
- Can a background finding cite a Revision that later becomes ineligible, cleared, reset, forgotten, Missing, or excluded? Define the underlying truthfulness rule now; defer how a future Inbox presents it.
- Are background results facts about current content, historical evidence, or snapshots that may become stale? Define the difference.

### 5. Authority, permissions, and privacy

- How is scope granted to chat, a persistent job, a one-time run, a watcher, and a skill?
- Can persistent work use Full vault access, approved-note sets, dynamic query results, or only explicit folders/tags?
- How do exclusions and later policy changes invalidate queued, running, and already surfaced work?
- Which authority can be delegated while the user is absent? What happens when a run needs more?
- Which content may be sent to hosted models? Can local retrieval nominate small excerpts before cloud use?
- What audit evidence is retained without itself becoming a second private-content store?

### 6. Execution model

- Which high-frequency, note-native operations remain structured capabilities?
- Which workloads justify a sandbox rather than another custom tool?
- Is the sandbox per tool call, run, conversation, or job? What continuity is actually required?
- Does it receive copied files, an overlay, an APFS clone, or another projection? How are individual approved files represented without leaking their parents?
- What executable toolchain is guaranteed for local and hosted models?
- How are symlinks, subprocesses, inherited environment, local IPC, network, output, resources, and sandbox escape handled?
- Does the agent mutate only an ephemeral workspace and return one validated Change Set? How are large, binary, rename, and delete diffs reviewed?
- How do sandbox changes enter `NoteTimeline` without bypassing its complete typed publication operations?

### 7. Jobs, triggers, and closed-app behavior

- Distinguish a user-defined Job from an event Trigger, a recurring schedule, a watcher, and one Run.
- Which first triggers are deterministic enough to ship before relevance-based ambient detection?
- How are self-trigger loops prevented when an accepted agent change produces another vault event?
- What concurrency, coalescing, debounce, catch-up, and missed-run behavior applies?
- Does work run only while the app is open, catch up on next launch, or require a signed background helper? Treat the helper as a separate lifecycle and distribution decision.
- How do sleep, clock changes, vault close/restart, unavailable models, and offline operation affect scheduling?

### 8. Deferred Inbox compatibility boundary

Do not fully design or implement the Inbox in this planning effort. Resolve only decisions that materially affect the current foundation and cannot safely be postponed:

- Which durable work records or events should a later presentation layer be able to observe without depending on `ChatService` internals?
- What minimal stable identifiers, status facts, evidence links, and review references have independent value now and could support a future Inbox?
- Can that future-facing seam remain a read model or projection boundary rather than introducing `InboxItem` as durable truth now?
- Which Inbox questions are explicitly deferred, including prioritization, deduplication, grouping, replacement, read/unread, expiry, snooze, archive, notification policy, and learning from dismissal?
- Do the Work-page mockups reveal any data dependency that would be expensive to recover later? Preserve only substantiated data needs; do not adopt their interaction model or terminology by default.

### 9. Skills and extension points

- Is a Skill only instructions/references/templates, or may it contain scripts and assets?
- How does a skill declare required capabilities, provider constraints, and network needs?
- What happens when the current model or runtime lacks a required capability?
- How are install, update, provenance, trust, versioning, and permission expansion presented?
- Are third-party integrations structured tools, MCP-like adapters, sandbox commands, or separately permissioned capabilities?

### 10. Cost, quality, and failure policy

- How do hosted and local models differ in allowed background behavior and tool reliability?
- What per-run and per-job limits exist for tokens, money, elapsed time, tool calls, process resources, and output size?
- What quality threshold permits an ambient insight to interrupt the user?
- Which failures are retryable, which pause the definition, and which require user attention in the current presentation surfaces? Defer future Inbox routing.
- What evals prove usefulness without using the user's live vault or relying only on mocked happy paths?

### 11. Breaking-change policy and delivery

- Which chat and agent schemas may be reset rather than migrated?
- May development Note Timeline stores be reset, despite the new history being durable vault knowledge? Require an explicit answer; “breaking changes are allowed” is not enough to infer historical data loss.
- Which existing chat/proposal behavior must remain usable during staged delivery?
- What is the smallest vertical slice that proves the new ownership model before Inbox, sandbox, skills, and ambient watchers multiply its surface?
- Which decisions meet the ADR bar: hard to reverse, surprising without context, and chosen among real alternatives?

## Risks Astra must actively challenge

Do not accept a design that leaves these as implementation details:

- **Future AI Inbox spam:** when the deferred Inbox is designed, technically correct findings can still destroy trust through volume or repetition. Do not prematurely freeze its ranking or notification model in the foundation.
- **History overclaiming:** Editing Windows provide interval evidence, and Baseline Revisions provide known-since evidence, not exact authorship time.
- **Removed-prose leakage:** a broad “history-aware agent” can contradict ADR 0003 and revive content the user believes is no longer in ordinary AI context.
- **Silent canonical mutation:** a sandbox mounted on the real vault bypasses the proposal and NoteTimeline safety model.
- **Self-trigger loops:** agent changes can recursively trigger jobs or watchers.
- **Authority drift:** persistent definitions can outlive the note grants, exclusions, provider policy, or vault context under which they were created.
- **Duplicate effects:** restart and retries can repeat note changes, notifications, or future network mutations.
- **Stale evidence:** an artifact can remain durable after its current-note citations or permissions cease to validate.
- **Chat-centric generalization:** merely making every future object reference a conversation preserves the current coupling under new names.
- **Framework sprawl:** separate chat, job, watcher, sandbox, skill, and Inbox state machines can duplicate one run lifecycle.
- **Over-generalization:** a generic event platform, workflow engine, or permission framework can expose more interface than the first vertical slices need.
- **Weak local models:** shell composition, recovery, and exact patching may be materially less reliable than structured tools.
- **Closed-app promises:** scheduled background work on macOS is a distribution and lifecycle commitment, not just a timer.
- **Unbounded evidence cost:** history verification, provenance reconstruction, model context, and Inbox retention can amplify with vault size.
- **Review fatigue:** one enormous multi-file diff is technically reviewable but not humanly reviewable.

## Planning requirements after the grill

After the user explicitly confirms shared understanding:

1. Record resolved domain vocabulary in `CONTEXT.md` using the repository format. Leave implementation details in the spec.
2. Identify accepted ADRs that remain binding, any ADR that the user deliberately reopens, and any new choice that meets the ADR bar. Never silently contradict an accepted ADR.
3. Write `.scratch/ambient-agent-foundation/spec.md` as the authoritative product and architecture boundary. Separate decisions, invariants, non-goals, staged scope, and unresolved/deferred work.
4. Create `.scratch/ambient-agent-foundation/issues/<NN>-<slug>.md`, one implementation ticket per file. Number them in dependency order and use `Blocked by:` where the dependency affects safe implementation.
5. Apply one of the five canonical `Status:` values from `docs/agents/triage-labels.md`. Use `ready-for-agent` only when an AFK agent can implement the ticket without making a product decision.
6. End every ticket with `## Comments`, even when initially empty.

Each implementation ticket must contain:

- The observable outcome and why this ticket exists.
- Current source evidence and the owner/seam being changed.
- Exact scope and explicit non-goals.
- Dependencies and migration/reset assumptions.
- Behavior invariants and failure cases.
- Acceptance criteria that are independently checkable.
- Required unit, persistence/restart, contract, browser, native, fault-injection, security, or scale validation in proportion to risk.
- Documentation or ADR updates required by the completed behavior.
- A removal plan for replaced state, interfaces, callbacks, tables, or tests. Breaking changes should simplify the result rather than leave compatibility layers by default.

Prefer vertical tickets that prove a complete behavior through the deep module seam. Avoid schema-only, backend-only, and UI-only ticket chains that leave no usable or testable product outcome until the entire effort lands. If a foundational ticket cannot be vertical, state exactly which later ticket proves it and why the split is necessary.

The initial spec and issue set must name Inbox implementation as an explicit non-goal. Capture it as a large deferred phase with its open product questions and mockup references. Do not create ready-for-agent Inbox implementation tickets. A ticket may introduce an enabling seam only when that seam has a concrete use in the current phase and remains valuable even if the future Inbox design changes completely.

Candidate decomposition axes to test, not a required ticket list:

- App-owned durable Run lifecycle independent of chat.
- Context snapshot, source evidence, and Current-Content Provenance integration.
- Durable result/artifact and generalized reviewed Change Set.
- Chat-to-note promotion vertical slice.
- Future Inbox projection and triage lifecycle — deferred phase reference only, not an initial implementation ticket.
- Persistent Job definitions and deterministic triggers.
- Restart-safe scheduling and Running Vault coordination.
- Capability grants and unattended execution policy.
- Ephemeral sandbox worker and validated diff bridge to `NoteTimeline`.
- Skill packages and capability compatibility.
- Relevance-gated background findings and anti-spam feedback.
- Release evals, fault injection, scale, resource, privacy, and native acceptance.

## Completion criteria

This planning task is complete only when:

- The user confirms that the design-tree frontier is empty and the shared understanding is accurate.
- Every ambiguous working term has either a canonical definition or has been removed.
- The spec states what the first release does and deliberately defers later autonomy.
- The spec explicitly defers Inbox product design and implementation, identifies the Work-page mockups as non-authoritative reference material, and limits current work to independently valuable foundations.
- History access, canonical mutation, permission, background execution, and closed-app behavior are explicit rather than inferred.
- Every accepted ADR is preserved or deliberately reopened with the user's decision recorded.
- Tickets form a dependency-valid sequence with no hidden product decisions.
- Every `ready-for-agent` ticket has checkable acceptance criteria and proportional validation.
- The plan identifies the first end-to-end tracer bullet and the obsolete architecture it removes.
- No production implementation has been performed during grilling and planning.

## First response

Begin with the first grilling round only. State the current frontier questions using the repository grilling format and give a candid recommendation for each. Do not produce the spec, tickets, implementation plan, or a restatement of this brief in the first response.
