# Align Pi provider and UI observation adapters

Status: completed; historical record outside the executable backlog
Created: 2026-10-16

All six tickets are implemented and accepted. See [the verified outcome](outcome.md).
This archived scope is historical; current architecture remains authoritative.

## Outcome

Use Pi's supported provider construction, observation and cancellation mechanisms
where they remove application plumbing. Expose useful sanitized runtime diagnostics.
Keep the native permission, citation, publication and shutdown guarantees of the
ordinary-chat rebuild. This is a targeted adapter refactor, not a new chat runtime.

The starting point is the installed Pi Durable/Pi AI/Chord **1.3.0** integration.
The [reuse audit](research.md) records its APIs and limits. Read
[ARCHITECTURE](../../../ARCHITECTURE.md#agent-runtime),
[ADR 0012](../../../docs/adr/0012-found-ordinary-chat-on-pi.md), and the
[behavior invariants](../../../docs/architecture/behavior-invariants.md#chat) before
implementation. Use exported APIs and version-matched official documentation:
[Durable](https://github.com/earendil-works/pi/blob/v1.3.0/packages/durable/README.md),
[AI custom providers](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/README.md#custom-providers),
[Chord](https://github.com/earendil-works/pi/blob/v1.3.0/packages/chord/README.md).

## Scope

- Construct providers with Pi's standard factory and wrapped API implementations;
  use supported catalog refresh where it reduces duplicate machinery. Deduplicate
  model discovery during startup, without skipping native binding restoration.
- Consolidate provider-option translation around Pi's model compatibility and
  request options where supported. Native settings, endpoints, credentials,
  capability validation and permission checks remain authoritative.
- Replace the discarded `onReport` channel with bounded, sanitized diagnostics and
  a modest existing-chat presentation for failures needing attention.
- Give each mounted selection a cancellable Chord observation context, independent
  of the context that admits or runs chat work.
- Observe list metadata using Pi documents and commits rather than resolving a
  complete agent or rehydrating unchanged rows on every metadata update.
- Validate the combined changes on desktop and the iOS simulator through the same
  production composition. Live hosted credentials and a physical device are not gates.

## Required boundaries

1. Pi retains sole ownership of submissions, tasks, queue, execution cancellation,
   history, progress, usage, recovery and standard compaction. No second scheduler,
   durable diagnostic ledger, transcript projection or recovery ledger is introduced.
2. Rust resolves endpoints/credentials and derives current native authority. Every
   dispatch and terminal admission, including tool continuations, recovery and
   compaction, retains the native binding and citation checks. Generation hooks and
   UI snapshots never become security boundaries.
3. Startup installs every relevant native binding and valid model configuration
   before any operation enables scheduling. Retired authority stays denied across reopen.
4. Unknown local capacity stays unknown. Only an observed loaded model establishes
   usable context capacity; first-inference discovery still reaches Pi before its
   next compaction decision. Do not rely silently on catalog refresh updating an
   already-resolved model handle.
5. Selection/disposal cancels observation only. Stop, queued-input withdrawal and
   native retirement keep their distinct Pi/native operations. Human history still
   pages immutable entries, including entries outside the active compacted context.
6. Native scoped Off/Temporary/Always authority and independent default-on review
   are preserved. Native intent/receipt and NoteTimeline proof reconcile uncertain
   effects before another write. Dirty/conflicted documents, exact payload approval,
   committed warnings, editor adoption and page-generation ownership keep their owners.
7. Restart still joins Harness close, native transport/effects and storage release
   before clean-close acknowledgement. Observation cleanup cannot substitute for it.
8. Diagnostics contain curated codes and safe messages, not raw exception strings,
   stacks, provider bodies, prompts, reasoning, note content, credentials, headers,
   endpoints or filesystem paths. Unknown errors get a fixed fallback. Diagnostic
   processing cannot throw back into Pi or change its retry/settlement decisions.

## Tickets and dependencies

All tickets use the canonical `ready-for-agent` status; `Blocked by` records execution
dependencies, not missing requirements. Each ticket must read this spec and its linked code.

| Ticket | Work | Blocked by |
| --- | --- | --- |
| [01](issues/01-standard-provider-construction.md) | Standard provider construction and model registration | None |
| [02](issues/02-provider-option-mapping.md) | Consolidate supported provider-option mapping | 01 |
| [03](issues/03-sanitized-diagnostics.md) | Sanitized Pi diagnostics and failure presentation | None |
| [04](issues/04-chord-observation-cancellation.md) | Chord cancellation for disposable selection | None |
| [05](issues/05-conversation-list-observation.md) | Narrow conversation-list metadata observation | 04 |
| [06](issues/06-regression-acceptance.md) | Integrated desktop/simulator and boundary acceptance | 01–05 |

01, 03 and 04 can start in parallel, coordinating edits to `runtime.ts` and the
view binding. Then 02 and 05 can proceed independently. 06 validates their integration.
Each implementation ticket runs focused behavioral checks; the final ticket does not
defer discovery of local failures until the end.

## Exclusions and completion

No Pi upgrade/fork/private imports, storage-driver replacement, composer-draft storage
move, legacy migration, exact Retry, new mutation tools/review UI, custom compaction,
or new provider family. Preserve existing UI behavior beyond the specified diagnostic
presentation. Avoid new abstractions without a concrete deletion or ownership benefit.

Completion requires all six tickets, passing relevant current regression checks,
selected sanitized acceptance evidence and a record of removed versus retained
plumbing. Measure model-discovery and list-read counts on matched fixtures; numerical
targets are observations, not permanent runtime budgets. Record real limitations;
do not claim a general performance win from smaller code alone. Update current
architecture prose only for verified changes, then consolidate completed outcomes
under `.scratch/archive/` following the tracker retention rules.
