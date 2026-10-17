# 04 — Use Chord cancellation for disposable conversation observation

Status: ready-for-agent
Execution: implemented
Type: task
Blocked by: none

## Problem and scope

The selected-conversation view manually tracks watches, partial acquisitions and
selection lifetimes while passing a background context to Pi reads. Use Chord's
public cancellation context to own each selection's Pi observation lifetime.
Read the [spec](../spec.md); cancellation of observation must never cancel chat work.

Primary code: `src/lib/features/chat/ui/piConversationView.ts` and its tests;
installed Chord `withCancel`/`withAbortSignal`, Pi watch/read cancellation contracts.

## Work

- Create a child context per selected conversation; cancel the previous selection
  on replacement and the current selection on disposal. Use that context for
  selection-scoped reads, conversation/custom-document watches and older-entry pages.
- Remove manual watch ownership and partial-acquisition cleanup where Pi cancellation
  provides it. Retain only the small guards still needed for native IPC, Svelte
  updates and callbacks whose work is not cancelled by the observation context.
- Treat expected selection cancellation as normal disposal, not a user-facing
  failure. Acquire fresh observation cleanly after rapid reselection or remount.
- Keep submission admission, Stop, withdrawal, retirement and runtime close outside
  the selection context. A submitted run continues after the pane switches, including
  tool work and compaction; retiring authority still invokes the native/Pi abort path.
- Preserve complete immutable-history paging, custom title observation, latest-input
  failure handling, composer retention and the existing pane reading positions.

## Acceptance and validation

- Behavioral tests cover A→B→A switching, disposal during watch attachment, one
  acquisition failing while another succeeds, delayed native authority response,
  delayed page response and Harness failure while observing.
- Superseded watchers terminate and late callbacks cannot mutate the new selection;
  no orphan watcher remains when a cancelled acquisition completes late.
- A run submitted on A survives selecting B and continues displaying on return.
  Stop/withdraw still settle through Pi; actual authority retirement still blocks
  delivery and starts the required fresh context.
- History before compaction remains pageable and selected title/model metadata
  updates remain correct. Existing `piConversationView`, scroll and composer tests
  pass. Record which manual cleanup disappeared and which guards remain justified.

## Comments


### 2026-10-16 — Implementation and focused checks

- Selected conversation observation derives a child with public Chord
  `withCancel` from `@earendil-works/chord/context`. Replacement/disposal cancel
  that context; Pi watches own cancellation even during late attachment.
- Removed the manual watch Set, `stopWatches`, `Promise.allSettled` result
  unpacking and explicit partial-acquisition stop calls. Acquisition failure
  cancels the scope, releasing successful siblings and late attachments.
- Conversation/document snapshots, watches, immutable history pages, latest-input
  scans and run-start task reads use the child. Cancellation does not enter
  submit/configure/abort/withdraw/retirement/close contexts. Complete history
  paging remains independent of the compacted active view.
- Kept selection/lifetime guards for non-cancellable native authority/settings
  calls, callbacks already running, command admission and Svelte updates. Native
  binding is not dispatched after a superseded authority lookup. Expected cancelled
  reads do not surface an error.
- Integrated ticket 03's mandatory diagnostics owner: both watch terminal failure
  paths report curated diagnostics and a fixed restart message, cancel observation,
  and never expose raw watch errors. Runtime availability is a direct subscription
  to the diagnostics owner's actual state; closing/closed/failed owners reject new
  submission/configuration, read-policy changes, title changes, withdrawal and page
  requests without adding a recovery lifecycle. Existing supported recovery is app
  restart, not calling initialize on the resolved failed owner.
- Added behavioral cases for A→B→A with a delayed native title callback, late
  attachment on replacement/disposal and fresh remount, successful watches paired
  with failed page acquisition, delayed native authority and initial/older pages,
  actual Harness storage failure, safe diagnostics and admission rejection, run
  survival after disposal and actual authority retirement. Existing cases retain
  switching/run survival, Stop/background abort, withdrawal, full pre-compaction
  history, title/model metadata and latest-input failure behavior.
- Passed `pnpm exec vitest run
  src/lib/features/chat/ui/piConversationView.test.ts
  src/lib/features/chat/ui/chatMessageScroll.test.ts
  src/lib/features/chat/ui/composerDraftPersistence.test.ts`: **3 files / 49 tests**.
  Composer persistence intentionally logs its disk-unavailable error fixture. No
  broad build, native app, vault, cargo command or commit was run. Ticket 06 owns
  native delivery/retirement and integrated acceptance; these tests use actual Pi
  Harness/MemoryStorage and fixture native-authority adapters.

### 2026-10-16 — Integrated acceptance

Accepted by ticket 06; see [the verified outcome](../outcome.md). This historical
record is outside the executable backlog. Native guarantees and stated platform
limits remain as recorded there.
