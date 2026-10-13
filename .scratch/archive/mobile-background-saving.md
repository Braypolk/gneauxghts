# Mobile background saving implementation

Completed the first implementation priority in the [iOS readiness plan](../mobile-ios-readiness/spec.md). This record describes bounded validation, not iOS release acceptance.

## Outcome

The app shell routes hidden visibility, pagehide and native mobile suspension notifications through `src/lib/app/backgroundPersistence.ts`. Note and chat owners keep their existing state and persistence queues. Subscriptions are released on unmount, including native listeners acquired after disposal. A failed native listener attachment leaves DOM fallback signals available.

`workspacePersistenceService.flushAllForBackground` cancels autosave debounce timers and requests ordinary document saves independently, joining queued work. Notepad joins a pending History Version Restore first. Protected proposal working copies and unresolved external conflicts remain protected; failed ordinary saves retain dirty text. Backgrounding does not close the Running Vault or invoke relaunch.

The mounted ChatComposer records live unsent text and flushes its persistence owner. Composer writes are serialized per slot across remounts so an older completion cannot overwrite newer text. Flush joins pending writes. Failed text remains in the composer and process cache; the next background request records and retries it. Save failures surface through the existing action-error UI. Backgrounding never submits a chat message.

Current ownership and guarantees are documented in [ARCHITECTURE.md](../../ARCHITECTURE.md) and the [behavior invariants](../../docs/architecture/behavior-invariants.md).

## Validation

- 66 focused Vitest tests passed: background subscriptions and fallback, composer persistence, workspace persistence, real persistence-controller integration, restart lifecycle and architecture fitness.
- 11 mounted browser tests passed: four new background-saving cases and seven existing chat-controls cases. Hidden visibility, pagehide and the synthetic native-event channel dispatch the latest note save before debounce. Backgrounding preserves unsent chat text without sending or creating a conversation.
- `pnpm check` passed with zero Svelte errors or warnings and passing E2E TypeScript checks.
- `cargo check --manifest-path src-tauri/Cargo.toml --lib --offline` passed for the macOS host.

## Material limits

At the initial implementation checkpoint, only the macOS Rust target was installed. A subsequent [iPhone simulator smoke test](../mobile-ios-readiness/simulator-validation.md) compiled the `cfg(mobile)` branch and verified note/chat text in the native vault across backgrounding and process relaunch. That test used temporary icon/launch-screen substitutions and did not isolate event timing or exercise abrupt termination. No physical iPhone tests were performed. Saving remains best effort: iOS can suspend or terminate the process before asynchronous writes complete. Unsent attachments and protected proposal working copies are outside this durability improvement.

The [device release gate](../mobile-ios-readiness/issues/08-ios-device-release-gate.md) retains mobile compilation and real background, lock, kill and resume validation. Sync, sharing and older-device compatibility remain deferred.
