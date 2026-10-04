# Independent Spec review — UI aggregate and shared snapshots

Status: ready-for-agent
Progress: Completed read-only review; no remaining actionable Spec finding.
Reviewer: audit_documents
Scope: issues04/06/07 and selected UI-A/B/C requirements in `ui-design.md`, against the architecture-phase working-tree snapshot recorded in `baseline.json` (not Git HEAD). Standards review is independently owned by audit_agent.

## Assessment

The selected replacement is implemented. Chat uses one aggregate state/transition and the existing Readable projection; the controller no longer performs a separate projection patch protocol. Public first send owns durable creation and transport admission. AppStore's public revision-token handoff is gone: named settings-load and vault-stage operations own shared writes. Atlas reopens with retained stale data and a backend revalidation, while staged next-launch selection does not reset a graph for the same running path.

## Evidence inspected

- `chat/controller.svelte.ts` selection/load/create/branch, send/receipt, subscription reentrancy, capabilities/configuration, terminal hook and disposal paths; `machines/controllerMachine.ts` aggregate selection/request admission, draft identity, receipt merge and backend event reduction; `ui/ChatComposer.svelte` canonical note barrier, origin check, promotion slot handling, failed-send preservation and successful clearing.
- Selection start increments selection/configuration identity; new draft retires pending selection. `selectionLoaded` requires the admitted operation. `send` checks selection after durable promotion and after synchronous subscribers can react to submit. A receipt enriches placeholders without replacing already admitted streaming/terminal content. Completion hooks use the accepted state snapshot, so subscriber navigation cannot substitute the newer conversation.
- Existing retained terminal message identity rejects older terminal/delta replay, beyond only the most recent terminal ID. This was an independent Standards candidate already corrected by the UI owner; inspected the final rule and lifecycle regression rather than duplicating its reproduction.
- Composer captures the selection before awaiting active-note persistence and checks it before controller submission; explicit promotion carries the originating draft revision into the durable slot. Failure after durable creation keeps that conversation selected with text/attachments available. UI still owns its input/draft persistence and editor snapshot acquisition; no editor ownership moved into chat.
- `app/appStore.svelte.ts` private per-slice generation/revision admission plus `loadSettingsView`/`stageVaultSelection`; `settings/store.svelte.ts` feature-local lifetime/settings/history guards and cache-clear caller. App-owned global admission may finish after the Settings view closes, but feature-local callbacks guard their lifetime before adopting diagnostics/editable state. Staging returns the currently admitted vault rather than blindly trusting a stale command reply.
- `atlasStore.svelte.ts` initialize/dispose, subscription attachment, running-path comparison, refresh coalescing, cache clearing and polling. Initialize marks a retained response stale synchronously before awaiting visibility/bootstrap, then always requests backend refresh. Sequence/lifetime and requested visibility reject obsolete responses; disposal clears pending timers/subscriptions. Same-running-path vault selection events preserve graph/selection. Search invalidation and pending-generation polling remain owned in Atlas rather than moved into AppStore.

## Coverage and limitations

Read existing controller lifecycle/configuration/receipt cases and aggregate behavior, AppStore/Settings operation tests, and Atlas reopening tests. The accepted known fixes (new-draft/branch admission, duplicate terminals, delayed local capabilities, first-send promotion and reopen freshness) have explicit regressions owned by UI. Root reports combined frontend and typecheck gates passing; browser/native acceptance is running serially under the coordinator. This review did not launch competing broad or mounted suites and does not claim fresh independent mounted results.

No unsolicited new behavior, missing deletion contract or concrete unaddressed admission defect was found in these three issues. Backend atomic chat-settings writer work is separately issue08 and is outside this review's Spec scope.
