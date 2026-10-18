# Pi note editing slice — 2026-10-17

Implemented the ordinary model → `read_note` → `edit_note` → optional exact diff
review → native canonical publication path. The earlier
[editing assessment](../pi-vault-editing-assessment/assessment.md) is historical;
this working slice establishes the implementation decision.

## Result and architecture decision

- Reuse the public Pi `createEditTool` factory against one immutable note in a
  memory environment. Pi supplies replacement matching, ambiguity/overlap
  rejection, newline/BOM handling and the patch. No copied matcher, internal
  package imports or general vault filesystem capability.
- Pi owns tool execution and replay, a durable candidate memo, task ownership and
  the conversation review document. Publication task creation and its tool-owned
  reference commit atomically, avoiding a duplicate child after interruption.
- Replace the old one-phase publication task with review and publish phases.
  There is no second application review scheduler, proposal store or hunk engine.
  Review approves or discards the exact candidate; a different candidate requires
  a new tool call.
- Keep native authority, exact issued-source validation, immutable payload proof,
  editor exclusion, NoteTimeline publication and receipt reconciliation. Pi
  continuation alone cannot establish whether an external file write committed.
  Abort reconciles that fact, removes review state and preserves committed truth.
- Replace hidden grant stacking with the UI's explicit modes. Temporary and Off
  atomically remove vault Always permission; active Always is visible in every
  chat. Independently granted Temporary chats remain scoped to their conversation.
  Native policy events and monotonic revision adoption keep mounted views current.

The tool updates existing saved notes by Note Identity and the exact source ID
issued by `read_note`. It verifies canonical path and raw bytes before staging,
and checks the same base again at publication. Write permission is independent
of read access; review defaults on. Dirty editors and changed canonical content
block publication. No create, rename, deletion, shell or arbitrary-path model
capability was added. The existing bounded native create foundation remains
outside the model registry.

Current owners and invariants are recorded in [ARCHITECTURE.md](../../ARCHITECTURE.md),
[behavior invariants](../../docs/architecture/behavior-invariants.md#agent-publication)
and the amendment to [ADR 0012](../../docs/adr/0012-found-ordinary-chat-on-pi.md).
The implementation starts at
[`pi/edit.ts`](../../src/lib/features/chat/pi/edit.ts),
[`pi/editStaging.ts`](../../src/lib/features/chat/pi/editStaging.ts) and
[`pi/publication.ts`](../../src/lib/features/chat/pi/publication.ts).

## Acceptance and verification

The implementation issue is complete: explicit grants, default review, exact read
binding, upstream staged edits, discard/stop, base/editor conflicts, durable review,
safe replay and native committed proof are covered. Independent Standards and
Spec reviews found authority invalidation, hidden Always grants and retired
authority review cleanup defects; these were corrected with regressions. A
follow-up authority response race was corrected with monotonic revision adoption.
Both review axes have no remaining findings after the bounded fix verification.

- Affected chat and frontend architecture suite: **225 tests / 24 files passed**.
  After the final authority race correction and publication cleanup, focused edit,
  publication and view tests passed **58/58**.
- Native Pi tests: **45 passed**; native architecture fitness: **19 passed**.
- E2E support tests: **32 passed**. Svelte check and E2E TypeScript check passed.
- Actual macOS background app: **six editing journeys passed** with the
  deterministic HTTP provider, actual Pi Harness/native storage and generated
  disposable vault. Cases cover apply; discard/stop; changed base; denied writes
  and explicitly disabled review; Always-to-Temporary; and a real process restart
  with the same pending review followed by one committed tool result/receipt.
- The direct-edit native case initially asserted against the preceding turn's idle
  state. Waiting for the new submission in history corrected the test; all six
  cases then passed together. Sandbox loopback restrictions required elevated
  test runs; these were authorized and passed.

Reproduce native acceptance after building the admitted E2E binary:

```sh
GNEAUX_PI_PROCESS_RESTART=1 pnpm exec wdio run e2e/wdio.native.conf.ts --spec e2e/specs/native/piChatEditing.spec.ts
```

These are deterministic integration results, not live-model or foreground gesture
claims. Editing-specific iOS simulator/physical-device acceptance and hosted/live
model behavior were not exercised. Existing unrelated working-tree changes were
preserved; no commit or push was performed.
