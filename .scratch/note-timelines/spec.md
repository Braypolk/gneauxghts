Status: ready-for-agent

# Automatic Note Timelines

## Problem Statement

People can currently see a note's creation time and latest file-update time, but they cannot understand how the note changed between those endpoints. They cannot inspect earlier content, tell when a currently visible passage was introduced or changed, mark an important version, or safely restore the note after an unwanted edit. Chat has the same coarse temporal picture and therefore cannot answer useful questions about when current knowledge appeared.

The feature must provide durable, granular history without turning editor keystrokes into revisions, flooding chat with removed prose, weakening the Markdown-first nature of the vault, or making ordinary note writes silently succeed without corresponding history. It must also handle changes made by task actions, accepted chat proposals, external editors, rename and forget operations, missing files, recovery, and restoration through one coherent model.

## Solution

Give every managed ordinary note a durable Note Timeline tied to its Note Identity. Each distinct canonical commit of user-authored content becomes a reconstructable Note Revision, while rename, forget, recovery, and similar state transitions become Lifecycle Events. Nearby revisions are grouped into derived Editing Sessions for browsing, but the underlying revisions remain individually retained.

Users can open a global, read-only History Mode to browse the timeline, inspect deterministic diffs, name revisions, and restore the complete user-authored content of an earlier revision. A Version Restore creates a new Note Revision and preserves all intervening history. Current Markdown remains the canonical current state; historical data lives in a vault-owned history store whose initial implementation is SQLite and whose domain records are deliberately portable to a later live-sync-capable format.

Chat can use activity metadata and Current-Content Provenance for content that is still present. It cannot search or quote removed historical prose during ordinary conversation. Only an explicit request in the current user message can grant access to a complete earlier revision, and even then chat can only create a durable Version Restore proposal for user review.

## User Stories

1. As a note author, I want each meaningful autosave to create a Note Revision, so that I can see how my note developed without recording individual keystrokes.
2. As a note author, I want identical canonical content to avoid creating duplicate Note Revisions, so that the timeline contains meaningful states.
3. As a note author, I want changes made by the editor to appear with an Editor Mutation Source, so that I know how they entered the note.
4. As a note author, I want task-driven changes to appear with a Task Action Mutation Source, so that automated task edits remain understandable.
5. As a note author, I want accepted chat proposals to appear with an Accepted Chat Proposal Mutation Source, so that accepted AI-assisted changes are attributable.
6. As a note author, I want externally observed changes to appear with an External Edit Mutation Source, so that edits made outside the app are visible.
7. As a note author, I want restored content to appear with a Version Restore Mutation Source, so that a restoration is distinguishable from ordinary editing.
8. As a note author, I want new notes to have a creation event and a first Note Revision, so that their actual beginning is represented honestly.
9. As a note author importing an existing vault, I want existing notes to receive Baseline Revisions, so that history begins without inventing an earlier past.
10. As a note author importing an existing vault, I want baseline provenance to say when content became known, so that it does not falsely claim when the content was written.
11. As a note author, I want every Note Revision retained until I clear history or the owning note is permanently purged under its configured lifecycle policy, so that storage compaction never discards meaningful history on its own.
12. As a note author, I want nearby revisions grouped into Editing Sessions, so that a long autosave history remains browsable.
13. As a note author, I want each revision inside an Editing Session to remain individually inspectable, so that presentation grouping does not erase granularity.
14. As a note author, I want a session to break after five minutes of inactivity, so that separate periods of work are not presented as one session.
15. As a note author, I want a session to break when the Mutation Source changes, so that edits from different mechanisms remain distinguishable.
16. As a note author, I want Lifecycle Events and Version Restores to break sessions, so that consequential transitions stand on their own.
17. As a note author, I want to give an important Note Revision a durable name, so that I can find meaningful milestones later.
18. As a note author, I want to edit or remove a revision name without affecting content, so that labels remain lightweight annotations.
19. As a note author, I want duplicate revision names to be allowed, so that a label is not mistaken for identity.
20. As a note author, I want to open History Mode without changing my panes or editor state, so that reviewing history does not disturb my work.
21. As a note author, I want History Mode to return me to the exact prior workspace and editor state, so that history review feels temporary and safe.
22. As a note author with unsaved changes, I want the app to flush the current autosave before entering History Mode, so that the history I inspect includes the latest canonical state.
23. As a note author whose save fails, I want History Mode entry to stop and explain the failure, so that I do not browse a misleading timeline.
24. As a note author, I want the selected historical revision to remain pinned when a new revision arrives, so that live activity does not move the version I am inspecting.
25. As a note author, I want the default diff to compare a revision with its parent, so that I can see what changed at that moment.
26. As a note author, I want to optionally compare a selected revision with the current note, so that I can understand the distance from the present.
27. As a note author, I want authored-body changes shown normally in a revision diff while title and path changes remain separate Lifecycle Events, so that revision diffs describe revision content rather than mixing in lifecycle state.
28. As a note author, I want unmanaged frontmatter changes shown in a collapsible properties section, so that metadata changes are available without dominating the diff.
29. As a note author, I want managed Gneauxghts metadata hidden from the diff, so that implementation bookkeeping does not distract me.
30. As a note author, I want each revision summarized using deterministic counts, source, and timestamps, so that summaries are reliable and do not reinterpret my writing.
31. As a note author, I want to see when and where a note was renamed or moved, so that its identity remains understandable across paths.
32. As a note author, I want a rename or move to preserve Note Identity, so that it does not split one note into multiple timelines.
33. As a note author, I want a file that temporarily loses its embedded identity to remain attached to its known timeline, so that metadata damage does not erase continuity.
34. As a note author, I want damaged identity metadata repaired on the next app-owned commit, so that observation does not silently rewrite externally edited Markdown.
35. As a note author copying a note, I want the copy to receive a new identity while the original exists, so that duplicate embedded IDs do not merge separate notes.
36. As a note author, I want an empty managed note to retain its identity, so that clearing its authored content does not detach its history.
37. As a note author, I want a Version Restore to replace the complete user-authored content with an earlier revision, so that restoration has a precise and predictable meaning.
38. As a note author, I want Version Restore to preserve the current Note Identity, title and path, creation time, and active or forgotten status, so that restoring content does not roll back the note's present-day identity and lifecycle.
39. As a note author, I want Version Restore to restore the body and unmanaged frontmatter and receive a fresh update time, so that authored state returns while managed state remains truthful.
40. As a note author, I want a Version Restore to append a new Note Revision, so that no prior history is rewritten or lost.
41. As a note author, I want the app to confirm a direct Version Restore from History Mode, so that replacing current content is deliberate.
42. As a note author, I want a restore preview invalidated when current content changes, so that I cannot confirm a restore against a stale comparison.
43. As a note author, I want editor undo to stop at a Version Restore boundary, so that ordinary undo cannot invisibly cross a historical replacement.
44. As a note author, I want to reverse a restore through the Note Timeline, so that the operation remains durable and auditable.
45. As a note author, I want partial historical recovery to be unavailable, so that Version Restore always means replacing the complete authored content rather than an ambiguous merge.
46. As a note author, I want to manually copy text while browsing History Mode, so that I can still perform a deliberate partial recovery as an ordinary new edit.
47. As a note author, I want forgotten notes to retain their timelines for the recovery period, so that forgetting does not immediately destroy history.
48. As a note author, I want to inspect a forgotten note's timeline from the recovery interface, so that I can make an informed recovery decision.
49. As a note author, I want Forgotten-Note Recovery to be distinct from Version Restore, so that returning a note to the active vault is not confused with replacing its content.
50. As a note author, I want to recover a forgotten note before performing a Version Restore, so that restoration cannot implicitly change lifecycle status.
51. As a note author, I want an externally deleted note represented as a Missing Note until the purge deadline derived from my forgotten-note retention setting, so that accidental deletion follows the recovery policy I already chose.
52. As a note author, I want Missing Notes excluded from ordinary search and chat, so that absent content does not appear current.
53. As a note author, I want to inspect a Missing Note's timeline from the recovery interface, so that I can decide whether to recover or purge it.
54. As a note author, I want recovery to recreate a Missing Note at its last known path when available, so that its location is restored when safe.
55. As a note author, I want recovery to choose a unique nearby path rather than overwrite an existing file, so that recovery cannot destroy current data.
56. As a note author, I want a reappearing file with provable identity and path continuity to reattach to the Missing Note, so that temporary disappearance does not create a duplicate timeline.
57. As a note author, I want a reappearing unrelated file to remain a separate note, so that path reuse does not merge identities.
58. As a note author, I want an unrecovered Missing Note purged when its captured forgotten-note retention deadline expires, so that temporary recovery data follows the same lifecycle policy as forgotten notes.
59. As a note author, I want permanent note purge to delete the entire Note Timeline, so that the note and its retained history are removed together.
60. As a note author, I want to clear one note's history and establish its current state as a new Baseline Revision, so that I can deliberately reset retained history without changing the note.
61. As a vault owner, I want to clear vault history and establish new baselines for active notes, so that I can deliberately reset history at vault scope.
62. As a vault owner, I want clear and purge to take effect logically immediately, so that deleted history is inaccessible even while storage compaction continues.
63. As a vault owner, I want to see allocated and reclaimable history storage, so that background compaction is understandable.
64. As a note author, I want history capture to apply to every managed ordinary note, so that durability and provenance do not depend on an unnoticed per-note or per-vault toggle.
65. As a note author, I want my Markdown to remain readable when the history store is unavailable, so that current notes are not locked inside the history system.
66. As a note author, I want app-owned canonical mutations blocked when their history intent cannot be prepared, so that successful app writes never create silent history gaps.
67. As a note author, I want dirty editor buffers preserved when history is unavailable, so that a history failure does not discard unfinished work.
68. As a note author, I want post-publication history failures reported as warnings without replaying the committed write, so that the app acknowledges the authoritative Markdown state and reconciles safely.
69. As a note author, I want external edits recorded once for every distinct state the app actually observes, so that the timeline is honest about watcher granularity.
70. As a note author, I want external revision times to distinguish observation time from optional filesystem modification time, so that an untrusted file timestamp is not presented as an exact commit time.
71. As a note author, I want external disk content to become canonical immediately when observed, so that conflict handling does not fabricate an alternate current state.
72. As a note author choosing to keep my dirty editor content after an external change, I want that decision to create another Note Revision, so that both observed states remain visible.
73. As a vault owner, I want background reconciliation to detect changes missed by the watcher, so that history converges with the canonical Markdown state.
74. As a vault owner, I want replacement of the history store detected and reconciled, so that restored or moved vault data does not silently diverge.
75. As a vault owner, I want a cleanly closed vault to include its history store, so that a sequential backup or move retains note timelines without requiring a SQLite-specific live-backup feature in the first implementation.
76. As a vault owner, I want existing notes initialized in the background without rewriting Markdown, so that adopting history does not create noisy file changes.
77. As a note author editing before initialization finishes, I want the app to create that note's Baseline Revision synchronously, so that the first new change cannot outrun history.
78. As a vault owner, I want initialization progress visible, so that I know when existing notes have timelines.
79. As a vault owner, I want per-note history usage and health visible in History Mode, so that localized problems are diagnosable.
80. As a vault owner, I want vault-wide history health and integrity status visible in Settings, so that storage problems are discoverable.
81. As a vault owner, I want a corrupt history scope reset to the current note states as new baselines, so that I can recover operation without pretending older provenance survived.
82. As a vault owner, I want reset diagnostics retained outside the replacement timelines, so that the reason for lost history remains explainable.
83. As a chat user, I want chat to answer when currently visible content was introduced or last changed, so that temporal questions about current knowledge are useful.
84. As a chat user, I want chat provenance constrained by the existing vault-access and exclusion policy, so that history does not bypass note permissions.
85. As a chat user, I want ordinary chat to exclude prose removed from the current note, so that obsolete or deleted writing does not create noisy answers.
86. As a chat user, I want to ask which current notes were worked on during a period, so that activity can be found without exposing removed prose.
87. As a chat user, I want activity answers to contain current notes, current excerpts, counts, times, and sources, so that they remain grounded in present knowledge.
88. As a chat user, I want current title provenance available, so that chat can answer when a current note title changed.
89. As a chat user, I want provenance answers to include clickable Revision Citations, so that I can inspect the supporting revision in History Mode.
90. As a chat user, I want a Revision Citation to identify the note, revision, timestamp, source, and current excerpt, so that its evidence is unambiguous.
91. As a chat user, I want historical prose withheld unless my current message explicitly requests a complete Version Restore, so that the model cannot broaden ordinary access on its own.
92. As a chat user, I want an ambiguous or partial restore request to receive an explanation and a request for explicit whole-note intent, so that chat cannot infer destructive authority.
93. As a chat user, I want chat restoration to produce a durable proposal rather than directly change the note, so that I can review the complete replacement.
94. As a chat user, I want a restore grant limited to the current request and selected note revision, so that historical access does not leak into later conversation.
95. As a note author, I want current-content provenance to distinguish introduction, latest change, and return through Version Restore, so that temporal answers reflect what actually happened.
96. As a note author, I want provenance computed at range granularity and presented at useful line or paragraph granularity, so that answers are precise without becoming unreadable.
97. As a note author, I want manually retyped text treated as a new introduction even if it matches old text, so that provenance does not claim an unproved lineage.
98. As a note author, I want moved content to preserve lineage only when continuity is provable, so that ambiguous matches receive conservative provenance.
99. As a note author, I want Markdown formatting edits to update provenance for the affected range, so that authored-state changes are not ignored.
100. As a note author, I want binary attachments left outside first-release versioning, so that Markdown history does not pretend it can restore missing assets.
101. As a note author, I want historical Markdown references preserved and missing assets reported, so that an incomplete historical state is explicit.

## Implementation Decisions

- Introduce one deep `NoteTimeline` module as the canonical seam for ordinary-note mutation coordination, observation, historical reads, Current-Content Provenance, and explicitly granted agent restore access. Existing post-commit mutation coordination is absorbed behind this seam because it is too late to guarantee durable preparation.
- Keep the public boundary small:
  - `mutate(NoteMutation)` coordinates app-owned canonical mutations.
  - `observe(VaultObservation)` records externally observed canonical states and lifecycle changes.
  - `history_mode(NoteIdentity)` provides the read-only human history capability.
  - `current_content(AllowedScope)` provides activity metadata and Current-Content Provenance without removed prose.
  - `agent_restore(ExplicitRestoreGrant)` provides only the historical content required to propose a complete Version Restore.
- Give callers role-limited handles rather than a generic history repository. Ordinary chat must be structurally unable to fetch removed historical prose; only the app-owned explicit restore grant opens the narrow restore capability for the current turn.
- Use closed, versioned Rust domain types and explicit schema migrations. Do not introduce a generic JSON event platform.
- Use one Note Timeline for all ordinary-note mutation paths, including editor saves, task actions, accepted chat proposals, external edits, Version Restores, note creation, baseline initialization, recovery and reconciliation, rename and move, forget and recovery, and missing-note transitions.
- Define the initial closed Mutation Source set as Editor, Task Action, Accepted Chat Proposal, External Edit, Version Restore, Note Creation, Baseline Initialization, and Recovery/Reconciliation. Typed mutation constructors assign sources; callers do not supply arbitrary source strings.
- Create a Note Revision only when the canonical user-authored state is distinct. The restorable authored state is the note body plus unmanaged frontmatter and any future explicitly restorable authored fields. Managed timestamps and identity normalization alone do not create revisions or change provenance.
- Represent title or path changes, forget and recovery, missing and reattachment, purge, and other non-content transitions as Lifecycle Events rather than content revisions.
- Use a dedicated vault-owned SQLite database under the vault's hidden Gneauxghts directory as the first durable history-store implementation, separate from application-state persistence. SQLite is not the permanent portable history format or part of the `NoteTimeline` interface. Current Markdown remains the canonical current note, and the vault watcher must exclude the hidden Gneauxghts directory from note ingestion.
- Keep the `NoteTimeline` interface entirely in closed domain types. Callers must not observe SQL rows, database-generated identities, transaction handles, query ordering, WAL state, checkpoint placement, or storage-format selection.
- Do not introduce a polymorphic `HistoryStore` interface while SQLite is the only implementation. Instead, confine SQLite I/O and schema knowledge to one private internal module, keep revision encoding, reconstruction, integrity verification, and lifecycle policy independent of SQL, and extract a real shared storage interface only when a second implementation exists.
- Give every Note Revision and Lifecycle Event a globally unique opaque domain identity and explicit predecessor or parent references. SQLite row IDs and insertion sequence are storage details and must never become timeline identity, citation identity, or the only source of ordering truth.
- For app-owned writes, durably prepare the timeline intent before publishing Markdown. If preparation fails, fail the mutation before publication and preserve any dirty buffer.
- After Markdown publication, treat the file commit as authoritative. Finalization or required-projection failures return the committed result with a visible warning and schedule reconciliation; they must not replay the write.
- During initial development, do not provide an emergency save-without-history path. This strict fail-closed policy is intended to expose durability-seam failures rather than let development vaults accumulate silent gaps. When mutation is blocked, preserve the draft and allow the user to retry, back up, reset history, or export the draft. Before production release, explicitly review this availability policy using observed failure data; do not add a bypass implicitly while implementing the seam.
- Store verified UTF-8 retain/delete/insert deltas between adaptive compressed full checkpoints. Every revision records base and result BLAKE3 hashes, and reconstruction verifies the expected state. The versioned delta and checkpoint payload encoding must be independent of SQLite table layout so records can move to another durable implementation without reinterpretation.
- Choose the exact delta library, compression algorithm, checkpoint thresholds, and storage parameters through a blocking implementation spike. The spike must benchmark representative and adversarial histories against the agreed scale and latency targets before implementation proceeds. It must also export a representative SQLite history into an immutable-object fixture, reconstruct from that fixture, and prove matching identities and content hashes; this validates the migration shape without implementing live sync or committing to the final object layout.
- Create a checkpoint when bounded replay count, accumulated delta bytes, delta-to-full ratio, or measured reconstruction cost exceeds the selected threshold. The user-visible retention policy remains lossless regardless of checkpointing.
- Use per-revision hashes, transactional constraints, foreign keys, and SQLite integrity checks. Do not build a global tamper-evident hash chain. Derived summaries, Editing Sessions, Current-Content Provenance, usage totals, and search indexes must remain rebuildable rather than becoming SQLite-only sources of truth.
- Do not add separate history encryption. The history store inherits the plaintext vault's security model; any future encryption must be vault-wide rather than unique to this feature.
- Maintain Note Identity across content edits, empty authored content, rename, move, forgetting, recovery, and temporary disappearance. Identity is not derived from path.
- When a known note loses or damages embedded identity metadata, retain its in-memory identity association and repair metadata only during the next app-owned commit. Observation alone must not rewrite the file.
- When a copied file duplicates the identity of an existing note, preserve the original association and assign the copy a new identity. Never allow duplicate identity ingestion to overwrite an existing index association.
- Create a creation Lifecycle Event and first Note Revision for a new note. Create a Baseline Revision for an existing note first encountered during vault initialization.
- A Baseline Revision records `knownSince` at initialization time. Its content ranges have unknown `introducedAt` and `lastChangedAt`; the system must not infer those values from file timestamps.
- Initialize existing notes in the background without modifying Markdown. If a note is mutated before the scan reaches it, synchronously create its Baseline Revision before preparing that mutation.
- No production upgrade path for older development-vault metadata is required. The development metadata may be reset and rebuilt, but schema versioning must correctly support newly created history stores and future explicit migrations.
- Record in-app revisions with an authoritative `committedAt`. Record external revisions with an authoritative `observedAt` and an optional, clearly untrusted filesystem `modifiedAt`.
- External observation records one revision per distinct canonical state actually seen. It must not claim intermediate saves that the watcher or reconciliation scan did not observe.
- On an external edit racing a dirty editor buffer, immediately record the observed disk state as canonical. If the user later chooses to keep the buffer, publish it as a new Editor revision.
- Reconciliation must repair unfinished app-owned history finalization, ingest distinct external states missed by the watcher, and detect history-store replacement after vault backup, restore, or movement. It must be idempotent and never replay an already committed note write.
- Support portable, sequential single-writer vault use. The first SQLite implementation does not support live file synchronization while the history store is open. Concurrent offline multi-device history merging and simultaneous writers against cloud-synchronized copies remain outside the consistency model.
- Open the history database in WAL mode with foreign keys enabled and durability strong enough for a prepared intent to survive a process or power failure before Markdown publication. Exact busy timeout, autocheckpoint, and synchronous parameters belong to the blocking storage spike, but the selected values must preserve that ordering guarantee.
- While connections are open, manage `history.sqlite3` and its `history.sqlite3-wal` and `history.sqlite3-shm` sidecars as one live SQLite store. The main file plus any nonempty WAL contain the durable database state; the SHM wal-index is ephemeral and must never be relied on as backup data. File-sync tools may transport these files, but an arbitrary copy while Gneauxghts is writing is not a supported consistent vault backup.
- On clean vault close, vault switch, or app-owned move, stop admitting new timeline mutations, settle or durably leave recoverable any prepared intents, checkpoint and truncate the WAL, close every history-store connection, and only then report the vault ready to copy or move. Failure to reach that barrier must be visible and must not be reported as a successful portable close.
- Do not add a SQLite-specific live-backup or snapshot workflow in the first implementation. Copying a live SQLite main file alone is not a supported backup; portability begins after the clean-close barrier.
- Record the vault identity, active history format, and history-store generation in the vault manifest and corresponding store metadata. On open, compare them with the last observed generation so replacement, rollback, or a mismatched copied store enters explicit reconciliation or recovery instead of being silently accepted. The manifest is the atomic selector when a later migration changes storage implementations.
- Record clear and purge boundaries as minimal, versioned, storage-neutral deletion markers before physical reclamation. A marker contains stable scope and operation identity plus timing or generation evidence, never deleted prose. It exists to preserve lifecycle and migration correctness and does not keep a purged Note Timeline readable.
- A later storage migration must stop new timeline mutations, open a consistent view of the selected store, export every retained versioned domain record, reconstruct and verify every retained revision from the candidate store, and atomically switch the manifest's history format and generation only after verification succeeds. An interruption leaves the manifest selecting the old store. Retain the old SQLite store read-only until the new store has reopened and passed integrity verification; do not use indefinite dual writes as the migration strategy.
- The anticipated live-sync-capable implementation stores immutable, independently addressable revision, checkpoint, lifecycle, and deletion records in the vault and may use SQLite only as a rebuildable local projection. Its exact object layout and conflict rules require a later evidence-gathering spike and a separate decision; the first implementation must preserve the migration path without pretending that design is already complete.
- Derive Editing Sessions for presentation only. Group consecutive revisions with the same Mutation Source when they are less than five minutes apart. Break on a source change, a five-minute idle boundary, a Lifecycle Event, or a Version Restore.
- Store Named Revisions as editable and removable labels attached to revision identity. Names need not be unique and never duplicate revision content.
- Build History Mode as a global read-only workspace session owned by a dedicated `HistoryModeSession` state machine alongside the normal workspace. It is not an editor/chat pane kind, pane-transient UI, editable document runtime, or alternate workspace mutation.
- Preserve and restore the exact prior workspace, pane, selection, scroll, and editor state when entering and leaving History Mode. Flush autosave before entry and refuse entry when that save fails.
- Keep the selected revision pinned if the timeline changes while History Mode is open.
- Default the diff to selected revision versus its parent. Offer selected revision versus current as an alternate comparison. Defer arbitrary two-revision comparison.
- Render authored-body changes as the primary revision diff. Render unmanaged frontmatter in a collapsible properties section and hide managed Gneauxghts metadata. Show title and path changes only as Lifecycle Events in the timeline; do not splice them into revision diffs.
- Generate Revision Summaries deterministically from authored-content line and character counts, Mutation Source, and timestamps. Generate separate deterministic Lifecycle Event summaries for title or path changes. Do not generate AI-written summaries.
- A human-initiated Version Restore in History Mode requires confirmation and then commits directly through `NoteTimeline.mutate`.
- Version Restore replaces the complete user-authored content with that of the selected revision. It restores body and unmanaged frontmatter, preserves current Note Identity, creation time, title and path, and lifecycle status, and receives a fresh update time.
- A Version Restore always appends a new Note Revision and retains every intervening revision. Bind its preview and confirmation to the current authored-content hash; invalidate and require a fresh preview if current content changes.
- Establish a fresh editor undo boundary after Version Restore. Reversing the operation is another Version Restore through History Mode rather than CodeMirror undo.
- Do not support partial historical content restoration. History Mode may permit ordinary text selection and copying; pasted content then follows the normal Editor mutation path with new provenance.
- Track Current-Content Provenance at internal range granularity and present it at useful line or paragraph granularity. For current content, retain `introducedAt`, `lastChangedAt`, and optional `restoredAt` evidence.
- Preserve provenance across moves only when the correspondence is provable. Treat ambiguous correspondence and manually retyped identical text as a new introduction. Treat formatting changes as changes to affected authored ranges.
- Track current-title provenance through Lifecycle Events.
- Ordinary chat may request Current-Content Provenance and activity metadata only for current notes permitted by existing vault scope and exclusion rules. This access is on demand and is not injected into every conversation.
- Activity queries may return current notes and excerpts plus revision counts, times, and Mutation Sources. They must never return prose that is absent from the current note.
- Return clickable Revision Citations with Note Identity, revision identity, timestamp, Mutation Source, and current excerpt. Opening a citation enters History Mode at that revision.
- Only an app-owned current-turn grant created from an explicit user request for a complete Version Restore can permit chat to read an earlier revision. The model cannot mint or broaden the grant.
- An ambiguous request or a request for only a historical section receives no grant. Chat explains that only complete Version Restore is supported and asks whether the user wants a specific complete earlier revision restored.
- Chat never commits a Version Restore. It creates a durable proposal containing the complete proposed authored replacement for user review through the existing proposal flow.
- Keep chat projection files and chat transcript persistence outside Note Timelines. Chat history remains owned by the existing chat service and its database.
- Retain a forgotten note's timeline for its configured forgotten-note recovery period. Exclude forgotten notes from ordinary chat and search, expose their timelines from the recovery UI, and require Forgotten-Note Recovery before Version Restore.
- Represent an externally deleted file as a Missing Note whose purge deadline is computed from the user's current forgotten-note retention setting when the Missing transition is recorded, matching the existing forgotten-note lifecycle. Persist that captured deadline so a later settings change does not silently rewrite an existing recovery window. Exclude the Missing Note from ordinary chat and search but expose its timeline in recovery UI.
- Recover a Missing Note at its last known path when that path is free; otherwise create a unique, non-overwriting nearby path and append a Lifecycle Event. Require recovery before Version Restore.
- Reattach a reappearing file only when identity and path continuity are sufficient to prove it is the Missing Note. Otherwise ingest it as a separate note. When an unrecovered Missing Note reaches its captured purge deadline, permanently purge the note and its complete timeline through the same lifecycle purge semantics used for forgotten notes.
- Do not version binary assets in the first release. Reconstruct historical Markdown references exactly and explicitly report referenced assets that are no longer present.
- Allow only whole-scope history deletion operations: remove a Named Revision label, clear one note's history, clear vault history, permanently purge a note, or reset corrupt history. Do not support deleting individual revisions.
- Clearing one note immediately makes prior revisions inaccessible and establishes its current state as a new Baseline Revision. Clearing vault history does the same for active notes. Physical page reclamation may occur through bounded background compaction.
- Permanent note purge deletes its complete timeline. Resetting corrupt history establishes current states as baselines with unknown prior provenance and removes affected historical content, names, and citations. Record the reset diagnostic outside the replacement timeline.
- History capture is mandatory for every managed ordinary note in the first release. There is no per-note or per-vault disable switch.
- When history is corrupt or unavailable, keep current Markdown readable and dirty buffers intact, block app-owned canonical mutations, degrade History Mode explicitly, and offer retry, backup, or reset. Never reconstruct from an unverified nearby revision.
- Expose per-note history usage and health in History Mode. Expose vault-wide initialization progress, integrity state, allocated storage, reclaimable storage, and clear-all controls in Settings.
- Design for a 1 MB note, 10,000 revisions on one note, and 100,000 revisions across a vault. Ordinary timeline paging and diff display should complete in approximately 250 ms; deep reconstruction and restore preparation should complete in under one second on supported hardware. Write cost should scale primarily with changed content.

## Implementation Phasing

- Phase 1 is the initial development milestone: the blocking storage and migration-shape spike, Note Identity continuity, the `NoteTimeline` mutation and observation interface, SQLite-backed baseline and revision capture, Lifecycle Events, reconstruction and integrity checks, reconciliation, deletion semantics, clean-close portability, and storage health. It is exercised through tests and diagnostics before broader UI work depends on it.
- Phase 2 is the first user-facing timeline milestone: Editing Sessions, timeline paging, revision and lifecycle summaries, revision-only diffs, Named Revisions, History Mode state preservation, direct Version Restore, and clear or purge controls.
- Phase 3 is a follow-on recovery milestone: forgotten and Missing Note integration, including retention-setting-derived purge deadlines, non-overwriting recovery, reattachment, and lifecycle-aware timeline access.
- Phase 4 is a follow-on provenance and chat milestone: Current-Content Provenance, activity queries, title provenance from Lifecycle Events, Revision Citations, explicit whole-note restore grants, and durable chat restore proposals.
- Phase 5 is a separate storage-evolution milestone: select and implement the immutable portable history format, migrate verified SQLite histories through the manifest generation switch, and support live file sync with one logical writer. Concurrent multi-writer merging is not implied by this phase.
- Phase 3, Phase 4, and Phase 5 require their own implementation tickets and are not required to validate or ship the Phase 1 foundation. Do not pull them into earlier work merely because their eventual interface is described here.
- These phases are implementation and verification gates, not alternate architectures. Later phases must use the same `NoteTimeline` interface and may not introduce temporary write paths, unrestricted history reads, or second owners for canonical state. A phase is complete only when its applicable existing regression suites remain green.

## Testing Decisions

- Treat `NoteTimeline` as the primary and highest test seam. Most backend acceptance tests should arrange a temporary vault, invoke its public mutation, observation, history, provenance, or restore capability, and assert externally visible Markdown, reconstructed revisions, lifecycle records, warnings, and access boundaries. Tests should not assert private table layouts, checkpoint placement, or helper call order.
- Test the mutation contract across every Mutation Source: new note, editor save, task action, accepted proposal, external observation, Version Restore, baseline initialization, and recovery or reconciliation. A single conformance suite should prove that each app-owned caller receives identical durability ordering and meaningful-revision behavior.
- Test the three durability outcomes at the `NoteTimeline` seam: preparation failure publishes no Markdown; successful publication and finalization return success; publication followed by finalization or projection failure returns the authoritative committed state with a warning and is repaired idempotently.
- Test crash and restart boundaries around prepared intent, Markdown publication, and history finalization using fault injection at durable boundaries. Assertions should concern the resulting canonical note and timeline, not internal transaction steps.
- Test reconstruction behavior with histories containing insertions, deletions, large replacements, Unicode, line-ending changes, frontmatter changes, empty notes, and many revisions. Every reconstructed state must match its recorded hash and exact canonical UTF-8.
- The blocking codec spike must benchmark realistic typing sessions, repeated small edits to large notes, complete replacements, repetitive text, random text, long replay chains, and worst-case delta ratios. It must select thresholds that satisfy the agreed scale and latency targets before codec implementation is accepted.
- Add property-style tests that generate sequences of canonical authored states and verify round-trip reconstruction, clear/reset boundaries, checkpoint transparency, and corruption detection. These tests validate storage behavior through `NoteTimeline`; targeted SQLite tests may cover its private persistence invariants without creating a generic storage interface.
- Test Note Identity continuity across empty content, metadata loss, rename, move, forget, recovery, missing and reappearance. Test duplicate embedded identities with both originals present and prove that the existing timeline association cannot be overwritten.
- Test external observation with debounce bursts, duplicate watcher events, missed-event reconciliation, untrusted modification times, file deletion, path reuse, and store replacement. Assert only actually observed distinct states and honest timestamps.
- Test Editing Session derivation at four minutes fifty-nine seconds, exactly five minutes, and beyond five minutes, plus source changes, Lifecycle Events, and Version Restores. Assert that grouping never changes stored revision count or identity.
- Test that a title-only or path-only change creates a Lifecycle Event, creates no Note Revision, does not appear in a revision diff, and remains available to timeline browsing and current-title provenance.
- Test Current-Content Provenance with insertions, edits, deletions, movement with provable and ambiguous correspondence, formatting changes, manual retyping of identical prose, Version Restore, and Baseline Revisions with unknown earlier provenance.
- Test capability isolation: the ordinary chat handle cannot read removed prose; activity queries return only current excerpts and metadata; excluded, forgotten, and Missing Notes stay unavailable; explicit whole-note restore grants expose only their bound note and revision for the current turn.
- Test restore intent parsing conservatively at the application boundary. Direct whole-version requests receive a grant; partial, ambiguous, model-originated, stale-turn, or cross-note requests do not.
- Test chat restore through the existing proposal orchestration and review state machine. Assert that chat creates a durable complete-content proposal, never changes the note directly, and that acceptance later travels through the normal canonical mutation seam.
- Test History Mode's `HistoryModeSession` state machine independently of rendering: successful autosave entry, failed autosave refusal, exact workspace restoration, pinned revision behavior, stale restore-preview invalidation, and exit after note lifecycle changes.
- Add component tests for timeline paging, Editing Session expansion, deterministic summaries, parent/current diff switching, frontmatter disclosure, managed-metadata hiding, Named Revision editing, restore confirmation, Revision Citations, missing assets, health states, and recovery actions.
- Add end-to-end tests for the highest-risk user journeys: edit through multiple sessions and inspect diffs; name and restore a revision; receive and accept a chat restore proposal; observe an external edit while dirty; recover a Missing Note; clear history; restart and reconstruct history.
- Reuse the repository's existing temporary-vault Rust service tests as prior art for backend behavior, architecture-fitness tests for enforcing the single mutation seam, document operation and external-sync machine tests for frontend sequencing, proposal orchestration and review-machine tests for chat restores, workspace store sequence tests for state restoration, and native lifecycle end-to-end tests for restart behavior.
- Extend architecture-fitness coverage so ordinary-note canonical writers cannot bypass `NoteTimeline`, History Mode cannot become a pane or mutate editable document runtime state, and ordinary chat cannot depend on unrestricted history storage interfaces.
- Extend architecture-fitness coverage so SQL types, row identities, connection or transaction handles, WAL concepts, and storage-format selection cannot cross the `NoteTimeline` interface. Assert that revision and lifecycle identities remain stable when records are exported independently of database row order.
- Test storage-health presentation and operations with healthy, initializing, reclaimable, unavailable, corrupt, reset, and post-publication-warning states. Tests should assert actionable user-visible outcomes rather than exact diagnostic wording.
- Test history-store portability across WAL recovery, clean-close checkpointing, vault switching, vault-identity or generation mismatches, and reopening a cleanly copied vault. Prove that the watcher ignores the hidden Gneauxghts directory and that a live main-file-only copy is never presented as a valid supported backup.
- Add migration-shape fixtures that export SQLite-backed revisions, checkpoints, Lifecycle Events, labels, and deletion markers into immutable objects, reconstruct without consulting SQLite row identities or ordering, and compare every domain identity and content hash. Test interruption before and after manifest selection, rollback to the old generation, successful reopen of the new generation, and retirement of the old read-only store.
- Test Missing Note retention with each supported forgotten-note retention setting. Assert that the setting is captured when the note becomes Missing, later preference changes do not move its existing deadline, reappearance before the deadline preserves its timeline, and expiry purges the complete note timeline through the ordinary lifecycle purge path.
- Run existing Rust, frontend unit/component, architecture-fitness, and native end-to-end suites after integration. The feature is not complete if existing note save, task mutation, proposal acceptance, external conflict, forget/recovery, workspace restoration, or Markdown interoperability behavior regresses.

## Out of Scope

- Arbitrary comparison between any two historical revisions.
- Partial historical content restoration or chat-assisted section recovery.
- Keystroke capture or playback.
- History-wide full-text search over removed prose.
- Exporting a Note Timeline as a standalone artifact.
- AI-generated revision summaries.
- Versioning or restoring binary attachments and embedded assets.
- Individual revision deletion.
- Automatic lossy history pruning, revision coalescing, or retention limits while a note remains active or recoverable. A whole-note lifecycle purge at the configured forgotten-note deadline still removes that note's complete timeline.
- Per-note or per-vault history-disable controls.
- Concurrent offline multi-device history merging or collaborative author attribution.
- Live file synchronization of an open history store in the SQLite implementation. This is reserved for the separate storage-evolution milestone and does not include concurrent multi-writer merging.
- A separate encryption scheme for history.
- A global tamper-evident revision chain.
- Production migration of pre-feature development-vault metadata.
- Restoring historical title, path, identity, creation time, or lifecycle status as part of Version Restore.
- Direct note mutation by chat.
- Note Timeline ownership of chat transcripts or generated chat projection files.

## Further Notes

- This specification uses the domain language defined in the project glossary and is governed by the accepted ADRs that place Note Timelines at the canonical mutation seam, treat SQLite as the first replaceable storage implementation, and restrict chat history access to Current-Content Provenance plus explicit whole-note restore proposals.
- The exact delta codec and adaptive checkpoint policy remain deliberately unresolved implementation details. They are a blocking evidence-gathering spike, not a product interview question; the selected design must preserve the externally specified lossless reconstruction, integrity, scale, and latency guarantees.
- Editing Sessions, deterministic summaries, and line or paragraph provenance are projections over retained Note Revisions. They must remain rebuildable and must not become alternate sources of truth.
- “Complete user-authored content” means the full restorable authored state defined by the canonical note parser: body and unmanaged frontmatter in the first release. Current title and path are lifecycle state and are intentionally preserved during Version Restore.
- The history store is durable vault knowledge, but current Markdown remains the interoperability surface and canonical present state. A history failure may block new app-owned writes; it must never make existing Markdown unreadable.
- During the SQLite implementation, vault portability means a cleanly closed vault. Arbitrary live folder copying and concurrent cloud-synchronized writers are not promised to produce a consistent history store; opening such a copy must verify identity and integrity and reconcile explicitly.
- “Live file sync” means a third-party file synchronizer may transport history files while Gneauxghts is open, with only one logical Gneauxghts writer active for that vault. It does not mean concurrent multi-device editing or automatic merging of divergent Note Timelines.
- SQLite is the first durable implementation, not the stable portable history format. Migration cost is contained by the `NoteTimeline` interface, storage-neutral domain identities and payloads, rebuildable projections, localized SQL, and an integrity-checked manifest generation switch. Do not introduce a speculative storage interface before the second implementation supplies a real alternative.
- The fail-closed save policy is an initial-development diagnostic policy, not an unreviewable production default. Phase 1 may proceed with it, but production release requires an explicit availability decision informed by the failures observed during development.
