---
status: accepted
---

# Retain unfinished work as private Recovery Drafts

Keep coalesced unfinished editor content and its last saved base in the Running
Vault's existing private app-state database. A Recovery Draft is neither canonical
Markdown nor a Note Revision. This reduces loss when mandatory history preparation
blocks a save, without weakening [ADR 0006](0006-keep-history-preparation-mandatory-in-production.md).

Recovery explicitly opens the original Note Identity through ordinary workspace
navigation, reads current canonical content, and restores unfinished content through
`DocumentEditingService.restoreRecoveryDraft`. Only never-saved ideas use New Idea.
Matching saved bases permit ordinary autosave; changed or unknown bases use the
existing external-conflict choice before saving. This includes older backups without
a saved base. A conflict's subsequent backup retains an unknown base so another
interruption cannot implicitly accept it. Already-saved matching work is acknowledged
without replay. Current unsaved edits, busy operations and unresolved conflicts are
protected. Missing originals keep the backup and report failure rather than creating
a replacement note. Recovered title edits follow ordinary note rename behavior.

The frontend retains immutable body and baseline captures, serializing only at the
backup boundary, and flushes alongside departure/background saves. UUIDs and
increasing versions identify backups; native versioned, content-free tombstones
prevent late writes from reviving saved or discarded work. Canonical adoption clears
only a clean buffer. Newer body edits and uncommitted title input remain recoverable.
Restored work is backed up before retiring the previous backup.

Private backup failure is visible and retryable but cannot veto a successful
canonical save. Coalescing and platform termination still leave a loss window;
this is not synchronous durability for every keystroke. Backups share the Running
Vault's local storage and are not an independent disaster backup. Staging a
Next-launch Vault Selection does not redirect them. A successful ordinary save
still requires Note Timeline preparation and follows its existing warning and
recovery rules.

## Policy revision, 2026-10-22

The initial separate-copy policy caused duplicate notes during recovery. At the
user's request it is replaced by restoring the original identity with explicit
conflict admission. Historical separate-copy verification remains historical;
it does not describe the current recovery action.
