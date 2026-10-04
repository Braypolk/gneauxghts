# Document-owned proposal review results

Status: ready-for-agent
Progress: Source frozen after independent review corrections; coordinator browser acceptance ongoing.

The shared document root now owns proposal identity, mapped hunk bounds/status, Markdown, and undo history. Each pane renders an immutable root projection. Root updates publish text and projected metadata together before rendering; root effect-only Keep does not increment the Markdown revision or emit another text change. User edits map hunk bounds once, and stale pane initialization cannot overwrite a retained review.

`ProposalReviewRuntime` now contains only request and document. Removed cached editor, hunkSnapshot, workingMarkdown, suspendedMarkdown, the attach/suspend/restore methods and all caller choreography (Notepad integration by documents owner). Deleted reviewDisplay.ts. Removed the pane capability review extension installer, state reader, hunk focus, generic effects/changes and text fallback methods; explicit Review Next uses ordinary focusSelection after resolving a live pane.

DocumentRegistry retention is derived directly from root review metadata. Review text notifications call documentEditing.recordReviewEdit, including with zero panes; search/related views update without autosaving unaccepted text. Terminal and replacement paths call one awaited finishReviewDocument boundary (workspace implementation owned by documents agent): cancel timer, join prior save, persist remaining dirty edits, release only clean unreferenced documents. Tests prove outside-hunk edits survive a closed-pane Undo, failed saves retain the document, replaced/failed reviews release old roots, and already-admitted durable completion can settle after route retirement. Route disposal retains root review/session state and retires only local admission/focus, keeping unaccepted text protected during defensive flushing and remount.

The fake pane-owned review field/listener fixture was replaced with a real EditorDocumentRuntime, real registry resources, real capability adapter and actual CodeMirror state; only the EditorView host remains absent. Obsolete reattachment/snapshot/stale-reader tests were removed after their user outcomes passed through the root and workspace composition. Ordinary workspace persistence flush coverage remains, while old departure-controller wiring was replaced by the actual session-backed proposal adapter navigation test. Added widget identity regression: identical hunk bounds in another review must not retain an action callback for the old review.

Validation:

- Required first proof: 2 files / 13 tests, /tmp/document-review-proof.log.
- Final focused: 9 files / 70 tests, /tmp/review-final.log. Includes proposals, editor runtime/capabilities, document editing and actual proposal/workspace composition.
- Latest typecheck: svelte-check 0 errors / 0 warnings, /tmp/review-final-types.log. A final check after added test assertions is running separately.
- No full suites or UI browser runs performed by this owner; coordinator owns those.

Exact owned-file metrics appear below and in 05-metrics.json. Workspace integration, Notepad.svelte, noteStore, and notepadProposalAdapter.ts belong to issue01 and are excluded here to avoid double counting. The protocol reduction is structural: document-root state replaces four copies/fallbacks, and the actual workspace session now owns one `presentReviewDocument` operation instead of four proposal presentation callbacks.

Remaining acceptance: coordinator browser/native gates. Independent source review covered root synchronization, document release, pending asynchronous placement and route lifetime. No compatibility snapshot path remains.

## Final review corrections and verification

- Edited or partially decided reviews now reject same/other-target supersession; untouched pending previews can still be replaced. Real-root regressions verify no lost outside-hunk edits.
- A retained review reload addresses that exact document through the workspace owner and forced adoption; active unrelated note remains unchanged. Failed read retains review/root/text. Actual composition tests exercise both cases.
- Post-resolution save failures use the existing idle error channel, displayed by ProposedChangesCard, while retaining dirty document data and never replaying completed durable work.
- Confirmed Reload Disk gates continuation on the workflow accepting the event; a third click during pending dismissal invokes neither a second dismiss nor a second read.
- Proposal pane placement is now one named workspace action. Adapter is a read-only concrete-owner projection, without ensure/open/activate/reopen phase callbacks.
- Final broad focused run: 9 files / 74 tests passed (/tmp/review-final-presentation.log). Final change targeted run: 2 files / 30 tests passed (/tmp/review-final-reload.log), including the added third-click admission regression. Root independently reports full Vitest 1128 passed and clean typecheck before that narrow final guard. No broad compiler/test run started during browser acceptance.

## Final route lifetime correction

Independent review found teardown must retain review suppression: the NoteDraftState singleton survives route unmount. Clearing the root/session while an asynchronous defensive flush waits can save unaccepted proposals, and clearing only after that flush still exposes dirty proposal text on remount. Root/session now survive route components. dispose retires only route admission/focus (including a pending opening); constructing the next orchestration binds its document callbacks to the existing root. Runtime-owned widget delegates always dispatch through the current callbacks, so no stale widget closure needs a new pane attachment protocol. Already-admitted commit/dismiss completes once against the retained workflow and exact document identity, even after route disposal. Coordinator request callbacks use stateless ChatApi, not a disposed chat controller.

`05-route-lifetime.log`:3 files /35 tests passed. Real composition proves defensive flush saves ordinary B but never unaccepted A, remount preserves and can resolve outside-hunk edits, and an in-flight commit crosses route handoff without replay while preserving later edits and reaching idle. `05-route-admission.log`:22 proposal tests passed, including the final pending-open disposal regression. `05-reload-typing.log`:10 adapter cases passed before handoff additions, including typing during confirmed disk read. These supersede the initial report's description of clearing root on component teardown and rejecting all late durable acknowledgements. Navigation retirement and durable completion are separate lifetimes.

All production and test source is now frozen for independent re-review and coordinator full/frontend/browser/native gates. No broad test/compiler run was started during motion measurements.

## Final metrics

Physical line counts against the saved architecture-phase snapshot. Adapter production/new workspace session/Notepad/noteStore/coordinator are issue01 integration and excluded. Exact included paths:

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/lib/features/notepad/document/documentEditingService.test.ts` | 502 | 513 | +11 |
| `src/lib/features/notepad/document/documentEditingService.ts` | 361 | 368 | +7 |
| `src/lib/features/notepad/document/documentRegistry.ts` | 46 | 50 | +4 |
| `src/lib/features/notepad/editor/editor.ts` | 49 | 48 | -1 |
| `src/lib/features/notepad/editor/editorCapabilities.test.ts` | 101 | 63 | -38 |
| `src/lib/features/notepad/editor/editorCapabilities.ts` | 288 | 211 | -77 |
| `src/lib/features/notepad/editor/editorDocumentRuntime.ts` | 353 | 445 | +92 |
| `src/lib/features/notepad/editor/editorViewController.ts` | 404 | 393 | -11 |
| `src/lib/features/notepad/editor/testSupport.ts` | 72 | 73 | +1 |
| `src/lib/features/notepad/host.test.ts` | 171 | 169 | -2 |
| `src/lib/features/notepad/orchestration/notepadProposalAdapter.test.ts` | 107 | 251 | +144 |
| `src/lib/features/proposals/documentReview.test.ts` | 0 | 67 | +67 |
| `src/lib/features/proposals/index.ts` | 40 | 29 | -11 |
| `src/lib/features/proposals/proposalEditorTestSupport.ts` | 80 | 27 | -53 |
| `src/lib/features/proposals/proposalOrchestration.test.ts` | 481 | 512 | +31 |
| `src/lib/features/proposals/proposalOrchestration.ts` | 776 | 600 | -176 |
| `src/lib/features/proposals/proposalReviewMachine.ts` | 199 | 199 | +0 |
| `src/lib/features/proposals/reviewDisplay.ts` | 62 | 0 | -62 |
| `src/lib/features/proposals/reviewExtension.test.ts` | 77 | 39 | -38 |
| `src/lib/features/proposals/reviewExtension.ts` | 316 | 297 | -19 |
| `src/lib/features/proposals/reviewSession.svelte.ts` | 99 | 99 | +0 |
| `src/lib/features/proposals/types.ts` | 45 | 29 | -16 |

production: 3038 → 2768 (-270).

test/support: 1591 → 1714 (+123).
