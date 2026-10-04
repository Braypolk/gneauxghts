# Independent proposal Standards review — issue 05

Status: ready-for-agent
Progress: Review complete; disposal/flush/remount blocker corrected and independently reread. No remaining actionable finding in this bounded review.
Reviewer: audit_agent

## Scope and method

Compared current issue05 source with the exact working-tree snapshot `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-architecture-baseline-eaf0pf9r`, not Git HEAD. Read repository code-review and codebase-design guidance, ARCHITECTURE proposal/document ownership and `docs/architecture/behavior-invariants.md` proposal requirements. Inspected EditorDocumentRuntime, reviewExtension, documentRegistry, documentEditingService, proposalOrchestration/session/workflow, workspace presentation/reload/release and Notepad disposal integration. Source owners own the independent Spec review and tests; this reviewer made no reviewed source edits or additional broad test run.

## P1 — disposal removes save protection while the workspace flush is suspended (corrected)

At initial review, `Notepad.svelte:1345–1346` starts `void workspacePersistence.flushAllForNavigation()` then immediately calls newly added `proposalOrchestration.dispose()`. The flush snapshots document references, cancels autosave and awaits `awaitAllSaveQueues()` before evaluating `needsCanonicalSave`. Even with no active saves, that await yields to a microtask. The new disposal at `proposalOrchestration.ts:502–506` synchronously ends the root review and dispatches `disposed`, making `isReviewingDocument` false. The flush then resumes and queues the dirty review body as an ordinary canonical save. Thus leaving the component with a pending proposal can persist unaccepted proposal text. Baseline disposal did not clear the session at this point.

This violates `behavior-invariants.md:760–763`: navigation retains unresolved review working copies and workspace barriers do not persist them. It is a concrete integration defect, not a smell judgement. Sent to root, editor and document owners. Correct cleanup must preserve pending/modified review protection and draft lifetime while flushing ordinary documents; merely removing the root or resetting user-edited review text is not safe. Requested regression using real persistence and review cleanup ordering, including an already-suspended flush. Documents reviewer independently confirms the same root cause extends through remount: singleton notepadState retains proposed body bytes after root/session metadata is cleared, so a later mount can treat them as ordinary dirty content. Snapshotting exclusions for just one barrier or delaying cleanup alone does not close that lifecycle gap; retained ownership must remain coherent on return.

## Other reviewed behavior

The root owns Markdown and hunk coordinates/status once. Pane projection only accepts immutable root snapshots; it does not independently remap. Root dispatch appends projection to the same pane update, preventing a render of old ranges against new text. Root effect-only Keep changes do not increment Markdown revision, invoke Markdown callbacks, create undo entries, or move sibling viewport/selection. Text changes map once and notify the document owner once, even with no mounted pane. Review identity checks reject stale widget actions; registry retention prevents last-pane cleanup from destroying the active root.

Terminal completion ends review retention only after durable resolution, saves remaining ordinary edits, and reclaims only clean unreferenced documents. Follow-on save failures leave dirty state available and report an error without replaying durable commit/dismiss. Admission now rejects edited, partially resolved and conflicted replacement. Reload Disk targets the retained document, checks the read's identity/revision, and adopts canonical bytes rather than saving discarded proposal text. Those three previously reported corrections remain owned by editor/document agents and are not duplicate new findings here.

The complete workspace presentation operation removes the old caller protocol of activating, repurposing, ensuring and focusing panes. Passive proposal arrival only queries existing rendered editor capability. Existing navigation ownership and revision checks remain around asynchronous departure and presentation.

## Smell baseline and validation limits

Applied all 12 code-review smell prompts: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man and Refused Bequest. No additional actionable maintenance finding: the root/projection boundary removes multiple writable hunk/body copies and pane-lifetime choreography; document-bound reload and complete presentation own real invariant work. No generic framework or file-size refactor is recommended.

Owner evidence available during review: prior issue05 focused70 passed, supersession27 passed, root-effect/retention tests, terminal-save error test. These are owner-reported, not a reviewer rerun; none establishes safe Notepad teardown ordering. Coordinator owns combined frontend and browser/native acceptance. The initial readiness blocker is closed by the correction and bounded evidence below; coordinator acceptance remains pending.


## Bounded correction rereview — teardown, remount and admitted completion

Independently reread the final correction in proposalOrchestration, EditorDocumentRuntime, notepadChatCoordinator, notepadWorkspaceSession and their composition tests. No reviewed source edits or broad test rerun.

Disposal now retires only the local orchestrator's new admission/actions; it does not clear a live global review or end root retention. Thus the navigation flush's post-await predicate still recognizes the reviewed document, and the registry still retains its actual root after pane teardown. Unfinished opening is explicitly failed so route retirement cannot leave global admission stuck. A replacement route binds new callbacks to the same root; runtime-owned stable widget delegates forward to the current callback set rather than retaining disposed handlers. Markdown, hunk decisions and undo history are never reconstructed from a second copy.

Already-admitted commit/dismiss continuations use the retained global review identity, independent of the local disposed flag. The global committing/dismissing state still rejects duplicate actions after remount. Coordinator request callbacks use the durable ChatApi directly, so disposing the originating pane controller cannot strand completion. Exact-document adoption and final persistence check the same retained object before/after reads or queue waits. A late commit readback that differs from the committed body establishes external-change protection; it does not claim the competing bytes or perform another commit. Follow-on save failure remains a separate visible failure after durable resolution.

Inspected `/tmp/review-route-lifetime.log`: **35/35 passed** across the root-review, orchestration and real adapter composition suites. The new real composition regression starts the barrier before dispose, confirms only ordinary document B saves while proposed/edited A remains protected, remounts the same A, verifies a single publication callback for further editing, then Undo saves only the remaining ordinary edits and releases review state. A second regression starts a durable commit, disposes/remounts, edits further, attempts Keep again, and verifies exactly one durable commit, idle convergence, and one save of later edits. Coordinator commit/dismiss-after-teardown and exact-document adoption/external-race cases are also present in the additional owner-reported **26 passing** cases; these were source-inspected, with no reviewer rerun claim.

The original P1 is closed for both suspended-flush and next-mount paths. No remaining actionable Standards/correctness finding in this bounded follow-up. Full stable-tree frontend/browser/native acceptance is coordinator-owned.
