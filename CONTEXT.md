# Gneauxghts

Gneauxghts is a local-first notes workspace whose durable knowledge consists of notes and the histories attached to them.

## Language

**Note Timeline**:
The ordered history of reconstructable revisions and lifecycle events belonging to one stable note identity.
_Avoid_: File history, edit log

**Note Identity**:
The durable identity that binds a note and its timeline across content changes, renames, moves, forgetting, and recovery.
_Avoid_: File identity, path identity

**Note Revision**:
A retained, reconstructable user-visible authored state with a stable identity. Finalized revisions are individually addressable.
_Avoid_: Save, snapshot, version

**Editing Window**:
A span of ordinary editing lasting at most five minutes from its first distinct saved state, whose net change becomes one retained Note Revision. Intermediate states are not individually retained; returning to the preceding retained state creates no revision.
_Avoid_: Editing Session, codec checkpoint, autosave interval

**Named Revision**:
A note revision carrying a durable user-supplied label that marks an important state without duplicating its content.
_Avoid_: Named snapshot, saved copy

**Lifecycle Event**:
A timeline occurrence that changes a note's status or location without defining a new content state, such as a rename, forget, or deletion.
_Avoid_: Metadata revision

**Mutation Source**:
The local origin through which a revision or lifecycle event entered the timeline, such as the editor, a task action, an accepted chat proposal, an external edit, or a restore.
_Avoid_: Author, collaborator

**Current-Content Provenance**:
Retained revision evidence about when and how content still present in a note was introduced, most recently changed, or returned through a Version Restore. Editing Windows supply intervals rather than exact within-window introduction or retyping history.
_Avoid_: Historical recall, history context

**History Mode**:
A read-only workspace for browsing one note timeline, inspecting changes, naming revisions, and initiating a Version Restore without disturbing the editing workspace.
_Avoid_: History pane, revision editor

**Revision Summary**:
A deterministic account of the size, source, and timing of a note revision without interpreting the meaning of its prose.
_Avoid_: AI summary, change description

**Baseline Revision**:
The first state recorded when history begins for an existing note, establishing when its content became known without implying when that content was introduced or last changed.
_Avoid_: Original revision, creation revision

**Missing Note**:
A note whose canonical Markdown disappeared outside Gneauxghts while its identity and timeline remain temporarily recoverable.
_Avoid_: Forgotten note, deleted history

**Version Restore**:
A new revision whose user-authored content is reconstructed from an earlier revision while every intervening revision and the note's current identity remain intact.
_Avoid_: Revert, rollback, note recovery

**Forgotten-Note Recovery**:
The lifecycle transition that returns a forgotten note to the active vault without treating its content as an earlier version.
_Avoid_: Version restore, unforget
