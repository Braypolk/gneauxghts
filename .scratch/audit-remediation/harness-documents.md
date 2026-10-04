# Frontend architecture and browser harness follow-up

Date: 2026-10-03
Owner: audit_documents
Progress: complete; final integrated acceptance recorded in validation.md

Plans persisted before edits: issues 84a and 83a. Scope transferred by root after document remediation: TS architectureFitness/paneCapabilityWiring, document-and-pane split, image-interactions and animation-navigation instrumentation. Rust fitness and paneMotion/chat-pane-animation/pane-animation/timelineNativeMetrics remain separate owners unless explicitly handed off.

## H2 / CC01 / CC02 / FD09: architecture boundaries

`src/lib/architectureFitness.test.ts` now uses the already-installed TypeScript parser for every source guard. `workspace/paneCapabilityWiring.test.ts` is removed and its meaningful policy checks consolidated here. No new scanner dependency or whole-project TypeScript program. The earlier root removal of the duplicate legacy-field typechecker is preserved; normal Svelte/TypeScript checking remains authoritative for typed legacy-field access.

Retained structural checks:

- WorkspaceStore owns pane order/membership/reference fields; runtime and note stores cannot mirror them.
- HistoryModeSession identifier ownership stays outside workspace/pane/document/runtime modules, and PaneKind cannot grow a history variant. Comments or string labels are ignored. Actual mounted browser focus exclusion now replaces the old exact `inert={historyMode.isActive}` spelling check.
- Document handle stays readonly; working/identity/baseline/operation/sync/publication remain separate structures. Required structure is checked as a subset, so unrelated fields and field ordering are legal.
- Chat operation state remains a machine, with parallel writable operation flags prohibited. Settings may not own **either** backend snapshot field; the old assertion accidentally only rejected both fields together.
- External-sync assignments across production notepad TypeScript must occur in documentState and derive from a reducer call (directly or via its local result variable). Both dotted and bracketed assignments are recognized.
- Pane membership/editor lifetime/proposal workflow require actual reducer calls; editor lifecycle state writes must derive from the reducer. These are call-topology checks, not a substitute for the behavioral transition suites.
- Live-pane literal permission comparisons are rejected in orchestration, including reversed equality, bracket member access, parentheses and local result aliases; source comments/string literals cannot trigger the guard. Pane-role selection cannot import/reference workspace transition policy.
- Document operation reducer uses SaveWaitReason and cannot acquire backend readiness/observer identity types/fields.

Removed spelling guard families and their retained replacement coverage:

| Removed implementation spelling | Production behavior / retained boundary |
| --- | --- |
| Exact NoteDraftState property order/list and historical NoteKey/rekey/transfer helper names | readonly handle + structured ownership AST; noteStore proxy/alias/canonical-collision tests, document registry/runtime lifetime tests and composition Forget/recover/save-rename tests. New private helper names/extractions no longer fail solely by spelling. |
| Exact chat request local variable and old initialize-sequence snippets | chat machine ownership AST; chat controller/lifecycle admission, cancellation and stale-completion tests. |
| Text occurrence of shared departure prepare and removed open-generation helpers | real createNotepadCommands composition: failed save prevents target load, shared final editor departure, independent pane opens and failed nested restoration retry; separate departure/pipeline suites retain ordering and cancellation. |
| Exact external machine phase strings/obsolete wrappers and one textual assignment count | reducer tests cover legal/illegal/stale transitions; document conflict rejection/newer conflict tests; AST validates every production write and actual reducer origin. |
| Public adoption method substrings and bans on private generic helper names/options | documentEditingService operation-specific restore/save/proposal/refresh tests and both DTO adoption-contract tables. Public types retain required entry points; legitimate private normalized adoption extraction is legal. |
| Exact pane assignment counts and removed lifecycle command spellings | reducer call/write AST plus pane lifecycle disposal/stale effects, workspace atomic/reference oracle, live composition last-editor lifetime. |
| Proposal phase literals/old setter/hold-store spellings | real extension-backed orchestration and real adapter tests: second preview identity, mapped hunks, one admitted resolution, retained navigation, sibling/remount state. Workflow reducer and session suites remain distinct. |
| Exact AppStore admission calls and historical bootstrap fallback prose/helpers | AppStore/settings behavioral admission and stale refresh suites, session lifecycle ready/cancel barriers, Settings snapshot ownership AST. |
| `.ui.isEditorReady` source-string ban | `notepadComposition.test.ts` runs real ownership path and proves document binding succeeds despite rendered presentation being unavailable. |

Four scanner mutation tests demonstrate: imported identifier/comment/string cannot satisfy an executable call; harmless call formatting works; direct/reversed/bracket/local-alias permission violations are detected; comments/strings/shadowed unrelated locals are legal; dotted/bracket writes are detected independently of whitespace. These are scoped syntactic checks, not a general interprocedural permission analyzer. Behavior regressions remain the routing oracle.

## H7 / EH08: independently seeded browser scenarios

Removed 916-line `document-and-pane.spec.ts` and moved all assertions/scenarios into:

| New spec | Scenarios |
| --- | --- |
| workspace-document-lifecycle | Forget cancel/confirm, hold-to-Forget, repeated note isolation, note→chat→note scroll restoration |
| workspace-editor-layout | Related-panel move handle geometry; real Markdown task/table/selection/extent fidelity |
| workspace-pinned-notes | Pin ordering/title geometry and modifier search hints |
| history-entry-and-return | editor-only shortcut, menu focus return, three desktop/mobile/Related layouts, exact selection/scroll after refresh, complete restore and undo isolation |
| history-citations | exact retained evidence, bounded older/newer context, no current chat leak and unchanged workspace |
| history-browsing | authored/property/empty/missing-asset diffs; naming/duplicate/remove/cancel focus; paged read-only clear→return→restart lifetime |
| settings-history-maintenance | vault clear/reclaimable storage/purge; external deletion inspection/recovery without collision |

The single 150-line History test was split at independent seed boundaries into three cases. The destructive clear→workspace return→restart flow remains intact. Scenario count becomes 20 from 18 (the layout table still has three cases). AST inventory compared all original and moved `expect(...)` expressions: **117 originals / 117 identical moved expressions**, before adding one actual inert-workspace focus assertion. No original assertion was discarded.

`e2e/support/browserWorkspace.ts` contains only shared driver primitives formerly local to the giant spec. `resetBrowserWorkspace()` first opens inert `/__gneauxghts_e2e_reset`, clears localStorage/sessionStorage on the correct origin, then mounts a fresh app/backend and waits for Alpha's ready editor. Using an inert document prevents live cursor/settings owners from writing previous values back during reset. Window dimensions are seeded too. The reset document is served by the owned E2E Vite middleware before SvelteKit routing, gated by the server token. The helper checks its exact document title before clearing storage. The first attempted support-file URL was rejected by SvelteKit routing (404) in the root run and has been removed; no production public asset is added.

## EH10: scoped instrumentation and artifacts

- Image scenarios use independent storage/app reset. Clipboard instrumentation retains/restores both DataTransfer.setData and the clipboard's own writeText descriptor; finally cleanup removes capture globals, with afterEach fallback. Retained widget-node snapshots are removed after each case. Two routine success screenshots without assertion/artifact owners are removed; all image behavior/geometry assertions remain.
- Navigation animation uses the current full-document `revealEditorTextTarget` adapter (the old focusEditorTarget export was removed by the editor owner). With reduced motion it asserts exactly one CodeMirror scroll effect per text/line target, no additional selection scroll flag and no DOM target/scroller scrolling. Dispatch/DOM/matchMedia hooks retain finally restoration.
- Atlas invoke replacement now has finally restoration and afterEach fallback; Deck prototype interception already had finally restoration and retains it. Existing hover update-count/camera/focus assertions remain.
- Root retains pane/chat animation sampler ownership and bounded renderer deadlines; no concurrent edits or browser launches made here.

## Verification

- `pnpm exec vitest run src/lib/architectureFitness.test.ts`: **12/12 passed**, 134ms test runtime, 482ms command runtime in this shared environment. No performance improvement claim.
- `pnpm exec tsc --project e2e/tsconfig.json --noEmit`: passed.
- `pnpm exec svelte-check --tsconfig ./tsconfig.json`: **0 errors / 0 warnings**.
- AST expectation parity: 117/117 identical moved calls before the new inert focus assertion; original scenario mapping above.
- Scoped `git diff --check`: passed.
- Browser execution is intentionally pending root's serial integration run. No screenshots or browser passes are claimed from typechecking.

## Chat instrumentation handoff (83b)

Root subsequently handed off chat-pane-animation. Its invoke override now restores after each case and startup uses independent workspace reset. CSSStyleDeclaration/MutationObserver instrumentation finishes exactly once, restores on success/error/timeout, cancels its frame callback, and has afterEach fallback. A five-second timer bounds the renderer even if frames stop; successful completion observes one chat, all 100 messages, nonbusy log and ended pane motion for two frames rather than assuming 700ms. Root's existing bounded interruption-frame loop is preserved unchanged. Browser execution remains root-owned.

History-controls follow-up: root browser run passed comparison/naming and restore-busy cases but Clear was not interactable because its disclosure was closed. The test now opens the History tools summary, scopes Clear beneath that disclosure and waits for clickability. It also adopts independent storage reset. Root will rerun the mounted case.


Root browser integration follow-up: the reset support-file route returned404, so it now uses the token-gated Vite middleware above. Chat history fixture explicitly supplies `chat_get_model_capabilities`; strict unknown-command failure had prevented conversation restoration and therefore made the interruption frame impossible. Ready now waits for split-control clickability. E2E TypeScript passed after these repairs. Root rerun requested; no browser success inferred.

## Browser command-contract follow-up (83d)

History-citations restoration additionally required the base seeded revision chat to implement chat_get_model_capabilities; a typed response now supplies that explicit prerequisite. The earlier chat-motion override was separate. Startup failure rendered [object Object] because the fake save rejection invented a structured object, while Rust commands.rs save_note/save_task_note return Result<NoteSession,String> and note_persistence maps HistoryError.to_string(). The fixture now rejects the matching string; no production normalization change is warranted. Focused factory tests assert failed admission leaves canonical notes intact and seeded chat can load capabilities/conversation. `pnpm exec vitest run src/lib/e2e/browserBackend.test.ts`: 5/5 passed. Root owns mounted rerun.

Root mounted verification update: history-citations1/1 and startup-readiness2/2 passed after83d fixture repairs. Root separately reports route geometry both widths, chat motion3, Settings7 and pane13 passing; those runs remain root-owned.

## Rendered editor boundaries (83e)

FE-11 now asserts getComputedStyle on actual bold, italic, strikethrough and nested emphasis leaf text in editor-formatting-load; the first targeted browser run passed all5 formatting cases. EH09 sampling is an explicitly bounded1.2s observation including the deliberately delayed700ms parser, with independent5s timeout, exactly-once callback/cancel cleanup, and restored idle hooks after each case. It no longer depends solely on rAF progressing to end the test.

ED05 new browser route scenario seeds a701-line note, proves destination absent from mounted editor DOM, follows actual List task Open, and requires full destination visibility plus unchanged canonical Markdown. It reproduced a real bug: correct selection12490/12529, scrollTop0. Temporary scoped scroll setter trace records CM reveal19312 followed by lifecycle reset0. Same-runtime replaceEditorContentInPlaceForDocument launched void settleEditorScrollTop and resolved its serialized pane operation early. Awaiting that existing restoration closes the ownership gap; no new polling or scroll implementation. Unit regression failed before correction (0 rather than2000), then editorLifecycle/openFlow23/23 passed. E2E TypeScript and scoped diff-check passed. Final mounted navigation rerun pending root native-window release.

Navigation/Deck instrumentation now imports an explicit browser-only module under src/lib/e2e (Vite resolves identical dependency instances) and has no ResourceTiming/cache URL discovery. The initial e2e/support location was outside SvelteKit's serve allow-list and was removed. Existing effect-count and map-hover cases passed with the new source module in rerun2. Map double-frame sampling now has a2s independent deadline and cancels frames; existing finally restores Deck prototype.

83e final mounted results on isolated browser1434: animation-navigation3/3 passed, including actual offscreen task route reveal; editor-formatting-load5/5 passed, including computed styles and four restoration observations. Same run continues through8 additional root/agent modified harness specs; final aggregate below after completion.

Final serial browser invocation completed in1m41s: **60 passed /1 failed**,9/10 spec files passing. Exact counts: navigation3, formatting5, window-resize2, pane-animation13, animation-cleanup7pass/1fail, editor-route-layout2, chat-pane-animation3, image-interactions11, selection-menu2, editor-cursor12. Only failure is root-owned animation-cleanup retarget displacement threshold (line109:52.742px versus<35); reported immediately to root for follow-up without changing the assertion. All83e owned cases passed. Full log: validation/browser-final-editor-harness.log. Browser1434 stopped and window released to root native validation.

## Final coordinator acceptance

All delegated work in this report is resolved. Earlier integration-pending notes
are chronological evidence; [validation](validation.md) records the completed
combined and targeted checks. Additional ledger discoveries and their closures
are documented in [ledger review](ledger-review.md). No external/live/scale
performance or model-quality result is inferred from deterministic acceptance.
