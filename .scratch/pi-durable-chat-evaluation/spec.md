# Pi Durable interactive chat evaluation

Status: ready-for-agent
Type: prototype
Date: 2026-10-15

## Goal and confirmed scope

Deliver a persistent, separately installed evaluation app in which the user can
interact with the existing workspace and chat normally while Pi Durable owns
conversation admission, model/tool execution, committed history, cancellation
and durable pending Note Proposal decisions. Prove that this path can run
without the old conversation/run/review coordinator. Production adoption is a
later decision informed by this interactive evaluation and replacement experiment.

The user confirmed the interview recommendations on 2026-10-15 and requested
these tickets. They subsequently authorized implementation by a new orchestrator
chat in this same worktree, using fresh-context subagents and parallel work where
dependencies permit. The persistent implementation goal is active in orchestrator
chat `01a141e7-aed3-7962-85b6-2768654155e7`; follow [progress](progress.md).

Confirmed decisions:

- Desktop-first hands-on use; actual iOS simulator acceptance before phase closure.
- A disposable copy of the user's vault, fresh Pi conversations and persistent
  evaluation data across launches. The original vault and ordinary installed app
  remain untouched. Existing conversations are not imported.
- Existing local compatible and hosted Responses providers, normal settings and
  model switching, with credentials retained natively in the separate app.
- First usable milestone: ordinary conversation/follow-ups; open-note and selected
  context; discovery, permission UX, reads and citations; create/edit review;
  faithful whole-answer/selection Save; Stop/Retry, session switching and restart.
- Extended research and safe compaction are required before phase closure, after
  the first usable milestone. Attachments, supported web search and managed
  Markdown transcripts are also required follow-ons in this phase.
- Branching, standalone excerpts, old-conversation import, physical iPhone
  acceptance and production adoption are deferred. Deferred capabilities must be
  explicitly unavailable and cannot silently fall back to the old runtime.
- Deterministic fault checks, bounded live-provider journeys, a repeatable
  hands-on checklist and comparison measurements are required evidence.

Selection Save is required even though standalone excerpt creation is deferred.
Its durable origin and Open in chat navigation cannot depend on enabling that
deferred workflow.

## Read first and historical baseline

- [CONTEXT](../../CONTEXT.md), [architecture](../../ARCHITECTURE.md) and
  [behavior invariants](../../docs/architecture/behavior-invariants.md), especially
  Chat, Proposals, committed adoption and Running Vault lifecycle.
- [ADR 0001](../../docs/adr/0001-keep-agent-runtime-app-owned.md),
  [ADR 0002](../../docs/adr/0002-own-note-timelines-at-the-canonical-mutation-seam.md),
  [ADR 0009](../../docs/adr/0009-allow-scoped-retained-activity-evidence.md) and
  [ADR 0011](../../docs/adr/0011-use-ordinary-note-links-for-chat-promotion.md).
- Previous experiment: [result](../pi-durable-prototype/results.md),
  [validation](../pi-durable-prototype/validation.md),
  [owner baseline](../pi-durable-prototype/baseline.md) and
  [run instructions](../pi-durable-prototype/README.md).
- [Initial engine decision](../chat-reuse-research/engine-decision.md) and
  [mobile source findings](../chat-reuse-research/pi-mobile-source-findings.md).

The prior experiment established native SQLite, both fixture protocols and a
bounded real-editor/recovery slice on desktop/iOS. It removed zero production
functions and did not establish live-provider or full product parity. Its passed
checks are baseline evidence, not completion of these tickets.

This experimental ownership **contradicts ADR 0001's accepted app-owned durable
lifecycle**. The user approved testing this alternative in isolation. Preserve
the accepted production architecture/default path; do not rewrite the ADR as an
adoption decision. Pi Durable/AI/Chord remain pinned at published 1.3.0 unless an
observed blocker justifies a recorded exact change and maintenance cost.

## Ownership and invariants

| Concern | Evaluation owner |
| --- | --- |
| Conversations, accepted submissions, model/tool tasks, committed history, cancellation | Pi Durable |
| Durable review checkpoints, pending decisions and continuation | App-defined Pi documents/tasks |
| Live body/title/hunks, one globally editable review, checkpoint-before-switch, committed adoption | Existing document runtime and review workflow |
| SQLite transactions/leases, credentials and one inference stream per dispatch | Native Rust/Tauri bridge |
| Context policy, grants/exclusions, issued evidence, Note Identity/Revision proofs and final admission | Retained app domain services |
| Canonical Markdown publication, Note Timeline and mutation reconciliation | NoteTimeline and a bounded native effect intent/receipt adapter |
| Managed chat Markdown | Derived projection of committed Pi state; never a second lifecycle store |

Do not mirror Pi sessions, runs, messages or review decisions into generic native
chat tables. Extract retained domain APIs from ChatService where needed; do not
retain its lifecycle owner solely to reach settings, permissions or evidence.
Native transport must not hide a second agent/tool loop. Research must use
Pi-owned isolated execution, not AgentRuntime::run beneath a Pi parent.

Authorization and evidence validation belong at mandatory operation/provider
boundaries. Ordinary Pi hook errors can be reported and execution can continue;
throwing a hook error alone is not an authorization boundary.

Request acceptance is one recoverable durable unit. Completion, admitted sources
and usage are durable before success. Ordinary streamed text retains acknowledged
partial checkpoints; provisional structured answer text/sources remain unavailable
until validated. Launch restores pending reviews and exposes interrupted network
work for explicit Retry; it does not silently issue another inference request.

Keep binds the exact reviewed version, target and payload, and alone publishes.
Discard cannot publish. Changed targets require conflict handling and explicit
reapproval; failures preserve edits. An engine transaction cannot atomically
commit Markdown, so native publication intent/receipt reconciliation remains.

Source-free dialogue remains usable history. Earlier note-grounded assistant
prose, tool payloads and compaction summaries do not acquire primary-evidence or
permission authority. Current and retained-revision links revalidate current
access and their exact identity/proof before delivery/navigation.

## Milestones and ticket order

All tickets are specified as `ready-for-agent`; `Blocked by` is an execution
dependency, not missing product information. Do not start a blocked ticket before
its dependencies have recorded acceptance. Update progress and evidence under
each ticket's Comments; use the five canonical triage labels when retriaging.

| Ticket | Deliverable | Dependencies |
| --- | --- | --- |
| [01](issues/01-persistent-isolated-evaluation-app.md) | Persistent app, copied vault, direct workspace launch and baseline | None |
| [02](issues/02-isolate-pi-lifecycle-ownership.md) | Retained domain seam and build excluding legacy lifecycle coordination | 01 |
| [03](issues/03-provider-settings-and-model-switching.md) | Native credentials, both providers and normal model configuration | 02 |
| [04](issues/04-conversation-history-and-request-lifecycle.md) | Usable history, durable streaming/activity, Stop/Retry and isolation | 02, 03 |
| [05](issues/05-context-discovery-and-evidence.md) | Open/selected context, discovery, permissions and current/historical citations | 02, 03, 04 |
| [06](issues/06-reviewed-note-changes-and-refinement.md) | Full editable Note Proposal and refinement behavior | 04, 05 |
| [07](issues/07-faithful-save-to-note.md) | Deterministic sourced Save, additions and origin navigation | 05, 06 |
| [08](issues/08-first-usable-desktop-milestone.md) | First usable desktop/live-provider acceptance and handoff | 01–07 |
| [09](issues/09-pi-research-and-safe-compaction.md) | Pi-owned research workers and long-context continuation | 08 |
| [10](issues/10-attachments-and-web-search.md) | Existing attachment and supported web-search behavior | 08 |
| [11](issues/11-managed-transcripts-and-relocation.md) | Pi transcript publication, conflicts and relocation | 08 |
| [12](issues/12-native-fault-and-ios-acceptance.md) | Expanded recovery matrix and actual iOS simulator acceptance | 09, 10, 11 |
| [13](issues/13-replacement-proof-and-evaluation-verdict.md) | Removal proof, resource comparison and final verdict | 12 |

Desktop-first is sequencing, not permission to declare phase completion without
iOS. Tickets 09–11 follow the first usable milestone; the table does not instruct
parallel agent execution.

## Required acceptance journeys

Use the same caller-facing behavior scenarios against old and Pi builds in
separate disposable roots. Compare admitted state, source/target identity,
publication count and visible behavior, allowing generated IDs/timestamps to
differ. Test failures and races rather than mirroring implementation details.

1. Ask a source-free question, follow up about a previous answer, switch/reopen
   conversations, switch models and restart with the same committed history.
2. Chat with a note open and selected note/passage references. Discover related
   notes, grant/deny access, inspect read activity and open current/retained sources.
   Edit, rename or exclude a source during inference; stale/revoked evidence fails
   safely without admitting provisional structured output.
3. Create and update notes; edit body/title/location/hunks, queue/switch reviews,
   refine the latest draft and Keep/Discard. Preserve dirty ordinary edits and
   draft text through checkpoint failures, target conflicts and restart.
4. Save a whole answer and a repeated-text selection without a model call. Preserve
   ordinary source links and Open in chat; explicitly append/place in an existing
   note. Duplicate Save/Keep and publication crashes yield one canonical effect.
5. Stop/retry a partial stream and terminate during model work. Restore acknowledged
   text, exact retry context and pending reviews without implicit network replay.
6. Complete extended research and a follow-up across worker/parent compaction;
   verify source isolation, fresh evidence and cancellation under both protocols.
7. Use supported attachments/web search and managed transcripts, including projection
   failure and a relocated evaluation vault. Repeat essential flows on actual iOS
   WKWebView, including background/foreground and termination/relaunch.

## Evidence and phase closure

Maintain evaluation-local run instructions, hands-on checklist, validation matrix
and final result as implementation proceeds. Record revisions, environments,
commands, failures, both protocol results and precise unverified limits. Keep
diagnostics bounded; do not capture secrets, hidden reasoning or raw copied vault
content in committed evidence. Fixture faults remain isolated from live use.

Measure comparable cold/warm startup, send-to-first-visible-output, completion
overhead, cancellation, SQLite IPC volume, memory and retained storage growth.
Separate provider inference time from engine/bridge cost and fixtures from live
measurements. Exercise histories beyond the current 1,000-item scan cap; avoid
silent truncation and unbounded document/subscription growth. No invented
performance threshold: report material regressions and whether they block use.

The final build must exclude the old lifecycle coordinator and custom model/tool
loop, including research. Compiler/architecture checks and native acceptance must
prove absence; empty native tables alone are insufficient. Record functions
actually removed, conditionally excluded and retained, plus new adapter and
recovery responsibilities. Make a bounded removal experiment if necessary without
deleting the ordinary default runtime as part of this evaluation.

Recommend continued evaluation, narrower scope, adoption work, defer or reject
from the evidence. Passing does not authorize merge/default enablement,
production migration, physical-device distribution or changing the original vault.
If an external prerequisite blocks one gate, complete independent work, mark the
exact limit and do not claim that gate passed. Archive the outcome and reconcile
the tracker when the phase is complete.
