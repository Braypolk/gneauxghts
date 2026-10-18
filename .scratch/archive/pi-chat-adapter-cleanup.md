# Pi chat adapter cleanup — 2026-10-17

Implemented the three cleanups authorized after the
[orchestration assessment](../pi-chat-orchestration-audit/assessment.md).

## Outcome

- `pi/runtime.ts` installs the public `conversationCreated` hook. It establishes
  `ChatDoc` and `EditReviewDoc` atomically for every creation/fork, including raw
  transaction creation. Browser and mounted-view fixtures share that hook. No
  old-chat bootstrap or on-open compatibility fallback is added.
- `ui/piConversationView.ts` acquires the metadata watch before native binding,
  reads its initial value, then consumes later changes through the same watch.
  It removes the selection-time metadata snapshot, full agent resolution and
  review-document initialization commit. Model display follows the built-in
  view's `AgentDoc`, including later changes. This closes the earlier
  snapshot-to-watch title/forget gap while retaining selection cancellation.
- View operations trigger transcript merging only when entries change or Pi
  delivers a full replacement frame. Streaming progress retains the loaded
  history array. Initial history merges once; older pages, compaction and observer
  overflow preserve complete loaded human history.

The publication implementation is byte-for-byte unchanged from this task's
starting checkpoint. Native approval, effect reconciliation, editor leases,
authority, source admission and startup scheduling order retain their owners.
Architecture and behavior invariants now describe creation-time initialization
and watch-backed presentation.

## Verification

- `pnpm exec vitest run src/lib/features/chat src/lib/architectureFitness.test.ts`:
  **250 passed in 25 files**, including six new regression cases. They exercise
  atomic raw creation/fork initialization, opening without writes or agent
  resolution, first-review delivery, model changes, metadata changes at attachment,
  streaming with loaded history and Pi's actual bounded-watch overflow replacement.
  Existing selection/disposal failures, compaction paging and retirement checks pass.
- `pnpm check`: **0 errors, 0 warnings**, including E2E TypeScript.
- Fresh `node e2e/support/buildNative.mjs` build succeeded.
- `GNEAUX_PI_PROCESS_RESTART=1` with `runNativeSpecs` for
  `piChatEditing.spec.ts` and `piChatCompaction.spec.ts`: **11 passed** (nine editing,
  two compaction). This includes the first model-issued review, exact approval,
  discard/Stop/conflict/permission behavior, pending review across an actual process
  restart with one committed result, automatic compaction with retained history,
  and Stop joining background compaction. The app ran in the background using
  disposable fixture vaults and the real native SQLite/provider/publication bridges.
- `git diff --check`: clean. Compared the task-start snapshot of
  `pi/publication.ts` with the final file; identical.

One existing sibling-watch cancellation test initially released its failure gate
when the metadata watch attached. Metadata now attaches earlier, so that gate did
not establish that the live sibling watch existed. It now waits for that actual
live-watch attachment and retains the same cancellation assertions. All final
checks above passed after the correction.

Native acceptance uses a deterministic HTTP provider; this makes no live-model,
iOS or physical-device acceptance claim. No native implementation changed in this
cleanup, and the broader Rust suite was not rerun.

## Follow-up: redundant startup metadata operations

Startup now reads the persisted model selection directly from `AgentDoc`, avoiding
full agent resolution for saved conversations. Binding reuses the already-read
provider identity; the installation helper receives the complete native binding
and still validates that tuple before placing it in the routing map. Startup
retains the missing-provider failure, authority retirement checks and scheduling
order. Publication and authority modules are byte-for-byte unchanged from this
follow-up's starting copies.

Validation: the chat and architecture fitness suites passed **256 tests in 25
files**; `pnpm check` passed with zero Svelte errors/warnings and clean E2E types.
`git diff --check` passed. Existing startup tests retain mixed-model restoration,
discovery deduplication and failure-before-scheduling coverage. This small metadata
refactor did not rerun native acceptance or the Rust suite.
