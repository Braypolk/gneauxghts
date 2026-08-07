# Accepted behavior decisions

These decisions define product behavior that foundation refactors must preserve.
Tests may rely on the invariants below. Details not stated here remain open and
must not be inferred from the current implementation.

## 1. Remember affects only the invoking pane

Remember persists the current document. The pane that invoked Remember moves to
a fresh draft; every other pane displaying that document remains on the saved
document.

Invariants:

- Remember produces one canonical saved document.
- Only the invoking pane is rebound to a fresh draft.
- Other panes retain the saved document identity and content.

## 2. Chat context follows the visible editor; note navigation targets an editor

Chat context is the note shown in the editor pane nearest the chat pane, so what
the user reads and what the chat reasons about cannot disagree. A chat pane with
no visible editor falls back to its own retained context note. Generic note
navigation targets the nearest editor pane when one is visible; otherwise it
reuses the active retained-context pane and reveals its editor.

Invariants:

- A chat pane beside an editor draws its context from that editor's current
  note, and follows it as the editor navigates. Its retained document stays
  aligned with that live context so closing the editor leaves the chat on the
  most recent note.
- A chat pane with no visible editor uses its retained context note, which is
  also its route back to editing. That retain is the pane location stack's
  thought-partner slot: it tracks the most recent editor note visited on the
  pane (Previous, Recent, shortcuts, and in-editor navigation all update it).
- The note body, path, and selection sent with a message all come from the same
  resolved context pane, so they can never describe different notes.
- The resolved context note is named in the chat header, so the binding is never
  ambiguous.
- Generic note navigation never repurposes a chat pane while an editor target is
  available.
- A single pane can switch directly between editor and chat while retaining its
  document context.
- A multi-pane workspace can temporarily contain only chat panes; each pane
  still provides a direct route back to its retained note.
- Any pane may close when another pane remains, regardless of pane kind.
- Note navigation always queues the target document binding through the editor
  lifecycle; presentation readiness may affect timing but cannot skip content
  synchronization.

## 3. Closing the active pane selects an adjacent pane

After closing the active pane, the pane immediately to its right becomes active
when one exists; otherwise the pane immediately to its left becomes active.

Invariants:

- Selection is based on the closed pane's position immediately before removal.
- A non-adjacent pane is never selected while an adjacent pane exists.

## 4. External edits never overwrite dirty local edits

When a dirty local document and an external edit conflict, neither version
overwrites the other automatically. The app exposes an explicit conflict. Clean
documents refresh in every pane that displays them.

Invariants:

- Dirty local content is preserved until an explicit conflict resolution.
- External content remains recoverable for conflict resolution.
- Every pane displaying a clean changed document converges to the disk version.
- A conflicting edit offers explicit Keep my edits, Load disk version, and
  Copy my edits actions. An external deletion offers recreation or detaching
  the retained text as a new draft.
- Navigation and destructive note actions do not orphan an unresolved
  conflict.

## 5. Task mutations respect dirty open documents

A task mutation targeting a dirty open note applies to the open document model
and then follows normal persistence. It never changes the file behind the open
document.

Invariants:

- A task mutation cannot silently discard unsaved edits.
- The open document model is the mutation source of truth while dirty.
- Persistence and derived projections observe the same resulting document.
- If unsaved edits make duplicate task text impossible to identify safely, the
  mutation is rejected as ambiguous instead of guessing from a stale line.

## 6. Editor and chat transitions retain the document

Changing an editor pane to chat retains its document as the chat context and
return target. Changing that pane back to editor restores the retained document.

Invariants:

- Entering chat does not discard or replace the pane's document identity.
- Chat context and the editor return target refer to the same retained document.
- Returning to editor does not depend on unrelated workspace navigation.

## 7. Proposal review has one editable owner

At most one proposal review is editable globally. Other pending proposals remain
queued and durable until they can be reviewed or resolved.

Invariants:

- Two proposal reviews can never be editable concurrently.
- Queued proposals are not lost when another review becomes active.
- Restarting the app preserves unresolved durable proposals.

## 8. Save completion has a defined consistency boundary

A save is complete after the canonical file and the required in-memory note
catalog are committed. Lexical and semantic indexing may complete in the
background. Task reads provide read-your-write consistency.

Invariants:

- A successful save response implies canonical bytes and catalog identity are
  available.
- Once canonical bytes are committed, a required projection failure is returned
  as committed-with-warning data carrying the authoritative identity and path,
  never as a retryable write error.
- Lexical or semantic lag cannot turn a completed canonical save into failure.
- Task reads immediately after save reflect the saved document.
- Navigation crosses its persistence barrier only after dirty documents are
  clean; a failed save keeps the current editor route and remains retryable.

## 9. Semantic search preserves the last good result

When semantic indexing becomes stale or temporarily fails, the last good stale
results remain visible. Automatic retry is bounded. A degraded status and an
explicit Retry now action are available.

Invariants:

- A transient rebuild failure does not discard the last usable semantic result.
- Retried failed work cannot overwrite a newer queued update, delete, or move.
- Automatic retry cannot loop without a bound or backoff.
- Users can distinguish fresh, stale, rebuilding, and degraded states.

## 10. Chat crash recovery preserves partial output

A crash during chat generation preserves the partial assistant response, marks
the request interrupted, and allows the user to retry it.

Invariants:

- Persisted partial content is not presented as a completed response.
- A running agent run is reconciled from its assistant message's durable
  terminal status, including the crash window between the two status writes.
- Interrupted state survives restart.
- Retry creates a traceable continuation without erasing the interrupted output.

## 11. Proposal commit recovery converges after a status-write failure

If proposal content was persisted but updating the proposal status failed,
recovery proves the target content or hash and converges the proposal to
committed.

Invariants:

- Recovery never reapplies an already-persisted proposal blindly.
- Committed status is inferred only from verified target content or hash.
- Repeated recovery is idempotent.

## 12. Self-save suppression is operation-aware

Self-save expectations describe the exact filesystem outcome of an app-owned
operation. An external change is recognized immediately whenever the observed
filesystem state differs from that expectation.

Invariants:

- Failed or uncommitted app operations cannot suppress later external changes.
- Write, move, and delete expectations include all paths and final outcomes they
  own.
- A matching self-save may be deduplicated; a non-matching change is external
  even inside the deduplication window.

## 13. Draft chats expose the complete chat configuration

A chat does not need to be persisted before its provider, vault access, web
option, or attachment control is available. Draft choices become the initial
conversation configuration when the first message is sent.

Invariants:

- Starting a new chat does not remove composer configuration controls.
- Provider and vault-access changes made before the first message are retained.
- Backend-resolved chat settings are the sole source of the default model; an
  uninitialized frontend draft does not assume a model name.
- Conversation creation applies the draft provider, model, and vault access
  atomically.
- Attachment capability follows the selected draft model rather than the
  previously open conversation.

## 14. App-owned proposal commits advance the open document baseline

After a successful proposal commit, the open document acknowledges the exact
markdown written by the app instead of routing that write through the generic
external-conflict path.

Invariants:

- A verified app-owned proposal write does not display Changed outside the app.
- A local edit made after commit begins is preserved as dirty working content.
- If disk no longer matches the markdown the app committed, normal external
  conflict protection still applies.

## 15. Proposal arrival does not navigate

Receiving a durable chat proposal adds it to the conversation's pending review
queue. If its target is already open in an editor, the proposal is displayed
there without opening, activating, focusing, or repurposing a pane. Navigation
into a closed target begins only when the user chooses **Review in editor**.

Invariants:

- A proposal targeting a closed note leaves the current note and chat panes
  unchanged.
- A proposal targeting an open, clean editor installs its proposed content and
  review decorations without changing the active pane.
- Reopening a conversation restores its pending proposals without opening their
  targets.
- Explicit review may open or activate the target note because that action is a
  user navigation request.
