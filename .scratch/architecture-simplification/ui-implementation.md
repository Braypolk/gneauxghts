# UI architecture implementation — issues 04, 06, 07

Progress: implemented and focused verification complete; source frozen for coordinator integration acceptance.

## Removed coordination

ChatController now has one aggregate state. Removed its parallel mutable rune fields, flags-to-view patch protocol, independent conversation mutation paths, synthetic started-then-data writes, and separate selection/configuration authority. The aggregate admits selection, configuration, native request data and proposal settlements with their identity before projecting the Readable snapshot. The controller performs transport/subscription effects; specialized agent-event reduction remains intact. Private metadata updates are restricted to independent settings/list/access metadata and display errors; proposal and request failure outcomes have domain events with atomic admission.

Removed public `createConversation` from ChatController and the composer's create-then-send protocol and `creatingConversationFromDraft` effect-timing flag. `send(input)` owns first-message creation and carries the admitted conversation identity and selection revision through request admission. Explicit draft promotion moves unsent text into the durable conversation slot; failed sending keeps the created conversation and text. Send outcomes let the composer clear only its still-current origin. The active-note save barrier remains before send and checks origin identity on return. ChatPanel consumes the existing Readable directly, retaining callbacks and initialization guard.

AppStore's revision admission tokens/methods are private. `loadSettingsView` and `stageVaultSelection` own transport plus shared slice admission; Settings receives feature-local diagnostics and reads the admitted shared snapshot. Settings no longer borrows AppStore's token protocol. Atlas `clearCache` owns backend and local invalidation as one operation.

Atlas no longer treats its detached frontend cache as proof of freshness or stores redundant response visibility. Activation synchronously marks retained data stale before visibility/bootstrap awaits, reattaches observation and requests backend revalidation. Stage-only vault events retain the Running Vault graph and selection. Root's issue08 narrow visibility setter is integrated, avoiding full-record Settings writes.

## Admission review corrections

Root identified synchronous notification navigation as a first-send and completion-effect hazard. Dispatch now returns the admitted state; completion hooks use its conversation, and send retains the created target identity/revision rather than rereading arbitrary current selection. Notifications stop publishing an older snapshot after reentrant state replacement. Request/initialization failures apply error and lifecycle in the same transition. Configuration captures its admitted revision and rejects reentrant replacement.

Independent Standards review identified a stale-display interval before Atlas settings/bootstrap and an old-terminal replay after a newer completion. Both are corrected. Backend run events reject messages already terminal for the same request using retained durable message identity, with no additional retired-request cache. Legitimate retries that reuse a message ID reset provenance when the request changes; they remain accepted. Immediate and older completion/delta replays do not resurrect a run or repeat completion effects.

## Verification

- `ui-focused-final.log`: 32 focused files, 287/287 passed (chat, Settings, Atlas, AppStore and the coordinated NotepadChatCoordinator test).
- `ui-review-regressions.log`: 43/43 controller cases after the final delta replay assertion and retry provenance correction.
- `ui-check-final.log`: svelte-check 0 errors, 0 warnings. This run preceded the final one-condition retry provenance change and its typed regression; coordinator runs final combined checks.
- Existing receipt-before-event, partial listener acquisition/disposal, permission, privacy, proposal, snapshot race, search/polling and Settings behavior cases retained.
- New bounded regressions cover pending open/branch/create superseded by a draft; first-send subscriber navigation; completion callback identity through navigation; duplicate first send and creation followed by failure; local capability lookup superseded by a new draft; promotion with late draft restore; old terminal/delta replay across requests; legitimate same-message retry; delayed Atlas visibility and stage-only vault events.
- Old machine fixture now loads a conversation before submitting, matching the actual admission contract. Two migrated creation tests now assert successful first send rather than silently catching an unconfigured fake failure. Notepad coordinator fixture initializes the real owner through typed fake API instead of assigning mutable proposal fields.
- Initial runs exposed an overbroad summary fixture, an unloaded flags-only machine fixture, and two invalid null user-message receipts; these were fixture errors corrected before green checks. No browser/native/full-suite execution by this owner; coordinator owns integration acceptance. No performance gain claim.

## Size and scope

`ui-metrics.json` compares the saved architecture-phase working tree, not Git HEAD. Eight production files: **254 fewer physical lines**. Ten test/support files: **210 additional lines**, primarily executable admission regressions for the rewritten boundary. No production/helper file split or generic framework was added. Controller plus machine are 1,761 lines versus 1,996; the meaningful reduction is removal of duplicate state authority and caller protocol, not file length. Formatting expands multi-property transition payloads and preserves readable methods; line counts include comments/blanks. Root issue08 API/SettingsPanel changes and other owners' source are excluded from these metrics.

Production paths: chat/controller.svelte.ts, chat/machines/controllerMachine.ts, chat/ChatPanel.svelte, chat/ui/ChatComposer.svelte, chat/ui/composerDraftPersistence.ts; app/appStore.svelte.ts; settings/store.svelte.ts; atlas/atlasStore.svelte.ts. No Notepad.svelte edits by this owner. The documents owner authorized the bounded NotepadChatCoordinator test fixture migration.

Final ownership accounting: documents owner includes notepadChatCoordinator source/test and later teardown regressions in issue01; excluded from UI metric rows to prevent overlap. Root renamed the hosted capability cache to `#capabilitiesByModel` for clarity; no behavior or line delta.
