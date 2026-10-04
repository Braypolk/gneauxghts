# Independent backend Standards review — issues 02 and 08

Status: ready-for-agent
Progress: Review complete; both concrete findings corrected and independently reread. Coordinator acceptance gates remain.
Reviewer: audit_agent (independent of issues 02/08; owns issue03 and does not claim independent review of it)

## Scope and evidence

Compared current files against `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-architecture-baseline-eaf0pf9r`, using Python `difflib.unified_diff` of each saved/current file, not Git HEAD. Saved focused diffs are `review-*.diff`. Scope: timeline publication/admission, private tokens, task mutation, proposal canonical commit, History Mode restore, typed atomic create, and chat defaults/Atlas visibility Rust/API/UI/remaining native callers. Read issue02/08 specs, CONTEXT, ARCHITECTURE canonical ownership/write paths, behavior invariants on save/restore/tasks, ADR0002/0006/0008, code-review and codebase-design. No separate coding-standard file was found. Source was read through actual call paths, not just changed hunks. Reviewer made no changes to reviewed source.

## Actionable findings

### P2 — occupied external symlink changes exclusive-create conflict into an error (issue02; resolved)

`services/note_timeline/publication.rs:create_note_at` enters `with_admitted_publication`, which calls `Store::require_path` on the destination at preflight and again under ownership. `history_store.rs:require_path` follows an existing destination with `canonicalize`. A proposed creation path that becomes a symlink to an existing outside-vault file therefore returns `HistoryError::Stale` before `atomic_create_note` can return `AlreadyExists`. `proposal_commands.rs` propagates this as a failed commit instead of the existing occupied-path conflict result.

The old `canonical_agent_commit_target` validated the canonical parent, then `create_new` classified any occupied leaf as conflict. Issue02 explicitly requires a pre-existing file or symlink to remain a conflict and untouched. The retained dangling-link test does not detect a live link pointing outside the vault. Correct by validating the parent scope without following an occupied leaf, recognizing occupancy within owned admission, and retaining atomic no-replace publication for races after the check. Add the live outside-target symlink to the existing timeline creation test. This is a confirmed call-path defect; no overwrite was found, and the reviewer did not claim an executed reproduction. Sent to timeline owner and coordinator.

### P2 — two native fixture callers still invoked the deleted settings command (issue08; resolved)

`e2e/support/liveNative.ts:49` and `e2e/specs/native/chat-typing.spec.ts:21` retained `chat_set_settings` with `{settings}` after command registration moved to `chat_set_defaults`/`{defaults}`. Every enabled use would fail setup with command-not-found. Coordinator changed both callers and explicitly strips `atlasVisibility`; reviewer reread both sites and confirmed `rg` finds no old command in `src`, `src-tauri/src`, or `e2e`. No live-provider or optional measurement execution is claimed; coordinator owns native transport/typecheck gates.

## Standards and design assessment

No additional documented ownership violation found. The timeline now owns preflight/recheck, canonical read, pure transformation, preparation, file publication, receipt failure handling and post-commit convergence as one lifetime. Task/proposal callers no longer carry prepared tokens, runtime leases, filesystem writers, watcher suppression or finalization order. Restore retains its exact authored bytes, selected-origin attachment, fresh identity/hash checks and reserved revision identity in the shared private publication path. Known publication failures abandon; rename rollback failure retains recovery evidence and errors; committed projection/history failure remains a warning. Exclusive-create uses an adjacent fully written file before an atomic no-replace link, eliminating the previous partial destination/cleanup ambiguity.

Issue08 has two actual write authorities, expressed as named SQL updates. Defaults omit visibility both at the Rust DTO/SQL and explicit transport payload; visibility validates its closed accepted modes and updates only that column. No schema, frontend mutex, optional-field patch framework or competing settings owner was introduced. The stale read projection in the form cannot overwrite Atlas visibility through the narrowed API.

Full smell baseline applied as judgement, not quota:

- Mysterious Name / Primitive Obsession: domain operation names and existing typed identities remain explicit; private mode/error distinctions are adequate.
- Duplicated Code / Shotgun Surgery: publication protocol duplication across task/proposal/restore is deleted. Settings migration necessarily crosses one typed IPC seam; the two missed callers above were the actionable omission.
- Feature Envy / Data Clumps / Message Chains: durable path, identity, content and recovery policy now stay with NoteTimeline; caller access/commit-status policy stays with ChatService. No new caller data-mirroring protocol found.
- Repeated Switches / Divergent Change: the private publication mode distinguishes real replace/create/restore semantics. No generic operation-program or repeated caller policy switches were introduced.
- Speculative Generality / Middle Man / Refused Bequest: removed TaskMutationSink/fake sink and token wrappers have no replacement framework. The private admission callback is shared by concrete save/edit/create/restore operations and owns an actual lock/readmission invariant; it is not a pass-through adapter.

## Validation limits and readiness

Source-level standards review is complete. Owner-reported issue02 validation: 40 focused timeline/task/proposal/restore/readiness cases and architecture23 passed before the occupancy correction. Issue08 API29 passed; combined Rust/native checks remain coordinator-owned. Reviewer did not rerun broad suites. Issue03 tests are separately recorded and are not evidence for the reviewed publication/settings paths. The occupied-symlink correction has now been independently reread and its focused regression passed (see final verification); ready for coordinator acceptance gates.

## Final correction verification

Timeline owner changed creation admission to validate parent scope in preflight and owned recheck, and uses `symlink_metadata` under canonical file ownership to return conflict for any occupied leaf before preparing history. The existing atomic no-replace link still handles a target appearing afterward. Reviewer reread both validation phases and the occupancy branch. The owner reports the extended outward-live-symlink/file/dangling-link/failure case passed, paired with authoritative task-read regression: 2/2 in0.18s. No remaining actionable Standards finding in the reviewed scope. The final full timeline gate also revealed an obsolete private test assuming removed token-held leases; owner migrated that test to the real paused save lifetime, which matches the intended boundary. Coordinator owns its combined verification.
