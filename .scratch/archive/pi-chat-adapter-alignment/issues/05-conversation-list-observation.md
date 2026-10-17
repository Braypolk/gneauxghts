# 05 — Observe conversation-list metadata without resolving full agents

Status: ready-for-agent
Execution: implemented
Type: task
Blocked by: 04

## Problem and scope

List hydration loads a conversation handle and resolves its agent per row; metadata
commits can trigger a full first-page refresh. Use Pi's persisted documents and commit
notifications for a smaller disposable list adapter. Read the [spec](../spec.md) and
the observation ownership established by [04](04-chord-observation-cancellation.md).

Primary code: `src/lib/features/chat/pi/runtime.ts` (`listConversations`),
`src/lib/features/chat/ui/piConversationView.ts` (`subscribeCommits`/`refreshList`),
public `AgentDoc`, `ChatDoc`, scan and commit-publication types.

## Work

- Read the stored model reference from Pi `AgentDoc` for summaries instead of
  resolving the full enabled agent. Retain application title and retirement metadata.
- Update or invalidate affected loaded rows on conversation, ChatDoc and AgentDoc
  commits. Avoid re-reading unchanged pages for a rename/model change and ignore
  streaming/live/usage changes irrelevant to list summaries.
- Handle new conversations and retirement with correct ordering and cursor semantics.
  Keep loaded older pages, avoid duplicate rows and serialize/correlate overlapping
  refreshes so old results cannot replace newer commits or resurrect retired metadata.
- Keep an ephemeral projection only. No native list index, durable summary mirror,
  invented upstream list-watch API, inference for titles, or permission from metadata.
  Use supported Pi scans/watch primitives and the existing runtime lifetime.

## Acceptance and validation

- Tests cover initial paging, older pages, creation while paging, rename/model change
  on either loaded page, retirement, overlapping delayed reads/commits and disposal.
- List summaries reflect current stored model/title/retirement metadata without
  invoking full agent resolution or causing inference. Active conversation streaming
  does not trigger repeated list hydration.
- Matched fixture measurements show reads caused by initial hydration and a one-row
  metadata update before/after; record counts without turning them into runtime caps.
- Existing selected-view, configuration and history behavior stays intact; full
  native authority restoration before scheduling remains unchanged.

## Comments


### 2026-10-16 — Implementation and focused evidence

- `runtime.ts::listConversations` reads the public stored `AgentDoc` model rather
  than acquiring a conversation handle and resolving its enabled agent. Its optional
  Chord context is read-only; startup binding restoration and execution contexts
  remain unchanged.
- The mounted list consumes public immutable `CommitPublication` values for
  `ChatDoc` title/retirement/authority-reference presentation and `AgentDoc` models.
  Ordinary metadata commits update loaded rows directly, including older pages;
  unrelated live, usage, history and task commits do not hydrate or update the list.
  New conversations and newly attached app documents hydrate only their own row.
  Definition-free document copies use supported document snapshots.
- Serialized list reads preserve the loaded cursor, including its exhausted state,
  while retaining older pages and sorting/deduplicating by conversation identity.
  A transient map retains only commits arriving during the current read so delayed
  pages cannot replace newer title/model/retirement metadata. New-row acquisition
  coalesces repeated commits and adopts app documents attached after its initial
  snapshot was absent. No durable index, retained document mirror, inference or
  per-row watcher was added.
- A public Chord child context owns mounted list reads; disposal cancels it and
  unsubscribes commit observation without aborting submissions, conversations,
  native authority, or Harness close. Selected immutable-history paging and its
  independent selection context remain intact.
- Review found acquisition failures could expose arbitrary exception messages.
  Selected watch/page, latest-input/history reads and list reads now route unknown
  values through the existing safe diagnostics sink and present the fixed message
  `Chat updates are unavailable. Restart the app to reconnect.` Cancellation stays
  silent, diagnostic notices remain observational, and native action errors retain
  their existing path. Plain-message and hostile-getter canaries cover watch/page
  and list acquisition; one list acquisition failure records one notice.

Matched measurement was run **before editing the list implementation** and again
against the same actual runtime/Pi Harness/MemoryStorage fixture: 60 persisted app
conversations, descending first page of 50, followed by one loaded-row title commit.
Counts are API observations for this fixture, not runtime caps or native bridge totals.

| Phase | Conversation scans before → after | Conversation handles before → after | ChatDoc snapshots before → after | AgentDoc snapshots before → after |
| --- | --- | --- | --- | --- |
| Initial 50-row hydration | 1 → 1 | 50 → 0 | 50 → 50 | 50 → 50 |
| One loaded-row rename | 1 → 0 | 50 → 0 | 50 → 0 | 50 → 0 |

The previous AgentDoc snapshots occurred through full agent resolution; the new
ones are direct stored-document reads. The fixture invokes no inference. Initial
document reads are unchanged; the concrete measured reduction is handle/agent
resolution and metadata-update hydration.

Passed `pnpm exec vitest run src/lib/features/chat/pi/runtimeList.test.ts
src/lib/features/chat/ui/piConversationView.test.ts
src/lib/features/chat/ui/chatMessageScroll.test.ts
src/lib/features/chat/ui/composerDraftPersistence.test.ts`: **4 files / 61 tests**.
The new runtime list file has eight cases covering matched measurements, initial
and older paging, creation while paging, loaded-page title/model/retirement,
overlapping delayed reads, repeated hydration commits, delayed app-document
attachment, ignored live/usage/history commits, disposal and safe failures.
Composer persistence intentionally logs its disk-unavailable fixture. No broad
build, native app, simulator, vault, cargo command or commit was run by this ticket;
ticket 06 owns integrated/native/platform acceptance.

### 2026-10-16 — Integrated acceptance

Accepted by ticket 06; see [the verified outcome](../outcome.md). This historical
record is outside the executable backlog. Native guarantees and stated platform
limits remain as recorded there.
