# Generic navigation chooses active chat instead of nearest editor

Status: ready-for-agent
Progress: Complete. Root reproduced chat replacement; nearest-editor correction and active-pane assertion passed focused composition, full frontend and native smoke gates. Independent follow-up review passed.

Severity: P2. Normal note navigation repurposes a chat pane and fails to reveal the chosen body/task destination. No demonstrated data loss.

Requirement: `docs/architecture/behavior-invariants.md:81–84` explicitly sends generic note navigation to the nearest editor when present, otherwise to the active retained-context pane. Architecture simplification requires preserving documented behavior and regression contracts.

Call path: `Notepad.svelte:376–408` chooses nearest editor for `getDocumentSession`; `getOpenContext` at 457–465 passes that document's identity but delegates to `commands.openNotePath` without a pane destination. `navigationSelectionController.ts:51–54` captures nearest editor for post-open target correlation. The workspace command instead selects `workspace.activePaneId`, and `openDestination` converts a chat destination to editor. With chat C active beside editor A, selecting note B therefore replaces C with editor B while the callback still reads A; `openFlow.matchesTarget` rejects A/B and skips section/task reveal.

Introduced-versus-baseline: `git show cb4d4c02:src/lib/features/notepad/orchestration/noteCommandController.ts` lines 538–543 also chose the active pane. This is a retained behavior defect against the stated invariant, not attributed as newly introduced by the command rewrite. The current context-correlation guard exposes the second symptom clearly; it correctly refuses to reveal in the wrong editor rather than causing the original wrong destination choice.

Coverage gap: `notepadWorkspaceSession.test.ts` test `selects the nearest editor for navigation and cycles real workspace panes` asserts only `getNavigationPaneId` and `getNextPaneId`; it never calls `openNotePath` or the real generic-selection flow. Do not count it as protection for action routing.

Proposed bounded regression after approval: active chat with retained context and conversation beside an existing editor; select another note through the generic path; require the existing editor to adopt it, chat kind/conversation/reference retained, and target reveal correlated to the updated editor. Preserve separately intentional pane-local location-history actions and explicit proposal placement. Root decides whether to correct this inherited gap during pre-merge.

Root authorized the baseline regression only. The existing `selects the nearest editor for navigation and cycles real workspace panes` composition case now assigns a retained chat conversation, performs `openNotePath` for B with that chat active, and asserts the chat/reference/conversation survives while the existing editor adopts B. No D2 production change yet. Root runs this baseline test before authorizing correction.

Root confirmed that regression in `workspace-regressions.log` (chat became editor and conversation became null), then authorized the correction. Generic `openNotePath` now selects the existing `workspace.getNavigationPaneId()` and activates that destination inside its admitted navigation action before using the unchanged save/finalize/open/presentation path. A disposed session cannot activate it because `navigate` rejects admission first.

Caller audit: search/recents/related and bootstrap/route opens are generic. Per-pane editor wikilinks activate their invoking editor before calling this operation, so the selector retains that explicit editor. Chat citations already choose and activate their nearest editor, falling back to their own chat when no editor exists; that behavior is preserved. Pane-local Previous/explicit location-history restoration uses private `restoreDestination` and `openDestination` with its own operation rather than this generic API. Proposal presentation likewise calls private `openDestination` with its explicitly chosen pane. No caller signature, persistence barrier, history placement or proposal placement changed.

Both workspace source and regression file are frozen for root integration and checks. No reviewer builds or test runs.
