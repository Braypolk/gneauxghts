# UI coordination redesign

Status: ready-for-agent
Progress: read-only design; awaiting coordinator selection. No production or test source changed.
Owner: audit_ui_semantic
Baseline: current working tree recorded in `baseline.json`, after the approved test-complexity reduction; not Git HEAD.

## Recommendation

Make **one coherent ChatController transition own selection, request admission, and the selected conversation projection**. The controller remains the single frontend chat owner and the existing ChatApi remains its transport boundary. This is the major rewrite. Separately, make a bounded Atlas reopen correction and hide AppStore's shared-snapshot revision protocol behind its domain operations. Do not build a common asynchronous-state framework or combine these three owners.

The justification is failed ownership boundaries and caller ordering requirements, not file length. The earlier test cleanup removed redundant cases and adapters; it did not correct these production shapes.

## Evidence and actual defects

### Chat: admission and data mutation are separate protocols

`chat/controller.svelte.ts:316` dispatches to a machine containing lifecycle/selection/request flags, but `:372` patches a separate collection of rune fields and `:389` mutates the selected conversation. Almost every event must first decide whether it is current, dispatch a synthetic machine event, separately update messages/summary/activeRequestId, then notify. A machine transition alone cannot preserve the complete invariant.

Concrete consequences:

1. **New draft does not retire pending selection.** `startNewConversation` at `controller.svelte.ts:884` dispatches `reset` and separately clears conversation data. `machines/controllerMachine.ts:338` resets only the request. A pending `openConversation` remains in selection `loading`; its delayed `opened` is accepted at `controller.svelte.ts:751`, replacing the newly requested draft. Read-only execution of the actual machine through TypeScript transpilation produced:

   ```text
   After new-draft reset: {"kind":"loading","conversationId":"old-conversation","operationId":1}
   Late open still admitted: true
   ```

   This is an executed machine reproduction plus verified controller call path, not a mounted UI reproduction. The public methods permit the sequence; a disabled particular button would not repair the ownership contract.

2. **Branch selection bypasses the selection protocol entirely.** `branchFromMessage` at `controller.svelte.ts:795` awaits backend branch creation and model capabilities, then unconditionally resets request and patches the returned conversation. Another open/new draft can complete during those waits and still be overwritten. Durable creation of the branch may succeed, but that is not authority to navigate the later selection.

3. **Duplicate terminal events can bypass rejection.** Completion at `controller.svelte.ts:555` records `wasIdle`, then proceeds when the machine rejects a duplicate terminal if it was idle. The machine's `lastTerminalRequestId` rejection therefore does not prevent `onAssistantCompleted` from running again. Cancelled/failed repeat the same pattern. An accepted terminal arriving without an observed start must remain supported; duplicate delivery is a separate case.

4. **Configuration targets are incompletely captured.** `setProvider` at `controller.svelte.ts:1299` captures the conversation object, but the draft path validates only that there is still no conversation after local capability loading. It does not capture the draft revision. Starting a new draft during that request can apply the older model to the newer draft. These guards live outside the selection machine, so a new selection operation must independently remember each guard family.

5. **The composer performs controller orchestration.** `ui/ChatComposer.svelte:240` separately creates a conversation and sends. `creatingConversationFromDraft` and the manual `composerContextKey` assignment at `:245–259` compensate for synchronous controller subscribers versus later Svelte effects. Only this production caller uses controller `createConversation` (`rg` across non-test source). The component must know when a draft acquires durable identity and which draft-slot transition may clear unsent text. A second send caller would need to copy this ordering policy.

6. **Two notification models obscure the actual state boundary.** The controller has individual `$state` fields but exports `Readable<ChatControllerState>`, maintains `#subscribers`, constructs snapshots, and calls `#notify` manually. `ChatPanel.svelte:88` then maintains another `$state` snapshot and subscribes at `:133`. The actual callers use the Readable/snapshot contract, not the controller's rune fields. Keeping both gives no demonstrated caller benefit.

These are high-confidence code findings. Items 2–4 were traced statically; do not describe them as independently executed UI reproductions.

### AppStore: the shared snapshot owner exports its implementation protocol

`app/appStore.svelte.ts:161–206` exports `beginSnapshotAdmission` and `admitSnapshot`. Settings must claim slices before invoking a bundled read, keep the token across its own lifetime, split the reply, and remember to admit shared fields (`settings/store.svelte.ts:335–370`). Staging a vault repeats another version of the same protocol (`:770–792`). Those are the only production external admission callers.

This is a demonstrated shallow boundary, not a claim that the current tested revision mechanism is broken. Adding a caller requires teaching it private consistency policy. Settings also knows whether a command reply or an intervening vault event won. The documented sole owner should own the whole shared-snapshot operation, rather than delegate its write protocol to the feature.

### Atlas: cache lifetime and event-observation lifetime disagree

The singleton retains `response` when `dispose()` detaches listeners (`atlasStore.svelte.ts:295–317`). The map route invokes initialize/dispose on mount/unmount (`routes/map/+page.svelte:641,702`). On reopening, `hasCurrentCachedResponse` (`atlasStore.svelte.ts:331`) checks only the stored response's ready/pending flags and matching chat visibility, then `initialize` skips the backend read (`:285–290`). Notes or semantic results may have changed while nobody was listening. An old payload can therefore be declared fresh indefinitely until another event occurs while Map is open.

Static call-path finding; the previous reopen regression tests pending old responses, not a completed cache followed by offscreen edits. AppStore's `indexRevision` alone is not a sufficient replacement key: external note changes and semantic publications need not all advance the same value. The backend `get_vault_atlas` path already owns persisted-input compatibility and published artifacts (`commands/atlas_commands.rs:96`, `semantic/atlas/publication.rs:640`). Do not copy that dependency model into frontend cache keys.

## Major subissue UI-A: one chat state transition, one send operation

### Selected interface

Retain `ChatController` as the feature-facing owner, `subscribe/getSnapshot`, `initialize`, `dispose`, semantic user operations, and `ChatApi` injection. Replace the internal split flags/data model with one aggregate state and one private `transition(state, event)` entry. Effects perform IPC and dispatch typed completion events; they do not write conversation fields directly.

The aggregate holds:

- lifecycle and its initialization identity;
- selection identity and target: draft revision or durable conversation ID, with pending open/create/branch/archive operation;
- the selected conversation, draft configuration, summaries, proposals and capability projection;
- request phase/correlation and message projection;
- configuration identity tied to that selection identity;
- existing grants/policies/error state.

Do not create a second aggregate alongside the current machine. Replace/expand `machines/controllerMachine.ts` into the single chat state transition and remove the former flags-only contract in the same change. The controller's one stored value is that state. `ChatControllerState` remains its read projection; `isSending/isLoadingConversation/activity` are derived, never additional mutable flags. The selected conversation's public `activeRequestId` is derived from admitted request state when projecting the DTO; it is not independently maintained by event handlers. Keep received DTO state in the transport adapter where required for restore, but do not use it as a parallel live controller owner.

Use ordinary immutable state plus the existing Readable notification mechanism. Remove controller rune fields and manual field-by-field `#patch`; notify once per accepted transition. `getSnapshot` stays synchronous for Notepad. The `.svelte.ts` filename may remain during migration to avoid needless import churn; renaming is not the improvement. ChatPanel can consume the Readable directly rather than manually mirror it, retaining an effect solely for the pane conversation-change callback.

A terminal reduction returns its accepted completion information with the state change, so completion/proposal hooks run only for an admitted event. This can be a private closed transition result; it must not become a generic effect runtime. Existing `agentEvents.ts` remains the specialized message-part/run-sequence reducer, used inside the aggregate. Native envelope mapping/terminal receipt bookkeeping in `api.ts` stays: it protects reopening through the adapter and is not the same boundary as currently selected conversation admission.

### First-send ownership

Change controller `send` to accept one named input (`content`, attachments, web flag, active-note snapshot, selected context; draft title remains existing controller draft state). It captures the current selection identity and complete draft configuration synchronously. If this is a draft, the controller owns durable creation followed by send. It must recheck selection identity after each asynchronous boundary; an accepted backend creation may update the list without hijacking a newer selection. Two submits for the same draft join or reject at the owner, before creating duplicate conversations.

Return a small result identifying the accepted conversation and originating draft revision, or failure/obsolete outcome. The successful draft-to-conversation transition also exposes its origin identity in the snapshot while the first send settles. The composer can distinguish that promotion from unrelated navigation by identity, rather than relying on effect timing. It keeps ownership of editable text, attachments, local draft persistence, and obtaining the canonical active-note snapshot through the existing save barrier. The controller does **not** acquire editor/workspace ownership.

On durable creation followed by a rejected send, preserve text/attachments and expose the created conversation for retry; do not orphan its draft slot. On navigation during submit, do not clear the newer composer's text. The returned result and selected-target identity govern whether local clearing is still applicable. Do not claim that two existing IPC commands become one durable backend transaction: request acceptance is already the backend atomic unit, while empty conversation creation remains separately durable.

Remove `createConversation` from the public controller interface after migrating its only production caller; keep a private creation operation. Existing tests that exercise configured creation should now do so through the real first-send operation, preserving their asserted provider/model/reasoning/access payloads. No redundant compatibility forwarding method should survive.

### Exact removals/replacements

| Remove or replace | Replacement/benefit |
| --- | --- |
| Flags-only `ChatControllerMachineState` + separately mutated conversation/draft fields | One aggregate transition owns selection, correlation and projection atomically. |
| `#patch`, `#updateConversation`, `#ifCurrent`, synthetic `started` dispatch copied across stream handlers | One typed event admission and projection path. |
| Controller individual rune fields alongside Readable/manual notification | One immutable state value and one notification per accepted event. |
| Separate controller-side configuration guard protocol | Selection-bound configuration completion event; new draft invalidates it automatically. |
| Public controller `createConversation` + composer create-then-send sequencing | One owner operation for first send and explicit draft-promotion identity. |
| `creatingConversationFromDraft` and manual effect-timing suppression | Identity-based promotion handling; composer still owns its editing state. |
| `wasIdle` terminal bypass | Explicit aggregate rule accepting an unseen terminal once and rejecting duplicates. |

The selection/request/lifecycle identity concepts are necessary and remain, but each is owned once. Do not merely rename their counters or wrap the current handlers in another class.

### Alternatives considered

1. **Add missing guards to the current controller.** Lowest short-term risk and appropriate for an emergency fix. Rejected as this phase's main design because every new operation still coordinates two owners and first send still requires component timing knowledge.
2. **Extract controller handlers into request/selection/configuration stores.** Rejected: creates multiple live owners and more agreement rules. Separate files do not solve admission/data atomicity.
3. **Rune-only controller consumed directly by every caller.** Feasible, but requires broader caller migration and makes the existing non-component Notepad/test snapshot seam less direct. The existing Readable contract already works; keep one notification model, not both.
4. **Selected aggregate with thin effects.** More substantial replacement, but directly eliminates the duplicated decision/write protocol and the demonstrated late-selection defects. No new transport abstraction or third-party state library is needed.

## Bounded subissue UI-B: AppStore owns snapshot operations

Add `AppStore.loadSettingsView()` and `AppStore.stageVaultSelection(path)` that own invoke, private slice-revision claims, and shared-field admission. Move `SettingsViewPayload` into that existing owner module (or its existing bootstrap contract if cohesion warrants it), with type-only fixture imports. Return Settings-only diagnostics/editable defaults from the first method and the currently admitted VaultInfo from staging. Settings retains its local latest-Apply/lifetime guards for editable input and errors, plus history/settings revisions for its own drafts; those protect different state and must not be deleted as duplication.

Make admission methods/types private. Existing bootstrap, refresh and event paths reuse the same private mechanism. No new loader/facade file: that would restore the redundant layer just removed. No wholesale SettingsStore move into AppStore. AppStore owns only the shared snapshots and operations that update them; forgotten recovery, history actions, semantic preference editing and panel state stay with their current feature owners.

An app-owned operation may finish admitting global snapshots after the Settings component closes, provided the AppStore lifetime is current. Its response must not revive the closed Settings view. That distinction should be explicit in tests rather than passing a feature's lifetime token into AppStore.

Also move the complete `clear_atlas_cache` command plus local cache retirement into `AtlasStore.clearCache()`, replacing Settings' current invoke-then-`invalidateCachedResponse` ordering at `settings/store.svelte.ts:744–769`. It is one demonstrated cross-module operation; do not introduce a global command bus.

Alternative: keep two-phase public admission but add stronger token types. Rejected because it improves the spelling of the caller protocol without removing it. A generic `admitAsync` callback is also unnecessary; two named domain operations make their owning contracts explicit.

## Bounded subissue UI-C: Atlas activation always revalidates

Keep the previous response for immediate rendering, mark it stale, and request one backend revalidation on every Map activation. Maintain the existing one-in-flight/coalesced refresh behavior, distinct search debounce and pending-publication poll cadence, and late-response lifetime checks. Remove `hasCurrentCachedResponse` as a freshness authority and `#responseVisibility` if it becomes redundant (visibility changes already discard the response). Do not recreate backend dependency fingerprints in AppStore or a new frontend cache manager.

A staged Next-launch Vault Selection must not be interpreted as a Running Vault change. Compare `VaultInfo.runningPath` for any destructive view reset; updating a selected path alone cannot clear selection or imply new data authority. Revalidation is allowed, but should preserve existing graph selection when returned identities survive.

This adds one IPC/read on reopening Map; it does not imply a cold generation. Backend publication compatibility remains authoritative, and its command does perform real work (interactive-index readiness, activity loading and cached-artifact checks). Validate reopen responsiveness and retain last data while waiting; do not promise it is free. Prefer this small correctness policy to an additional permanent background observer and frontend freshness cache.

## Additional observed seam, not part of the selected major rewrite

Atlas's default visibility saver at `atlasStore.svelte.ts:84–87` reads and rewrites the entire ChatSettings record. ChatSettingsPanel also saves a previously loaded full record (`ChatSettingsPanel.svelte:93–110`), and backend `chat.rs:749` overwrites all ten fields. Local promise serialization protects only Atlas's own writes. A defaults save can therefore restore an old visibility or vice versa. If addressed in this phase, use a separately reviewed atomic field-update backend contract and migrate **both** writers; do not add a speculative frontend global settings store and claim it prevents independent/native writers. This requires backend-owner agreement and is outside the bounded Atlas reopen correction.

## Compatibility, invariants and validation

Read: `ARCHITECTURE.md`, `CONTEXT.md`, `docs/architecture/behavior-invariants.md`, ADR 0001, ADR 0003 and ADR 0009; codebase-design and its deepening guide. The proposal preserves the existing canonical ownership decisions. Update the architecture map to state that the chat transition includes its admitted data and that AppStore operations privately own admission. No new ADR is needed unless the team chooses to change the durable IPC contract or ownership beyond this design.

Required preserved contracts:

- Listener acquisition is joined; failure/disposal releases acquired and late-arriving subscriptions exactly once. Keep `ListenerScope` and its actual acquisition behavior.
- Stream/terminal before send or retry receipt cannot be overwritten or resurrected. Wrong conversation/request/run events remain rejected; restored active requests and missed earlier envelopes remain supported.
- Cancellation, pending permission identity and disposal-driven cancellation are unchanged. Proposal arrival never navigates or bypasses global review ownership.
- Draft configuration is available before persistence; first send uses its captured provider/model/reasoning/access choices. Model changes cannot enter an active response.
- AppStore per-slice event/new-operation precedence, coherent bootstrap/listener admission and Running Vault versus Next-launch Selection remain unchanged.
- Atlas preserves last usable data on transient failure, filters by selected chat visibility, retires obsolete search immediately, and retains polling beyond a fixed attempt count.
- No history/evidence/privacy policy moves from backend to frontend. Existing privacy sentinel and native DTO adapter regressions remain.

Validation replaces superseded internal tests rather than layering another controller suite:

1. Run existing controller behavior, API, configuration, proposal and listener tests against the replacement owner. Migrate flags-only machine cases into aggregate transitions where they express distinct behavior; remove old flags-only implementation/tests after parity.
2. Add targeted regressions for demonstrated missing contracts: delayed open/create/branch followed by new draft/new open; delayed local capability reply across draft replacement; duplicate terminal hook once. Exercise through controller commands/events where practical.
3. Exercise first-send success, creation failure, send failure after successful creation, rapid duplicate submit and navigation during creation through the same public send seam. Preserve composer text/attachments/draft slots; existing browser chat-controls owns mounted interaction acceptance. Coordinate root's E2E owner for changes.
4. Move AppStore admission tests to named operations plus actual event callbacks. Retain current Settings local race tests; closing Settings must not revive local state. Retain native command-events staging/saved-identity acceptance.
5. Atlas: completed cached response → deactivate → underlying change → activate must invoke backend and preserve stale display until new payload; delayed old response cannot replace it. Run existing search invalidation/polling/geometry tests unchanged.
6. Typecheck and focused unit runs first, then coordinator's combined browser/native acceptance. The only experiment performed during this read-only audit was the actual machine trace above; no new tests or source modifications were made.

Implementation sequencing: UI-A first as one replacement (controller + machine + composer/ChatPanel); UI-B and UI-C can follow independently. `Notepad.svelte`/document command changes belong to the documents owner. Its coordinator needs to retain `getSnapshot`/callbacks; any additional caller edits must be coordinated before writing. Success is removal of the old admission/write/caller-ordering protocols, not a target LOC or test count.
