# Concurrent split exceeds pane capacity

Status: ready-for-agent
Progress: Complete. Root reproduced expected 3/actual 4; bounded fix passed focused composition, final full frontend and native smoke gates. Independent follow-up review passed.

Spec: architecture-simplification/spec.md requires preserved behavior and one clear owner per operation. The approved workspace design retains maximum pane capacity and asynchronous admission policy.

`notepadWorkspaceSession.ts:905–923` checks capacity before `loadRecentNotes` and MRU seeding await, then completes membership without checking capacity again. Each split gets a distinct pane ID, so per-pane admission does not supersede another split. `WorkspaceStore.completePaneCreation` has no capacity policy. `WorkspaceChoiceController.splitWorkspaceIfAllowed` checks viewport eligibility only; Notepad wires width/height there. `SplitPaneButton` neither disables during pending work nor joins an existing split.

From two panes with maximum three, trigger two splits while their recent-note reads remain pending; both pass the initial check. Releasing both reads creates four visible panes. The related review presentation flow already rechecks capacity after its queue wait, but normal split lacks equivalent protection.

Regression: use the existing real composition fixture, establish two panes, hold the next two `loadRecentNotes` calls, start two splits, release the shared gate, and require exactly three visible panes with invariants intact. Do not replace the store or add a new test harness. Root runs the regression before authorizing production correction.

Correction should retain capacity inside the workspace owner after asynchronous preparation and dispose the unused creating runtime through existing failure cleanup. No production edits authorized yet.

Regression prepared in original checkout: `notepadWorkspaceSession.test.ts`, exact name `keeps pane capacity when two splits finish asynchronous preparation together`. No production changes and no runs by reviewer. It holds both preparation lookups, resolves the shared gate, joins both operations, then asserts configured capacity and real store invariants. Root owns baseline failure confirmation.

Root reproduced the regression (`split-regression-before.log`: expected 3 panes, received 4) and authorized the bounded correction. `splitWorkspace` now checks current capacity after both asynchronous lookups and operation-current validation, before allocating a fresh draft or completing membership. Rejected creation returns through existing `finally` cleanup, which retires the creating membership and disposes its runtime. No new reservation state or dispatcher is added. Source frozen for root validation; no reviewer runs.
