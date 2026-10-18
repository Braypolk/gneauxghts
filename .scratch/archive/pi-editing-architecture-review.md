# Architecture after the working Pi editing slice — 2026-10-17

Assessment of the effective checkout, including uncommitted slice files. This
records the original recommendations; it did not itself change runtime behavior.
The first three cleanups are now [implemented and verified](pi-editing-cleanup.md).
The broader publication-boundary suggestion was not pursued; the existing flow
remains justified.

## Verdict

The runtime follows Pi's direction: extensions provide tools, Pi owns scheduling,
replay, task ownership and working documents, and the public edit factory supplies
matching/diffs through a restricted environment. Native code owns vault authority
and canonical external effects. There is no second chat scheduler or proposal
engine to retire. The successful slice does expose speculative capability and
unnecessary retained data, plus one incomplete reuse of the public tool API.

Compared the installed 1.3.0 public APIs and implementations with the current
official [README](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/README.md),
[changelog](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/CHANGELOG.md),
[edit factory](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/tools/edit.ts)
and [tool lifecycle](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/harness/tool.ts).
The changelog lists 1.3.0 as its latest released section. Unreleased changes include
dynamic model/settings access and a SQLite interface move to Chord; none supplies
a native vault publication or exact human-review replacement. This comparison does
not establish the absence of an API elsewhere in upstream's experimental project.

## Recommended changes, in order

### 1. Delete agent creation retained solely as a foundation

`pi/publication.ts` still exposes a create/update union. Native
`pi_chat/publication.rs` retains create preparation, identity generation, path
derivation, occupied-target handling and a separate NoteTimeline proof route;
`authority.rs` retains `WriteOperation::Create`. The current product grants only
updates and the sole model mutation tool is `edit_note`.

Repository caller searches found agent creation reached only from native tests,
the native synthetic publication suite and the feature-only simulator acceptance
bridge. There is no ordinary product caller. Retaining it because its tests pass
is precisely the speculative-foundation pattern the user asked to avoid.

Remove the agent-create capability and its now-unused proof entry point; convert
shared authority, recovery, receipt and cancellation acceptance to saved-note
updates. Preserve ordinary note creation and its domain invariants. Inspect
retained publication-proof decoding separately before deleting any shared format.

This recommendation reopens ADR 0012's explicit choice to retain typed native
create as acceptance coverage. Amend that sentence when implementing the removal.
The existing decision should not silently become a permanent feature requirement.

### 2. Keep review patches out of permanent task inputs

`PublicationIntent.review` contains title and patch. `PublicationTask` copies them
into `EditReviewDoc`; the candidate memo also holds the patch while its tool lives.
Pi's public `TaskRecordBase` explicitly retains original task input after terminal
completion. Clearing the review doc therefore does not retire that duplicate
patch from Pi storage. The current description that task records carry only opaque
references is incomplete.

Seed the review document atomically in the existing child-task creation commit.
Keep authority/intent/target, review mode and payload hash in task input; keep the
display patch and decision in the review document. The review phase then observes
the existing document instead of recreating it from a permanent task input.
Retire review data on completion/cancellation. Preserve exact native hash approval
and pending-review restart semantics. Handle any live v2 tasks explicitly during
this change; do not discard pending approvals to simplify migration.

This is a smaller, concrete improvement than rewriting the whole workflow or
merging unrelated state merely to reduce the number of documents.

### 3. Complete reuse of the public edit tool's argument preparation

`editStaging.ts` calls `piEdit.execute` directly, while `edit.ts` registers its own
schema without `prepareArguments`. That reuses matching but misses the stock
factory's model-argument repair before validation.

A read-only executable probe against installed 1.3.0 verified:

| Input shape | Stock preparation | Current wrapper validation |
| --- | --- | --- |
| JSON-string `edits` array | Repairs to array | Rejects |
| Single edit object | Repairs to array | Already coerced by Pi AI validation |
| Top-level `oldText`/`newText` | Repairs to array | Rejects |

Adapt the public `prepareArguments` hook to the Note Identity/source schema, then
let Pi validate it. Keep identity/source requirements and rejection of arbitrary
paths. Do not copy the repair implementation or import private matcher helpers.

### 4. Narrow the publication module's interface and owner representation

`pi/publication.ts` combines policy IPC, native editor-owner binding, module-global
availability/rebinding state, canonical effect/adoption, Pi review state and task
phases. `Notepad.svelte` imports that chat module to mount its document owner;
the UI imports write-policy mutation from it too.

Move write-policy IPC into `authority.ts`. Give Pi's publication task one small
workspace-owned publish/reconcile interface, with the editor/native lifetime
implementation behind it. Replace the independent owner flags with an explicit
owner lifecycle only if it removes contradictory states and simplifies callers.
Native `Editors.owners` is a set even though bind rejects a second owner; an
optional single owner expresses that actual invariant directly.

The lifetime behavior remains necessary. Existing tests cover failed initial
binding, pending bind during unmount, same-turn remount, failed settlement and
close joining canonical adoption. A file split or dependency injection that only
moves these requirements around is not an architectural win. This is lower
priority than the concrete deletions and data-lifetime correction above.

## Orchestration that earns its place

- **Candidate memo:** preserves the exact staged content across interruption before
  native preparation. Recomputing against current note bytes changes the request.
- **Atomic child-task link:** `EditCallDoc` and `tx.createTask` commit together.
  Public `api.createTask` alone has no keyed deduplication. Separate creation and
  memoization would reopen a duplicate-child crash window. Pi's keyed nested tools
  do not directly replace a custom task with a domain-specific abort handler.
- **Publication task:** public Pi ToolTask abort settles an aborted tool result;
  the application task reconciles a native commit and can retain a completed
  receipt even during cancellation. Pi explicitly supports such owned tasks.
- **Review document:** Pi supports documents/watches; it does not furnish this
  product's exact diff, human decision and native payload acceptance workflow.
  Keep one Pi working-state owner rather than inventing a proposal service.
- **Native intents, approval and receipts:** immutable authorization/effect proof,
  rather than another agent scheduler. Pi commits and file publication do not
  share a transaction. Native rejection also prevents a cancelled intent from
  authorizing a later effect.
- **Editor lease and adoption:** Pi's file mutation queue does not coordinate
  unsaved editor buffers, external changes or native process lifetime. Preserve
  the existing document and NoteTimeline owners.
- **Native storage/transport and restart joins:** necessary adapters for embedded
  macOS/iOS execution and native credentials/effects; the slice provides no
  evidence that Pi can replace those platform responsibilities.

## Proposed next implementation boundary

Remove test-only agent creation, reduce retained review data and restore public
argument preparation in one bounded cleanup. Update affected acceptance fixtures
without losing authority/conflict/recovery coverage. Defer a broader owner-broker
redesign unless it demonstrates fewer lifetime states through the same interface.

Re-run the actual six editing journeys, pending-review process restart, interrupted
native-commit reconciliation, dirty-editor/retirement tests and native architecture
fitness after implementation. This assessment ran caller/source inspection and
the argument-shape probe; prior slice acceptance remains historical evidence,
not a new validation run. Product implementation files were unchanged.
