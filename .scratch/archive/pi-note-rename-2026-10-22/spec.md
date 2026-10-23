# Pi saved-note filename editing

Accepted implementation contract for the authorized follow-up to the
[quality work](../app-quality-followup-2026-10-22/README.md). The
[outcome](README.md) records implementation, acceptance and limits. This archived
contract is outside the executable backlog. Automatic capture titles continue to
use the ordinary editor title/save owner; saved-note filename editing uses the
separate publication contract below.

## Scope and owner contract

The original planning assessment identified why merely exposing `rename_note`
through `edit_note` or ordinary title save would bypass two contracts: native publication admission described one
path, and `DocumentEditingService.withAgentPublication().adopt()` requires the
receipt path to equal that admitted path. In addition, the ordinary editor's
`NoteTimeline::publish_authored` moves with `fs::rename` before writing;
that is not a destination-preserving primitive when an external file appears
after review. Its single-location `PublicationProof` could not prove both source removal and destination
creation after a lost acknowledgement. The implementation extends the existing
owners with a typed two-location proof rather than adding a title field to Update.

Implement the first rename tool as a **same-folder rename only**, with this public
input:

```ts
{ noteId: string; expectedReadSourceId: string; title: string }
```

No arbitrary path, directory creation, extension choice, managed ID change or
implicit suffix selection. Native code derives a visible Markdown filename and
returns the exact canonical relative source and destination for review. Reject
empty/dot/hidden names, traversal/separators, invalid/reserved platform names,
symlink targets, out-of-vault paths, occupied destinations and ambiguous
case/normalization-only renames. Prefer an explicit unsupported-name error over
silently changing a requested name. Body and authored properties remain unchanged.

Required owner changes, in dependency order:

1. `src-tauri/src/state/persistence.rs`: add a platform-backed no-replace move
   primitive that performs source removal/destination creation atomically and
   durably on supported vault filesystems. A preflight existence check followed by
   `fs::rename` is insufficient. Candidate platform APIs must be verified against
   primary platform documentation before selecting them. Copy/link/delete is not
   interchangeable without durable two-path recovery and a documented external
   writer policy.
2. `src-tauri/src/services/note_timeline/publication.rs`, `history_store.rs` and
   applicable `domain.rs` publication types: add a typed rename effect/proof with
   old path, exact new path, retained Note Identity and unchanged source bytes.
   Prepare durable history before moving. Under canonical file ownership, resolve
   and validate exact source identity/location/hash again, then perform the
   no-replace move. Preserve the logical Note Identity and history chain, record
   the existing rename lifecycle event, and coordinate catalog/tasks/watchers with
   both paths. Do not create an extra content revision for an unchanged body.
3. Extend reconciliation to distinguish prepared/no effect, committed move, changed
   source, changed destination and uncertain mixed state. Verify exact destination
   identity/bytes plus old-path absence; if another file occupies the old path it
   must be left intact. A lost acknowledgement returns the original receipt and
   repairs projections through existing owners; it never replays old content or
   guesses a new destination. Restart recovery needs the old/new proof before any
   new effect, including after the move but before watcher/projection settlement.
4. `src-tauri/src/pi_chat/authority.rs` and `src/lib/features/chat/pi/authority.ts`:
   add a distinct `Rename` operation, excluded from existing update/create grants
   and default UI selections. A grant must admit the source identity and location
   and the exact destination folder; temporary grants remain conversation-bound.
   Exclusions, revocation and exact authority revision are checked at preparation,
   approval and effect, as for existing publication.
5. `src-tauri/src/pi_chat/publication.rs`: add typed `Mutation::Rename`, source and
   destination fields in the prepared/admitted target and payload hash, and a
   native rename preview. Exact Keep approval binds both paths and the source
   receipt. Do not repurpose Update's one-location proof or Create's new identity.
   Changed source/destination invalidates review; collisions never select a suffix
   and never overwrite a file.
6. `src/lib/features/notepad/document/documentEditingService.ts`,
   `documentPublicationAdmission.ts` and native editor admission: the lease must
   protect both source and destination locations, including any open buffer at
   either path. Block dirty/conflicted/title-editing/in-flight destinations and
   sources. Retain the immutable Document Handle and Note Identity while adopting
   the new canonical path/title into both panes. Do not open a second document for
   the same identity. An uncertain effect retains the existing publication lease
   until settled, preventing stale-path autosave.
7. `src/lib/features/chat/pi/publication.ts`, a narrow `rename.ts` extension and
   `src/lib/features/chat/ui/PiEditReview.svelte`: use the existing Pi Publication
   Task for progression, cancellation and replay. Present `Old.md → New.md` with
   unchanged-content language and an exact rename action. No custom effect queue,
   generic filesystem executor or direct canonical write from the tool.

Ordinary-link semantics must be explicit before enabling the tool: ID-based
references retain Note Identity, while filename/path links may stop resolving.
The first slice must not silently rewrite backlinks across the vault. Review
should communicate that consequence and any existing reference count available
without inventing authority. A later link-rewrite feature requires independent
scoped reads, prepared edits and exact review per changed note. Do not revive the
retired chat-to-note feature.

Acceptance cases:

- Destination already exists, arrives after review, or arrives after durable
  preparation: preserve both files, return a blocked/uncertain result as proven.
- Source moves/changes/trashes, managed-only bytes change, exclusion/grant changes,
  old review is replayed, or a foreign receipt is supplied: no rename.
- Dirty source or destination in either pane, live title input, autosave queued,
  WebView replacement and restart quiescence: no unleased write or stale adoption.
- Interrupt immediately after preparation, after native move, after history
  settlement, and after commit before acknowledgement; reopen and reconcile once
  with stable identity/history and no duplicate effect.
- Reversed watcher events do not duplicate/delete the logical note; both panes
  adopt the same path under the original Document Handle; related/search/task
  projections resolve the renamed identity.
- Unicode/case-only names, reserved names, symlinks, absolute paths, `..`, hidden
  folders, separators and extensions obey the explicit platform policy.
- ID-based source navigation still resolves; ordinary path links follow the
  documented policy and no backlink is silently edited.
