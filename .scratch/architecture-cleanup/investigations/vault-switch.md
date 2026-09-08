# Vault switch and startup architecture investigation

Ticket 14 source wayfinding: the historical `note_timeline.rs:<line>` anchors below predate physical organization. `NoteTimeline::clean_close`, active-root validation, settlement, and surviving-window finalization now live in `note_timeline/administration.rs`; the parent owner and external import surface are unchanged.

Read-only source investigation, 2026-09-07. The post-consolidation dirty workspace is the baseline. No implementation, native runs, database access, commits, or historical scale acceptance were performed. Read AGENTS.md, ARCHITECTURE.md, CONTEXT.md, behavior invariants, ADRs 0005/0008, and codebase-design/SKILL.md plus DEEPENING.md. Source locations below refer to this working tree; symbols are the stable anchors.

## Recommendation

Keep restart-based switching. Resolve one immutable running-vault context at startup. Applying a folder should atomically save the **next-launch selection** while the current vault remains usable; actual Restart must explicitly await the existing frontend persistence/restore barrier, stop producers, clean-close the current timeline, then request process restart. Use one small app-lifecycle operation owner to make concurrent restart requests join and to retain a closed/restart-required outcome if relaunch fails. Do not implement live multi-vault support or a generic resource-container framework.

This intentionally adjusts Apply behavior: today Apply immediately closes the old timeline, changes global root resolution, and leaves the rest of the app running. The new behavior keeps editing the current vault until Restart is requested. Rewrite the immediate-close-on-Apply test as a staged-selection test; preserve clean close before actual release. The behavior invariant requires close before releasing the vault, not before saving a future preference. If this product adjustment is rejected, the alternative is to preserve close-on-Apply and put the entire app into an explicit restart-required state, which has more coordination and less deletion benefit.

The installed restart dependency makes the explicit pre-relaunch barrier mandatory: `node_modules/@tauri-apps/plugin-process/dist-js/index.js:38` (`relaunch`) invokes the process restart command; installed `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-process-2.3.1/src/commands.rs:13` calls `AppHandle::request_restart`; installed Tauri 2.11.2 `src/app.rs:615` requests `RESTART_EXIT_CODE`; `ExitRequestApi::prevent_exit` at `src/app.rs:90` ignores that code. Thus the existing `lib.rs:374` attempt to veto a failed clean close is ineffective for plugin relaunch. This is source-verified, not a native execution claim.

## Actual end-to-end path and coordination count

Count a handoff when another owner/resource has to settle, an external side effect happens, or an asynchronous result is admitted. Do not count every forwarding function, lock statement, emitted field, or Cartesian combination. The current successful full route-to-Settings → Apply → Restart → editable workspace crosses **21 meaningful handoffs**, with **one additional failure-only bootstrap fallback handoff**. Main Apply alone is handoffs **6–14: nine**. Paths with no currently mounted editor omit handoffs 2–4; same-vault Apply skips close handoffs 8–12. This is a workflow inventory, not a runtime call count.

1. Settings navigation intent enters the app-shell navigation owner: `src/lib/ui/NavBar.svelte:76` (`createNavigationCoordinator`) → `src/lib/ui/navigationCoordinator.ts:65` (`request`). It coalesces to the newest requested destination.
2. Navigation awaits the registered pending-work capability: `navigationCoordinator.ts:35` → `src/lib/features/notepad/navigation/pendingNoteSave.ts:15` (`awaitPendingNoteSave`). The singleton callback is installed only while Notepad is mounted; no handler means success.
3. That callback joins an in-flight Version Restore before leaving: `src/lib/features/notepad/Notepad.svelte:1426` (`registerPendingNoteSaveHandler`) → `historyMode.waitForPendingRestore`.
4. It enters the shared workspace save barrier: `Notepad.svelte:1428` → `src/lib/features/notepad/workspace/workspacePersistenceService.ts:28` (`flushAllForNavigation`). It flushes pane cursor timers, cancels autosaves, waits existing document queues, saves dirty documents in parallel, joins queues again, and retries up to three passes. Unresolved external conflict or remaining dirty work rejects departure. The deeper ordinary-save path belongs to the companion save investigation; it is not replayed as dozens of switch handoffs.
5. Successful departure reaches SvelteKit routing and Notepad resource disposal: `navigationCoordinator.ts:54`; `src/lib/features/notepad/orchestration/notepadSessionLifecycle.ts:192`. Disposal calls another fire-and-forget workspace flush at `Notepad.svelte:1461`, then tears down editors. This is duplicate defensive execution, not a second save authority.
6. Apply enters the backend command: `src/lib/features/settings/store.svelte.ts:669` (`saveVaultDirectory`) → `set_vault_directory` → `src-tauri/src/commands.rs:484` (`set_vault_directory_for_state`). **There is no direct frontend departure call inside Apply.** The normal NavBar route has already saved; command safety currently relies on that caller protocol.
7. The command normalizes the request/default and scaffolds the target on disk: `commands.rs:488–497`. The more restrictive iOS-container validation happens later inside `state/config.rs:172` (`set_notes_root`); move all admission before side effects in the cleanup.
8. If canonical target differs from globally resolved active root, the command invokes bound timeline close: `commands.rs:498–503` → `services/note_timeline.rs:3521` (`clean_close`). It validates root against the runtime store and acquires the existing note-file mutation owner.
9. Close stops new timeline operations, cancels background verification, and joins admitted operation leases: `services/note_timeline/runtime.rs:236` (`close_operations`), particularly `:257–265`. This is the timeline barrier, not a whole-app worker drain.
10. Close enters serialized durable settlement: `note_timeline.rs:3525–3528` recovers deletions, replays retained observations, and completes prepared-publication recovery. Successful startup recovery is not rerun against live intents; `runtime.rs:310` (`ensure_history_recovered`) owns that distinction.
11. Surviving Editing Windows are finalized: `note_timeline.rs:3531` → `finalize_surviving_windows`, `:3491`. Wall-clock/continuous-clock origins and stopping the deadline worker remain private timeline responsibilities.
12. Storage records portable status and clean-close sequence, checkpoints, updates the app-local rollback observation, and closes the connection: `services/note_timeline/history_store.rs:3827` (`clean_close`). Errors restore open portability where possible; `:3865` onward. Runtime marks closed/stops workers only on success, `runtime.rs:275–283`.
13. Only afterward the command persists selection: `commands.rs:505` → `state/config.rs:172` (`set_notes_root`) → `write_vault_config` at `:162`. `notes_root` at `:75` now resolves this new preference in ordinary production; `current_vault_info` at `:191` walks the selected target for note count.
14. Result/event admission updates multiple frontend snapshots: `commands.rs:513–516` emits old semantic status and new vault info; `src/lib/app/appStore.svelte.ts:173` updates AppStore; `SettingsStore.#applyVaultInfo` at `store.svelte.ts:148` updates a separate snapshot and preserves its first-seen `activeVaultPath`. `saveVaultDirectory` additionally reloads forgotten retention. The UI at `src/routes/settings/+page.svelte:478` invites restart while saying the app still uses the old path.
15. Restart requests plugin relaunch directly: `store.svelte.ts:236`. No frontend save/restore callback or app-wide worker stop appears here. See installed dependency evidence above.
16. Tauri exit handling checks closed state or closes the timeline; semantic shutdown follows: `src-tauri/src/lib.rs:361–391`. `is_cleanly_closed` is checked outside `clean_close`, duplicating idempotency policy in the caller. Chat cancellation, watcher producer stop, and derived-queue join are not in this path.
17. New-process setup resolves selection and composes resources: `lib.rs:113–155` initializes path globals, scaffolds vault, constructs semantic state, AppState, and ChatService. `src-tauri/src/index.rs:160` (`AppState::new`) resolves global roots again for the private bound timeline store and starts the projection worker.
18. Background setup starts watcher, forgotten cleanup, catalog prewarm, and baseline initialization: `lib.rs:165–214`. Watcher registration captures its root; later background loops resolve it again. This is independent of frontend first paint and bootstrap.
19. Notepad mount asks AppStore to bootstrap and attach listeners: `notepadSessionLifecycle.ts:104–117` → `appStore.svelte.ts:62`. The bootstrap request and event attachment run in parallel; generation/snapshot revisions prevent a late snapshot from replacing newer event data.
20. Bundled bootstrap reads canonical session, vault info, semantic state/revision: `src-tauri/src/commands.rs:774` (`bootstrap_app`) → `src/lib/features/notepad/session/bootstrap.ts:21` (`loadBootstrapPayload`). It is distinct from Rust service construction and history admission.
21. Lifecycle applies the session to document ownership and asset root to editor resources, marks first application, mounts editors and refreshes current note: `notepadSessionLifecycle.ts:113–137`; `Notepad.svelte:1405`; `src/lib/features/notepad/session/runtimeStore.svelte.ts:15`.
22. **Failure-only alternative:** bootstrap rejection fans out to `loadSavedNoteFallback` and `loadAssetRootFallback`, `notepadSessionLifecycle.ts:63,74,118–130`. Session fallback can create an empty snapshot and still mark initial session loaded. On remount, resource config bypasses the already cached bootstrap via another `get_vault_info` call (`:107–108`).

## Comparable workflow census

This is the census to use beside the save/restore report in the main plan. It follows that report's seven owner families and its grouped domain dimensions. **Complete switch: 15 owner families / 39 grouped dimensions / 21 top-level successful handoffs** (plus the one failure-only fallback handoff). These are explicit inventories, not a complexity score, performance result, or theoretical state-space size. Save/restore work is nested, never arithmetically added for every document or retained revision.

### Normalized owner union: 15

The complete switch starts with **all seven save families**, because departure can save a dirty document and startup reestablishes its editor context:

1. **Note Draft State / NotepadState** — working content, identity, baseline, operation/conflict/warning.
2. **WorkspaceStore** — pane references and active context.
3. **EditorDocumentRuntime** — actual live CodeMirror root and undo/revision authority. This is a real overlapping body authority identified by the save investigation; it was incorrectly hidden among resources in the earlier detailed switch census below.
4. **NoteTimelineRuntime** — **one family**, including operation barrier, recovery, target verification, coverage/replacement/corruption, current-content freshness and Editing Window deadlines. Its internal owners remain visible as dimensions, not six top-level authorities.
5. **Canonical Markdown file** — authoritative current bytes and identity, including recovery's filesystem evidence.
6. **Private history Store** — durable publication/capture/lifecycle evidence, manifest selection and portable-close metadata.
7. **Catalog continuity mapping** — remembered Note Identity/path association and generation. Its identity continuity is authoritative evidence; only its search/projection payloads are disposable caches. This corrects the earlier switch resource grouping, which was too broad.

Add eight genuine families outside the ordinary-save boundary:

8. **HistoryModeSession** — joined pending restore and its phase/request exclusion; `Notepad.svelte:1427`.
9. **Settings vault interaction** — local editable path and Apply/picker/Restart operation state; `settings/store.svelte.ts:79–84`.
10. **Persisted next-launch selection** — the configuration preference, currently also used for running-root resolution; `state/config.rs:36,75,172`.
11. **App-shell navigation coordinator** — requested versus settled destination; `ui/navigationCoordinator.ts:17`.
12. **AppStore bootstrap admission** — payload/listener admission and event-versus-snapshot correlation; `app/appStore.svelte.ts:46,57–89`.
13. **Notepad first-session application** — whether the canonical initial session has actually been adopted by a current mount; `session/runtimeStore.svelte.ts:15`, `notepadSessionLifecycle.ts:107`.
14. **App-local history trust observation** — maximum observed generation, store instance and clean-close watermark; `history_store.rs:141`, ADR 0005. It must remain independent from vault-owned Store state.
15. **Durable vault UI/forgotten state** — persisted per-vault UI/lifecycle metadata; `state/persistence.rs:715`. The singleton connection handle is a resource, not a sixteenth authority.

**Main Apply, including its conditional interrupted-work settlement: seven families** — TimelineRuntime, canonical file, history Store, catalog continuity, Settings interaction, selection preference, and app-local trust. The canonical file/catalog are conditional settlement participants rather than a new ordinary edit. The narrow Apply control surface alone is five, omitting those two nested recovery participants; do not present that narrower count as the complete Apply workflow. A same-vault Apply skips most closure work. The complete switch union remains 15, because its departure/bootstrap adds the other eight; a second process instance does not count as another family.

### Normalized dimension union: 39

Use save-and-restore.md's **26 grouped save dimensions unchanged**, rather than re-bundling or splitting them:

1. Working title.
2. Working Markdown.
3. Current identity (`draft/persisted`).
4. Saved baseline (absent/present content+identity).
5. Operation phase (`idle/saving/forgetting/failed`).
6. Operation correlation token.
7. Title-inclusive edit revision.
8. Save wait presentation (absent/`recovery/verification/unavailable/corrupt`).
9. External synchronization (`noConflict/conflict`, including its phase/identity/external snapshot or deletion).
10. Publication warning (absent/present).
11. Workspace note references and active context.
12. Editor live text plus shared undo root.
13. Editor transaction revision.
14. Canonical file state (`nonexistent/original/published/uncertain rollback evidence`).
15. Catalog continuity association/generation.
16. Bound runtime scope (vault/store generation/app-local context).
17. Operation admission (active count, closing, closed).
18. Recovery condition (history recovered, unavailable, released capture pending).
19. Target proof (`missing/Running/Replacing/Ready/Unavailable`, identity).
20. Coverage (`Idle/Running/Complete/Unavailable/Stopped/Settling`, counts/stop).
21. Store replacement/corruption gate (corrupt, replacement revision, replacing store, active replacements).
22. Current-content freshness (generation and active mutations).
23. Durable publication lifecycle (prepared/finalized/abandoned receipt, live/released and token scope).
24. Exact capture outcome (`PendingWindow/Unchanged/Revision`).
25. Window/retained head (pending endpoint, anchor/hash/time/deadline origin).
26. Timeline lifecycle eligibility (active/missing/forgotten/purged).

These references/definitions are the shared save table at `save-and-restore.md`, “Save state dimensions”; the detailed source references there apply unchanged. Add **13 switch-specific grouped dimensions**:

| # | Additional grouped dimension | Values / source |
|---|---|---|
| 27 | History session phase | inactive/entering/open/historyUnavailable/noteUnavailable/exiting/restoring; `historyModeMachine.ts:118` |
| 28 | History request/exclusion | none/page/refresh/diagnostics/diff/restorePreview/restoreCommit and request identity; `historyModeMachine.ts:139`, `Notepad.svelte:1427` |
| 29 | Editable vault selection | local path input; `settings/store.svelte.ts:79` |
| 30 | Settings vault action state | picking/saving/restarting flags, grouped as operation state at the same granularity as save's admission flags; `:82–84` |
| 31 | Settings action error | absent/present failure; `:81` |
| 32 | Persisted next-launch preference | default/explicit configured path; `state/config.rs:36` |
| 33 | App-shell route intent | requested destination plus last settled pathname; `navigationCoordinator.ts:17–19`; the joining promise is a resource |
| 34 | Bootstrap admission status | ready/not ready, with the cached success/failure request outcome; `appStore.svelte.ts:46,59,62`; request execution handle is a resource |
| 35 | Bootstrap event/snapshot correlation | lifetime generation and per-slice snapshot revisions; `appStore.svelte.ts:57–58` |
| 36 | First session adoption | hasLoadedInitialSession false/true; `runtimeStore.svelte.ts:15` |
| 37 | Durable workspace/lifecycle preference data | per-vault app-state records consulted/reestablished during startup; `state/persistence.rs:715` |
| 38 | App-local rollback trust | per-vault greatest observed generation/store-instance/clean-close watermark; `history_store.rs:141` |
| 39 | Portable-close lifecycle | open/portable and monotonic close sequence; `history_store.rs:3827`; distinct from in-process closed flag in dimension 17 |

**Main Apply with conditional settlement: 19 grouped dimensions** — shared save dimensions **14–26** (13), plus **29–32, 38–39** (6). The narrow five-family control surface excludes file/catalog dimensions 14–15, giving 17; use **seven/19** for a main-plan Apply row to retain recovery context. Full switch includes every save dimension because departure may save, rather than assuming the Settings route began clean.

Scoped omissions are deliberate: switch only joins an already running restore, so History Mode's records/page cursors, historical selection/diff/preview/diagnostics and return snapshot are not counted as eight more switch dimensions. They remain inside the separately counted restore workflow; adding them here would silently turn “wait for restore” into “perform the entire history-browsing workflow.” Likewise running chat/proposal/semantic work is not joined by the current switch; its full domain state stays in the companion workflow/resource census. The missing stop/join is a finding, not permission to treat that work as nonexistent. Optional create-vault-folder form fields are a separate precursor interaction. Immutable platform paths, listeners, queue promises, DB connections and cached VaultInfo/semantic views remain resources/projections, not extra authorities. For normalized resource categories, inherit the save report's eight groups and read the additional switch resources below; their earlier broad nine-group partition is not numerically comparable to save's resource partition.

## Detailed subsystem census (earlier granularity; not the comparable total)

The following earlier inspection enumerated **17 subsystem units / 54 finer-grained field groups**, splitting NoteTimelineRuntime internals and bundling document fields differently from the save report. Its Apply control/settlement subset was eight units/28 groups. **Those figures are retained only as a source-level checklist, not top-level owner totals and not comparable workflow dimensions.** Use the normalized **15/39** and **seven/19** above in the main plan. In particular, the earlier grouping misplaced EditorDocumentRuntime and catalog continuity among broad resources; they are explicit authoritative families in the normalized union. The table remains useful for its detailed flags, variants, and source references. Chat and indexing continue alongside switching and are inventoried separately as uncovered producers below.

| # | Authoritative mutable owner | Dimensions counted | Evidence |
|---|---|---|---|
| 1 | NoteDraftState/document machines | **6:** working content; identity `draft/persisted`; saved baseline absent/present; operation `idle/saving/forgetting/failed` (saving wait reason `recovery/verification/unavailable/corrupt`); external sync `noConflict/conflict` with `awaitingChoice/applyingExternal`; publication warning absent/present | `document/documentState.ts:77`, `documentOperationMachine.ts:12`, `documentExternalSyncMachine.ts:8` |
| 2 | WorkspaceStore | **4:** ordered pane membership, active pane, pane kind, note references; cursor timers are resources | `ARCHITECTURE.md` canonical table; `workspacePersistenceService.ts:29` only flushes, does not take ownership |
| 3 | HistoryModeSession | **2 relevant to departure:** phase `inactive/entering/open/historyUnavailable/noteUnavailable/exiting/restoring`; request absent or `page/refresh/diagnostics/diff/restorePreview/restoreCommit` | `features/history/historyModeMachine.ts:118`, `Notepad.svelte:1427`; paging/selection data are outside switch decisions |
| 4 | App-shell navigation coordinator | **3:** requested destination; active drain promise; last settled pathname | `ui/navigationCoordinator.ts:17` |
| 5 | Settings vault interaction | **5:** editable path input; picking flag; saving flag; restarting flag; save/restart error | `settings/store.svelte.ts:79–84`; optional folder-creation UI is outside Apply/Restart |
| 6 | Persisted vault selection | **1:** configured path absent/default or explicit | `state/config.rs:36`, `:152–188` |
| 7 | Timeline operation barrier | **3:** active lease count; closing flag; closed flag | `note_timeline/runtime.rs:13` |
| 8 | Timeline recovery coordinator | **3:** history recovered flag; released capture pending flag; recovery unavailable flag | `runtime.rs:89–91`, `:310–336` |
| 9 | Timeline verification coordinator | **8:** per-note proof `absent/Running/Replacing/Ready/Unavailable`; coverage `Idle/Running/Complete/Unavailable/Stopped/Settling`; stop flag; corrupt latch; runtime scope/generation; replacement identities; whole-store replacing flag; active replacement count | `runtime/verification.rs:8–56`. Verified/known counts are derived, excluded. |
| 10 | Editing Window deadline coordinator | **3:** continuous origin/window map; started flag; stop flag | `runtime/windows.rs:90–100` |
| 11 | Vault-owned timeline persistence | **4:** manifest identity/format/generation; durable history/recovery payload collections; portability `open/portable`; clean-close sequence | `history_store.rs:28–55`, `:3827`; retained intents, observations, windows and revisions belong behind this one persistence authority |
| 12 | App-local history trust observations | **1:** per-vault maximum observed generation/store instance/close watermark record | `history_store.rs:141`, ADR 0005; deliberately independent rollback authority |
| 13 | Current-content freshness coordinator used by publications/settlement | **2:** mutation generation; active mutation count | `runtime.rs:25–33` |
| 14 | Canonical Markdown filesystem | **1:** authoritative bytes/identity at each note path | `ARCHITECTURE.md`, timeline preparation/finalization invariant |
| 15 | Durable vault UI/forgotten state | **1:** vault-specific persisted app-state records | `state/persistence.rs:715–769`; global connection is a resource, not another data authority |
| 16 | AppStore bootstrap admission | **3:** bootstrap promise state; ready flag; lifetime/event snapshot revision identities | `app/appStore.svelte.ts:46,57–59,62` |
| 17 | Notepad first-session application | **1:** `hasLoadedInitialSession` | `session/runtimeStore.svelte.ts:15`, `notepadSessionLifecycle.ts:107` |

Derived snapshots/resource categories, **nine**, are deliberately not added as canonical data owners: (1) AppStore and SettingsStore copies of VaultInfo/semantic status plus computed restart/dirty-input views; (2) editor instances/resource config/cursor timers/document save queues in documentRegistry; (3) registered pending-save callback and event listener/disposal resources; (4) bound history Store path context, scope snapshots and open-store session resource set; (5) STATE_DATABASE connection cache; (6) catalog, lexical, semantic, task and UI retrieval projections/caches; (7) projection worker/deferred retry queues and foreground-yield counter; (8) watcher OS handle, dirty queue and reconciliation thread; (9) running ChatService requests/cancellation/permission resources. The latter is authoritative for chat runs, but the switch currently does not join it. Treating absence from the switch as absence of state would understate its lifecycle risk.

Immutable running-root copies are **not overlapping mutable ownership** on their own: history, semantic and chat legitimately retain their own bound resource paths. Trouble arises because other paths resolve a mutable next selection after construction.

## Confirmed overlap, duplicated coordination, and failure behavior

### A. Running vault and next-launch selection are conflated

`state/config.rs:75` (`notes_root`) reads the preference every call, except the test/E2E override. `state/persistence.rs:752–765` changes the singleton SQLite connection when the resolved path changes. History Store is permanently bound (`history_store.rs:28–55`), SemanticState is constructed from startup paths (`lib.rs:139`), ChatService retains `db_path/notes_root` (`chat.rs:516–521,588–593`), and lexical state stays in the old AppState object (`index.rs:170`).

Watcher context is internally inconsistent, beyond simply being startup-bound: registration captures old root at `vault_watcher.rs:274–294`; the debounce thread rereads global `notes_root()` at `:341`; reconciliation rereads it at `:754` and passes the selected root into the still-old AppState at `:760`. The source demonstrates a split-context execution path after Apply. It does **not** prove a particular user data-loss incident. Runtime timeline path checks correctly reject mismatched canonical mutations (`note_timeline.rs:3418`), so these checks are valuable protection, not the overlap to delete blindly.

Forgotten lifecycle operations explicitly require the selected global root to match the bound store before using selected app-state metadata (`services/note_timeline/forgotten.rs:25,76,81`). This is a compensating caller protocol caused by unbound metadata access. Binding that metadata owner lets these selected-global comparisons disappear while retaining actual path/identity admission.

The test `commands.rs:856` (`vault_switch_cleanly_closes_the_active_note_timeline_first`) sets `NOTES_ROOT_OVERRIDE` at `:862` and never clears it until the test ends. It confirms clean close and saved config, but cannot expose production's change in `notes_root()` after config persistence.

### B. Apply spans irreversible closure followed by fallible preference work

Known failures and source-confirmed outcomes:

- Picker cancellation changes no selection (`SettingsStore.pickVaultDirectory`, `:225`); no asynchronous switch cancellation protocol exists.
- Dirty/conflicted document departure fails before normal navigation to Settings. The NavBar error callback logs failure (`NavBar.svelte:82`); direct route/programmatic Apply is not independently protected by a persistence barrier.
- Target scaffold failure leaves old timeline open. The target may already receive scaffold changes before later validation/close fails.
- Timeline settlement/checkpoint failure retains old config and reopens runtime admission for retry (`runtime.rs:275–283`; `history_store.rs:3865`). Do not flatten this recovery distinction into generic success/failure UI.
- Config write or post-write `current_vault_info` failure happens **after successful timeline close**. Settings reports an ordinary save error and drops `isSavingVault`; the old runtime stays closed. On a failed config write, a retry with another path calls close again and gets “already cleanly closed.” If config write succeeded but the subsequent count/read failed, the user sees failure despite changed durable selection. No typed outcome distinguishes either case.
- A second Apply to another path after a successful first Apply compares against the newly selected global root and asks the old bound timeline to close that new root; the bound-root check rejects it. Applying the same target skips close and may succeed. This behavior depends on which selection/global path is currently exposed.
- Plugin relaunch can bypass the intended exit veto as proven above. It is not sufficient to move closure solely into `RunEvent::ExitRequested` and trust prevent_exit.
- NoteTimeline close only drains its own admitted leases. No stop/join of watcher dirty/reconcile producers or ChatService runs appears in `set_vault_directory_for_state` or the exit path. BackgroundIndexQueue only supports production shutdown via Drop (`services/background_index_queue.rs`, `BackgroundJob::Shutdown` and Drop implementation); it is not drained by NoteTimeline close. Durable history portability must not be advertised as proof that every unrelated cache/AI worker has stopped.

### C. Frontend snapshots duplicate vault/semantic refresh policy

`AppStore.vaultInfo/semanticStatus` and `SettingsStore.vaultInfo/semanticStatus` hold the same backend snapshots (`appStore.svelte.ts:43`, `store.svelte.ts:72–75`). Settings separately applies command results, loads the bundled Settings view, falls back to individual loads, refreshes on visibility and note-change timers, and listens to semantic status. Its `activeVaultPath` is the first loaded selected path (`store.svelte.ts:155`), not an authoritative running path from the backend. A remount after Apply can therefore lose the accurate old/new distinction. `requires_restart` is always true (`state/config.rs:206`) and is a capability description, while the UI reconstructs actual pending change by string comparison (`settings/+page.svelte:77–85`).

Delete the independent backend-snapshot copies; keep editable path input, action status and errors local. A backend context snapshot should report running and next-launch selection separately and derive actual restart-needed state from their canonical identities. One AppStore snapshot/event admission path can serve Settings; it need not become owner of editor data.

### D. Startup fallback preserves old protocols after bundled boot

The first-session lifecycle runs `bootstrap_app`, then on rejection repeats `load_note_session` and `get_vault_info` independently (`notepadSessionLifecycle.ts:118–127`). Settings does the same for `get_settings_view` versus separate semantic/vault/history requests (`store.svelte.ts:314–339`). A single command failure can therefore cause expensive duplicate work or partial snapshots from inconsistent sources. The individual session and vault helpers are only referenced by lifecycle fallback (`session/session.ts:110,115`). This is a concrete deletion candidate, not a reason to remove valid independent background baseline initialization.

`AppStore.#bootstrapPromise` caches rejection until dispose (`appStore.svelte.ts:62–89`), while lifecycle fallback can install an empty document and set `hasLoadedInitialSession`. Attach-listener failures are logged and swallowed by `#attachListeners` (`:179–183`), despite the outer bootstrap comment claiming editable admission waits for listener success. The `Promise.allSettled` listener result ordinarily fulfills even when one channel registration failed. Replace this mismatch with one explicit retryable bootstrap result and required-event admission; do not use fallback RPCs as a hidden alternate startup protocol.

The two normal flags `appStore.ready` and `hasLoadedInitialSession` are **legitimately different dimensions** (backend/event payload ready versus session adopted by mounted editor). Consolidate where state can be represented by the existing bootstrap/adoption operation, but do not delete either merely because both sound like “loaded.” Mount revision/current checks protect obsolete asynchronous effects and must remain.

## Implementation-ready deletion sequence

### 1. Bind all production vault access once

At the Rust composition root resolve a concrete `RunningVault` value containing canonical root/data/app-local observation paths; pass it to AppState, state persistence, watcher and existing semantic/chat constructors. Keep this a concrete data/context value, not a trait registry. Add a concrete vault-owned app-state storage handle inside the existing AppState composition so app-state/forgotten/task projection operations use that handle. Preserve its connection transaction/serialization behavior.

Remove production `STATE_DATABASE` global path-swapping and `state_database_path()` global lookup from operational calls. Replace watcher `notes_root()` rereads with the captured running context. Stop repeated root resolution in `AppState::new`, `bootstrap_app`, ordinary note/lifecycle command operations and exit. Restrict global root override to fixture/composition input instead of using it as a future live-switch seam. `APP_DATA_DIR`/`DOCUMENTS_DIR` startup platform discovery can remain until deleting them produces demonstrated benefit; do not broaden into app-wide dependency injection.

Bind first, keeping current UI semantics temporarily if necessary. Preserve same-identity-across-vault rejection, path canonical alias validation, original generation/intent callback scope, and app-local anti-rollback observations. Update architecture fitness tests from name-based globals to the resulting ownership boundary.

### 2. Split Apply preference from Restart operation

Replace `set_notes_root`/`set_vault_directory_for_state`'s close+write+count protocol with a next-launch-selection operation that validates target, normalizes canonical identity, prepares scaffold only after validation, and atomically publishes config. Return an authoritative selection result without a fallible post-commit note scan. Config failure leaves running state unchanged and usable. Applying the running vault clears pending selection; selecting B then C is allowed. Keep existing persisted config representation if sufficient; a durable migration is unnecessary.

Remove timeline close from Apply, old semantic-status emission on selection save, reloading current-vault retention because a future preference changed, and `VaultInfo.requires_restart = true` as an ersatz operation status. Report running path and selected next path from the backend. Update labels to “Apply folder for next launch” or equivalent concise product copy. Normal note events continue to describe the running context.

### 3. One explicit close-before-restart action

Give the existing app shell/lifecycle coordination a small `restart()` operation. It first joins `awaitPendingNoteSave` (including pending restore) and disables admission of new workspace actions while departure is settling. Then a backend `prepare_restart` operation stops admission of producer work, cancels/settles active chat requests through ChatService's existing cancellation protocol, stops watcher/debounce/reconciliation production, handles already admitted projection work according to durability requirements, and invokes idempotent bound `NoteTimeline.clean_close`. Only after success does the frontend invoke `relaunch`.

Do not make optional derived lexical/semantic catch-up a portability prerequisite: cancel/discard rebuildable queue work safely after durable work is settled; ensure already running task/metadata transactions have completed before releasing resources. Preserve interrupted chat output through existing durable cancellation/continuation semantics. The exact stop/join additions belong privately in existing watcher/queue/chat owners; expose a single lifecycle action to callers, not a register-every-worker framework.

Use explicit action outcomes `idle`, `preparing`, `readyToRestart` (closed), and retryable failure carrying whether closure completed. A relaunch failure after `readyToRestart` must retain this closed state and present Retry Restart; it must never silently enable editing against closed timeline resources. A failure before closure leaves the running context usable after producer admission is restored. A close failure leaves the retry path able to settle evidence without pretending portability. Ordinary exit calls the same idempotent backend close operation as a fallback; remove the outside `is_cleanly_closed`→`clean_close` caller protocol. No assumption that a plugin restart can be vetoed after issuance.

This action adds one explicit application lifecycle owner while deleting the hidden distributed “Apply closed it / config changed / Settings remembers active root / Exit maybe skips close” protocol. It is a justified owner for one bounded operation, not an app-wide state machine.

### 4. Reduce frontend snapshot and bootstrap protocols

Make AppStore the admitted backend running/next-selection snapshot. Settings keeps only local draft input and request/error state; delete `activeVaultPath` first-load memory and duplicate `vaultInfo`/semantic status assignment paths where AppStore already owns the snapshot. Derive pending restart and asset root from the running context; asset config must never switch to next-launch preference on Notepad remount.

Make the bundled bootstrap the sole initial-session retrieval path. Remove `loadSavedNoteFallback`, `loadAssetRootFallback`, their exclusively used `loadSavedNoteSession`/`loadCurrentVaultInfo` helpers, and per-remount vault lookup. A rejected bootstrap should become retryable at AppStore's seam; no empty editable session is admitted as a successful fallback. Treat failed required listener attachment as admission failure and clean up partial registrations on retry. Preserve separate mounted-session adoption and stale-mount cancellation checks. Remove Settings bundled-to-individual fallback once an explicit per-slice error policy exists; independent diagnostic refresh remains valid and should not be absorbed into cold-start gating.

### 5. Replace tests at the resulting seams

Prefer behavior tests around context composition, next-selection update, restart preparation and bootstrap admission. Replace tests of deleted fallback helpers/parallel flag mirroring. Do not accumulate a second layer of mocks for every old helper.

Required cases: A → stage B → continue reading/saving A → restart → bootstrap B; A → stage B → stage C; staging A clears pending restart; alias/same-root selection; invalid iOS target rejected before scaffold; config publication failure leaves A writable; note-count failure cannot recast a committed selection as failure; pending autosave and concurrent edit settle before restart; external conflict blocks restart; pending restore/adoption blocks restart; duplicate Restart joins one transition; verification cancellation precedes operation drain; long admitted save settles then closes; checkpoint/observation failure is retryable and never reports portable; plugin relaunch is not invoked after failed prepare; relaunch rejection after successful close leaves Retry Restart; late watcher/projection callbacks remain bound to A and cannot write B metadata; new process opens only its selected context; bootstrap/listener failure keeps editing unavailable until explicit successful retry; obsolete mount results cannot apply later.

Existing protection to preserve: `commands.rs::vault_switch_cleanly_closes_the_active_note_timeline_first` (rewrite for changed Apply semantics); `note_timeline.rs::failed_clean_close_reports_failure_and_allows_a_retry`; `clean_close_reports_portability_and_stops_new_timeline_mutations`; `editing_window_capture/tests.rs::clean_close_waits_for_active_save_then_finalizes_and_old_runtime_is_inert_after_vault_switch`; `selected_context_deadlines_clean_close_and_reads_ignore_later_global_selection`; `editing_window_capture/tests/readiness.rs::clean_close_cancels_verifier_without_needing_note_file_owner`; workspacePersistenceService tests; navigationCoordinator tests; notepadSessionLifecycle/AppStore tests and contract/architecture fitness tests.

Scoped future validation: relevant Vitest suites plus `pnpm check`; Rust context/config/command and selected timeline close/readiness tests using fresh temporary fixtures, followed by the existing architecture/IPC contract suites. **Do not run any now** as part of this read-only audit. Native lifecycle/relaunch verification and historical scale validation remain separately paused; source-level assurance cannot claim those acceptance results. Test the production no-override root path, not only NOTES_ROOT_OVERRIDE fixtures.

## Risk, rollback and alternatives

Binding app-state metadata affects many read/write call sites and shared task transactions. Migrate the concrete owner before removing old helpers, and review every global path caller with `rg`; maintain one transaction boundary rather than copying connections into feature services. Roll back by reverting the isolated context/plumbing change before subsequent semantics changes, not by allowing both global and bound stores in production indefinitely.

The Apply semantics change is visible and should be stated in the implementation issue. It removes a broken half-switched interval but changes an existing test's expectation. Once a process successfully closes, automatic reopening is deliberately excluded: reopening demands history portability/admission knowledge that belongs to the next startup, and pretending a failed relaunch reopened the current process would recreate duplicate ownership.

An alternative preserving immediate closure requires global frozen UI, explicit cancellation/drain of producers at Apply, idempotent repeated selection updates after close, and recoverable post-close config outcomes. This can be correct but keeps an additional closed-before-restart mode and more failure coordination. A live-switch resource graph would require rebuilding AppState, chat, watchers, document resources and durable stores under generation checks; no current requirement justifies that scope.

Do not delete recovery versus verification versus operation drain versus continuous deadlines: they protect different invariants. Do not merge app-local observations with vault-local metadata: that defeats ADR 0005 rollback detection. Do not remove the private NoteTimeline bound context or path admission while binding the rest of the app; the consolidation's protected scope is the model to extend, not undo.

Remaining measurement hypotheses: how much duplicate bootstrap/settings work costs; how many projection jobs remain at a typical close; whether native OS quit reaches any frontend persistence barrier; precise chat cancellation latency and projection completion behavior; large-vault startup cost of `current_vault_info`'s full note count. Source confirms the paths but no timing, data-loss incidence, or native acceptance result was inferred.
