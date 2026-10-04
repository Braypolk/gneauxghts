# Workspace session rewrite — issue01

Status: ready-for-agent
Progress: Implemented; source frozen for independent review and coordinator integration checks.

## Replacement and complexity result

Deleted all ten approved production files. `notepadWorkspaceSession.ts` now owns complete named workspace actions with direct concrete state/workspace/document/save owners. It does not construct any of the removed controllers. Public phase requests, the facade bags, callback initialization cycle, nested public restore/open/kind calls, saved-state bypass flags and paired restore suppression counter are gone.

WorkspaceStore owns four straightforward membership/reference queries (`getEditorPaneIds`, `getNavigationPaneId`, `getPaneIdsForDocument`, `getNextPaneId`). Pure `paneCommandNoteLabel` lives with existing pane view-model derivation. Notepad supplies rendered effects and derived-view refresh/discovery; it supplies no workspace reads/mutations as a callback facade. The private Navigation context contains pane/id/restoring identity plus freshness/departure/release operations; callers cannot construct or sequence one.

The constructor has13 members: six existing concrete owners, two effect groups, pane-count and responsive split configuration, retention preference, review predicate and optional blocked notification. The two effect groups contain16 operations (10 rendered effects,6 derived-view effects including pending proposal discovery), rather than the removed four-controller106 dependency members. These figures compare actual interface burden, not a claim that every old callback was independently necessary.

Readable formatted production metrics against this phase's recorded working-tree snapshot (not Git HEAD): deleted ten modules3315 lines; new owner1405 lines. Including Notepad integration, WorkspaceStore, noteStore, pane label, pane-controller option removal the simplified proposal adapter and route-independent coordinator settlement, affected production is6963→4801 lines (−2162). Relevant tests/support1486→960 (−526). The integration totals include this owner's necessary issue05 proposal wiring; editor runtime/proposal internals are excluded. Exact file rows and snapshot reference: `documents-metrics.json`, `baseline.json`.

## Preserved behavior and replacement coverage

- `notepadComposition.test.ts`16 cases retain actual shared-document membership, last-editor finalization, failed prerequisite saves, committed rename/MRU identity, Remember, Forget/recovery, proposal-aware departure, unrelated pane freshness and external refresh/adoption races.
- `workspacePaneController.test.ts`8 existing real-composition cases now call the session directly: last-pane policy, failed close, collision handling, teardown lifetime/order, creation failure and captured split source. The old departure-notification assertion became a real selected-pane/editor-versus-chat membership assertion because document-root review removed that callback.
- `notepadWorkspaceSession.test.ts`22 semantic cases replace the six removed controller/pipeline test files. They cover recent-seed retry, three chat restore routes, missing previous fallback, seal failure/retry, simultaneous restores with success/failure suppression cleanup, assigned identity before cursor capture, serialized sibling departures with failure, save-only preliminary Previous, superseded same-pane loads, picker no-target/currentness, real activation, nearest-editor/cycling queries and blocked chat restoration retaining its prior conversation/context.
- `paneViewModelFactory.test.ts` retains live filename/title command label derivation. `documentTagConflicts.test.ts` migrates the old partial/cast note-controller fixture to real composition and preserves unchanged-content YAML diagnostic refresh.
- `notepadProposalAdapter.test.ts`9 real-root cases (editor-owned) include no-pane retained review and terminal save success/failure. Generic departure does not save proposal text. `finishReviewDocument` joins queued work, cancels timer, saves dirty terminal edits then releases only a clean unreferenced document. Registry and noteStore retain active review roots. Notepad teardown retires route-local admissions while retaining the global review/root across the defensive save barrier and later remount. Accepted durable settlement remains document-bound.
- Existing persistence, conflict/adoption, History overlay, workspace sequence and editor lifecycle/offscreen reveal tests remain their owners; this rewrite does not collapse the repeat-until-clean workspace persistence barrier into one departure.

Pure pipeline callback-order tests were removed because that callback API no longer exists. Their behavior-bearing assertions moved to real operations; real close teardown, shared departure serialization, stale adoption and failure cleanup remain executable. No synthetic phase test or new miniature workspace state model replaces them.

## Verification

- Initial composition/pane conversion:24 tests pass (`documents-composition-initial.log`).
- New semantic session tests initially16 pass, then18 with direct query and blocked-context cases.
- Final focused command: workspace session, composition, pane lifecycle, persistence, proposal adapter, tag conflicts, pane view model and WorkspaceStore:8 files /89 tests pass (`documents-focused-final.log`). Expected save-failure diagnostic logs are from asserted failure cases.
- `pnpm exec svelte-check --tsconfig ./tsconfig.json`:0 errors /0 warnings (`documents-check-final.log`).
- `rg` under `src` finds no import/reference to the ten deleted factories/phase modules. No browser/native run launched by this owner; coordinator owns combined mounted gates.

## Review notes

A real blocked-context issue was caught while consolidating restoration: a dirty retained chat context could reject its target open while the caller still installed the requested conversation. `openDestination` now reports successful adoption; chat restoration only updates conversation/MRU after success, with a real session regression.

The remaining existing workspacePersistenceService is deliberate: previous mutation evidence proved the attempt/retry barrier's contract differs from one navigation departure. No unreviewed persistence-policy unification was introduced.

## Independent review follow-up and final freeze

The original issue05 deletion contract also required removing the proposal adapter's four writable presentation hooks. They are now replaced by one session-owned `presentReviewDocument({document,noteId,path})` operation. The adapter shrank from its pane callback inventory to six concrete dependencies (workspace, state, commands, editing, rendered capability lookup, optional review session). Its remaining queries are read-only. The operation handles layout policy, source departure, opening/rebinding, rendered readiness and current activation. After a queued departure it rechecks current capacity/membership and retires an unused allocated runtime; a focused race fills available slots while review presentation waits and proves no over-capacity creation.

`reloadReviewDocument(document)` reads the reviewed identity/path, rejects a newer working revision, and explicitly adopts that disk snapshot. It never refreshes the unrelated active note or writes proposed bytes during discard. Editor-owned real composition tests cover no-pane A review / active B and failed disk-read retries. Proposal owner separately verified that a successful durable dismissal followed by reload failure does not repeat dismissal on the third click.

`dispose()` retires active navigation admissions and refresh replies before Notepad tears down rendered owners. A deferred open plus deferred refresh test proves neither late result binds/adopts after disposal. Live-pane behavioral checks use existing pane capability policy; requested destination discriminants remain ordinary kind comparisons.

Final follow-up targeted verification:3 files /49 tests pass (`documents-presentation-final.log`:session20, adapter9, proposal20). Root independently reported combined frontend1128 passing and complete typecheck/E2E types clean before the last small capacity/disposal regression; it owns final mounted acceptance. No compiler/broad suites launched during coordinator motion measurements. Metrics include adapter production in issue01 and exclude editor-owned adapter tests to prevent overlap with issue05's totals.


## Teardown correction (independent Standards blocker)

The first teardown implementation cleared review metadata immediately after starting a fire-and-forget navigation save barrier. Because the barrier awaits save queues, its later dirty-document scan could save unaccepted review bytes. Delaying metadata deletion alone was also insufficient: the module-level Notepad document state survives route remount, leaving proposed bytes without review ownership.

Root approved retaining the same global session/root across route disposal and rebinding callbacks to the next orchestration. Editor owns that lifetime correction and its actual barrier/remount and in-flight-resolution regressions. No normal navigation barrier exclusions were added. This owner removed the remaining durable request dependency on disposable ChatController: commit/dismiss call the existing injected ChatApi and update local proposal projection only while it exists.

Already-admitted durable publication may reconcile after route disposal, but only into the exact retained document still owned by the state map. Ordinary navigation/read callbacks remain retired. A mismatching disk read records an external conflict; terminal save cleanup likewise validates retained document identity before/after its queue wait. These changes keep durable status converging without letting stale UI operations navigate or bind editors.

Focused follow-up:26 tests pass (`documents-durable-review-callbacks-final.log`: workspace session22, coordinator4), including direct durable commit/dismiss after chat teardown and verified/mismatching publication adoption after route disposal. Editor-owned barrier/remount verification is recorded with issue05. Removed the unused public releaseUnreferencedDocument export; clean release remains private behind finishReviewDocument.
